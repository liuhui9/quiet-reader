const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');
async function launch(options = {}) {
  const windows = [], handlers = new Map(), shortcuts = new Map(), ticks = [];
  let cursor = { x: 0, y: 0 }, written;
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.bounds = { x: 0, y: 0, ...options }; this.visible = false;
      this.webContents = new EventEmitter(); this.messages = []; this.webContents.send = (channel, value) => this.messages.push({ channel, value });
      this.webContents.isDestroyed = () => !!this.destroyed;
      this.webContents.setWindowOpenHandler = () => {}; windows.push(this); }
    loadFile(file) { this.file = file; queueMicrotask(() => this.emit('ready-to-show')); }
    isDestroyed() { return !!this.destroyed; } isVisible() { if (this.destroyed) throw new Error('Object has been destroyed'); return this.visible; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    showInactive() { this.visible = true; this.emit('show'); } show() { this.showInactive(); } hide() { this.visible = false; }
    getBounds() { if (this.destroyed) throw new Error('Object has been destroyed'); const { x, y, width, height } = this.bounds; return { x, y, width, height }; }
    setBounds(bounds) { this.bounds = { ...this.bounds, ...bounds }; }
    setAlwaysOnTop(value) { this.options.alwaysOnTop = value; }
  }
  const app = new EventEmitter(); app.whenReady = () => Promise.resolve(); app.requestSingleInstanceLock = () => true; app.getPath = () => '/fake'; app.quit = () => {};
  const screen = new EventEmitter(); screen.getCursorScreenPoint = () => cursor;
  screen.getPrimaryDisplay = screen.getDisplayMatching = screen.getDisplayNearestPoint = () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } });
  class Tray extends EventEmitter { setToolTip() {} setContextMenu() {} }
  const electron = { app, BrowserWindow: Window, screen, Tray,
    nativeImage: { createFromPath: () => ({}) }, Menu: { setApplicationMenu() {}, buildFromTemplate: value => value },
    globalShortcut: { register: (key, fn) => { if (shortcuts.has(key)) return false; shortcuts.set(key, fn); return true; }, unregister: key => shortcuts.delete(key), unregisterAll: () => shortcuts.clear() },
    ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, dialog: { showOpenDialog: (...args) => options.openDialog(...args), showErrorBox: (_title, error) => { throw new Error(error); } } };
  const fakeFs = { promises: { stat: async () => ({ isFile: () => true, size: options.size ?? 100 }), readFile: async () => Buffer.from(options.text ?? '第一章 测试\n导入正文', 'utf8') }, readFileSync: () => { throw new Error('fresh'); }, writeFileSync: (_path, value) => { written = JSON.parse(value); }, renameSync() {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'main.cjs'), 'utf8'), { __dirname: root, Buffer, TextDecoder, process, structuredClone,
    require: id => id === 'electron' ? electron : id === 'node:fs' ? fakeFs : id === './window-state.cjs' ? require('../window-state.cjs') : require(id),
    setInterval: fn => { ticks.push(fn); return 1; }, clearInterval() {}, setTimeout: () => 1, clearTimeout() {} });
  await new Promise(resolve => setImmediate(resolve));
  const reader = windows[0], settings = windows[1];
  function invoke(channel, payload, window = settings) { return handlers.get(channel)({ sender: window.webContents, senderFrame: { url: pathToFileURL(window.file).href } }, payload); }
  return { reader, settings, app, shortcuts, invoke, get written() { return written; }, tick(point) { cursor = point; ticks.forEach(fn => fn()); } };
}
test('主进程集成：隐藏时全局快捷键可锁定，悬停和找回均无法绕过，快捷键才可解锁', async () => {
  const env = await launch();
  env.settings.hide(); env.tick({ x: 0, y: 0 }); assert(!env.reader.isVisible());
  const prefs = (await env.invoke('reader:get')).data;
  env.shortcuts.get(prefs.hotkeys.lock)();
  env.tick({ x: 100, y: 120 }); assert(!env.reader.isVisible());
  const result = await env.invoke('reader:locate'); assert.equal(result.ok, false); assert.match(result.error, /已锁定/);
  await env.invoke('reader:settings'); env.settings.hide(); env.tick({ x: 100, y: 120 }); assert(!env.reader.isVisible());
  env.shortcuts.get(prefs.hotkeys.lock)(); env.tick({ x: 100, y: 120 }); assert(env.reader.isVisible());
  env.tick({ x: 0, y: 0 }); assert(!env.reader.isVisible());
  env.tick({ x: 100, y: 120 }); assert(env.reader.isVisible());
});
test('主进程集成：保存透明度、字体、窗口大小和自定义快捷键，旧快捷键被释放', async () => {
  const env = await launch(), previous = (await env.invoke('reader:get')).data;
  const updated = { ...previous, backgroundOpacity: 0, fontSize: 25, width: 240, height: 120,
    hotkeys: { ...previous.hotkeys, lock: 'Control+Shift+F11' } };
  const result = await env.invoke('reader:save', updated);
  assert(result.ok); assert.equal(env.written.backgroundOpacity, 0); assert.equal(env.written.fontSize, 25);
  assert.equal(env.reader.getBounds().width, 240); assert.equal(env.reader.getBounds().height, 120);
  assert(!env.shortcuts.has(previous.hotkeys.lock)); assert(env.shortcuts.has(updated.hotkeys.lock));
  env.settings.hide(); env.shortcuts.get(updated.hotkeys.lock)(); env.tick({ x: 100, y: 120 }); assert(!env.reader.isVisible());
});
test('主进程拒绝来自其他页面的 IPC', async () => {
  const env = await launch();
  const original = env.settings.file; env.settings.file = path.join(root, 'untrusted.html');
  await assert.rejects(() => env.invoke('reader:get'), /无效页面/); env.settings.file = original;
});
test('退出时先销毁阅读窗再关闭设置窗，不访问已销毁对象或继续广播', async () => {
  const env = await launch();
  const count = env.reader.messages.length;
  env.app.emit('before-quit');
  env.reader.destroy();
  assert.doesNotThrow(() => env.settings.destroy());
  assert.doesNotThrow(() => env.tick({ x: 100, y: 110 }));
  assert.equal(env.reader.messages.length, count);
});
test('退出时先关闭设置窗再销毁阅读窗，同样安全', async () => {
  const env = await launch();
  env.app.emit('before-quit');
  assert.doesNotThrow(() => env.settings.destroy());
  assert.doesNotThrow(() => env.reader.destroy());
});
test('非退出期间阅读窗已销毁，设置窗关闭和快照也不会访问销毁对象', async () => {
  const env = await launch(); env.reader.destroy();
  const result = await env.invoke('reader:get'); assert(result.ok);
  assert.doesNotThrow(() => env.settings.destroy());
});
test('顶部鼠标检测不依赖拖动区 DOM 事件，离开顶部和锁定时及时清除', async () => {
  const env = await launch(); env.settings.hide();
  const pointer = () => env.reader.messages.filter(message => message.channel === 'reader:pointer').at(-1).value;
  env.tick({ x: 100, y: 110 }); assert.equal(pointer().top, true);
  const previousCount = env.reader.messages.length;
  env.tick({ x: 100, y: 110 }); assert.equal(pointer().top, true); assert(env.reader.messages.length > previousCount);
  env.tick({ x: 100, y: 135 }); assert.equal(pointer().top, true);
  env.tick({ x: 100, y: 160 }); assert.equal(pointer().inside, true); assert.equal(pointer().top, false);
  env.tick({ x: 0, y: 0 }); assert.equal(pointer().inside, false);
  const prefs = (await env.invoke('reader:get')).data;
  env.shortcuts.get(prefs.hotkeys.lock)(); env.tick({ x: 100, y: 110 }); assert.equal(pointer().top, false);
});
test('导入选择框绑定可见阅读窗，鼠标移出不隐藏父窗，选择后返回正文', async () => {
  let finish, called = 0;
  const env = await launch({ openDialog: async (owner, options) => {
    called++; assert.equal(owner, env.reader); assert(owner.isVisible()); assert.equal(options.properties[0], 'openFile');
    return new Promise(resolve => { finish = resolve; });
  } });
  const pending = env.invoke('reader:import');
  env.tick({ x: 1900, y: 1000 }); assert(env.reader.isVisible());
  const duplicate = await env.invoke('reader:import'); assert.equal(duplicate.ok, false); assert.equal(called, 1);
  finish({ canceled: false, filePaths: ['/books/测试.txt'] });
  const result = await pending; assert(result.ok); assert.equal(result.data.name, '测试'); assert.match(result.data.text, /导入正文/);
  env.tick({ x: 1900, y: 1000 }); assert(!env.reader.isVisible());
});
test('取消文件框、选择框抛错后均可再次导入', async () => {
  let called = 0;
  const env = await launch({ openDialog: async () => { called++; if (called === 1) throw new Error('文件框错误'); return { canceled: true, filePaths: [] }; } });
  assert.equal((await env.invoke('reader:import')).ok, false);
  const result = await env.invoke('reader:import'); assert(result.ok); assert.equal(result.data, null); assert.equal(called, 2);
});
test('超过限制的 TXT 返回明确错误，锁定时不会打开文件框', async () => {
  let called = 0;
  const env = await launch({ size: 6 * 1024 * 1024, openDialog: async () => { called++; return { canceled: false, filePaths: ['/books/大文件.txt'] }; } });
  const result = await env.invoke('reader:import'); assert.equal(result.ok, false); assert.match(result.error, /5 MB/);
  const prefs = (await env.invoke('reader:get')).data; env.shortcuts.get(prefs.hotkeys.lock)();
  assert.equal((await env.invoke('reader:import')).ok, false); assert.equal(called, 1);
});
