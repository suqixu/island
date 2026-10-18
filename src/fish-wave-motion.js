import config from './config/fish-wave.json' with { type: 'json' };
import { getAnimationRate } from './animation-time.js';

/** Observation time excludes pauses/background gaps and keeps events at real-time scale. */
export function createFishWaveState({ random = Math.random } = {}) {
  const wait = range => range.min + random() * range.range;
  let phase = 'idle', age = 0, lastTime, observed = 0, nextAt = wait(config.initialWaitSeconds);
  let wet = false, afterRain = 0, cycle = 0;
  function cancel() {
    if (phase !== 'idle') nextAt = observed + wait(config.cooldownSeconds);
    phase = 'idle'; age = 0;
  }
  function update(time, env = {}) {
    if (!Number.isFinite(time)) return;
    const step = lastTime === undefined ? 0 : (time - lastTime) / getAnimationRate(env);
    lastTime = time;
    if (step < 0 || step > 1) { cancel(); return; }
    observed += step;
    const raining = (env.rain ?? 0) > .2;
    if (wet && !raining) afterRain = config.afterRainSeconds;
    wet = raining; afterRain = Math.max(0, afterRain - step);
    const calm = (env.rain ?? 0) < .15 && (env.snow ?? 0) < .1
      && (env.storm ?? 0) < .15 && (env.fog ?? 0) < .5 && (env.windSpeed ?? 0) < 18
      && !(env.typhoon > 0 || env.blizzard > 0 || ['typhoon', 'blizzard'].includes(env.weather))
      && !env.eclipse?.active;
    if (!calm) { cancel(); return; }
    if (phase === 'idle') {
      const inHours = range => env.hour >= range[0] && env.hour <= range[1];
      if ((env.daylight ?? 0) <= .2 || observed < nextAt || !(inHours(config.morningHours) || inHours(config.eveningHours) || afterRain > 0)) return;
      phase = 'gather'; age = 0; cycle++;
      return;
    }
    age += step;
    if (age >= config.durationSeconds) { cancel(); return; }
    phase = age < config.gatherSeconds ? 'gather'
      : age < config.durationSeconds - config.fadeSeconds ? 'burst' : 'fade';
  }
  return { update, cancel, get phase() { return phase; }, get age() { return age; }, get cycle() { return cycle; } };
}

const fract = value => value - Math.floor(value);
const smooth = value => { const v = Math.max(0, Math.min(1, value)); return v * v * (3 - 2 * v); };
export const fishWaveRandom = seed => fract(Math.sin(seed * 127.1 + 31.7) * 43758.5453);

/** Reuse one output per frame. Sparse leaders precede a travelling, staggered front. */
export function getFishWavePose(age, member, out = {}) {
  const { x, z, phase, speed, height, delay } = member;
  const burstEnd = config.durationSeconds - config.fadeSeconds;
  const front = config.gatherSeconds + (x + .5) * (burstEnd - config.gatherSeconds - 4) + delay;
  const first = member.leader ? 1.4 + phase * 1.5 : front;
  const jumpAge = age - first;
  const period = 3.2 + phase * 2, flight = .75 + height * .16;
  const turn = Math.floor(jumpAge / period), t = jumpAge - turn * period;
  const cutoff = burstEnd + 1 + phase;
  // A flight already in progress completes before the school submerges.
  const jumping = jumpAge >= 0 && first + turn * period < cutoff && t < flight;
  const p = t / flight;
  const depth = -.8 - phase * 1.8;
  const sink = Math.max(0, age - (config.durationSeconds - 2)) * .9;
  let y = depth;
  if (jumping) y = 4 * height * p * (1 - p) - .18;
  else if (jumpAge < 0) y = depth + (-.18 - depth) * smooth((jumpAge + .65) / .65);
  else if (first + turn * period < cutoff) {
    y = -.18 + (depth + .18) * smooth((t - flight) / .65);
    if (first + (turn + 1) * period < cutoff) y += (-.18 - depth) * smooth((t - period + .65) / .65);
  }
  const completed = Math.max(0, Math.ceil((cutoff - first) / period));
  const travel = jumpAge < 0 ? 0 : Math.min(completed, Math.max(0, turn) + Math.min(1, p)) * speed;
  out.x = x * member.span + age * .55 + Math.sin(age * .8 + phase * 6.28) * .4;
  out.z = z * 15 + age * .28 + travel;
  out.y = y - sink;
  out.pitch = jumping ? Math.atan2(4 * height * (1 - 2 * p), speed) : Math.cos(age + phase * 6.28) * .04;
  out.roll = Math.sin(age * 5 + phase * 20) * (jumping ? .4 : .12);
  out.jumping = jumping; out.landing = jumpAge >= 0 && first + turn * period < cutoff && t >= flight && t < flight + 1.6 && age < config.durationSeconds - 1;
  out.waterAge = out.landing ? t - flight : -1;
  // Water effects use the landing location throughout their lifetime.
  out.landingZ = z * 15 + (age - Math.max(0, out.waterAge)) * .28 + (turn + 1) * speed;
  return out;
}
