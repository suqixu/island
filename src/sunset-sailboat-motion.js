import * as THREE from 'three';
import { createSailboatMotion } from './sailboat-motion.js';
import { heightAt as terrainHeight } from './terrain.js';
import { getSunsetState } from './sunset.js';

const angleBetween = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// A voyage is an analytic circular turn followed by a straight course. Sampling
// absolute voyage time keeps the path identical at different frame rates.
function courseAt(course, time, out) {
  const age = clamp(time - course.start, 0, course.duration);
  const turning = Math.min(age, course.turnTime), angle = course.heading + course.rate * turning;
  if (Math.abs(course.rate) < 1e-9) {
    out.x = course.x + Math.sin(course.heading) * course.speed * age;
    out.z = course.z + Math.cos(course.heading) * course.speed * age;
  } else {
    out.x = course.x + (Math.cos(course.heading) - Math.cos(angle)) * course.speed / course.rate
      + Math.sin(angle) * course.speed * (age - turning);
    out.z = course.z + (Math.sin(angle) - Math.sin(course.heading)) * course.speed / course.rate
      + Math.cos(angle) * course.speed * (age - turning);
  }
  out.heading = angle;
  return out;
}

function makeCourse(pose, route, time, heading) {
  const turn = angleBetween(heading, pose.heading), turnTime = Math.max(28, Math.abs(turn) / .035);
  return { x: pose.x, z: pose.z, heading: pose.heading, rate: turn / turnTime, turnTime,
    speed: route.speed, start: time, duration: Math.max(0, route.start + route.duration - time) };
}

/** Add a single quiet sunset voyage without changing random cohorts or resources. */
export function createSunsetSailboatMotion({ heightAt = terrainHeight, seed } = {}) {
  const motion = createSailboatMotion({ heightAt, seed });
  const states = motion.boats.map(() => ({ route: null, course: null, returning: false, attemptedEpisode: -1 }));
  const cameraPosition = new THREE.Vector3(), target = new THREE.Vector3();
  const sample = {}, otherSample = {};
  let selected = null, lastTime = null, wasSunset = false, episode = 0;

  function safeCourse(course, boat) {
    const route = boat.route;
    // Extra margin covers roll/pitch, the bow, and travel/rotation between samples.
    const halfLength = route.length / 2 + 2, halfBeam = route.beam / 2 + 2;
    const alongCount = Math.ceil(halfLength * 2 / 1.6), acrossCount = Math.ceil(halfBeam * 2 / .6);
    const times = Math.max(1, Math.ceil(course.duration / 2));
    for (let step = 0; step <= times; step++) {
      const time = course.start + course.duration * step / times;
      courseAt(course, time, sample);
      const sin = Math.sin(sample.heading), cos = Math.cos(sample.heading);
      for (let along = 0; along <= alongCount; along++) for (let across = 0; across <= acrossCount; across++) {
        const forward = -halfLength + halfLength * 2 * along / alongCount;
        const side = -halfBeam + halfBeam * 2 * across / acrossCount;
        const x = sample.x + sin * forward + cos * side, z = sample.z + cos * forward - sin * side;
        const radius = Math.hypot(x, z), bed = heightAt(x, z);
        if (radius < 600 || radius > 1300 || !Number.isFinite(bed) || bed >= -5) return false;
      }
      for (const other of motion.boats) {
        if (other === boat || !other.route) continue;
        const otherState = states[other.index];
        if (otherState.course) courseAt(otherState.course, time, otherSample);
        else {
          const travel = clamp(time - other.route.start, 0, other.route.duration) * other.route.speed;
          otherSample.x = other.route.x + Math.sin(other.route.heading) * travel;
          otherSample.z = other.route.z + Math.cos(other.route.heading) * travel;
        }
        if (Math.hypot(sample.x - otherSample.x, sample.z - otherSample.z) < 75) return false;
      }
    }
    return true;
  }

  return {
    boats: motion.boats,
    advance(elapsed, env = {}, camera) {
      const supplied = Number.isFinite(elapsed) ? Math.max(0, elapsed) : lastTime ?? 0;
      const now = Math.max(supplied, lastTime ?? supplied);
      lastTime = now;
      motion.advance(elapsed, env, camera);
      for (const boat of motion.boats) {
        const state = states[boat.index];
        if (state.route !== boat.route) {
          state.route = boat.route; state.course = null; state.returning = false; state.attemptedEpisode = -1;
          if (selected === boat) selected = null;
        }
        if (state.course) courseAt(state.course, now, boat.pose);
      }
      const physicalSun = env.sunDirection;
      const direction = env.sunBackdropDirection;
      const sunHeight = Number.isFinite(physicalSun?.y) ? physicalSun.y :
        Array.isArray(env.sun) ? env.sun[1] / Math.hypot(...env.sun) : 1;
      const twilight = getSunsetState({ ...env, sunHeight }).strength;
      const sunset = sunHeight < .3 && twilight > .25 && camera?.isCamera &&
        Number.isFinite(direction?.x) && Number.isFinite(direction?.z) && Math.hypot(direction.x, direction.z) > .1;
      if (sunset && !wasSunset) episode++;
      if (!sunset && wasSunset) {
        for (const boat of motion.boats) {
          const state = states[boat.index];
          if (!state.course || state.returning) continue;
          const returning = makeCourse(boat.pose, boat.route, now, boat.route.heading);
          // Retain the already checked offshore voyage if a changed return
          // course could reach shallow water; the next cohort resumes normally.
          if (safeCourse(returning, boat)) state.course = returning;
          state.returning = true;
        }
        selected = null;
      }
      if (sunset && !selected) {
        camera.getWorldPosition(cameraPosition);
        target.set(direction.x, 0, direction.z).normalize().multiplyScalar(5000).add(cameraPosition);
        const candidates = motion.boats.filter(boat => boat.route && boat.pose.visible && boat.pose.opacity > .15 &&
          !states[boat.index].course && states[boat.index].attemptedEpisode !== episode && Math.hypot(boat.pose.x, boat.pose.z) > 730)
          .map(boat => ({ boat, heading: Math.atan2(target.x - boat.pose.x, target.z - boat.pose.z) }))
          .sort((a, b) => Math.abs(angleBetween(a.heading, a.boat.pose.heading)) - Math.abs(angleBetween(b.heading, b.boat.pose.heading)));
        for (const { boat, heading } of candidates) {
          // A rejected route stays rejected for this sunset episode; avoid a
          // complete terrain sweep on every animation frame.
          states[boat.index].attemptedEpisode = episode;
          const course = makeCourse(boat.pose, boat.route, now, heading);
          if (course.duration < course.turnTime + 25 || !safeCourse(course, boat)) continue;
          states[boat.index].course = course; selected = boat; break;
        }
      }
      wasSunset = Boolean(sunset);
      return motion.boats;
    },
  };
}
