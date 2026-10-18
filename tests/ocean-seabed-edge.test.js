import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOcean } from '../src/ocean.js';
import { heightAt } from '../src/terrain.js';
import { getIslandPathLayout } from '../src/path-layout.js';

const optics = await import('../src/ocean-optics.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return null;
});
const renderedHeight = getIslandPathLayout().heightAtRendered;

test('俯视时水色使用的海床高度在方形贴图各边之前已连续过渡到外海深度', () => {
  assert.equal(typeof optics?.getOffshoreFloorHeight, 'function');
  for (const [x,z] of [[240,0],[-240,0],[0,240],[0,-240],[240,240],[-240,-240]]) {
    const near = optics.getOffshoreFloorHeight(renderedHeight(x*.999,z*.999),x*.999,z*.999);
    const outside = optics.getOffshoreFloorHeight(-80,x*1.001,z*1.001);
    assert.equal(near, -80, '到达方形查表边界前必须已是相同的外海深度');
    assert.equal(near, outside, '不能在贴图边界从浅水骤变深水');
  }
  for (const [x,z] of [[0,0],[80,0],[0,140],[95,95]]) {
    const height = renderedHeight(x,z);
    assert.equal(optics.getOffshoreFloorHeight(height,x,z),height,'岛岸和泻湖保持真实水底深度');
  }
  const axis=optics.getOffshoreBlend(190,0),diagonal=optics.getOffshoreBlend(190/Math.SQRT2,190/Math.SQRT2);
  assert.ok(Math.abs(axis-diagonal)<1e-12,'过渡按圆形距离衰减，不能继续画出方形色带');
  let previous=optics.getOffshoreFloorHeight(-20,148,0);
  for(let radius=148.1;radius<241;radius+=.1){
    const current=optics.getOffshoreFloorHeight(-20,radius,0);
    assert.ok(current<=previous&&previous-current<.12,'深度变化必须连续且没有硬边');previous=current;
  }
});

test('真实海水高度纹理在±155海床边界两侧均已不透出底层几何', () => {
  assert.equal(typeof optics?.getSeabedTransmission, 'function');
  const ocean = createOcean(new THREE.Scene(), { heightAt: renderedHeight });
  try {
    const { data, width } = ocean.mesh.material.uniforms.uTerrainHeight.value.image;
    for (const [ix, iz] of [[209, 127], [210, 127], [45, 127], [46, 127], [127, 209], [127, 210], [127, 45], [127, 46]]) {
      const x = (ix / (width - 1) - .5) * 480, z = (iz / (width - 1) - .5) * 480;
      const actual = THREE.DataUtils.fromHalfFloat(data[iz * width + ix]);
      assert.equal(optics.getSeabedTransmission(Math.max(0, -actual)), 0,
        `海床边界(${x.toFixed(2)},${z.toFixed(2)})的${(-actual).toFixed(3)}米深水必须完全遮住方形几何`);
    }
  } finally { ocean.dispose(); }
});

test('海床深度纹理仍完整沿用自定义heightAt', () => {
  const floor = (x, z) => -.1 * x - .025 * z - 35;
  const ocean = createOcean(new THREE.Scene(), { heightAt: floor });
  try {
    const { data, width } = ocean.mesh.material.uniforms.uTerrainHeight.value.image;
    for (const [ix, iz] of [[10, 120], [245, 120]]) {
      const x = (ix / (width - 1) - .5) * 480, z = (iz / (width - 1) - .5) * 480;
      assert.ok(Math.abs(THREE.DataUtils.fromHalfFloat(data[iz * width + ix]) - floor(x, z)) < .04);
    }
  } finally { ocean.dispose(); }
});

test('6米以内保持清水和泻湖透光，有限海床边缘在深水中自然消失', () => {
  assert.equal(typeof optics?.getSeabedTransmission, 'function');
  for (const depth of [0, .15, .8, 2, 4, 6]) {
    assert.equal(optics.getSeabedTransmission(depth), Math.exp(-depth * .24));
  }
  let previous = optics.getSeabedTransmission(6);
  for (let depth = 6.05; depth <= 12.1; depth += .05) {
    const value = optics.getSeabedTransmission(depth);
    assert.ok(value <= previous && value >= 0);
    assert.ok(previous - value < .012, '透射必须连续渐隐，不能形成新的深水色带');
    previous = value;
  }
  for (const [x, z] of [[154, 0], [155, 0], [156, 0], [0, -155], [155, 155]]) {
    const depth = -heightAt(x, z);
    assert.equal(optics.getSeabedTransmission(depth), 0,
      `真实海床边缘(${x},${z})的${depth.toFixed(2)}米深水不能透出方形几何`);
  }
});
