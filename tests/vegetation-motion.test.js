import test from 'node:test';
import assert from 'node:assert/strict';

const motion = await import('../src/vegetation-motion.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});
const api = () => { assert.ok(motion?.createVegetationWindState, '植被需要共享的连续海风运动模型'); return motion; };
const settled = env => { const m = api(), state = m.createVegetationWindState(); m.advanceVegetationWind(state, 0, env); return state; };
const norm = vector => Math.hypot(...vector);

test('椰叶/草根和树冠连接区固定，柔性只向叶尖与冠顶增加', () => {
  const m = api();
  for (const kind of ['palm', 'ground']) {
    assert.equal(m.getVegetationFlex(kind, 0), 0);
    assert.equal(m.getVegetationFlex(kind, 1), 1);
    assert.ok(m.getVegetationFlex(kind, .2) < m.getVegetationFlex(kind, .8));
  }
  assert.equal(m.getVegetationFlex('crown', -1.2), 0);
  assert.equal(m.getVegetationFlex('crown', 2.2), 1);
  const wind = settled({ windSpeed: 22, gust: 1, windDirection: [1, 0] });
  for (const time of [0, 1, 10, 70]) for (const kind of ['palm', 'crown', 'ground']) {
    assert.deepEqual(m.getVegetationDisplacement(time, 0, 1.7, wind, kind), [0, 0, 0]);
  }
});

test('更快海风和阵风增大摆幅，晴天也有可见椰叶轻摆且强风有界', () => {
  const m = api(), calm = settled({ windSpeed: 2, gust: 0 }), breeze = settled({ windSpeed: 7, gust: .15 }), strong = settled({ windSpeed: 22, gust: 1 });
  assert.ok(breeze.amplitudes[0] > calm.amplitudes[0]);
  assert.ok(strong.amplitudes[0] > breeze.amplitudes[0] * 1.6);
  assert.ok(settled({ windSpeed: 7, gust: 1 }).amplitudes[0] > breeze.amplitudes[0]);
  let breezePeak = 0;
  for (let step = 0; step <= 1200; step++) {
    const time = step / 20;
    breezePeak = Math.max(breezePeak, norm(m.getVegetationDisplacement(time, 1, 0, breeze, 'palm')));
    for (const phase of [0, 1.3, 4.9]) {
      assert.ok(norm(m.getVegetationDisplacement(time, 1, phase, strong, 'palm')) < .95);
      assert.ok(norm(m.getVegetationDisplacement(time, 1, phase, strong, 'crown')) < .70);
      assert.ok(norm(m.getVegetationDisplacement(time, 1, phase, strong, 'ground')) < .50);
    }
  }
  assert.ok(breezePeak > .35 && breezePeak < .6, `晴天叶尖位移 ${breezePeak}`);
});

test('晴天远景冠顶明显缓摆，叶尖有小幅细颤且冠底不漂移', () => {
  const m = api(), wind = settled({ windSpeed: 7, gust: .15 });
  let crownPeak = 0, tipTravel = 0, innerTravel = 0;
  for (let i = 0; i < 2400; i++) {
    const time = i / 40;
    crownPeak = Math.max(crownPeak, norm(m.getVegetationDisplacement(time, 1, 1.3, wind, 'crown')));
    const a = m.getVegetationDisplacement(time, 1, .7, wind), b = m.getVegetationDisplacement(time + .025, 1, .7, wind);
    const c = m.getVegetationDisplacement(time, .15, .7, wind), d = m.getVegetationDisplacement(time + .025, .15, .7, wind);
    tipTravel += norm(a.map((v, j) => v - b[j])); innerTravel += norm(c.map((v, j) => v - d[j]));
  }
  assert.ok(crownPeak > .29 && crownPeak < .45, `晴天冠顶摆幅 ${crownPeak}`);
  assert.ok(tipTravel > innerTravel * 20);
  assert.deepEqual(m.getVegetationDisplacement(8, 0, .7, wind, 'crown'), [0, 0, 0]);
});

test('世界风向决定摆动方向，整场换向使轨迹一起旋转而不改变幅度', () => {
  const m = api(), east = settled({ windSpeed: 10, gust: .4, windDirection: [1, 0] }), north = settled({ windSpeed: 10, gust: .4, windDirection: [0, 1] });
  for (const time of [1, 3, 6, 10]) {
    const a = m.getVegetationDisplacement(time, 1, .8, east), b = m.getVegetationDisplacement(time, 1, .8, north);
    assert.ok(Math.abs(a[0] - b[2]) < 1e-12);
    assert.ok(Math.abs(a[2] + b[0]) < 1e-12);
    assert.ok(Math.abs(a[1] - b[1]) < 1e-12);
  }
});

test('每株独立相位，运动连续且小时/暂停模拟速度不改真实 elapsed 轨迹', () => {
  const m = api(), wind = settled({ windSpeed: 9, gust: .3 });
  assert.ok(norm(m.getVegetationDisplacement(4, 1, 0, wind).map((value, i) => value - m.getVegetationDisplacement(4, 1, 2.1, wind)[i])) > .05);
  for (let i = 0; i < 600; i++) {
    const a = m.getVegetationDisplacement(i / 60, 1, .8, wind), b = m.getVegetationDisplacement((i + 1) / 60, 1, .8, wind);
    assert.ok(norm(a.map((value, j) => value - b[j])) < .02);
  }
  const a = settled({ windSpeed: 9, gust: .3, hour: 2, running: false, speed: 100 });
  const b = settled({ windSpeed: 9, gust: .3, hour: 18, running: true, speed: 1 });
  assert.deepEqual(m.getVegetationDisplacement(20, 1, 2.1, a), m.getVegetationDisplacement(20, 1, 2.1, b));
});

test('风速/方向切换不会瞬移，指数平滑在30和120帧下给出相同结果', () => {
  const m = api();
  const run = fps => {
    const state = settled({ windSpeed: 3, gust: 0, windDirection: [1, 0] });
    let previous = m.getVegetationDisplacement(0, 1, 1.1, state);
    for (let frame = 1; frame <= fps * 2; frame++) {
      m.advanceVegetationWind(state, frame / fps, { windSpeed: 20, gust: .9, windDirection: [0, 1] });
      const next = m.getVegetationDisplacement(frame / fps, 1, 1.1, state);
      assert.ok(norm(next.map((v, i) => v - previous[i])) < .06);
      previous = next;
    }
    return state;
  };
  const slow = run(30), fast = run(120);
  assert.ok(Math.abs(slow.windSpeed - fast.windSpeed) < 1e-10);
  assert.ok(Math.abs(slow.gust - fast.gust) < 1e-10);
  assert.ok(norm(slow.direction.map((v, i) => v - fast.direction[i])) < 1e-10);
});

test('异常风速/阵风/方向和时间保持有限、有界，不倒退时钟', () => {
  const m = api(), state = settled({ windSpeed: NaN, gust: Infinity, windDirection: [NaN, 0] });
  m.advanceVegetationWind(state, 5, { wind: Infinity, windSpeed: -50, gust: -10, windDirection: [0, 0] });
  const previousTime = state.time;
  m.advanceVegetationWind(state, NaN, {}); m.advanceVegetationWind(state, -100, {});
  assert.equal(state.time, previousTime);
  assert.ok(state.windSpeed >= 2 && state.windSpeed <= 22 && state.gust >= 0 && state.gust <= 1);
  assert.ok(Math.abs(norm(state.direction) - 1) < 1e-12);
  for (const time of [NaN, Infinity, -5]) assert.ok(m.getVegetationDisplacement(time, 1, NaN, state).every(Number.isFinite));
  for (const value of [-100, NaN, Infinity]) assert.equal(m.getVegetationFlex('palm', value), 0);
});
