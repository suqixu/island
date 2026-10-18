import {addSmoothSnowNormals} from './snow-normals.js';
import {createSnowBoardGeometry} from './snow-layers.js';
import {WEATHER_CONFIG} from '../runtime-config.js';
import {attachWinterFoliage} from '../winter-foliage.js';
import {attachSnowSurface,getSnowCover,isSnowLandscape} from '../snow-surface.js';
import * as THREE from 'three';
import { BEACH_SWASH_GLSL } from '../beach-swash.js';
import { getAnimationDelta } from '../animation-time.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, slopeAt, shoreDistance, coastRadius, noise, fbm, hash, seededRandom, clamp, smooth, TAU } from '../terrain.js';
import { createVegetationWindState, advanceVegetationWind, getVegetationFlex,
  configureVegetationWindShader } from '../vegetation-motion.js';
import { createIslandCave, applyCaveOpening } from './island-cave.js';
import { createCaveFlowerMeadow } from './cave-flower-meadow.js';
import { CAVE_LAYOUT, isCaveReserved } from '../cave-layout.js';
import { getIslandPathLayout } from '../path-layout.js';
import { createIslandPathsGenerator } from './island-paths.js';
import { getLagoonMask, isLagoonSandAt } from '../lagoon.js';
import { attachVegetationSurface } from '../vegetation-surface.js';
import { isLighthouseReserved } from '../lighthouse-layout.js';
import { isRestPavilionReserved } from '../rest-pavilion-layout.js';
import { createForestCanopy } from '../forest-canopy.js';
import { runStartupGenerator } from '../startup-tasks.js';
import { createCoastalSurfaceUniforms, COASTAL_SURFACE_GLSL } from '../coastal-surfaces.js';
import { createLeafTextureState, attachLeafTexture } from '../leaf-texture.js';
import { beachGrassPlacement, isOpenBeach } from '../beach-grass.js';
import { createStructureSurfaceState, attachStructureSurface } from '../structure-surfaces.js';
import { SOIL_TRANSITION_GLSL } from '../ground-transition.js';

const UP = new THREE.Vector3(0, 1, 0);
const PATH_LAYOUT = getIslandPathLayout({ heightAt, caveEndpoint: CAVE_LAYOUT.approach });
const PALETTES = [
  [0x4b7a37, 0x568640, 0x689344, 0x3c6b34, 0x76974b],
  [0x3a6633, 0x507838, 0x658943, 0x426f40, 0x527d3d],
  [0x4a592c, 0x746b32, 0x96693d, 0x3b5230, 0xa18240],
  [0x33473b, 0x4e5d4b, 0x556753, 0x344c41, 0x65725a],
];

const ROCK_NOISE_GLSL = `
  uniform sampler2D uRockMap;
  uniform float uRockMapEnabled;
  vec3 rockSurface(vec3 p) {
    vec3 weights = pow(abs(normalize(cross(dFdx(p), dFdy(p)))), vec3(4.0));
    weights /= max(dot(weights, vec3(1.0)), 0.0001);
    return texture2D(uRockMap, p.yz * 0.20).rgb * weights.x
      + texture2D(uRockMap, p.xz * 0.20).rgb * weights.y
      + texture2D(uRockMap, p.xy * 0.20).rgb * weights.z;
  }
  float mineralHash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float mineralNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(mineralHash(i), mineralHash(i + vec3(1,0,0)), f.x),
          mix(mineralHash(i + vec3(0,1,0)), mineralHash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(mineralHash(i + vec3(0,0,1)), mineralHash(i + vec3(1,0,1)), f.x),
          mix(mineralHash(i + vec3(0,1,1)), mineralHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
`;

function texture(kind, size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const grit = hash(x * 1.27, y * 0.97);
      if (kind === 'wood') {
        const wave = Math.sin(y * 0.09 + noise(x * 0.014, y * 0.03) * 2.8);
        const fibers = Math.sin(x * 1.95 + wave * 1.4) * 0.065;
        const rings = Math.sin(x * 0.18 + wave * 0.9) * 0.10;
        const c = 0.65 + rings + fibers + grit * 0.10;
        data[i] = 174 * c; data[i + 1] = 129 * c; data[i + 2] = 86 * c;
      } else if (kind === 'bark') {
        const stripe = Math.pow(Math.sin(x * 0.2 + noise(x * 0.03, y * 0.04) * 2), 2);
        const c = 0.45 + grit * 0.20 + stripe * 0.27;
        data[i] = 140 * c; data[i + 1] = 122 * c; data[i + 2] = 98 * c;
      } else {
        const c = 190 + grit * 58 + noise(x * 0.09, y * 0.09) * 9;
        data[i] = c; data[i + 1] = c; data[i + 2] = c;
      }
      data[i + 3] = 255;
    }
  }
  const result = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  result.wrapS = result.wrapT = THREE.RepeatWrapping;
  result.magFilter = THREE.LinearFilter;
  result.minFilter = THREE.LinearMipmapLinearFilter;
  result.generateMipmaps = true;
  result.colorSpace = THREE.SRGBColorSpace;
  result.needsUpdate = true;
  return result;
}

function addVegetationWind(shader, uniforms, kind, declarations = '', afterMotion = '') {
  configureVegetationWindShader(shader, uniforms, kind, declarations, afterMotion);
}

function vegetationDepthMaterial(uniforms, kind) {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => addVegetationWind(shader, uniforms, kind);
  material.customProgramCacheKey = () => `island-vegetation-depth-v4-${kind}`;
  if(kind==='crown')attachWinterFoliage(material,uniforms.uFoliageWinter,{sparse:true,depth:true});
  return material;
}

function vegetationMaterial(uniforms, color = 0xffffff, kind = 'ground', leafTexture, mixed = false) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    addVegetationWind(shader, uniforms, kind,
      'attribute float aCover; varying float vLeafCover; varying vec3 vPlantWorld;', 'vLeafCover = aCover;');
    shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vec4 plantWorld = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        plantWorld = instanceMatrix * plantWorld;
      #endif
      vPlantWorld = (modelMatrix * plantWorld).xyz;`);
    shader.fragmentShader = `uniform float uSnow; varying float vLeafCover; varying vec3 vPlantWorld;
      ${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float frost = uSnow * vLeafCover;
      // 表面颜色与颗粒统一由雪面着色器处理。`);
    if (kind === 'crown' || kind === 'palm') shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      #if NUM_DIR_LIGHTS > 0
        float leafBacklight = max(0.0, -dot(normal, directionalLights[0].direction));
        reflectedLight.indirectDiffuse += diffuseColor.rgb * min(directionalLights[0].color, vec3(2.0))
          * (0.022 + leafBacklight * 0.045) * (1.0 - frost);
      #endif`);
  };
  material.customProgramCacheKey = () => `island-vegetation-v4-${kind}`;
  if(kind === 'crown' || kind === 'palm') attachVegetationSurface(material, {kind:'leaf'});
  attachWinterFoliage(material,uniforms.uFoliageWinter,{sparse:kind==='crown'});
  attachSnowSurface(material,uniforms.uSnow,{surface:uniforms});
  return leafTexture ? attachLeafTexture(material,leafTexture,{mixed}) : material;
}

function vegetationBodyMaterial(uniforms, color, kind = 'tree', palm = false) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: .94 });
  material.onBeforeCompile = shader => addVegetationWind(shader, uniforms, kind);
  material.customProgramCacheKey = () => `island-vegetation-body-v4-${kind}`;
  attachSnowSurface(material,uniforms.uSnow,{surface:uniforms});
  return attachVegetationSurface(material, { kind: 'bark', palm });
}

function setPlantAnchors(geometry, plants, repeat = 1) {
  const roots = new Float32Array(plants.length * repeat * 3), heights = new Float32Array(plants.length * repeat);
  for (let i = 0; i < plants.length; i++) {
    const plant = plants[i], root = plant.root ?? plant;
    for (let copy = 0; copy < repeat; copy++) {
      const at = i * repeat + copy;
      roots.set([root.x, root.y, root.z], at * 3); heights[at] = plant.height ?? 5.1 * plant.scale;
    }
  }
  geometry.setAttribute('aPlantRoot', new THREE.InstancedBufferAttribute(roots, 3));
  geometry.setAttribute('aPlantHeight', new THREE.InstancedBufferAttribute(heights, 1));
  if (!geometry.attributes.aFlex) geometry.setAttribute('aFlex', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count), 1));
  return geometry;
}

