import test from 'node:test';
import assert from 'node:assert/strict';

const motion = await import('../src/poem-motion.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});

function api() {
  assert.ok(motion, '诗句动画模块应提供联句计时与逐字运动');
  return motion;
}

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);

test('每联两句持续十秒，完整十八联后从首联重新浮现', () => {
  const { getPoemCue } = api();
  for (const [elapsed, index, age] of [[0, 0, 0], [9.75, 0, 9.75], [10, 1, 0], [174.5, 17, 4.5], [180, 0, 0], [364.25, 0, 4.25]]) {
    assert.deepEqual(getPoemCue(elapsed, 18), { index, age });
  }
});

test('无效时间或空联句不产生越界索引，单联仍正常循环', () => {
  const { getPoemCue } = api();
  for (const elapsed of [NaN, Infinity, -Infinity, -4, undefined, '20']) {
    assert.deepEqual(getPoemCue(elapsed, 18), { index: 0, age: 0 });
  }
  for (const count of [0, -1, NaN, Infinity, undefined, '18', .5]) {
    assert.deepEqual(getPoemCue(27.5, count), { index: 0, age: 0 });
  }
  assert.deepEqual(getPoemCue(37.5, 1), { index: 0, age: 7.5 });
  assert.deepEqual(getPoemCue(37.5, 2.9), { index: 1, age: 7.5 });
  for (const elapsed of [1e6, 1e100, Number.MAX_VALUE]) {
    const cue = getPoemCue(elapsed, 18);
    assert.ok(Number.isInteger(cue.index) && cue.index >= 0 && cue.index < 18);
    assert.ok(Number.isFinite(cue.age) && cue.age >= 0 && cue.age < 10);
  }
});

test('每联入口全字透明，十秒切换前上一联已全部消失', () => {
  const { getGlyphMotion } = api();
  for (const variant of [0, 1, 2]) {
    for (const row of [0, 1]) {
      for (let column = 0; column < 8; column++) {
        for (const age of [-1, 0, 9.9, 10, 50]) {
          assert.equal(getGlyphMotion(age, column, row, variant).opacity, 0, `age=${age}, column=${column}, row=${row}, variant=${variant}`);
        }
      }
    }
  }
});

test('第三到第六秒整联稳定可读，没有位移、缩放或旋转扰动', () => {
  const { getGlyphMotion } = api();
  for (const variant of [0, 1, 2]) {
    for (const age of [3, 4.5, 6]) {
      for (const row of [0, 1]) {
        for (let column = 0; column < 8; column++) {
          assert.deepEqual(getGlyphMotion(age, column, row, variant), { opacity: 1, drift: 0, lift: 0, depth: 0, rotation: 0, scale: 1 });
        }
      }
    }
  }
});

test('逐字按零点零九秒进入，第二行再延后零点八五秒', () => {
  const { getGlyphMotion } = api();
  const first = getGlyphMotion(.4, 0, 0);
  assert.ok(first.opacity > 0 && first.opacity < 1);
  assert.equal(getGlyphMotion(.09, 1, 0).opacity, 0);
  assert.equal(getGlyphMotion(.18, 2, 0).opacity, 0);
  assert.equal(getGlyphMotion(.8, 0, 1).opacity, 0);
  assert.equal(getGlyphMotion(.4, 7, 0).opacity, 0);
  near(getGlyphMotion(.49, 1, 0).opacity, first.opacity);
  near(getGlyphMotion(1.25, 0, 1).opacity, first.opacity);
  assert.ok(getGlyphMotion(.8, 0, 0).opacity > first.opacity);
});

test('入口伴随不到一个字高的柔和上浮，进入完成后回到排版位置', () => {
  const { getGlyphMotion } = api();
  const early = getGlyphMotion(.2, 0, 0);
  const later = getGlyphMotion(.8, 0, 0);
  assert.ok(early.lift < -.3 && early.lift >= -.6);
  assert.ok(later.lift > early.lift && later.lift < 0);
  assert.equal(getGlyphMotion(1.2, 0, 0).lift, 0);
  assert.equal(early.drift, 0);
  assert.equal(early.rotation, 0);
});

