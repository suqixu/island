import * as THREE from 'three';
import { getAnimationDelta } from './animation-time.js';
import { caveToWorld, CAVE_LAYOUT } from './cave-layout.js';
import { createVegetationWindState, advanceVegetationWind, configureVegetationWindShader } from './vegetation-motion.js';

const seasonColors = [0xddeac5, 0xc8dfa9, 0xc9cf99, 0xaab9a2];
const plantGreen = new THREE.Color();
const direction = new THREE.Vector3(CAVE_LAYOUT.direction.x, 0, CAVE_LAYOUT.direction.z);
const right = new THREE.Vector3(CAVE_LAYOUT.direction.z, 0, -CAVE_LAYOUT.direction.x);
const up = new THREE.Vector3(0, 1, 0);
const patchNoise = (x, y) => {
  let value = Math.imul(x + 97, 374761393) ^ Math.imul(y + 31, 668265263);
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
};

function plantBuilder() {
  const positions = [], colors = [], indices = [], flex = [], cover = [], roots = [];
  return {
    vertex(p, root, bend, snow, shade = 1, stem = false) {
      const index = positions.length / 3;
      positions.push(p.x, p.y, p.z); roots.push(root.x, root.y, root.z);
      colors.push((stem ? .11 : .25) * shade, (stem ? .22 : .43) * shade, (stem ? .05 : .12) * shade);
      flex.push(bend); cover.push(snow); return index;
    },
    quad(a, b, c, d) { indices.push(a, b, c, a, c, d); },
    triangle(a, b, c) { indices.push(a, b, c); },
    finish() {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setAttribute('aFlex', new THREE.Float32BufferAttribute(flex, 1));
      geometry.setAttribute('aCover', new THREE.Float32BufferAttribute(cover, 1));
      geometry.setAttribute('aCavePlantRoot', new THREE.Float32BufferAttribute(roots, 3));
      geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      // GPU leaf motion stays inside this conservative static bound.
      geometry.boundingSphere.radius += .3;
      return geometry;
    },
  };
}

function leaf(builder, root, base, tip, widthAxis, width, bend, snow, shade) {
  const along = tip.clone().sub(base), middle = base.clone().addScaledVector(along, .43);
  const a = builder.vertex(base, root, 0, snow, shade * .82);
  const b = builder.vertex(middle.clone().addScaledVector(widthAxis, width), root, bend * .65, snow, shade);
  const c = builder.vertex(tip, root, bend, snow, shade * .92);
  const d = builder.vertex(middle.clone().addScaledVector(widthAxis, -width), root, bend * .65, snow, shade * .88);
  const ridge = builder.vertex(middle.clone().addScaledVector(direction, .014), root, bend * .55, snow, shade * 1.10);
  builder.triangle(a, b, ridge); builder.triangle(b, c, ridge);
  builder.triangle(c, d, ridge); builder.triangle(d, a, ridge);
}

