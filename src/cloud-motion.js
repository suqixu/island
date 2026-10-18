import { getAnimationDelta } from './animation-time.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const unit = (value, fallback = 0) => Number.isFinite(value) ? clamp(value, 0, 1) : fallback;
const defaultAngle = Math.atan2(.55, .83);

export function createCloudMotionState() {
  return { lastTime: null, angle: defaultAngle, speed: 5, offset: [0, 0] };
}

/** 累计真实秒驱动；风速为米/秒。暂停小时或改变倍速不影响云场。 */
export function advanceCloudMotion(state, elapsed, env = {}, output) {
  const suppliedTime = Number.isFinite(elapsed) ? Math.max(0, elapsed) : state.lastTime ?? 0;
  const now = Math.max(suppliedTime, state.lastTime ?? suppliedTime);
  const first = state.lastTime === null;
  // A resumed or externally scrubbed elapsed clock never teleports the field.
  const delta = first ? 0 : getAnimationDelta(now - state.lastTime, .25, env);
  state.lastTime = now;
  env ??= {};
  const typhoon = unit(env.typhoon, env.weather === 'typhoon' ? 1 : 0);
  const windSpeed = Number.isFinite(env.windSpeed) ? clamp(env.windSpeed, 0, 22 + typhoon * 38)
    : 1.5 + unit(env.wind, .22) * 19.5;
  const targetSpeed = clamp(2 + windSpeed * .42 + unit(env.gust) * .65, 2, 9)
    + typhoon * (20 + windSpeed * .48 + unit(env.gust) * 8);
  const direction = env.windDirection;
  const x = Array.isArray(direction) ? direction[0] : direction?.x;
  const z = Array.isArray(direction) ? direction[1] : direction?.y;
  const targetAngle = Number.isFinite(x) && Number.isFinite(z) && Math.hypot(x, z) > .001
    ? Math.atan2(z, x) : state.angle;
  if (first) {
    state.speed = targetSpeed;
    state.angle = targetAngle;
  } else {
    state.speed += (targetSpeed - state.speed) * (1 - Math.exp(-delta * .35));
    const turn = Math.atan2(Math.sin(targetAngle - state.angle), Math.cos(targetAngle - state.angle));
    state.angle += turn * (1 - Math.exp(-delta * .30));
  }
  const result = output ?? { direction: [0, 0], offset: [0, 0] };
  const unitDirection = result.direction;
  unitDirection[0] = Math.cos(state.angle);
  unitDirection[1] = Math.sin(state.angle);
  state.offset[0] += unitDirection[0] * state.speed * delta;
  state.offset[1] += unitDirection[1] * state.speed * delta;
  result.delta = delta;
  result.speed = state.speed;
  result.offset[0] = state.offset[0];
  result.offset[1] = state.offset[1];
  return result;
}

/** 高层云快、低云慢，台风突破普通云速上限；个体差异保持固定。 */
export function getCloudLayerSpeed(speed, { height = 280, thin = false, variation = .5 } = {}, typhoon = 0) {
  const maximum = 9 + unit(typhoon) * 63;
  const base = Number.isFinite(speed) ? clamp(speed, 2, maximum) : 5;
  const altitude = Number.isFinite(height) ? unit((height - 175) / 230) : .5;
  const layer = .90 + altitude * .16 + (thin ? .12 : 0);
  const individual = .84 + unit(variation, .5) * .32;
  return clamp(base * layer * individual, 2, maximum);
}
