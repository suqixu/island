import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOcean } from '../src/ocean.js';

function colors(env) {
  const ocean = createOcean(new THREE.Scene());
  try {
    ocean.update(0, env);
    return { shallow: ocean.mesh.material.uniforms.uShallowColor.value.clone(),
      deep: ocean.mesh.material.uniforms.uDeepColor.value.clone() };
  } finally { ocean.dispose(); }
}
const clear = { weather: 'sunny', daylight: 1, cloudiness: .1, skyCloudCover: .1,
  sunDirection: new THREE.Vector3(0, 1, 0) };

test('晴日低云量时深海更蓝，浅水仍保留青绿层次', () => {
  const ordinary = colors({}), sunny = colors(clear);
  assert.ok(sunny.deep.b / sunny.deep.g > ordinary.deep.b / ordinary.deep.g * 1.5,
    '清澈日照应能呈现更饱满的深海蓝');
  assert.ok(sunny.shallow.g > sunny.shallow.r * 5, '近岸仍为透明的青绿浅水');
  assert.ok(sunny.shallow.g > sunny.deep.g * 2, '浅水与深海不能变成同一种蓝');
});

test('浓云、暮色和夜间不套用晴日增蓝，原有天气与光照配色继续生效', () => {
  for (const conditions of [{ skyCloudCover: 1 }, { daylight: .35 }, { daylight: 0 },
    { weather: 'rain', cloudiness: .8, rain: 1 }, { fog: 1 }]) {
    const env = { ...clear, ...conditions };
    const actual = colors(env), existing = colors({ ...env, weather: undefined });
    assert.deepEqual(actual.deep.toArray(), existing.deep.toArray());
    assert.deepEqual(actual.shallow.toArray(), existing.shallow.toArray());
  }
});