/** Two merged batches. Roots and hanging stems are fitted to actual rim faces. */
export function createCaveVegetation(group, portal) {
  portal.updateWorldMatrix(true, false);
  const ray = new THREE.Raycaster(), probe = new THREE.Vector3();
  const surface = (side, height) => {
    const p = caveToWorld(side, height, 5); probe.set(p.x, p.y, p.z);
    ray.set(probe, direction.clone().negate());
    const hit = ray.intersectObject(portal)[0];
    if (!hit) return null;
    const normal = hit.face.normal.clone().transformDirection(portal.matrixWorld);
    if (normal.dot(direction) < 0) normal.negate();
    return { point: hit.point.clone().addScaledVector(direction, .018), normal };
  };
  const ferns = plantBuilder(), vines = plantBuilder();
  const fernSpots = [[-3.3, 4.85, .85], [-2.65, 5.50, .98], [-2.0, 5.70, .72], [-1.35, 5.95, 1.02],
    [-.55, 6.0, .82], [.15, 6.0, 1.12], [.9, 6.0, .72], [1.65, 5.85, 1.03], [2.35, 5.52, .9],
    [3.0, 5.35, .72], [-4.12, 4.35, .85], [-4.4, 3.5, .7], [-4.4, 2.7, .95],
    [-4.25, 1.7, .65], [4.2, 4.15, .85], [4.4, 3.4, .65], [4.4, 2.55, .9], [4.22, 1.6, .65]];
  // Overlapping, offset colonies cover the whole exposed shoulder. Sparse
  // pockets and unequal leaf sizes leave stone fissures between the greenery.
  for (let column = 0; column < 21; column++) {
    for (let row = 0; row < 14; row++) {
      if (patchNoise(column + 12, row + 53) < .10) continue;
      const side = -4.7 + column * .47 + (patchNoise(column, row) - .5) * .18;
      const height = .82 + row * .40 + (patchNoise(column + 9, row + 17) - .5) * .16;
      if (height < 3.65 && Math.abs(side) < 3.32) continue;
      if (fernSpots.some(([s, h]) => Math.hypot(s - side, h - height) < .21)) continue;
      const hit = surface(side, height);
      if (!hit || hit.point.clone().sub(new THREE.Vector3(CAVE_LAYOUT.entrance.x, CAVE_LAYOUT.entrance.y, CAVE_LAYOUT.entrance.z)).dot(direction) < .45) continue;
      let scale = .93 + patchNoise(column + 43, row + 3) * .35;
      if (height < 3.8) scale = Math.min(scale, (Math.abs(side) - 2.65) / .66);
      fernSpots.push([side, height, scale]);
    }
  }
  let fernCount = 0;
  fernSpots.forEach(([side, height, scale], patch) => {
    const hit = surface(side, height); if (!hit) return;
    fernCount++;
    const root = hit.point, normal = hit.normal;
    const tangent = right.clone().addScaledVector(normal, -right.dot(normal)).normalize();
    const second = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    const local = (x, y, z) => root.clone().addScaledVector(tangent, x * scale)
      .addScaledVector(normal, y * scale).addScaledVector(second, z * scale);
    for (let frond = 0; frond < 5; frond++) {
      const angle = frond * 1.2566 + patch * 1.73, reach = .40 + .11 * Math.sin(frond * 2.7 + patch);
      const along = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const cross = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
      const axis = tangent.clone().multiplyScalar(cross.x).addScaledVector(second, cross.z);
      const sample = t => local(along.x * reach * t, .15 * Math.sin(t * Math.PI) + .025 * t,
        along.z * reach * t);
      for (let k = 0; k < 8; k++) {
        const t = k / 8, n = (k + 1) / 8, bend = t * t * (3 - 2 * t), nextBend = n * n * (3 - 2 * n);
        const a = sample(t), b = sample(n);
        const spine = [ferns.vertex(a.clone().addScaledVector(axis, -.007), root, 0, .25, .72, true),
          ferns.vertex(a.clone().addScaledVector(axis, .007), root, 0, .25, .72, true),
          ferns.vertex(b.clone().addScaledVector(axis, .005), root, 0, .25, .72, true),
          ferns.vertex(b.clone().addScaledVector(axis, -.005), root, 0, .25, .72, true)];
        ferns.quad(...spine);
        if (k === 0) continue;
        const leafReach = .15 * Math.sin(t * Math.PI) * scale;
        for (const sign of [-1, 1]) {
          const tip = a.clone().addScaledVector(axis, sign * leafReach)
            .addScaledVector(tangent, along.x * .065 * scale).addScaledVector(second, along.z * .065 * scale);
          const leafWidth = new THREE.Vector3().crossVectors(normal, tip.clone().sub(a)).normalize();
          leaf(ferns, root, a, tip, leafWidth, .043 * scale * (1.3 - t), bend, .58,
            .84 + .19 * Math.sin(patch * 1.9 + k * 1.7));
        }
      }
    }
  });
  const vineSpots = [[-3.88, 4.72, 1.65], [-4.12, 3.65, 1.88], [-2.75, 5.35, .72],
    [-1.2, 5.98, .48], [.58, 6.0, .45], [2.88, 5.42, .68], [3.98, 4.60, 1.88]];
  fernSpots.forEach(([side, height], patch) => {
    if (patch % 4 || height < 2.6 || patchNoise(patch, 79) < .20) return;
    const length = Math.abs(side) < 2.7 ? .30 + patchNoise(patch, 63) * .50
      : .65 + patchNoise(patch, 63) * 1.70;
    vineSpots.push([side, height, length]);
  });
  let vineCount = 0;
  vineSpots.forEach(([side, height, length], strand) => {
    const hit = surface(side, height); if (!hit) return;
    vineCount++;
    const root = hit.point, nodes = [];
    for (let k = 0; k <= 20; k++) {
      const t = k / 20, s = side + Math.sin(t * 5.4 + strand * 1.7) * .055 * t;
      const h = height - t * length, contact = surface(s, h);
      if (!contact || h < .7) break;
      const p = contact.point;
      // Follow small rock ledges with a light stand-off; leaves grow outward.
      p.addScaledVector(direction, .032 * t); nodes.push(p);
    }
    for (let k = 0; k + 1 < nodes.length; k++) {
      const t = k / 20, n = (k + 1) / 20, bend = t * t * (3 - 2 * t), nextBend = n * n * (3 - 2 * n);
      const a = nodes[k], b = nodes[k + 1];
      vines.quad(vines.vertex(a.clone().addScaledVector(right, -.009), root, 0, .04, .65, true),
        vines.vertex(a.clone().addScaledVector(right, .009), root, 0, .04, .65, true),
        vines.vertex(b.clone().addScaledVector(right, .007), root, 0, .04, .65, true),
        vines.vertex(b.clone().addScaledVector(right, -.007), root, 0, .04, .65, true));
      if (k < 2 || k % 5 === 0) continue;
      const sign = (k + strand) % 2 ? 1 : -1, reach = .14 + .045 * Math.sin(k * 1.9 + strand);
      const base = a.clone().addScaledVector(direction, .045);
      const tip = base.clone().addScaledVector(right, sign * reach).addScaledVector(up, -.10 - reach * .24)
        .addScaledVector(direction, .025);
      leaf(vines, root, base, tip, up, .044 + reach * .1, bend, .30,
        .86 + .16 * Math.sin(strand * 2.1 + k));
    }
  });
  const uniforms = { uTime: { value: 0 }, uWindDirection: { value: new THREE.Vector2() },
    uPlantAmplitudes: { value: new THREE.Vector3() }, uLeafFlutter: { value: 0 }, uCavePlantSnow: { value: 0 } };
  const compileWind = shader => {
    configureVegetationWindShader(shader, uniforms, 'road', 'attribute vec3 aCavePlantRoot;');
    // Merged geometry stores the actual root per vertex, preserving independent
    // vine phases while all leaves on one stem bend together.
    shader.vertexShader = shader.vertexShader.replace('windOrigin = modelMatrix * windOrigin;',
      'windOrigin = modelMatrix * vec4(aCavePlantRoot, 1.0);');
  };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, color: seasonColors[1],
    roughness: .94, metalness: 0, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    compileWind(shader);
    shader.vertexShader = 'attribute float aCover; varying float vCavePlantCover;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvCavePlantCover = aCover;');
    shader.fragmentShader = 'uniform float uCavePlantSnow; varying float vCavePlantCover;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.82, .88, .83), uCavePlantSnow * vCavePlantCover * .83);`);
  };
  material.customProgramCacheKey = () => 'cave-clinging-leaves-v1';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depth.onBeforeCompile = compileWind; depth.customProgramCacheKey = () => 'cave-clinging-depth-v1';
  const batches = [[ferns.finish(), '洞口贴岩苔草与小蕨', fernCount], [vines.finish(), '洞口下垂藤蔓', vineCount]]
    .map(([geometry, name, plants]) => {
      const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
      mesh.userData.plants = plants; mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.customDepthMaterial = depth; group.add(mesh); return mesh;
    });
  const wind = createVegetationWindState();
  let disposed = false, previousTime = 0;
  return {
    counts: { ferns: fernCount, vines: vineCount, meshes: batches.length },
    update(time, env = {}) {
      if (disposed) return;
      advanceVegetationWind(wind, time, env);
      uniforms.uTime.value = wind.time; uniforms.uWindDirection.value.fromArray(wind.direction);
      uniforms.uPlantAmplitudes.value.fromArray(wind.amplitudes).multiplyScalar(.08);
      uniforms.uLeafFlutter.value = wind.flutter * .08;
      const name = ['spring', 'summer', 'autumn', 'winter'].indexOf(env.season ?? 'summer');
      const requested = env.seasonIndex ?? (name < 0 ? 1 : name);
      const season = Number.isFinite(requested) ? Math.max(0, Math.min(3, Math.floor(requested))) : 1;
      plantGreen.setHex(seasonColors[season]); material.color.copy(plantGreen);
      const target = Math.max(Number.isFinite(env.snow) ? Math.max(0, Math.min(1, env.snow)) : 0, season === 3 ? .65 : 0);
      const dt = getAnimationDelta(wind.time - previousTime, 1, env); previousTime = wind.time;
      uniforms.uCavePlantSnow.value += (target - uniforms.uCavePlantSnow.value) * (1 - Math.exp(-dt * 2));
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const mesh of batches) { group.remove(mesh); mesh.geometry.dispose(); }
      material.dispose(); depth.dispose();
    },
  };
}
