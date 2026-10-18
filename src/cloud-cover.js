import { getAnimationDelta } from './animation-time.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const unit = (value, fallback = 0) => Number.isFinite(value) ? clamp(value, 0, 1) : fallback;
const WEATHER_FLOORS = Object.freeze({ sunny: 0, cloudy: .72, rain: .84, storm: .96, snow: .78, fog: .18 });
const ease = value => {
  const t = unit(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

function randomAt(seed, index, channel) {
  let bits = Math.imul(seed, 0x27d4eb2d) ^ Math.imul(index, 0x45d9f3b) ^ Math.imul(channel, 0x165667b1);
  bits = Math.imul(bits ^ (bits >>> 16), 0x45d9f3b);
  bits = Math.imul(bits ^ (bits >>> 16), 0x45d9f3b);
  return ((bits ^ (bits >>> 16)) >>> 0) / 4294967296;
}

function phaseTarget(state) {
  const busy = (state.phase + state.busyFirst) % 2 === 1;
  return busy ? .90 + randomAt(state.seed, state.phase, 2) * .10 : 0;
}

function weatherFloor(env) {
  const floor = typeof env.weather === 'string' && Object.hasOwn(WEATHER_FLOORS, env.weather)
    ? WEATHER_FLOORS[env.weather] : 0;
  return Math.max(floor, unit((unit(env.cloudiness) - .45) / .45) * .75,
    unit(env.rain) * .84, unit(env.storm) * .96, unit(env.snow) * .78);
}

/** 只在创建时选随机种子；同种子与真实时间步序可重现视觉云量。 */
export function createCloudCoverState(seed = Math.floor(Math.random() * 4294967296)) {
  const normalized = Number.isFinite(seed) ? Math.trunc(seed * 104729) >>> 0 : 0;
  const state = { seed: normalized, lastTime: null, phase: 0, age: 0,
    duration: 30 + randomAt(normalized, 0, 1) * 70,
    busyFirst: randomAt(normalized, 0, 3) < .5 ? 0 : 1,
    from: .18 + randomAt(normalized, 0, 4) * .48, target: 0, floor: 0, coverage: 0 };
  state.target = phaseTarget(state); state.coverage = state.from;
  return state;
}

/** 返回 {coverage:0..1}，不修改天气、照明或降水字段。时间为累计真实秒。 */
export function advanceCloudCover(state, elapsed, env = {}) {
  const supplied = Number.isFinite(elapsed) ? Math.max(0, elapsed) : state.lastTime ?? 0;
  const now = Math.max(supplied, state.lastTime ?? supplied);
  const first = state.lastTime === null;
  // 正常帧完全采用真实秒；外部大幅改写 elapsed 时不追赶成瞬间换天。
  const delta = first ? 0 : getAnimationDelta(now - state.lastTime, 1, env);
  state.lastTime = now; state.age += delta;
  while (state.age >= state.duration) {
    state.age -= state.duration; state.from = state.target; state.phase++;
    state.duration = 30 + randomAt(state.seed, state.phase, 1) * 70;
    state.target = phaseTarget(state);
  }
  const floor = weatherFloor(env ?? {});
  state.floor += (floor - state.floor) * (first ? 1 : 1 - Math.exp(-delta * .7));
  // 每个30–100秒阶段只用前12秒过渡，晴空/大片云平台均至少18秒。
  const natural = state.from + (state.target - state.from) * ease(state.age / 12);
  const normal=unit(state.floor + (1 - state.floor) * natural);
  if(Number.isFinite(env?.cloudCoverTarget)) {
    state.manualCoverage=true;
    state.coverage += (unit(env.cloudCoverTarget)-state.coverage)*(first?1:1-Math.exp(-delta*.7));
  } else if(state.manualCoverage) {
    state.coverage += (normal-state.coverage)*(first?1:1-Math.exp(-delta*.7));
    if(Math.abs(normal-state.coverage)<.005)state.manualCoverage=false;
  } else state.coverage=normal;
  return { coverage: state.coverage };
}

/** Explicit instant preview: clear the separate visual cloud history while
 * keeping its seed and resuming the normal clear/busy cycle after this phase.
 */
export function clearCloudCoverForPreview(state,elapsed){
  state.phase=state.busyFirst===1?1:0;state.age=0;
  state.duration=30+randomAt(state.seed,state.phase,1)*70;
  state.from=state.target=state.floor=state.coverage=0;
  state.lastTime=Number.isFinite(elapsed)?Math.max(0,elapsed):state.lastTime??0;
}
