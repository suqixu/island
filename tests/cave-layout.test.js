import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { heightAt } from '../src/terrain.js';

const layoutModule = await import('../src/cave-layout.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});
const caveModule = await import('../src/island-cave.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});
const api = () => {
  assert.ok(layoutModule && caveModule, '山洞应提供真实地形缺口和隧道');
  return { ...layoutModule, ...caveModule };
};

function terrain() {
  const geometry = new THREE.PlaneGeometry(310, 310, 256, 256);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index++) {
    position.setY(index, heightAt(position.getX(index), position.getZ(index)));
  }
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }));
}

function hits(mesh, origin, target) {
  mesh.updateWorldMatrix(true, false);
  const direction = target.clone().sub(origin).normalize();
  return new THREE.Raycaster(origin, direction, 0, origin.distanceTo(target)).intersectObject(mesh, false);
}

test('洞口面向默认镜头、路口贴近坡面，深处岩顶处于山体内', () => {
  const { CAVE_LAYOUT, caveToWorld } = api();
  const { entrance, approach, direction } = CAVE_LAYOUT;
  assert.ok(direction.x > 0 && direction.z > 0);
  assert.ok(Math.abs(Math.hypot(direction.x, direction.z) - 1) < 1e-8);
  const cameraDirection = new THREE.Vector3(160 - entrance.x, 0, 200 - entrance.z).normalize();
  assert.ok(cameraDirection.dot(new THREE.Vector3(direction.x, 0, direction.z)) > .99);
  assert.ok(Math.abs(approach.y - heightAt(approach.x, approach.z)) < .35);
  for (const depth of [3, 5, 8]) {
    const roof = caveToWorld(0, CAVE_LAYOUT.height, -depth);
    assert.ok(heightAt(roof.x, roof.z) > roof.y + 1, '隧道岩顶不得浮在山坡上');
  }
});

test('预留区覆盖入口与隧道，邻近道路和岛外不被大范围屏蔽', () => {
  const { CAVE_LAYOUT, isCaveReserved, caveToWorld } = api();
  assert.ok(isCaveReserved(CAVE_LAYOUT.entrance.x, CAVE_LAYOUT.entrance.z));
  const interior = caveToWorld(0, 0, -6);
  assert.ok(isCaveReserved(interior.x, interior.z));
  assert.equal(isCaveReserved(55, 55), false);
  assert.equal(isCaveReserved(0, 0), false);
  const edge = caveToWorld(5.5, 0, 0);
  assert.equal(isCaveReserved(edge.x, edge.z), false);
  assert.ok(isCaveReserved(edge.x, edge.z, 2));
  assert.equal(isCaveReserved(NaN, Infinity), false);
  const cameraCorridor = caveToWorld(0, 0, 20);
  assert.ok(isCaveReserved(cameraCorridor.x, cameraCorridor.z), '入口镜头前的树冠须避让视线');
  const corridorEdge = caveToWorld(8, 0, 20);
  assert.equal(isCaveReserved(corridorEdge.x, corridorEdge.z), false, '只清理狭窄视线，不清空周围树林');
});

test('缺口真实移除地形三角形，可穿过洞口，同时保留邻近山坡与阴影几何', () => {
  const { CAVE_LAYOUT, applyCaveOpening, caveToWorld } = api();
  const mesh = terrain();
  const original = Array.from(mesh.geometry.index.array);
  const origin = new THREE.Vector3(160, 68, 200);
  const inside = caveToWorld(0, 2.1, -4);
  const target = new THREE.Vector3(inside.x, inside.y, inside.z);
  assert.ok(hits(mesh, origin, target).length > 0, '未开洞的坡面应挡住内部');
  const removed = applyCaveOpening(mesh);
  assert.ok(removed > 0 && removed < 100, '只删除洞口周围有限网格');
  assert.equal(mesh.geometry.index.count, original.length - removed * 3);
  assert.equal(hits(mesh, origin, target).length, 0, '地形不应继续挡住真实洞口');
  const nearby = caveToWorld(7, 1.5, -4);
  assert.ok(hits(mesh, origin, new THREE.Vector3(nearby.x, nearby.y, nearby.z)).length > 0);
  const shadowMesh = new THREE.Mesh(mesh.geometry, new THREE.MeshDepthMaterial({ side: THREE.DoubleSide }));
  assert.equal(hits(shadowMesh, origin, target).length, 0, '阴影使用同一真实缺口');
  assert.equal(applyCaveOpening(mesh), 0, '重复接线不能继续扩大洞口');
  mesh.geometry.dispose(); mesh.material.dispose(); shadowMesh.material.dispose();
});

