const unit = (value, fallback = 0) => Number.isFinite(value)
  ? Math.max(0, Math.min(1, value)) : fallback;
const smooth = (value, low, high) => {
  const amount = unit((value - low) / (high - low));
  return amount * amount * (3 - 2 * amount);
};
const linear = hex => {
  const value = Number.parseInt(hex.slice(1), 16);
  return [value >> 16 & 255, value >> 8 & 255, value & 255].map(byte => {
    const channel = byte / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
};
const mix = (a, b, amount) => a.map((value, index) => value + (b[index] - value) * amount);
const colors = {
  sunWhite: linear('#fff4df'), sunGold: linear('#ffc568'), sunRed: linear('#ff421f'),
  horizonGold: linear('#f7b866'), horizonRed: linear('#e87553'), horizonRose: linear('#ae638c'),
  zenithGold: linear('#6b81ad'), zenithRed: linear('#785d9b'), zenithRose: linear('#635080'),
  cloudGold: linear('#ffc372'), cloudOrange: linear('#ff542a'), cloudEmber: linear('#ed674e'),
  cloudPeach: linear('#ff9874'), cloudRed: linear('#ff4034'), cloudRose: linear('#d6528b'),
  cloudShadow: linear('#625c87'), cloudShadowLate: linear('#524a78'),
};

/**
 * 共享晚霞驱动；sunHeight 是物理太阳方向的单位向量 y，而非镜头构图高度。
 * RGB 数组均为线性 sRGB，可直接 Color.fromArray；每次返回独立数组。
 * glow/strength、horizonMix、zenithMix 已含天气遮蔽。余晖独立于日盘
 * visibility，因此日盘沉落后仍保留火色，深夜归零后调用方保留原夜色。
 * discIntensity 是日盘辐亮度倍数；低空降亮度，避免 ACES 把朱红烧白。
 */
export function getSunsetState({ sunHeight, daylight, cloudiness = 0, rain = 0,
  snow = 0, fog = 0, storm = 0 } = {}) {
  const height = Number.isFinite(sunHeight) ? Math.max(-1, Math.min(1, sunHeight)) : 1;
  const light = unit(daylight);
  const lowSun = 1 - smooth(height, .08, .50);
  const redness = 1 - smooth(height, -.025, .40);
  const afterglow = 1 - smooth(height, -.075, .025);
  const cloudTransmission = 1 - smooth(unit(cloudiness), .35, .98);
  const transmission = cloudTransmission * (1 - unit(rain)) ** 2 * (1 - unit(snow)) ** 2
    * (1 - unit(fog)) ** 2 * (1 - unit(storm)) ** 2;
  const glow = (1 - smooth(height, .08, .55)) * smooth(light, .01, .10) * transmission;
  return {
    strength: glow, glow, horizonMix: glow * .90, zenithMix: glow * .78,
    redness, afterglow, transmission, discIntensity: 3.6 - redness * 2.5,
    sunColor: mix(mix(colors.sunWhite, colors.sunGold, lowSun), colors.sunRed, redness),
    horizonColor: mix(mix(colors.horizonGold, colors.horizonRed, redness), colors.horizonRose, afterglow),
    zenithColor: mix(mix(colors.zenithGold, colors.zenithRed, redness), colors.zenithRose, afterglow),
    cloudGold: mix(mix(colors.cloudGold, colors.cloudOrange, redness), colors.cloudEmber, afterglow),
    cloudRose: mix(mix(colors.cloudPeach, colors.cloudRed, redness), colors.cloudRose, afterglow),
    cloudShadow: mix(colors.cloudShadow, colors.cloudShadowLate, afterglow),
  };
}
