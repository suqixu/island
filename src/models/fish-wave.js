import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import config from '../config/fish-wave.json' with { type: 'json' };
import { createFishWaveState, fishWaveRandom as rand, getFishWavePose } from '../fish-wave-motion.js';

const TAU = Math.PI * 2;
function fishGeometry() {
  // A tapered silver body and forked tail, only 64 triangles per instance.
  const body = new THREE.SphereGeometry(1, 8, 4); body.scale(.10, .18, .48);
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, -.4, 0, .22, -.77, 0, .03, -.66,
    0, 0, -.4, 0, .03, -.66, 0, -.03, -.66,
    0, 0, -.4, 0, -.03, -.66, 0, -.22, -.77,
    0, .13, .1, 0, .32, -.15, 0, .12, -.24,
  ], 3)); tail.computeVertexNormals();
  body.deleteAttribute('uv');
  const shell = body.toNonIndexed(), geometry = mergeGeometries([shell, tail]);
  body.dispose(); shell.dispose(); tail.dispose();
  const colors = new Float32Array(geometry.attributes.position.count * 3), color = new THREE.Color();
  for (let i = 0; i < geometry.attributes.position.count; i++) {
    color.set(geometry.attributes.position.getY(i) > .065 ? '#86acb4' : '#e4eeeb'); color.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** One fixed ocean corridor per event, with three bounded draw calls. */
export function createFishWave(scene, { heightAt, random = Math.random, waterHeightAt, occluders = [] } = {}) {
  const group = new THREE.Group(); group.name = '鱼群跃浪'; group.visible = false; scene.add(group);
  const state = createFishWaveState({ random }), seed = random() * 1e6;
  const max = config.quality.high;
  const geometry = fishGeometry();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .25, metalness: .16, emissive: '#bdd9df', emissiveIntensity: .6, side: THREE.DoubleSide });
  const fish = new THREE.InstancedMesh(geometry, material, max.fish);
  fish.name = '跃浪银鱼'; fish.frustumCulled = false; fish.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(fish);
  const sprayGeometry = new THREE.BufferGeometry(), positions = new Float32Array(max.spray * 3), alphas = new Float32Array(max.spray);
  sprayGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  sprayGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage));
  const sprayMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uScale: { value: 650 }, uLight: { value: 1 } },
    vertexShader: `attribute float aAlpha; varying float vAlpha; uniform float uScale;
      void main(){vec4 p=modelViewMatrix*vec4(position,1.0);vAlpha=aAlpha;
        gl_PointSize=clamp(uScale*.12/max(1.0,-p.z),1.0,4.0);gl_Position=projectionMatrix*p;}`,
    fragmentShader: `varying float vAlpha;uniform float uLight;
      void main(){float r=length(gl_PointCoord-.5)*2.0;float a=(1.0-smoothstep(.2,1.0,r))*vAlpha;
        if(a<.005)discard;gl_FragColor=vec4(vec3(.82,.92,.95)*uLight,a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const spray = new THREE.Points(sprayGeometry, sprayMaterial); spray.name = '鱼群区域水花';
  spray.renderOrder = 12; spray.frustumCulled = false; group.add(spray);
  const ringGeometry = new THREE.PlaneGeometry(2, 2); ringGeometry.rotateX(-Math.PI / 2);
  ringGeometry.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(new Float32Array(max.ripples), 1).setUsage(THREE.DynamicDrawUsage));
  const ringMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uLight: { value: 1 } },
    vertexShader: `attribute float aAlpha;varying vec2 vUv;varying float vAlpha;
      void main(){vUv=uv;vAlpha=aAlpha;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}`,
    fragmentShader: `varying vec2 vUv;varying float vAlpha;uniform float uLight;
      void main(){float r=length(vUv-.5)*2.0;float ring=smoothstep(.66,.8,r)*(1.0-smoothstep(.84,1.0,r));
        float a=ring*vAlpha;if(a<.003)discard;gl_FragColor=vec4(vec3(.68,.84,.88)*uLight,a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const rings = new THREE.InstancedMesh(ringGeometry, ringMaterial, max.ripples);
  rings.name = '鱼群扩散涟漪'; rings.frustumCulled = false; rings.renderOrder = 11;
  rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(rings);
  const members = Array.from({ length: max.fish }, (_, i) => {
    const r = salt => rand(seed + i * 17 + salt);
    return { x: r(1) - .5, z: r(2) - .5, phase: r(3), speed: 2.5 + r(4) * 3,
      height: .9 + r(5) * 2.5, delay: r(6) * 1.5, leader: i % 29 === 0,
      length: .65 + r(7) * .55, span: 70 };
  });
  const dummy = new THREE.Object3D(), cameraPosition = new THREE.Vector3(), ray = new THREE.Vector3();
  const point = new THREE.Vector3(), projected = new THREE.Vector3(), sight = new THREE.Vector3();
  const center = new THREE.Vector3(), across = new THREE.Vector3(), offshore = new THREE.Vector3();
  const pose = {}, world = new THREE.Vector3(), raycaster = new THREE.Raycaster(), hits = [];
  let settings = max, cycle = -1, anchored = false, disposed = false;
  const water = new Float32Array(15), previousCenter = new THREE.Vector3();
  let hasPreviousCenter = false;

  function clearSight(target) {
    for (let step = 1; step < 32; step++) {
      sight.lerpVectors(cameraPosition, target, step / 32);
      const bed = heightAt?.(sight.x, sight.z);
      if (Number.isFinite(bed) && bed > sight.y + .15) return false;
    }
    if (occluders.length) {
      raycaster.ray.origin.copy(cameraPosition);
      raycaster.ray.direction.subVectors(target, cameraPosition);
      raycaster.near = .25; raycaster.far = raycaster.ray.direction.length() - .25;
      raycaster.ray.direction.normalize(); hits.length = 0;
      raycaster.intersectObjects(occluders, true, hits);
      if (hits.some(hit => hit.object.visible)) return false;
    }
    return true;
  }
  function place(camera) {
    if (!camera?.isPerspectiveCamera) return false;
    camera.updateMatrixWorld(); camera.getWorldPosition(cameraPosition);
    if (cameraPosition.y <= 1) return false;
    for (const root of occluders) root.updateWorldMatrix(true, true);
    // Shuffle both jittered candidates and exact fallbacks. The latter keep
    // narrow ocean windows usable without favouring the same screen column.
    let sample = 0;
    const next = () => rand(seed + state.cycle * 997 + sample++ * 13.7);
    const candidates = [];
    for (const y of [-.65, -.48, -.28, -.08, .12, .28, .42, .56]) for (const x of [-.8, -.65, -.5, -.38, -.2, 0, .2, .38, .5, .65, .8]) {
      candidates.push([x + (next() - .5) * .24, y + (next() - .5) * .16], [x, y]);
    }
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    let fallback = null;
    function accept(span) {
      for (const member of members) member.span = span;
      previousCenter.copy(center); hasPreviousCenter = true;
      return true;
    }
    for (const [x, y] of candidates) {
      ray.set(x, y, .5).unproject(camera).sub(cameraPosition).normalize();
      if (ray.y >= -.02) continue;
      const distance = -cameraPosition.y / ray.y;
      if (distance < 65 || distance > 450) continue;
      center.copy(cameraPosition).addScaledVector(ray, distance); center.y = 0;
      if (Math.hypot(center.x, center.z) < 112) continue;
      offshore.copy(center).setY(0).normalize(); across.set(offshore.z, 0, -offshore.x);
      const span = Math.min(80, Math.max(26, distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect * .45));
      let safe = true;
      for (let a = -2; a <= 2 && safe; a++) for (let b = -1; b <= 1 && safe; b++) {
        point.copy(center).addScaledVector(across, a * (span / 4 + 5)).addScaledVector(offshore, b * 18 + 6); point.y = .2;
        const bed = heightAt?.(point.x, point.z);
        projected.copy(point).project(camera);
        if (!Number.isFinite(bed) || bed > -5 || Math.abs(projected.x) > 1.15 || Math.abs(projected.y) > 1.15
          || projected.z < -1 || projected.z > 1 || !clearSight(point)) safe = false;
      }
      if (!safe) continue;
      if (hasPreviousCenter && center.distanceTo(previousCenter) < config.placement.minimumRepeatDistance) {
        // If the view has only one safe patch, keep it usable as a fallback.
        fallback ??= { center: center.clone(), across: across.clone(), offshore: offshore.clone(), span };
        continue;
      }
      return accept(span);
    }
    if (fallback) {
      center.copy(fallback.center); across.copy(fallback.across); offshore.copy(fallback.offshore);
      return accept(fallback.span);
    }
    return false;
  }
  function toWorld(x, y, z) { return world.copy(center).addScaledVector(across, x).addScaledVector(offshore, z).setY(y); }
  function surface(x, z) {
    // Coarse regional water samples avoid sampling the displaced sea per fish.
    const col = THREE.MathUtils.clamp(Math.round(x / members[0].span * 4 + 2), 0, 4);
    const row = THREE.MathUtils.clamp(Math.round(z / 15 + 1), 0, 2);
    return water[row * 5 + col];
  }
  function update(time, env = {}, camera) {
    if (disposed) return;
    state.update(time, env);
    if (state.phase === 'idle') { group.visible = false; fish.count = 0; rings.count = 0; return; }
    if (cycle !== state.cycle) { cycle = state.cycle; anchored = place(camera); }
    if (!anchored) { state.cancel(); group.visible = false; return; }
    group.visible = true;
    const age = state.age, fade = 1 - THREE.MathUtils.smoothstep(age, config.durationSeconds - config.fadeSeconds, config.durationSeconds);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) {
      toWorld((col - 2) * members[0].span / 4, 0, (row - 1) * 15);
      water[row * 5 + col] = waterHeightAt?.(world.x, world.z) ?? .12;
    }
    let sprayCount = 0, ringCount = 0;
    const heading = Math.atan2(offshore.x, offshore.z);
    for (let i = 0; i < settings.fish; i++) {
      const member = members[i]; getFishWavePose(age, member, pose);
      const level = surface(pose.x, pose.z);
      dummy.position.copy(toWorld(pose.x, pose.y + level, pose.z));
      dummy.rotation.set(0, heading + Math.sin(age * 2 + member.phase * TAU) * .1, 0);
      dummy.rotateX(-pose.pitch); dummy.rotateZ(pose.roll); dummy.scale.setScalar(member.length); dummy.updateMatrix();
      fish.setMatrixAt(i, dummy.matrix);
      if (pose.landing && i % 3 === 0 && sprayCount < settings.spray) {
        const t = pose.waterAge;
        // Several fish share one splash region; no per-fish emitters or event objects.
        for (let drop = 0; drop < 6 && sprayCount < settings.spray; drop++) {
          const angle = member.phase * TAU + drop * 2.4, spread = .5 + drop * .18;
          toWorld(pose.x + Math.cos(angle) * t * spread, level + Math.max(0, (2.4 + drop * .2) * t - 3.8 * t * t),
            pose.landingZ + Math.sin(angle) * t * spread);
          world.toArray(positions, sprayCount * 3); alphas[sprayCount++] = Math.max(0, 1 - t / .9) * .55 * fade;
        }
      }
      const gathering = age < config.gatherSeconds && i % 23 === 0;
      if ((pose.landing || gathering) && ringCount < settings.ripples && i % 7 === 0) {
        const t = gathering ? (age + member.phase) % 1.6 : pose.waterAge;
        dummy.position.copy(toWorld(pose.x, level + .05, pose.landing ? pose.landingZ : pose.z));
        dummy.rotation.set(0, member.phase * TAU, 0); dummy.scale.set(1 + t * 1.8, 1, .6 + t * 1.2); dummy.updateMatrix();
        rings.setMatrixAt(ringCount, dummy.matrix);
        ringGeometry.attributes.aAlpha.setX(ringCount++, (1 - t / 1.6) * (gathering ? .12 : .32) * fade);
      }
    }
    fish.count = settings.fish; fish.instanceMatrix.needsUpdate = true;
    sprayGeometry.setDrawRange(0, sprayCount); spray.visible = sprayCount > 0;
    sprayGeometry.attributes.position.needsUpdate = true; sprayGeometry.attributes.aAlpha.needsUpdate = true;
    rings.count = ringCount; rings.visible = ringCount > 0; rings.instanceMatrix.needsUpdate = true; ringGeometry.attributes.aAlpha.needsUpdate = true;
    const light = .3 + (env.daylight ?? 1) * .7;
    sprayMaterial.uniforms.uLight.value = light; ringMaterial.uniforms.uLight.value = light;
    if (camera) sprayMaterial.uniforms.uScale.value = (globalThis.innerHeight ?? 900) * Math.min(globalThis.devicePixelRatio ?? 1, 1.7)
      / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }
  function setQuality(value) { settings = config.quality[value] ?? max; }
  function dispose() {
    if (disposed) return; disposed = true;
    state.cancel(); group.removeFromParent(); group.clear(); fish.dispose(); rings.dispose();
    for (const item of [geometry, material, sprayGeometry, sprayMaterial, ringGeometry, ringMaterial]) item.dispose();
  }
  return { group, update, setQuality, dispose, get phase() { return state.phase; } };
}
