import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIslandCave } from '../src/models/island-cave.js';
import { CAVE_LAYOUT, caveToWorld, caveToLocal } from '../src/cave-layout.js';
import { heightAt } from '../src/terrain.js';
import { getVegetationDisplacement } from '../src/vegetation-motion.js';

const point = (side, height, forward) => {
  const p = caveToWorld(side, height, forward);
  return new THREE.Vector3(p.x, p.y, p.z);
};

test('洞口岩石断面有真实前后起伏，避免一片平滑圆管岩缘', () => {
  const cave = createIslandCave(new THREE.Group(), { heightAt });
  const portal = cave.group.getObjectByName('厚岩拱与裂隙洞口');
  portal.updateWorldMatrix(true, false);
  const depths = [];
  for (const [side, height] of [[-3.7, .8], [-3.7, 1.8], [-3.7, 2.8], [3.7, 1],
    [3.7, 2.4], [-2, 5.5], [0, 5.65], [2, 5.4]]) {
    const origin = point(side, height, 5), target = point(side, height, -1);
    const hit = new THREE.Raycaster(origin, target.sub(origin).normalize()).intersectObject(portal)[0];
    assert.ok(hit, '厚岩缘必须保持实体连续断面');
    depths.push(caveToLocal(hit.point).forward);
  }
  assert.ok(Math.max(...depths) - Math.min(...depths) > .38,
    '不同岩层至少有可见深度差，原始平面环会失败');
  const p = portal.geometry.attributes.position, levels = new Set();
  for (let i = 0; i < p.count; i++) {
    const local = caveToLocal(new THREE.Vector3().fromBufferAttribute(p, i));
    if (local.forward > -.6) levels.add(Math.round(local.forward * 100));
  }
  assert.ok(levels.size >= 12, '断面中的多层断裂应改变实际顶点位置');
  cave.dispose();
});

test('矿物颜色、凹凸高度和表面粗糙度分别驱动岩石材质', () => {
  const cave = createIslandCave(new THREE.Group(), { heightAt });
  const material = cave.group.getObjectByName('天然岩洞内壁').material;
  assert.ok(material.map?.isDataTexture && material.bumpMap?.isDataTexture && material.roughnessMap?.isDataTexture);
  assert.notEqual(material.bumpMap, material.map, '近白色颜色图不能代替岩石高度');
  assert.notEqual(material.roughnessMap, material.bumpMap);
  assert.equal(material.bumpMap.colorSpace, THREE.NoColorSpace);
  const values = [];
  for (let i = 0; i < material.bumpMap.image.data.length; i += 4) values.push(material.bumpMap.image.data[i]);
  assert.ok(Math.max(...values) - Math.min(...values) > 100, '高度图应有可产生凹凸高光的粒面与裂隙');
  const size = material.bumpMap.image.width;
  let relief = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size - 1; x++) relief += Math.abs(values[y * size + x + 1] - values[y * size + x]);
  }
  assert.ok(relief / (size * (size - 1)) > 5, '近景微表面不能只剩稀疏平滑斑块');
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.caveRockRelief.value, material.bumpMap, '三平面凹凸必须绑定真正高度资源');
  assert.equal(shader.uniforms.caveRockRoughness.value, material.roughnessMap);
  cave.dispose();
});

test('细化岩石不破坏空心入口、封闭洞壁或低质量暖光', () => {
  const cave = createIslandCave(new THREE.Group(), { heightAt });
  cave.group.updateWorldMatrix(true, true);
  const origin = point(0, 2, 9), target = point(0, 2, -11);
  const hits = new THREE.Raycaster(origin, target.sub(origin).normalize()).intersectObject(cave.group, true);
  assert.ok(hits.length && hits[0].distance > 14, '岩层不得堵住入洞通道');
  const lookFrom = point(0, 6, 20);
  for (const side of [-2.6, -1.3, 0, 1.3, 2.6]) {
    for (const height of [.5, 1.6, 2.7, 3.8, 4.9]) {
      const dir = point(side, height, 0).sub(lookFrom).normalize();
      assert.ok(new THREE.Raycaster(lookFrom, dir).intersectObject(cave.group, true).length);
    }
  }
  const before = new Map();
  cave.group.traverse(object => { if (object.isMesh) before.set(object, [object.geometry, object.material]); });
  cave.update(5, { daylight: 0, quality: 'low' });
  const lights = []; cave.group.traverse(object => { if (object.isPointLight) lights.push(object); });
  assert.equal(lights.length, 1);
  cave.update(10, { daylight: 1, quality: 'low', artificialLightsOff: true });
  assert.ok(lights.every(light => light.intensity === 0));
  for (const [object, resources] of before) assert.deepEqual([object.geometry, object.material], resources);
  assert.equal(cave.count.tunnelLength, CAVE_LAYOUT.depth);
  assert.ok(before.size <= 14, '岩层及绿植共享几何和纹理，不逐石或逐叶增加绘制对象');
  cave.dispose();
});

