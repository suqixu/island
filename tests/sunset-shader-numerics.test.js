import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createOcean } from '../src/ocean.js';

// GLSL permits pow to be implemented through log/exp: a negative base is
// outside its specified domain even with exponent 2. Evaluate the actual
// scalar shader assignments using that domain, without assuming JS Math.pow
// has the same contract. This narrowly checks the Gaussian colour weights.
function evaluateScalar(shader, name, inputs) {
  const expression = shader.match(new RegExp(`float\\s+${name}\\s*=\\s*([^;]+);`))?.[1];
  assert.ok(expression, `Missing shader scalar ${name}`);
  const scope = { ...inputs,
    exp: Math.exp,
    pow: (base, exponent) => base < 0 || (base === 0 && exponent <= 0) ? NaN : Math.pow(base, exponent),
  };
  for (const token of expression.matchAll(/(?<![\w.])([A-Za-z_]\w*)/g)) {
    const identifier = token[1];
    if (!(identifier in scope)) scope[identifier] = evaluateScalar(shader, identifier, inputs);
  }
  return Function(...Object.keys(scope), `return (${expression});`)(...Object.values(scope));
}

const atmosphereSource = readFileSync(new URL('../src/atmosphere.js', import.meta.url), 'utf8');
const skyShader = atmosphereSource.match(/const skyFragment = \/\* glsl \*\/ `([\s\S]*?)\n`;/)?.[1];

test('晚霞天空与海面反射的低空高斯权重在负偏移域仍有限且保留原有形状', () => {
  const ocean = createOcean(new THREE.Scene());
  try {
    for (const [label, shader, input] of [
      ['sky', skyShader, height => ({ direction: { y: height } })],
      ['ocean reflection', ocean.mesh.material.fragmentShader, height => ({ elevation: height })],
    ]) {
      for (let index = 0; index <= 200; index++) {
        const height = label === 'sky' ? -1 + index / 100 : index / 200;
        for (const band of ['goldBand', 'roseBand']) {
          const value = evaluateScalar(shader, band, input(height));
          assert.ok(Number.isFinite(value) && value >= 0 && value <= 1,
            `${label} ${band} at height ${height} cannot send NaN into colour blending`);
        }
      }
      assert.equal(evaluateScalar(shader, 'goldBand', input(.065)), 1);
      assert.equal(evaluateScalar(shader, 'roseBand', input(.20)), 1);
      // One Gaussian width either side of the ridge is exp(-1).
      for (const height of [-.045, .175]) {
        assert.ok(Math.abs(evaluateScalar(shader, 'goldBand', input(height)) - .36787944117144233) < 1e-14);
      }
      for (const height of [.07, .33]) {
        assert.ok(Math.abs(evaluateScalar(shader, 'roseBand', input(height)) - .36787944117144233) < 1e-14);
      }
    }
  } finally { ocean.dispose(); }
});
