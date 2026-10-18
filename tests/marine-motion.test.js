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
        const phase = event.type === 'whale-blow' ? .29 : event.kind === 'whale' ? .88 : event.type === 'dolphin' ? .14 : .87;
        assert.ok(Math.abs(pose.progress - phase) < 1e-8, '声音应跟随个体自己的起跳时刻与时长');
        assert.ok(event.index < episode.count);
        const key = `${event.kind}:${event.cycle}:${event.index}:${event.type}`;
        assert.ok(!seen.has(key)); seen.add(key);
        assert.ok(event.time <= now && now - event.time < .02);
      }
      for (const kind of ['whale', 'dolphin']) {
        const episode = timeline.getEpisode(kind, now);
        if (!episode) continue;
        for (let index = 0; index < episode.count; index++) {
          const member = episode.members[index], start = episode.start + (member.delay ?? index * episode.spacing);
          for (const boundary of [start, start + (member.duration ?? episode.duration)]) {
            const before = getMarinePose(kind, index, boundary - .00001, undefined, episode);
            const after = getMarinePose(kind, index, boundary + .00001, undefined, episode);
            assert.ok(distance(before.position, after.position) < .001);
            if (kind === 'dolphin') {
              assert.ok(Math.abs(before.pitch - after.pitch) < .001, '确切入水边界的俯仰也应连续');
              assert.ok(Math.abs(before.heading - after.heading) < .001, '确切入水边界不能掉头');
            }
          }
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

test('海豚更常单独出现，多只时起跳不按索引排队且每只保留独立弧线', () => {
  const { createMarineTimeline, getMarinePose } = api();
  const counts = new Map(); let loosePod = null, pods = 0, variedArcs = 0, scatteredPods = 0;
  for (let seed = 0; seed < 160; seed++) {
    const episode = createMarineTimeline(seed).getEpisode('dolphin', 30);
    counts.set(episode.count, (counts.get(episode.count) ?? 0) + 1);
    if (episode.count < 3) continue;
    pods++;
    if (episode.members.some((member, index) => index > 0 && member.lateral < episode.members[index - 1].lateral)) scatteredPods++;
    const starts = [], durations = [], peaks = [], speeds = [], headings = [];
    for (let member = 0; member < episode.count; member++) {
      const poses = [];
      for (let step = 0; step < 700; step++) {
        const time = episode.start + step / 100;
        const pose = getMarinePose('dolphin', member, time, undefined, episode);
        if (pose.active) poses.push({ ...pose, time });
      }
      starts.push(poses[0].time); durations.push(poses.length / 100);
      const peak = poses.reduce((best, pose) => pose.position[1] > best.position[1] ? pose : best);
      peaks.push(peak.position[1]); headings.push(peak.heading);
      speeds.push(distance(poses[0].position, poses.at(-1).position) / durations.at(-1));
    }
    if (starts.some((start, index) => index > 1 && start < starts[index - 1])) loosePod = episode;
    if (Math.max(...durations) - Math.min(...durations) > .08 && Math.max(...peaks) - Math.min(...peaks) > .2 &&
        Math.max(...speeds) - Math.min(...speeds) > .15 && Math.max(...headings) - Math.min(...headings) > .015) variedArcs++;
  }
  assert.ok(counts.get(1) >= 65, '至少四成活动为单只，减少每轮都像编队的观感');
  assert.deepEqual([...counts.keys()].sort(), [1, 2, 3, 4]);
  assert.ok(loosePod, '至少存在非索引顺序起跳的小群');
  assert.ok(variedArcs > pods * .8, '大多数小群应同时有不同时长、跃高、游速和朝向，不能只是整齐复制');
  assert.ok(scatteredPods > pods * .5, '成员不能继续按索引从左到右排列');
});

test('同群海豚可同时处于起跳与入水阶段，出入水体轴连续且沿轨迹方向', () => {
  const { createMarineTimeline, getMarinePose } = api();
  let mixedPhase = false;
  for (const seed of [0, 42, 77, 2718, 941]) {
    const timeline = createMarineTimeline(seed);
    for (let time = 25; time < 130; time += 8) {
      const episode = timeline.getEpisode('dolphin', time);
      const original = structuredClone(episode);
      for (let step = 0; step < 400; step++) {
        const now = episode.start - .01 + step / 60;
        const poses = Array.from({ length: episode.count }, (_, index) => getMarinePose('dolphin', index, now, undefined, episode));
        if (poses.some(pose => pose.active && pose.progress < .3) && poses.some(pose => pose.active && pose.progress > .75)) mixedPhase = true;
        for (let index = 0; index < poses.length; index++) {
          const pose = poses[index], after = getMarinePose('dolphin', index, now + .0001, undefined, episode);
          assert.ok(distance(pose.position, after.position) < .003);
          assert.ok(Math.abs(pose.pitch - after.pitch) < .003, '入水边界不能把低头姿态瞬间掰平');
          assert.ok(Math.abs(pose.heading - after.heading) < .003, '入水边界不能瞬间掉头');
          if (!pose.active || !after.active) continue;
          const velocity = after.position.map((value, axis) => value - pose.position[axis]);
          const forward = [Math.sin(pose.heading) * Math.cos(pose.pitch), Math.sin(pose.pitch), Math.cos(pose.heading) * Math.cos(pose.pitch)];
          assert.ok(velocity.reduce((sum, value, axis) => sum + value * forward[axis], 0) / Math.hypot(...velocity) > .999);
        }
      }
      assert.deepEqual(episode, original, '固定个体参数不能在逐帧采样中重随机');
    }
  }
  assert.ok(mixedPhase, '不能只让整个群体一起跳起、一起落下');
});

test('松散海豚小群保留游动间距，随机布局不能让可见身体挤在同一点', () => {
  const { createMarineTimeline, getMarinePose } = api();
  for (let seed = 0; seed < 160; seed++) {
    const episode = createMarineTimeline(seed).getEpisode('dolphin', 30);
    for (let time = episode.start; time < episode.end; time += .05) {
      const poses = episode.members.map((member, index) => getMarinePose('dolphin', index, time,
        { x: member.lateral, z: member.along, heading: 0 }, episode));
      for (let index = 0; index < poses.length; index++) for (let other = index + 1; other < poses.length; other++) {
        const first = poses[index], second = poses[other];
        if (!first.active || !second.active || first.position[1] < -.7 || second.position[1] < -.7) continue;
        assert.ok(distance(first.position, second.position) > 1.5, '随机错落仍应留出两只身体的宽度');
      }
    }
  }
});

test('长时鲸豚调度保留原种子结果，包括跨日跳时与绝对活动周期', async () => {
  const { createHash } = await import('node:crypto');
  const { createMarineTimeline } = api();
  // Captured from the original scheduler before bounding its history. Include
  // every episode/member property so pruning cannot silently reset cycles.
  const expected = new Map([
    [0, 'b91c007613bad3e902b17812cc44b2b292ca4092a9cb93610b11a36033feb671'],
    [42, 'ce71cf114d86f0ec9825badbebafe99641f803d63934a6a43efe057bf5df7a7e'],
    [2718, '15a04ffa2fae13d87c23b9f7a7357c0c9a3d0033e63e8a59b76fc9513d66163f'],
  ]);
  for (const [seed, signature] of expected) {
    const timeline = createMarineTimeline(seed), results = [];
    for (const time of [0, 7.5, 12, 25, 90, 3599, 3600, 21600, 86400, 86400.25]) {
      for (const kind of ['whale', 'dolphin']) results.push(timeline.getEpisode(kind, time));
    }
    assert.equal(createHash('sha256').update(JSON.stringify(results)).digest('hex'), signature);
  }
});

test('十帧画面的16倍速连续六小时后，活动缓存有界且无需重建历史', () => {
  const { createMarineTimeline } = api();
  const timeline = createMarineTimeline(42);
  assert.ok(timeline.stats, '时间线提供只读缓存诊断');
  for (let frame = 0; frame <= 13500; frame++) {
    const now = frame * 1.6;
    for (const kind of ['whale', 'dolphin']) timeline.getEpisode(kind, now);
    if (frame % 750 !== 0) continue;
    const stats = timeline.stats;
    assert.ok(stats.cachedWhales <= 16 && stats.cachedDolphins <= 16);
    assert.equal(stats.historyRebuilds, 0);
    const fresh = createMarineTimeline(42);
    for (const kind of ['whale', 'dolphin']) assert.deepEqual(timeline.getEpisode(kind, now), fresh.getEpisode(kind, now));
  }
  const stats = timeline.stats;
  assert.ok(stats.whaleCycles > 500 && stats.dolphinCycles > 500);
  assert.ok(Object.isFrozen(stats));
  assert.throws(() => { stats.cachedWhales = 999; }, TypeError);
});

test('缓存淘汰后的任意过去时间仍可回拨查询，当前前进缓存不被历史查询覆盖', () => {
  const { createMarineTimeline } = api();
  for (const seed of [0, 42, 2718]) {
    const timeline = createMarineTimeline(seed);
    const currentWhale = timeline.getEpisode('whale', 86400);
    const currentDolphin = timeline.getEpisode('dolphin', 86400);
    const cached = timeline.stats;
    assert.ok(cached);
    for (const now of [3600, 0, 12, 42, 21600, 7.5, 3599]) {
      const fresh = createMarineTimeline(seed);
      for (const kind of ['dolphin', 'whale']) {
        assert.deepEqual(timeline.getEpisode(kind, now), fresh.getEpisode(kind, now));
      }
    }
    assert.ok(timeline.stats.historyRebuilds > 0);
    assert.equal(timeline.stats.whaleCycles, cached.whaleCycles);
    assert.equal(timeline.stats.dolphinCycles, cached.dolphinCycles);
    assert.equal(timeline.getEpisode('whale', 86400), currentWhale);
    assert.equal(timeline.getEpisode('dolphin', 86400), currentDolphin);
    for (const kind of ['whale', 'dolphin']) {
      assert.deepEqual(timeline.getEpisode(kind, 86416), createMarineTimeline(seed).getEpisode(kind, 86416));
    }
  }
});

test('跨多日大步跳时与逐步推进均保留完整鲸豚避让间隔', () => {
  const { createMarineTimeline } = api();
  for (const seed of [0, 42, 77, 2718, 2147483646]) {
    const timeline = createMarineTimeline(seed);
    for (const time of [86400, 86401.6, 86403.2, 172800, 172801.6, 259200]) {
      const pod = timeline.getEpisode('dolphin', time);
      assert.ok(pod.cycle > 1000);
      for (const boundary of [pod.start, pod.end + 1.8]) {
        const whale = timeline.getEpisode('whale', boundary);
        assert.ok(pod.start >= whale.end + 1.8 || pod.end <= whale.start - 1.8,
          `seed=${seed} dolphin=${pod.cycle} whale=${whale.cycle}`);
      }
      assert.deepEqual(pod, createMarineTimeline(seed).getEpisode('dolphin', time));
    }
  }
});
