import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOceanSpray } from '../src/ocean-spray.js';

test('台风结束保留残余水滴和水冠，耗尽后停止更新，下一次台风重新唤醒', () => {
  const scene = new THREE.Group();
  const spray = createOceanSpray(scene, { heightAt: (x, z) => (60 - Math.hypot(x, z)) * .4 });
  let time = 0;
  const advance = typhoon => spray.update(.05, time += .05, { typhoon, daylight: 1 }, [1, 0]);
  const findLiveSurf = () => {
    for (let frame = 0; frame < 600; frame++) {
      advance(1);
      const crown = scene.getObjectByName('拍岸破浪水冠');
      if (spray.points.visible && crown?.visible) return crown;
    }
    assert.fail('台风应该产生水滴和破浪水冠');
  };
  const versions = objects => objects.flatMap(object => Object.values(object.geometry.attributes).map(attribute => attribute.version));
  try {
    const crown = findLiveSurf();
    advance(0);
    assert.ok(spray.points.visible, '风停后旧水滴应继续下落');
    assert.ok(crown.visible, '风停后旧水冠应继续崩落');
    for (let frame = 0; frame < 100; frame++) advance(0);
    assert.equal(spray.points.visible, false);
    assert.equal(crown.visible, false);
    const before = versions([spray.points, crown]);
    for (let frame = 0; frame < 100; frame++) advance(0);
    assert.deepEqual(versions([spray.points, crown]), before,
      '静海中已耗尽的水滴和水冠不能逐帧重写缓冲区');
    assert.equal(findLiveSurf(), crown, '再次台风应复用原有水冠和水滴资源');
  } finally { spray.dispose(); }
});
