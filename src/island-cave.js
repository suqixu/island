import * as THREE from 'three';
import { CAVE_LAYOUT, caveToWorld, caveProfile, isCaveOpeningTriangle } from './cave-layout.js';
import { noise } from './terrain.js';
import { createCaveVegetation } from './cave-vegetation.js';

export { CAVE_LAYOUT, isCaveReserved } from './cave-layout.js';

// Terrain and its shadow pass share the modified index buffer. Keep all other
// attributes intact, including biome/snow attributes supplied by island.js.
export function applyCaveOpening(mesh) {
  const geometry = mesh?.geometry, position = geometry?.attributes?.position;
  if (!position || geometry.userData.caveOpeningApplied) return 0;
  mesh.updateWorldMatrix(true, false);
  const oldIndex = geometry.index;
  const length = oldIndex ? oldIndex.count : position.count;
  const retained = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let removed = 0;
  for (let index = 0; index + 2 < length; index += 3) {
    const ia = oldIndex ? oldIndex.getX(index) : index;
    const ib = oldIndex ? oldIndex.getX(index + 1) : index + 1;
    const ic = oldIndex ? oldIndex.getX(index + 2) : index + 2;
    a.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld);
    if (isCaveOpeningTriangle(a, b, c)) removed++;
    else retained.push(ia, ib, ic);
  }
  if (removed) {
    const IndexArray = position.count > 65535 ? Uint32Array : Uint16Array;
    geometry.setIndex(new THREE.BufferAttribute(new IndexArray(retained), 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }
  geometry.userData.caveOpeningApplied = true;
  return removed;
}

const rockColor = new THREE.Color(0x969184);

function mineralNoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fade = t => t * t * (3 - 2 * t);
  const u = fade(x - ix), v = fade(y - iy), w = fade(z - iz);
  const hash = (a, b, c) => {
    let value = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2147483647);
    value = Math.imul(value ^ value >>> 13, 1274126177);
    return ((value ^ value >>> 16) >>> 0) / 4294967296;
  };
  const layer = c => (hash(ix, iy, c) * (1 - u) + hash(ix + 1, iy, c) * u) * (1 - v)
    + (hash(ix, iy + 1, c) * (1 - u) + hash(ix + 1, iy + 1, c) * u) * v;
  return layer(iz) * (1 - w) + layer(iz + 1) * w;
}

