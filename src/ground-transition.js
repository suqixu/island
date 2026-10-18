const MIN_DARKENING = .08, MAX_DARKENING = .14;
const clamp = value => Math.max(0, Math.min(1, value));

/** Preserve the existing grass/sand hue instead of painting dark soil over it. */
export function getSoilTransitionFactor(coverage, grain = .5) {
  return 1 - clamp(coverage) * (MAX_DARKENING - (MAX_DARKENING - MIN_DARKENING) * clamp(grain));
}

export const SOIL_TRANSITION_GLSL = /* glsl */ `
  float soilTransitionFactor(float coverage, float grain) {
    return 1.0 - clamp(coverage, 0.0, 1.0)
      * (${MAX_DARKENING.toFixed(2)} - ${(MAX_DARKENING - MIN_DARKENING).toFixed(2)} * clamp(grain, 0.0, 1.0));
  }
`;
