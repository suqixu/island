import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as paths from '../src/models/island-paths.js';
import { getIslandPathLayout } from '../src/path-layout.js';
import { coastRadius, heightAt, shoreDistance } from '../src/terrain.js';

test('实际低岸沙地不再叠出封闭浅色路带，内陆山径与路线网络保留', () => {
  const layout = getIslandPathLayout();
  const instance = paths.createIslandPaths(new THREE.Group(), { heightAt, layout });
  try {
    const road = instance.group.getObjectByName('环岛沙土与登山小径');
    const { position, aMountain } = road.geometry.attributes;
    let beachOverlayVertices = 0, inlandVertices = 0;
    for (let i = 0; i < position.count; i++) {
      if (aMountain.getX(i) > .5) inlandVertices++;
      if (i % 3 === 0 && [i, i + 1, i + 2].every(at => aMountain.getX(at) < .5
        && shoreDistance(position.getX(at), position.getZ(at)) < 11.5 && position.getY(at) < 4.5)) beachOverlayVertices += 3;
    }
    assert.equal(beachOverlayVertices, 0, '开阔沙面直接显示原细沙，不能再覆一圈浅色半透明带');
    assert.ok(inlandVertices > 1000, '修复沙地不能移除实际山间步道');
    assert.ok(layout.routes.some(route => route.id === 'coastal-loop' && route.closed));
  } finally { instance.dispose(); }
});

test('低岸路面在3.8米处不会突然出现，内陆压实路径连续恢复可读性', () => {
  assert.equal(typeof paths.getCoastalTrailPresence, 'function');
  const atDistance = distance => [(coastRadius(0) - distance) / 1.025, 0];
  for (const height of [1.5, 3.79, 3.8, 3.81, 4.4]) {
    assert.equal(paths.getCoastalTrailPresence(...atDistance(9), height), 0);
  }
  let previous = 0;
  for (let distance = 9; distance <= 20; distance += .05) {
    const presence = paths.getCoastalTrailPresence(...atDistance(distance), 3.8);
    assert.ok(presence >= previous && presence - previous < .025, '路径按岸边沙地分布连续恢复，不能换成更宽色环');
    previous = presence;
  }
  assert.equal(paths.getCoastalTrailPresence(...atDistance(20), 3.8), 1);
  assert.equal(paths.getCoastalTrailPresence(...atDistance(9), 8), 1, '高处的独立步道仍需保留');
});
