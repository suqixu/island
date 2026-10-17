import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createLagoonHabitats, getLagoonResidentPose } from './lagoon-life-motion.js';
import { LAGOON_LAYOUT } from './lagoon.js';

const TAU = Math.PI * 2;
const QUALITY = { high: { fish: 42, turtle: 3, crab: 8, lobster: 5 },
  medium: { fish: 33, turtle: 3, crab: 6, lobster: 4 }, low: { fish: 24, turtle: 2, crab: 4, lobster: 3 } };
function tint(geometry, color) {
  geometry.deleteAttribute('uv');
  const rgb = new THREE.Color(color), values = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < values.length; i += 3) rgb.toArray(values, i);
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3)); return geometry;
}
function merge(parts) {
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error('泻湖生物模型无法合并');
  geometry.computeBoundingSphere(); return geometry;
}
function ellipsoid(x, y, z, sx, sy, sz, color, segments = 12) {
  return tint(new THREE.SphereGeometry(1, segments, 8).scale(sx, sy, sz).translate(x, y, z), color);
}
function bar(from, to, radius, color, segments = 6) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), d = b.clone().sub(a);
  const geometry = new THREE.CylinderGeometry(radius, radius * .82, d.length(), segments);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); return tint(geometry, color);
}
function fin(points, color, thickness = .004) {
  const vertices = points.map(p => new THREE.Vector3(...p));
  const axis = vertices[1].clone().sub(vertices[0]).normalize();
  const normal = vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).normalize();
  const vertical = normal.clone().cross(axis);
  const contour = vertices.map(p => { const d = p.clone().sub(vertices[0]); return new THREE.Vector2(d.dot(axis), d.dot(vertical)); });
  const faces = THREE.ShapeUtils.triangulateShape(contour, []), positions = [], indices = [], n = vertices.length;
  for (const side of [1, -1]) for (const p of vertices) positions.push(p.x + normal.x * thickness * side,
    p.y + normal.y * thickness * side, p.z + normal.z * thickness * side);
  for (const [a, b, c] of faces) indices.push(a, b, c, n + c, n + b, n + a);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; indices.push(i, n + i, j, j, n + i, n + j); }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return tint(geometry, color);
}
function fishModel(species) {
  const palettes = [['#74a4b8', '#e0e4d7', '#698ba4'], ['#d3b65a', '#eee3b1', '#ac9148'], ['#b97555', '#e6c09b', '#996f59']];
  const [back, belly, finColor] = palettes[species], positions = [], colors = [], indices = [];
  const sections = [[-.32, .02, .04], [-.24, .047, .075], [-.08, .105, .145], [.13, .102, .15], [.32, .065, .097], [.46, .004, .014]];
  const upper = new THREE.Color(back), lower = new THREE.Color(belly), shade = new THREE.Color(), dark = new THREE.Color('#665434');
  for (let row = 0; row < sections.length; row++) for (let i = 0; i <= 16; i++) {
    const [z, width, height] = sections[row], angle = i / 16 * TAU;
    positions.push(Math.cos(angle) * width, Math.sin(angle) * height, z);
    shade.copy(upper).lerp(lower, THREE.MathUtils.smoothstep(-Math.sin(angle), -.05, .8));
    if (species === 1 && row % 2 === 0 && row > 0 && row < 5) shade.lerp(dark, .48);
    shade.toArray(colors, colors.length);
  }
  for (let row = 0; row < sections.length - 1; row++) for (let i = 0; i < 16; i++) {
    const a = row * 17 + i, b = a + 17; indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const body = new THREE.BufferGeometry(); body.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  body.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); body.setIndex(indices); body.computeVertexNormals();
  const parts = [body, fin([[0, .11, -.23], [0, .215, -.08], [0, .14, .16]], finColor)];
  for (const side of [-1, 1]) {
    parts.push(fin([[.082 * side, -.02, .17], [.17 * side, -.075, .04], [.08 * side, -.06, -.045]], finColor));
    parts.push(ellipsoid(.048 * side, .025, .354, .015, .016, .016, '#12232a', 8));
  }
  return { body: merge(parts), tail: fin([[0, -.035, 0], [0, -.215, -.23], [0, 0, -.155],
    [0, .215, -.23], [0, .035, 0]], finColor), tailPivot: -.32 };
}
function turtleModel() {
  const shell = new THREE.SphereGeometry(1, 24, 12, 0, TAU, 0, Math.PI / 2).scale(.276, .205, .372).translate(0, -.014, -.015);
  tint(shell, '#8b9460');
  const p = shell.attributes.position, colors = shell.attributes.color, light = new THREE.Color('#939c6c'), dark = new THREE.Color('#4d6345');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), theta = Math.atan2(x / .276, z / .372);
    const ring = Math.hypot(x / .276, z / .372);
    const edge = Math.min(Math.abs(Math.sin(theta * 3 + (ring < .55 ? .75 : 0))), Math.abs(ring - .53) * 9);
    const color = light.clone().lerp(dark, edge < .13 ? .75 : .08 + ring * .22); colors.setXYZ(i, color.r, color.g, color.b);
  }
  const parts = [shell, ellipsoid(0, -.03, -.015, .27, .052, .367, '#c6be87'),
    ellipsoid(0, .018, .365, .078, .07, .1, '#88966b'), ellipsoid(0, .024, .455, .09, .067, .075, '#a1a47a')];
  for (const side of [-1, 1]) parts.push(ellipsoid(.077 * side, .05, .472, .009, .01, .011, '#1e2921', 8));
  parts.push(fin([[-.025, -.025, -.355], [0, -.03, -.435], [.025, -.025, -.355]], '#74825a'));
  const front = fin([[0, 0, 0], [.15, -.007, -.017], [.245, -.018, -.16], [.13, -.012, -.21], [.035, 0, -.08]], '#89986c', .009);
  const rear = fin([[0, 0, 0], [.13, -.008, -.04], [.155, -.012, -.17], [.055, -.005, -.19]], '#7e8d63', .008);
  return { body: merge(parts), front, rear };
}
function clawModel(lobster) {
  const color = lobster ? '#ad7957' : '#bc956a';
  return merge([bar([0, 0, 0], [.025, .005, .09], .019, color),
    ellipsoid(.025, .005, .14, .044, .031, .061, color),
    bar([-.008, .005, .18], [-.013, .003, .25], .012, color),
    bar([.057, .005, .178], [.038, .003, .242], .015, color),
    ellipsoid(.004, .012, .117, .018, .025, .039, lobster ? '#c69366' : '#d4b181')]);
}
function crustaceanModel(lobster) {
  const color = lobster ? '#966745' : '#b49468', parts = [];
  if (lobster) {
    parts.push(ellipsoid(0, .135, .055, .092, .075, .15, color));
    for (let i = 0; i < 5; i++) parts.push(ellipsoid(0, .096 - i * .005, -.08 - i * .038,
      .087 - i * .008, .056 - i * .003, .029, i % 2 ? '#bd8c5e' : '#8c6040'));
    parts.push(fin([[-.045, .157, .17], [0, .16, .25], [.045, .157, .17]], '#a8794d'));
  } else {
    parts.push(ellipsoid(0, .12, 0, .183, .068, .145, color));
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) parts.push(fin([
      [.151 * side, .14, .1 - i * .055], [.199 * side, .115, .08 - i * .055], [.167 * side, .11, .045 - i * .055]], '#97865f'));
  }
  for (const side of [-1, 1]) {
    const x = (lobster ? .056 : .078) * side, z = lobster ? .17 : .13;
    parts.push(bar([x, .13, z], [x * 1.13, .207, z + .017], .01, color));
    parts.push(ellipsoid(x * 1.13, .207, z + .017, .018, .02, .019, '#242d23', 8));
  }
  return merge(parts);
}