test('洞口小蕨和藤蔓根部实际贴岩，保留中央步行净空', () => {
  const cave = createIslandCave(new THREE.Group(), { heightAt });
  const fern = cave.group.getObjectByName('洞口贴岩苔草与小蕨');
  const vines = cave.group.getObjectByName('洞口下垂藤蔓');
  assert.ok(fern?.isMesh && vines?.isMesh, '小蕨与藤蔓用两个共享批次');
  assert.ok(fern.userData.plants >= 12 && vines.userData.plants >= 5);
  const portal = cave.group.getObjectByName('厚岩拱与裂隙洞口');
  cave.group.updateWorldMatrix(true, true);
  const vertex = new THREE.Vector3();
  for (const mesh of [fern, vines]) {
    const { position, aFlex, aCavePlantRoot } = mesh.geometry.attributes;
    assert.ok(aFlex && Array.from(aFlex.array).some(value => value === 0)
      && Array.from(aFlex.array).some(value => value > .7));
    const roots = new Map();
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(aCavePlantRoot, i);
      roots.set(vertex.toArray().join(','), vertex.clone());
      vertex.fromBufferAttribute(position, i);
      const local = caveToLocal(vertex);
      assert.ok(Math.abs(local.side) > 2.5 || local.height > 3.3,
        '叶和藤茎不能堵住中央入洞通道或石阶');
    }
    for (const p of roots.values()) {
      const root = caveToLocal(p);
      const origin = point(root.side, root.height, 5), direction = point(root.side, root.height, -1).sub(origin).normalize();
      const hit = new THREE.Raycaster(origin, direction).intersectObject(portal)[0];
      assert.ok(hit && Math.abs(caveToLocal(hit.point).forward - root.forward) < .05, '根部悬空或埋进洞壁会失败');
    }
  }
  cave.dispose();
});

