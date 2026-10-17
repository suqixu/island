import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMarine } from '../src/marine.js';
import { heightAt } from '../src/terrain.js';
import { createMarineTimeline, getMarinePose } from '../src/marine-motion.js';

const clear = { daylight: 1, storm: 0, rain: 0, moonLight: 0, windDirection: [.83, .55] };
function cameraFor(width = 1280, height = 900, shallow = false, beach = false) {
  const camera = new THREE.PerspectiveCamera(width < 760 ? 54 : 46, width / height, .5, 65000);
  const scale = width < 760 ? 1.48 : 1;
  if (shallow) { camera.position.set(115, 17, 51); camera.lookAt(89, -1.15, 26); }
  else if (beach) { camera.position.set(96, 15, 111); camera.lookAt(8, 5, 20); }
  else { camera.position.set(160 * scale, 68 * scale, 200 * scale); camera.lookAt(0, 15, 0); }
  return camera;
}
const fishBodies = marine => marine.group.children.filter(mesh => mesh.isInstancedMesh &&
  mesh.name.endsWith('鱼身体') && mesh.instanceMatrix.count === 20);
const fishCount = marine => fishBodies(marine).reduce((count, mesh) => count + mesh.count, 0);

test('16倍速在十帧画面下仍显示鲸豚和落水事件，不能误判为后台中断', () => {
  const marine=createMarine(new THREE.Scene(),{heightAt,fishSeed:42}),camera=cameraFor(),events=[];
  let whales=0,dolphins=0;
  marine.onEvent=event=>events.push(event);
  for(let frame=0;frame<=400;frame++){
    marine.update(frame*1.6,{...clear,animationRate:16},camera);
    whales+=marine.group.children.find(item=>item.name==='鲸鱼身体').count;
    dolphins+=marine.group.children.find(item=>item.name==='海豚身体').count;
  }
  assert.ok(whales>10&&dolphins>10,'高倍率下活动仍应按加速动画时间呈现');
  assert.ok(events.some(event=>event.type==='whale-blow')&&events.some(event=>event.type==='splash'));
  marine.dispose();
});
function fishPositions(marine) {
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), result = [];
  for (const mesh of fishBodies(marine)) for (let index = 0; index < mesh.count; index++) {
    mesh.getMatrixAt(index, matrix); position.setFromMatrixPosition(matrix); result.push(position.clone());
  }
  return result;
}

test('三类近岸鱼在真实海床上方、水下渲染，前进体轴与游动方向一致', () => {
  const marine = createMarine(new THREE.Scene(), { heightAt, fishSeed: 42 });
  marine.update(0, clear, cameraFor());
  assert.equal(fishCount(marine), 60);
  const before = fishPositions(marine), matrix = new THREE.Matrix4(), forwards = [];
  for (const mesh of fishBodies(marine)) {
    assert.equal(mesh.material.transparent, false, '鱼先作为不透明生物写入深度，再由海水透视');
    for (let index = 0; index < mesh.count; index++) {
      mesh.getMatrixAt(index, matrix);
      const forward = new THREE.Vector3(0, 0, 1).transformDirection(matrix); forward.y = 0; forwards.push(forward.normalize());
    }
  }
  marine.update(.005, clear, cameraFor());
  const after = fishPositions(marine);
  for (let index = 0; index < after.length; index++) {
    const point = after[index];
    assert.ok(point.y <= -.6 && point.y > heightAt(point.x, point.z) + .2);
    const velocity = point.clone().sub(before[index]); velocity.y = 0;
    assert.ok(velocity.normalize().dot(forwards[index]) > .995);
  }
  marine.dispose();
});

test('鱼群随机种子可复现、不同场景种子改变位置，质量和夜间控制实际实例数', () => {
  const samples = [42, 42, 77].map(seed => {
    const marine = createMarine(new THREE.Scene(), { heightAt, fishSeed: seed });
    marine.update(0, clear, cameraFor());
    const positions = fishPositions(marine).map(point => point.toArray());
    marine.setQuality('low'); marine.update(.1, clear, cameraFor()); assert.equal(fishCount(marine), 24);
    marine.setQuality('medium'); marine.update(.2, clear, cameraFor()); assert.equal(fishCount(marine), 42);
    marine.update(.3, { daylight: 0 }, cameraFor()); assert.equal(fishCount(marine), 0);
    marine.dispose(); return positions;
  });
  assert.deepEqual(samples[0], samples[1]);
  assert.notDeepEqual(samples[0], samples[2]);
});

