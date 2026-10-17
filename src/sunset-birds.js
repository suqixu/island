import * as THREE from 'three';
import { getAnimationRate } from './animation-time.js';
import { getSunsetState } from './sunset.js';

const clamp = THREE.MathUtils.clamp, smooth = THREE.MathUtils.smoothstep;
const TAU = Math.PI * 2, RADIUS = 1800;
const worldUp = new THREE.Vector3(0, 1, 0);

// A slender body and two bent, tapered wings. Each bird owns one small dynamic
// buffer; indices, materials and objects survive every sunset and quality change.
function birdGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex([
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7, 4, 7, 8, 4, 8, 9,
    10, 11, 12, 10, 12, 13, 10, 13, 14, 10, 14, 15,
  ]);
  return geometry;
}

function wings(geometry, flap) {
  const points = geometry.attributes.position;
  points.setXYZ(0, 0, .18, 0);
  points.setXYZ(1, .055, -.02, 0);
  points.setXYZ(2, 0, -.35, 0);
  points.setXYZ(3, -.055, -.02, 0);
  for (let wing = 0; wing < 2; wing++) {
    const at = 4 + wing * 6, side = wing === 0 ? -1 : 1;
    points.setXYZ(at, side * .025, 0, 0);
    points.setXYZ(at + 1, side * .30, .12 + flap * .08, 0);
    points.setXYZ(at + 2, side * .63, .24 + flap * .28, 0);
    points.setXYZ(at + 3, side, .06 + flap * .50, 0);
    points.setXYZ(at + 4, side * .59, .015 + flap * .25, 0);
    points.setXYZ(at + 5, side * .21, -.09 + flap * .055, 0);
  }
  points.needsUpdate = true;
}

/**
 * Two quiet, distant silhouettes for the actual evening afterglow. `time` is
 * accumulated animation time (state.elapsed); waits and flights use real seconds.
 * A pass captures the composed sun direction and camera world position once,
 * so looking around never steers birds that have already taken flight.
 */
export function createSunsetBirds({ random = Math.random } = {}) {
  const group = new THREE.Group();
  group.name = 'sunset-birds'; group.visible = false;
  const material = new THREE.MeshBasicMaterial({
    color: '#0b090d', transparent: true, opacity: 0, depthWrite: false,
    side: THREE.DoubleSide, fog: false, toneMapped: false,
  });
  const pair = Array.from({ length: 2 }, (_, index) => {
    const mesh = new THREE.Mesh(birdGeometry(), material);
    mesh.name = `sunset-bird-${index + 1}`;
    mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = -820;
    group.add(mesh);
    wings(mesh.geometry, 0);
    return { mesh, start: new THREE.Vector3(), end: new THREE.Vector3(), phase: 0, frequency: 2, size: 15 };
  });
  const target = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const direction = new THREE.Vector3(), normal = new THREE.Vector3(), basis = new THREE.Matrix4();
  let lastTime, observed = 0, nextAt = 3 + random() * 7;
  let active = false, age = 0, duration = 16, wasEligible = false, disposed = false;

  function clear() {
    active = false; age = 0; group.visible = false; material.opacity = 0;
    for (const bird of pair) bird.mesh.visible = false;
  }

  function begin(env, camera) {
    const source = env.sunBackdropDirection ?? env.sunDirection;
    if (source?.isVector3) target.copy(source);
    else if (Array.isArray(source)) target.fromArray(source);
    else target.fromArray(env.sun ?? [0, .1, -1]);
    if (target.lengthSq() < .001) target.set(0, .1, -1);
    target.normalize();
    // Follow the last glow toward the horizon without flying into the ocean.
    // Angular elevation, rather than a camera-space y, keeps this safe on rolls.
    if (target.y < .045) {
      target.y = 0; target.normalize().multiplyScalar(Math.sqrt(1 - .045 ** 2)); target.y = .045;
    }
    right.crossVectors(target, worldUp).normalize();
    if (right.lengthSq() < .001) right.set(1, 0, 0);
    up.crossVectors(right, target).normalize();
    normal.copy(target).negate();
    basis.makeBasis(right, up, normal);
    camera.getWorldPosition(group.position);
    duration = 12 + random() * 8;
    // Keep both starting silhouettes inside a portrait camera's narrower sky.
    // This changes only the initial path, never an already flying pair.
    const horizontalView = Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) * .5) * camera.aspect;
    const span = Math.min(.26 + random() * .13, horizontalView * .75);
    const spacing = Math.min(.058, span * .18);
    const rise = target.y < .13 ? .10 : -.055;
    for (let index = 0; index < pair.length; index++) {
      const bird = pair[index];
      bird.start.copy(target).addScaledVector(right, -span - index * spacing)
        .addScaledVector(up, rise + index * .022).normalize();
      bird.end.copy(target).addScaledVector(right, -index * .018)
        .addScaledVector(up, .008 + index * .012).normalize();
      bird.phase = random() * TAU + index * 1.7;
      bird.frequency = 1.8 + random() * .4 + index * .1;
      bird.size = 14 + random() * 2 - index * .6;
      bird.mesh.quaternion.setFromRotationMatrix(basis);
      bird.mesh.visible = true;
    }
    active = true; age = 0; group.visible = true;
  }

  function update(time, env = {}, camera) {
    if (disposed || !camera) return;
    const now = Number.isFinite(time) ? time : (lastTime ?? 0);
    const dt = lastTime === undefined ? 0 : clamp((now - lastTime) / getAnimationRate(env), 0, .25);
    lastTime = now;
    const sunHeight = env.sunDirection?.y ?? env.sun?.[1];
    const sunset = getSunsetState({
      ...env, sunHeight, cloudiness: Math.max(env.cloudiness ?? 0, (env.skyCloudCover ?? 0)),
    });
    const eligible = Number.isFinite(env.hour) && env.hour >= 17 && env.hour <= 18.35
      && Number.isFinite(sunHeight) && sunHeight > -.09 && sunHeight < .55
      && sunset.strength > .12 && !env.eclipse?.active;
    if (!eligible) {
      clear();
      if (wasEligible) { observed = 0; nextAt = 3 + random() * 7; }
      wasEligible = false;
      return;
    }
    wasEligible = true; observed += dt;
    if (!active && observed >= nextAt) begin(env, camera);
    else if (active) age += dt;
    if (!active) return;
    if (age >= duration) {
      clear(); nextAt = observed + 22 + random() * 70;
      return;
    }
    const progress = clamp(age / duration, 0, 1);
    material.opacity = .94 * smooth(age, 0, .65) * (1 - smooth(progress, .76, 1))
      * smooth(sunset.transmission, .08, .55);
    for (const bird of pair) {
      direction.lerpVectors(bird.start, bird.end, progress).normalize();
      bird.mesh.position.copy(direction).multiplyScalar(RADIUS + progress * 650);
      bird.mesh.scale.setScalar(bird.size * (1 - progress * .42));
      const cycle = (age + bird.phase) % 6.2;
      const glide = smooth(cycle, 4.4, 4.9) * (1 - smooth(cycle, 5.6, 6.1));
      const flap = THREE.MathUtils.lerp(Math.sin(age * bird.frequency * TAU + bird.phase), .08, glide);
      wings(bird.mesh.geometry, flap);
    }
  }

  // Both silhouettes are inexpensive and form one composition at every quality.
  function setQuality() {}
  function dispose() {
    if (disposed) return;
    disposed = true; clear();
    for (const bird of pair) bird.mesh.geometry.dispose();
    material.dispose(); group.removeFromParent(); group.clear();
  }
  return { group, update, setQuality, dispose };
}