function* terrainMesh(uniforms) {
  const geometry = new THREE.PlaneGeometry(310, 310, 256, 256);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const biomes = new Float32Array(position.count);
  const slopes = new Float32Array(position.count);
  const lagoons = new Float32Array(position.count);
  const color = new THREE.Color(), sand = new THREE.Color(0xd8c29b), rock = new THREE.Color(0x777c71), soil = new THREE.Color(0x647947);
  for (let i = 0; i < position.count; i++) {
    if (i > 0 && i % 512 === 0) yield;
    const x = position.getX(i), z = position.getZ(i), h = PATH_LAYOUT.heightAtRendered(x, z), slope = slopeAt(x, z);
    position.setY(i, h);
    const shore = shoreDistance(x, z);
    const lagoon = getLagoonMask(x, z, shore), lagoonSand = isLagoonSandAt(x, z, shore);
    lagoons[i] = lagoon;
    const grass = lagoonSand ? 0 : smooth(8, 16, shore) * (1 - smooth(0.75, 1.30, slope)) * (1 - smooth(34, 45, h));
    const crag = lagoonSand ? 0 : smooth(0.68, 1.2, slope) * smooth(7, 17, shore) + smooth(34, 44, h) * 0.7;
    color.copy(sand).lerp(soil, grass).lerp(rock, clamp(crag, 0, 1));
    if (h < 0) color.lerp(new THREE.Color(0x8ea69b), smooth(0, 12, -h) * 0.6);
    if (h < 0 && lagoon > 0) color.lerp(sand, lagoon * .82);
    color.multiplyScalar(0.87 + fbm(x * 0.2, z * 0.2) * 0.13 + hash(x * 3, z * 3) * 0.16);
    colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
    biomes[i] = grass; slopes[i] = clamp(slope, 0, 1);
  }
  yield;
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aBiome', new THREE.BufferAttribute(biomes, 1));
  geometry.setAttribute('aSlope', new THREE.BufferAttribute(slopes, 1));
  geometry.setAttribute('aLagoon', new THREE.BufferAttribute(lagoons, 1));
  geometry.computeVertexNormals();
  const grain = texture('grain'); grain.repeat.set(110, 110);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, map: grain, bumpMap: grain, bumpScale: 0.035, roughness: 0.94 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute float aBiome; attribute float aSlope; attribute float aLagoon; varying float vBiome; varying float vSlope; varying float vLagoon; varying vec3 vLandWorld;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vBiome = aBiome; vSlope = aSlope; vLagoon = aLagoon; vLandWorld = (modelMatrix * vec4(position, 1.0)).xyz;`);
    shader.fragmentShader = `uniform float uTime; uniform float uBeachDaylight; uniform float uSnow; uniform float uLandWetness; uniform vec3 uGroundTint; varying float vBiome; varying float vSlope; varying float vLagoon; varying vec3 vLandWorld;\n${ROCK_NOISE_GLSL}\n${COASTAL_SURFACE_GLSL}\n${BEACH_SWASH_GLSL}\n${SOIL_TRANSITION_GLSL}\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= mix(vec3(1.0), uGroundTint, vBiome);
      float terrainRock = max(smoothstep(0.40, 0.79, vSlope), smoothstep(25.0, 41.0, vLandWorld.y))
        * smoothstep(4.0, 13.0, vLandWorld.y) * (1.0 - vBiome * 0.7);
      float coastBoundary = mineralNoise(vec3(vLandWorld.x * 0.72,vLandWorld.y * 0.3,vLandWorld.z * 0.72)) - 0.5;
      float rockFoot = smoothstep(0.56,0.79,vSlope + coastBoundary * 0.08)
        * smoothstep(1.4,2.7,vLandWorld.y) * (1.0 - smoothstep(9.0,14.0,vLandWorld.y));
      terrainRock = max(terrainRock,rockFoot * (1.0 - vBiome * 0.7));
      float broadMineral = mineralNoise(vLandWorld * 0.24);
      float rockBody = mineralNoise(vLandWorld * 1.15 + broadMineral * 1.7);
      float rockMedium = mineralNoise(vLandWorld * 4.3 + 4.3);
      float fineFootprint = length(fwidth(vLandWorld * 18.0));
      float rockFine = mix(0.5, mineralNoise(vLandWorld * 18.0), 1.0 - smoothstep(0.35, 1.2, fineFootprint));
      float rockGrain = rockBody * 0.48 + rockMedium * 0.32 + rockFine * 0.20;
      // Tilted, broken strata use world coordinates; steep faces cannot stretch a planar UV map.
      float layerPhase = vLandWorld.y * 1.85 + vLandWorld.x * 0.31 + vLandWorld.z * 0.13
        + broadMineral * 4.4 + rockBody * 0.7;
      float rockLayer = sin(layerPhase) * 0.5 + 0.5;
      float layerSeam = 1.0 - smoothstep(0.035 + fwidth(layerPhase) * 0.15, 0.16 + fwidth(layerPhase), rockLayer);
      float jointField = mineralNoise(vLandWorld * 0.85 + vec3(7.0, 2.0, 11.0)) - 0.49;
      float rockFracture = (1.0 - smoothstep(0.009 + fwidth(jointField), 0.038 + fwidth(jointField), abs(jointField)))
        * smoothstep(0.20, 0.65, rockBody);
      float rockTone = 0.73 + broadMineral * 0.26 + rockGrain * 0.24 + rockLayer * 0.055;
      diffuseColor.rgb *= mix(vec3(1.0), vec3(1.035, 1.015, 0.965) * rockTone, terrainRock);
      vec3 rockAlbedo = rockSurface(vLandWorld);
      diffuseColor.rgb *= mix(vec3(1.0), clamp(rockAlbedo * 3.2, 0.35, 1.8), terrainRock * uRockMapEnabled * 0.85);
      diffuseColor.rgb *= 1.0 - (rockFracture * 0.29 + layerSeam * 0.16) * terrainRock * (1.0 - uRockMapEnabled * 0.85);
      float ledgeMoss = smoothstep(0.58, 0.79, rockMedium) * (1.0 - smoothstep(0.6, 0.94, vSlope));
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.83, 1.025, 0.73), ledgeMoss * terrainRock * 0.28);
      diffuseColor.rgb *= 1.0 - uLandWetness * (0.09 + terrainRock * 0.11);
      float grassBoundary = smoothstep(0.12,0.38,vBiome + coastBoundary * 0.08);
      float sandArea = (1.0 - smoothstep(0.2,0.62,terrainRock)) * (1.0 - grassBoundary)
        * (1.0 - smoothstep(4.8 + coastBoundary * 0.4,5.4 + coastBoundary * 0.4,vLandWorld.y));
      float sandPatch = mineralNoise(vec3(vLandWorld.x * 0.38,0.0,vLandWorld.z * 0.38));
      float wetFront=beachWetLevel(vLandWorld.xz,uTime);
      float sandWet=max(uLandWetness,1.0-smoothstep(wetFront-0.09,wetFront+0.17,vLandWorld.y+(sandPatch-0.5)*0.055));
      float sedimentArea = vLagoon * mix(0.16,1.0,1.0 - smoothstep(-1.2,0.3,vLandWorld.y)) * uLagoonMapEnabled;
      vec3 sandAlbedo = vec3(0.5);
      float sandDetail = 0.0;
      if ((uSandMapEnabled > 0.5 || sedimentArea > 0.01) && sandArea > 0.01) {
        sandAlbedo = uSandMapEnabled > 0.5 ? coastalSand(vLandWorld) : diffuseColor.rgb;
        if (sedimentArea > 0.01) sandAlbedo = mix(sandAlbedo,lagoonSediment(vLandWorld),sedimentArea);
        diffuseColor.rgb = mix(diffuseColor.rgb,sandAlbedo * (0.91 + sandPatch * 0.16)
          * (1.0 - sandWet * 0.23),sandArea);
        float shallowSand=(1.0-smoothstep(-0.08,0.03,vLandWorld.y))*smoothstep(-6.0,-2.0,vLandWorld.y);
        float lightWeb=pow(1.0-abs(sin(vLandWorld.x*1.4+sin(vLandWorld.z*0.85+uTime*0.37))
          *cos(vLandWorld.z*1.2+sin(vLandWorld.x*0.68-uTime*0.29))),12.0);
        diffuseColor.rgb*=1.0+lightWeb*shallowSand*uBeachDaylight*0.14*sandArea;
        float sandGrain = dot(sandAlbedo,vec3(0.2126,0.7152,0.0722));
        float sandFootprint = length(fwidth(vLandWorld.xz));
        // Broad, soft accumulation and crossed small ripples give dry sand
        // shape; wet and submerged sand retain their smooth, continuous bed.
        float dryBeach = smoothstep(-0.06,0.3,vLandWorld.y);
        float softSand = coastalSandRelief(vLandWorld.xz,sandFootprint,sandWet,sandGrain);
        sandDetail = mix(sandGrain * 0.002,softSand,dryBeach) * sandArea;
        diffuseColor.rgb *= 1.0 + softSand * dryBeach * sandArea * 4.0;
      }
      float edgeSoil = grassBoundary * (1.0 - vBiome) * (1.0 - terrainRock)
        * (1.0 - smoothstep(7.0,10.0,vLandWorld.y));
      diffuseColor.rgb *= soilTransitionFactor(edgeSoil,rockBody);
      `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `vec3 landGeometricNormal = normal;
      #include <normal_fragment_maps>
      normal = normalize(mix(normal,landGeometricNormal,sandArea * max(uSandMapEnabled,sedimentArea)));
      #ifdef USE_BUMPMAP
        float cragRelief = (rockBody * 0.24 + rockMedium * 0.10 + rockFine * 0.025
          + rockLayer * 0.045 - layerSeam * 0.03 - rockFracture * 0.065) * (1.0 - uRockMapEnabled * 0.75)
          * terrainRock + dot(rockAlbedo, vec3(0.2126, 0.7152, 0.0722)) * uRockMapEnabled * 0.24 * terrainRock;
        float groundRelief = cragRelief + sandDetail;
        normal = perturbNormalArb(-vViewPosition, normal, vec2(dFdx(groundRelief), dFdy(groundRelief)), faceDirection);
      #endif`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor - terrainRock * (rockBody * 0.14 + uLandWetness * 0.27)
        - sandArea * sandWet * 0.16, 0.52, 1.0);`);
  };
  material.customProgramCacheKey = () => 'island-terrain-natural-soil-transition-v9';
  attachSnowSurface(material,uniforms.uSnow,{surface:uniforms,shoreline:true});
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = '连续海床与火山岛'; mesh.receiveShadow = true; mesh.castShadow = true;
  return mesh;
}

function* addForest(group, uniforms, random, leafTextures) {
  const trees = [];
  for (let attempt = 0; trees.length < 1250 && attempt < 35000; attempt++) {
    if (attempt > 0 && attempt % 128 === 0) yield;
    const x = (random() - 0.5) * 143, z = (random() - 0.5) * 141;
    const y = heightAt(x, z), slope = slopeAt(x, z), shore = shoreDistance(x, z);
    if (shore < 12 || y < 3 || y > 34 || slope > 0.99) continue;
    if (isCaveReserved(x, z, 2) || isRestPavilionReserved(x, z, 2.4)
      || PATH_LAYOUT.distanceAt(x, z) < 2.4) continue;
    // A narrow sandy footpath links the southern beach with the dock.
    if (z > 36 && Math.abs(x - Math.sin(z * 0.1) * 1.5) < 3.4) continue;
    if (random() > 0.67 + noise(x * 0.05, z * 0.05) * 0.28) continue;
    trees.push({ x, y: PATH_LAYOUT.heightAtRendered(x, z), z, scale: 0.72 + random() * 0.73, rotation: random() * TAU, tone: random(), variant: trees.length % 4 });
  }
  const leafMaterial = vegetationMaterial(uniforms, 0xffffff, 'crown', leafTextures.broadleaf);
  const leafDepthMaterial = vegetationDepthMaterial(uniforms, 'crown');
  const branchDepthMaterial = vegetationDepthMaterial(uniforms, 'tree');
  const canopies = [];
  const dummy = new THREE.Object3D(), color = new THREE.Color();
  const barkMaterial = vegetationBodyMaterial(uniforms, 0x9b8870);
  const twigMaterial = vegetationBodyMaterial(uniforms, 0x776c5b);
  const trunkGeometry = setPlantAnchors(new THREE.CylinderGeometry(0.11, 0.19, 1, 7, 8), trees, 3);
  const trunks = new THREE.InstancedMesh(trunkGeometry, barkMaterial, trees.length * 3);
  trunks.name = '森林树干与分叉'; trunks.castShadow = true; trunks.receiveShadow = true;
  trunks.customDepthMaterial = vegetationDepthMaterial(uniforms, 'tree');
  for (let variant = 0; variant < 4; variant++) {
    yield;
    const selected = trees.filter((tree) => tree.variant === variant);
    const form = createForestCanopy(1922 + variant * 97);
    const canopy = new THREE.InstancedMesh(setPlantAnchors(form.leaves, selected), leafMaterial, selected.length);
    const branches = new THREE.InstancedMesh(setPlantAnchors(form.branches, selected), twigMaterial, selected.length);
    branches.name = `森林细枝-${variant + 1}`; branches.castShadow = true; branches.receiveShadow = true;
    branches.customDepthMaterial = branchDepthMaterial;
    canopy.name = `阔叶冠层-${variant + 1}`;
    canopy.castShadow = true; canopy.receiveShadow = true;
    canopy.customDepthMaterial = leafDepthMaterial;
    canopy.userData.trees = selected;
    for (let i = 0; i < selected.length; i++) {
      const tree = selected[i];
      dummy.position.set(tree.x, tree.y + 5.1 * tree.scale, tree.z);
      dummy.rotation.set(0, tree.rotation, 0); dummy.scale.set(tree.scale, tree.scale * (0.85 + tree.tone * 0.2), tree.scale);
      dummy.updateMatrix(); canopy.setMatrixAt(i, dummy.matrix); branches.setMatrixAt(i, dummy.matrix);
      color.setHex(PALETTES[1][Math.floor(tree.tone * 5)]); canopy.setColorAt(i, color);
    }
    canopies.push(canopy); group.add(canopy, branches);
  }
  for (let i = 0; i < trees.length; i++) {
    const tree = trees[i], height = tree.scale * 5.1;
    dummy.position.set(tree.x, tree.y + height * 0.48, tree.z);
    dummy.rotation.set(0, tree.rotation, 0.055 * Math.sin(tree.rotation));
    dummy.scale.set(tree.scale, height, tree.scale); dummy.updateMatrix(); trunks.setMatrixAt(i * 3, dummy.matrix);
    for (let branch = 0; branch < 2; branch++) {
      const angle = tree.rotation + branch * Math.PI + 0.7;
      dummy.position.set(tree.x + Math.cos(angle) * tree.scale * 0.43, tree.y + height * 0.76, tree.z + Math.sin(angle) * tree.scale * 0.43);
      dummy.rotation.set(Math.sin(angle) * 0.45, 0, -Math.cos(angle) * 0.45);
      dummy.scale.set(tree.scale * 0.55, height * 0.40, tree.scale * 0.55);
      dummy.updateMatrix(); trunks.setMatrixAt(i * 3 + branch + 1, dummy.matrix);
    }
  }
  group.add(trunks);
  return { trees, canopies, trunks };
}

function palmCrownGeometry() {
  const random = seededRandom(371), positions = [], colors = [], flex = [], indices = [], uvs = [], masks = [];
  const add = (x, y, z, shade, bend, u=.5, v=0, mask=0) => { positions.push(x, y, z); colors.push(0.28 * shade, 0.47 * shade, 0.18 * shade); flex.push(bend);uvs.push(u,v);masks.push(mask); };
  for (let frond = 0; frond < 11; frond++) {
    const angle = frond / 11 * TAU + random() * 0.2;
    const length = 4.5 + random() * 2.3;
    const rotate = (x, z) => [x * Math.cos(angle) - z * Math.sin(angle), x * Math.sin(angle) + z * Math.cos(angle)];
    const stem = [];
    for (let segment = 0; segment <= 20; segment++) {
      const t = segment / 20, point = rotate(t * length, 0);
      stem.push(new THREE.Vector3(point[0], 0.9 * Math.sin(t * Math.PI) - 1.8 * t * t + (frond % 3) * 0.07, point[1]));
    }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(stem), 20, 0.034, 4, false);
    const tp = tube.attributes.position;
    const offset = positions.length / 3;
    for (let i = 0; i < tp.count; i++) add(tp.getX(i), tp.getY(i), tp.getZ(i), 0.85,
      getVegetationFlex('palm', Math.hypot(tp.getX(i), tp.getZ(i)) / length));
    for (let i = 0; i < tube.index.count; i++) indices.push(offset + tube.index.array[i]);
    tube.dispose();
    for (let leaf = 1; leaf <= 23; leaf++) {
      const t = leaf / 25, x = t * length;
      const y = 0.9 * Math.sin(t * Math.PI) - 1.8 * t * t + (frond % 3) * 0.07;
      const reach = (0.25 + Math.sin(t * Math.PI) * 1.04) * (1.2 - t * 0.35);
      for (const side of [-1, 1]) {
        const index = positions.length / 3;
        const shape = [[x, y, 0], [x + 0.27, y + 0.03, side * reach * 0.47], [x + 0.42, y - 0.19, side * reach], [x + 0.35, y - 0.05, side * reach * 0.43]];
        for (const [i,point] of shape.entries()) { const p = rotate(point[0], point[2]); const uv=[[.5,0],[0,.47],[.5,1],[1,.47]][i]; add(p[0], point[1], p[1], 0.86 + random() * 0.30, getVegetationFlex('palm', t),uv[0],uv[1],1); }
        indices.push(index, index + 1, index + 2, index, index + 2, index + 3);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs,2));
  geometry.setAttribute('aLeafTexture',new THREE.Float32BufferAttribute(masks,1));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aFlex', new THREE.Float32BufferAttribute(flex, 1));
  geometry.setAttribute('aCover', new THREE.Float32BufferAttribute(flex.map(() => 0.15), 1));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function addPalms(group, uniforms, random, leafTextures) {
  const palms = [], trunks = [];
  for (let attempt = 0; palms.length < 48 && attempt < 2500; attempt++) {
    const angle = random() * TAU, radius = coastRadius(angle) - 6 - random() * 7;
    const x = Math.cos(angle) * radius / 1.025, z = Math.sin(angle) * radius / 0.975;
    const terrainY = heightAt(x, z);
    if (terrainY < 0.8 || terrainY > 5.2 || slopeAt(x, z) > 0.62 || (z > 50 && Math.abs(x) < 6)
      || isCaveReserved(x, z, 1) || PATH_LAYOUT.distanceAt(x, z) < 1.2) continue;
    const y = PATH_LAYOUT.heightAtRendered(x, z);
    const height = 8.5 + random() * 5.5, bend = 1.2 + random() * 3.0, direction = angle + (random() - 0.5) * 1.3;
    const points = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      points.push(new THREE.Vector3(x + Math.cos(direction) * bend * t * t, y + height * t, z + Math.sin(direction) * bend * t * t));
    }
    const trunk = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, 0.20, 9, false);
    const p = trunk.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = clamp((p.getY(i) - y) / height, 0, 1);
      const centerX = x + Math.cos(direction) * bend * t * t, centerZ = z + Math.sin(direction) * bend * t * t;
      const scale = 1.35 - t * 0.55 + Math.sin(t * height * 10) * 0.035;
      p.setX(i, centerX + (p.getX(i) - centerX) * scale);
      p.setZ(i, centerZ + (p.getZ(i) - centerZ) * scale);
    }
    const roots = new Float32Array(p.count * 3), heights = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) { roots.set([x, y, z], i * 3); heights[i] = height; }
    trunk.setAttribute('aPlantRoot', new THREE.Float32BufferAttribute(roots, 3));
    trunk.setAttribute('aPlantHeight', new THREE.Float32BufferAttribute(heights, 1));
    trunk.setAttribute('aFlex', new THREE.Float32BufferAttribute(new Float32Array(p.count), 1));
    trunk.computeVertexNormals(); trunks.push(trunk);
    palms.push({ root: points[0], height, top: points[6], scale: 0.78 + random() * 0.27, rotation: direction });
  }
  const trunkMaterial = vegetationBodyMaterial(uniforms, 0xc1a982, 'palmBody', true);
  const trunkMesh = new THREE.Mesh(mergeGeometries(trunks), trunkMaterial);
  trunkMesh.customDepthMaterial = vegetationDepthMaterial(uniforms, 'palmBody');
  trunkMesh.name = '弯曲椰树与生长环'; trunkMesh.castShadow = true; trunkMesh.receiveShadow = true; group.add(trunkMesh);
  for (const geometry of trunks) geometry.dispose();
  const leaves = new THREE.InstancedMesh(setPlantAnchors(palmCrownGeometry(), palms), vegetationMaterial(uniforms, 0xffffff, 'palm', leafTextures.palm, true), palms.length);
  leaves.name = '椰树羽状叶'; leaves.castShadow = true; leaves.receiveShadow = true;
  leaves.customDepthMaterial = vegetationDepthMaterial(uniforms, 'palm');
  const dummy = new THREE.Object3D();
  for (let i = 0; i < palms.length; i++) {
    const palm = palms[i]; dummy.position.copy(palm.top); dummy.rotation.set(0, palm.rotation, 0); dummy.scale.setScalar(palm.scale); dummy.updateMatrix(); leaves.setMatrixAt(i, dummy.matrix);
  }
  group.add(leaves);
  const coconutMaterial = new THREE.MeshStandardMaterial({ color: 0x6b6330, roughness: 1 });
  coconutMaterial.onBeforeCompile = shader => addVegetationWind(shader, uniforms, 'palmBody');
  coconutMaterial.customProgramCacheKey = () => 'island-coconut-body-v4';
  const coconuts = new THREE.InstancedMesh(setPlantAnchors(new THREE.SphereGeometry(0.17, 7, 6), palms, 3), coconutMaterial, palms.length * 3);
  coconuts.customDepthMaterial = vegetationDepthMaterial(uniforms, 'palmBody');
  coconuts.name = '椰子果簇'; coconuts.castShadow = true;
  for (let i = 0; i < palms.length; i++) {
    for (let k = 0; k < 3; k++) {
      const a = k * TAU / 3; dummy.position.copy(palms[i].top); dummy.position.x += Math.cos(a) * 0.28; dummy.position.z += Math.sin(a) * 0.28; dummy.position.y -= 0.28;
      dummy.rotation.set(0, a, 0); dummy.scale.set(1, 1.35, 1); dummy.updateMatrix(); coconuts.setMatrixAt(i * 3 + k, dummy.matrix);
    }
  }
  group.add(coconuts);
  return palms.length;
}

function grassGeometry() {
  const random = seededRandom(92), positions = [], indices = [], bending = [], cover = [], colors = [];
  for (let blade = 0; blade < 16; blade++) {
    const angle = random() * TAU, x = (random() - 0.5) * 0.8, z = (random() - 0.5) * 0.8;
    const height = 0.33 + random() * 0.58, lean = 0.15 + random() * 0.2, width = 0.018 + random() * 0.014;
    const offset = positions.length / 3;
    for (let segment = 0; segment <= 3; segment++) {
      const t = segment / 3, w = width * (1 - t);
      // The two edges meet at one tip. Keeping a duplicate tip creates a
      // zero-area triangle in every blade and an unused zero normal.
      for (const side of segment === 3 ? [0] : [-1, 1]) {
        positions.push(x + Math.cos(angle) * lean * t * t + Math.sin(angle) * w * side, height * t, z + Math.sin(angle) * lean * t * t - Math.cos(angle) * w * side);
        bending.push(getVegetationFlex('ground', t)); cover.push(t);
        const c = 0.6 + t * 0.35; colors.push(c * 0.53, c * 0.75, c * 0.27);
      }
      if (segment < 2) { const a = offset + segment * 2; indices.push(a, a + 1, a + 3, a, a + 3, a + 2); }
      else if (segment === 2) { const a = offset + segment * 2; indices.push(a, a + 1, a + 2); }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aFlex', new THREE.Float32BufferAttribute(bending, 1));
  geometry.setAttribute('aCover', new THREE.Float32BufferAttribute(cover, 1));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function flowerGeometry() {
  const parts = [], random = seededRandom(49);
  const addPart = (geometry, color) => {
    const values = new Float32Array(geometry.attributes.position.count * 3), c = new THREE.Color(color);
    for (let i = 0; i < values.length; i += 3) { values[i] = c.r; values[i + 1] = c.g; values[i + 2] = c.b; }
    geometry.setAttribute('color', new THREE.BufferAttribute(values, 3)); parts.push(geometry);
  };
  for (let flower = 0; flower < 5; flower++) {
    const x = (random() - 0.5) * 0.9, z = (random() - 0.5) * 0.9, y = 0.28 + random() * 0.35;
    const stem = new THREE.CylinderGeometry(0.011, 0.017, y, 3, 4, true); stem.translate(x, y * 0.5, z); addPart(stem, 0x597b37);
    const center = new THREE.SphereGeometry(0.035, 4, 2); center.translate(x, y, z); addPart(center, 0xe3bb4b);
    for (let petal = 0; petal < 5; petal++) {
      const angle = petal / 5 * TAU;
      const geometry = new THREE.CircleGeometry(0.068, 5); geometry.rotateX(-Math.PI / 2); geometry.scale(0.73, 1, 1.3); geometry.rotateY(angle);
      geometry.translate(x + Math.sin(angle) * 0.065, y, z + Math.cos(angle) * 0.065); addPart(geometry, flower % 2 ? 0xeec7d5 : 0xf1e4bc);
    }
  }
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  const p = geometry.attributes.position;
  const flex = new Float32Array(p.count), cover = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) { flex[i] = getVegetationFlex('ground', p.getY(i) * 2.8); cover[i] = flex[i]; }
  geometry.setAttribute('aFlex', new THREE.BufferAttribute(flex, 1)); geometry.setAttribute('aCover', new THREE.BufferAttribute(cover, 1));
  return geometry;
}

function fernGeometry() {
  const positions = [], indices = [], colors = [], flex = [], cover = [], uvs = [], masks = [];
  const random = seededRandom(571);
  const vertex = (x, y, z, angle, t, shade, u=.5, v=0, mask=0) => {
    positions.push(x * Math.cos(angle) - z * Math.sin(angle), y, x * Math.sin(angle) + z * Math.cos(angle));
    colors.push(0.21 * shade, 0.38 * shade, 0.13 * shade); flex.push(getVegetationFlex('ground', t)); cover.push(t);uvs.push(u,v);masks.push(mask);
  };
  for (let frond = 0; frond < 8; frond++) {
    const angle = frond / 8 * TAU, length = 0.55 + random() * 0.35;
    for (let i = 0; i < 8; i++) {
      const t = i / 8, next = (i + 1) / 8;
      const y = 0.38 * Math.sin(t * Math.PI) - 0.2 * t * t, ny = 0.38 * Math.sin(next * Math.PI) - 0.2 * next * next;
      const index = positions.length / 3;
      vertex(t * length, y, -0.01, angle, t, 0.9); vertex(t * length, y, 0.01, angle, t, 0.9);
      vertex(next * length, ny, 0.007, angle, next, 1); vertex(next * length, ny, -0.007, angle, next, 1);
      indices.push(index, index + 1, index + 2, index, index + 2, index + 3);
      if (i === 0) continue;
      const reach = 0.25 * Math.sin(t * Math.PI) * (1.2 - t);
      for (const side of [-1, 1]) {
        const base = positions.length / 3, shade = 0.88 + random() * 0.23;
        vertex(t * length - 0.025, y, 0, angle, t, shade, .5,0,1);
        vertex(t * length + 0.04, y + 0.025, side * reach * 0.45, angle, t, shade, 0,.45,1);
        vertex(t * length + 0.085, y - 0.04, side * reach, angle, t, shade, .5,1,1);
        vertex(t * length + 0.065, y - 0.015, side * reach * 0.42, angle, t, shade, 1,.45,1);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setAttribute('aLeafTexture',new THREE.Float32BufferAttribute(masks,1));
  geometry.setAttribute('aFlex', new THREE.Float32BufferAttribute(flex, 1)); geometry.setAttribute('aCover', new THREE.Float32BufferAttribute(cover, 1));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

function* addUnderstory(group, uniforms, random, leafTextures) {
  const spots = [];
  for (let attempt = 0; spots.length < 4200 && attempt < 40000; attempt++) {
    if (attempt > 0 && attempt % 128 === 0) yield;
    const x = (random() - 0.5) * 147, z = (random() - 0.5) * 145, y = heightAt(x, z), distance = shoreDistance(x, z);
    if (distance < 8 || y < 1.35 || y > 31 || slopeAt(x, z) > 0.76) continue;
    if (isCaveReserved(x, z, .2) || PATH_LAYOUT.distanceAt(x, z) < .6) continue;
    if (z > 38 && Math.abs(x - Math.sin(z * 0.1) * 1.5) < 3) continue;
    spots.push({ x, y: PATH_LAYOUT.heightAtRendered(x, z), z, scale: 0.65 + random() * 1.0, angle: random() * TAU });
  }
  yield;
  // Finish the original sampling first: filtering must not advance its random
  // stream or renumber the flower/fern selections in the forest.
  const grassSpots = spots.map(beachGrassPlacement).filter(Boolean);
  const material = vegetationMaterial(uniforms);
  const depthMaterial = vegetationDepthMaterial(uniforms, 'ground');
  const grass = new THREE.InstancedMesh(grassGeometry(), material, grassSpots.length);
  grass.customDepthMaterial = depthMaterial;
  grass.name = '海岛草丛'; grass.receiveShadow = true;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < grassSpots.length; i++) {
    const spot = grassSpots[i]; dummy.position.set(spot.x, spot.y - 0.02, spot.z); dummy.rotation.set(0, spot.angle, 0);
    dummy.scale.set(spot.scaleX ?? spot.scale, spot.scaleY ?? spot.scale, spot.scaleZ ?? spot.scale);
    dummy.updateMatrix(); grass.setMatrixAt(i, dummy.matrix);
  }
  group.add(grass);
  const flowerSpots = spots.filter((spot, i) => i % 5 === 0 && spot.y < 13).slice(0, 650).filter(spot => !isOpenBeach(spot));
  const flowers = new THREE.InstancedMesh(flowerGeometry(), material, flowerSpots.length);
  flowers.customDepthMaterial = depthMaterial;
  flowers.name = '春季野花'; flowers.receiveShadow = true;
  for (let i = 0; i < flowerSpots.length; i++) {
    const spot = flowerSpots[i]; dummy.position.set(spot.x + 0.3, PATH_LAYOUT.heightAtRendered(spot.x + 0.3, spot.z), spot.z); dummy.rotation.set(0, spot.angle, 0); dummy.scale.setScalar(0.8 + spot.scale * 0.5);
    dummy.updateMatrix(); flowers.setMatrixAt(i, dummy.matrix);
  }
  group.add(flowers);
  // Broad-leaved ferns make the beach-to-forest transition less uniform.
  const fernLeaves = fernGeometry();
  const fernSpots = spots.filter((spot, i) => i % 10 === 0 && spot.y < 18 && !isOpenBeach(spot));
  const ferns = new THREE.InstancedMesh(fernLeaves, vegetationMaterial(uniforms,0xffffff,'ground',leafTextures.palm,true), fernSpots.length);
  ferns.customDepthMaterial = depthMaterial;
  ferns.name = '林下蕨类'; ferns.receiveShadow = true;
  for (let i = 0; i < fernSpots.length; i++) {
    const spot = fernSpots[i]; dummy.position.set(spot.x, spot.y + 0.36, spot.z); dummy.rotation.set(0, spot.angle, 0); dummy.scale.setScalar(spot.scale); dummy.updateMatrix(); ferns.setMatrixAt(i, dummy.matrix);
  }
  group.add(ferns);
  return { grass, flowers, ferns, grassCount: grassSpots.length, flowerCount: flowerSpots.length };
}

function rockGeometry(seed) {
  const geometry = new THREE.IcosahedronGeometry(1, 2), p = geometry.attributes.position;
  const colors = new Float32Array(p.count * 3), color = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = 1 + fbm(x * 2 + seed, z * 2 + y * 3) * 0.24;
    p.setXYZ(i, x * r, y * r * (0.96 + noise(x * 3, z * 3) * 0.09), z * r);
    const tint = 0.62 + noise(x * 4 + seed, y * 4 + z) * 0.09;
    color.setRGB(tint * 0.83, tint * 0.86, tint * 0.80);
    colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.computeVertexNormals();
  return addSmoothSnowNormals(geometry);
}

function addRocks(group, random, uniforms) {
  const grain = texture('grain', 128); grain.repeat.set(3, 3);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, map: grain, bumpMap: grain, bumpScale: 0.19 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRockMap = uniforms.uRockMap;
    shader.uniforms.uRockMapEnabled = uniforms.uRockMapEnabled;
    shader.vertexShader = `varying vec3 vRockWorld;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vec4 rockWorld = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        rockWorld = instanceMatrix * rockWorld;
      #endif
      vRockWorld = (modelMatrix * rockWorld).xyz;`);
    shader.fragmentShader = `varying vec3 vRockWorld;\n${ROCK_NOISE_GLSL}\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= mix(0.53, 1.0, smoothstep(-0.1, 1.15, vRockWorld.y));
      float stoneGrain = mineralNoise(vRockWorld * 2.8) * 0.7 + mineralNoise(vRockWorld * 9.1) * 0.3;
      float stoneCrack = 1.0 - smoothstep(0.014, 0.06, abs(mineralNoise(vRockWorld * 1.6) - 0.52));
      diffuseColor.rgb *= 0.85 + stoneGrain * 0.27 - stoneCrack * 0.08;
      vec3 rockAlbedo = rockSurface(vRockWorld);
      diffuseColor.rgb *= mix(vec3(1.0), clamp(rockAlbedo * 3.2, 0.35, 1.8), uRockMapEnabled * 0.85);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      #ifdef USE_BUMPMAP
        float stoneRelief = stoneGrain * 0.12 - stoneCrack * 0.04
          + dot(rockAlbedo, vec3(0.2126, 0.7152, 0.0722)) * uRockMapEnabled * 0.12;
        normal = perturbNormalArb(-vViewPosition, normal, vec2(dFdx(stoneRelief), dFdy(stoneRelief)), faceDirection);
      #endif`);
  };
  material.customProgramCacheKey = () => 'island-textured-rock-v3';
  attachSnowSurface(material,uniforms.uSnow,{surface:uniforms,smoothNormals:true});
  const rocks = [];
  for (let i = 0; i < 130; i++) {
    const angle = random() * TAU, distance = -5.0 + random() * 9;
    const r = coastRadius(angle) - distance, x = Math.cos(angle) * r / 1.025, z = Math.sin(angle) * r / 0.975;
    if (z > 62 && Math.abs(x) < 8) continue;
    if (isCaveReserved(x, z, .5) || PATH_LAYOUT.distanceAt(x, z) < 1) continue;
    const scale = 0.6 + Math.pow(random(), 1.8) * 3.3;
    rocks.push({ x, y: PATH_LAYOUT.heightAtRendered(x, z) - scale * 0.4, z, sx: scale * (0.9 + random() * 0.6), sy: scale * (0.5 + random() * 0.6), sz: scale * (0.8 + random() * 0.5), rotation: random() * TAU });
  }
  for (let i = 0; i < 36; i++) {
    const x = 28 + random() * 27, z = -38 + random() * 45, y = heightAt(x, z);
    if (y < 6 || slopeAt(x, z) < 0.6) continue;
    if (isCaveReserved(x, z, .5) || PATH_LAYOUT.distanceAt(x, z) < 1) continue;
    const scale = 1.5 + random() * 2.4;
    rocks.push({ x, y: PATH_LAYOUT.heightAtRendered(x, z) - scale * 0.4, z, sx: scale * 1.5, sy: scale * 1.25, sz: scale, rotation: random() * TAU });
  }
  // Small embedded outcrops add real silhouettes to exposed slopes without more draw calls.
  for (let attempt = 0, placed = 0; attempt < 1800 && placed < 180; attempt++) {
    const x = (random() - .5) * 76, z = -42 + random() * 78;
    const y = heightAt(x, z), slope = slopeAt(x, z);
    if (y < 13 || slope < .57 || isCaveReserved(x, z, 1) || PATH_LAYOUT.distanceAt(x, z) < 1.25
      || isLighthouseReserved(x, z, 1.8) || isRestPavilionReserved(x, z, 1.8)) continue;
    const scale = .24 + Math.pow(random(), 1.6) * 1.05;
    rocks.push({ x, y: PATH_LAYOUT.heightAtRendered(x, z) - scale * .32, z,
      sx: scale * (1.0 + random() * .8), sy: scale * (.5 + random() * .35),
      sz: scale * (.65 + random() * .65), rotation: random() * TAU });
    placed++;
  }
  const dummy = new THREE.Object3D();
  for (let variant = 0; variant < 3; variant++) {
    const selected = rocks.filter((rock, i) => i % 3 === variant);
    const mesh = new THREE.InstancedMesh(rockGeometry(19 + variant * 10), material, selected.length);
    mesh.name = `海岸玄武岩-${variant + 1}`; mesh.castShadow = true; mesh.receiveShadow = true;
    for (let i = 0; i < selected.length; i++) {
      const rock = selected[i]; dummy.position.set(rock.x, rock.y, rock.z); dummy.rotation.set(rock.rotation * 0.16, rock.rotation, rock.rotation * 0.08);
      dummy.scale.set(rock.sx, rock.sy, rock.sz); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    }
    group.add(mesh);
  }
  const pebblePositions = [];
  for (let attempt = 0; pebblePositions.length < 1000 && attempt < 16000; attempt++) {
    const angle = random() * TAU, r = coastRadius(angle) - 0.7 - random() * 10;
    const x = Math.cos(angle) * r / 1.025, z = Math.sin(angle) * r / 0.975, y = heightAt(x, z);
    if (y > 3 || y < 0.10) continue;
    pebblePositions.push({ x, y: PATH_LAYOUT.heightAtRendered(x, z), z, scale: 0.05 + random() * 0.14, angle: random() * TAU });
  }
  // Keep the random candidate stream unchanged for the later dock and birds.
  // Exposed walking sand stays clear; a few tiny stones cluster by outcrops.
  const shelteredPebbles = pebblePositions.filter((p,i) => i % 5 === 0
    && PATH_LAYOUT.distanceAt(p.x,p.z) > 1.8
    && rocks.some(rock => Math.hypot(p.x-rock.x,p.z-rock.z) < Math.max(rock.sx,rock.sz)+1.1)).slice(0,64);
  const pebbles = new THREE.InstancedMesh(rockGeometry(112), material, shelteredPebbles.length);
  pebbles.name = '沙滩细砾'; pebbles.receiveShadow = true;
  for (let i = 0; i < shelteredPebbles.length; i++) {
    const pebble = shelteredPebbles[i], size = pebble.scale * 0.3;
    dummy.position.set(pebble.x, pebble.y + size * 0.12, pebble.z); dummy.rotation.set(0.1, pebble.angle, 0.2); dummy.scale.set(size * 1.4, size * 0.4, size);
    dummy.updateMatrix(); pebbles.setMatrixAt(i, dummy.matrix);
  }
  group.add(pebbles);
  return rocks.length;
}

