import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIsland } from '../src/island.js';
import * as motion from '../src/vegetation-motion.js';
import { createIslandPaths } from '../src/island-paths.js';
import { getIslandPathLayout } from '../src/path-layout.js';

let island;
const names = ['森林树干与分叉', '弯曲椰树与生长环', '椰树羽状叶', '椰子果簇',
  '海岛草丛', '春季野花', '林下蕨类', '路旁低矮草簇', '路旁细小野花'];
const compile = (material, depth = false) => {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib[depth ? 'depth' : 'standard'].vertexShader,
    fragmentShader: THREE.ShaderLib[depth ? 'depth' : 'standard'].fragmentShader };
  material.onBeforeCompile(shader); return shader;
};
before(() => { island = createIsland(new THREE.Scene()); });
after(() => {
  const resources = new Set();
  island.group.traverse(mesh => {
    if (mesh.isInstancedMesh) mesh.dispose();
    if (mesh.geometry) resources.add(mesh.geometry);
    for (const material of [mesh.material, mesh.customDepthMaterial].flat()) if (material) {
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
  });
  resources.forEach(resource => resource.dispose());
});

test('真实岛内树干、椰果、路边草花均接入持续风，绘制和阴影收到同一风时钟', () => {
  const meshes = names.map(name => island.group.getObjectByName(name));
  meshes.push(...island.group.children.filter(mesh => mesh.name.startsWith('阔叶冠层')));
  for (const mesh of meshes) {
    assert.ok(mesh?.geometry, `${mesh?.name}实际植被仍需存在`);
    const visible = compile(mesh.material);
    assert.ok(visible.uniforms.uTime && visible.uniforms.uWindDirection && visible.uniforms.uPlantAmplitudes,
      `${mesh.name}遗漏真实风uniform`);
    assert.ok(visible.vertexShader.includes('worldBend'), `${mesh.name}可见pass遗漏位移`);
    assert.ok(mesh.customDepthMaterial, `${mesh.name}影子仍是静止植被`);
    const depth = compile(mesh.customDepthMaterial, true);
    for (const name of ['uTime', 'uWindDirection', 'uPlantAmplitudes']) {
      assert.equal(visible.uniforms[name], depth.uniforms[name], `${mesh.name}深度使用独立时钟`);
    }
    assert.ok(depth.vertexShader.includes(motion.VEGETATION_VERTEX_DISPLACEMENT), `${mesh.name}影子位移与可见pass不一致`);
  }
  const shaders = meshes.map(mesh => compile(mesh.material));
  for (const quality of ['low', 'medium', 'high']) {
    island.update(20 + shaders[0].uniforms.uTime.value, { quality, running: false, hour: 12, windSpeed: 18, gust: .8 });
    for (const shader of shaders) assert.equal(shader.uniforms.uTime.value, shaders[0].uniforms.uTime.value,
      '暂停昼夜与低画质不能停止或分裂植被真实时间');
  }
});

test('树冠、分叉、椰干与果实共享每株根位置及树高，树根之外逐渐弯曲', () => {
  assert.equal(typeof motion.getVegetationBodyDisplacement, 'function', '树干需要随高度弯曲的世界空间运动');
  for (const name of ['森林树干与分叉', '弯曲椰树与生长环', '椰树羽状叶', '椰子果簇', '阔叶冠层-1']) {
    const mesh = island.group.getObjectByName(name);
    const { aPlantRoot: roots, aPlantHeight: heights } = mesh.geometry.attributes;
    assert.ok(roots && heights, `${name}缺少整株固定根参考`);
    assert.ok(heights.getX(0) >= 3.6);
    const shader = compile(mesh.material);
    assert.ok(shader.uniforms.uTreeAmplitudes, `${name}没有可见树干弯曲幅度`);
  }
  const crown = island.group.getObjectByName('阔叶冠层-1'), tree = crown.userData.trees[0];
  const root = crown.geometry.attributes.aPlantRoot;
  assert.ok(Math.abs(root.getX(0) - tree.x) < .00001 && Math.abs(root.getY(0) - tree.y) < .00001
    && Math.abs(root.getZ(0) - tree.z) < .00001);
  const trunk = island.group.getObjectByName('森林树干与分叉');
  assert.ok(trunk.geometry.parameters.heightSegments >= 6, '树干必须有中间顶点，不能只有两端刚性倾斜');
});

test('路旁草花根不离地，草尖柔性与风uniform实际变化且实例矩阵保持不变', () => {
  for (const name of ['路旁低矮草簇', '路旁细小野花']) {
    const mesh = island.group.getObjectByName(name), { position, aFlex } = mesh.geometry.attributes;
    assert.ok(aFlex, `${name}仍没有可弯曲叶尖`);
    let roots = 0, tips = 0;
    for (let i = 0; i < position.count; i++) {
      if (Math.abs(position.getY(i)) < .00001) { assert.ok(aFlex.getX(i) < 1e-9); roots++; }
      if (aFlex.getX(i) > .95) tips++;
    }
    assert.ok(roots > 0 && tips > 0, '真实几何需要固定根和足够柔性的尖端');
    const matrices = Array.from(mesh.instanceMatrix.array), shader = compile(mesh.material);
    const time = shader.uniforms.uTime.value + 5;
    island.update(time, { season: 'spring', quality: 'low', windSpeed: 2, gust: 0 });
    const gentle = shader.uniforms.uPlantAmplitudes.value.z;
    island.update(time + 4, { season: 'spring', quality: 'low', windSpeed: 22, gust: 1 });
    assert.ok(shader.uniforms.uPlantAmplitudes.value.z > gentle * 1.7);
    assert.deepEqual(Array.from(mesh.instanceMatrix.array), matrices, 'GPU风动不得逐帧改写数千实例矩阵');
  }
});

test('晴天草尖位移在近景可见，强风更明显且树干/冠层共享连续方向', () => {
  const settled = env => motion.advanceVegetationWind(motion.createVegetationWindState(), 0, env);
  const breeze = settled({ windSpeed: 7, gust: .15 }), strong = settled({ windSpeed: 22, gust: 1 });
  let grassPeak = 0;
  for (let frame = 0; frame <= 1200; frame++) {
    grassPeak = Math.max(grassPeak, Math.hypot(...motion.getVegetationDisplacement(frame / 20, 1, 1.3, breeze, 'ground')));
  }
  assert.ok(grassPeak > .17, `晴天草尖仍只有${grassPeak.toFixed(3)}m，难以看到`);
  assert.equal(typeof motion.getVegetationBodyDisplacement, 'function');
  for (const kind of ['tree', 'palm']) {
    let peak = 0, strongPeak = 0;
    for (let frame = 0; frame <= 1200; frame++) {
      const time = frame / 20, sample = motion.getVegetationBodyDisplacement(time, 1, 1.3, breeze, kind);
      peak = Math.max(peak, Math.hypot(...sample));
      strongPeak = Math.max(strongPeak, Math.hypot(...motion.getVegetationBodyDisplacement(time, 1, 1.3, strong, kind)));
      assert.deepEqual(motion.getVegetationBodyDisplacement(time, 0, 1.3, strong, kind), [0, 0, 0]);
      const next = motion.getVegetationBodyDisplacement(time + 1 / 60, 1, 1.3, strong, kind);
      assert.ok(Math.hypot(...sample.map((value, i) => value - motion.getVegetationBodyDisplacement(time + 1 / 60, 1, 1.3, breeze, kind)[i])) < .05);
      assert.ok(next.every(Number.isFinite));
    }
    assert.ok(peak > .72 && peak < 1.4, `${kind}晴天冠部整体位移${peak}`);
    assert.ok(strongPeak > peak * 1.7 && strongPeak < 2.6);
  }
});

test('真实树干底圈与椰干底圈在强风中固定，分叉、树冠及椰果使用对应根的同一弯曲场', () => {
  const wind = motion.advanceVegetationWind(motion.createVegetationWindState(), 0, { windSpeed: 22, gust: 1 });
  const trunk = island.group.getObjectByName('森林树干与分叉'), matrix = new THREE.Matrix4(), point = new THREE.Vector3();
  const roots = trunk.geometry.attributes.aPlantRoot, heights = trunk.geometry.attributes.aPlantHeight;
  let checked = 0;
  for (let tree = 0; tree < trunk.userData.fullCount / 3; tree++) {
    const at = tree * 3;
    for (const branch of [1, 2]) {
      assert.equal(roots.getX(at + branch), roots.getX(at));
      assert.equal(roots.getY(at + branch), roots.getY(at));
      assert.equal(roots.getZ(at + branch), roots.getZ(at));
      assert.equal(heights.getX(at + branch), heights.getX(at));
    }
    trunk.getMatrixAt(at, matrix);
    for (let vertex = 0; vertex < trunk.geometry.attributes.position.count; vertex++) {
      point.fromBufferAttribute(trunk.geometry.attributes.position, vertex).applyMatrix4(matrix);
      const height = (point.y - roots.getY(at)) / heights.getX(at);
      if (height > .06) continue;
      for (const time of [2, 9, 31]) assert.deepEqual(motion.getVegetationBodyDisplacement(time, height,
        roots.getX(at) * .071 + roots.getZ(at) * .097, wind), [0, 0, 0]);
      checked++;
    }
  }
  assert.ok(checked > 8000, '每株真实树干底圈必须处于固定根区域');
  for (const crown of island.group.children.filter(mesh => mesh.name.startsWith('阔叶冠层'))) {
    const root = crown.geometry.attributes.aPlantRoot, height = crown.geometry.attributes.aPlantHeight;
    for (let tree = 0; tree < crown.userData.trees.length; tree++) {
      const source = crown.userData.trees[tree];
      assert.ok(Math.abs(root.getX(tree) - source.x) < .00001 && Math.abs(root.getY(tree) - source.y) < .00001
        && Math.abs(root.getZ(tree) - source.z) < .00001);
      assert.ok(Math.abs(height.getX(tree) - source.scale * 5.1) < .00001);
    }
  }
  const palmTrunk = island.group.getObjectByName('弯曲椰树与生长环');
  const palmRoot = palmTrunk.geometry.attributes.aPlantRoot, palmHeight = palmTrunk.geometry.attributes.aPlantHeight;
  const palms = island.group.getObjectByName('椰树羽状叶'), fruit = island.group.getObjectByName('椰子果簇');
  const perPalm = palmTrunk.geometry.attributes.position.count / palms.userData.fullCount;
  for (let palm = 0; palm < palms.userData.fullCount; palm++) {
    for (let vertex = palm * perPalm; vertex < palm * perPalm + 10; vertex++) {
      const phase = palmRoot.getX(vertex) * .071 + palmRoot.getZ(vertex) * .097;
      const height = (palmTrunk.geometry.attributes.position.getY(vertex) - palmRoot.getY(vertex)) / palmHeight.getX(vertex);
      assert.deepEqual(motion.getVegetationBodyDisplacement(7, height, phase, wind, 'palm'), [0, 0, 0]);
    }
    for (const attr of ['aPlantRoot', 'aPlantHeight']) for (let copy = 0; copy < 3; copy++) {
      const leafAttr = palms.geometry.attributes[attr], fruitAttr = fruit.geometry.attributes[attr];
      for (let component = 0; component < leafAttr.itemSize; component++) {
        assert.equal(leafAttr.array[palm * leafAttr.itemSize + component], fruitAttr.array[(palm * 3 + copy) * fruitAttr.itemSize + component]);
      }
    }
  }
});

test('单独路旁植被仍有持续风和固定地面根，新增深度资源释放一次', () => {
  const parent = new THREE.Group(), paths = createIslandPaths(parent), grass = paths.group.getObjectByName('路旁低矮草簇');
  const shader = compile(grass.material), depth = grass.customDepthMaterial, matrices = Array.from(grass.instanceMatrix.array);
  let disposed = 0; depth.addEventListener('dispose', () => disposed++);
  try {
    paths.update(10, { running: false, windSpeed: 7, gust: .15, quality: 'low' });
    assert.equal(shader.uniforms.uTime.value, 10);
    paths.update(11, { running: false, windSpeed: 7, gust: .15, quality: 'low' });
    assert.equal(shader.uniforms.uTime.value, 11);
    assert.ok(shader.uniforms.uPlantAmplitudes.value.z > .17);
    assert.deepEqual(Array.from(grass.instanceMatrix.array), matrices);
    const matrix = new THREE.Matrix4(), origin = new THREE.Vector3(), layout = getIslandPathLayout();
    for (let index = 0; index < grass.count; index++) {
      grass.getMatrixAt(index, matrix); origin.setFromMatrixPosition(matrix);
      assert.ok(Math.abs(origin.y - layout.heightAtRendered(origin.x, origin.z) + .015) < .00001,
        '路边植被实例根仍嵌在真实渲染地面');
    }
  } finally { paths.dispose(); paths.dispose(); }
  assert.equal(disposed, 1); assert.equal(parent.children.length, 0);
});