test('隧道有顶壁地面和深处实体岩壁，入口空心且几何索引全部有效', () => {
  const { CAVE_LAYOUT, createIslandCave, caveToWorld } = api();
  const parent = new THREE.Group();
  const cave = createIslandCave(parent, { heightAt });
  assert.equal(parent.children.length, 1);
  assert.ok(cave.count.meshes >= 4 && cave.count.tunnelLength >= 7);
  const meshes = [];
  cave.group.traverse(object => { if (object.isMesh) meshes.push(object); });
  for (const mesh of meshes) {
    const { position } = mesh.geometry.attributes;
    assert.ok(Array.from(position.array).every(Number.isFinite));
    if (mesh.geometry.index) {
      assert.ok(Array.from(mesh.geometry.index.array).every(index => index >= 0 && index < position.count));
    }
    assert.equal(mesh.material.isMeshStandardMaterial, true);
  }
  parent.updateWorldMatrix(true, true);
  const outside = caveToWorld(0, 2, 9);
  const center = caveToWorld(0, 2, -CAVE_LAYOUT.depth - 2);
  const ray = new THREE.Raycaster(new THREE.Vector3(outside.x, outside.y, outside.z),
    new THREE.Vector3(center.x - outside.x, center.y - outside.y, center.z - outside.z).normalize());
  const intersections = ray.intersectObject(cave.group, true);
  assert.ok(intersections.length > 0, '洞的深处必须有实际岩壁');
  assert.ok(intersections[0].distance > 14, '入口中心不应被黑色平片或岩拱堵住');
  const tunnel = meshes.find(mesh => mesh.name === '天然岩洞内壁');
  assert.ok(tunnel);
  const colors = tunnel.geometry.attributes.color.array;
  const brightness = index => colors[index] + colors[index + 1] + colors[index + 2];
  assert.ok(brightness(0) > brightness(colors.length - 3) * 2, '深处逐层暗下来');
  cave.dispose();
});

test('洞口预设镜头射向左右、屋顶及地面的光线全部被实体洞壁封闭', () => {
  const { createIslandCave, caveToWorld } = api();
  const parent = new THREE.Group(), cave = createIslandCave(parent, { heightAt });
  parent.updateWorldMatrix(true, true);
  const outside = caveToWorld(0, 6, 20);
  const origin = new THREE.Vector3(outside.x, outside.y, outside.z);
  for (let side = -2.6; side <= 2.6; side += .1) {
    for (let height = .5; height <= 4.9; height += .1) {
      const target = caveToWorld(side, height, 0);
      const ray = new THREE.Raycaster(origin, new THREE.Vector3(target.x, target.y, target.z).sub(origin).normalize());
      assert.ok(ray.intersectObject(cave.group, true).length > 0,
        `洞口不应透出天空：side=${side.toFixed(2)}, height=${height.toFixed(2)}`);
    }
  }
  cave.dispose();
});

test('天然岩缘有有限轻微不规则形状，近景材质包含真实石纹和凹凸', () => {
  const { caveProfile, createIslandCave } = api();
  const profile = caveProfile();
  const asymmetry = profile.reduce((sum, point, index) => sum + Math.abs(point[1] - profile[profile.length - 1 - index][1]), 0);
  assert.ok(asymmetry > .1, '内缘不应是完全对称的光滑椭圆');
  assert.ok(profile.every(([side, height]) => Number.isFinite(side) && Number.isFinite(height)
    && Math.abs(side) < 3.5 && height >= 0 && height < 5.5));
  const cave = createIslandCave(new THREE.Group(), { heightAt });
  const material = cave.group.getObjectByName('厚岩拱与裂隙洞口').material;
  assert.ok(material.map?.isDataTexture && material.bumpMap?.isDataTexture);
  assert.notEqual(material.map, material.bumpMap, '石材颜色与实际高度必须独立');
  assert.ok(material.map.image.width >= 128 && material.map.image.height >= 128);
  assert.ok(new Set(material.map.image.data).size > 20);
  const values = [];
  for (let index = 0; index < material.map.image.data.length; index += 4) values.push(material.map.image.data[index]);
  const contrast = Math.max(...values) - Math.min(...values);
  assert.ok(contrast > 50 && contrast < 130, '矿物与裂隙应可辨，但不能变成黑白花斑');
  assert.ok(values.filter(value => value < 170).length / values.length < .015,
    '深色裂隙只占少量表面，不应大范围涂黑岩壁');
  assert.ok(values.reduce((sum, value) => sum + value, 0) / values.length > 220);
  const heights = [];
  for (let index = 0; index < material.bumpMap.image.data.length; index += 4) heights.push(material.bumpMap.image.data[index]);
  const heightRange = (Math.max(...heights) - Math.min(...heights)) / 255 * material.bumpScale;
  assert.ok(heightRange > .055 && heightRange < .13, '岩层凹凸需在近景可读，并保持厘米级而非尖锐大起伏');
  assert.equal(material.map.generateMipmaps, true);
  assert.equal(material.bumpMap.minFilter, THREE.LinearMipmapLinearFilter);
  cave.dispose();
});