function addDock(group, uniforms) {
  const dock = new THREE.Group(); dock.name = '旧木码头';
  const surface = createStructureSurfaceState();
  const wood = texture('wood'); wood.repeat.set(2, 1);
  const material = new THREE.MeshStandardMaterial({ map: wood, bumpMap: wood, bumpScale: 0.04, roughness: 0.83, color: 0xded4c2 });
  const darkWood = material.clone(); darkWood.color.setHex(0xa3a090);
  attachStructureSurface(material, surface); attachStructureSurface(darkWood, surface);
  attachSnowSurface(material,uniforms.uSnow,{surface:uniforms}); attachSnowSurface(darkWood,uniforms.uSnow,{surface:uniforms});
  const dummy = new THREE.Object3D();
  const boards = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, 47);
  boards.name = '独立木铺板'; boards.castShadow = true; boards.receiveShadow = true;
  for (let i = 0; i < 47; i++) {
    dummy.position.set(0, 2.03 + Math.sin(i * 2.17) * 0.016, 65 + i * 0.79);
    dummy.rotation.set(0, Math.sin(i * 1.13) * 0.002, Math.cos(i) * 0.002);
    dummy.scale.set(i > 36 ? 6.2 : 4.7, 0.17, 0.73); dummy.updateMatrix(); boards.setMatrixAt(i, dummy.matrix);
  }
  dock.add(boards);
  const capMaterial=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.98,transparent:true,opacity:.98,depthWrite:false});
  attachSnowSurface(capMaterial,uniforms.uSnow,{surface:uniforms,layer:true,volume:true,growth:true});
  const snowCaps=new THREE.InstancedMesh(createSnowBoardGeometry(),capMaterial,47);
  snowCaps.name='码头铺板积雪';snowCaps.visible=false;snowCaps.receiveShadow=true;
  for(let i=0;i<47;i++) {
    const depth=WEATHER_CONFIG.snowpack.dockDepth*(.8+.4*hash(i*1.31,7.9));
    dummy.position.set(0,2.03+Math.sin(i*2.17)*.016+.085+depth*.5,65+i*.79);
    dummy.rotation.set(0,Math.sin(i*1.13)*.002,Math.cos(i)*.002);
    dummy.scale.set((i>36?6.2:4.7)-.025,depth,.71);dummy.updateMatrix();snowCaps.setMatrixAt(i,dummy.matrix);
  }
  dock.add(snowCaps);
  const supportPositions = [];
  for (let i = 0; i < 7; i++) {
    const z = 66 + i * 5.8, halfWidth = i > 4 ? 2.85 : 2.13;
    supportPositions.push([-halfWidth, z], [halfWidth, z]);
  }
  const pillars = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.19, 0.26, 1, 10), darkWood, supportPositions.length);
  pillars.name = '水下木桩'; pillars.castShadow = true; pillars.receiveShadow = true;
  for (let i = 0; i < supportPositions.length; i++) {
    const [x, z] = supportPositions[i], bottom = Math.min(heightAt(x, z) - 0.6, -2.8);
    dummy.position.set(x, (2.22 + bottom) * 0.5, z); dummy.rotation.set(0.01 * Math.sin(i), i * 0.31, 0.018 * Math.cos(i));
    dummy.scale.set(1, 2.22 - bottom, 1); dummy.updateMatrix(); pillars.setMatrixAt(i, dummy.matrix);
  }
  dock.add(pillars);
  const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), darkWood, 9);
  beams.name = '横梁与纵向承重木'; beams.castShadow = true; beams.receiveShadow = true;
  for (let i = 0; i < 9; i++) {
    dummy.rotation.set(0, 0, 0);
    if (i < 7) { dummy.position.set(0, 1.75, 66 + i * 5.8); dummy.scale.set(i > 4 ? 6.0 : 4.8, 0.28, 0.35); }
    else { dummy.position.set((i === 7 ? -1 : 1) * 1.72, 1.79, 83.1); dummy.scale.set(0.28, 0.34, 36.5); }
    dummy.updateMatrix(); beams.setMatrixAt(i, dummy.matrix);
  }
  dock.add(beams);
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 1.02, 0.16), material, supportPositions.length);
  posts.name = '绳栏木立柱'; posts.castShadow = true;
  for (let i = 0; i < supportPositions.length; i++) {
    dummy.position.set(supportPositions[i][0], 2.61, supportPositions[i][1]); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); posts.setMatrixAt(i, dummy.matrix);
  }
  dock.add(posts);
  const ropeParts = [];
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < 6; i++) {
      const a = supportPositions[i * 2 + side], b = supportPositions[(i + 1) * 2 + side];
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(a[0], 2.96, a[1]), new THREE.Vector3((a[0] + b[0]) * 0.5, 2.67, (a[1] + b[1]) * 0.5), new THREE.Vector3(b[0], 2.96, b[1])]);
      ropeParts.push(new THREE.TubeGeometry(curve, 12, 0.033, 5, false));
    }
  }
  const rope = new THREE.Mesh(mergeGeometries(ropeParts), new THREE.MeshStandardMaterial({ color: 0xc1b08d, roughness: 1 }));
  rope.name = '下垂麻绳'; rope.castShadow = true; dock.add(rope); for (const geometry of ropeParts) geometry.dispose();
  const nails = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.024, 0.024, 0.011, 6), new THREE.MeshStandardMaterial({ color: 0x343c3d, roughness: 0.65, metalness: 0.5 }), 47 * 4);
  nails.name = '铺板钉头';
  for (let i = 0; i < 47; i++) {
    const halfWidth = i > 36 ? 2.83 : 2.05;
    for (let k = 0; k < 4; k++) {
      dummy.position.set((k % 2 ? 1 : -1) * halfWidth, 2.12 + Math.sin(i * 2.17) * 0.016, 65 + i * 0.79 + (k < 2 ? -0.21 : 0.21));
      dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); nails.setMatrixAt(i * 4 + k, dummy.matrix);
    }
  }
  dock.add(nails);
  const cleatParts = [];
  for (const x of [-2.55, 2.55]) {
    const stem = new THREE.CylinderGeometry(0.05, 0.09, 0.2, 8); stem.translate(x, 2.18, 100.2); cleatParts.push(stem);
    const top = new THREE.BoxGeometry(0.51, 0.09, 0.11); top.translate(x, 2.3, 100.2); cleatParts.push(top);
  }
  const cleats = new THREE.Mesh(mergeGeometries(cleatParts), new THREE.MeshStandardMaterial({ color: 0x3c494c, roughness: 0.45, metalness: 0.75 }));
  cleats.name = '铸铁系船栓'; cleats.castShadow = true; dock.add(cleats); for (const geometry of cleatParts) geometry.dispose();
  const lampPositions = [[-2.12, 69], [2.12, 84], [-2.82, 99]];
  const lampPoles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 1.64, 0.14), darkWood, 3);
  lampPoles.name = '灯笼木柱'; lampPoles.castShadow = true;
  const frameParts = [];
  for (const x of [-0.135, 0.135]) for (const z of [-0.135, 0.135]) {
    const bar = new THREE.BoxGeometry(0.026, 0.40, 0.026); bar.translate(x, 0, z); frameParts.push(bar);
  }
  for (const y of [-0.22, 0.22]) { const cap = new THREE.BoxGeometry(0.34, 0.043, 0.34); cap.translate(0, y, 0); frameParts.push(cap); }
  const roof = new THREE.ConeGeometry(0.25, 0.15, 4); roof.rotateY(Math.PI / 4); roof.translate(0, 0.32, 0); frameParts.push(roof);
  const lampFrames = new THREE.InstancedMesh(mergeGeometries(frameParts), darkWood, 3);
  lampFrames.name = '小型木灯笼框'; for (const geometry of frameParts) geometry.dispose();
  const lampGlow = new THREE.MeshStandardMaterial({ color: 0xdcc59a, emissive: 0xffb65f, emissiveIntensity: 0, roughness: 0.65 });
  const lanterns = new THREE.InstancedMesh(new THREE.BoxGeometry(0.235, 0.34, 0.235), lampGlow, 3);
  lanterns.name = '暖色灯笼玻璃';
  const lights = [];
  for (let i = 0; i < 3; i++) {
    const [x, z] = lampPositions[i]; dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
    dummy.position.set(x, 2.93, z); dummy.updateMatrix(); lampPoles.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, 3.88, z); dummy.updateMatrix(); lampFrames.setMatrixAt(i, dummy.matrix); lanterns.setMatrixAt(i, dummy.matrix);
    const light = new THREE.PointLight(0xffb86d, 0, 25, 2); light.position.set(x, 3.88, z); light.castShadow = false; light.name = `码头暖灯-${i + 1}`;
    lights.push(light); dock.add(light);
  }
  dock.add(lampPoles, lampFrames, lanterns);
  group.add(dock);
  return { lights, snowCaps, material: lampGlow, setSurfaceMaps: surface.setMaps, dispose: surface.dispose };
}

