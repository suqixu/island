const finite = value => Number.isFinite(value) ? value : 0;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const fract = value => value - Math.floor(value);
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (low, high, value) => { const t = clamp((value - low) / (high - low)); return t * t * (3 - 2 * t); };
function hash(x, y, z) {
  let a = fract(x * .1031), b = fract(y * .1031), c = fract(z * .1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d; return fract((a + b) * c);
}
function noise(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const sx = fract(x), sy = fract(y), sz = fract(z);
  const u = sx * sx * (3 - 2 * sx), v = sy * sy * (3 - 2 * sy), w = sz * sz * (3 - 2 * sz);
  return mix(mix(mix(hash(i, j, k), hash(i + 1, j, k), u), mix(hash(i, j + 1, k), hash(i + 1, j + 1, k), u), v),
    mix(mix(hash(i, j, k + 1), hash(i + 1, j, k + 1), u), mix(hash(i, j + 1, k + 1), hash(i + 1, j + 1, k + 1), u), v), w);
}

/** Linear-colour multipliers: the existing seasonal/instance colour remains the palette. */
export function sampleVegetationSurface(kind, position, { palm = false } = {}) {
  const x = finite(position?.x ?? position?.[0]), y = finite(position?.y ?? position?.[1]), z = finite(position?.z ?? position?.[2]);
  const broad = noise(x * .65, y * .65, z * .65);
  if (kind === 'bark') {
    const fibre = noise(x * 13 + broad * 1.3, y * .65, z * 13 - broad * 1.3);
    const grain = noise(x * 35, y * 5, z * 35);
    const fissure = 1 - smooth(.20, .38, fibre);
    const shade = .76 + broad * .23 + grain * .12 - fissure * (palm ? .21 : .30);
    return { shade, vein: fissure, tint: [shade * 1.035, shade, shade * .93],
      relief: (fibre * .014 + broad * .008 - fissure * .012) * (palm ? .65 : 1) };
  }
  const mid = noise(x * 2.3 + 17.7, y * 2.3 + 17.7, z * 2.3 + 17.7);
  const fine = noise(x * 13, y * 13, z * 13);
  const vein = 1 - smooth(.018, .055, Math.abs(fine - .53));
  const shade = .85 + broad * .21 + mid * .10 - vein * .045;
  return { shade, vein, tint: [shade * (1 - mid * .035), shade * 1.02, shade * (.96 + mid * .025)],
    relief: (fine - .5) * .002 + vein * .00065 };
}

const SURFACE_GLSL = /* glsl */ `
  varying vec3 vVegetationSurfaceWorld;
  float vegetationSurfaceHash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float vegetationSurfaceNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(vegetationSurfaceHash(i), vegetationSurfaceHash(i+vec3(1,0,0)),f.x),
          mix(vegetationSurfaceHash(i+vec3(0,1,0)),vegetationSurfaceHash(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(vegetationSurfaceHash(i+vec3(0,0,1)),vegetationSurfaceHash(i+vec3(1,0,1)),f.x),
          mix(vegetationSurfaceHash(i+vec3(0,1,1)),vegetationSurfaceHash(i+vec3(1,1,1)),f.x),f.y),f.z);
  }
  vec3 vegetationSurfaceNormal(vec3 viewPosition, vec3 surfaceNormal, float height, float facing) {
    vec3 sx = normalize(dFdx(viewPosition)), sy = normalize(dFdy(viewPosition));
    vec3 rx = cross(sy, surfaceNormal), ry = cross(surfaceNormal, sx);
    float determinant = dot(sx, rx) * facing;
    vec3 gradient = sign(determinant) * (dFdx(height) * rx + dFdy(height) * ry);
    return normalize(max(abs(determinant), 0.00001) * surfaceNormal - gradient);
  }
`;

/** Adds no texture, mesh, uniform or frame work. Install after the existing wind/snow hook. */
export function attachVegetationSurface(material, { kind = 'leaf', palm = false } = {}) {
  if (!material?.isMaterial) return material;
  kind = kind === 'bark' ? 'bark' : 'leaf';
  if (material.userData.vegetationSurface) return material;
  const previousCompile = material.onBeforeCompile, previousKey = material.customProgramCacheKey();
  const bark = kind === 'bark';
  material.userData.vegetationSurface = Object.freeze({ kind, palm: Boolean(palm) });
  material.onBeforeCompile = function (shader, renderer) {
    previousCompile.call(this, shader, renderer);
    shader.vertexShader = `varying vec3 vVegetationSurfaceWorld;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      // Undeformed coordinates keep the detail attached to the moving leaves.
      vec4 vegetationSurfaceAnchor = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        vegetationSurfaceAnchor = instanceMatrix * vegetationSurfaceAnchor;
      #endif
      vVegetationSurfaceWorld = (modelMatrix * vegetationSurfaceAnchor).xyz;`);
    shader.fragmentShader = `${SURFACE_GLSL}\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 vegetationSurfaceP = vVegetationSurfaceWorld;
      float vegetationBroad = vegetationSurfaceNoise(vegetationSurfaceP * 0.65);
      float vegetationDetail = 1.0 - smoothstep(0.03, 0.16,
        max(length(dFdx(vegetationSurfaceP)), length(dFdy(vegetationSurfaceP))));
      ${bark ? `float vegetationFibre = vegetationSurfaceNoise(vegetationSurfaceP * vec3(13.0, 0.65, 13.0)
          + vec3(vegetationBroad * 1.3, 0.0, -vegetationBroad * 1.3));
        float vegetationGrain = vegetationSurfaceNoise(vegetationSurfaceP * vec3(35.0, 5.0, 35.0));
        float vegetationFissure = 1.0 - smoothstep(0.20, 0.38, vegetationFibre);
        float vegetationShade = 0.76 + vegetationBroad * 0.23 + mix(0.5, vegetationGrain, vegetationDetail) * 0.12
          - mix(0.10, vegetationFissure, vegetationDetail) * ${palm ? '0.21' : '0.30'};
        vec3 vegetationSurfaceTint = vec3(vegetationShade * 1.035, vegetationShade, vegetationShade * 0.93);
        float vegetationSurfaceRelief = (vegetationFibre * 0.014 + vegetationBroad * 0.008
          - vegetationFissure * 0.012) * ${palm ? '0.65' : '1.0'} * vegetationDetail;`
        : `float vegetationMid = vegetationSurfaceNoise(vegetationSurfaceP * 2.3 + vec3(17.7));
        float vegetationFine = vegetationSurfaceNoise(vegetationSurfaceP * 13.0);
        float vegetationVein = (1.0 - smoothstep(0.018, 0.055, abs(vegetationFine - 0.53))) * vegetationDetail;
        float vegetationShade = 0.85 + vegetationBroad * 0.21 + vegetationMid * 0.10 - vegetationVein * 0.045;
        vec3 vegetationSurfaceTint = vec3(vegetationShade * (1.0 - vegetationMid * 0.035),
          vegetationShade * 1.02, vegetationShade * (0.96 + vegetationMid * 0.025));
        float vegetationSurfaceRelief = ((vegetationFine - 0.5) * 0.002 + vegetationVein * 0.00065) * vegetationDetail;`}
      diffuseColor.rgb *= vegetationSurfaceTint;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      normal = vegetationSurfaceNormal(-vViewPosition, normal, vegetationSurfaceRelief, faceDirection);`);
  };
  material.customProgramCacheKey = () => `${previousKey}|vegetation-surface-v1-${kind}-${Boolean(palm)}`;
  material.needsUpdate = true;
  return material;
}