// Baked cavity occlusion remains when low quality disables real-time shadows.
// Only inner surfaces use it: the outer rock shoulder remains normally lit.
export function getCaveInteriorLightFactor(forward) {
  if (!Number.isFinite(forward)) return .26;
  const smooth = (a, b) => {
    const t = Math.max(0, Math.min(1, (forward - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  return forward > 1.05 ? .26 + .74 * smooth(1.05, 3.1) : .006 + .254 * (1 - smooth(1.05, -5.4));
}

function geometryBuilder(baseColor = rockColor) {
  const positions = [], colors = [], indices = [], uvs = [];
  return {
    vertex(side, height, forward, shade = 1, interior = true) {
      const point = caveToWorld(side, height, forward);
      const index = positions.length / 3;
      positions.push(point.x, point.y, point.z);
      uvs.push(side * .32 + forward * .18, height * .32 + forward * .16);
      const mineral = baseColor === rockColor ? .96
        + (mineralNoise(point.x * .42, point.y * .42, point.z * .42) - .5) * .16
        + (mineralNoise(point.x * 1.3 + 7, point.y * 1.3, point.z * 1.3 - 3) - .5) * .08
        : .96 + noise(point.x * .51, point.z * .51) * .09;
      const brightness = Math.max(.07, shade) * mineral * (interior ? getCaveInteriorLightFactor(forward) : 1);
      colors.push(baseColor.r * brightness, baseColor.g * brightness, baseColor.b * brightness);
      return index;
    },
    quad(a, b, c, d) { indices.push(a, b, c, a, c, d); },
    triangle(a, b, c) { indices.push(a, b, c); },
    finish() {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      return geometry;
    },
  };
}

const sectionDistances = [1.05, -.8, -1.75, -2.7, -3.7, -4.8, -5.9, -7.0, -7.8,
  -9, -10.5, -12, -13.5, -15, -16.5, -CAVE_LAYOUT.depth];

function tunnelBend(forward) {
  const ease=(a,b)=>{const t=Math.max(0,Math.min(1,(-forward-a)/(b-a)));return t*t*(3-2*t);};
  return -7.0*ease(3.5,10.5)+4.4*ease(11,18);
}

const innerMask = forward => {
  const t = Math.max(0, Math.min(1, (-forward - .8) / 1.3));
  return t * t * (3 - 2 * t);
};

function floorBase(forward) {
  return Math.min(1, Math.max(0, -forward) / CAVE_LAYOUT.depth) * .12
    + noise(forward * .72, 17.3) * .11 * innerMask(forward);
}

// Every surface takes its boundary from this same section. Independent rim
// jitter on the floor/end cap used to leave tiny gaps showing the sky beyond.
function caveSection(forward) {
  const depth = Math.min(1, Math.max(0, -forward) / CAVE_LAYOUT.depth);
  const rough = innerMask(forward);
  return {
    depth,
    profile: caveProfile(CAVE_LAYOUT.width / 2 * (1 - depth * .19),
      CAVE_LAYOUT.height * (1 - depth * .13), depth * 2.7)
      .map(([side, height], index) => [
        side + tunnelBend(forward) + rough * (noise(index * .53 + 23, forward * 1.09) * .19 + noise(index * 1.13 + 9, forward * .53) * .10),
        height + floorBase(forward) + (height === 0 ? 0 : rough
          * (noise(index * .7, forward * .9) * .26 + noise(index * 1.57 + 7.3, forward * 1.61) * .14)),
      ]),
  };
}

export function getCaveFloorHeight(side, forward) {
  if (!Number.isFinite(side) || !Number.isFinite(forward)) return 0;
  const { profile } = caveSection(forward), left = profile[0], right = profile.at(-1);
  const across = Math.max(0, Math.min(1, (side - left[0]) / (right[0] - left[0])));
  // The envelope vanishes exactly at both wall feet. The cap uses these same
  // points, so dirt hummocks do not open a new seam at the tunnel edges.
  const envelope = Math.sin(across * Math.PI);
  return floorBase(forward) + envelope * innerMask(forward)
    * (noise(side * 1.55, forward * 1.2) * .15 + noise(side * 2.85 + 23, forward * 2.1 - 11) * .07);
}

function floorProfile(forward) {
  const { profile } = caveSection(forward), left = profile[0], right = profile.at(-1);
  return Array.from({ length: 7 }, (_, index) => {
    const side = left[0] + (right[0] - left[0]) * index / 6;
    return [side, index === 0 ? left[1] : index === 6 ? right[1] : getCaveFloorHeight(side, forward)];
  });
}

function makeTunnel() {
  const builder = geometryBuilder();
  // The portal provides the first section of inner wall; no coincident faces.
  const rings = sectionDistances.slice(1).map(forward => {
    const { depth, profile } = caveSection(forward);
    return profile.map(([side, height]) => builder.vertex(side, height, forward, 1 - depth * .87));
  });
  for (let ring = 0; ring + 1 < rings.length; ring++) {
    for (let vertex = 0; vertex + 1 < rings[ring].length; vertex++) {
      builder.quad(rings[ring][vertex], rings[ring][vertex + 1], rings[ring + 1][vertex + 1], rings[ring + 1][vertex]);
    }
  }
  return builder.finish();
}

function makePortal() {
  const builder = geometryBuilder();
  const inner = caveSection(1.05).profile;
  const outer = caveProfile(4.9, 6.6).map(([side, height], index) => [
    side + noise(index * 1.39 + 7, 3.7) * .39,
    height - .35 + noise(index * 1.73, 8.3) * .32,
  ]);
  // The exposed cut has broken shelves across its thickness, rather than a
  // smoothly shaded torus. Only the shared inner edge stays at the floor seam.
  const front = [0, .16, .43, .72, 1].map((across, layer) => inner.map(([side, height], index) => {
    const edge = outer[index], rough = Math.sin(across * Math.PI);
    const forward = 1.05 + across * (Math.sin(index * 1.47 + .7) * .55
      + noise(index * 1.73 + 11, 7.1) * .28)
      + rough * (.18 + noise(index * .93, layer * 1.61) * .21);
    const shade = .37 + .65 * across * across
      + rough * noise(index * 1.59 + 4, layer * 1.23) * .13;
    return builder.vertex(side + (edge[0] - side) * across + rough * noise(index * 1.31, layer + 5) * .07,
      height + (edge[1] - height) * across + rough * noise(index * 1.71 + 13, layer + 2) * .09,
      forward, shade, false);
  }));
  const back = [caveSection(-.8).profile, outer].map((profile, outside) => profile.map(([side, height]) =>
    builder.vertex(side, height, -.8, outside ? 1.02 : .69, !outside)));
  for (let index = 0; index + 1 < inner.length; index++) {
    for (let layer = 0; layer + 1 < front.length; layer++) {
      builder.quad(front[layer][index], front[layer + 1][index], front[layer + 1][index + 1], front[layer][index + 1]);
    }
    builder.quad(back[0][index + 1], back[1][index + 1], back[1][index], back[0][index]);
    builder.quad(front.at(-1)[index], back[1][index], back[1][index + 1], front.at(-1)[index + 1]);
    builder.quad(front[0][index + 1], back[0][index + 1], back[0][index], front[0][index]);
  }
  const indexed = builder.finish(), geometry = indexed.toNonIndexed();
  indexed.dispose();
  geometry.computeVertexNormals();
  return geometry;
}

function makeFloor(heightAt) {
  const builder = geometryBuilder(new THREE.Color(0x82745f));
  const distances = [3.1, ...sectionDistances];
  const rings = distances.map(forward => {
    const { depth } = caveSection(forward);
    return floorProfile(forward).map(([side, sectionHeight]) => {
      let height = sectionHeight;
      if (forward > 1.05) {
        const point = caveToWorld(side, 0, forward);
        const ground = typeof heightAt === 'function' ? heightAt(point.x, point.z) : NaN;
        height = Number.isFinite(ground) ? ground - CAVE_LAYOUT.entrance.y + .08 : -.12;
      }
      return builder.vertex(side, height, forward, 1 - depth * .88);
    });
  });
  for (let ring = 0; ring + 1 < rings.length; ring++) {
    for (let side = 0; side < 6; side++) builder.quad(rings[ring][side], rings[ring + 1][side], rings[ring + 1][side + 1], rings[ring][side + 1]);
  }
  return builder.finish();
}

function makeEndWall() {
  const builder = geometryBuilder();
  const { profile } = caveSection(-CAVE_LAYOUT.depth);
  const center = builder.vertex(tunnelBend(-CAVE_LAYOUT.depth) + .24, 2.1, -CAVE_LAYOUT.depth + .26, .10);
  const edge = [...profile, ...floorProfile(-CAVE_LAYOUT.depth).slice(1, -1).reverse()]
    .map(([side, height]) => builder.vertex(side, height, -CAVE_LAYOUT.depth, .13));
  for (let index = 0; index < edge.length; index++) builder.triangle(center, edge[index], edge[(index + 1) % edge.length]);
  return builder.finish();
}

function makeRockTextures() {
  const size = 256;
  const albedo = new Uint8Array(size * size * 4), relief = new Uint8Array(size * size * 4), roughness = new Uint8Array(size * size * 4);
  const hash = (x, y, seed = 17) => {
    let value = Math.imul(x + 101, 374761393) ^ Math.imul(y + 73, 668265263) ^ seed;
    value = Math.imul(value ^ value >>> 13, 1274126177);
    return ((value ^ value >>> 16) >>> 0) / 4294967296;
  };
  // Periodic, smoothly interpolated hash noise has no preferred stripe angle.
  const noise = (x, y, period, seed) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const wrapped = (a, b) => hash((a % period + period) % period, (b % period + period) % period, seed);
    const smooth = t => t * t * t * (t * (t * 6 - 15) + 10);
    const u = smooth(x - ix), v = smooth(y - iy);
    const a = wrapped(ix, iy), b = wrapped(ix + 1, iy), c = wrapped(ix, iy + 1), d = wrapped(ix + 1, iy + 1);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const broad = noise(u * 7, v * 7, 7, 317);
      const mineral = noise(u * 23, v * 23, 23, 971);
      const grain = noise(u * 79, v * 79, 79, 1237);
      const grit = hash(x, y, 701);
      // Warped strata terminate in branching fractures; no straight repeated
      // bands. Height data stays linear and independent of subdued albedo.
      const warp = noise(u * 5, v * 5, 5, 817);
      const ridge = Math.abs(noise(u * 13 + warp * 1.6, v * 13 - warp * 1.6, 13, 453) - .5);
      const fracture = Math.pow(Math.max(0, 1 - ridge / .048), 2);
      const strata = Math.abs(noise(u * 31 + warp * 2, v * 31, 31, 211) - .5) * 2;
      const colorValue = .926 + (broad - .5) * .16 + (mineral - .5) * .11
        + (grain - .5) * .038 + (grit - .5) * .018 - fracture * .15;
      const heightValue = .16 + broad * .33 + mineral * .31 + grain * .14 + grit * .06
        + strata * .12 - fracture * .30;
      const roughValue = .72 + grain * .12 + grit * .07 + fracture * .08;
      const index = (y * size + x) * 4;
      const byte = value => Math.round(Math.max(0, Math.min(1, value)) * 255);
      albedo[index] = byte(colorValue); albedo[index + 1] = byte(colorValue - (mineral - .5) * .009);
      albedo[index + 2] = byte(colorValue - mineral * .013); albedo[index + 3] = 255;
      for (let channel = 0; channel < 3; channel++) {
        relief[index + channel] = byte(heightValue); roughness[index + channel] = byte(roughValue);
      }
      relief[index + 3] = roughness[index + 3] = 255;
    }
  }
  const make = (data, colorSpace) => {
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.colorSpace = colorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.needsUpdate = true;
    return texture;
  };
  return { albedo: make(albedo, THREE.SRGBColorSpace), relief: make(relief, THREE.NoColorSpace),
    roughness: make(roughness, THREE.NoColorSpace) };
}

function rockMaterial(textures) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .97, metalness: 0,
    map: textures.albedo, bumpMap: textures.relief, roughnessMap: textures.roughness, bumpScale: .09, side: THREE.DoubleSide });
  // Project grains in world space on three planes. UV shear on curved walls
  // must not stretch mineral noise into diagonal cloth-like bands.
  material.onBeforeCompile = shader => {
    shader.uniforms.caveRockRelief = { value: material.bumpMap };
    shader.uniforms.caveRockRoughness = { value: material.roughnessMap };
    const varyings = 'varying vec3 vCaveRockWorld; varying vec3 vCaveRockNormal;\n';
    shader.vertexShader = varyings + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 caveRockWorld = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        caveRockWorld = instanceMatrix * caveRockWorld;
      #endif
      vCaveRockWorld = (modelMatrix * caveRockWorld).xyz;
      vCaveRockNormal = inverseTransformDirection(transformedNormal, viewMatrix);`);
    shader.fragmentShader = varyings + 'uniform sampler2D caveRockRelief; uniform sampler2D caveRockRoughness;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      vec3 caveWeights = pow(abs(normalize(vCaveRockNormal)), vec3(4.0));
      caveWeights /= max(dot(caveWeights, vec3(1.0)), 0.0001);
      vec3 caveRockPoint = vCaveRockWorld * .42;
      vec3 caveMineral = texture2D(map, caveRockPoint.yz).rgb * caveWeights.x
        + texture2D(map, caveRockPoint.xz).rgb * caveWeights.y
        + texture2D(map, caveRockPoint.xy).rgb * caveWeights.z;
      diffuseColor.rgb *= caveMineral;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
      float caveRelief = (texture2D(caveRockRelief, caveRockPoint.yz).r * caveWeights.x
        + texture2D(caveRockRelief, caveRockPoint.xz).r * caveWeights.y
        + texture2D(caveRockRelief, caveRockPoint.xy).r * caveWeights.z) * bumpScale;
      normal = perturbNormalArb(-vViewPosition, normal,
        vec2(dFdx(caveRelief), dFdy(caveRelief)), faceDirection);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
      float roughnessFactor = roughness * (texture2D(caveRockRoughness, caveRockPoint.yz).g * caveWeights.x
        + texture2D(caveRockRoughness, caveRockPoint.xz).g * caveWeights.y
        + texture2D(caveRockRoughness, caveRockPoint.xy).g * caveWeights.z);`);
  };
  material.customProgramCacheKey = () => 'cave-world-strata-v2';
  return material;
}

