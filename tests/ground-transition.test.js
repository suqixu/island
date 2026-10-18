import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIsland } from '../src/models/island.js';
import { smooth } from '../src/terrain.js';
import { getSoilTransitionFactor } from '../src/ground-transition.js';

test('草沙衔接保留原底色，最深变化也不能超过14%', () => {
  assert.equal(getSoilTransitionFactor(0), 1);
  for (let coverage = 0; coverage <= 1; coverage += .01) {
    for (const grain of [0, .25, .5, .75, 1]) {
      const factor = getSoilTransitionFactor(coverage, grain);
      assert.ok(factor >= .86 && factor <= 1, '不能把草沙底色大半替换成近黑土色');
    }
  }
  let previous = 1;
  for (let coverage = .001; coverage <= 1; coverage += .001) {
    const factor = getSoilTransitionFactor(coverage);
    assert.ok(Math.abs(factor - previous) < .001, '过渡不能出现新的明暗边线');
    previous = factor;
  }
});

test('真实码头台阶附近aBiome过渡不再混入超过一半深土色', () => {
  const island = createIsland(new THREE.Scene());
  try {
    const { position, aBiome, aSlope } = island.group.getObjectByName('连续海床与火山岛').geometry.attributes;
    let samples = 0, darkest = 1;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i), biome = aBiome.getX(i);
      if (Math.abs(x) > 9 || z < 59 || z > 66 || biome < .12 || biome > .65) continue;
      const rock = smooth(.4, .79, aSlope.getX(i)) * smooth(4, 13, y) * (1 - biome * .7);
      const edgeSoil = smooth(.12, .38, biome) * (1 - biome) * (1 - rock) * (1 - smooth(7, 10, y));
      darkest = Math.min(darkest, getSoilTransitionFactor(edgeSoil, .5));
      samples++;
    }
    assert.ok(samples > 10, '要覆盖实际台阶两侧过渡地面');
    assert.ok(darkest > .9, '真实坡脚过渡仅做有限深浅变化，不再把草地改成软黑斑');
  } finally { island.dispose(); }
});
