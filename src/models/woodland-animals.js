import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {attachSquirrelSurface} from '../squirrel-texture.js';

function tint(geometry, top, belly = top) {
  const position = geometry.attributes.position, colors = new Float32Array(position.count * 3);
  const upper = new THREE.Color(top), lower = new THREE.Color(belly), shade = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    shade.copy(upper).lerp(lower, THREE.MathUtils.smoothstep(-position.getY(i), -.1, .8));
    shade.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function ellipsoid(x, y, z, sx, sy, sz, color, belly = color, yaw = 0) {
  return tint(new THREE.SphereGeometry(1, 12, 8), color, belly)
    .scale(sx, sy, sz).rotateY(yaw).translate(x, y, z);
}

function segment(from, to, radius, color, endRadius = radius) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a);
  const geometry = tint(new THREE.CylinderGeometry(endRadius, radius, direction.length(), 7), color);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
  geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return geometry;
}

function merge(parts) {
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error('林间动物模型几何无法合并');
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

function birdShape() {
  const parts = [
    ellipsoid(0, 0, -.018, .075, .058, .106, '#6c7050', '#d1c5a0'),
    ellipsoid(0, .021, .066, .056, .054, .064, '#7c7857', '#d5caa8'),
    ellipsoid(0, .047, .112, .041, .041, .037, '#72734f', '#c3b98e'),
    segment([0, .04, .137], [0, .036, .171], .011, '#493e2a', .001),
  ];
  for (const side of [-1, 1]) {
    parts.push(ellipsoid(side * .034, .060, .126, .008, .009, .008, '#171c17'));
    parts.push(ellipsoid(side * .036, .063, .131, .002, .002, .002, '#ded8b4'));
    parts.push(segment([side * .027, -.043, .008], [side * .033, -.094, .018], .003, '#7a6244'));
    parts.push(ellipsoid(side * .033, -.097, .025, .004, .003, .016, '#786043'));
    for (const toe of [-1, 1]) parts.push(segment([side * .033, -.096, .025], [side * .033 + toe * .009, -.097, .043], .002, '#786043'));
  }
  // 细长尾羽属于身体，扑翼时保持尾扇稳定。
  for (let feather = -1; feather <= 1; feather++) {
    parts.push(ellipsoid(feather * .014, -.003, -.132, .013, .006, .051, feather === 0 ? '#4d5140' : '#636346', '#8d8764', -feather * .10));
  }
  const wingParts = [ellipsoid(.108, .018, -.015, .093, .012, .044, '#626746', '#a29a72', .40)];
  for (let feather = 0; feather < 5; feather++) {
    wingParts.push(ellipsoid(.155 + feather * .013, .014, -.045 - feather * .011,
      .064 - feather * .005, .006, .013, feather % 2 ? '#50563c' : '#737550', '#b0a786', .57 + feather * .035));
  }
  const right = merge(wingParts), left = right.clone();
  left.scale(-1, 1, 1);
  // 镜像改变面朝向，反转三角形绕序后仍可使用普通正缩放实例。
  const index = left.index;
  for (let i = 0; i < index.count; i += 3) {
    const second = index.getX(i + 1); index.setX(i + 1, index.getX(i + 2)); index.setX(i + 2, second);
  }
  left.computeVertexNormals(); left.computeBoundingBox(); left.computeBoundingSphere();
  return { body: merge(parts), wings: [right, left], tail: null, legs: [] };
}

function squirrelTail() {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, .012, -.17), new THREE.Vector3(0, .052, -.255),
    new THREE.Vector3(0, .145, -.335), new THREE.Vector3(0, .25, -.325),
    new THREE.Vector3(0, .302, -.259), new THREE.Vector3(0, .282, -.212),
  ]);
  const radii = [.014, .029, .059, .076, .058, .006], rings = 30, sides = 12;
  const positions = [], colors = [], indices = [], uvs=[],cross = new THREE.Vector3();
  const dark = new THREE.Color('#7b4a2b'), light = new THREE.Color('#b88a54'), shade = new THREE.Color();
  for (let ring = 0; ring <= rings; ring++) {
    const t = ring / rings, center = curve.getPoint(t), tangent = curve.getTangent(t);
    cross.set(0, -tangent.z, tangent.y).normalize();
    const band = t * (radii.length - 1), row = Math.min(radii.length - 2, Math.floor(band));
    const radius = THREE.MathUtils.lerp(radii[row], radii[row + 1], THREE.MathUtils.smoothstep(band - row, 0, 1));
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * Math.PI * 2;
      // 沿尾巴排列的细小轮廓起伏表现蓬毛，不增加独立网格。
      const fluff = 1 + .075 * Math.cos(angle * 5 + ring * 1.9);
      const u = Math.cos(angle) * radius * fluff, v = Math.sin(angle) * radius * fluff;
      positions.push(center.x + u, center.y + cross.y * v, center.z + cross.z * v);
      uvs.push(side/sides,ring/rings);
      shade.copy(dark).lerp(light, .3 + .42 * Math.max(0, Math.sin(angle)) + .12 * Math.sin(ring * 1.3));
      shade.toArray(colors, colors.length);
    }
  }
  for (let ring = 0; ring < rings; ring++) for (let side = 0; side < sides; side++) {
    const a = ring * (sides + 1) + side, b = a + sides + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  // 尾根和尾尖封口，转动后也不会露出空心断面。
  for (const ring of [0, rings]) {
    const center = curve.getPoint(ring / rings), vertex = positions.length / 3;
    positions.push(center.x, center.y, center.z); dark.toArray(colors, colors.length);
    uvs.push(.5,ring/rings);
    for (let side = 0; side < sides; side++) {
      const a = ring * (sides + 1) + side;
      if (ring === 0) indices.push(vertex, a, a + 1); else indices.push(vertex, a + 1, a);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

function squirrelShape() {
  const parts = [
    ellipsoid(0, -.001, -.025, .08, .071, .15, '#915a33', '#c6a273'),
    ellipsoid(0, -.008, .087, .059, .062, .078, '#a06a3f', '#d2b48a'),
    ellipsoid(0, .029, .19, .056, .054, .060, '#a87040', '#d4b48a'),
    ellipsoid(0, .004, .234, .034, .025, .023, '#d0aa78'),
    ellipsoid(0, .012, .257, .012, .009, .009, '#382b22'),
  ];
  for (const side of [-1, 1]) {
    parts.push(ellipsoid(side * .037, .086, .165, .021, .035, .014, '#87512f'));
    parts.push(ellipsoid(side * .037, .088, .176, .012, .023, .003, '#c28e64'));
    parts.push(ellipsoid(side * .048, .047, .216, .009, .011, .009, '#181c17'));
    parts.push(ellipsoid(side * .051, .051, .221, .0025, .0025, .0025, '#e0d4b7'));
  }
  const legs = [];
  for (const front of [true, false]) for (const side of [-1, 1]) {
    const x = side * .075, z = front ? .12 : -.12, radius = front ? .015 : .022;
    legs.push(merge([
      ellipsoid(x, -.025, z, radius * 1.25, .036, front ? .023 : .033, '#976038', '#ba9262'),
      segment([x, -.027, z], [x, -.095, z + (front ? -.009 : .005)], radius, '#9e6b42', radius * .70),
      ellipsoid(x, -.118, z + .015, front ? .016 : .019, .012, .032, '#b48a58', '#d0ac7b'),
      ...[-1, 0, 1].map(toe => segment([x + toe * .007, -.122, z + .028], [x + toe * .007, -.123, z + .045], .002, '#6c4c33')),
    ]));
  }
  return { body: merge(parts), wings: [], tail: squirrelTail(), legs };
}

/** +Z 朝前、+Y 向上；全部附肢使用身体原点，供运行层独立组合旋转。 */
export function createWoodlandAnimalMeshes(kind, capacity,{fur}={}) {
  if (kind !== 'bird' && kind !== 'squirrel') throw new RangeError(`不支持的动物种类 kind: ${kind}`);
  if (!Number.isInteger(capacity) || capacity < 0) throw new RangeError('实例容量 capacity 必须是非负整数');
  const shape = kind === 'bird' ? birdShape() : squirrelShape();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .86, metalness: 0 });
  const meshes = [];
  function batch(geometry, name) {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.userData.woodlandAnimal = true;
    meshes.push(mesh); return mesh;
  }
  const name = kind === 'bird' ? '林鸟' : '松鼠';
  const body = batch(shape.body, `${name}身体`);
  const wings = shape.wings.map((geometry, index) => batch(geometry, `林鸟${index ? '左' : '右'}翼`));
  const tail = shape.tail ? batch(shape.tail, '松鼠蓬尾') : null;
  const legNames = ['左前爪', '右前爪', '左后爪', '右后爪'];
  const legs = shape.legs.map((geometry, index) => batch(geometry, `松鼠${legNames[index]}`));
  let look;
  if(kind==='squirrel'){
    look=new THREE.InstancedBufferAttribute(new Float32Array(capacity*2),2);
    for(const mesh of meshes){const p=mesh.geometry.attributes.position;mesh.geometry.setAttribute('aSquirrelHead',new THREE.Float32BufferAttribute(Array.from({length:p.count},(_,i)=>mesh===body?THREE.MathUtils.smoothstep(p.getZ(i),.115,.16):0),1));mesh.geometry.setAttribute('aSquirrelLook',look);}
    attachSquirrelSurface(material,fur??{uSquirrelFur:{value:null},uSquirrelFurEnabled:{value:0}});
  }
  return { body, wings, tail, legs, meshes,look };
}
