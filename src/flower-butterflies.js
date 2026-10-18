import {attachRuntimeOptions} from './runtime-options.js';
import * as THREE from 'three';
import config from './config/butterflies.json' with { type: 'json' };
import { getAnimationDelta } from './animation-time.js';
import { createWildlifeView } from './wildlife-visibility.js';
import { canInsectsFly } from './insect-weather.js';
import { createButterflyMeshes } from './models/butterfly.js';

const smooth = value => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;

/** Each scene owns its random activity, reservations and animation clock. */
export function createFlowerButterflies(parent, { anchors = [], heightAt = () => 0, random = Math.random, reservations = new Set() } = {}) {
  const group = new THREE.Group(); group.name = '花丛蝴蝶'; parent.add(group);
  const capacity = Math.min(config.counts.high, anchors.length);
  const { body, wings } = createButterflyMeshes(capacity), meshes = [body, ...wings]; group.add(...meshes);
  const reserved = reservations, dummy = new THREE.Object3D(), wing = new THREE.Object3D();
  const cameraPosition = new THREE.Vector3(), flower = new THREE.Vector3(), offset = new THREE.Vector3();
  const color = new THREE.Color(), wingRotation = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1);
  const duration = kind => config.seconds[kind].min + random() * config.seconds[kind].range;
  const agents = Array.from({ length: capacity }, (_, index) => {
    color.set(config.palette[Math.floor(random()*config.palette.length)]).offsetHSL((random()-.5)*.06,(random()-.5)*.1,(random()-.5)*.1); wings.forEach(mesh => mesh.setColorAt(index, color));
    return { phase: 'waiting', age: 0, duration: duration('recovery'), anchor: null,
      position: new THREE.Vector3(), from: new THREE.Vector3(), exit: new THREE.Vector3(),
      angle: random() * TAU, yaw: 0, flutter: random() * TAU, visibility: 0, departureScale: 1, departureFold: 0,
      size: config.size.min + random() * config.size.range };
  });
  const view = createWildlifeView();
  const anchorPositions = anchors.map(anchor => anchor.sample(0, new THREE.Vector3()));
  let disposed = false, previousTime, clock = 0, poseAge = Infinity, limit = capacity, quality = 'high', wasEligible = false;
  function clear(agent, kind = 'recovery') {
    reserved.delete(agent.anchor); agent.anchor = null; agent.phase = 'waiting'; agent.age = 0;
    agent.duration = duration(kind); agent.visibility = 0;
  }
  function transition(agent, phase) {
    const previousFold = foldOf(agent);
    agent.from.copy(agent.position); agent.phase = phase; agent.age = 0;
    agent.duration = duration(phase === 'perched' ? 'rest' : phase === 'arriving' ? 'arrival' : phase === 'circling' ? 'circle' : phase === 'departing' ? 'departure' : phase);
    if (phase === 'departing') {
      agent.departureFold = previousFold;
      agent.departureScale = agent.visibility;
      agent.exit.copy(agent.from).add(offset.set(Math.sin(agent.angle) * 3.5, 1, Math.cos(agent.angle) * 3.5));
      const floor = heightAt(agent.exit.x, agent.exit.z);
      if (Number.isFinite(floor)) agent.exit.y = Math.max(agent.exit.y, floor + .8);
    }
  }
  function foldOf(agent) {
    if (agent.phase === 'perched') return 1;
    if (agent.phase === 'landing') return smooth((agent.age / agent.duration - .55) / .45);
    if (agent.phase === 'departing') return agent.departureFold * (1 - smooth(agent.age / .45));
    return 0;
  }
  function begin(agent, time) {
    const first = Math.floor(random() * anchors.length);
    for (let step = 0; step < anchors.length; step++) {
      const anchor = anchors[(first + step) % anchors.length];
      if (!anchor.available() || reserved.has(anchor)) continue;
      agent.anchor = anchor; reserved.add(anchor); anchor.sample(time, flower);
      agent.angle = random() * TAU;
      agent.position.copy(flower).add(offset.set(Math.cos(agent.angle) * 3.2, 1.4, Math.sin(agent.angle) * 3.2));
      agent.yaw = -agent.angle - Math.PI / 2; transition(agent, 'arriving'); return;
    }
  }
  function advance(agent, dt, time, eligible) {
    agent.age += dt;
    if (agent.phase === 'waiting') {
      if (!eligible) { agent.age = 0; return; }
      if (agent.age >= agent.duration) begin(agent, time);
      if (agent.phase === 'waiting') return;
    }
    if (agent.phase !== 'departing' && (!eligible || !agent.anchor.available())) transition(agent, 'departing');
    if (agent.age >= agent.duration) {
      if (agent.phase === 'arriving') transition(agent, 'circling');
      else if (agent.phase === 'circling') transition(agent, 'landing');
      else if (agent.phase === 'landing') transition(agent, 'perched');
      else if (agent.phase === 'perched') transition(agent, 'departing');
      else { clear(agent, eligible ? 'pause' : 'recovery'); return; }
    }
    const oldX = agent.position.x, oldZ = agent.position.z, p = agent.age / agent.duration, blend = smooth(p);
    agent.anchor.sample(time, flower); flower.y += .04;
    if (agent.phase === 'arriving' || agent.phase === 'circling') {
      const angle = agent.angle + agent.age * .9;
      const radius = 1 + Math.sin(agent.age * 1.3 + agent.flutter) * .18;
      offset.set(Math.cos(angle) * radius, .95 + Math.sin(agent.age * 2.7 + agent.flutter) * .18, Math.sin(angle) * radius);
      agent.position.copy(flower).add(offset);
      // Blend the first arc from the incoming path; a stage boundary never teleports.
      agent.position.lerp(agent.from, 1 - smooth(agent.age / (agent.phase === 'arriving' ? agent.duration : .8)));
      agent.visibility = agent.phase === 'arriving' ? smooth(agent.age / .6) : 1;
    } else if (agent.phase === 'landing') {
      agent.position.lerpVectors(agent.from, flower, blend);
      agent.position.y += Math.sin(p * Math.PI) * .16; agent.visibility = 1;
    } else if (agent.phase === 'perched') {
      agent.position.copy(flower); agent.visibility = 1;
    } else {
      agent.position.lerpVectors(agent.from, agent.exit, blend);
      agent.position.y += Math.sin(p * Math.PI) * .4;
      agent.visibility = agent.departureScale * (1 - smooth((p - .65) / .35));
    }
    // Terrain is sampled along the entire path, including approaches to sloping meadows.
    const floor = heightAt(agent.position.x, agent.position.z);
    if (Number.isFinite(floor)) agent.position.y = Math.max(floor + .08, agent.position.y);
    if (agent.phase !== 'perched') {
      const dx = agent.position.x - oldX, dz = agent.position.z - oldZ;
      if (Math.hypot(dx, dz) > .0001) {
        const target = Math.atan2(dx, dz), turn = Math.atan2(Math.sin(target - agent.yaw), Math.cos(target - agent.yaw));
        agent.yaw += turn * (1 - Math.exp(-dt * 8));
      }
    }
  }
  function writePose(agent, index) {
    const flap = .25 + Math.sin(clock * 26 + agent.flutter) * .95;
    const rest = 1.32 + Math.sin(clock * 1.4 + agent.flutter) * .09;
    const fold = foldOf(agent);
    dummy.position.copy(agent.position); dummy.rotation.set(0, agent.yaw, 0); dummy.scale.setScalar(agent.size * agent.visibility);
    dummy.updateMatrix(); body.setMatrixAt(index, dummy.matrix);
    for (let side = 0; side < 2; side++) {
      wingRotation.setFromAxisAngle(zAxis, (side === 0 ? 1 : -1) * THREE.MathUtils.lerp(flap, rest, fold));
      wing.position.copy(agent.position); wing.quaternion.copy(dummy.quaternion).multiply(wingRotation);
      wing.scale.setScalar(agent.size * agent.visibility);
      wing.updateMatrix(); wings[side].setMatrixAt(index, wing.matrix);
    }
  }
  function writePoses() {
    for (let index = 0; index < limit; index++) writePose(agents[index], index);
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
    poseAge = 0;
  }
  function setQuality(value = 'high') {
    if (disposed) return;
    quality = Object.hasOwn(config.counts, value) ? value : 'high';
    limit = Math.min(capacity, config.counts[quality]);
    for (let index = limit; index < capacity; index++) clear(agents[index]);
    body.count = limit; wings.forEach(mesh => { mesh.count = limit; }); poseAge = Infinity;
  }
  function update(time, env = {}, camera) {
    if (disposed) return;
    const now = Number.isFinite(time) ? time : (previousTime ?? 0);
    const dt = previousTime === undefined ? 0 : getAnimationDelta(now - previousTime, .1, env);
    previousTime = now; clock += dt; poseAge += dt;
    if (env.quality && env.quality !== quality) setQuality(env.quality);
    const eligible = canInsectsFly(env, config.activity);
    if (eligible && !wasEligible) for (const agent of agents) if (agent.phase === 'waiting') clear(agent);
    wasEligible = eligible;
    view.update(camera);
    let active = false, inView = false;
    for (let index = 0; index < limit; index++) {
      advance(agents[index], dt, now, eligible);
      if (agents[index].visibility > 0) { active = true; inView ||= view.intersects(agents[index].position, .7); }
    }
    let distance = 0;
    if (camera && anchors.length) {
      camera.getWorldPosition(cameraPosition); distance = Infinity;
      for (const position of anchorPositions) distance = Math.min(distance, cameraPosition.distanceToSquared(position));
      distance = Math.sqrt(distance);
    }
    const wasVisible = group.visible;
    group.visible = active && inView && distance < config.distance.hidden;
    if (!active && wasVisible) writePoses();
    if (!group.visible || (wasVisible && distance > config.distance.fullRate && poseAge < config.distance.updateSeconds)) return;
    writePoses();
  }
  function dispose() {
    if (disposed) return; disposed = true;
    const materials = new Set();
    for (const mesh of meshes) { mesh.dispose(); mesh.geometry.dispose(); materials.add(mesh.material); }
    for (const material of materials) material.dispose();
    for (const agent of agents) reserved.delete(agent.anchor);
    group.removeFromParent(); group.clear();
  }
  // No identity matrices may flash at the world origin before the first update.
  agents.forEach(writePose);
  for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
  return attachRuntimeOptions({group,update,setQuality,dispose},{butterfly:{capacity,counts:config.counts,batches:[{body,parts:wings.map(mesh=>({mesh}))}]}});
}
