const unit = (value, fallback = 0) => Number.isFinite(value)
  ? Math.max(0, Math.min(1, value)) : fallback;
const smooth = (value, low, high) => {
  const t = unit((value - low) / (high - low));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, amount) => a.map((value, index) => value + (b[index] - value) * amount);
const linear = hex => {
  const value = Number.parseInt(hex.slice(1), 16);
  return [value >> 16 & 255, value >> 8 & 255, value & 255].map(byte => {
    const channel = byte / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
};
const palette = {
  below: linear('#142338'), moonBelow: linear('#2c4255'),
  horizon: linear('#142b43'), moonHorizon: linear('#344c62'), haze: linear('#202f42'),
};
const fract = value => value - Math.floor(value);
const hash = (x, y) => {
  let a = fract(x * .1031), b = fract(y * .1031), c = fract(x * .1031);
  const dot = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += dot; b += dot; c += dot;
  return fract((a + b) * c);
};
const noise = (x, y) => {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = fract(x), fy = fract(y), u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
};
const direction = ray => {
  const values = Array.isArray(ray) || ArrayBuffer.isView(ray) ? [ray[0], ray[1], ray[2]]
    : [ray?.x, ray?.y, ray?.z];
  if (!values.every(Number.isFinite)) return [0, 1, 0];
  const length = Math.hypot(...values);
  return length > 1e-8 && Number.isFinite(length) ? values.map(value => value / length) : [0, 1, 0];
};
const directionalNoise = (ray, time) => {
  const [x, , z] = direction(ray), length = Math.hypot(x, z);
  const hx = length > 1e-8 ? x / length : 1, hz = length > 1e-8 ? z / length : 0;
  const t = Number.isFinite(time) ? Math.max(0, Math.min(1e9, time)) : 0;
  const px = hx * 3.7 + t * .005, pz = hz * 3.7 - t * .007;
  return noise(px, pz) * .65 + noise(px * 2.03 + 11.7, pz * 2.03 + 37.3) * .35;
};

/**
 * 天空与远海共享的线性 sRGB 目标。night 仅由深夜门控，月相改变颜色，
 * 因而新月也能接平。daylight > .01 时完全关闭，与晚霞余晖互斥。
 * 色彩沿用天空真正 y=0 的 below/horizon 混色，雷暴暗化已计算一次。
 * 本函数无时间/随机状态；调用方把同一结果放在 env.seaHorizon 即可。
 */
export function getSeaHorizonState(input = {}) {
  const env = input && typeof input === 'object' ? input : {};
  const daylight = unit(env.daylight, 1), cloud = unit(env.cloudiness, .12), fog = unit(env.fog);
  const rain = unit(env.rain), snow = unit(env.snow), storm = unit(env.storm);
  const moon = unit(env.moonLight) * (1 - cloud * .78) * (1 - fog * .75)
    * (1 - rain * .15) * (1 - snow * .12) * (1 - daylight);
  const below = mix(palette.below, palette.moonBelow, moon);
  const horizon = mix(palette.horizon, palette.moonHorizon, moon);
  const base = mix(below, horizon, smooth(0, -.045, .04));
  const haze = smooth(cloud, .35, .95) * .05 + fog * .10 + rain * .035 + snow * .05;
  return {
    night: 1 - smooth(daylight, 0, .01),
    color: mix(base, palette.haze, haze).map(value => value * (1 - storm * .42)),
    weather: unit(fog * .55 + rain * .20 + snow * .14 + cloud * .15 + storm * .24),
    cloudCover: unit(env.skyCloudCover, cloud),
  };
}

/** ray 可为数组/Vector3；返回独立色彩，skyWeight 只影响窄地平线带。 */
export function getSeaHorizonSample(ray, time = 0, state = getSeaHorizonState()) {
  const n = directionalNoise(ray, time), weather = unit(state?.weather), cloud = unit(state?.cloudCover);
  const width = (.042 + weather * .018) * (.78 + n * .44);
  const gain = 1 + (n - .5) * (.035 + cloud * .025);
  const color = Array.isArray(state?.color) && state.color.length === 3 && state.color.every(Number.isFinite)
    ? state.color.map(value => Math.max(0, value) * gain) : getSeaHorizonState().color;
  const height = Math.abs(direction(ray)[1]);
  return { color, width, skyWeight: unit(state?.night) * Math.exp(-height / width)
    * (1 - smooth(height, .08, .16)) };
}

/** 160m 内不加夜雾；远距趋 night。低空雾的宽度、远海密度沿方位缓慢变化。 */
export function getSeaHorizonOceanWeight(distance, ray, time = 0, state = getSeaHorizonState()) {
  const far = Number.isFinite(distance) ? Math.max(0, distance - 160) : 0;
  const density = (.00092 + unit(state?.weather) * .00020) * (.84 + directionalNoise(ray, time) * .32);
  return unit(state?.night) * (1 - Math.exp(-far * density));
}

/**
 * 与 CPU sampler 相同的窄带/微雾数学；所有噪声仅由 ray.xz 与真实秒数驱动，
 * 不移动海平面、不按 atan 分区，因此绕一周没有接缝。Color 已含一次 storm。
 */
export const SEA_HORIZON_GLSL = /* glsl */`
  uniform float uSeaHorizonNight;
  uniform vec3 uSeaHorizonColor;
  uniform float uSeaHorizonTime;
  uniform float uSeaHorizonWeather;
  uniform float uSeaHorizonCloudCover;
  vec3 seaHorizonDirection(vec3 ray) {
    float len2 = dot(ray, ray);
    return len2 > 0.000000000001 ? ray * inversesqrt(len2) : vec3(0.0, 1.0, 0.0);
  }
  float seaHorizonHash(vec2 p) {
    vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float seaHorizonValueNoise(vec2 p) {
    vec2 cell = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(seaHorizonHash(cell), seaHorizonHash(cell + vec2(1.0, 0.0)), u.x),
      mix(seaHorizonHash(cell + vec2(0.0, 1.0)), seaHorizonHash(cell + vec2(1.0)), u.x), u.y);
  }
  float seaHorizonNoise(vec3 ray) {
    vec2 horizontal = seaHorizonDirection(ray).xz;
    float len = length(horizontal);
    horizontal = len > 0.000001 ? horizontal / len : vec2(1.0, 0.0);
    float time = clamp(uSeaHorizonTime, 0.0, 1000000000.0);
    vec2 p = horizontal * 3.7 + time * vec2(0.005, -0.007);
    return seaHorizonValueNoise(p) * 0.65
      + seaHorizonValueNoise(p * 2.03 + vec2(11.7, 37.3)) * 0.35;
  }
  vec3 seaHorizonRadiance(vec3 ray) {
    float gain = 1.0 + (seaHorizonNoise(ray) - 0.5)
      * (0.035 + clamp(uSeaHorizonCloudCover, 0.0, 1.0) * 0.025);
    return uSeaHorizonColor * gain;
  }
  float seaHorizonSkyWeight(vec3 ray) {
    float height = abs(seaHorizonDirection(ray).y);
    float width = (0.042 + clamp(uSeaHorizonWeather, 0.0, 1.0) * 0.018)
      * (0.78 + seaHorizonNoise(ray) * 0.44);
    return clamp(uSeaHorizonNight, 0.0, 1.0) * exp(-height / width)
      * (1.0 - smoothstep(0.08, 0.16, height));
  }
  float seaHorizonOceanWeight(vec3 ray, float distanceToCamera) {
    float density = (0.00092 + clamp(uSeaHorizonWeather, 0.0, 1.0) * 0.00020)
      * (0.84 + seaHorizonNoise(ray) * 0.32);
    return clamp(uSeaHorizonNight, 0.0, 1.0)
      * (1.0 - exp(-max(distanceToCamera - 160.0, 0.0) * density));
  }
`;
