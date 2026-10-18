const ABSORPTION = .24, FADE_START = 6, FADE_END = 12;
const SHELF_START = .62, SHELF_END = .96;
const smooth = (a, b, value) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Keep clear shallow water, then hide the finite seabed below deeper water. */
export function getSeabedTransmission(opticalDepth) {
  const depth = Math.max(0, opticalDepth);
  return Math.exp(-depth * ABSORPTION) * (1 - smooth(FADE_START, FADE_END, depth));
}

// Fade within the inscribed circle, before any side of the square lookup ends.
// Using max(abs(x),abs(z)) here would merely soften the same square outline.
export function getOffshoreBlend(x, z, extent = 240) {
  return smooth(SHELF_START, SHELF_END, Math.hypot(x, z) / extent);
}

export function getOffshoreFloorHeight(height, x, z, extent = 240) {
  const blend = getOffshoreBlend(x, z, extent);
  return height * (1 - blend) - 80 * blend;
}

export const OFFSHORE_BLEND_GLSL = /* glsl */ `
  float offshoreBlend(vec2 point, float extent) {
    return smoothstep(${SHELF_START.toFixed(2)}, ${SHELF_END.toFixed(2)}, length(point) / extent);
  }
`;

// The shader and numerical counterpart share their physical depth thresholds.
export const SEABED_TRANSMISSION_GLSL = /* glsl */ `
  float seabedTransmission(float opticalDepth) {
    float depth = max(0.0, opticalDepth);
    return exp(-depth * ${ABSORPTION.toFixed(2)})
      * (1.0 - smoothstep(${FADE_START.toFixed(1)}, ${FADE_END.toFixed(1)}, depth));
  }
`;
