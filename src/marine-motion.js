import { getAnimationRate } from './animation-time.js';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const unit = (value, fallback = 0) => clamp(finite(value, fallback), 0, 1);
const smooth = (value, low, high) => {
  const amount = unit((value - low) / (high - low));
  return amount * amount * (3 - 2 * amount);
};
const sample = (heightAt, x, z) => {
  const height = typeof heightAt === 'function' ? heightAt(x, z) : -12;
  return Number.isFinite(height) ? height : Infinity;
};
const random = seed => {
  const value = Math.sin(seed * 127.1 + 31.7) * 43758.5453;
  return value - Math.floor(value);
};

export const MARINE_SCHEDULE = Object.freeze({
  whale: Object.freeze({ start: 8, period: 67, duration: 11.5, spacing: 0, travel: 20, base: -3.7 }),
  dolphin: Object.freeze({ start: 9, period: 43, duration: 2.4, spacing: 1.2, travel: 14, base: -1.25 }),
  'flying-fish': Object.freeze({ start: 26, period: 53, duration: 2.5, spacing: .24, travel: 9, base: -.65 }),
});

export function getMarineActivity(env = {}) {
  return unit(.12 + unit(env.daylight, 1) * .88 + unit(env.moonLight) * .48) *
    (1 - unit(env.storm) * .85) * (1 - unit(env.rain) * .3);
}

/** 每次活动只有一份种子和成员布局，姿态、锚点及声音共同使用。 */
export function createMarineTimeline(seed = 0) {
  const sceneSeed = finite(seed), whales = [], dolphins = [];
  const cacheLimit = 16;
  let whaleCycles = 0, dolphinCycles = 0, firstWhaleEnd, historyRebuilds = 0;
  const remember = (episodes, next) => {
    episodes.push(next);
    if (episodes.length > cacheLimit) episodes.shift();
  };
  const rand = (kind, cycle, salt) => random(sceneSeed * .371 + cycle * 191.17 + salt * 1.618 + (kind === 'whale' ? 701 : 1709));
  function episode(kind, cycle, start) {
    const schedule = MARINE_SCHEDULE[kind];
    const population = rand(kind, cycle, 3);
    const count = kind === 'whale' ? 1 : population < .48 ? 1 : population < .74 ? 2 : population < .9 ? 3 : 4;
    const spacing = kind === 'whale' ? 0 : .68 + rand(kind, cycle, 5) * .34;
    const lanes = [];
    const members = Array.from({ length: count }, (_, index) => {
      if (kind === 'whale') return Object.freeze({ lateral: 0, along: 0 });
      // Sample each animal once. Index order must not become a marching order,
      // and an individual must retain its arc throughout takeoff and landing.
      const memberRandom = salt => rand(kind, cycle, 101 + index * 97 + salt);
      let lateral = (memberRandom(1) - .5) * 14;
      const crowded = () => lanes.some(other => Math.abs(other - lateral) < 3.2);
      for (let attempt = 0; attempt < 32 && crowded(); attempt++) lateral = (memberRandom(23 + attempt * 23) - .5) * 14;
      if (crowded()) {
        const left = Math.min(...lanes) - 3.2, right = Math.max(...lanes) + 3.2;
        lateral = Math.abs(left) < Math.abs(right) ? left : right;
      }
      lanes.push(lateral);
      return Object.freeze({
        lateral,
        along: (memberRandom(3) - .5) * 7,
        delay: index === 0 ? 0 : .3 + memberRandom(5) * 2.2,
        duration: 2.1 + memberRandom(7) * .7,
        travel: 12 + memberRandom(11) * 4,
        leap: 4.4 + memberRandom(13) * 1.5,
        heading: (memberRandom(17) - .5) * .2,
        curve: (memberRandom(19) - .5) * 1.5,
      });
    });
    return Object.freeze({ ...schedule, kind, cycle, start, count, spacing,
      // The 5.8 m model must be wholly submerged before its instance appears
      // and after its last dive frame, even with the steepest endpoint pitch.
      base: kind === 'dolphin' ? -3.15 : schedule.base,
      end: kind === 'whale' ? start + schedule.duration
        : start + Math.max(...members.map(member => member.delay + member.duration)),
      placementSeed: rand(kind, cycle, 17) * 100000,
      activityThreshold: kind === 'whale' ? .42 + rand(kind, cycle, 19) * .38 : .30 + rand(kind, cycle, 19) * .44,
      members: Object.freeze(members) });
  }
  function ensureWhales(time) {
    while (!whales.length || whales.at(-1).start <= time) {
      const cycle = whaleCycles++;
      const start = cycle === 0 ? 7 + rand('whale', 0, 1) * 1.5
        : whales.at(-1).start + 34 + rand('whale', cycle, 1) * 7;
      const next = episode('whale', cycle, start);
      if (cycle === 0) firstWhaleEnd = next.end;
      remember(whales, next);
    }
  }
  function ensureDolphins(time) {
    ensureWhales(0);
    while (!dolphins.length || dolphins.at(-1).start <= time) {
      const cycle = dolphinCycles++;
      let start = cycle === 0 ? firstWhaleEnd + 2 + rand('dolphin', 0, 1) * 3
        : dolphins.at(-1).start + 12 + rand('dolphin', cycle, 1) * 7;
      let next = episode('dolphin', cycle, start);
      // Advance the two species together, even after a large seek. Generating
      // all future whales first would evict the old passes this pod must avoid.
      // This lookahead also includes the next pass after a collision shifts it.
      ensureWhales(next.end + 60);
      // Separate the complete group from whale passes, including the final
      // member's landing. Independent intervals can still give consecutive pods.
      for (const whale of whales) {
        if (whale.start - 1.8 >= next.end) break;
        if (next.start < whale.end + 1.8 && next.end > whale.start - 1.8) {
          start = whale.end + 2 + rand('dolphin', cycle, 7) * 2;
          next = episode('dolphin', cycle, start);
        }
      }
      remember(dolphins, next);
    }
  }
  return {
    // Snapshot-only diagnostics: no mutable cache or event array escapes.
    get stats() {
      return Object.freeze({ cachedWhales: whales.length, cachedDolphins: dolphins.length,
        whaleCycles, dolphinCycles, historyRebuilds });
    },
    getEpisode(kind, time) {
      if (!['whale', 'dolphin'].includes(kind) || !Number.isFinite(time) || time < 0) return null;
      const episodes = kind === 'whale' ? whales : dolphins;
      if (episodes[0]?.cycle > 0 && time < episodes[0].start) {
        // Rare old-time queries rebuild deterministically in bounded temporary
        // storage, leaving the live forward cache and its cycle counters intact.
        historyRebuilds++;
        return createMarineTimeline(sceneSeed).getEpisode(kind, time);
      }
      ensureDolphins(time); ensureWhales(time + 60);
      for (let index = episodes.length - 1; index >= 0; index--) if (episodes[index].start <= time) return episodes[index];
      return null;
    },
  };
}

