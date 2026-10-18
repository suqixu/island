import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIsland } from '../src/models/island.js';
import { createLighthouse } from '../src/models/lighthouse.js';
import { createRestPavilion } from '../src/models/rest-pavilion.js';
import { createPathLamps } from '../src/models/path-lamps.js';

test('灯塔光束、路灯、亭灯和码头在一帧内全部熄灭，之后按当前昼夜恢复', () => {
  const scene = new THREE.Scene(), heightAt = () => 12;
  const island = createIsland(scene);
  const tower = createLighthouse(scene, { heightAt, position: { x: 10, z: -4 } });
  const pavilion = createRestPavilion(scene, { heightAt, position: { x: 4, z: -9 } });
  const lamps = createPathLamps(scene, { heightAt, layout: { routes: [{ id: 'fixture', kind: 'mountain', width: 1.1,
    points: [{ x: 58, z: -60 }, { x: 130, z: -60 }] }] } });
  const fixtures = [island, tower, pavilion, lamps];
  const lights = [], materials = new Set(), beams = [], flames = [];
  scene.traverse(object => {
    if (object.isPointLight) lights.push(object);
    for (const material of [object.material].flat().filter(Boolean)) {
      if (material.emissive && material.emissive.getHex() !== 0) materials.add(material);
      if (material.uniforms?.strength) beams.push(object);
    }
    if (object.name.startsWith('山洞火把暖焰')) flames.push(object);
  });
  assert.ok(lights.length >= 8, '覆盖所有人工光源，而非只检查洞口');
  assert.ok(beams.length > 0, '必须检查灯塔可见光束');
  assert.equal(flames.length, 0, '洞内已移除火把');
  const update = (time, env) => fixtures.forEach(fixture => fixture.update(time, env));
  const glow = () => [...lights.filter(light => light.name !== '山洞深处转角微光').map(light => light.intensity), ...[...materials].map(material => material.emissiveIntensity), ...beams.map(beam => beam.material.uniforms.strength.value)];
  try {
    for (const quality of ['low', 'medium', 'high']) {
      update(1, { daylight: 0, quality });
      const night = glow();
      assert.ok(lights.some(light => light.intensity > 0));
      assert.ok([...materials].every(material => material.emissiveIntensity > 0));
      update(2, { daylight: 0, artificialLightsOff: true, quality });
      assert.ok(glow().every(value => value === 0), '立即熄灯，不做淡出');
      assert.ok(lights.every(light => light.intensity === 0),'转角微光也立即熄灭');
      assert.ok([...beams, ...flames].every(object => object.visible === false), '不能残留光束或火焰');
      update(3, { daylight: 0, artificialLightsOff: false, quality });
      assert.deepEqual(glow(), night, '恢复原夜间亮度，不反复乘小灯光强度');
    }
    update(4, { daylight: 1, artificialLightsOff: false });
    assert.ok(lights.filter(light => light.name !== '山洞深处转角微光').every(light => light.intensity === 0), '白天室外灯保持熄灭');
    assert.ok([...materials].every(material => material.emissiveIntensity === 0));
    assert.ok(beams.every(beam => beam.material.uniforms.strength.value === 0));
    assert.ok(lights.find(light => light.name === '山洞深处转角微光').intensity > 0, '洞内转角保留局部微光');
  } finally { fixtures.forEach(fixture => fixture.dispose()); }
});
