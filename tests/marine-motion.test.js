import test from 'node:test';
import assert from 'node:assert/strict';
import { heightAt } from '../src/terrain.js';

const motion = await import('../src/marine-motion.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});
const api = () => {
  assert.ok(motion, '海洋运动应提供纯轨迹及单次事件接口');
  return motion;
};
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));

test('鱼群栖息地可重复、位于真实海床上方，并拒绝全部为陆地的场景', () => {
  const { createFishHabitat } = api();
  for (let index = 0; index < 60; index++) {
    const home = createFishHabitat(heightAt, index);
    assert.ok(home);
    assert.ok(heightAt(home.x, home.z) < -1);
    assert.deepEqual(createFishHabitat(heightAt, index), home);
  }
  assert.equal(createFishHabitat(() => 10, 0), null);
});

test('真实岸线周围游动的鱼始终留在水下、浅水区及海床之上', () => {
  const { createFishHabitat, getFishPose } = api();
  for (let index = 0; index < 60; index++) {
    const home = createFishHabitat(heightAt, index);
    for (const time of [0, 2, 11, 35, 70]) {
      const pose = getFishPose(time, index, home, heightAt, 1);
      const [x, y, z] = pose.position;
      assert.ok(pose.visible);
      assert.ok(y <= -.6 && y >= -3);
      assert.ok(y > heightAt(x, z) + .2);
      assert.ok(pose.position.every(Number.isFinite));
    }
  }
});

test('鱼群轨迹与尾摆连续，坏天气及夜间降低活动', () => {
  const { createFishHabitat, getFishPose, getMarineActivity } = api();
  const home = createFishHabitat(heightAt, 8);
  for (let frame = 0; frame < 120; frame++) {
    const before = getFishPose(frame / 60, 8, home, heightAt, 1);
    const after = getFishPose((frame + 1) / 60, 8, home, heightAt, 1);
    assert.ok(distance(before.position, after.position) < .1);
    assert.ok(Math.abs(before.tail - after.tail) < .15);
  }
  const day = getMarineActivity({ daylight: 1 });
  assert.ok(getMarineActivity({ daylight: 0 }) < day * .5);
  assert.ok(getMarineActivity({ daylight: 1, storm: 1 }) < day * .3);
});

test('同种子重现鱼群位置和游姿，不同种子改变栖息地、相位及游姿', () => {
  const { createFishHabitat, getFishPose } = api();
  for (const index of [0, 7, 17, 18, 35, 59]) {
    const first = createFishHabitat(heightAt, index, 2718);
    const repeated = createFishHabitat(heightAt, index, 2718);
    const other = createFishHabitat(heightAt, index, 9321);
    assert.deepEqual(first, repeated);
    assert.ok(Math.hypot(first.x - other.x, first.z - other.z) > .1);
    assert.notEqual(first.phase, other.phase);
    assert.deepEqual(getFishPose(30, index, first, heightAt), getFishPose(30, index, repeated, heightAt));
    assert.ok(distance(getFishPose(30, index, first, heightAt).position,
      getFishPose(30, index, other, heightAt).position) > .1);
  }
  assert.notDeepEqual(createFishHabitat(heightAt, 0, .17), createFishHabitat(heightAt, 0, .73));
});

test('随机化保留前十八条浅海礁鱼，其余小群沿岛岸分散', () => {
  const { createFishHabitat } = api();
  const quadrants = new Set();
  for (const seed of [0, 27, 34567, .42, 2147483646]) {
    for (let index = 0; index < 60; index++) {
      const home = createFishHabitat(heightAt, index, seed);
      assert.ok(home);
      if (index < 18) {
        assert.ok(Math.hypot(home.x - 84, home.z - 26) < 12, '前十八条鱼应留在浅海视角可发现的礁区');
      } else {
        assert.ok(Math.hypot(home.x, home.z) >= 80 && Math.hypot(home.x, home.z) <= 120);
        quadrants.add(`${home.x >= 0}:${home.z >= 0}`);
      }
    }
  }
  assert.equal(quadrants.size, 4, '随机近岸小群应覆盖岛屿各方向');
});

test('多个种子在真实海床上保持连续安全轨迹，home不会逐帧重随机', () => {
  const { createFishHabitat, getFishPose } = api();
  for (const seed of [0, 27, 34567, .42, 2147483646]) {
    for (let index = 0; index < 60; index++) {
      const home = createFishHabitat(heightAt, index, seed);
      const original = structuredClone(home);
      for (const time of [0, 5, 19, 58]) {
        const before = getFishPose(time, index, home, heightAt, 1);
        const after = getFishPose(time + 1 / 60, index, home, heightAt, 1);
        assert.ok(before.visible && after.visible);
        assert.ok(before.position[1] >= -3 && before.position[1] <= -.6);
        assert.ok(before.position[1] > heightAt(before.position[0], before.position[2]) + .2);
        assert.ok(distance(before.position, after.position) < .1);
        assert.ok(Math.abs(before.tail - after.tail) < .15);
      }
      assert.deepEqual(home, original);
    }
  }
});

