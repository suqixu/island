const rotation = -33 * Math.PI / 180;
const c = Math.cos(rotation), s = Math.sin(rotation);
const mouthU = 25 * Math.cos(75 * Math.PI / 180), mouthV = 18 * Math.sin(75 * Math.PI / 180);
const mouthLength = Math.hypot(mouthU, mouthV);
const directionU = mouthU / mouthLength, directionV = mouthV / mouthLength;
const smooth = (low, high, value) => {
  const amount = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return amount * amount * (3 - 2 * amount);
};

export const LAGOON_LAYOUT = Object.freeze({
  center: Object.freeze([50, 75]),
  axes: Object.freeze([25, 18]),
  rotation,
  influenceRadius: 1.62,
  mouthDirection: Object.freeze([directionU, directionV]),
  mouthWidth: 10,
  view: Object.freeze({ position: Object.freeze([125, 38, 148]), target: Object.freeze([50, -1, 75]) }),
});

function shapeAt(x, z, mainShoreDistance) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || mainShoreDistance >= 4) return null;
  const dx = x - 50, dz = z - 75;
  if (Math.abs(dx) > 38 || Math.abs(dz) > 34) return null;
  const u = c * dx + s * dz, v = -s * dx + c * dz;
  const radius = Math.hypot(u / 25, v / 18);
  if (radius >= LAGOON_LAYOUT.influenceRadius) return null;
  const inlandGuard = Number.isFinite(mainShoreDistance) ? 1 - smooth(1, 4, mainShoreDistance) : 1;
  const mask = (1 - smooth(1.34, LAGOON_LAYOUT.influenceRadius, radius)) * inlandGuard;
  const alongMouth = u * directionU + v * directionV;
  const acrossMouth = u * directionV - v * directionU;
  const channel = smooth(5, 12, alongMouth) * (1 - smooth(5, 8, Math.abs(acrossMouth)));
  // Broad bends keep a connected spit while avoiding a mirrored oval bank.
  const angle = Math.atan2(v / 18, u / 25);
  const crestRadius = 1.09 + Math.sin(angle * 2 + .6) * .048
    + Math.sin(angle * 3 - 1.2) * .032 + Math.sin(angle * 5 + .35) * .018;
  const bankWidth = .17 * (1 + Math.sin(angle - .35) * .18);
  const ridge = Math.exp(-(((radius - crestRadius) / bankWidth) ** 2)) * (1 - channel);
  return { u, v, radius, mask, ridge, crestRadius, bankWidth, channel };
}

/** Optional main-shore distance makes this mask exactly match height blending. */
export function getLagoonMask(x, z, mainShoreDistance) {
  return shapeAt(x, z, mainShoreDistance)?.mask ?? 0;
}

/** Sand on the dry crescent and its underwater sloping shoulders. */
export function isLagoonSandAt(x, z, mainShoreDistance) {
  const shape = shapeAt(x, z, mainShoreDistance);
  return Boolean(shape && shape.mask > .02 && shape.ridge > .38);
}

/** The same sand arms shelter the basin; the open mouth passes ocean swell. */
export function getLagoonShelter(x, z) {
  const shape = shapeAt(x, z);
  if (!shape) return 0;
  const { radius, crestRadius, bankWidth, channel } = shape;
  const interior = 1 - smooth(crestRadius - bankWidth * .2, crestRadius + bankWidth * .65, radius);
  return interior * (1 - channel);
}

/** Merge a shallow basin and connected sand spit into the same real sea floor. */
export function applyLagoonHeight(x, z, originalHeight, mainShoreDistance) {
  const shape = shapeAt(x, z, mainShoreDistance);
  if (!shape || shape.mask === 0) return originalHeight;
  const { u, v, radius, mask, ridge } = shape;
  const bed = -3.1 + smooth(.15, 1.18, radius) * 1.35
    + Math.sin(u * .23 + v * .11) * .12 + Math.sin(v * .3 - .4) * .08;
  const crest = .8 + Math.sin(u * .105 + .4) * Math.cos(v * .16) * .22;
  const lagoonHeight = bed + (crest - bed) * ridge;
  return originalHeight + (lagoonHeight - originalHeight) * mask;
}