function gullWing() {
  const points = [[0, 0, 0.06], [0.53, 0.08, 0.02], [1.17, 0.02, -0.15], [1.8, -0.16, -0.47], [1.25, -0.06, -0.40], [0.58, 0.06, -0.32], [0, 0, -0.24]];
  const positions = [], colors = [];
  for (const p of points) { positions.push(...p); const c = p[0] > 1.4 ? 0.12 : p[0] > 1.1 ? 0.77 : 0.93; colors.push(c, c * 1.01, c * 1.025); }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex([0, 1, 5, 0, 5, 6, 1, 2, 4, 1, 4, 5, 2, 3, 4]); geometry.computeVertexNormals();
  return geometry;
}

function gullBody() {
  const parts = [];
  const add = (geometry, c) => {
    const color = new THREE.Color(c), values = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < values.length; i += 3) { values[i] = color.r; values[i + 1] = color.g; values[i + 2] = color.b; }
    geometry.setAttribute('color', new THREE.BufferAttribute(values, 3)); parts.push(geometry);
  };
  const body = new THREE.SphereGeometry(1, 10, 7); body.scale(0.14, 0.17, 0.39); add(body, 0xe6e9e4);
  const head = new THREE.SphereGeometry(0.12, 8, 6); head.translate(0, 0.075, 0.34); add(head, 0xf5f3e8);
  const beak = new THREE.ConeGeometry(0.045, 0.18, 5); beak.rotateX(Math.PI / 2); beak.translate(0, 0.055, 0.48); add(beak, 0xc9a35b);
  const tail = new THREE.ConeGeometry(0.11, 0.3, 5); tail.scale(1, 1, 0.3); tail.rotateX(-Math.PI / 2); tail.translate(0, 0.03, -0.40); add(tail, 0xbec6c1);
  const geometry = mergeGeometries(parts); for (const part of parts) part.dispose(); return geometry;
}