test('新增泻湖沙洲阻挡原方位时整组六鱼共同选择安全替代栖息地', () => {
  const { createFishHabitat, getFishPose } = api();
  for (const [seed, first] of [[0, 48], [34567, 54]]) {
    const homes = Array.from({ length: 6 }, (_, offset) => createFishHabitat(heightAt, first + offset, seed));
    assert.ok(homes.every(Boolean), '不能因固定方位被新沙洲挡住而丢失整组鱼');
    for (let member = 0; member < homes.length; member++) {
      const home = homes[member];
      assert.deepEqual(createFishHabitat(heightAt, first + member, seed), home);
      for (const other of homes) assert.ok(Math.hypot(home.x - other.x, home.z - other.z) < 5, '同一组应共享替代中心，不能每条鱼跳到不同海岸');
      for (const time of [0, 11, 58]) {
        const pose = getFishPose(time, first + member, home, heightAt);
        assert.ok(pose.visible && pose.position[1] > heightAt(pose.position[0], pose.position[2]) + .2);
      }
    }
  }
});

test('跃水事件间歇出现、成员错开，八至十二秒内有首个可见事件', () => {
  const { getMarinePose, createMarineEventTracker, MARINE_SCHEDULE } = api();
  const start = MARINE_SCHEDULE.dolphin.start;
  assert.equal(getMarinePose('dolphin', 0, 0).active, false);
  assert.equal(getMarinePose('dolphin', 0, start + 1).active, true);
  assert.equal(getMarinePose('dolphin', 2, start + .2).active, false);
  assert.equal(getMarinePose('dolphin', 0, 25).active, false);
  assert.equal(getMarinePose('flying-fish', 0, 27).active, true);
  assert.equal(getMarinePose('whale', 0, 30).active, false);
  const tracker = createMarineEventTracker();
  tracker.collect(0);
  const first = tracker.collect(10);
  assert.ok(first.some(event => event.type === 'dolphin'));
  assert.ok(first.every(event => event.time >= 8 && event.time <= 12));
});

test('巨鲸浮背有五至八秒明确水线阶段，中心始终在水下，首喷在十二秒前', () => {
  const { getMarinePose, createMarineEventTracker } = api();
  let visible = 0;
  const tracker = createMarineEventTracker({ flyingFish: 0 });
  const events = [];
  for (let frame = 0; frame <= 30 * 100; frame++) {
    const t = frame / 100, pose = getMarinePose('whale', 0, t);
    assert.ok(pose.position[1] < -.2, '鲸体中心不可跃出水面');
    if (pose.active && pose.position[1] > -1.05) visible += .01;
    events.push(...tracker.collect(t));
  }
  assert.ok(visible >= 5 && visible <= 8);
  const blow = events.find(event => event.type === 'whale-blow');
  assert.ok(blow && blow.time >= 8 && blow.time <= 12);
});

test('海豚和飞鱼弧线出入水、鲸鱼只浮露背部，循环边缘位置连续', () => {
  const { getMarinePose, MARINE_SCHEDULE } = api();
  for (const kind of ['dolphin', 'flying-fish', 'whale']) {
    const schedule = MARINE_SCHEDULE[kind];
    assert.ok(schedule.period >= 40 && schedule.period <= 70);
    const start = getMarinePose(kind, 0, schedule.start);
    const peak = getMarinePose(kind, 0, schedule.start + schedule.duration / 2);
    const end = getMarinePose(kind, 0, schedule.start + schedule.duration);
    assert.ok(start.position[1] < 0 && end.position[1] < 0);
    if (kind === 'whale') assert.ok(peak.position[1] > -.8 && peak.position[1] < 0);
    else assert.ok(peak.position[1] > .7);
    for (const boundary of [schedule.start, schedule.start + schedule.duration, schedule.start + schedule.period]) {
      assert.ok(distance(getMarinePose(kind, 0, boundary - .00001).position,
        getMarinePose(kind, 0, boundary + .00001).position) < .001);
    }
  }
});

test('音效事件只在出水、喷水或入水时触发一次，不在每帧重复', () => {
  const { createMarineEventTracker } = api();
  const tracker = createMarineEventTracker();
  const keys = new Set();
  const types = new Set();
  for (let frame = 0; frame <= 120 * 60; frame++) {
    for (const event of tracker.collect(frame / 60)) {
      const key = `${event.kind}:${event.index}:${event.type}:${event.time}`;
      assert.ok(!keys.has(key), key);
      keys.add(key);
      types.add(event.type);
      assert.ok(event.strength > 0 && event.strength <= 1);
    }
    assert.deepEqual(tracker.collect(frame / 60), []);
  }
  for (const type of ['dolphin', 'whale-blow', 'flying-fish', 'splash']) assert.ok(types.has(type));
});

