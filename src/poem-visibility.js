const clamp01 = value => Math.min(1, Math.max(0, value));
const smoothstep = (low, high, value) => {
  const t = clamp01((value - low) / (high - low));
  return t * t * (3 - 2 * t);
};

/** 根据月光与实际渲染的月盘可见度返回诗意字幕的可见度。 */
export function getPoemVisibility(env) {
  if (!env || !['daylight', 'moonLight', 'moonAltitude', 'moonIllumination', 'cloudiness', 'fog']
    .every(key => Number.isFinite(env[key]))) return 0;
  if (env.moonInFrame !== true || env.moonAltitude <= 0 || env.moonIllumination < .99) return 0;
  if (env.moonDiscOpacity !== undefined && !Number.isFinite(env.moonDiscOpacity)) return 0;

  const night = 1 - clamp01(env.daylight);
  const moonLight = clamp01(env.moonLight);
  const cloudiness = clamp01(env.cloudiness);
  const fog = clamp01(env.fog);
  const strength = night * moonLight * (1 - cloudiness * .9) * (1 - fog);
  // 运行时跟随月盘的实际透明度，多云但明月清晰时仍显示诗句。
  // 未传入渲染状态时保留环境遮蔽规则。
  const clearClouds = 1 - smoothstep(.6, .75, cloudiness);
  const moonDisc = env.moonDiscOpacity === undefined
    ? clearClouds : smoothstep(.10, .22, env.moonDiscOpacity);
  const clearFog = 1 - smoothstep(.35, .7, fog);
  return smoothstep(.055, .13, strength) * moonDisc * clearFog;
}
