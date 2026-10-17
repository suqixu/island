export const LUNAR_CYCLE_DAYS = 29.53059;

export const MOON_PHASES = [
  { name: '新月', phase: 0 },
  { name: '娥眉月', phase: .125 },
  { name: '上弦月', phase: .25 },
  { name: '盈凸月', phase: .375 },
  { name: '满月', phase: .5 },
  { name: '亏凸月', phase: .625 },
  { name: '下弦月', phase: .75 },
  { name: '残月', phase: .875 },
];

/** 夕阳落完后月亮才随暮色显现，黎明以同样的曲线淡出。 */
export function getMoonNightVisibility(daylight) {
  const light = Math.max(0, Math.min(1, Number.isFinite(daylight) ? daylight : 1));
  const transition = Math.max(0, Math.min(1, (light - .04) / .13));
  return 1 - transition * transition * (3 - 2 * transition);
}

export function getMoonState(lunarDay) {
  const day = Number.isFinite(lunarDay) ? lunarDay : 0;
  let moonAge = ((day % LUNAR_CYCLE_DAYS) + LUNAR_CYCLE_DAYS) % LUNAR_CYCLE_DAYS;
  // 浮点数计算整周期时可能停在周期末端，统一回到新月。
  if (moonAge < 1e-10 || LUNAR_CYCLE_DAYS - moonAge < 1e-10) moonAge = 0;
  const moonPhase = moonAge / LUNAR_CYCLE_DAYS;
  const moonIllumination = (1 - Math.cos(moonPhase * Math.PI * 2)) / 2;
  const moonPhaseName = MOON_PHASES[Math.round(moonPhase * 8) % 8].name;
  return { moonPhase, moonIllumination, moonPhaseName, moonAge };
}
