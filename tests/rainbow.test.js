import test from 'node:test';
import assert from 'node:assert/strict';

let rainbow;
try { rainbow = await import('../src/rainbow.js'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

test('双虹构图在横屏和手机中为副虹留出天空空间，彩带随尺寸缩放', () => {
  assert.equal(typeof rainbow?.getRainbowFraming, 'function');
  for (const [width, height, horizon] of [[1440, 900, 480], [390, 844, 360], [844, 390, 220]]) {
    const frame = rainbow.getRainbowFraming({ width, height, horizonPixels: horizon, fov: 54 });
    assert.ok(frame.visible);
    assert.ok(frame.radiusPixels * 2 >= Math.min(width * .6, (horizon - 80) * 1.5), '主虹应形成有尺度的海上拱弧');
    assert.ok(frame.radiusPixels * 1.21 - frame.dropPixels < horizon - 65, '副虹顶部应留在工具栏下方');
    assert.ok(frame.width < frame.radius * .12, '彩带不能在手机上膨胀成粗色条');
  }
});

test('单虹和双虹按每次雨后事件选取，逐帧更新和暂时遮蔽不重新随机', () => {
  assert.equal(typeof rainbow?.createRainbowAppearance, 'function');
  let rolls = 0;
  const appearance = rainbow.createRainbowAppearance(() => [0.1, 0.9][rolls++]);
  assert.equal(appearance.update(null), 0);
  assert.equal(rolls, 0);
  const first = appearance.update(12);
  assert.ok(first > 0, '第一种随机结果应出现清晰副虹');
  for (const event of [12, 12, null, 12]) assert.equal(appearance.update(event), first);
  assert.equal(rolls, 1);
  assert.equal(appearance.update(120), 0, '下一次事件可选中单虹');
  assert.equal(rolls, 2);
});

test('没有天空、镜头异常或视口为零时不输出无效的彩虹参数', () => {
  assert.equal(typeof rainbow?.getRainbowFraming, 'function');
  for (const options of [{ width: 0 }, { height: 0 }, { horizonPixels: 40 }, { fov: NaN }]) {
    const frame = rainbow.getRainbowFraming({ width: 1440, height: 900, horizonPixels: 480, fov: 54, ...options });
    assert.equal(frame.visible, false);
    assert.ok(Object.values(frame).every(value => typeof value !== 'number' || Number.isFinite(value)));
  }
});
