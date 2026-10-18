import * as THREE from 'three';
import { getAnimationRate } from '../animation-time.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  createFishHabitat, getFishPose, createMarineAnchor, getMarinePose,
  createMarineEventTracker, createMarineTimeline, getMarineActivity,
} from '../marine-motion.js';

const TAU = Math.PI * 2;
const random = seed => {
  const value = Math.sin(seed * 127.1 + 31.7) * 43758.5453;
  return value - Math.floor(value);
};
const QUALITY = {
  high: { fish: 60, dolphins: 4, particles: 256 },
  medium: { fish: 42, dolphins: 3, particles: 160 },
  low: { fish: 24, dolphins: 2, particles: 80 },
};
const FISH_PROFILE = [
  [-.31, .022, .04], [-.23, .06, .09], [-.1, .105, .145],
  [.08, .115, .17], [.26, .092, .13], [.4, .038, .067], [.48, .006, .012],
];
const DOLPHIN_PROFILE = [
  [-.4, .023, .028], [-.29, .075, .075], [-.15, .125, .12],
  [.03, .13, .135], [.19, .11, .12], [.31, .05, .068],
  [.36, .023, .024], [.51, .008, .012],
];
const WHALE_PROFILE = [
  [-.4, .018, .025], [-.3, .075, .053], [-.16, .115, .079],
  [.03, .13, .085], [.23, .115, .08], [.39, .079, .065], [.48, .021, .03],
];

function colorGeometry(geometry, color) {
  geometry.deleteAttribute('uv');
  const count = geometry.attributes.position.count, values = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) color.toArray(values, i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
  return geometry;
}