test('首次十二秒出现清楚的远海鲸喷，海豚随后独立跃水，四种画幅安全可见', () => {
  for (const [width, height, beach] of [[1280, 900, false], [634, 768, false], [390, 844, false], [1280, 900, true]]) {
    const camera = cameraFor(width, height, false, beach), marine = createMarine(new THREE.Scene(), { heightAt, fishSeed: 42 });
    const events = []; marine.onEvent = event => events.push(event);
    let sprayPeak = 0, whaleWidth = 0, dolphinWidth = 0, whaleLength = 0, visibleBack = 0, sprayDuration = 0;
    const matrix = new THREE.Matrix4(), world = new THREE.Vector3(), forward = new THREE.Vector3();
    for (let frame = 0; frame <= 30 * 60; frame++) {
      marine.update(frame / 60, clear, camera);
      for (const mesh of marine.group.children.filter(item => item.isInstancedMesh)) {
        const matrix = new THREE.Matrix4();
        for (let index = 0; index < mesh.count; index++) {
          mesh.getMatrixAt(index, matrix); assert.ok(matrix.elements.every(Number.isFinite), mesh.name);
        }
      }
      if (frame % 6 === 0) {
        const body = marine.group.children.find(item => item.name === '鲸鱼身体');
        const tail = marine.group.children.find(item => item.name === '鲸鱼尾鳍');
        if (body.count) {
          body.getMatrixAt(0, matrix); forward.set(0, 0, 1).transformDirection(matrix);
          const along = [], pixels = [], bodyTop = [];
          for (const mesh of [body, tail]) {
            mesh.getMatrixAt(0, matrix); const points = mesh.geometry.attributes.position;
            for (let index = 0; index < points.count; index++) {
              world.fromBufferAttribute(points, index).applyMatrix4(matrix); along.push(world.dot(forward));
              assert.ok(heightAt(world.x, world.z) < -8, '整只大动物应留在真正深海，不只是锚点安全');
              if (mesh === body && index < 45 * 17) bodyTop.push(world.y);
              if (world.y > .15) {
                const projected = world.clone().project(camera);
                assert.ok(Math.abs(projected.x) < .94 && projected.y > -.8 && projected.y < .65, '巨鲸露出部分应在镜头中留有余量');
                pixels.push((projected.x + 1) * width * .5);
              }
            }
          }
          whaleLength = Math.max(whaleLength, Math.max(...along) - Math.min(...along));
          const backHeight = Math.max(...bodyTop);
          if (backHeight > .75) visibleBack += .1;
          assert.ok(backHeight < 1.6, '鲸鱼只浮露宽背，不能把整只身体举在水面');
          if (pixels.length) whaleWidth = Math.max(whaleWidth, Math.max(...pixels) - Math.min(...pixels));
        }
        const dolphinBody = marine.group.children.find(item => item.name === '海豚身体');
        const dolphinTail = marine.group.children.find(item => item.name === '海豚尾鳍');
        for (let member = 0; member < dolphinBody.count; member++) {
          dolphinBody.getMatrixAt(member, matrix);
          const length = new THREE.Vector3().setFromMatrixScale(matrix).z;
          assert.ok(length >= 5.3 && length <= 5.8, '跃水海豚的完整身体放大两倍，提高远景辨识度');
          const pixels = [];
          for (const mesh of [dolphinBody, dolphinTail]) {
            mesh.getMatrixAt(member, matrix); const points = mesh.geometry.attributes.position;
            for (let index = 0; index < points.count; index++) {
              world.fromBufferAttribute(points, index).applyMatrix4(matrix);
              assert.ok(heightAt(world.x, world.z) < -8);
              if (world.y > .15) {
                const projected = world.clone().project(camera);
                assert.ok(Math.abs(projected.x) < .94 && projected.y > -.8 && projected.y < .65);
                pixels.push((projected.x + 1) * width * .5);
              }
            }
          }
          if (pixels.length) dolphinWidth = Math.max(dolphinWidth, Math.max(...pixels) - Math.min(...pixels));
        }
      }
      if (frame >= 11 * 60 && frame <= 15 * 60) {
        const points = marine.group.children.find(item => item.isPoints);
        const position = points.geometry.attributes.position, alpha = points.geometry.attributes.aAlpha;
        let plume = false;
        for (let index = 0; index < alpha.count; index++) if (alpha.getX(index) > 0) {
          assert.ok([position.getX(index), position.getY(index), position.getZ(index)].every(Number.isFinite));
          sprayPeak = Math.max(sprayPeak, position.getY(index));
          if (position.getY(index) > 2 && alpha.getX(index) > .04) plume = true;
        }
        if (plume) sprayDuration += 1 / 60;
      }
    }
    assert.equal(events.filter(event => event.type === 'dolphin').length, 3);
    assert.equal(events.filter(event => event.type === 'whale-blow').length, 1);
    assert.equal(events.filter(event => event.type === 'splash').length, 4);
    assert.equal(events.filter(event => event.type === 'flying-fish').length, 0);
    assert.equal(new Set(events.filter(event => event.type === 'dolphin').map(event => event.position.x)).size, 3);
    for (const event of events) {
      assert.ok(event.position.isVector3 && event.position.toArray().every(Number.isFinite));
      assert.ok(heightAt(event.position.x, event.position.z) < -5);
      assert.ok(Math.hypot(event.position.x, event.position.z) >= 170);
      assert.ok(camera.position.distanceTo(event.position) >= 175 && camera.position.distanceTo(event.position) <= 465);
      const projected = event.position.clone().project(camera);
      assert.ok(Math.abs(projected.x) > .3 && Math.abs(projected.x) < .87);
      assert.ok(projected.y > -.8 && projected.y < .65);
    }
    assert.ok(whaleLength >= 22 && whaleLength <= 28, '鲸鱼的真实几何长度应在22至28米');
    assert.ok(whaleWidth >= (width < 760 ? 28 : 45), '露出的宽背应形成清楚的像素轮廓');
    assert.ok(dolphinWidth >= (width < 760 ? 20 : 18), '放大的跃水海豚应形成更清楚的身体和尾鳍轮廓');
    assert.ok(visibleBack >= 5 && visibleBack <= 9, '至少五秒能明确看到宽背，随后自然下潜');
    assert.ok(sprayPeak >= 5 && sprayPeak < 9, '大鲸的喷水高度应与身体尺度匹配');
    assert.ok(sprayDuration > 2, '喷水须有超过两秒可见的喷散阶段');
    const count = events.length; marine.update(30, clear, camera); assert.equal(events.length, count);
    marine.dispose();
  }
});

