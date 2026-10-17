import { Vector2 } from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/** Keep a malformed HDR sample out of the five blur levels. WebGL 2 supports
 * isnan/isinf; checking before luminance also avoids NaN * 0 in mix(). */
export function createBloomPass(width, height) {
  const bloom = new UnrealBloomPass(new Vector2(width, height), .16, .4, 1.1);
  // Every Bloom target only filters a full-screen color image; no depth is read.
  for (const target of [bloom.renderTargetBright,
    ...bloom.renderTargetsHorizontal, ...bloom.renderTargetsVertical]) {
    target.depthBuffer = false;
  }
  const material = bloom.materialHighPassFilter;
  material.fragmentShader = material.fragmentShader.replace(
    'vec4 texel = texture2D( tDiffuse, vUv );',
    `vec4 texel = texture2D( tDiffuse, vUv );
      if (any(isnan(texel)) || any(isinf(texel))) {
        gl_FragColor = vec4(defaultColor.rgb, defaultOpacity);
        return;
      }`
  );
  return bloom;
}
