import assert from 'node:assert/strict';
import test from 'node:test';
import { createUpdateHistory } from '../src/update-history.js';

// Node has no DOM. Model only element boundaries; the view logic runs unchanged.
class Element extends EventTarget {
  constructor(tagName, document) {
    super();
    this.tagName = tagName;
    this.ownerDocument = document;
    this.children = [];
    this.attributes = new Map();
    this.hidden = false;
    this.inert = false;
    this.scrollTop = 0;
    this.style = { height: '', width: '300px' };
    const classes = new Set();
    this.classList = {
      add: value => classes.add(value),
      remove: value => classes.delete(value),
      contains: value => classes.has(value),
    };
  }
  get parentElement() { return this.parentNode; }
  getBoundingClientRect() { return { height: 512, width: 300 }; }
  append(...elements) { for (const element of elements) { element.parentNode = this; this.children.push(element); } }
  prepend(element) { element.parentNode = this; this.children.unshift(element); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  focus() { this.ownerDocument.activeElement = this; }
  click() { this.dispatchEvent(new Event('click')); }
}

function fixture() {
  const document = { createElement(tag) { return new Element(tag, this); } };
  document.body = document.createElement('body');
  const panel = document.createElement('aside');
  const header = document.createElement('header');
  const grip = document.createElement('span');
  const panelClose = document.createElement('button');
  header.append(grip, panelClose);
  const settings = [document.createElement('section'), document.createElement('section')];
  settings[0].value = '保留的设置';
  settings[1].hidden = true;
  settings[1].inert = true;
  panel.append(header, ...settings);
  panel.scrollTop = 125;
  document.body.append(panel);
  return { document, panel, header, settings, grip, panelClose };
}
const walk = element => [element, ...element.children.flatMap(walk)];

// An external modal or omitted hiding would break the same-panel view contract.
test('点击版本在原设置面板内显示更新，头部和设置控件保留原节点', () => {
  const f = fixture();
  const history = createUpdateHistory(f.header);
  const version = f.header.children[1];
  version.click();
  assert.equal(f.document.body.children.length, 1);
  assert.equal(f.panel.children.length, 4);
  const view = f.panel.children[3];
  assert.equal(view.className, 'panel-update-history');
  assert.equal(view.hidden, false);
  assert.equal(version.getAttribute('aria-haspopup'), null);
  assert.equal(version.getAttribute('aria-expanded'), 'true');
  assert.equal(f.header.children[2], f.grip);
  assert.equal(f.header.children[3], f.panelClose);
  assert.equal(f.header.hidden, false);
  assert.equal(f.header.children[0].hidden, false);
  assert.equal(f.header.children[0].getAttribute('aria-label'), '返回设置');
  assert.equal(walk(view).some(element => element.tagName === 'button' || element.tagName === 'h2'), false);
  assert.equal(f.panel.children[1], f.settings[0]);
  assert.equal(f.settings[0].hidden, true);
  assert.equal(f.settings[0].inert, true);
  assert.equal(f.panel.scrollTop, 0);
  assert.equal(f.document.activeElement.tagName, 'button');
  history.dispose();
});

// Restoring booleans to defaults would expose originally hidden settings.
test('版本只进入更新列表，重复点击不退出；仅返回图标恢复设置', () => {
  const f = fixture();
  const history = createUpdateHistory(f.header);
  const version = f.header.children[1];
  for (let cycle = 0; cycle < 2; cycle++) {
    version.click();
    const view = f.panel.children[3];
    f.panel.scrollTop = 360;
    version.click();
    assert.equal(view.hidden, false);
    assert.equal(f.settings[0].hidden, true);
    assert.equal(f.panel.scrollTop, 360);
    assert.equal(f.panel.style.height, '512px');
    f.header.children[0].click();
    assert.equal(view.hidden, true);
    assert.equal(f.header.children[0].hidden, true);
    assert.equal(f.settings[0].hidden, false);
    assert.equal(f.settings[0].inert, false);
    assert.equal(f.settings[1].hidden, true);
    assert.equal(f.settings[1].inert, true);
    assert.equal(f.settings[0].value, '保留的设置');
    assert.equal(f.panel.scrollTop, 125);
    assert.equal(f.document.activeElement, version);
    assert.equal(version.getAttribute('aria-expanded'), 'false');
  }
  history.dispose();
});

// Escape may close the whole panel through its existing handler, but never returns to settings.
test('Esc 不切换更新列表，保留原面板快捷键处理', () => {
  const f = fixture();
  const history = createUpdateHistory(f.header);
  const version = f.header.children[1];
  const escape = () => {
    const event = new Event('keydown', { cancelable: true, bubbles: true });
    Object.defineProperty(event, 'key', { value: 'Escape' });
    f.panel.dispatchEvent(event);
    return event;
  };
  assert.equal(escape().defaultPrevented, false);
  version.click();
  const event = escape();
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.cancelBubble, false);
  assert.equal(f.panel.children[3].hidden, false);
  assert.equal(f.settings[0].hidden, true);
  history.dispose();
});

// A stale listener would hide settings again after disposal.
test('清理恢复原设置并删除入口与视图，重复清理及旧事件不再产生影响', () => {
  const f = fixture();
  const history = createUpdateHistory(f.header);
  const version = f.header.children[1];
  version.click();
  history.dispose();
  history.dispose();
  assert.deepEqual(f.panel.children, [f.header, ...f.settings]);
  assert.deepEqual(f.header.children, [f.grip, f.panelClose]);
  assert.equal(f.settings[0].hidden, false);
  assert.equal(f.settings[0].inert, false);
  assert.equal(f.settings[1].hidden, true);
  assert.equal(f.panel.scrollTop, 125);
  version.click();
  assert.equal(f.settings[0].hidden, false);
});

// Fixing height after hiding settings would measure an already collapsed panel.
test('更新期间固定原面板实际高度，返回和清理均还原原内联高度', () => {
  for (const originalHeight of ['', '480px']) {
    const f = fixture();
    f.panel.style.height = originalHeight;
    const history = createUpdateHistory(f.header);
    const version = f.header.children[1];
    version.click();
    assert.equal(f.panel.style.height, '512px');
    assert.equal(f.panel.style.width, '300px');
    assert.equal(f.panel.classList.contains('showing-updates'), true);
    f.header.children[0].click();
    assert.equal(f.panel.style.height, originalHeight);
    assert.equal(f.panel.classList.contains('showing-updates'), false);
    version.click();
    history.dispose();
    assert.equal(f.panel.style.height, originalHeight);
    assert.equal(f.panel.classList.contains('showing-updates'), false);
  }
});