export function createFishHabitat(heightAt, index = 0, seed = 0) {
  index = Math.max(0, Math.floor(finite(index)));
  const habitatSeed = finite(seed);
  const rand = salt => random(habitatSeed * .371 + salt * 1.618);
  const reef = index < 18;
  const school = reef ? Math.floor(index / 6) : 3 + Math.floor((index - 18) / 6);
  const angle = rand(school * 101 + 71) * TAU;
  const baseRadius = 85 + rand(school * 89 + 103) * 22;
  const offsetX = (rand(index + 901) - .5) * 3.6;
  const offsetZ = (rand(index + 1201) - .5) * 3.2;
  const firstMember = reef ? school * 6 : 18 + (school - 3) * 6;
  function schoolFloor(sx, sz) {
    let shallowest = -Infinity;
    // Select one centre for the complete school. Checking just this member
    // lets different fish retry to different coastlines around a new sand spit.
    for (let member = firstMember; member < firstMember + 6; member++) {
      const x = sx + (rand(member + 901) - .5) * 3.6;
      const z = sz + (rand(member + 1201) - .5) * 3.2;
      shallowest = Math.max(shallowest, sample(heightAt, x, z));
      if (shallowest >= -1.15) return shallowest;
      for (let step = 0; step < 12; step++) {
        const orbit = step / 12 * TAU;
        shallowest = Math.max(shallowest, sample(heightAt, x + Math.cos(orbit) * 4, z + Math.sin(orbit) * 2.5));
        if (shallowest >= -1.15) return shallowest;
      }
    }
    return shallowest;
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    let sx, sz;
    if (reef) {
      sx = 84 + (rand(school * 43 + attempt * 11 + 1) - .5) * 12;
      sz = 26 + (rand(school * 47 + attempt * 13 + 401) - .5) * 12;
      // 很少数未选中安全浅礁的种子仍保留同一观鱼区，再检查地形。
      if (attempt >= 24) { sx = 89.8; sz = 31.2; }
    } else {
      // The original azimuth remains the first choice. A connected lagoon or
      // other new shoreline can block its entire radial corridor; later tries
      // use fixed school/seed alternatives instead of pushing every fish onto land.
      const retry = Math.max(0, attempt - 12);
      const candidateAngle = attempt < 12 ? angle : angle + (rand(school * 211 + retry * 37 + 301) - .5) * TAU;
      const radius = attempt < 12 ? Math.min(115, baseRadius + attempt * 2.8)
        : 85 + rand(school * 193 + retry * 53 + 617) * 22;
      sx = Math.cos(candidateAngle) * radius;
      sz = Math.sin(candidateAngle) * radius;
    }
    const x = sx + offsetX;
    const z = sz + offsetZ;
    const shallowest = schoolFloor(sx, sz);
    if (shallowest < -1.15) {
      return { x, z, depth: clamp(.85 + rand(index + 1511) * 1.55, .65, Math.min(2.6, -shallowest - .35)),
        phase: (rand(school * 137 + 211) * TAU + (rand(index + 1439) - .5) * .6 + TAU) % TAU,
        seed: habitatSeed, school,
        rate: .17 + rand(school + 1777) * .045 + (rand(index + 1913) - .5) * .01,
        tailRate: 5 + rand(index + 2003) * 1.4 };
    }
  }
  return null;
}

