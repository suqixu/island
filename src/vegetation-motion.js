const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const unit = value => clamp(finite(value), 0, 1);
const smooth = (value, low, high) => {
  const t = unit((finite(value, low) - low) / (high - low));
  return t * t * (3 - 2 * t);
};

const DEFAULT_DIRECTION_LENGTH = Math.hypot(.83, .55);
const windTargetDirection = [0, 0];

function directionOf(value, target = [0, 0]) {
  const x = value?.isVector2 ? value.x : value?.[0];
  const z = value?.isVector2 ? value.y : value?.[1];
  const length = Math.hypot(x, z);
  const valid = Number.isFinite(length) && length > .001;
  target[0] = valid ? x / length : .83 / DEFAULT_DIRECTION_LENGTH;
  target[1] = valid ? z / length : .55 / DEFAULT_DIRECTION_LENGTH;
  return target;
}

/** Crown input is local height in metres; frond/grass input is root-to-tip progress. */
export function getVegetationFlex(kind, value) {
  return kind === 'crown' ? smooth(value, -1.1, 2.1) : smooth(value, kind === 'palm' ? .025 : 0, 1);
}

export function createVegetationWindState() {
  return { time: 0, initialized: false, windSpeed: 8, gust: .12,
    direction: directionOf(), amplitudes: [0, 0, 0], treeAmplitudes: [0, 0], flutter: 0 };
}

/** Smooth weather only. Fixed elapsed-time frequencies cannot jump when wind changes. */
export function advanceVegetationWind(state, time, env = {}) {
  const now = Math.max(state.time, finite(time, state.time));
  const dt = now - state.time;
  const speed = clamp(finite(env.windSpeed, 2 + unit(finite(env.wind, .3)) * 20), 2, 22);
  const gust = unit(finite(env.gust, .12));
  // This synchronous update consumes the direction immediately; reuse its
  // scratch pair instead of allocating one for every plant system every frame.
  const target = directionOf(env.windDirection, windTargetDirection);
  const blend = state.initialized ? 1 - Math.exp(-dt * 1.6) : 1;
  state.windSpeed += (speed - state.windSpeed) * blend;
  state.gust += (gust - state.gust) * blend;
  const angle = Math.atan2(state.direction[1], state.direction[0]);
  const targetAngle = Math.atan2(target[1], target[0]);
  const difference = Math.atan2(Math.sin(targetAngle - angle), Math.cos(targetAngle - angle));
  const nextAngle = angle + difference * (state.initialized ? 1 - Math.exp(-dt * .75) : 1);
  state.direction[0] = Math.cos(nextAngle); state.direction[1] = Math.sin(nextAngle);
  const strength = (state.windSpeed - 2) / 20;
  state.amplitudes[0] = .34 + strength * .39 + state.gust * .09;
  state.amplitudes[1] = .24 + strength * .32 + state.gust * .09;
  state.amplitudes[2] = .12 + strength * .28 + state.gust * .055;
  // Whole-tree bending is separate from leaf motion: the silhouette moves in
  // the wide view while the trunk, branches and crown remain connected.
  state.treeAmplitudes[0] = .62 + strength * .90 + state.gust * .25;
  state.treeAmplitudes[1] = .90 + strength * 1.10 + state.gust * .30;
  state.flutter = .032 + strength * .037 + state.gust * .016;
  state.time = now; state.initialized = true;
  return state;
}

/** World-metre numerical sampler of the GPU motion, including a fixed root. */
export function getVegetationDisplacement(time, flex, phase, wind, kind = 'palm') {
  const bend = unit(flex);
  if (bend === 0) return [0, 0, 0];
  const t = Math.max(0, finite(time)), p = finite(phase);
  const index = kind === 'palm' ? 0 : kind === 'crown' ? 1 : 2;
  const amplitude = finite(wind?.amplitudes?.[index]);
  const flutterScale = index === 0 ? 1 : index === 1 ? .35 : .2;
  const sway = .55 * Math.sin(t * .62 + p) + .24 * Math.sin(t * .93 + p * 1.7)
    + .11 * Math.sin(t * .27 + p * .51) + .1 * Math.sin(t * .43);
  const flutter = (.72 * Math.sin(t * 4.3 + p * 3.1) + .28 * Math.sin(t * 6.8 + p * 2.3))
    * finite(wind?.flutter) * flutterScale * bend ** 3;
  const along = sway * amplitude * bend * bend + flutter;
  const across = Math.sin(t * .67 + p + 1.7) * amplitude * .15 * bend * bend;
  const direction = directionOf(wind?.direction);
  return [direction[0] * along - direction[1] * across, flutter * .36,
    direction[1] * along + direction[0] * across];
}