function addBirds(group, random) {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.72, vertexColors: true, side: THREE.DoubleSide });
  const bodyGeometry = gullBody(), wingGeometry = gullWing(), birds = [];
  for (let i = 0; i < 36; i++) {
    const bird = new THREE.Group(); bird.name = `海鸟-${i + 1}`;
    const body = new THREE.Mesh(bodyGeometry, material); bird.add(body);
    const right = new THREE.Group(), left = new THREE.Group();
    const wingR = new THREE.Mesh(wingGeometry, material), wingL = new THREE.Mesh(wingGeometry, material); wingL.scale.x = -1;
    right.add(wingR); left.add(wingL); right.position.x = 0.1; left.position.x = -0.1; bird.add(right, left);
    const scale = 0.42 + random() * 0.3; bird.scale.setScalar(scale); group.add(bird);
    const coastal = i % 3 === 0;
    birds.push({ group: bird, right, left, phase: random() * TAU,
      radius: coastal ? 135 + random() * 85 : 61 + random() * 62,
      altitude: coastal ? 9 + random() * 13 : 27 + random() * 28,
      speed: .022 + random() * .02, flutter: random() * TAU,
      flapRate: .75 + random() * .65, coastal });
  }
  return birds;
}

/** Build the visible island. All animated assets are built once and reused. */
function* buildIsland(scene, {snowSurface}={}) {
  const group = new THREE.Group(); group.name = 'ISOLA · 自然海岛';
  const random = seededRandom(802194);
  const leafTextures = createLeafTextureState();
  const uniforms = {
    uTime: { value: 0 }, uWind: { value: 0.3 }, uSnow: { value: 0 }, uFoliageWinter:{value:0}, uLandWetness: { value: 0 }, uBeachDaylight: {value:1},
    uWindDirection: { value: new THREE.Vector2(.83, .55).normalize() },
    uPlantAmplitudes: { value: new THREE.Vector3() }, uLeafFlutter: { value: 0 },
    uTreeAmplitudes: { value: new THREE.Vector2() },
    uGroundTint: { value: new THREE.Vector3(1, 1, 1) },
    uRockMap: { value: null }, uRockMapEnabled: { value: 0 },
    ...createCoastalSurfaceUniforms(), ...snowSurface?.uniforms,
  };
  yield { stage: 'terrain' };
  const land = yield* terrainMesh(uniforms); group.add(land);
  yield { stage: 'cave-opening' };
  const caveTriangles = applyCaveOpening(land);
  yield { stage: 'cave' };
  const cave = createIslandCave(group, { heightAt, leafTexture:leafTextures.broadleaf, snowSurface });
  const caveFlowers = createCaveFlowerMeadow(group, { heightAt: PATH_LAYOUT.heightAtRendered, distanceAt: PATH_LAYOUT.distanceAt });
  yield { stage: 'paths' };
  const paths = yield* createIslandPathsGenerator(group, { heightAt, layout: PATH_LAYOUT, windUniforms: uniforms });
  yield { stage: 'forest' };
  const forest = yield* addForest(group, uniforms, random, leafTextures);
  yield { stage: 'palms' };
  const palmCount = addPalms(group, uniforms, random, leafTextures);
  yield { stage: 'understory' };
  const understory = yield* addUnderstory(group, uniforms, random, leafTextures);
  yield { stage: 'rocks' };
  const rockCount = addRocks(group, random, uniforms);
  yield { stage: 'dock' };
  const dockLighting = addDock(group,uniforms);
  yield { stage: 'birds' };
  const birds = addBirds(group, random);
  scene.add(group);
  const seasonalColor = new THREE.Color();
  const vegetationWind = createVegetationWindState();
  let lastSeason = -1;
  let lastQuality = 'high';
  let previousUpdateTime = 0;
  let disposed = false;
  const instanceMeshes = [];
  group.traverse((object) => {
    if (object.isInstancedMesh) { object.userData.fullCount = object.count; instanceMeshes.push(object); }
  });
  const setQuality = (quality = 'high') => {
    if (disposed) return;
    lastQuality = quality;
    const tier = quality === 'low' ? 0 : quality === 'medium' ? 1 : 2;
    for (const mesh of instanceMeshes) {
      let fraction = 1;
      if (mesh.name.startsWith('阔叶冠层') || mesh.name.startsWith('森林细枝') || mesh.name === '森林树干与分叉') fraction = [0.50, 0.8, 1][tier];
      if (mesh.name === '海岛草丛' || mesh.name === '林下蕨类') fraction = [0.35, 0.7, 1][tier];
      if (mesh.name === '沙滩细砾') fraction = [0.3, 0.65, 1][tier];
      if (mesh.name === '春季野花') fraction = [0.20, 0.6, 1][tier] * (lastSeason === 0 ? 1 : lastSeason === 1 ? 0.35 : 0);
      mesh.count = Math.floor(mesh.userData.fullCount * fraction);
    }
    forest.trunks.count = forest.canopies.reduce((count, canopy) => count + canopy.count, 0) * 3;
  };
  const seasonNames = ['spring', 'summer', 'autumn', 'winter'];
  const groundTints = [[1.04, 1.13, 0.93], [0.93, 1, 0.92], [1.19, 1.03, 0.77], [0.85, 0.94, 0.93]];
  group.userData.stats = { terrainVertices: 66049, trees: forest.trees.length, palms: palmCount, grassPatches: understory.grassCount, flowerPatches: understory.flowerCount, rocks: rockCount, birds: birds.length,
    caves: cave.count.entrances, caveTriangles, pathRoutes: paths.counts.routes,
    pathLength: PATH_LAYOUT.routes.reduce((total, route) => total + route.points.slice(1).reduce((length, point, index) =>
      length + Math.hypot(point.x - route.points[index].x, point.z - route.points[index].z), 0), 0),
    pathFlowers: paths.counts.flowers, pathPebbles: paths.counts.pebbles };
  const update = (time, env = {}) => {
    if (disposed) return;
    advanceVegetationWind(vegetationWind, time, env);
    time = vegetationWind.time;
    const requestedSeason = env.seasonIndex ?? seasonNames.indexOf(env.season || 'summer');
    const season = clamp(requestedSeason < 0 ? 1 : requestedSeason, 0, 3);
    const delta = getAnimationDelta(time - previousUpdateTime, .08, env);
    previousUpdateTime = time;
    uniforms.uTime.value = time;
    uniforms.uBeachDaylight.value=(env.daylight??1)*(1-(env.cloudiness??0))*(1-(env.storm??0)*.7);
    uniforms.uWind.value = env.wind ?? 0.3;
    uniforms.uWindDirection.value.fromArray(vegetationWind.direction);
    uniforms.uPlantAmplitudes.value.fromArray(vegetationWind.amplitudes);
    uniforms.uTreeAmplitudes.value.fromArray(vegetationWind.treeAmplitudes);
    uniforms.uLeafFlutter.value = vegetationWind.flutter;
    const winterTarget=Math.max(env.snow??0,Math.min(1,getSnowCover(env)*1.5),season===3?1:0);
    uniforms.uFoliageWinter.value+=(winterTarget-uniforms.uFoliageWinter.value)*(1-Math.exp(-delta*1.8));
    const snowTarget = getSnowCover(env);
    uniforms.uSnow.value += (snowTarget - uniforms.uSnow.value) * (1 - Math.exp(-delta * 1.9));
    uniforms.uLandWetness.value += (clamp(env.rain ?? 0, 0, 1) - uniforms.uLandWetness.value) * (1 - Math.exp(-delta * 1.25));
    dockLighting.snowCaps.visible=uniforms.uSnow.value>.005;
    const darkness = env.artificialLightsOff ? 0 : 1 - smooth(0.12, 0.48, env.daylight ?? 1);
    dockLighting.material.emissiveIntensity = darkness * 3.1;
    for (const light of dockLighting.lights) light.intensity = darkness * 48;
    cave.update(time, env);
    caveFlowers.update(time, env);
    if (season !== lastSeason) {
      lastSeason = season;
      const tint = groundTints[season]; uniforms.uGroundTint.value.set(tint[0], tint[1], tint[2]);
      for (const canopy of forest.canopies) {
        const trees = canopy.userData.trees;
        for (let i = 0; i < trees.length; i++) {
          seasonalColor.setHex(PALETTES[season][Math.min(4, Math.floor(trees[i].tone * 5))]); canopy.setColorAt(i, seasonalColor);
        }
        canopy.instanceColor.needsUpdate = true;
      }
      understory.flowers.visible = season === 0 || season === 1;
      setQuality(lastQuality);
    }
    understory.flowers.visible=(season===0||season===1)&&!isSnowLandscape(env);
    if (env.quality && env.quality !== lastQuality) setQuality(env.quality);
    paths.update(time, { ...env, seasonIndex: season, quality: lastQuality });
    const birdLimit = lastQuality === 'low' ? 14 : lastQuality === 'medium' ? 24 : birds.length;
    const birdsInDaylight = (env.daylight ?? 1) > .06;
    const birdsInFairWeather = (env.storm ?? 0) < .6;
    for (let i = 0; i < birds.length; i++) {
      const bird = birds[i];
      bird.group.visible = i < birdLimit && birdsInDaylight && (birdsInFairWeather || i % 4 === 0);
      // Flight is an analytic function of elapsed time. Hidden birds can skip
      // transforms and rejoin that same trajectory immediately when visible.
      if (!bird.group.visible) continue;
      const angle = time * bird.speed + bird.phase;
      const radius = bird.radius + Math.sin(time * 0.08 + bird.phase) * 7;
      const glide = smooth(-.15, .7, Math.sin(time * .19 + bird.phase));
      const dip = bird.coastal ? Math.pow(Math.max(0, Math.sin(time * .11 + bird.flutter)), 10) * 4 : 0;
      bird.group.position.set(Math.cos(angle) * radius, bird.altitude + Math.sin(time * .23 + bird.phase) * 2.2 - dip, Math.sin(angle) * radius);
      bird.group.rotation.set(Math.sin(time * .19 + bird.phase) * .06, -angle, Math.sin(angle + bird.phase) * .19);
      const flap = Math.sin(time * 4.4 * bird.flapRate + bird.flutter) * (.31 - glide * .27) + .1 - glide * .14;
      bird.right.rotation.z = flap; bird.left.rotation.z = -flap;
    }
  };
  update(0, { season: 'summer' });
  const releasedRockMaps = new WeakSet();
  function releaseRockMap(map) {
    if (!map || releasedRockMaps.has(map)) return;
    releasedRockMaps.add(map); map.dispose();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    // Helpers own their local resources. Remove them before collecting the
    // remaining island batches so their shared materials are not disposed twice.
    cave.dispose();
    caveFlowers.dispose();
    paths.dispose();
    dockLighting.dispose();
    const geometries = new Set(), materials = new Set(), textures = new Set();
    group.traverse(object => {
      if (object.isInstancedMesh) object.dispose();
      if (object.isLight) object.dispose?.();
      if (object.geometry) geometries.add(object.geometry);
      for (const material of [object.material, object.customDepthMaterial, object.customDistanceMaterial].flat()) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    scene.remove(group);
    group.clear();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    releaseRockMap(uniforms.uRockMap.value);
    leafTextures.dispose();
    for (const map of new Set([uniforms.uSandMap.value,uniforms.uLagoonMap.value,uniforms.uStepMap.value])) map?.dispose();
  }
  function setRockMap(map) {
    if (disposed) { releaseRockMap(map); return; }
    if (uniforms.uRockMap.value === map) return;
    releaseRockMap(uniforms.uRockMap.value);
    uniforms.uRockMap.value = map;
    uniforms.uRockMapEnabled.value = map ? 1 : 0;
    cave.setMountainMap(map);
  }
  function setCoastalMaps(maps) {
    const keys = {sand:'uSandMap',lagoon:'uLagoonMap',stone:'uStepMap'};
    if (disposed) { for (const map of new Set(Object.values(maps))) map?.dispose(); return; }
    const previous = new Set(Object.values(keys).map(key=>uniforms[key].value));
    for (const [name,key] of Object.entries(keys)) if (name in maps) {
      uniforms[key].value = maps[name]; uniforms[`${key}Enabled`].value = maps[name] ? 1 : 0;
    }
    const current = new Set(Object.values(keys).map(key=>uniforms[key].value));
    for (const map of previous) if (map && !current.has(map)) map.dispose();
  }
  return { group, update, heightAt, heightAtRendered: PATH_LAYOUT.heightAtRendered, setQuality, setRockMap, setCoastalMaps, setDockMaps:dockLighting.setSurfaceMaps, setCaveMaps:cave.setSurfaceMaps, setLeafMaps:leafTextures.setMaps, dispose };
}

/** Keep the synchronous API for tools and tests; both paths share every vertex. */
export function createIsland(scene, options) {
  const iterator = buildIsland(scene, options);
  let result;
  do { result = iterator.next(); } while (!result.done);
  return result.value;
}

/** Let the browser paint between measured batches instead of one long task. */
export function createIslandAsync(scene, options) {
  return runStartupGenerator(buildIsland(scene, options), options);
}

export { heightAt };