export function getFishPose(time, index, home, heightAt, activity = 1) {
  if (!home) return { position: [0, -2, 0], heading: 0, pitch: 0, tail: 0, visible: false };
  const t = Math.max(0, finite(time));
  index = Math.max(0, Math.floor(finite(index)));
  const rate = clamp(finite(home.rate, .19 + index % 7 * .009), .12, .3);
  const phase = t * rate + home.phase;
  let x = home.x + Math.cos(phase) * 4;
  let z = home.z + Math.sin(phase) * 2.5;
  let floor = sample(heightAt, x, z);
  if (floor > -.95) {
    x = home.x; z = home.z; floor = sample(heightAt, x, z);
  }
  const depth = clamp(home.depth + Math.sin(t * .43 + home.phase) * .13, .6, Math.min(3, Math.max(.6, -floor - .3)));
  return {
    position: [x, -depth, z],
    heading: Math.atan2(-Math.sin(phase) * 4, Math.cos(phase) * 2.5),
    pitch: Math.cos(t * .43 + home.phase) * .055,
    tail: Math.sin(t * clamp(finite(home.tailRate, 5.2 + index % 5 * .23), 3.5, 7) + home.phase) * (.1 + unit(activity, 1) * .24),
    visible: floor < -.95,
  };
}

/** 连同身体长度和游动范围一起留出离岸余量，失败时不生成动物。 */
export function createMarineAnchor(heightAt, preferred = {}) {
  const baseX = finite(preferred.x, 118), baseZ = finite(preferred.z, 118);
  const length = Math.hypot(baseX, baseZ) || 1;
  const clearance = clamp(finite(preferred.clearance, 14), 14, 48);
  const minDepth = clamp(finite(preferred.minDepth, 5), 5, 24);
  for (let attempt = 0; attempt < 12; attempt++) {
    const x = baseX + baseX / length * attempt * 7;
    const z = baseZ + baseZ / length * attempt * 7;
    let safe = sample(heightAt, x, z) < -minDepth;
    for (let step = 0; step < 12 && safe; step++) {
      const angle = step / 12 * TAU;
      safe = sample(heightAt, x + Math.cos(angle) * clearance, z + Math.sin(angle) * clearance) < -(minDepth - 1.5);
    }
    if (safe) return { x, z, heading: finite(preferred.heading, -.55) };
  }
  return null;
}

