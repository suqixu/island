// 寒冷天气只留下少量完整枯叶；叶面明暗在褪绿后仍然保留。
const LEAF_LOSS = .88;
const DRY_TINT = [1.08, .94, .73];
const LUMINANCE = [.2126, .7152, .0722];
/** Extend existing wind and leaf hooks. Apply before attachSnowSurface so snow
 * stays white. Sparse broadleaf geometry requires aWinterLeaf; its depth
 * material must receive the same uniform with { sparse: true, depth: true }.
 */
export function attachWinterFoliage(material, winterUniform, { sparse = false, depth = false } = {}) {
  if (!winterUniform || material.userData.winterFoliage) return material;
  material.userData.winterFoliage = true;
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    compile.call(this, shader, renderer);
    shader.uniforms.uFoliageWinter = winterUniform;
    shader.fragmentShader = `uniform float uFoliageWinter;\n${shader.fragmentShader}`;
    if (sparse) {
      shader.vertexShader = `attribute float aWinterLeaf; varying float vWinterLeaf;\n${shader.vertexShader}`
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWinterLeaf = aWinterLeaf;');
      shader.fragmentShader = `varying float vWinterLeaf;\n${shader.fragmentShader}`
        .replace('#include <alphatest_fragment>', `
          if (vWinterLeaf >= 1.0 - ${LEAF_LOSS} * clamp(uFoliageWinter, 0.0, 1.0)) discard;
          #include <alphatest_fragment>`);
    }
    if (!depth) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
        float winterLeafLight = dot(diffuseColor.rgb, vec3(${LUMINANCE.join(', ')}));
        vec3 winterDryColor = winterLeafLight * vec3(${DRY_TINT.join(', ')});
        diffuseColor.rgb = mix(diffuseColor.rgb, winterDryColor, clamp(uFoliageWinter, 0.0, 1.0));
        #include <roughnessmap_fragment>`);
    }
  };
  material.customProgramCacheKey = () => `${key}|winter-foliage-v1-${sparse}-${depth}`;
  material.needsUpdate = true;
  return material;
}
