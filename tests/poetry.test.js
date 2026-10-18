import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { TTFLoader } from 'three/addons/loaders/TTFLoader.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { createPoetry } from '../src/poetry.js';
import { createSimulation, getEnvironment, advanceSimulation } from '../src/simulation.js';
import * as simulation from '../src/simulation.js';
import { SPRING_RIVER_POEM } from '../src/poem-text.js';
import { getMoonBackdropDirection } from '../src/moon-framing.js';

const bytes = readFileSync(new URL('../src/assets/fonts/poetry-calligraphy.ttf', import.meta.url));
const font = new FontLoader().parse(new TTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
const night = getEnvironment(createSimulation({ hour: 0 }));
const noon = getEnvironment(createSimulation({ hour: 12 }));
const materials = letter => Array.isArray(letter.material) ? letter.material : [letter.material];

test('工具栏诗与禅都有真实书法字形，不会退回系统字体', () => {
  for (const character of ['诗', '禅']) assert.ok(font.data.glyphs[character]?.o?.length > 0, character);
});

function withPoetry(run, { width = 1280, height = 900, moonView = false, onComplete = () => {} } = {}) {
  const platform = {
    innerWidth: width,
    innerHeight: height,
    window: { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
  };
  const previous = new Map(Object.keys(platform).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, platform);
  let poetry;
  try {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(moonView ? 66 : 46, width / height, .5, 7000);
    const focus = new THREE.Vector3(...(moonView ? [0, 65, 0] : [0, 15, 0]));
    camera.position.set(...(moonView ? [150, 24, 200] : [160, 68, 200]));
    camera.lookAt(focus);
    camera.updateMatrixWorld();
    let caption = '', time = 0;
    const captions = [];
    poetry = createPoetry(scene, camera, { font, onComplete, getFocusDistance: () => camera.position.distanceTo(focus), onCueChange: text => { caption = text; captions.push(text); } });
    const group = scene.children.find(child => child.name === '春江花月夜 · 流动诗句');
    poetry.update(time, night);
    const advance = (seconds, env = night) => {
      for (let step = 0; step < seconds * 10; step++) {
        time += .1;
        poetry.update(time, {moonInFrame:true,...env});
      }
    };
    run({ poetry, group, camera, scene, advance, captions, getCaption: () => caption });
  } finally {
    poetry?.dispose();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test('完整十八联只出现一遍，末联淡出后通知结束；云层遮月和开关不重播', () => {
  let completed = 0;
  withPoetry(({ poetry, group, advance, captions, getCaption }) => {
    advance(179);
    assert.equal(completed, 0);
    assert.ok(getCaption().includes('落月摇情满江树'));
    advance(7);
    assert.equal(completed, 1);
    assert.equal(group.visible, false);
    const expected = [];
    for (let i = 0; i < SPRING_RIVER_POEM.lines.length; i += 2) expected.push(SPRING_RIVER_POEM.lines.slice(i, i + 2).join(''));
    assert.deepEqual(captions.filter(c => expected.some(line => c.endsWith(line))).map(c => expected.find(line => c.endsWith(line))), expected);
    advance(5, { ...night, moonDiscOpacity: 0 });
    poetry.setEnabled(false);poetry.setEnabled(true);advance(15);
    assert.equal(completed, 1);assert.equal(getCaption(), '');
    advance(.1, { ...night, hour: 6, moonDiscOpacity: 0, moonLight: 0 });
    assert.equal(getCaption(), '', '进入黎明时不能闪现开场标题');
    advance(2, noon);advance(10);
    assert.ok(getCaption().includes('春江潮水连海平'));
  }, { moonView: true, onComplete: () => completed++ });
});

test('半速整首诗结束后平滑进入黎明，暂停不会推进且倍率保持不变', () => {
  const state = createSimulation({ hour: 1.2, autoWeather: false });
  assert.equal(typeof simulation.finishMoonNight, 'function');
  let completed = 0;
  withPoetry(({ advance }) => {
    advance(186);
    assert.equal(completed, 1);
    const hour = state.hour;state.running = false;advanceSimulation(state, 30);
    assert.equal(state.hour, hour);
    state.running = true;advanceSimulation(state, .1);
    assert.ok(state.hour > hour && state.hour < hour + .1, '开头没有跳变');
    advanceSimulation(state, 5.9);
    assert.ok(state.hour > 2 && state.hour < 6);
    advanceSimulation(state, 6);
    assert.ok(Math.abs(state.hour - 6.5) < 1e-8);
    assert.ok(getEnvironment(state).daylight > .45);
    assert.equal(state.speed, .5);
    assert.equal(state.moonNightEnding, null);
  }, { moonView: true, onComplete: () => { completed++;simulation.finishMoonNight(state); } });
});

test('关闭字幕跨过白天后，重新开启仍隐藏，再遇月夜从引言重启', () => {
  withPoetry(({ poetry, group, advance, getCaption }) => {
    advance(10);
    assert.ok(getCaption().includes('春江潮水连海平，海上明月共潮生。'));
    assert.ok(group.visible && group.children.some(letter => letter.visible && materials(letter).some(material => material.opacity > .9)));
    poetry.setEnabled(false);
    advance(40, noon);
    assert.equal(poetry.enabled, false, '昼夜变化不能自动开启用户关闭的字幕');
    poetry.setEnabled(true);
    advance(.1, noon);
    assert.equal(group.visible, false, '白天重新开启不能闪现上一月夜的诗句');
    assert.equal(getCaption(), '', '白天清除已隐藏诗句的辅助文本');
    advance(.1);
    assert.equal(group.visible, true);
    assert.ok(getCaption().includes('春江花月夜') && getCaption().includes('张若虚'));
    assert.ok(!getCaption().includes('春江潮水连海平'), '下一次月夜从引言开始，不能从关闭前的联句继续');
  });
});

test('多云时实际明月可见，真实书法网格继续播放诗句；月盘消失后淡出',()=>{
  withPoetry(({poetry,group,advance,getCaption})=>{
    const cloudyMoon={...getEnvironment(createSimulation({hour:22,weather:'cloudy'})),moonDiscOpacity:.24};
    advance(10,cloudyMoon);
    assert.ok(poetry.active&&group.visible,'多云明月夜应保留动态字幕');
    assert.ok(group.children.some(letter=>letter.visible&&materials(letter)[0].opacity>.1));
    assert.ok(getCaption().includes('春江潮水连海平'));
    advance(4,{...cloudyMoon,moonDiscOpacity:0});
    assert.equal(poetry.active,false);assert.equal(group.visible,false);
    assert.equal(getCaption(),'');
  },{moonView:true});
});

test('引言中唐与张若虚之间留一字空格，不为留白生成空网格', () => {
  withPoetry(({ group, camera, advance, getCaption }) => {
    advance(2);
    const letters = group.children.filter(letter => letter.visible);
    assert.equal(letters.length, 9, '标题五字和朝代作者四字，留白不成为可见网格');
    assert.ok(letters.every(letter => letter.name.trim() && letter.geometry.attributes.position?.count > 0));
    assert.ok(getCaption().includes('唐 张若虚'), '辅助文本保留朝代与作者间的空格');
    const dynasty = letters.find(letter => letter.name === '唐');
    const surname = letters.find(letter => letter.name === '张');
    const next = letters.find(letter => letter.name === '若');
    assert.ok(dynasty && surname && next);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const spaced = dynasty.position.clone().sub(surname.position).dot(up);
    const adjacent = surname.position.clone().sub(next.position).dot(up);
    assert.ok(adjacent > 0 && spaced / adjacent > 1.95 && spaced / adjacent < 2.05, '唐到张的间距约为张到若的两倍');
  }, { moonView: true });
});

test('真实书法字有前面和厚度，首句在右列从上往下读，第二句在左列', () => {
  withPoetry(({ group, camera, advance }) => {
    advance(10);
    const letters = group.children.filter(letter => letter.visible);
    assert.equal(letters.length, 14);
    assert.ok(letters.every(letter => letter.isMesh && !letter.isSprite), '字幕必须由字形网格组成');
    assert.ok(letters.every(letter => /^\p{Script=Han}$/u.test(letter.name)), '画面中的诗句只保留汉字');
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const rightColumn = letters.slice(0, 7), leftColumn = letters.slice(7);
    assert.ok(rightColumn[0].position.dot(right) > leftColumn[0].position.dot(right), '春江一句为右列，海上一句为左列');
    for (const column of [rightColumn, leftColumn]) {
      for (let index = 1; index < column.length; index++) {
        assert.ok(column[index - 1].position.dot(up) > column[index].position.dot(up), '每一列字序从上到下');
        assert.ok(Math.abs(column[index].position.dot(right) - column[0].position.dot(right)) < .02, '同列文字纵向对齐');
      }
    }
    const geometry = letters[0].geometry;
    geometry.computeBoundingBox();
    assert.ok(geometry.boundingBox.max.z - geometry.boundingBox.min.z > .05, '正面与侧面具有真实几何厚度');
    assert.ok(geometry.attributes.normal && geometry.groups.some(group => group.materialIndex === 0) && geometry.groups.some(group => group.materialIndex === 1));
    assert.equal(letters[0].material.length, 2, '正面与侧面分别使用金色材质');
    assert.ok(letters[0].material[0].emissiveIntensity > 0, '书法正面在夜间仍清晰可读');
    assert.ok(letters[5].geometry === letters[7].geometry, '两次出现的海字复用实际字形几何');
  }, { moonView: true });
});

function projectedBounds(letters, camera, width, height) {
  const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  for (const letter of letters) {
    letter.geometry.computeBoundingBox();
    const box = letter.geometry.boundingBox;
    letter.updateWorldMatrix(true, false);
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const point = new THREE.Vector3(x, y, z).applyMatrix4(letter.matrixWorld).project(camera);
          const screenX = (point.x + 1) * width / 2, screenY = (1 - point.y) * height / 2;
          bounds.left = Math.min(bounds.left, screenX);
          bounds.right = Math.max(bounds.right, screenX);
          bounds.top = Math.min(bounds.top, screenY);
          bounds.bottom = Math.max(bounds.bottom, screenY);
        }
      }
    }
  }
  return bounds;
}

for (const [width, height] of [[1280, 900], [390, 844]]) {
  test(`${width}×${height}赏月时，竖排诗句处于左上天空，并与月盘保留间距`, () => {
    withPoetry(({ group, camera, advance, getCaption }) => {
      advance(10);
      const letters = group.children.filter(letter => letter.visible);
      assert.equal(letters.length, 14, '首联为两列各七字，画面不出现标点');
      assert.ok(getCaption().includes('春江潮水连海平，海上明月共潮生。'), '辅助文本保留完整原诗标点');
      const bounds = projectedBounds(letters, camera, width, height);
      assert.ok(bounds.left >= width * .16 && bounds.right <= width * .39, `诗句应位于左侧天空：${JSON.stringify(bounds)}`);
      assert.ok(bounds.top >= 110, `诗句不进入顶部操作栏：${JSON.stringify(bounds)}`);
      assert.ok(bounds.bottom <= height * .42, `整联留在上方天空，不盖住下方海岛：${JSON.stringify(bounds)}`);
      const moonCenter = camera.position.clone().addScaledVector(getMoonBackdropDirection(camera, width), 1900).project(camera);
      const moonCenterX = (moonCenter.x + 1) * width / 2;
      const moonSafeLeft = moonCenterX - Math.min(width * .2, height * .15) * .6;
      assert.ok(bounds.right + 12 < moonSafeLeft, '诗句与月盘之间保留清楚的天空间距');
      const firstColumnX = letters[0].position.clone().project(camera).x;
      const secondColumnX = letters[7].position.clone().project(camera).x;
      assert.ok(firstColumnX > secondColumnX, '天空中的首句仍位于右列');
      letters[0].geometry.computeBoundingBox();
      assert.ok(letters[0].geometry.boundingBox.max.z - letters[0].geometry.boundingBox.min.z > .05, '改动布局后保留真实字形厚度');
    }, { width, height, moonView: true });
  });
}

test('640×480横屏中，首联自动成为天空中的两行无标点汉字，保持可读', () => {
  withPoetry(({ group, camera, advance, getCaption }) => {
    advance(10);
    const letters = group.children.filter(letter => letter.visible);
    assert.equal(letters.length, 14);
    assert.ok(letters.every(letter => /^\p{Script=Han}$/u.test(letter.name)));
    assert.ok(getCaption().includes('春江潮水连海平，海上明月共潮生。'));
    const points = letters.map(letter => letter.position.clone().project(camera));
    assert.ok(points[0].y > points[7].y, '首句在上行，第二句在下行');
    for (const row of [points.slice(0, 7), points.slice(7)]) {
      for (let index = 1; index < row.length; index++) {
        assert.ok(row[index].x > row[index - 1].x, '横屏中每行汉字从左往右阅读');
        assert.ok(Math.abs(row[index].y - row[0].y) * 480 / 2 < 2, '同一行保持水平排版');
      }
    }
    const bounds = projectedBounds(letters, camera, 640, 480);
    assert.ok(bounds.left >= 24 && bounds.right <= 320, `横屏诗句完整留在左侧天空：${JSON.stringify(bounds)}`);
    assert.ok(bounds.top >= 110 && bounds.bottom <= 480 * .42, `横屏诗句避开顶部操作栏和下方海岛：${JSON.stringify(bounds)}`);
    const glyph = projectedBounds([letters[0]], camera, 640, 480);
    assert.ok(glyph.bottom - glyph.top >= 22, '横屏不将汉字压缩成难以辨认的小字');
  }, { width: 640, height: 480, moonView: true });
});

test('缓存的书法几何只释放一次，移除字幕后不残留场景网格', () => {
  withPoetry(({ poetry, group, scene, advance }) => {
    advance(10);
    const geometries = new Set(group.children.map(letter => letter.geometry));
    const disposed = new Map([...geometries].map(geometry => [geometry, 0]));
    for (const geometry of geometries) geometry.addEventListener('dispose', () => disposed.set(geometry, disposed.get(geometry) + 1));
    poetry.dispose();
    poetry.dispose();
    assert.ok(!scene.children.includes(group));
    assert.ok([...disposed.values()].every(count => count === 1), '字形共享时不重复或遗漏释放');
  });
});

test('月盘离开画面或变为其他月相时立即隐藏诗，恢复满月后继续而非重播',()=>{
  withPoetry(({poetry,group,advance,getCaption})=>{
    advance(7,{...night,moonInFrame:true});assert.equal(group.visible,true);const caption=getCaption();
    advance(.1,{...night,moonInFrame:false});assert.equal(group.visible,false);assert.equal(getCaption(),'');
    advance(.1,{...night,moonInFrame:true,moonIllumination:.85});assert.equal(group.visible,false);
    advance(.1,{...night,moonInFrame:true});assert.equal(group.visible,true);assert.equal(getCaption(),caption);
  },{moonView:true});
});
