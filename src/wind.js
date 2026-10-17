const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function randomAt(index, seed, channel) {
  let bits = Math.imul(index | 0, 0x45d9f3b) ^ Math.imul(seed | 0, 0x27d4eb2d) ^ Math.imul(channel, 0x165667b1);
  bits = Math.imul(bits ^ (bits >>> 16), 0x45d9f3b);
  bits = Math.imul(bits ^ (bits >>> 16), 0x45d9f3b);
  return ((bits ^ (bits >>> 16)) >>> 0) / 4294967295;
}

function smoothRandom(time, seed, channel) {
  const index = Math.floor(time), fraction = time - index;
  const blend = fraction * fraction * fraction * (fraction * (fraction * 6 - 15) + 10);
  const a = randomAt(index, seed, channel), b = randomAt(index + 1, seed, channel);
  return a + (b - a) * blend;
}

/** Independent real-time gusts, broad swell groups and slowly turning wind. */
export function getWindState(time = 0, baseWind = .22, seed = 0) {
  time = Number.isFinite(time) ? Math.max(0, time) : 0;
  baseWind = Number.isFinite(baseWind) ? clamp(baseWind, 0, 1) : .22;
  seed = Number.isFinite(seed) ? seed : 0;
  const prevailing = smoothRandom(time / 38, seed, 1);
  const gust = Math.pow(smoothRandom(time / 6.5, seed, 2), 2);
  const wind = clamp(baseWind * (.72 + prevailing * .70) + .045 + gust * (.12 + baseWind * .12), .035, 1);
  const angle = Math.atan2(.55, .83) + (smoothRandom(time / 62, seed, 3) - .5) * .92
    + (smoothRandom(time / 145, seed, 4) - .5) * .64;
  const swell = .25 + smoothRandom(time / 16, seed, 5) * .45 + smoothRandom(time / 31, seed, 6) * .30;
  return { wind, windSpeed: 1.5 + wind * 19.5, gust, swell, windDirection: [Math.cos(angle), Math.sin(angle)] };
}
