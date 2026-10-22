const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, inside, visibility, preferences, replaceHotkeys, resized } = require('../window-state.cjs');
test('鼠标移出隐藏，移入显示；锁定不允许悬停、拖动或准备状态绕过', () => {
  const state = { ready: true, locked: false, suspended: false, interacting: false, inside: false };
  assert.equal(visibility(state), false);
  assert.equal(visibility({ ...state, inside: true }), true);
  for (const hovered of [false, true]) for (const interacting of [false, true]) {
    assert.equal(visibility({ ...state, locked: true, inside: hovered, interacting }), false);
  }
  assert.equal(visibility({ ...state, ready: false, inside: true }), false);
  assert.equal(visibility({ ...state, suspended: true, inside: true }), false);
  assert.equal(visibility({ ...state, locked: true, inside: true }), false);
  assert.equal(visibility({ ...state, locked: false, inside: true }), true);
});
test('屏幕坐标包含多显示器负数及边界', () => {
  const rect = { x: -500, y: 40, width: 200, height: 100 };
  assert(inside({ x: -500, y: 40 }, rect));
  assert(!inside({ x: -300, y: 40 }, rect));
  assert(!inside({ x: -400, y: 140 }, rect));
});
test('允许全透明和自定义小窗，拒绝异常值及重复快捷键', () => {
  assert.equal(preferences({ ...DEFAULTS, backgroundOpacity: 0, width: 180, height: 80 }).backgroundOpacity, 0);
  assert.throws(() => preferences({ ...DEFAULTS, width: NaN }));
  assert.throws(() => preferences({ ...DEFAULTS, fontSize: 99 }));
  assert.throws(() => preferences({ ...DEFAULTS, backgroundOpacity: -1 }));
  assert.throws(() => preferences({ ...DEFAULTS, textColor: 'url(x)' }));
  assert.throws(() => preferences({ ...DEFAULTS, hotkeys: { ...DEFAULTS.hotkeys, lock: 'L' } }));
  assert.throws(() => preferences({ ...DEFAULTS, hotkeys: { ...DEFAULTS.hotkeys, next: DEFAULTS.hotkeys.lock } }));
  const control = process.platform === 'darwin' ? 'Super' : 'Control';
  assert.throws(() => preferences({ ...DEFAULTS, hotkeys: { ...DEFAULTS.hotkeys, next: `${control}+Alt+L` } }));
});
test('快捷键冲突时回滚新增注册并保留旧组合；成功后替换，支持功能互换', () => {
  const callbacks = new Map(), occupied = 'Control+Alt+X';
  const api = { register: (key, cb) => { if (key === occupied || callbacks.has(key)) return false; callbacks.set(key, cb); return true; }, unregister: key => callbacks.delete(key) };
  let dispatched;
  const dispatch = { dispatch: key => { dispatched = key; } };
  const old = { lock: 'Control+Alt+L', prev: 'Control+Alt+Left', next: 'Control+Alt+Right' };
  replaceHotkeys(api, {}, old, dispatch);
  assert.throws(() => replaceHotkeys(api, old, { ...old, lock: 'Control+Alt+K', next: occupied }, dispatch));
  assert.deepEqual([...callbacks.keys()].sort(), Object.values(old).sort());
  const next = { ...old, lock: 'Control+Alt+K' };
  replaceHotkeys(api, old, next, dispatch);
  assert(!callbacks.has(old.lock)); callbacks.get(next.lock)(); assert.equal(dispatched, next.lock);
  replaceHotkeys(api, next, { ...next, prev: next.next, next: next.prev }, dispatch);
  assert.equal(callbacks.size, 3);
});
test('四角缩放保持对侧坐标，最小尺寸不造成位置跳跃', () => {
  const bounds = { x: 100, y: 100, width: 400, height: 200 }, start = { x: 0, y: 0 };
  assert.deepEqual(resized(bounds, start, { x: 50, y: 30 }, 'se'), { x: 100, y: 100, width: 450, height: 230 });
  assert.deepEqual(resized(bounds, start, { x: 50, y: 30 }, 'nw'), { x: 150, y: 130, width: 350, height: 170 });
  assert.deepEqual(resized(bounds, start, { x: 500, y: 500 }, 'nw'), { x: 320, y: 220, width: 180, height: 80 });
});
