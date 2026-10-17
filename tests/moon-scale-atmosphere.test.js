import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAtmosphere } from '../src/atmosphere.js';
import { getMoonBackdropDirection } from '../src/moon-framing.js';
import { MOON_PHASES } from '../src/moon.js';

const near = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);

test('真实大气月盘使用月相尺寸，保留原背景位置、资源、透明材质与夜雾接线', () => {
  const previous = { document: globalThis.document, width: globalThis.innerWidth, height: globalThis.innerHeight };
  const context = new Proxy({
    createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
  }, { get: (target, key) => target[key] ?? (() => {}), set: (target, key, value) => { target[key] = value; return true; } });
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  const scene = new THREE.Scene();
  const moonMap = new THREE.Texture();
  let atmosphere;
  try {
    atmosphere = createAtmosphere(scene, { moonMap });
    const moon = atmosphere.group.getObjectByName('phase-moon');
    const sky = atmosphere.group.children.find(object => object.material?.uniforms?.uSeaHorizonNight);
    const material = moon.material, geometry = moon.geometry, shader = material.fragmentShader;
    const seaHorizon = { night: 1, color: [.04, .075, .12], weather: .2, cloudCover: .25 };
    const environment = {
      hour: 22, weather: 'sunny', daylight: 0, cloudiness: .16, rain: 0, snow: 0, fog: 0, storm: 0,
      moonLight: .85, moonVisibility: 1, moonAltitude: .4,
      sunDirection: new THREE.Vector3(-.8, -.6, -.3).normalize(), skyCloudCover: .25, seaHorizon,
    };
    for (const [width, height, natural, full] of [[1440, 900, 36, 135], [390, 844, 23.4, 78]]) {
      globalThis.innerWidth = width; globalThis.innerHeight = height;
      const camera = new THREE.PerspectiveCamera(66, width / height, .5, 7000);
      camera.position.set(150, 24, 200); camera.lookAt(0, 65, 0);
      for (const zoom of [.75, 1.8]) {
        camera.zoom = zoom; camera.updateProjectionMatrix();
        const direction = getMoonBackdropDirection(camera, width);
        const position = camera.getWorldPosition(new THREE.Vector3()).addScaledVector(direction, 1900);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
        const forward = camera.getWorldDirection(new THREE.Vector3());
        const slope = Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV() / 2));
        for (const preset of MOON_PHASES) {
          const illumination = (1 - Math.cos(preset.phase * Math.PI * 2)) * .5;
          atmosphere.update(0, { ...environment, moonDirection: direction, moonPhase: preset.phase,
            moonIllumination: illumination }, camera);
          const diameter = preset.phase === .5 ? full : natural;
          const expectedScale = diameter * 3800 * slope / height * (preset.phase === .5 ? 1 : direction.dot(forward));
          near(moon.scale.x, expectedScale); near(moon.scale.y, expectedScale);
          near(moon.position.distanceTo(position), 0);
          assert.deepEqual(moon.quaternion.toArray(), camera.quaternion.toArray());
          const top = position.clone().addScaledVector(up, moon.scale.y * .5).project(camera);
          const bottom = position.clone().addScaledVector(up, -moon.scale.y * .5).project(camera);
          near((top.y - bottom.y) * height * .5, preset.phase === .5 ? full / direction.dot(forward) : natural);
          assert.equal(moon.material, material); assert.equal(moon.geometry, geometry);
          assert.equal(material.uniforms.uTexture.value, moonMap); assert.equal(material.fragmentShader, shader);
          assert.equal(material.transparent, true); assert.equal(material.depthWrite, false); assert.equal(material.fog, false);
          near(material.uniforms.uOpacity.value, .8624);
          assert.equal(moon.visible, preset.phase !== 0);
          near(atmosphere.moonDiscOpacity, moon.visible ? material.uniforms.uOpacity.value : 0);
          assert.equal(sky.material.uniforms.uSeaHorizonNight.value, 1);
          assert.deepEqual(sky.material.uniforms.uSeaHorizonColor.value.toArray(), seaHorizon.color);
        }
      }
    }
  } finally {
    atmosphere?.dispose();
    globalThis.document = previous.document; globalThis.innerWidth = previous.width; globalThis.innerHeight = previous.height;
  }
  assert.equal(scene.children.length, 0);
});
