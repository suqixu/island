import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../src/draggable-panel.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});

// Layout and pointer capture are browser APIs; events use the real EventTarget.
function fixture() {
  const viewport = new EventTarget();
  viewport.innerWidth = 1000;
  viewport.innerHeight = 800;
  const bounds = { left: 0, top: 98, right: 1000, bottom: 762 };
  const classes = new Set();
  const panel = {
    style: {}, inert: false, offsetWidth: 280, offsetHeight: 500,
    offsetParent: { getBoundingClientRect: () => bounds },
    get offsetLeft() { return this.style.left === undefined ? 685 : parseFloat(this.style.left); },
    get offsetTop() { return this.style.top === undefined ? 24 : parseFloat(this.style.top); },
    classList: {
      contains: name => classes.has(name),
      add: name => classes.add(name),
      remove: name => classes.delete(name),
    },
  };
  const captures = new Set();
  const handle = new EventTarget();
  handle.setPointerCapture = id => captures.add(id);
  handle.hasPointerCapture = id => captures.has(id);
  handle.releasePointerCapture = id => captures.delete(id);
  const headerTarget = { closest: () => null };
  function pointer(type, { target = headerTarget, ...values } = {}) {
    const event = new Event(type, { cancelable: true, bubbles: true });
    Object.assign(event, { pointerId: 1, pointerType: 'mouse', button: 0, isPrimary: true, clientX: 700, clientY: 140, ...values });
    Object.defineProperty(event, 'target', { value: target });
    handle.dispatchEvent(event);
    return event;
  }
  function create() {
    assert.ok(module?.createDraggablePanel, '设置面板需要可清理的拖动控制器');
    return module.createDraggablePanel(panel, handle, { viewport });
  }
  return { viewport, bounds, panel, handle, captures, pointer, create };
}

test('从头部拖动改变面板位置并截断事件，保留收起动画使用的 transform', () => {
  const f = fixture();
  f.panel.style.transform = 'translateX(345px)';
  f.create();
  const down = f.pointer('pointerdown');
  const move = f.pointer('pointermove', { clientX: 500, clientY: 190 });
  assert.equal(f.panel.style.left, '485px');
  assert.equal(f.panel.style.top, '74px');
  assert.equal(f.panel.style.right, 'auto');
  assert.equal(f.panel.style.transform, 'translateX(345px)');
  assert.equal(down.defaultPrevented, true);
  assert.equal(down.cancelBubble, true);
  assert.equal(move.cancelBubble, true);
  assert.equal(f.captures.has(1), true);
  f.pointer('pointerup');
  assert.equal(f.captures.size, 0);
  assert.equal(f.panel.classList.contains('dragging'), false);
});

test('面板拖到任意边缘均完整保留在场景与视口内', () => {
  const f = fixture();
  f.create();
  f.pointer('pointerdown');
  f.pointer('pointermove', { clientX: -1000, clientY: -1000 });
  assert.equal(f.panel.style.left, '0px');
  assert.equal(f.panel.style.top, '0px');
  f.pointer('pointermove', { clientX: 5000, clientY: 5000 });
  assert.equal(f.panel.style.left, '720px');
  assert.equal(f.panel.style.top, '164px');
});

test('关闭按钮及其他交互控件、非主指针和鼠标右键不启动拖动', () => {
  const f = fixture();
  f.create();
  const closeButton = { closest: () => ({}) };
  for (const values of [{ target: closeButton }, { isPrimary: false }, { button: 2 }]) {
    const down = f.pointer('pointerdown', values);
    f.pointer('pointermove', { clientX: 300 });
    assert.equal(f.panel.style.left, undefined);
    assert.equal(down.defaultPrevented, false);
    assert.equal(f.captures.size, 0);
  }
});

test('触屏拖动只追踪开始的指针，取消后不再移动', () => {
  const f = fixture();
  f.create();
  f.pointer('pointerdown', { pointerType: 'touch', pointerId: 7 });
  f.pointer('pointermove', { pointerId: 8, clientX: 300 });
  assert.equal(f.panel.style.left, '685px');
  f.pointer('pointermove', { pointerId: 7, clientX: 600, clientY: 150 });
  assert.equal(f.panel.style.left, '585px');
  f.pointer('pointercancel', { pointerId: 7 });
  f.pointer('pointermove', { pointerId: 7, clientX: 300 });
  assert.equal(f.panel.style.left, '585px');
  assert.equal(f.captures.size, 0);
});

test('关闭重新打开保留拖动位置，视口缩小后重新限制位置', () => {
  const f = fixture();
  f.create();
  f.pointer('pointerdown');
  f.pointer('pointermove', { clientX: 650, clientY: 220 });
  f.pointer('pointerup');
  f.panel.classList.add('closed');
  f.panel.inert = true;
  f.pointer('pointerdown');
  f.pointer('pointermove', { clientX: 300 });
  assert.equal(f.panel.style.left, '635px');
  f.viewport.innerWidth = 600;
  f.viewport.innerHeight = 650;
  f.bounds.right = 600;
  f.bounds.bottom = 612;
  f.viewport.dispatchEvent(new Event('resize'));
  assert.equal(f.panel.style.left, '320px');
  assert.equal(f.panel.style.top, '14px');
  f.panel.classList.remove('closed');
  f.panel.inert = false;
  assert.equal(f.panel.style.left, '320px');
});

test('页面失焦、捕获丢失和重复清理均结束拖动，清理后全部事件失效', () => {
  const f = fixture();
  const drag = f.create();
  f.pointer('pointerdown');
  f.viewport.dispatchEvent(new Event('blur'));
  f.pointer('pointermove', { clientX: 300 });
  assert.equal(f.panel.style.left, '685px');
  f.pointer('pointerdown');
  f.pointer('lostpointercapture');
  f.pointer('pointermove', { clientX: 300 });
  assert.equal(f.panel.style.left, '685px');
  f.pointer('pointerdown');
  drag.dispose();
  drag.dispose();
  assert.equal(f.captures.size, 0);
  assert.equal(f.panel.classList.contains('dragging'), false);
  f.pointer('pointerdown');
  f.pointer('pointermove', { clientX: 300 });
  f.viewport.innerWidth = 400;
  f.bounds.right = 400;
  f.viewport.dispatchEvent(new Event('resize'));
  assert.equal(f.panel.style.left, '685px');
});