test('清楚的首个喷水在8至12秒，整次活动固定锚点且事件位置跟随动物', () => {
  const camera = cameraFor(), marine = createMarine(new THREE.Scene(), { heightAt, fishSeed: 42 });
  const events = []; let now = 0; marine.onEvent = event => events.push({ ...event, time: now });
  for (; now <= 12; now += 1 / 60) marine.update(now, clear, camera);
  const blow = events.find(event => event.type === 'whale-blow');
  assert.ok(blow && blow.time >= 8 && blow.time <= 12);
  assert.ok(events.every(event => event.type !== 'dolphin'), '首轮鲸鱼与海豚要错峰');
  const body = marine.group.children.find(item => item.name === '鲸鱼身体'), before = new THREE.Matrix4(), after = new THREE.Matrix4();
  assert.equal(body.count, 1); body.getMatrixAt(0, before);
  camera.position.add(new THREE.Vector3(14, 2, -7)); camera.lookAt(0, 15, 0);
  marine.update(now + 1 / 60, clear, camera); body.getMatrixAt(0, after);
  assert.ok(new THREE.Vector3().setFromMatrixPosition(before).distanceTo(new THREE.Vector3().setFromMatrixPosition(after)) < .3, '改变视角不能把当前鲸鱼拖走');
  assert.ok(blow.position.distanceTo(new THREE.Vector3().setFromMatrixPosition(before)) < 8);
  for (; now <= 30; now += 1 / 60) marine.update(now, clear, camera);
  assert.ok(events.some(event => event.type === 'dolphin' && event.time > 20));
  marine.dispose();
});

