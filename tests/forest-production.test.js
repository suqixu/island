import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIsland } from '../src/island.js';
import { VEGETATION_VERTEX_DISPLACEMENT } from '../src/vegetation-motion.js';

const compile = (material, type = 'standard') => {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib[type].vertexShader, fragmentShader: THREE.ShaderLib[type].fragmentShader };
  material.onBeforeCompile(shader); return shader;
};
function dispose(island) {
  const resources = new Set();
  island.group.traverse(object => {
    if (object.isInstancedMesh) object.dispose();
    if (object.geometry) resources.add(object.geometry);
    for (const material of [object.material, object.customDepthMaterial].flat()) if (material) {
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
  });
  resources.forEach(value => value.dispose());
}

test('岛上普通树使用分层小叶冠和批量细枝，所有画质枝叶一一对应且不逐帧改写实例', () => {
  const island = createIsland(new THREE.Scene());
  try {
    const crowns = island.group.children.filter(object => object.name.startsWith('阔叶冠层'));
    const branches = island.group.children.filter(object => object.name.startsWith('森林细枝'));
    assert.equal(crowns.length, 4); assert.equal(branches.length, 4, '细枝需要批量实例，而不是每棵树独立创建网格');
    assert.equal(crowns.reduce((sum, mesh) => sum + mesh.userData.fullCount, 0), 1250);
    assert.equal(new Set(crowns.map(mesh => mesh.material)).size, 1, '叶片共享材质与雪/风 uniform');
    assert.equal(new Set(branches.map(mesh => mesh.material)).size, 1, '枝干共享材质');
    const matrix = new THREE.Matrix4(), other = new THREE.Matrix4();
    const snapshot = branches.map(mesh => Array.from(mesh.instanceMatrix.array));
    const trunk = island.group.getObjectByName('森林树干与分叉');
    for (const quality of ['low', 'medium', 'high']) {
      island.update(10 + (quality === 'medium' ? 5 : quality === 'high' ? 10 : 0),
        { quality, running: false, season: quality === 'medium' ? 'winter' : 'autumn', windSpeed: 22, gust: .8 });
      for (let variant = 0; variant < crowns.length; variant++) {
        const leaves = crowns[variant], wood = branches[variant];
        assert.equal(wood.count, leaves.count, '降画质不能留出没有枝干的漂浮叶冠');
        for (let i = 0; i < leaves.count; i++) {
          leaves.getMatrixAt(i, matrix); wood.getMatrixAt(i, other);
          assert.deepEqual(matrix.elements, other.elements);
          for (const name of ['aPlantRoot', 'aPlantHeight']) {
            const a = leaves.geometry.attributes[name], b = wood.geometry.attributes[name];
            for (let k = 0; k < a.itemSize; k++) assert.equal(a.array[i * a.itemSize + k], b.array[i * b.itemSize + k]);
          }
        }
        assert.deepEqual(Array.from(wood.instanceMatrix.array), snapshot[variant]);
        const visible = compile(wood.material), depth = compile(wood.customDepthMaterial, 'depth');
        assert.equal(visible.uniforms.uTime, depth.uniforms.uTime);
        assert.equal(visible.uniforms.uTreeAmplitudes, depth.uniforms.uTreeAmplitudes);
        assert.ok(visible.vertexShader.includes(VEGETATION_VERTEX_DISPLACEMENT)
          && depth.vertexShader.includes(VEGETATION_VERTEX_DISPLACEMENT));
      }
      assert.equal(trunk.count, crowns.reduce((sum, mesh) => sum + mesh.count, 0) * 3,
        '主干、分叉和冠层在各画质都保留同一组树');
    }
  } finally { dispose(island); }
});
