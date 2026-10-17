import test from 'node:test';
import assert from 'node:assert/strict';
import { heightAt, slopeAt, coastRadius, shoreDistance } from '../src/terrain.js';
import { getLagoonMask } from '../src/lagoon.js';

test('海床、海滩和山体形成有效连续高度场', () => {
  let maximum = -Infinity;
  for (let x = -160; x <= 160; x += 4) {
    for (let z = -160; z <= 160; z += 4) {
      const height = heightAt(x,z);
      assert.ok(Number.isFinite(height) && height > -100 && height < 75);
      assert.ok(Number.isFinite(slopeAt(x,z)));
      maximum = Math.max(maximum,height);
    }
  }
  assert.ok(maximum > 35, '山峰应高于海平面35米');
  assert.ok(heightAt(150,150) < -5, '远岸必须是海床');
});

test('原岸线非泻湖区保留陆地海床，岸内环岛通路各方位保持干燥', () => {
  for (let i=0;i<32;i++) {
    const angle = i/32*Math.PI*2, radius = coastRadius(angle);
    const point = r => [Math.cos(angle)*r/1.025, Math.sin(angle)*r/.975];
    for (const [r, land] of [[radius - 3, true], [radius + 3, false]]) {
      const [x, z] = point(r);
      // The connected lagoon changes this local shoreline; its basin, sand
      // arms and sea opening are checked directly in lagoon.test.js.
      if (getLagoonMask(x, z, shoreDistance(x, z)) === 0) assert.ok(land ? heightAt(x, z) > 0 : heightAt(x, z) < 0);
    }
    const [x, z] = point(radius - 8);
    assert.equal(getLagoonMask(x, z, shoreDistance(x, z)), 0);
    assert.ok(heightAt(x, z) > 0);
  }
});