test('多种子跨轮鲸豚全身体留在深水镜头内，活动中的成员和锚点连续', () => {
  const matrix = new THREE.Matrix4(), world = new THREE.Vector3(), sight = new THREE.Vector3();
  for (const seed of [0, 42, 77]) for (const [width, height, beach] of [[1280, 900, false], [390, 844, false], [1280, 900, true]]) {
    const camera = cameraFor(width, height, false, beach), timeline = createMarineTimeline(seed);
    const marine = createMarine(new THREE.Scene(), { heightAt, fishSeed: seed, marineSeed: seed });
    for (let frame = 0; frame <= 120 * 4; frame++) {
      const time = frame / 4, previous = new Map(); marine.update(time, clear, camera);
      for (const kind of ['whale', 'dolphin']) {
        const episode = timeline.getEpisode(kind, time);
        if (!episode) continue;
        const body = marine.group.children.find(item => item.name === (kind === 'whale' ? '鲸鱼身体' : '海豚身体'));
        const tail = marine.group.children.find(item => item.name === (kind === 'whale' ? '鲸鱼尾鳍' : '海豚尾鳍'));
        const members = Array.from({ length: episode.count }, (_, index) => index)
          .filter(index => getMarinePose(kind, index, time, undefined, episode).active);
        if (!body.count) continue;
        assert.equal(body.count, members.length);
        for (let instance = 0; instance < body.count; instance++) {
          body.getMatrixAt(instance, matrix);
          previous.set(`${kind}:${episode.cycle}:${members[instance]}`, new THREE.Vector3().setFromMatrixPosition(matrix));
          for (const mesh of [body, tail]) {
            mesh.getMatrixAt(instance, matrix); const points = mesh.geometry.attributes.position;
            for (let vertex = 0; vertex < points.count; vertex++) {
              world.fromBufferAttribute(points, vertex).applyMatrix4(matrix);
              assert.ok(heightAt(world.x, world.z) < -8, `${seed}/${width}/${kind}整只身体须在深水`);
              if (world.y <= .15) continue;
              const projected = world.clone().project(camera);
              assert.ok(Math.abs(projected.x) < .94 && projected.y > -.8 && projected.y < .65);
              if (vertex % 40 === 0) for (let step = 1; step < 32; step++) {
                sight.lerpVectors(camera.position, world, step / 32);
                assert.ok(heightAt(sight.x, sight.z) <= sight.y + .2,
                  `${seed}/${width}/${beach}/${kind}/周期${episode.cycle}/${time}秒，身体${world.toArray()}，视线${sight.toArray()}，地面${heightAt(sight.x, sight.z)}不能被岛遮挡`);
              }
            }
          }
        }
      }
      marine.update(time + 1 / 60, clear, camera);
      for (const kind of ['whale', 'dolphin']) {
        const episode = timeline.getEpisode(kind, time + 1 / 60); if (!episode) continue;
        const body = marine.group.children.find(item => item.name === (kind === 'whale' ? '鲸鱼身体' : '海豚身体'));
        const members = Array.from({ length: episode.count }, (_, index) => index)
          .filter(index => getMarinePose(kind, index, time + 1 / 60, undefined, episode).active);
        for (let instance = 0; instance < body.count; instance++) {
          const before = previous.get(`${kind}:${episode.cycle}:${members[instance]}`);
          if (!before) continue;
          body.getMatrixAt(instance, matrix);
          assert.ok(before.distanceTo(new THREE.Vector3().setFromMatrixPosition(matrix)) < .3,
            '同一活动中的同一成员不能逐帧移动锚点或瞬移');
        }
      }
    }
    marine.dispose();
  }
});

test('浅海及被岛挡住的窄海岸视角不拉近大动物，夜间雷暴及全陆地不触发活动', () => {
  for (const scenario of [
    { camera: cameraFor(634, 768, true), env: clear, bed: heightAt },
    { camera: cameraFor(390, 844, false, true), env: clear, bed: heightAt },
    { camera: cameraFor(), env: { daylight: 0 }, bed: heightAt },
    { camera: cameraFor(), env: { daylight: 1, storm: 1 }, bed: heightAt },
    { camera: cameraFor(), env: clear, bed: () => 4 },
  ]) {
    const marine = createMarine(new THREE.Scene(), { heightAt: scenario.bed, fishSeed: 42 });
    const events = []; marine.onEvent = event => events.push(event);
    for (let frame = 0; frame <= 31 * 10; frame++) marine.update(frame / 10, scenario.env, scenario.camera);
    assert.deepEqual(events, []);
    marine.dispose();
  }
});