export function getMarinePose(kind, index, time, anchor = { x: 118, z: 118, heading: -.55 }, episode = null) {
  const schedule = episode ?? MARINE_SCHEDULE[kind] ?? MARINE_SCHEDULE.dolphin;
  const member = episode?.members?.[index];
  const start = schedule.start + (member?.delay ?? Math.max(0, Math.floor(finite(index))) * schedule.spacing);
  const t = Math.max(0, finite(time));
  if (kind === 'dolphin' && episode && member) {
    const duration = member.duration, progress = unit((t - start) / duration);
    const along = (progress - .5) * member.travel;
    const lateral = member.curve * Math.sin(progress * Math.PI) ** 2;
    const heading = finite(anchor?.heading, -.55) + member.heading;
    const lateralVelocity = member.curve * Math.PI * Math.sin(progress * TAU);
    // Derive body direction from the same path as position. Keep the endpoint
    // tangent while submerged, so landing never snaps flat or turns backwards.
    return {
      position: [finite(anchor?.x, 118) + Math.sin(heading) * along + Math.cos(heading) * lateral,
        schedule.base + 4 * progress * (1 - progress) * member.leap,
        finite(anchor?.z, 118) + Math.cos(heading) * along - Math.sin(heading) * lateral],
      heading: heading + Math.atan2(lateralVelocity, member.travel),
      pitch: Math.atan2(4 * (1 - 2 * progress) * member.leap, Math.hypot(member.travel, lateralVelocity)),
      active: t >= start && t < start + duration && index < episode.count,
      progress,
    };
  }
  const age = t < start ? 0 : episode ? t - start : (t - start) % schedule.period;
  const active = t >= start && age < schedule.duration && (!episode || index < episode.count);
  const idle = episode ? 0 : t < start ? 1 : (age - schedule.duration) / (schedule.period - schedule.duration);
  const progress = active ? age / schedule.duration : t < start ? 0 : 1 - idle;
  const along = (progress - .5) * schedule.travel;
  const lateral = active ? Math.sin(progress * Math.PI) * .65 : t < start ? 0 : Math.sin(idle * TAU) * 2.2;
  const heading = finite(anchor?.heading, -.55);
  let y, pitch;
  if (active) {
    if (kind === 'whale') {
      // A breathing pass keeps the large body submerged. The broad back has
      // a sustained surface interval rather than a tiny instant at a sine peak.
      const breathing = smooth(progress, 0, .23) * (1 - smooth(progress, .73, 1));
      y = schedule.base + breathing * 3.05;
      pitch = Math.sin(progress * TAU) * .023;
    } else {
      const leap = kind === 'flying-fish' ? 1.8 : 4.4;
      y = schedule.base + 4 * progress * (1 - progress) * leap;
      pitch = Math.atan2(4 * (1 - 2 * progress) * leap, schedule.travel);
    }
  } else {
    y = schedule.base - (t < start ? 0 : Math.sin(idle * Math.PI) * 1.6);
    pitch = 0;
  }
  return {
    position: [finite(anchor?.x, 118) + Math.sin(heading) * along + Math.cos(heading) * lateral,
      y, finite(anchor?.z, 118) + Math.cos(heading) * along - Math.sin(heading) * lateral],
    heading: heading + (active || t < start ? 0 : Math.PI), pitch, active, progress: active ? progress : 0,
  };
}

/** 每个周期的阈值只发出一次；跳过后台停顿期间已经过去的旧声音。 */
export function createMarineEventTracker({ dolphins = 3, flyingFish = 6, timeline = null } = {}) {
  const rules = [
    { kind: 'whale', count: 1, triggers: [[.29, 'whale-blow', .85], [.88, 'splash', .55]] },
    { kind: 'dolphin', count: clamp(Math.floor(finite(dolphins, 3)), 0, 4), triggers: [[.14, 'dolphin', .44], [.87, 'splash', .48]] },
    { kind: 'flying-fish', count: clamp(Math.floor(finite(flyingFish, 6)), 0, 8), triggers: [[.19, 'flying-fish', .22], [.88, 'splash', .18]] },
  ];
  const emitted = new Map();
  let previous = null;
  return {
    collect(time, environment) {
      if (!Number.isFinite(time) || time < 0) return [];
      if (previous === null || time < previous) { previous = time; return []; }
      const maxGap = getAnimationRate(environment);
      if (timeline && time - previous > maxGap) { previous = time; return []; }
      const beginning = Math.max(previous, time - maxGap);
      previous = time;
      const events = [];
      for (const rule of rules) {
        const episode = timeline && rule.kind !== 'flying-fish' ? timeline.getEpisode(rule.kind, time) : null;
        if (timeline && rule.kind !== 'flying-fish' && !episode) continue;
        const schedule = episode ?? MARINE_SCHEDULE[rule.kind];
        for (let index = 0; index < Math.min(rule.count, episode?.count ?? rule.count); index++) {
          for (const [phase, type, strength] of rule.triggers) {
            const member = episode?.members?.[index];
            const start = schedule.start + (member?.delay ?? index * schedule.spacing) + phase * (member?.duration ?? schedule.duration);
            const cycle = episode?.cycle ?? Math.floor((time - start) / schedule.period);
            const eventTime = episode ? start : start + cycle * schedule.period;
            const key = `${rule.kind}:${index}:${type}`;
            if (cycle >= 0 && eventTime > beginning && eventTime <= time && cycle > (emitted.get(key) ?? -1)) {
              emitted.set(key, cycle);
              events.push({ kind: rule.kind, index, type, strength, time: eventTime, cycle });
            }
          }
        }
      }
      return events.sort((a, b) => a.time - b.time);
    },
  };
}
