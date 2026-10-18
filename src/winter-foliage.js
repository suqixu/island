// 寒冷天气只留下少量完整枯叶；叶面明暗在褪绿后仍然保留。
const LEAF_LOSS = .88;
const DRY_TINT = [1.08, .94, .73];
const LUMINANCE = [.2126, .7152, .0722];

/** 初始化时只排序整叶索引；渐变时二分裁剪，GPU 继续裁定阈值边界。 */
export function createWinterLeafDrawRange(geometry, indicesPerLeaf) {
  const index = geometry.index, ranks = geometry.attributes.aWinterLeaf;
  const original = index.array.slice();
  const leaves = Array.from({ length: index.count / indicesPerLeaf }, (_, leaf) => ({
    start: leaf * indicesPerLeaf, rank: ranks.getX(original[leaf * indicesPerLeaf]),
  })).sort((a, b) => a.rank - b.rank);
  const sortedRanks = new Float32Array(leaves.length);
  for (let leaf = 0; leaf < leaves.length; leaf++) {
    const { start, rank } = leaves[leaf];
    index.array.set(original.subarray(start, start + indicesPerLeaf), leaf * indicesPerLeaf);
    sortedRanks[leaf] = rank;
  }
  index.needsUpdate = true;
  let previousCount = -1;
  const update = winter => {
    const amount = Math.max(0, Math.min(1, winter));
    // JS 与 GLSL 的乘减/插值可能相差几个 Float32 ULP，保守多交少量整叶。
    const threshold = 1 - LEAF_LOSS * amount + 1e-6;
    let low = 0, high = sortedRanks.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (sortedRanks[middle] < threshold) low = middle + 1;
      else high = middle;
    }
    const count = low * indicesPerLeaf;
    if (count !== previousCount) { geometry.setDrawRange(0, count); previousCount = count; }
  };
  update(0);
  return update;
}

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