test('共享几何及材质只释放一次，销毁后从场景移除且更新不再触发事件', () => {
  const scene = new THREE.Scene(), marine = createMarine(scene, { heightAt, fishSeed: 42 });
  const geometries = new Set(), materials = new Set(), disposals = new Map();
  marine.group.traverse(item => {
    if (item.geometry) geometries.add(item.geometry);
    if (item.material) materials.add(item.material);
  });
  for (const resource of [...geometries, ...materials]) {
    disposals.set(resource, 0);
    resource.addEventListener('dispose', () => disposals.set(resource, disposals.get(resource) + 1));
  }
  marine.dispose(); marine.dispose(); marine.update(20, clear, cameraFor());
  assert.equal(scene.children.length, 0); assert.equal(marine.group.children.length, 0);
  assert.ok([...disposals.values()].every(count => count === 1));
  assert.equal(marine.onEvent, null);
});

test('远海鲸豚跨周期变化数量和位置，首次分开出现且低质量仍可观察', () => {
  for (const seed of [0, 42, 77]) {
    const marine = createMarine(new THREE.Scene(), { heightAt, fishSeed: seed, marineSeed: seed });
    const camera = cameraFor(), events = [];
    marine.onEvent = event => events.push(event);
    for (let frame = 0; frame <= 180 * 12; frame++) marine.update(frame / 12, clear, camera);
    const blows = events.filter(event => event.type === 'whale-blow');
    const leaps = events.filter(event => event.type === 'dolphin');
    assert.ok(blows.length >= 5, '三分钟应看见至少五次远海鲸喷');
    assert.ok(leaps.length > 10);
    assert.ok(leaps[0].time > blows[0].time + 8, '首轮海豚须等巨鲸潜下后出现');
    const groups = new Map();
    for (const event of leaps) {
      const members = groups.get(event.cycle) ?? []; members.push(event); groups.set(event.cycle, members);
    }
    assert.ok(new Set([...groups.values()].map(group => group.length)).size >= 3, '每次不能总是相同数量的海豚');
    const positions = [...groups.values()].map(group => group[0].position);
    assert.ok(positions.some(position => position.distanceTo(positions[0]) > 20), '各轮须更换远海活动区域');
    for (const group of groups.values()) for (const member of group) {
      assert.ok(member.position.distanceTo(group[0].position) < 30, '同一次海豚应在相邻海域形成小群');
    }
    for (const event of events) {
      assert.ok(heightAt(event.position.x, event.position.z) < -8);
      const projected = event.position.clone().project(camera);
      assert.ok(Math.abs(projected.x) < .9 && projected.y > -.8 && projected.y < .65);
    }
    marine.dispose();

    const low = createMarine(new THREE.Scene(), { heightAt, fishSeed: seed, marineSeed: seed });
    const lowEvents = []; low.onEvent = event => lowEvents.push(event); low.setQuality('low');
    for (let frame = 0; frame <= 180 * 12; frame++) {
      low.update(frame / 12, clear, camera);
      assert.ok(low.group.children.find(item => item.name === '海豚身体').count <= 2);
    }
    const lowGroups = new Map();
    for (const event of lowEvents.filter(event => event.type === 'dolphin')) lowGroups.set(event.cycle, (lowGroups.get(event.cycle) ?? 0) + 1);
    assert.ok(lowEvents.some(event => event.type === 'whale-blow'));
    assert.ok(new Set(lowGroups.values()).has(1) && new Set(lowGroups.values()).has(2));
    low.dispose();
  }
});

test('明亮月夜仍偶尔出现鲸豚，后台恢复不会重放旧群体的声音', () => {
  const marine = createMarine(new THREE.Scene(), { heightAt, fishSeed: 42, marineSeed: 42 });
  const events = [], camera = cameraFor(), moon = { ...clear, daylight: 0, moonLight: 1 };
  marine.onEvent = event => events.push(event);
  for (let frame = 0; frame <= 180 * 10; frame++) marine.update(frame / 10, moon, camera);
  assert.ok(events.some(event => event.type === 'whale-blow'));
  assert.ok(events.some(event => event.type === 'dolphin'));
  const count = events.length; marine.update(360, moon, camera);
  assert.ok(events.slice(count).every(event => event.time > 359));
  marine.dispose();
});