/** Fixed-root whole-tree bend. Height is world height above root / tree height. */
export function getVegetationBodyDisplacement(time, height, phase, wind, kind = 'tree') {
  const bend = smooth(height, .06, 1);
  if (bend === 0) return [0, 0, 0];
  const t = Math.max(0, finite(time)), p = finite(phase), direction = directionOf(wind?.direction);
  const sway = .55 * Math.sin(t * .62 + p) + .24 * Math.sin(t * .93 + p * 1.7)
    + .11 * Math.sin(t * .27 + p * .51) + .1 * Math.sin(t * .43);
  const amplitude = finite(wind?.treeAmplitudes?.[kind === 'palm' ? 1 : 0]);
  const along = sway * amplitude * bend * bend;
  const across = Math.sin(t * .67 + p + 1.7) * amplitude * .15 * bend * bend;
  return [direction[0] * along - direction[1] * across, 0,
    direction[1] * along + direction[0] * across];
}

/** Shared compiler hook for every vegetation visible/depth pass. */
export function configureVegetationWindShader(shader, uniforms, kind = 'ground', declarations = '', afterMotion = '') {
  const body = kind === 'tree' || kind === 'palmBody';
  const palm = kind === 'palm' || kind === 'palmBody';
  const tree = palm || kind === 'tree' || kind === 'crown';
  const channel = palm ? 'x' : kind === 'crown' ? 'y' : 'z';
  const amplitude = body ? '0.0' : `uPlantAmplitudes.${channel}${kind === 'road' ? ' * 0.65' : ''}`;
  const flutter = body ? '0.0' : palm ? '1.0' : kind === 'crown' ? '0.35' : '0.2';
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = `#define PLANT_AMPLITUDE (${amplitude})
    #define PLANT_FLUTTER_SCALE ${flutter}
    ${tree ? `#define USE_PLANT_BODY\n#define PLANT_BODY_AMPLITUDE uTreeAmplitudes.${palm ? 'y' : 'x'}` : ''}
    ${VEGETATION_VERTEX_DECLARATIONS}
    ${declarations}
    ${shader.vertexShader}`;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
    `#include <begin_vertex>\n${VEGETATION_VERTEX_DISPLACEMENT}\n${afterMotion}`);
  if (tree) shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>',
    `#include <beginnormal_vertex>\n${VEGETATION_BODY_NORMAL}`);
}