test('洞口绿植根部固定、真实时间风动及阴影使用同一风场，低画质仍保留', () => {
  const cave = createIslandCave(new THREE.Group(), { heightAt });
  const plants = ['洞口贴岩苔草与小蕨', '洞口下垂藤蔓'].map(name => cave.group.getObjectByName(name));
  assert.ok(plants.every(Boolean));
  const shaders = plants.map(mesh => {
    assert.ok(mesh.castShadow && mesh.customDepthMaterial);
    const visible = { vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
    const shadow = { vertexShader: THREE.ShaderLib.depth.vertexShader,
      fragmentShader: THREE.ShaderLib.depth.fragmentShader, uniforms: {} };
    mesh.material.onBeforeCompile(visible); mesh.customDepthMaterial.onBeforeCompile(shadow);
    assert.equal(visible.uniforms.uTime, shadow.uniforms.uTime);
    assert.equal(visible.uniforms.uPlantAmplitudes, shadow.uniforms.uPlantAmplitudes);
    assert.equal(visible.uniforms.uWindDirection, shadow.uniforms.uWindDirection);
    return visible;
  });
  const before = plants.map(mesh => [mesh.geometry, mesh.material, mesh.customDepthMaterial,
    mesh.visible, [...mesh.geometry.attributes.position.array]]);
  const wind = { windSpeed: 10, gust: .3, windDirection: [1, 0], quality: 'low', running: false, hour: 12, season: 'summer' };
  cave.update(2, wind);
  const firstTime = shaders[0].uniforms.uTime.value;
  const firstColor = plants[0].material.color.clone();
  cave.update(7, { ...wind, hour: 22, speed: 100, season: 'winter', snow: .9 });
  assert.equal(firstTime, 2); assert.equal(shaders[0].uniforms.uTime.value, 7);
  assert.ok(!firstColor.equals(plants[0].material.color));
  assert.ok(shaders[0].uniforms.uCavePlantSnow.value > .5);
  const uniforms = shaders[0].uniforms;
  const state = { direction: uniforms.uWindDirection.value.toArray(),
    amplitudes: uniforms.uPlantAmplitudes.value.toArray(), flutter: uniforms.uLeafFlutter.value };
  assert.deepEqual(getVegetationDisplacement(7, 0, .8, state, 'ground'), [0, 0, 0]);
  const a = getVegetationDisplacement(2, 1, .8, state, 'ground'), b = getVegetationDisplacement(7, 1, .8, state, 'ground');
  const travel = Math.hypot(...a.map((value, i) => value - b[i]));
  assert.ok(travel > .003 && travel < .06, '叶梢应随真实时间轻摆，同时留在贴岩净距内');
  for (let i = 0; i < plants.length; i++) assert.deepEqual([plants[i].geometry, plants[i].material,
    plants[i].customDepthMaterial, plants[i].visible, [...plants[i].geometry.attributes.position.array]], before[i]);
  const resources = new Set(plants.flatMap(mesh => [mesh.geometry, mesh.material, mesh.customDepthMaterial]));
  const disposed = new Map([...resources].map(resource => [resource, 0]));
  for (const resource of resources) resource.addEventListener('dispose', () => disposed.set(resource, disposed.get(resource) + 1));
  cave.dispose(); cave.dispose(); cave.update(8, wind);
  assert.ok([...disposed.values()].every(count => count === 1));
});

test('分离的岩石纹理与共享资源只释放一次', () => {
  const parent = new THREE.Group(), cave = createIslandCave(parent, { heightAt });
  const resources = new Set();
  cave.group.traverse(object => {
    if (!object.isMesh) return;
    resources.add(object.geometry); resources.add(object.material);
    for (const map of ['map', 'bumpMap', 'roughnessMap']) if (object.material[map]) resources.add(object.material[map]);
  });
  const disposed = new Map([...resources].map(resource => [resource, 0]));
  for (const resource of resources) resource.addEventListener('dispose', () => disposed.set(resource, disposed.get(resource) + 1));
  cave.dispose(); cave.dispose(); cave.update(1, { daylight: 0 });
  assert.ok([...disposed.values()].every(count => count === 1));
  assert.equal(parent.children.length, 0);
});

test('贴岩藤茎和蕨茎固定，强风叶梢位移小于叶片与岩面的净距', () => {
  const cave = createIslandCave(new THREE.Group(), { heightAt });
  const meshes = ['洞口贴岩苔草与小蕨', '洞口下垂藤蔓'].map(name => cave.group.getObjectByName(name));
  for (const mesh of meshes) {
    const { aFlex, aCover } = mesh.geometry.attributes;
    const stemCover = mesh.name.includes('藤蔓') ? .04 : .25;
    let stems = 0;
    for (let i = 0; i < aFlex.count; i++) {
      if (Math.abs(aCover.getX(i) - stemCover) > .00001) continue;
      stems++; assert.equal(aFlex.getX(i), 0, '真实贴岩茎顶点不能随海风离开岩面');
    }
    assert.ok(stems > 100);
  }
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
  meshes[0].material.onBeforeCompile(shader);
  cave.update(0, { windSpeed: 22, gust: 1, windDirection: [1, 0] });
  const uniforms = shader.uniforms, wind = { direction: uniforms.uWindDirection.value.toArray(),
    amplitudes: uniforms.uPlantAmplitudes.value.toArray(), flutter: uniforms.uLeafFlutter.value };
  for (let time = 0; time < 60; time += .1) {
    const displacement = getVegetationDisplacement(time, 1, 4.1, wind, 'ground');
    assert.ok(Math.hypot(...displacement) < .045, '朝岩风也不能越过叶片6cm净距');
  }
  cave.dispose();
});

test('外露洞顶与两侧岩壁形成连续绿叶覆盖，仍有自然露岩且资源成本有界', () => {
  const cave = createIslandCave(new THREE.Group(), { heightAt });
  const portal = cave.group.getObjectByName('厚岩拱与裂隙洞口');
  const plants = ['洞口贴岩苔草与小蕨', '洞口下垂藤蔓'].map(name => cave.group.getObjectByName(name));
  cave.group.updateWorldMatrix(true, true);
  const ray = new THREE.Raycaster(), regions = { top: [0, 0], left: [0, 0], right: [0, 0] };
  for (let side = -4.6; side <= 4.6; side += .32) {
    for (let height = .85; height <= 6.1; height += .32) {
      const origin = point(side, height, 5), dir = point(side, height, -1).sub(origin).normalize();
      ray.set(origin, dir);
      const rock = ray.intersectObject(portal)[0];
      if (!rock) continue;
      const region = height > 4.5 ? regions.top : side < 0 ? regions.left : regions.right;
      region[0]++;
      const leaf = ray.intersectObjects(plants)[0];
      if (leaf && leaf.distance < rock.distance + .015) region[1]++;
    }
  }
  for (const [region, [rock, green]] of Object.entries(regions)) {
    const coverage = green / rock;
    assert.ok(coverage >= .60 && coverage < .92, `${region} 实际叶面覆盖应连续并保留露岩，当前 ${(coverage * 100).toFixed(1)}%`);
  }
  const bytes = plants.reduce((sum, mesh) => sum + Object.values(mesh.geometry.attributes)
    .reduce((count, attribute) => count + attribute.array.byteLength, 0) + mesh.geometry.index.array.byteLength, 0);
  const triangles = plants.reduce((sum, mesh) => sum + mesh.geometry.index.count / 3, 0);
  assert.ok(bytes < 4.5 * 1024 * 1024 && triangles < 60000, '连续覆盖应保持少量共享批次和适合手机的几何成本');
  cave.dispose();
});