/** Residents are always present; quality changes density without weather-driven hiding. */
export function createLagoonLife(scene, { heightAt, seed = 7319 } = {}) {
  const group = new THREE.Group(); group.name = '泻湖常驻生态'; scene.add(group);
  const homes = createLagoonHabitats(heightAt, seed), geometries = new Set(), meshes = [];
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .66, metalness: .025, emissiveIntensity: 0 });
  function batch(geometry, capacity, name, kind, role) {
    geometries.add(geometry); const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name; mesh.userData = { kind, role }; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0; mesh.visible = false;
    group.add(mesh); meshes.push(mesh); return mesh;
  }
  const fish = [0, 1, 2].map(species => {
    const model = fishModel(species);
    return { body: batch(model.body, 14, ['泻湖银蓝鱼', '泻湖金纹鱼', '泻湖珊瑚鱼'][species], 'fish', 'body'),
      tail: batch(model.tail, 14, `泻湖鱼尾鳍${species + 1}`, 'fish', 'tail'), pivot: model.tailPivot };
  });
  const turtleShape = turtleModel(), turtles = { body: batch(turtleShape.body, 3, '绿海龟龟壳与头', 'turtle', 'body'),
    front: batch(turtleShape.front, 6, '海龟前鳍', 'turtle', 'front'), rear: batch(turtleShape.rear, 6, '海龟后鳍', 'turtle', 'rear') };
  const legGeometry = tint(new THREE.CylinderGeometry(1, .82, 1, 6, 1), '#977752');
  const crabs = { body: batch(crustaceanModel(false), 8, '沙蟹甲壳与眼柄', 'crab', 'body'),
    claws: batch(clawModel(false), 16, '沙蟹双钳', 'crab', 'claw'), legs: batch(legGeometry, 128, '沙蟹步足', 'crab', 'leg') };
  const lobsters = { body: batch(crustaceanModel(true), 5, '龙虾头胸甲与分节腹部', 'lobster', 'body'),
    claws: batch(clawModel(true), 10, '龙虾双钳', 'lobster', 'claw'), legs: batch(legGeometry, 100, '龙虾步足', 'lobster', 'leg'),
    tail: batch(fin([[-.025, 0, 0], [-.13, 0, -.2], [0, -.005, -.15], [.13, 0, -.2], [.025, 0, 0]], '#ad8058'), 5, '龙虾尾扇', 'lobster', 'tail'),
    antenna: batch(merge([bar([0, 0, 0], [.055, .025, .2], .006, '#c9b18a'),
      bar([.055, .025, .2], [.1, .065, .37], .004, '#d5bd96')]), 10, '龙虾触须', 'lobster', 'antenna') };
  const root = new THREE.Object3D(), part = new THREE.Object3D(), localMatrix = new THREE.Matrix4();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), knee = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const segment = new THREE.Object3D(), direction = new THREE.Vector3();
  // Include every complete habitat loop, fins/legs and local seabed relief.
  // A single conservative test also keeps animals touching the screen edge.
  const habitatBounds = new THREE.Sphere(new THREE.Vector3(LAGOON_LAYOUT.center[0], -4, LAGOON_LAYOUT.center[1]),
    Math.max(...LAGOON_LAYOUT.axes) * 1.5);
  const worldBounds = new THREE.Sphere(), frustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4();
  let quality = QUALITY.high, disposed = false;
  function setRoot(pose, length) {
    root.position.fromArray(pose.position); root.rotation.set(-pose.pitch, pose.heading, pose.roll, 'YXZ');
    root.scale.setScalar(length); root.updateMatrix();
  }
  function writePart(mesh, index, position, rotation = [0, 0, 0], scale = [1, 1, 1]) {
    part.position.fromArray(position); part.rotation.set(...rotation); part.scale.fromArray(scale); part.updateMatrix();
    localMatrix.multiplyMatrices(root.matrix, part.matrix); mesh.setMatrixAt(index, localMatrix);
  }
  function legSegment(mesh, index, start, end, thickness) {
    direction.copy(start).sub(end); segment.position.copy(start).add(end).multiplyScalar(.5);
    const length = direction.length();
    segment.quaternion.setFromUnitVectors(up, direction.multiplyScalar(1 / length)); segment.scale.set(thickness, length, thickness);
    segment.updateMatrix(); mesh.setMatrixAt(index, segment.matrix);
  }
  function feet(model, home, pose, member) {
    const count = home.kind === 'crab' ? 4 : 5;
    for (let row = 0; row < count; row++) for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
      const side = sideIndex ? 1 : -1, gait = pose.legs[row * 2 + sideIndex];
      const z = home.kind === 'crab' ? .095 - row * .062 : .115 - row * .061;
      a.set(side * (home.kind === 'crab' ? .14 : .068), .112, z).applyMatrix4(root.matrix);
      b.set(side * (home.kind === 'crab' ? .46 : .3), 0, z + gait * .045).applyMatrix4(root.matrix);
      const floor = heightAt?.(b.x, b.z);
      b.y = (Number.isFinite(floor) ? floor : pose.position[1]) + .005 + Math.max(0, gait) * home.length * .04;
      knee.copy(a).lerp(b, .55); knee.y = Math.max(a.y, b.y) + home.length * .018;
      const offset = (member * count * 2 + row * 2 + sideIndex) * 2;
      legSegment(model.legs, offset, a, knee, home.length * .01);
      legSegment(model.legs, offset + 1, knee, b, home.length * .007);
    }
  }
  function update(time, env = {}, camera) {
    if (disposed) return;
    if (camera?.isCamera) {
      camera.updateMatrixWorld();
      group.updateWorldMatrix(true, false);
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProjection);
      worldBounds.copy(habitatBounds).applyMatrix4(group.matrixWorld);
      group.visible = frustum.intersectsSphere(worldBounds);
      if (!group.visible) return;
    } else group.visible = true;
    const fishCounts = [0, 0, 0];
    // Take equal numbers from each complete school at every quality level.
    for (const home of homes.fish) {
      const species = home.school, model = fish[species];
      if (fishCounts[species] >= quality.fish / 3) continue;
      const pose = getLagoonResidentPose(time, home, heightAt); if (!pose.visible) continue;
      const index = fishCounts[species]++; setRoot(pose, home.length); model.body.setMatrixAt(index, root.matrix);
      writePart(model.tail, index, [0, 0, model.pivot], [0, pose.tail, 0]);
    }
    for (let species = 0; species < 3; species++) for (const mesh of [fish[species].body, fish[species].tail]) mesh.count = fishCounts[species];
    let turtleCount = 0;
    for (let member = 0; member < Math.min(homes.turtle.length, quality.turtle); member++) {
      const home = homes.turtle[member];
      const pose = getLagoonResidentPose(time, home, heightAt); if (!pose.visible) continue;
      const index = turtleCount++; setRoot(pose, home.length); turtles.body.setMatrixAt(index, root.matrix);
      for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
        const side = sideIndex ? 1 : -1, mirror = side < 0 ? Math.PI : 0;
        writePart(turtles.front, index * 2 + sideIndex, [.235 * side, -.028, .16], [0, -.18 * side, mirror + pose.flipper * side]);
        writePart(turtles.rear, index * 2 + sideIndex, [.205 * side, -.038, -.225], [0, .08 * side, mirror - pose.flipper * .5 * side]);
      }
    }
    turtles.body.count = turtleCount; turtles.front.count = turtles.rear.count = turtleCount * 2;
    for (const [kind, model] of [['crab', crabs], ['lobster', lobsters]]) {
      let count = 0;
      for (let member = 0; member < Math.min(homes[kind].length, quality[kind]); member++) {
        const home = homes[kind][member];
        const pose = getLagoonResidentPose(time, home, heightAt); if (!pose.visible) continue;
        const index = count++; setRoot(pose, home.length); model.body.setMatrixAt(index, root.matrix); feet(model, home, pose, index);
        for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
          const side = sideIndex ? 1 : -1, mirror = side < 0 ? Math.PI : 0;
          writePart(model.claws, index * 2 + sideIndex, [.13 * side, .135, .095],
            [-.05, (.2 + pose.claw) * side, mirror + pose.claw * .4 * side]);
          if (model.antenna) writePart(model.antenna, index * 2 + sideIndex, [.055 * side, .19, .17],
            [pose.antenna, (.22 + pose.antenna) * side - (side < 0 ? .48 : 0), 0]);
        }
        if (model.tail) writePart(model.tail, index, [0, .065, -.245], [pose.tail, 0, 0]);
      }
      model.body.count = count; model.claws.count = count * 2; model.legs.count = count * (kind === 'crab' ? 16 : 20);
      if (model.tail) model.tail.count = count; if (model.antenna) model.antenna.count = count * 2;
    }
    for (const mesh of meshes) { mesh.visible = mesh.count > 0; mesh.instanceMatrix.needsUpdate = true; }
  }
  function setQuality(value) { quality = QUALITY[value] ?? QUALITY.high; }
  function dispose() {
    if (disposed) return; disposed = true; scene.remove(group);
    for (const mesh of meshes) mesh.dispose(); for (const geometry of geometries) geometry.dispose();
    material.dispose(); group.clear(); api.onEvent = null;
  }
  const api = { group, update, setQuality, dispose, onEvent: null };
  update(0); return api;
}