// Main and depth passes use these exact declarations/displacement. The instance
// origin supplies a stable tree phase; only leaf flutter varies within a crown.
export const VEGETATION_VERTEX_DECLARATIONS = /* glsl */ `
  uniform float uTime;
  uniform vec2 uWindDirection;
  uniform vec3 uPlantAmplitudes;
  uniform float uLeafFlutter;
  attribute float aFlex;
  #ifdef USE_PLANT_BODY
    uniform vec2 uTreeAmplitudes;
    attribute vec3 aPlantRoot;
    attribute float aPlantHeight;
  #endif
  float vegetationSway(float phase) {
    return 0.55 * sin(uTime * 0.62 + phase) + 0.24 * sin(uTime * 0.93 + phase * 1.7)
      + 0.11 * sin(uTime * 0.27 + phase * 0.51) + 0.1 * sin(uTime * 0.43);
  }
`;
export const VEGETATION_VERTEX_DISPLACEMENT = /* glsl */ `
  mat3 plantBasis = mat3(modelMatrix);
  vec4 windOrigin = vec4(0.0, 0.0, 0.0, 1.0);
  #ifdef USE_INSTANCING
    plantBasis = plantBasis * mat3(instanceMatrix);
    windOrigin = instanceMatrix * windOrigin;
  #endif
  windOrigin = modelMatrix * windOrigin;
  #ifdef USE_PLANT_BODY
    // The crown/branch instance origins differ. Root attributes keep all
    // parts of each tree on the same phase and bend field.
    windOrigin = modelMatrix * vec4(aPlantRoot, 1.0);
  #endif
  float plantPhase = dot(windOrigin.xz, vec2(0.071, 0.097));
  float plantSway = vegetationSway(plantPhase);
  float plantBend = aFlex * aFlex;
  float leafFlutter = (0.72 * sin(uTime * 4.3 + plantPhase * 3.1 + position.x * 1.8 + position.z * 2.2)
    + 0.28 * sin(uTime * 6.8 + plantPhase * 2.3 + position.x * 2.7 - position.z * 1.3))
    * uLeafFlutter * PLANT_FLUTTER_SCALE * plantBend * aFlex;
  float alongWind = plantSway * PLANT_AMPLITUDE * plantBend + leafFlutter;
  float acrossWind = sin(uTime * 0.67 + plantPhase + 1.7) * PLANT_AMPLITUDE * 0.15 * plantBend;
  vec3 worldBend = vec3(uWindDirection.x * alongWind - uWindDirection.y * acrossWind,
    leafFlutter * 0.36, uWindDirection.y * alongWind + uWindDirection.x * acrossWind);
  #ifdef USE_PLANT_BODY
    vec4 bodyWorldPosition = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      bodyWorldPosition = instanceMatrix * bodyWorldPosition;
    #endif
    bodyWorldPosition = modelMatrix * bodyWorldPosition;
    float bodyBend = smoothstep(0.06, 1.0, (bodyWorldPosition.y - windOrigin.y) / max(aPlantHeight, 0.1));
    bodyBend *= bodyBend;
    float bodyAlong = plantSway * PLANT_BODY_AMPLITUDE * bodyBend;
    float bodyAcross = sin(uTime * 0.67 + plantPhase + 1.7) * PLANT_BODY_AMPLITUDE * 0.15 * bodyBend;
    worldBend.xz += vec2(uWindDirection.x * bodyAlong - uWindDirection.y * bodyAcross,
      uWindDirection.y * bodyAlong + uWindDirection.x * bodyAcross);
  #endif
  // The meshes use orthogonal TRS bases. Dividing out squared basis length
  // removes instance rotation AND scale, so amplitudes remain world metres.
  transformed += vec3(dot(worldBend, plantBasis[0]) / max(dot(plantBasis[0], plantBasis[0]), 0.0001),
    dot(worldBend, plantBasis[1]) / max(dot(plantBasis[1], plantBasis[1]), 0.0001),
    dot(worldBend, plantBasis[2]) / max(dot(plantBasis[2], plantBasis[2]), 0.0001));
`;

// Whole-tree bend is a height-dependent horizontal shear. Its inverse
// transpose makes bark lighting follow the bending trunk, using the same
// root and phase as the position displacement. Depth passes need no normals.
const VEGETATION_BODY_NORMAL = /* glsl */ `
  mat3 windNormalBasis = mat3(modelMatrix);
  vec4 windNormalPosition = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    windNormalBasis = windNormalBasis * mat3(instanceMatrix);
    windNormalPosition = instanceMatrix * windNormalPosition;
  #endif
  windNormalPosition = modelMatrix * windNormalPosition;
  vec3 windNormalRoot = (modelMatrix * vec4(aPlantRoot, 1.0)).xyz;
  float normalPhase = dot(windNormalRoot.xz, vec2(0.071, 0.097));
  float normalHeight = clamp(((windNormalPosition.y - windNormalRoot.y) / max(aPlantHeight, 0.1) - 0.06) / 0.94, 0.0, 1.0);
  float normalFlex = normalHeight * normalHeight * (3.0 - 2.0 * normalHeight);
  float bendDerivative = 12.0 * normalFlex * normalHeight * (1.0 - normalHeight) / (0.94 * max(aPlantHeight, 0.1));
  float normalAlong = vegetationSway(normalPhase) * PLANT_BODY_AMPLITUDE * bendDerivative;
  float normalAcross = sin(uTime * 0.67 + normalPhase + 1.7) * PLANT_BODY_AMPLITUDE * 0.15 * bendDerivative;
  vec2 worldBendSlope = vec2(uWindDirection.x * normalAlong - uWindDirection.y * normalAcross,
    uWindDirection.y * normalAlong + uWindDirection.x * normalAcross);
  vec3 bentWorldNormal = windNormalBasis * vec3(
    objectNormal.x / max(dot(windNormalBasis[0], windNormalBasis[0]), 0.0001),
    objectNormal.y / max(dot(windNormalBasis[1], windNormalBasis[1]), 0.0001),
    objectNormal.z / max(dot(windNormalBasis[2], windNormalBasis[2]), 0.0001));
  bentWorldNormal.y -= dot(bentWorldNormal.xz, worldBendSlope);
  objectNormal = normalize(vec3(dot(bentWorldNormal, windNormalBasis[0]),
    dot(bentWorldNormal, windNormalBasis[1]), dot(bentWorldNormal, windNormalBasis[2])));
`;
