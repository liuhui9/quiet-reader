const test = require('node:test');
const assert = require('node:assert/strict');
const { createReaderToolbar } = require('../reader-toolbar.js');
function element() {
  const classes = new Set(), events = {}, attributes = {};
  return { hidden: true, attributes, events, classList: { toggle(key, active) { active ? classes.add(key) : classes.delete(key); }, contains: key => classes.has(key) },
    setAttribute: (key, value) => { attributes[key] = value; }, addEventListener: (key, handler) => { events[key] = handler; }, getBoundingClientRect: () => ({ top: 0 }), contains: () => false, focus() {} };
}
function setup() { const elements = Object.fromEntries(['root', 'toolbar', 'library', 'toc', 'libraryButton', 'tocButton', 'closeButton', 'scroll'].map(key => [key, element()])); return { ...elements, controller: createReaderToolbar(elements) }; }
test('顶部移入显示，移到正文收起，不被点击焦点永久撑开', () => {
  const env = setup(), visible = () => env.root.classList.contains('toolbar-visible');
  env.controller.pointer({ inside: true, top: true }); assert(visible());
  env.toolbar.events.focusin({ target: { matches: () => false } });
  env.controller.pointer({ inside: true, top: false }); assert(!visible());
});
test('导航按钮打开面板后跨越顶部间隙仍保持显示，面板互斥且关闭状态同步', () => {
  const env = setup();
  env.controller.pointer({ inside: true, top: true }); env.libraryButton.onclick();
  env.controller.pointer({ inside: true, top: false });
  assert(env.root.classList.contains('toolbar-visible')); assert.equal(env.libraryButton.attributes['aria-expanded'], 'true');
  env.tocButton.onclick(); assert(env.library.hidden); assert(!env.toc.hidden);
  env.scroll.events.pointerdown(); assert(env.toc.hidden); assert(!env.root.classList.contains('toolbar-visible'));
});
test('移出窗口或锁定隐藏后关闭面板并清除导航状态', () => {
  const env = setup(); env.tocButton.onclick(); env.controller.pointer({ inside: false, top: false });
  assert(env.toc.hidden); assert.equal(env.tocButton.attributes['aria-expanded'], 'false'); assert(!env.root.classList.contains('toolbar-visible'));
  env.controller.pointer({ inside: true, top: true }); env.controller.reset(); assert(!env.root.classList.contains('toolbar-visible'));
});
test('鼠标停留顶部时，旧隐藏事件清理后可由下一次同步恢复导航', () => {
  const env = setup();
  env.controller.pointer({ inside: true, top: true }); env.controller.reset();
  env.controller.pointer({ inside: true, top: true }); assert(env.root.classList.contains('toolbar-visible'));
});
test('本地鼠标移动立即触发顶部导航，移动到正文后收起', () => {
  const env = setup(); env.root.events.pointermove({ clientY: 1 }); assert(env.root.classList.contains('toolbar-visible'));
  env.root.events.pointermove({ clientY: 60 }); assert(!env.root.classList.contains('toolbar-visible'));
});