test('关闭阴影时内部仍有平滑遮蔽，洞外落脚点保持正常受光', () => {
  const { getCaveInteriorLightFactor } = api();
  assert.equal(typeof getCaveInteriorLightFactor, 'function');
  assert.ok(getCaveInteriorLightFactor(0) < .5);
  assert.ok(getCaveInteriorLightFactor(-5) < .035, '深处仅剩微弱轮廓，不应被入口光照亮');
  assert.equal(getCaveInteriorLightFactor(3.1), 1);
  for (let forward = -10; forward <= 5; forward += .05) {
    const shade = getCaveInteriorLightFactor(forward);
    assert.ok(shade >= .005 && shade <= 1);
    assert.ok(Math.abs(shade - getCaveInteriorLightFactor(forward + .01)) < .015);
  }
  assert.ok(Number.isFinite(getCaveInteriorLightFactor(NaN)));
});

test('洞道向山体延伸并转弯，洞口视线先遇到侧壁而非尽头', () => {
  const { createIslandCave, caveToWorld }=api();
  const cave=createIslandCave(new THREE.Group(),{heightAt});
  const wall=cave.group.getObjectByName('天然岩洞内壁'),end=cave.group.getObjectByName('洞穴深处不规则岩壁');
  cave.group.updateWorldMatrix(true,true);
  const endBounds=new THREE.Box3().setFromObject(end),target=endBounds.getCenter(new THREE.Vector3());
  const p=caveToWorld(0,2,9),origin=new THREE.Vector3(p.x,p.y,p.z);
  const ray=new THREE.Raycaster(origin,target.clone().sub(origin).normalize());
  assert.ok(cave.count.tunnelLength>=16,'洞道应实际延伸到山体内部');
  const hits=ray.intersectObjects([wall,end],false);
  assert.ok(hits.length>0);assert.equal(hits[0].object.name,'天然岩洞内壁','弯道挡住尽头，不能用洞口黑片遮挡');
  assert.ok(hits[0].distance>14,'入口通道仍然畅通');
  cave.dispose();
});

test('真实手机预设的两侧白边是封闭内壁，其烘焙明度低于外侧岩石', () => {
  const { createIslandCave, caveToWorld } = api();
  const parent = new THREE.Group(), cave = createIslandCave(parent, { heightAt });
  parent.updateWorldMatrix(true, true);
  const camera = new THREE.PerspectiveCamera(54, 320 / 740, .5, 65000);
  const from = caveToWorld(0, 6, 20), target = caveToWorld(0, 2.3, 0);
  camera.position.set(from.x, from.y, from.z); camera.lookAt(target.x, target.y, target.z); camera.updateMatrixWorld();
  const ray = new THREE.Raycaster(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const reference = new THREE.Color(0x969184);
  for (const [x, y] of [[52, 350], [53, 375], [55, 415], [58, 425], [257, 330], [265, 365], [267, 395], [266, 425], [145, 402]]) {
    ray.setFromCamera(new THREE.Vector2(x / 320 * 2 - 1, 1 - y / 740 * 2), camera);
    const hit = ray.intersectObject(cave.group, true)[0];
    assert.ok(hit?.object.name === '厚岩拱与裂隙洞口' || hit?.object.name === '天然岩洞内壁'
      || hit?.object.name === '洞穴坡口与地面', '白边应由实体岩壁遮挡，不透出天空');
    const geometry = hit.object.geometry, p = geometry.attributes.position, color = geometry.attributes.color;
    a.fromBufferAttribute(p, hit.face.a); b.fromBufferAttribute(p, hit.face.b); c.fromBufferAttribute(p, hit.face.c);
    const bary = THREE.Triangle.getBarycoord(hit.point, a, b, c, new THREE.Vector3());
    const green = color.getY(hit.face.a) * bary.x + color.getY(hit.face.b) * bary.y + color.getY(hit.face.c) * bary.z;
    assert.ok(green < reference.g * .48, `内部不应在无阴影时成为明亮白边：${x},${y}`);
  }
  cave.dispose();
});

test('山洞释放所有独占材质和几何，重复释放安全，异常地形回调不产生无效坐标', () => {
  const { createIslandCave } = api();
  const parent = new THREE.Group();
  const cave = createIslandCave(parent, { heightAt: () => NaN });
  const geometries = new Set(), materials = new Set(), textures = new Set();
  cave.group.traverse(object => {
    if (!object.isMesh) return;
    geometries.add(object.geometry); materials.add(object.material);
    if (object.material.map) textures.add(object.material.map);
    if (object.material.bumpMap) textures.add(object.material.bumpMap);
    assert.ok(Array.from(object.geometry.attributes.position.array).every(Number.isFinite));
  });
  let disposed = 0;
  for (const resource of [...geometries, ...materials, ...textures]) resource.addEventListener('dispose', () => disposed++);
  cave.dispose();
  assert.equal(parent.children.length, 0);
  assert.equal(disposed, geometries.size + materials.size + textures.size);
  cave.dispose();
  assert.equal(disposed, geometries.size + materials.size + textures.size);
});
