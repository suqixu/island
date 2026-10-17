import * as THREE from 'three';
import { getAnimationDelta } from './animation-time.js';
import { TTFLoader } from 'three/addons/loaders/TTFLoader.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { SPRING_RIVER_POEM } from './poem-text.js';
import { getPoemCue, getGlyphMotion, POEM_CUE_DURATION } from './poem-motion.js';
import { getPoemVisibility } from './poem-visibility.js';

export async function loadPoetryFont() {
  const url = new URL('./assets/poetry-calligraphy.ttf', import.meta.url).href;
  const [data] = await Promise.all([
    new TTFLoader().loadAsync(url),
    document.fonts?.load('88px "Isola Calligraphy"', '春江花月夜').catch(() => {}),
  ]);
  return new FontLoader().parse(data);
}

function createGlyphGeometry(character, font) {
  const geometry = new TextGeometry(character, {
    font, size: 1, depth: .08, curveSegments: 3, steps: 1,
    bevelEnabled: true, bevelThickness: .006, bevelSize: .004, bevelSegments: 1,
  });
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const scale = 1 / Math.max(size.x, size.y, .001);
  geometry.scale(scale, scale, 1);
  geometry.center();

  // TextGeometry emits a cap/side pair for every disconnected brush stroke.
  // Put all caps first and sides second, keeping each letter at two draw calls.
  const groups = [...geometry.groups].sort((a, b) => a.materialIndex - b.materialIndex);
  const capCount = groups.filter(group => group.materialIndex === 0).reduce((total, group) => total + group.count, 0);
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const array = new attribute.array.constructor(attribute.array.length);
    let cursor = 0;
    for (const group of groups) {
      const start = group.start * attribute.itemSize, length = group.count * attribute.itemSize;
      array.set(attribute.array.subarray(start, start + length), cursor);
      cursor += length;
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize, attribute.normalized));
  }
  geometry.clearGroups();
  geometry.addGroup(0, capCount, 0);
  geometry.addGroup(capCount, geometry.attributes.position.count - capCount, 1);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Extruded brush strokes float in a clear patch of sky beside the moon. */
