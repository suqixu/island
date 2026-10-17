import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { heightAt } from '../src/terrain.js';
import { caveToLocal } from '../src/cave-layout.js';
import * as caveModule from '../src/island-cave.js';

test('裸地横向有泥土起伏而非平铺，边缘与末壁使用同一实际高度', () => {
  assert.equal(typeof caveModule.getCaveFloorHeight, 'function');
  const cave = caveModule.createIslandCave(new THREE.Group(), { heightAt });
  const floor = cave.group.getObjectByName('洞穴坡口与地面'), wall = cave.group.getObjectByName('天然岩洞内壁');
  const p = floor.geometry.attributes.position, w = wall.geometry.attributes.position;
  const rows = new Map();
  for (let index = 0; index < p.count; index++) {
    const local = caveToLocal({ x: p.getX(index), y: p.getY(index), z: p.getZ(index) });
    const key = Math.round(local.forward * 1000);
    if (!rows.has(key)) rows.set(key, []); rows.get(key).push(local);
  }
  let undulation = 0;
  for (const [forward, points] of rows) {
    assert.ok(points.length >= 7, '每段裸地需要横向细分');
    points.sort((a, b) => a.side - b.side);
    if (forward >= -800) continue;
    undulation = Math.max(undulation, Math.max(...points.map(point => point.height)) - Math.min(...points.map(point => point.height)));
    for (const edge of [points[0], points.at(-1)]) {
      let nearest = Infinity;
      for (let index = 0; index < w.count; index++) {
        const local = caveToLocal({ x: w.getX(index), y: w.getY(index), z: w.getZ(index) });
        nearest = Math.min(nearest, Math.hypot(local.side - edge.side, local.height - edge.height, local.forward - edge.forward));
      }
      assert.ok(nearest < .00002, '左右壁底不应出现地面裂缝');
    }
  }
  assert.ok(undulation > .12 && undulation < .26, '裸地高差应轻微而不变成大台阶');
  assert.notEqual(floor.material, wall.material, '泥土裸岩应与岩壁区分材质');
  const sample = caveModule.getCaveFloorHeight(.6, -4);
  assert.ok(Number.isFinite(sample) && Math.abs(sample - caveModule.getCaveFloorHeight(.6001, -4)) < .001);
  cave.dispose();
});

test('洞内岩层有更多不规则截面和真实崩石，不是规整直筒', () => {
  const cave = caveModule.createIslandCave(new THREE.Group(), { heightAt });
  const wall = cave.group.getObjectByName('天然岩洞内壁'), p = wall.geometry.attributes.position;
  const levels = new Set(), widths = [];
  for (let index = 0; index < p.count; index++) {
    const local = caveToLocal({ x: p.getX(index), y: p.getY(index), z: p.getZ(index) });
    levels.add(Math.round(local.forward * 1000));
    if (local.height > 2 && local.height < 4 && local.forward < -2) widths.push(local.side);
  }
  assert.ok(levels.size >= 8, '纵向岩层不能只剩四五个光滑环');
  assert.ok(p.count > 105);
  assert.ok(widths.some(side => side > 2.4) && widths.some(side => side < -2.4));
  assert.ok(cave.count.rocks > 32, '内壁下应有实际大小不一的崩石');
  cave.dispose();
});