test('远海事件锚点避开陆地，异常时间和缺省环境不会产生NaN或重复事件', () => {
  const { createMarineAnchor, getMarinePose, getMarineActivity, createMarineEventTracker } = api();
  const anchor = createMarineAnchor(heightAt, { x: 30, z: 90, heading: .3 });
  assert.ok(anchor);
  for (const kind of ['whale', 'dolphin', 'flying-fish']) {
    for (const time of [NaN, Infinity, -10, 0, 14, 20, 30, 80]) {
      const pose = getMarinePose(kind, 0, time, anchor);
      assert.ok(pose.position.every(Number.isFinite));
      assert.ok(heightAt(pose.position[0], pose.position[2]) < -2);
    }
  }
  assert.equal(createMarineAnchor(() => 10, { x: 30, z: 90 }), null);
  assert.ok(Number.isFinite(getMarineActivity({ daylight: NaN, storm: Infinity })));
  const tracker = createMarineEventTracker();
  assert.deepEqual(tracker.collect(NaN), []);
  assert.deepEqual(tracker.collect(-10), []);
});

test('随机鲸豚调度提高发现频率，物种错峰且同种子跨周期可重现', () => {
  const { createMarineTimeline } = api();
  assert.equal(typeof createMarineTimeline, 'function', '提供独立于昼夜状态的鲸豚时间线');
  const signature = seed => {
    const timeline = createMarineTimeline(seed), seen = new Map();
    for (let time = 0; time <= 360; time += .25) {
      for (const kind of ['whale', 'dolphin']) {
        const episode = timeline.getEpisode(kind, time);
        if (episode && episode.start <= time) seen.set(`${kind}:${episode.cycle}`, episode);
      }
    }
    return [...seen.values()].sort((a, b) => a.start - b.start);
  };
  for (const seed of [0, 42, 77, 2718, 2147483646]) {
    const events = signature(seed);
    assert.deepEqual(events, signature(seed));
    assert.ok(events.filter(event => event.kind === 'whale').length >= 9, '六分钟至少九次鲸鱼浮背');
    assert.ok(events.filter(event => event.kind === 'dolphin').length >= 11, '六分钟至少十一次海豚活动');
    for (let index = 1; index < events.length; index++) {
      assert.ok(events[index].start >= events[index - 1].end + 1, '鲸豚群须有完整错峰间隔');
    }
    const dolphins = events.filter(event => event.kind === 'dolphin');
    assert.ok(new Set(dolphins.map(event => event.count)).size >= 3, '各轮海豚群数量应变化');
    assert.ok(dolphins.every(event => event.count >= 1 && event.count <= 4));
    assert.ok(new Set(dolphins.map(event => JSON.stringify(event.members))).size === dolphins.length);
  }
  assert.notDeepEqual(signature(42), signature(77));
});

test('随机事件的成员出入水连续，声音阈值匹配同一时间线并跳过后台旧事件', () => {
  const { createMarineTimeline, getMarinePose, createMarineEventTracker } = api();
  assert.equal(typeof createMarineTimeline, 'function');
  for (const seed of [0, 42, 77]) {
    const timeline = createMarineTimeline(seed), tracker = createMarineEventTracker({ timeline, dolphins: 4, flyingFish: 0 });
    const seen = new Set(); tracker.collect(0);
    for (let frame = 1; frame <= 120 * 60; frame++) {
      const now = frame / 60;
      for (const event of tracker.collect(now)) {
        const episode = timeline.getEpisode(event.kind, event.time);
        const pose = getMarinePose(event.kind, event.index, event.time, { x: 220, z: 220, heading: -.55 }, episode);
        assert.ok(pose.active, '声音只能对应实际活动成员');
        assert.ok(event.index < episode.count);
        const key = `${event.kind}:${event.cycle}:${event.index}:${event.type}`;
        assert.ok(!seen.has(key)); seen.add(key);
        assert.ok(event.time <= now && now - event.time < .02);
      }
      for (const kind of ['whale', 'dolphin']) {
        const episode = timeline.getEpisode(kind, now);
        if (!episode) continue;
        for (let index = 0; index < episode.count; index++) {
          const boundary = episode.start + index * episode.spacing + episode.duration;
          assert.ok(distance(getMarinePose(kind, index, boundary - .00001, undefined, episode).position,
            getMarinePose(kind, index, boundary + .00001, undefined, episode).position) < .001);
        }
      }
    }
    const resumed = tracker.collect(260);
    assert.ok(resumed.every(event => event.time > 259), '不能集中重放后台期间的鲸豚声音');
    assert.deepEqual(tracker.collect(260), []);
  }
});

test('明亮月夜允许适度鲸豚活动，暗夜与雷暴仍压低活动', () => {
  const { getMarineActivity } = api();
  const moon = getMarineActivity({ daylight: 0, moonLight: 1 });
  assert.ok(moon >= .5 && moon < .75);
  assert.ok(getMarineActivity({ daylight: 0 }) < .2);
  assert.ok(getMarineActivity({ daylight: 0, moonLight: 1, storm: 1 }) < .2);
});