function makeLooseRockGeometry() {
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const position = geometry.attributes.position;
  const colors = [];
  for (let index = 0; index < position.count; index++) {
    const point = new THREE.Vector3().fromBufferAttribute(position, index);
    // Noise depends on position so duplicated face vertices still meet exactly.
    const scale = .93 + Math.sin(point.x * 8.9 + point.y * 5.3 + point.z * 6.4) * .075;
    point.multiplyScalar(scale);
    position.setXYZ(index, point.x, point.y, point.z);
    const shade = .94 + Math.sin(point.x * 7.3 + point.z * 5.7) * .12;
    colors.push(rockColor.r * shade, rockColor.g * shade, rockColor.b * shade);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function createIslandCave(parent, { heightAt } = {}) {
  const group = new THREE.Group();
  group.name = '东南山侧天然岩洞';
  parent.add(group);
  const rockTextures = makeRockTextures();
  const material = rockMaterial(rockTextures);
  const floorMaterial = rockMaterial(rockTextures); floorMaterial.roughness = 1; floorMaterial.bumpScale = .024;
  const add = (geometry, name, surfaceMaterial = material) => {
    const mesh = new THREE.Mesh(geometry, surfaceMaterial);
    mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  add(makeTunnel(), '天然岩洞内壁');
  const portal = add(makePortal(), '厚岩拱与裂隙洞口');
  const floor = add(makeFloor(heightAt), '洞穴坡口与地面', floorMaterial);
  add(makeEndWall(), '洞穴深处不规则岩壁');
  const rockGeometry = makeLooseRockGeometry();
  // Irregular shoulders soften the cut grid edge; the central aperture stays open.
  const shoulderRocks = [
    [-4.1, .7, .7, 1.12, 1.45, 1.08], [4.05, .72, .8, 1.07, 1.3, .98],
    [-4.05, 2.45, .45, 1.0, 1.25, 1.12], [4.13, 2.72, .1, .94, 1.25, 1.04],
    [-3.5, 4.35, .0, 1.08, .92, 1.06], [3.6, 4.65, .0, .99, .91, 1.0],
    [-1.8, 5.6, -.15, 1.12, .74, 1.04], [.6, 5.87, -.25, 1.4, .7, .99],
  ];
  const rocks = new THREE.InstancedMesh(rockGeometry, material, shoulderRocks.length + 30);
  rocks.name = '洞口岩块与地面碎石'; rocks.castShadow = true; rocks.receiveShadow = true;
  const dummy = new THREE.Object3D(), color = new THREE.Color();
  const stones = [...shoulderRocks];
  for (let index = 0; index < 24; index++) {
    const forward = 2.5 - index / 23 * 9.9;
    const side = Math.sin(index * 2.399) * (index < 7 ? 2.85 : 2.25);
    stones.push([side, .06 + Math.max(0, -forward) * .014, forward, .11 + (index % 4) * .04, .07 + (index % 3) * .025, .12 + (index % 5) * .035]);
  }
  for (let index = 0; index < 6; index++) {
    stones.push([(index % 2 ? 1 : -1) * (2.03 + noise(index * 1.9, 5.1) * .18), 0,
      -2.4 - index * .88 + noise(index * 2.47, 8.7) * .27,
      .46 + noise(index * 1.17, 6.9) * .16, .28 + noise(index * 2.13, 3.5) * .09, .43 + noise(index * 1.31, 7.8) * .13]);
  }
  const floorRay = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  floor.updateWorldMatrix(true, false);
  stones.forEach(([side, height, forward, sx, sy, sz], index) => {
    if (index >= shoulderRocks.length) side += tunnelBend(forward);
    if (index >= shoulderRocks.length) {
      const point = caveToWorld(side, 0, forward);
      floorRay.set(new THREE.Vector3(point.x, 100, point.z), down);
      const hit = floorRay.intersectObject(floor, false)[0];
      height = (hit ? hit.point.y - CAVE_LAYOUT.entrance.y : getCaveFloorHeight(side, forward)) + sy * .35;
    }
    const point = caveToWorld(side, height, forward);
    dummy.position.set(point.x, point.y, point.z);
    dummy.rotation.set(index * .38, index * 2.399, index * .13);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix(); rocks.setMatrixAt(index, dummy.matrix);
    const shade = index < shoulderRocks.length ? 1 : (1 - Math.max(0, -forward) / CAVE_LAYOUT.depth * .85)
      * getCaveInteriorLightFactor(forward);
    color.setRGB(shade, shade, shade); rocks.setColorAt(index, color);
  });
  rocks.computeBoundingSphere(); group.add(rocks);
  const vegetation = createCaveVegetation(group, portal);
  // A hidden light beyond the first bend hints at depth without lighting the entrance.
  const turnLight = new THREE.PointLight(0xffbd72, 30, 5, 2);
  const glowPoint = caveToWorld(tunnelBend(-7.5) + .6, 2.35, -7.5);
  turnLight.position.set(glowPoint.x, glowPoint.y, glowPoint.z);
  turnLight.name = '山洞深处转角微光';
  turnLight.castShadow = false;
  group.add(turnLight);
  const count = Object.freeze({ meshes: 5 + vegetation.counts.meshes, rocks: stones.length, tunnelLength: CAVE_LAYOUT.depth,
    entrances: 1, lights: 1, lamps: 0,
    ferns: vegetation.counts.ferns, vines: vegetation.counts.vines });
  let disposed = false;
  return {
    group,
    count,
    update(time, env = {}) {
      if (disposed) return;
      turnLight.visible = !env.artificialLightsOff;
      const glowTime = Number.isFinite(time) ? time : 0;
      turnLight.intensity = env.artificialLightsOff ? 0 : 30 + 4 * Math.sin(glowTime * .73) + 2 * Math.sin(glowTime * 1.43);
      vegetation.update(time, env);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      vegetation.dispose();
      parent.remove(group);
      const geometries = new Set(), materials = new Set();
      group.traverse(object => {
        if (!object.isMesh) return;
        geometries.add(object.geometry); materials.add(object.material);
      });
      for (const geometry of geometries) geometry.dispose();
      for (const item of materials) item.dispose();
      rocks.dispose();
      for (const texture of Object.values(rockTextures)) texture.dispose();
      group.clear();
    },
  };
}