test('第七秒开始逐字错开消隐，第二行随后消隐', () => {
  const { getGlyphMotion } = api();
  assert.equal(getGlyphMotion(7, 0, 0).opacity, 1);
  assert.ok(getGlyphMotion(7.3, 0, 0).opacity < 1);
  assert.equal(getGlyphMotion(7.3, 7, 0).opacity, 1);
  assert.equal(getGlyphMotion(7.8, 0, 1).opacity, 1);
  assert.ok(getGlyphMotion(8.1, 0, 1).opacity < 1);
});

test('原地消隐只微升，风向飞散则向右上和远处移动并逐渐变淡', () => {
  const { getGlyphMotion } = api();
  const gentle = getGlyphMotion(7.8, 0, 0, 0);
  assert.equal(gentle.drift, 0);
  assert.equal(gentle.depth, 0);
  assert.equal(gentle.rotation, 0);
  assert.equal(gentle.scale, 1);
  assert.ok(gentle.lift > 0 && gentle.lift < .6);
  const early = getGlyphMotion(7.3, 0, 0, 1);
  const late = getGlyphMotion(8.1, 0, 0, 1);
  assert.ok(late.opacity < early.opacity && late.opacity > 0);
  assert.ok(late.drift > early.drift && late.drift >= 5);
  assert.ok(late.lift > early.lift && late.lift >= 5);
  assert.ok(late.depth > early.depth && late.depth >= 5);
  assert.ok(late.scale < early.scale && late.scale > 0);
});

test('散落效果向两侧和海面分散，并向远处淡出', () => {
  const { getGlyphMotion } = api();
  const left = getGlyphMotion(8.1, 0, 0, 2);
  const right = getGlyphMotion(8.19, 1, 0, 2);
  assert.ok(left.drift <= -5 && right.drift >= 5);
  assert.ok(left.lift < 0 && right.lift < 0);
  assert.ok(left.depth >= 5 && right.depth >= 5);
  assert.ok(left.opacity > 0 && left.opacity < 1);
  assert.ok(right.opacity > 0 && right.opacity < 1);
});

test('减少动态效果仍柔和淡入淡出，完全停止空间运动与缩放', () => {
  const { getGlyphMotion } = api();
  for (const variant of [0, 1, 2]) {
    for (const age of [0, .4, 1.5, 4, 7.6, 8.8, 9.9]) {
      for (const row of [0, 1]) {
        const reduced = getGlyphMotion(age, 2, row, variant, true);
        assert.equal(reduced.opacity, getGlyphMotion(age, 2, row, variant).opacity);
        assert.deepEqual({ ...reduced, opacity: 1 }, { opacity: 1, drift: 0, lift: 0, depth: 0, rotation: 0, scale: 1 });
      }
    }
  }
  const entering = getGlyphMotion(.4, 0, 0, 1, true);
  const leaving = getGlyphMotion(7.6, 0, 0, 1, true);
  assert.ok(entering.opacity > 0 && entering.opacity < 1);
  assert.ok(leaving.opacity > 0 && leaving.opacity < 1);
});

test('所有年龄与异常字索引都输出有限运动量，透明度始终限制在零到一', () => {
  const { getGlyphMotion } = api();
  for (const variant of [0, 1, 2, NaN, Infinity, -1]) {
    for (const [column, row] of [[0, 0], [7, 1], [NaN, NaN], [Infinity, Infinity], [-2, -1], [1e300, 1e300]]) {
      for (const age of [NaN, Infinity, -Infinity, undefined, -3, 0, 1, 3, 7.5, 9, 10, Number.MAX_VALUE]) {
        const result = getGlyphMotion(age, column, row, variant);
        for (const [key, value] of Object.entries(result)) assert.ok(Number.isFinite(value), `${key}=${value}`);
        assert.ok(result.opacity >= 0 && result.opacity <= 1);
        assert.ok(result.scale > 0);
      }
    }
  }
});