// Cross sections describe a tapered body along +Z, rather than stretched balls.
function bodyGeometry(profile, back, belly, striped = false) {
  const curve = new THREE.CatmullRomCurve3(profile.map(([z, x, y]) => new THREE.Vector3(x, y, z)));
  const rows = 44, segments = 16, positions = [], colors = [], indices = [];
  const shade = new THREE.Color(), stripe = new THREE.Color('#26332e');
  for (let row = 0; row <= rows; row++) {
    const section = curve.getPoint(row / rows);
    for (let segment = 0; segment <= segments; segment++) {
      const angle = segment / segments * TAU, upper = Math.sin(angle);
      positions.push(Math.max(.003, section.x) * Math.cos(angle), Math.max(.004, section.y) * upper, section.z);
      shade.copy(back).lerp(belly, THREE.MathUtils.smoothstep(-upper, .02, .82));
      if (striped) shade.lerp(stripe, THREE.MathUtils.smoothstep(Math.cos((section.z + .09) * TAU * 5), .4, .7) * .93);
      shade.multiplyScalar(.95 + .05 * Math.cos(section.z * 21 + angle * 3));
      shade.toArray(colors, colors.length);
    }
  }
  for (let row = 0; row < rows; row++) for (let segment = 0; segment < segments; segment++) {
    const a = row * (segments + 1) + segment, b = a + segments + 1;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  // Cap the small rostrum and tail peduncle.
  for (const row of [0, rows]) {
    const section = curve.getPoint(row / rows), center = positions.length / 3;
    positions.push(0, 0, section.z); back.toArray(colors, colors.length);
    for (let segment = 0; segment < segments; segment++) {
      const a = row * (segments + 1) + segment;
      if (row === 0) indices.push(center, a + 1, a); else indices.push(center, a, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function finGeometry(points, color, thickness = .005) {
  const vertices = points.map(point => new THREE.Vector3(...point));
  const u = vertices[1].clone().sub(vertices[0]).normalize();
  const normal = vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).normalize();
  const v = normal.clone().cross(u);
  const contour = vertices.map(point => {
    const relative = point.clone().sub(vertices[0]);
    return new THREE.Vector2(relative.dot(u), relative.dot(v));
  });
  const faces = THREE.ShapeUtils.triangulateShape(contour, []), positions = [], indices = [];
  for (const side of [1, -1]) for (const point of vertices) {
    positions.push(point.x + normal.x * thickness * side, point.y + normal.y * thickness * side,
      point.z + normal.z * thickness * side);
  }
  const n = vertices.length;
  for (const [a, b, c] of faces) indices.push(a, b, c, n + c, n + b, n + a);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n; indices.push(i, n + i, j, j, n + i, n + j);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return colorGeometry(geometry, color);
}

function mergedModel(parts) {
  const result = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!result) throw new Error('海洋动物几何合并失败');
  result.computeBoundingSphere();
  return result;
}

function eyes(x, y, z, radius) {
  const black = new THREE.Color('#111e23');
  return [-1, 1].map(side => {
    const eye = new THREE.SphereGeometry(radius, 8, 6);
    eye.translate(x * side, y, z); return colorGeometry(eye, black);
  });
}

function fishModel(species) {
  const palette = [
    ['#477f99', '#ccd6ce', '#7396aa'],
    ['#d4ad42', '#e6dba1', '#8d7f3b'],
    ['#c57655', '#e7b595', '#a76e57'],
  ][species];
  const back = new THREE.Color(palette[0]), belly = new THREE.Color(palette[1]), fin = new THREE.Color(palette[2]);
  const parts = [bodyGeometry(FISH_PROFILE, back, belly, species === 1)];
  parts.push(finGeometry([[0, .12, .17], [0, .29, -.07], [0, .11, -.24]], fin));
  for (const side of [-1, 1]) {
    parts.push(finGeometry([[.087 * side, -.015, .18], [.2 * side, -.07, .045], [.115 * side, -.07, -.04]], fin));
  }
  parts.push(...eyes(.06, .04, .345, .014));
  const tail = finGeometry([[0, -.035, 0], [0, -.175, -.26], [0, 0, -.17], [0, .175, -.26], [0, .035, 0]], fin);
  return { body: mergedModel(parts), tail, tailPivot: -.31 };
}

function mammalModel(whale) {
  const back = new THREE.Color(whale ? '#2c4248' : '#426574');
  const belly = new THREE.Color(whale ? '#788786' : '#c0c9bf');
  const fin = new THREE.Color(whale ? '#253b43' : '#34525f');
  const parts = [bodyGeometry(whale ? WHALE_PROFILE : DOLPHIN_PROFILE, back, belly)];
  parts.push(finGeometry(whale
    ? [[0, .074, -.09], [0, .106, -.21], [0, .061, -.3]]
    : [[0, .10, .005], [0, .30, -.135], [0, .09, -.255]], fin));
  for (const side of [-1, 1]) parts.push(finGeometry(whale
    ? [[.09 * side, -.03, .19], [.245 * side, -.09, -.025], [.145 * side, -.068, -.1]]
    : [[.1 * side, -.03, .14], [.25 * side, -.115, -.025], [.135 * side, -.065, -.13]], fin));
  parts.push(...eyes(whale ? .08 : .047, .017, whale ? .39 : .315, whale ? .0035 : .009));
  const tail = finGeometry([[-.025, 0, 0], [-.23, 0, -.13], [-.25, 0, -.24], [-.06, 0, -.185],
    [0, 0, -.22], [.06, 0, -.185], [.25, 0, -.24], [.23, 0, -.13], [.025, 0, 0]], fin);
  return { body: mergedModel(parts), tail, tailPivot: -.4 };
}

/** +Z is the animal's nose; positive helper pitch raises that nose. */
export function createMarine(scene, { heightAt, fishSeed = Math.floor(Math.random() * 2147483647), marineSeed = fishSeed } = {}) {
  const group = new THREE.Group(); group.name = '近岸鱼群与海洋生灵'; scene.add(group);
  const geometries = new Set(), materials = new Set(), instances = [];
  const fishMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .32, metalness: .22 });
  const mammalMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .2, metalness: .06 });
  materials.add(fishMaterial); materials.add(mammalMaterial);
  function instanced(geometry, material, count, name) {
    geometries.add(geometry);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = name; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0; mesh.visible = false; group.add(mesh); instances.push(mesh); return mesh;
  }
  function pair(model, material, count, name) {
    return { body: instanced(model.body, material, count, `${name}身体`),
      tail: instanced(model.tail, material, count, `${name}尾鳍`), pivot: model.tailPivot };
  }
  const schools = [0, 1, 2].map(species => pair(fishModel(species), fishMaterial, 20, ['银蓝梭鱼', '黄纹礁鱼', '珊瑚色鱼'][species]));
  const fish = Array.from({ length: 60 }, (_, index) => {
    // The first school is in the clear shelf framed by the shallow-water view.
    return { species: index % 3, habitatIndex: index, home: createFishHabitat(heightAt, index, fishSeed),
      length: .42 + random(index + 41) * .73 };
  });
  const animals = {
    whale: pair(mammalModel(true), mammalMaterial, 1, '鲸鱼'),
    dolphin: pair(mammalModel(false), mammalMaterial, 4, '海豚'),
  };
  const records = [];
  for (const [kind, count] of [['whale', 1], ['dolphin', 4]]) for (let index = 0; index < count; index++) {
    records.push({ kind, index, cycle: -1, allowed: false,
      anchor: null, episode: null, length: kind === 'whale' ? 22.3 : (2.65 + random(index + 89) * .25) * 2 });
  }
  const timeline = createMarineTimeline(marineSeed), groups = { whale: { cycle: -1 }, dolphin: { cycle: -1 } };

  const particleCount = 256, particlePositions = new Float32Array(particleCount * 3);
  const particleAlphas = new Float32Array(particleCount), particleSizes = new Float32Array(particleCount);
  const particleGeometry = new THREE.BufferGeometry(); geometries.add(particleGeometry);
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3).setUsage(THREE.DynamicDrawUsage));
  particleGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(particleAlphas, 1).setUsage(THREE.DynamicDrawUsage));
  particleGeometry.setAttribute('aSize', new THREE.BufferAttribute(particleSizes, 1));
  const particleMaterial = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 650 }, uLight: { value: 1 } }, transparent: true, depthWrite: false, depthTest: true,
    vertexShader: `attribute float aAlpha; attribute float aSize; uniform float uScale; varying float vAlpha;
      void main() { vec4 view = modelViewMatrix * vec4(position, 1.0); vAlpha = aAlpha;
        gl_PointSize = clamp(aSize * uScale / max(1.0, -view.z), 1.1, 7.0);
        gl_Position = projectionMatrix * view; }`,
    fragmentShader: `uniform float uLight; varying float vAlpha;
      void main() { float r = length(gl_PointCoord - 0.5) * 2.0;
        float alpha = (1.0 - smoothstep(0.25, 1.0, r)) * vAlpha;
        if (alpha < 0.005) discard; gl_FragColor = vec4(vec3(0.79, 0.9, 0.94) * uLight, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }); materials.add(particleMaterial);
  const spray = new THREE.Points(particleGeometry, particleMaterial); spray.name = '喷水与入水飞溅';
  spray.renderOrder = 12; spray.frustumCulled = false; group.add(spray);
  const drops = Array.from({ length: particleCount }, () => ({ origin: new THREE.Vector3(), velocity: new THREE.Vector3(),
    born: -Infinity, life: 0, alpha: 0, size: .05, gravity: 9.8 }));
  let dropCursor = 0;
  const ringGeometry = new THREE.RingGeometry(.86, 1, 36); geometries.add(ringGeometry);
  ringGeometry.setAttribute('aFade', new THREE.InstancedBufferAttribute(new Float32Array(16), 1).setUsage(THREE.DynamicDrawUsage));
  const ringMaterial = new THREE.ShaderMaterial({
    uniforms: { uLight: { value: 1 } }, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    vertexShader: `attribute float aFade; varying float vFade;
      void main() { vFade = aFade;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uLight; varying float vFade;
      void main() { gl_FragColor = vec4(vec3(0.72, 0.86, 0.9) * uLight, vFade);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }); materials.add(ringMaterial);
  const rings = instanced(ringGeometry, ringMaterial, 16, '短暂散开的水花环'); rings.renderOrder = 11;
  const ringEvents = Array.from({ length: 16 }, () => ({ position: new THREE.Vector3(), born: -Infinity, strength: 0 }));
  let ringCursor = 0, settings = QUALITY.high, disposed = false, lastTime = 0;
  const tracker = createMarineEventTracker({ dolphins: 4, flyingFish: 0, timeline });
  const dummy = new THREE.Object3D(), tailDummy = new THREE.Object3D(), rootMatrix = new THREE.Matrix4();
  const cameraPosition = new THREE.Vector3(), ray = new THREE.Vector3(), candidate = new THREE.Vector3(), projected = new THREE.Vector3();
  const headingDirection = new THREE.Vector3(), corner = new THREE.Vector3(), sightTarget = new THREE.Vector3(), sightPoint = new THREE.Vector3();

  function clearViewingRay(point) {
    for (let step = 1; step < 32; step++) {
      sightPoint.lerpVectors(cameraPosition, point, step / 32);
      const bed = heightAt?.(sightPoint.x, sightPoint.z);
      if (Number.isFinite(bed) && bed > sightPoint.y + .2) return false;
    }
    return true;
  }
  function currentPoseVisible(record, camera) {
    if (!camera?.isCamera) return false;
    const model = animals[record.kind], bounds = model.body.geometry.boundingBox;
    for (const cx of [Math.min(bounds.min.x, -.25), Math.max(bounds.max.x, .25)])
      for (const cy of [bounds.min.y, bounds.max.y])
        for (const cz of [Math.min(bounds.min.z, model.pivot - .24), bounds.max.z]) {
          corner.set(cx, cy, cz).applyMatrix4(dummy.matrix);
          // Underwater vertices do not need a clear air ray; check the water
          // line there so a submerged approach is not culled before surfacing.
          corner.y = Math.max(.05, corner.y);
          projected.copy(corner).project(camera);
          if (Math.abs(projected.x) >= .94 || projected.y <= -.8 || projected.y >= .65 || projected.z <= -1 || projected.z >= 1) return false;
          if (!clearViewingRay(corner)) return false;
        }
    return true;
  }
  const framePoses = new Map(), hiddenKinds = new Set();

  // Only distant water between the island's outer sides and the horizon hosts
  // large animals. Hold a safe anchor throughout each event; a close reef view
  // simply shows fish instead of pulling a whale into the foreground.
  function memberAnchor(anchor, episode, index) {
    if (!anchor) return null;
    const member = episode.members[index];
    return { x: anchor.x + Math.cos(anchor.heading) * member.lateral + Math.sin(anchor.heading) * member.along,
      z: anchor.z - Math.sin(anchor.heading) * member.lateral + Math.cos(anchor.heading) * member.along,
      heading: anchor.heading };
  }
  function visibleAnchor(record, camera, episode) {
    if (!camera?.isCamera) return null;
    camera.getWorldPosition(cameraPosition); camera.getWorldDirection(headingDirection);
    const rand = salt => random(episode.placementSeed + salt);
    const heading = Math.atan2(headingDirection.x, headingDirection.z) + Math.PI * .5 + (rand(1) - .5) * .24;
    const side = rand(3) < .5 ? -1 : 1, column = (.5 + rand(5) * .22) * side;
    const xs = [column, -column, column + .08 * side, -column - .08 * side,
      .43 * side, -.43 * side, .65 * side, -.65 * side, .79 * side, -.79 * side];
    const targetDistance = 265 + rand(7) * 48;
    const model = animals[record.kind];
    if (!model.body.geometry.boundingBox) model.body.geometry.computeBoundingBox();
    const bounds = model.body.geometry.boundingBox;
    let best = null, bestScore = Infinity;
    for (const y of [.06 - rand(11) * .13, -.08, -.18, -.30, -.44, -.56, .08, .14, .20]) for (const x of xs) {
      ray.set(x, y, .5).unproject(camera).sub(cameraPosition).normalize();
      if (ray.y >= -.005 || cameraPosition.y <= 0) continue;
      const distance = -cameraPosition.y / ray.y;
      if (distance < 180 || distance > 450) continue;
      candidate.copy(cameraPosition).addScaledVector(ray, distance);
      if (Math.hypot(candidate.x, candidate.z) < 180) continue;
      const anchor = createMarineAnchor(heightAt, { x: candidate.x, z: candidate.z, heading,
        clearance: record.kind === 'whale' ? 34 : 25, minDepth: record.kind === 'whale' ? 12 : 10 });
      if (!anchor) continue;
      candidate.set(anchor.x, 0, anchor.z);
      const separation = candidate.distanceTo(cameraPosition);
      if (Math.hypot(anchor.x, anchor.z) < 180 || separation < 180 || separation > 450) continue;
      projected.set(anchor.x, .1, anchor.z).project(camera);
      if (Math.abs(projected.x) < .38 || Math.abs(projected.x) >= .87 || projected.y <= -.72 || projected.y >= .35 ||
          projected.z <= -1 || projected.z >= 1) continue;
      // Evaluate the real model, including its tail, at the surface phase.
      // A centre point in frame is insufficient for a 25 m whale on a phone.
      let visible = true, minX = Infinity, maxX = -Infinity;
      for (let member = 0; member < episode.count && visible; member++) {
        const memberRecord = records.find(item => item.kind === record.kind && item.index === member);
        const motion = episode.members[member];
        const travelMargin = (motion.travel ?? episode.travel) * .5 / memberRecord.length;
        const lateralMargin = Math.max(.65, Math.abs(motion.curve ?? 0)) / memberRecord.length;
        const peak = getMarinePose(record.kind, member,
          episode.start + (motion.delay ?? member * episode.spacing) + (motion.duration ?? episode.duration) * .5,
          memberAnchor(anchor, episode, member), episode);
        setPose(dummy, peak, memberRecord.length);
        for (const cx of [bounds.min.x - lateralMargin, bounds.max.x + lateralMargin]) for (const cy of [bounds.min.y, bounds.max.y])
          for (const cz of [Math.min(bounds.min.z, model.pivot - .24) - travelMargin, bounds.max.z + travelMargin]) {
            corner.set(cx, cy, cz).applyMatrix4(dummy.matrix);
            sightTarget.copy(corner); sightTarget.y = Math.max(.05, sightTarget.y);
            if (!clearViewingRay(sightTarget)) visible = false;
            corner.project(camera);
            if (Math.abs(corner.x) > .93 || corner.y < -.78 || corner.y > .6) visible = false;
            minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x);
          }
      }
      if (!visible) continue;
      // Reject a safe ocean point whose viewing ray still crosses the island.
      visible = clearViewingRay(candidate);
      if (!visible) continue;
      const score = Math.abs(separation - targetDistance) + Math.abs(x - column) * 30 - (maxX - minX) * 25;
      if (score < bestScore) { bestScore = score; best = anchor; }
    }
    return best;
  }

  function setPose(target, pose, scale) {
    target.position.fromArray(pose.position); target.rotation.set(-pose.pitch, pose.heading, 0, 'YXZ');
    target.scale.setScalar(scale); target.updateMatrix();
  }
  function setTail(pairMesh, index, matrix, angle, horizontal) {
    tailDummy.position.set(0, 0, pairMesh.pivot);
    tailDummy.rotation.set(horizontal ? angle : 0, horizontal ? 0 : angle, 0);
    tailDummy.scale.setScalar(1); tailDummy.updateMatrix();
    rootMatrix.multiplyMatrices(matrix, tailDummy.matrix); pairMesh.tail.setMatrixAt(index, rootMatrix);
  }
  function limitFor(kind) { return kind === 'whale' ? 1 : settings.dolphins; }

  function makeWaterEvent(event, record, env, now) {
    const pose = getMarinePose(event.kind, event.index, now, record.anchor, record.episode);
    const position = new THREE.Vector3(...pose.position);
    const blow = event.type === 'whale-blow';
    if (blow) {
      position.x += Math.sin(pose.heading) * record.length * .25;
      position.z += Math.cos(pose.heading) * record.length * .25;
      position.y = Math.max(.04, position.y + record.length * .072);
    }
    const origin = position.clone(); if (!blow) origin.y = .055;
    const count = Math.min(settings.particles, blow ? Math.round(settings.particles * .48) : event.type === 'splash' ? 26 : 12);
    const wind = Array.isArray(env.windDirection) && env.windDirection.length === 2 && env.windDirection.every(Number.isFinite)
      ? env.windDirection : [.83, .55];
    for (let i = 0; i < count; i++) {
      const slot = dropCursor++ % settings.particles, drop = drops[slot], seed = i + event.time * 29;
      const angle = random(seed + 11) * TAU, spread = blow ? .45 + random(seed + 19) * .75 : .65 + random(seed + 19) * 2;
      drop.origin.copy(origin); drop.origin.x += Math.cos(angle) * .06; drop.origin.z += Math.sin(angle) * .06;
      drop.velocity.set(Math.cos(angle) * spread + (wind[0] ?? 0) * .35,
        blow ? 9.8 + random(seed + 7) * 2 : 1.7 + random(seed + 7) * 2.2,
        Math.sin(angle) * spread + (wind[1] ?? 0) * .35);
      drop.born = event.time + (blow ? random(seed + 13) * 1.1 : 0);
      drop.life = blow ? 2.3 + random(seed + 2) * .35 : .8 + random(seed + 2) * .4;
      drop.alpha = (blow ? .72 : .48) * event.strength; drop.size = blow ? .3 + random(seed + 3) * .6 : .05 + random(seed + 3) * .05;
      particleSizes[slot] = drop.size;
    }
    particleGeometry.attributes.aSize.needsUpdate = true;
    if (!blow) {
      const ring = ringEvents[ringCursor++ % ringEvents.length];
      ring.position.copy(origin); ring.born = event.time; ring.strength = event.strength;
    }
    if (typeof api.onEvent === 'function') api.onEvent({ type: event.type, kind: event.kind, index: event.index,
      cycle: event.cycle, time: event.time, position: position.clone(), strength: event.strength });
  }

  function update(time, env = {}, camera) {
    if (disposed) return;
    const now = Number.isFinite(time) ? Math.max(0, time) : lastTime;
    const step = now - lastTime, interrupted = step > getAnimationRate(env);
    if (interrupted) for (const record of records) record.allowed = false;
    lastTime = now;
    if (camera?.isCamera) camera.getWorldPosition(cameraPosition);
    const activity = getMarineActivity(env), counts = [0, 0, 0];
    for (let index = 0; activity >= .27 && index < settings.fish; index++) {
      const member = fish[index], pose = getFishPose(now, member.habitatIndex, member.home, heightAt, activity);
      if (!pose.visible) continue;
      const model = schools[member.species], instance = counts[member.species]++;
      setPose(dummy, pose, member.length); model.body.setMatrixAt(instance, dummy.matrix);
      setTail(model, instance, dummy.matrix, pose.tail, false);
    }
    for (let species = 0; species < schools.length; species++) for (const mesh of [schools[species].body, schools[species].tail]) {
      mesh.count = counts[species]; mesh.visible = mesh.count > 0; mesh.instanceMatrix.needsUpdate = true;
    }
    const animalCounts = { whale: 0, dolphin: 0 };
    for (const kind of ['whale', 'dolphin']) {
      const episode = timeline.getEpisode(kind, now), state = groups[kind];
      if (!episode || now >= episode.end || episode.cycle === state.cycle) continue;
      state.cycle = episode.cycle;
      const first = records.find(item => item.kind === kind && item.index === 0);
      // A late return from the background must not materialize a pod halfway
      // through a leap or attach a previous episode's sound to a new anchor.
      const eligible = !interrupted && now - episode.start <= Math.max(1, step) && activity >= episode.activityThreshold;
      const anchor = eligible ? visibleAnchor(first, camera, episode) : null;
      const allowed = Boolean(anchor);
      for (const record of records.filter(item => item.kind === kind)) {
        record.cycle = episode.cycle; record.episode = episode;
        record.anchor = record.index < episode.count ? memberAnchor(anchor, episode, record.index) : null;
        record.allowed = allowed && record.index < episode.count;
      }
    }
    framePoses.clear(); hiddenKinds.clear();
    for (const record of records) {
      if (!record.episode || !record.allowed || record.index >= limitFor(record.kind)) continue;
      const pose = getMarinePose(record.kind, record.index, now, record.anchor, record.episode);
      if (!pose.active) continue;
      setPose(dummy, pose, record.length);
      if (!currentPoseVisible(record, camera)) hiddenKinds.add(record.kind);
      framePoses.set(record, pose);
    }
    // A view change may reveal the island or move the entire pass out of frame.
    // End that pass rather than selecting another anchor midway through it.
    for (const record of records) if (hiddenKinds.has(record.kind)) record.allowed = false;
    for (const [record, pose] of framePoses) {
      if (!record.allowed) continue;
      const model = animals[record.kind], instance = animalCounts[record.kind]++;
      setPose(dummy, pose, record.length); model.body.setMatrixAt(instance, dummy.matrix);
      setTail(model, instance, dummy.matrix, Math.sin(now * (record.kind === 'whale' ? 1.3 : 5.4) + record.index) * .16,
        true);
    }
    for (const [kind, model] of Object.entries(animals)) for (const mesh of [model.body, model.tail]) {
      mesh.count = animalCounts[kind]; mesh.visible = mesh.count > 0; mesh.instanceMatrix.needsUpdate = true;
    }
    for (const event of tracker.collect(now, env)) {
      const record = records.find(item => item.kind === event.kind && item.index === event.index);
      if (record?.allowed && record.cycle === event.cycle && record.index < limitFor(record.kind) &&
          getMarinePose(record.kind, record.index, now, record.anchor, record.episode).active) makeWaterEvent(event, record, env, now);
    }
    const daylight = Number.isFinite(env.daylight) ? THREE.MathUtils.clamp(env.daylight, 0, 1) : 1;
    const moonLight = Number.isFinite(env.moonLight) ? THREE.MathUtils.clamp(env.moonLight, 0, 1) : 0;
    const light = .15 + daylight * .85 + moonLight * .13;
    particleMaterial.uniforms.uLight.value = light; ringMaterial.uniforms.uLight.value = light;
    if (camera?.isPerspectiveCamera) {
      const height = typeof innerHeight === 'number' ? innerHeight : 768;
      const pixelRatio = typeof devicePixelRatio === 'number' ? Math.min(devicePixelRatio, 1.7) : 1;
      particleMaterial.uniforms.uScale.value = height * pixelRatio / (2 * Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) * .5));
    }
    let alive = 0;
    for (let index = 0; index < settings.particles; index++) {
      const drop = drops[index], age = now - drop.born;
      const y = drop.origin.y + drop.velocity.y * age - .5 * drop.gravity * age * age;
      if (age >= 0 && age < drop.life && y > .02) {
        const at = index * 3; particlePositions[at] = drop.origin.x + drop.velocity.x * age;
        particlePositions[at + 1] = y; particlePositions[at + 2] = drop.origin.z + drop.velocity.z * age;
        particleAlphas[index] = drop.alpha * (1 - age / drop.life) * Math.min(1, age * 24); alive++;
      } else particleAlphas[index] = 0;
    }
    particleGeometry.setDrawRange(0, settings.particles); spray.visible = alive > 0;
    particleGeometry.attributes.position.needsUpdate = true; particleGeometry.attributes.aAlpha.needsUpdate = true;
    let ringCount = 0;
    for (const event of ringEvents) {
      const age = now - event.born;
      if (age < 0 || age >= 1.35) continue;
      dummy.position.copy(event.position); dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.setScalar(.25 + age * (1.2 + event.strength * 1.4)); dummy.updateMatrix();
      rings.setMatrixAt(ringCount, dummy.matrix);
      ringGeometry.attributes.aFade.setX(ringCount, .18 * event.strength * (1 - age / 1.35)); ringCount++;
    }
    rings.count = ringCount; rings.visible = ringCount > 0; rings.instanceMatrix.needsUpdate = true;
    ringGeometry.attributes.aFade.needsUpdate = true;
  }

  function setQuality(value) { settings = QUALITY[value] ?? QUALITY.high; }
  function dispose() {
    if (disposed) return; disposed = true;
    scene.remove(group); for (const mesh of instances) mesh.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    group.clear(); geometries.clear(); materials.clear(); api.onEvent = null;
  }
  const api = { group, update, setQuality, dispose, onEvent: null };
  return api;
}
