// The western shoulder keeps the existing summit and ridge trail unobstructed.
export const LIGHTHOUSE_SITE = Object.freeze({
  position: Object.freeze({ x: -21.8, z: -7 }),
  doorDirection: Object.freeze({ x: .963094, z: -.269159 }),
  approach: Object.freeze({ x: -16.953125, y: 49.8199425455, z: -8.3546875 }),
  reservedRadius: 2.55,
});

export function isLighthouseReserved(x, z, padding = 0) {
  const radius = LIGHTHOUSE_SITE.reservedRadius + Math.max(0, Number.isFinite(padding) ? padding : 0);
  return Math.hypot(x - LIGHTHOUSE_SITE.position.x, z - LIGHTHOUSE_SITE.position.z) <= radius;
}
