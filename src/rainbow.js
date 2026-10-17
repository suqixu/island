// Fit both bows above the real horizon; their lower ends disappear in sea mist.
export function getRainbowFraming({ width, height, horizonPixels, fov }) {
  const hidden = { visible: false, radius: 0, width: 0, radiusPixels: 0, dropPixels: 0, depression: 0 };
  if (![width, height, horizonPixels, fov].every(Number.isFinite)
      || width <= 0 || height <= 0 || fov <= 0 || fov >= 150) return hidden;
  const sky = Math.min(horizonPixels, height + 100) - 80;
  const radiusPixels = Math.min(width * .48, sky * 1.65);
  if (radiusPixels < 36) return hidden;
  const scale = 2 * Math.tan(fov * Math.PI / 360) / height;
  // Lower the centre when sky is shallow: a broad offshore arc, rather than
  // shrinking the entire rainbow into a small badge above the island.
  const radius = Math.atan(radiusPixels * scale);
  const dropPixels = Math.max(radiusPixels * .23, radiusPixels * 1.21 - sky * .94);
  return { visible: true, radius, width: radius * .095, radiusPixels, dropPixels,
    depression: Math.atan(dropPixels * scale) };
}

export function createRainbowAppearance(random = Math.random) {
  let previousEvent = null, secondary = 0;
  return { update(event) {
    if (Number.isFinite(event) && event !== previousEvent) {
      previousEvent = event;
      secondary = random() < .5 ? .52 : 0;
    }
    return secondary;
  } };
}

export const RAINBOW_GLSL = /* glsl */ `
  float rainbowGaussian(float x, float spread) {
    float offset = x / spread;
    return exp(-offset * offset);
  }
  vec3 rainbowSpectrum(float position) {
    // Overlapping scattering lobes avoid hard seven-colour stripes.
    return vec3(0.42, 0.08, 0.68) * rainbowGaussian(position - 0.06, 0.16)
      + vec3(0.09, 0.20, 0.90) * rainbowGaussian(position - 0.23, 0.15)
      + vec3(0.03, 0.62, 0.78) * rainbowGaussian(position - 0.37, 0.14)
      + vec3(0.12, 0.76, 0.18) * rainbowGaussian(position - 0.51, 0.14)
      + vec3(0.95, 0.77, 0.06) * rainbowGaussian(position - 0.65, 0.14)
      + vec3(1.00, 0.30, 0.025) * rainbowGaussian(position - 0.79, 0.14)
      + vec3(0.90, 0.045, 0.018) * rainbowGaussian(position - 0.93, 0.15);
  }
  vec3 seaRainbow(vec3 sky, vec3 direction, vec3 center, vec3 right, vec3 up,
      float radius, float width, float strength, float secondaryStrength, float time) {
    vec2 plane = vec2(dot(direction, right), dot(direction, up));
    float facing = dot(direction, center);
    float distance = atan(length(plane), facing);
    float edge = max(fwidth(distance), width * 0.06);
    float primary = (distance - radius) / max(width, edge);
    float secondaryRadius = radius * 1.21;
    float secondaryWidth = width * 1.35;
    float secondary = (distance - secondaryRadius) / max(secondaryWidth, edge);
    // This is transmitted skylight plus weak spectral scatter, rather than an
    // opaque painted band. Keep the background visible even at peak strength.
    float horizon = smoothstep(0.006, 0.085, direction.y);
    float front = smoothstep(0.05, 0.25, facing);
    float visibility = horizon * front * strength;
    float angle = atan(plane.y, plane.x + 0.000001);
    float veil = 0.72 + 0.12 * sin(angle * 3.0 + 0.4)
      + 0.065 * sin(angle * 7.0 - 0.8)
      + 0.025 * sin(angle * 17.0 + time * 0.025);
    float primaryMask = rainbowGaussian(primary, 0.72) * veil * visibility;
    float secondaryMask = rainbowGaussian(secondary, 0.58) * veil * visibility * secondaryStrength;
    vec3 primaryLight = rainbowSpectrum(primary + 0.5);
    vec3 secondaryLight = rainbowSpectrum(0.5 - secondary);
    // Keep the primary spectrum vivid; haze washes out the weaker secondary.
    secondaryLight = mix(vec3(dot(secondaryLight, vec3(0.2126, 0.7152, 0.0722))), secondaryLight, 0.82);
    primaryLight *= mix(0.60, 1.0, smoothstep(0.0, 0.34, primary + 0.5));
    // A very faint Alexander band and brighter inner sky support the bow
    // without adding an unrelated blue rain-curtain halo around its outline.
    float darkBand = smoothstep(radius + width * 0.7, radius + width * 1.8, distance)
      * (1.0 - smoothstep(secondaryRadius - secondaryWidth, secondaryRadius, distance));
    sky *= 1.0 - darkBand * visibility * secondaryStrength * 0.045;
    float innerGlow = 1.0 - smoothstep(radius - width * 2.0, radius, distance);
    sky += vec3(0.008, 0.009, 0.008) * innerGlow * visibility;
    sky = sky * (1.0 - primaryMask * 0.16) + primaryLight * primaryMask * 0.80;
    sky = sky * (1.0 - secondaryMask * 0.06) + secondaryLight * secondaryMask * 0.28;
    return sky;
  }
`;