test('空间声音位置来自当前活动成员，后台中途恢复不凭空出水', () => {
  const marine = createMarine(new THREE.Scene(), { heightAt, fishSeed: 77, marineSeed: 77 });
  const camera = cameraFor(), timeline = createMarineTimeline(77), matrix = new THREE.Matrix4();
  let now = 0, sounds = 0;
  marine.onEvent = event => {
    const episode = timeline.getEpisode(event.kind, now);
    const members = Array.from({ length: episode.count }, (_, index) => index)
      .filter(index => getMarinePose(event.kind, index, now, undefined, episode).active);
    const mesh = marine.group.children.find(item => item.name === (event.kind === 'whale' ? '鲸鱼身体' : '海豚身体'));
    const instance = members.indexOf(event.index);
    assert.ok(instance >= 0 && instance < mesh.count, '有声音时必须正在渲染同一成员');
    mesh.getMatrixAt(instance, matrix);
    const body = new THREE.Vector3().setFromMatrixPosition(matrix);
    assert.ok(event.position.distanceTo(body) < (event.kind === 'whale' ? 8 : .3), '音源不能使用前一轮锚点');
    sounds++;
  };
  for (; now <= 120; now += 1 / 60) marine.update(now, clear, camera);
  assert.ok(sounds > 20);
  marine.dispose();

  const resumed = createMarine(new THREE.Scene(), { heightAt, fishSeed: 77, marineSeed: 77 });
  const episode = createMarineTimeline(77).getEpisode('dolphin', 30), events = [];
  resumed.onEvent = event => events.push(event); resumed.update(0, clear, camera);
  resumed.update(episode.start + 1.5, clear, camera);
  assert.equal(resumed.group.children.find(item => item.name === '海豚身体').count, 0,
    '后台错过入水阶段后不能在半空突然生成海豚');
  assert.deepEqual(events, []);
  resumed.dispose();
});

test('活动中转向相机背面会结束当前鲸轮并停止不可见音效，锚点不会重新贴到镜头', () => {
  const marine = createMarine(new THREE.Scene(), { heightAt, fishSeed: 42, marineSeed: 42 });
  const camera = cameraFor(), events = []; marine.onEvent = event => events.push(event);
  for (let frame = 0; frame <= 10 * 60; frame++) marine.update(frame / 60, clear, camera);
  camera.lookAt(400, 68, 500);
  for (let frame = 10 * 60 + 1; frame <= 13 * 60; frame++) marine.update(frame / 60, clear, camera);
  assert.equal(marine.group.children.find(item => item.name === '鲸鱼身体').count, 0);
  assert.deepEqual(events, [], '相机背后的鲸喷不能继续触发空间音效');
  camera.lookAt(0, 15, 0);
  marine.update(13 + 1 / 60, clear, camera);
  assert.equal(marine.group.children.find(item => item.name === '鲸鱼身体').count, 0, '失去视线后不能在本轮中途突然重现');
  marine.dispose();
});

test('已开始的鲸轮后台恢复跳过旧鲸喷，低帧率海豚音源仍跟随当帧身体', () => {
  const timeline = createMarineTimeline(42), first = timeline.getEpisode('whale', 12);
  const marine = createMarine(new THREE.Scene(), { heightAt, fishSeed: 42, marineSeed: 42 }), camera = cameraFor(), events = [];
  marine.onEvent = event => events.push(event);
  for (let time = 0; time <= 9; time += .1) marine.update(time, clear, camera);
  marine.update(first.start + first.duration * .29 + .5, clear, camera);
  assert.deepEqual(events, [], '后台长帧不能补发前0.5秒的旧鲸喷');
  assert.equal(marine.group.children.find(item => item.name === '鲸鱼身体').count, 0);
  marine.dispose();

  const dolphinEpisode = createMarineTimeline(77).getEpisode('dolphin', 30);
  const dolphin = createMarine(new THREE.Scene(), { heightAt, fishSeed: 77, marineSeed: 77 }), matrix = new THREE.Matrix4();
  const dolphinEvents = []; dolphin.onEvent = event => dolphinEvents.push(event);
  for (let time = 0; time < dolphinEpisode.start; time += .1) dolphin.update(time, clear, camera);
  dolphin.update(dolphinEpisode.start + .1, clear, camera);
  dolphin.update(dolphinEpisode.start + .6, clear, camera);
  const sound = dolphinEvents.find(event => event.type === 'dolphin');
  assert.ok(sound);
  dolphin.group.children.find(item => item.name === '海豚身体').getMatrixAt(0, matrix);
  assert.ok(sound.position.distanceTo(new THREE.Vector3().setFromMatrixPosition(matrix)) < .05,
    '音源应使用当前渲染姿态，不能落后0.264秒的跃水位置');
  dolphin.dispose();
});