export function createPoetry(scene, camera, { font, onCueChange = () => {}, onComplete = () => {}, getFocusDistance = () => 300 } = {}) {
  if (!font?.isFont) throw new TypeError('诗意字幕需要已加载的书法字体');
  const poem = SPRING_RIVER_POEM;
  const introduction = [poem.title, `${poem.dynasty} ${poem.author}`];
  const couplets = [];
  for (let index = 0; index < poem.lines.length; index += 2) couplets.push(poem.lines.slice(index, index + 2));
  const characters = [...new Set([...introduction, ...poem.lines].join(''))];
  const missing = characters.filter(character => character.trim() && !font.data.glyphs[character]);
  if (missing.length) throw new Error(`书法字体缺少字形：${missing.join('')}`);
  const group = new THREE.Group();
  group.name = '春江花月夜 · 流动诗句';
  scene.add(group);
  const cache = new Map(), emptyGeometry = new THREE.BufferGeometry();
  const maxLetters = Math.max(...[introduction, ...couplets].map(lines => lines.join('').length));
  const letters = Array.from({ length: maxLetters }, () => {
    const front = new THREE.MeshStandardMaterial({
      color: '#ffe6a4', emissive: '#f2cd7f', emissiveIntensity: .72,
      roughness: .48, metalness: .12, transparent: true, opacity: 0,
      depthWrite: false, depthTest: true, fog: true, toneMapped: false,
    });
    const side = new THREE.MeshStandardMaterial({
      color: '#986322', emissive: '#996727', emissiveIntensity: .24,
      roughness: .6, metalness: .2, transparent: true, opacity: 0,
      depthWrite: false, depthTest: true, fog: true, toneMapped: false,
    });
    const mesh = new THREE.Mesh(emptyGeometry, [front, side]);
    mesh.renderOrder = 15;
    mesh.visible = false;
    group.add(mesh);
    return { mesh, origin: new THREE.Vector3(), column: 0, row: 0, offsetX: 0, offsetY: 0, used: false };
  });
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = reducedMotionQuery.matches;
  const onMotionPreference = event => { reducedMotion = event.matches; };
  reducedMotionQuery.addEventListener('change', onMotionPreference);
  const forward = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const anchor = new THREE.Vector3(), cueQuaternion = new THREE.Quaternion(), cameraQuaternion = new THREE.Quaternion();
  const horizonPoint = new THREE.Vector3();
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(10));
  const spin = new THREE.Quaternion(), spinAxis = new THREE.Vector3(0, 0, 1);
  const glyphMotion = {};
  let enabled = true, elapsed = 0, lastTime = null, activeKey = null, currentVariant = 0, completed = false;
  let letterHeight = 1, moonVisibility = 0, disposed = false, currentCaption = '', activeLines = [], maxCueColumns = 1;

  function setCaption(text) {
    if (text === currentCaption) return;
    currentCaption = text;
    onCueChange(text);
  }

  function geometryFor(character) {
    let geometry = cache.get(character);
    if (geometry) cache.delete(character);
    else geometry = createGlyphGeometry(character, font);
    cache.set(character, geometry);
    return geometry;
  }

  function frameSky() {
    camera.getWorldDirection(forward);
    camera.getWorldQuaternion(cameraQuaternion);
    right.set(1, 0, 0).applyQuaternion(cameraQuaternion);
    up.set(0, 1, 0).applyQuaternion(cameraQuaternion);
    cueQuaternion.copy(cameraQuaternion).multiply(tilt);
    const depth = THREE.MathUtils.clamp(getFocusDistance() * .42, 8, 110);
    const viewHeight = 2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV() / 2));
    const mobile = innerWidth < 760;
    const skyTop = Math.max(innerHeight * .13, mobile ? 110 : 124);
    camera.getWorldPosition(anchor);
    horizonPoint.copy(forward).setY(0);
    if (horizonPoint.lengthSq() < .0001) horizonPoint.set(0, 0, -1);
    horizonPoint.normalize().multiplyScalar(10000).add(anchor).project(camera);
    const horizonPixels = (1 - horizonPoint.y) * innerHeight * .5;
    const skyBottom = Math.min(innerHeight * .40, horizonPixels - 20);
    if (skyBottom - skyTop < 56) return false;
    const maxCount = maxCueColumns;
    // Short landscape windows use two horizontal lines to keep the strokes readable.
    const horizontal = skyBottom - skyTop < 150;
    const span = horizontal ? 2.4 : (maxCount - 1) * 1.08 + 1;
    const textPixels = Math.max(16, Math.min(mobile ? 28 : 32,
      (skyBottom - skyTop) / span, horizontal ? innerWidth * .40 / ((maxCount - 1) * 1.12 + 1) : Infinity));
    letterHeight = viewHeight * textPixels / innerHeight;
    anchor.addScaledVector(forward, depth)
      .addScaledVector(right, viewHeight * camera.aspect * (.285 - .5))
      .addScaledVector(up, viewHeight * (.5 - (skyTop + skyBottom) / (2 * innerHeight)));
    for (const letter of letters) {
      if (!letter.used) continue;
      const count = activeLines[letter.row].length;
      letter.offsetX = horizontal ? (letter.column - (count - 1) / 2) * 1.12 : (.5 - letter.row) * 1.25;
      letter.offsetY = horizontal ? (.5 - letter.row) * 1.35 : ((count - 1) / 2 - letter.column) * 1.08;
      letter.origin.copy(anchor).addScaledVector(right, letter.offsetX * letterHeight).addScaledVector(up, letter.offsetY * letterHeight);
    }
    return true;
  }

  function placeCue(lines, index) {
    activeLines = lines.map(line => Array.from(line).filter(character => !/[，。？！、；：·]/u.test(character)));
    maxCueColumns = Math.max(1, ...activeLines.map(line => line.length));
    const activeCharacters = new Set(activeLines.flat());
    let cursor = 0;
    activeLines.forEach((glyphs, row) => {
      glyphs.forEach((character, column) => {
        if (!character.trim()) return;
        const letter = letters[cursor++];
        letter.used = true;
        letter.column = column;
        letter.row = row;
        letter.mesh.name = character;
        letter.mesh.geometry = geometryFor(character);
      });
    });
    for (; cursor < letters.length; cursor++) {
      letters[cursor].used = false;
      letters[cursor].mesh.geometry = emptyGeometry;
    }
    // Retain recently used strokes without keeping all 150+ complex glyphs resident.
    for (const [character, geometry] of cache) {
      if (cache.size <= 48) break;
      if (activeCharacters.has(character)) continue;
      cache.delete(character);
      geometry.dispose();
    }
    currentVariant = index < 0 ? 0 : index % 3;
    setCaption(`${poem.title}，${poem.dynasty} ${poem.author}。${lines.join('')}`);
  }

  function update(time, env = {}, cameraMoving = false) {
    if (disposed) return;
    const dt = lastTime === null ? 0 : getAnimationDelta(time - lastTime, .2, env);
    lastTime = time;
    group.visible = enabled && !cameraMoving && !env.poetrySuppressed;
    // Keep tracking moonlight while the user hides the poem or changes views.
    const targetVisibility = getPoemVisibility(env);
    if (env.moonInFrame !== true || env.moonIllumination < .99) {
      group.visible = false; activeKey = null; setCaption('');
      moonVisibility = 0;
      // 暂停当前诗联，日出后的重置逻辑仍在下面处理。
      if (!(env.hour >= 6 && env.hour < 18)) return;
    }
    moonVisibility = THREE.MathUtils.lerp(moonVisibility, targetVisibility, 1 - Math.exp(-dt * 3.5));
    // 云雾暂时遮月只暂停诗句；经过白天才开始下一轮月夜。
    if (env.hour >= 6 && env.hour < 18) {
      elapsed = 0;
      completed = false;
      group.visible = false;
      activeKey = null;
      setCaption('');
      return;
    }
    if (completed) {
      group.visible = false;
      setCaption('');
      return;
    }
    if (targetVisibility === 0 && moonVisibility < .003) {
      group.visible = false;
      setCaption('');
      activeKey = null;
      return;
    }
    if (!enabled || cameraMoving || env.poetrySuppressed) {
      if (cameraMoving || env.poetrySuppressed) activeKey = null;
      if (env.poetrySuppressed) setCaption('');
      return;
    }
    if (targetVisibility > 0) elapsed += dt;
    if (elapsed >= 5 + couplets.length * POEM_CUE_DURATION) {
      completed = true;
      group.visible = false;
      setCaption('');
      onComplete();
      return;
    }
    const intro = elapsed < 5;
    const cue = intro ? { index: -1, age: elapsed * 2 } : getPoemCue(elapsed - 5, couplets.length);
    if (cue.index !== activeKey) {
      activeKey = cue.index;
      placeCue(intro ? introduction : couplets[cue.index], cue.index);
    }
    if (!frameSky()) { group.visible = false; return; }
    const weatherOpacity = 1 - (env.fog ?? 0) * .3 - (env.rain ?? 0) * .12;
    for (let index = 0; index < letters.length; index++) {
      const letter = letters[index];
      if (!letter.used) { letter.mesh.visible = false; continue; }
      const motion = getGlyphMotion(cue.age, letter.column, letter.row, currentVariant, reducedMotion, glyphMotion);
      const float = reducedMotion ? 0 : Math.sin(time * .55 + index * .28) * .015;
      letter.mesh.position.copy(letter.origin)
        .addScaledVector(right, motion.drift * letterHeight)
        .addScaledVector(up, (motion.lift + float) * letterHeight)
        .addScaledVector(forward, motion.depth * letterHeight);
      letter.mesh.quaternion.copy(cueQuaternion).multiply(spin.setFromAxisAngle(spinAxis, motion.rotation));
      letter.mesh.scale.setScalar(letterHeight * motion.scale);
      const opacity = motion.opacity * weatherOpacity * moonVisibility;
      for (const material of letter.mesh.material) material.opacity = opacity;
      letter.mesh.visible = opacity > .003;
    }
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    group.visible = enabled;
    if (enabled) activeKey = null;
  }

  function restart() {
    elapsed = 0;
    completed = false;
    activeKey = null;
    letters.forEach(letter => { letter.mesh.visible = false; });
  }

  function reframe() { activeKey = null; }

  function dispose() {
    if (disposed) return;
    disposed = true;
    reducedMotionQuery.removeEventListener('change', onMotionPreference);
    letters.forEach(({ mesh }) => { for (const material of mesh.material) material.dispose(); });
    for (const geometry of cache.values()) geometry.dispose();
    cache.clear();
    emptyGeometry.dispose();
    scene.remove(group);
  }

  return { update, setEnabled, restart, reframe, dispose,
    get enabled() { return enabled; }, get active() { return enabled && group.visible && moonVisibility > .05; } };
}
