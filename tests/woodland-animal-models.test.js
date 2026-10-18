import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const api = await import('../src/models/woodland-animals.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
function create(kind, capacity = 5) {
  assert.equal(typeof api.createWoodlandAnimalMeshes, 'function', '需要真实的林鸟和松鼠模型工厂');
  return api.createWoodlandAnimalMeshes(kind, capacity);
}
function bounds(mesh) {
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox;
}
function release(model) {
  const resources = new Set(model.meshes.flatMap(mesh => [mesh, mesh.geometry, mesh.material]));
  for (const resource of resources) resource.dispose();
}

test('两种林间动物提供可独立运动的完整网格集合与同等实例容量', () => {
  for (const kind of ['bird', 'squirrel']) {
    const model = create(kind, 7);
    try {
      assert.deepEqual(model.meshes, [model.body, ...model.wings, ...(model.tail ? [model.tail] : []), ...model.legs]);
      assert.equal(new Set(model.meshes).size, model.meshes.length);
      for (const mesh of model.meshes) {
        assert.ok(mesh.isInstancedMesh);
        assert.equal(mesh.instanceMatrix.count, 7);
        assert.equal(mesh.count, 7);
        assert.equal(mesh.instanceMatrix.usage, THREE.DynamicDrawUsage);
        assert.equal(mesh.frustumCulled, false);
        assert.equal(mesh.castShadow, false);
        assert.equal(mesh.userData.woodlandAnimal, true);
        const matrix = new THREE.Matrix4();
        for (let index = 0; index < 7; index++) {
          mesh.getMatrixAt(index, matrix);
          assert.ok(matrix.elements.every(Number.isFinite));
          assert.ok(matrix.determinant() > 0, '真实模型不依赖负实例缩放');
        }
      }
    } finally { release(model); }
  }
});

test('模型顶点、法线和毛色完整有限，不依赖纹理且资源可以统一去重释放', () => {
  for (const kind of ['bird', 'squirrel']) {
    const model = create(kind);
    try {
      const resources = new Set();
      for (const mesh of model.meshes) {
        const { position, normal, color } = mesh.geometry.attributes;
        assert.ok(position.count > 30);
        assert.equal(normal.count, position.count);
        assert.equal(color.count, position.count);
        for (const attribute of [position, normal, color]) assert.ok(attribute.array.every(Number.isFinite));
        assert.ok(new Set(color.array).size > 4, '应保留真实毛色细节');
        assert.equal(mesh.material.vertexColors, true);
        assert.equal(mesh.material.map, null);
        resources.add(mesh.geometry); resources.add(mesh.material);
      }
      assert.ok(resources.size <= model.meshes.length + 2, '有限的共享材质可从网格直接回收');
      const disposed = new Map([...resources].map(resource => [resource, 0]));
      for (const resource of resources) resource.addEventListener('dispose', () => disposed.set(resource, disposed.get(resource) + 1));
      for (const resource of resources) resource.dispose();
      assert.ok([...disposed.values()].every(count => count === 1));
    } finally { release(model); }
  }
});

test('林鸟身体保持小型鸟尺度、脚接地高度与左右翼的真实镜像几何', () => {
  const model = create('bird');
  try {
    assert.equal(model.body.name, '林鸟身体');
    assert.deepEqual(model.wings.map(mesh => mesh.name), ['林鸟右翼', '林鸟左翼']);
    assert.equal(model.tail, null); assert.deepEqual(model.legs, []);
    const body = bounds(model.body), size = body.getSize(new THREE.Vector3());
    assert.ok(size.z >= .30 && size.z <= .37);
    assert.ok(size.x >= .13 && size.x <= .18);
    assert.ok(Math.abs(body.min.y + .10) < .003);
    const right = bounds(model.wings[0]), left = bounds(model.wings[1]);
    assert.ok(right.min.x >= -.001 && right.max.x > .20);
    assert.ok(left.max.x <= .001 && left.min.x < -.20);
    assert.ok(right.min.z < -.08, '展开的翼梢向尾部延伸');
    const a = model.wings[0].geometry.attributes.position, b = model.wings[1].geometry.attributes.position;
    assert.equal(a.count, b.count);
    for (let index = 0; index < a.count; index++) {
      assert.ok(Math.abs(a.getX(index) + b.getX(index)) < 1e-6);
      assert.ok(Math.abs(a.getY(index) - b.getY(index)) < 1e-6);
      assert.ok(Math.abs(a.getZ(index) - b.getZ(index)) < 1e-6);
    }
    const folded = model.wings[0].geometry.clone().rotateY(1.2);
    folded.computeBoundingBox();
    assert.ok(folded.boundingBox.max.x < right.max.x * .6, '绕身体原点收翼后横向轮廓明显缩小');
    folded.dispose();
  } finally { release(model); }
});

test('松鼠具有向后上方弯曲、粗细有变化的独立蓬尾及四个接地爪', () => {
  const model = create('squirrel');
  try {
    assert.equal(model.body.name, '松鼠身体'); assert.deepEqual(model.wings, []);
    assert.equal(model.tail.name, '松鼠蓬尾');
    assert.deepEqual(model.legs.map(mesh => mesh.name), ['松鼠左前爪', '松鼠右前爪', '松鼠左后爪', '松鼠右后爪']);
    const body = bounds(model.body), tail = bounds(model.tail);
    assert.ok(body.max.z > .23 && body.min.z < -.17);
    assert.ok(body.max.x - body.min.x >= .15 && body.max.x - body.min.x < .21);
    assert.ok(body.min.y > -.10, '身体不合并接地四肢');
    assert.ok(tail.min.z < -.32 && tail.max.y > .28, '尾巴必须形成明显向后上弯的轮廓');
    assert.ok(tail.max.x - tail.min.x > .12, '尾巴需要蓬松厚度');
    const p = model.tail.geometry.attributes.position;
    const root = [], middle = [];
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < .04 && p.getZ(i) > -.20) root.push(Math.abs(p.getX(i)));
      if (p.getY(i) > .12) middle.push(Math.abs(p.getX(i)));
    }
    assert.ok(root.length > 0 && middle.length > 0);
    assert.ok(Math.max(...middle) > Math.max(...root) * 2, '蓬尾中段应明显粗于尾根');
    model.legs.forEach((mesh, index) => {
      const box = bounds(mesh);
      assert.ok(Math.abs(box.min.y + .13) < .003);
      assert.ok(index % 2 === 0 ? box.max.x < 0 : box.min.x > 0);
      assert.ok(index < 2 ? box.min.z > .07 : box.max.z < -.06);
    });
  } finally { release(model); }
});

test('模型构建状态彼此独立，拒绝不受支持的动物和非法容量', () => {
  const first = create('bird'), second = create('bird');
  try {
    assert.notEqual(first.body.material, second.body.material);
    assert.notEqual(first.body.geometry, second.body.geometry);
    first.body.count = 0; assert.equal(second.body.count, 5);
    assert.throws(() => create('fox'), /kind|种类/);
    for (const capacity of [-1, 1.2, NaN, Infinity]) assert.throws(() => create('bird', capacity), /capacity|容量/);
  } finally { release(first); release(second); }
});

test('蓬尾两侧法线朝外，普通单面材质也能显示完整轮廓', () => {
  const model = create('squirrel');
  try {
    const { position, normal } = model.tail.geometry.attributes;
    let checked = 0;
    for (let i = 0; i < position.count; i++) {
      if (Math.abs(position.getX(i)) > .04 && position.getY(i) > .1) {
        assert.ok(position.getX(i) * normal.getX(i) > 0, '蓬尾表面不应朝向内部');
        checked++;
      }
    }
    assert.ok(checked > 20);
  } finally { release(model); }
});
