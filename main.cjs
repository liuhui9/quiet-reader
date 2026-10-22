'use strict';
const { app, BrowserWindow, Menu, Tray, nativeImage, globalShortcut, ipcMain, screen, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { DEFAULTS, inside, visibility, preferences, replaceHotkeys, resized } = require('./window-state.cjs');
const windowIcon = path.join(__dirname, 'icons', process.platform === 'win32' ? 'app.ico' : 'app.png');
let reader, settingsWindow, tray, prefs, settingsPath, ready = false, locked = false, hoverTimer, boundsTimer;
let interaction = null, draggingUntil = 0, suspended = false, importing = false, quitting = false, keyError = '', activeKeys = {}, setupNeeded = true, lastPointerState = '';
function writePrefs(value) { const temp = `${settingsPath}.tmp`; fs.writeFileSync(temp, JSON.stringify(value, null, 2)); fs.renameSync(temp, settingsPath); }
function snapshot() { return { ...prefs, locked, shortcutError: keyError, bounds: reader && !reader.isDestroyed() ? reader.getBounds() : prefs?.bounds, platform: process.platform }; }
function send(window, channel, data) { if (!quitting && window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, data); }
function broadcast() { if (quitting) return; const value = snapshot(); send(reader, 'reader:preferences', value); send(settingsWindow, 'reader:preferences', value); }
function syncVisibility() {
  if (quitting || !reader || reader.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const bounds = reader.getBounds();
  const overSettings = settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible() && inside(cursor, settingsWindow.getBounds());
  const hovered = !overSettings && inside(cursor, bounds);
  const show = visibility({ locked, suspended, ready, interacting: importing || !!interaction || Date.now() < draggingUntil, inside: hovered });
  const pointer = { inside: show && hovered, top: show && hovered && cursor.y - bounds.y < 44 };
  const key = `${pointer.inside}:${pointer.top}`;
  // 显示窗口会异步触发 visibilitychange；顶部状态需持续同步，避免被旧隐藏事件清除后不再恢复。
  if (pointer.inside || key !== lastPointerState) { lastPointerState = key; send(reader, 'reader:pointer', pointer); }
  if (show && !reader.isVisible()) reader.showInactive();
  else if (!show && reader.isVisible()) reader.hide();
}
function menu() {
  if (!tray) return;
  tray.setToolTip(locked ? `留白 · 已锁定（${prefs.hotkeys.lock} 解锁）` : '留白 · 移入阅读，移出隐藏');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: locked ? `已锁定：${prefs.hotkeys.lock} 解锁` : '鼠标移入原阅读区域即可显示', enabled: false },
    { label: '设置 / 找回窗口', click: openSettings },
    { type: 'separator' }, { label: '退出', click: () => app.quit() }
  ]));
}
function dispatch(value) {
  if (quitting || !reader || reader.isDestroyed()) return;
  const action = Object.keys(activeKeys).find(key => activeKeys[key] === value);
  if (action === 'lock') {
    locked = !locked; interaction = null; draggingUntil = 0;
    if (locked) { reader.hide(); if (settingsWindow?.isVisible()) settingsWindow.hide(); }
    syncVisibility(); broadcast(); menu();
  } else if (!locked && reader?.isVisible()) send(reader, 'reader:page', action === 'prev' ? -1 : 1);
}
function registerKeys(keys) { replaceHotkeys(globalShortcut, activeKeys, keys, { dispatch }); activeKeys = { ...keys }; }
function secure(window, file) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.loadFile(path.join(__dirname, file));
}
function fitBounds(value) {
  const display = screen.getDisplayMatching(value).workArea;
  const width = Math.max(180, Math.min(value.width, display.width)), height = Math.max(80, Math.min(value.height, display.height));
  return { width, height, x: Math.round(Math.max(display.x, Math.min(value.x, display.x + display.width - width))), y: Math.round(Math.max(display.y, Math.min(value.y, display.y + display.height - height))) };
}
function rememberBounds() {
  if (quitting) return;
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    if (quitting || !reader || reader.isDestroyed()) return;
    const bounds = reader.getBounds(); prefs = { ...prefs, width: bounds.width, height: bounds.height, bounds };
    try { writePrefs(prefs); } catch { send(settingsWindow, 'reader:error', '窗口位置保存失败，请检查磁盘空间'); }
    send(settingsWindow, 'reader:bounds', bounds);
  }, 350);
}
function openSettings() {
  if (quitting) return;
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); return; }
  const area = screen.getPrimaryDisplay().workArea;
  settingsWindow = new BrowserWindow({ width: Math.min(1040, area.width), height: Math.min(750, area.height), minWidth: Math.min(780, area.width), minHeight: Math.min(580, area.height), show: false, title: '留白 · 设置', autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? false : { color: '#f7f8fc', symbolColor: '#8b8fa5', height: 42 },
    icon: windowIcon, backgroundColor: '#ffffff', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  secure(settingsWindow, 'settings.html');
  const window = settingsWindow;
  window.once('ready-to-show', () => { if (!quitting && !window.isDestroyed()) window.show(); });
  window.on('closed', () => { if (settingsWindow === window) settingsWindow = null; if (!quitting) { broadcast(); syncVisibility(); } });
}
function trusted(event) {
  const sender = event.sender;
  if (sender !== reader?.webContents && sender !== settingsWindow?.webContents) throw new Error('无效窗口');
  const expected = pathToFileURL(path.join(__dirname, sender === reader?.webContents ? 'index.html' : 'settings.html')).href;
  if (event.senderFrame?.url !== expected) throw new Error('无效页面');
}
function handle(name, fn) { ipcMain.handle(name, async (event, payload) => { trusted(event); try { return { ok: true, data: await fn(payload, event) }; } catch (error) { return { ok: false, error: error.message }; } }); }
function createReader() {
  const area = screen.getPrimaryDisplay().workArea, saved = prefs.bounds;
  const bounds = fitBounds(saved && ['x', 'y', 'width', 'height'].every(key => Number.isInteger(saved[key])) ? saved : { width: prefs.width, height: prefs.height, x: area.x + 80, y: area.y + 100 });
  reader = new BrowserWindow({ ...bounds, minWidth: 180, minHeight: 80, maxWidth: 3840, maxHeight: 2160, frame: false, transparent: true,
    icon: windowIcon, backgroundColor: '#00000000', hasShadow: false, resizable: true, maximizable: false, fullscreenable: false,
    alwaysOnTop: prefs.alwaysOnTop, skipTaskbar: true, show: false, title: '留白',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: false } });
  secure(reader, 'index.html');
  reader.once('ready-to-show', () => { if (quitting || reader.isDestroyed()) return; ready = true; syncVisibility(); if (setupNeeded || keyError) openSettings(); });
  reader.on('move', () => { draggingUntil = Date.now() + 150; rememberBounds(); });
  reader.on('resize', rememberBounds);
  reader.on('blur', () => { interaction = null; });
  reader.on('close', event => { if (!quitting) { event.preventDefault(); openSettings(); } });
  reader.on('show', () => { if (locked) reader.hide(); });
  hoverTimer = setInterval(syncVisibility, 60);
  const refit = () => { if (!quitting && reader && !reader.isDestroyed()) reader.setBounds(fitBounds(reader.getBounds())); };
  screen.on('display-removed', refit);
  screen.on('display-metrics-changed', refit);
}
function setupIPC() {
  handle('reader:get', () => snapshot()); handle('reader:settings', () => openSettings());
  handle('reader:save', value => {
    const next = preferences(value), oldKeys = { ...activeKeys }; registerKeys(next.hotkeys);
    const bounds = fitBounds({ ...reader.getBounds(), width: next.width, height: next.height });
    const updated = { ...next, width: bounds.width, height: bounds.height, bounds };
    try { writePrefs(updated); } catch (error) { registerKeys(oldKeys); throw new Error(`保存失败：${error.message}`); }
    prefs = updated; keyError = ''; reader.setAlwaysOnTop(prefs.alwaysOnTop); reader.setBounds(bounds); broadcast(); menu(); return snapshot();
  });
  handle('reader:preview', value => { const next = preferences({ ...prefs, ...value, hotkeys: prefs.hotkeys }); send(reader, 'reader:preferences', { ...next, locked }); });
  handle('reader:locate', () => {
    if (locked) throw new Error(`已锁定，请先按 ${prefs.hotkeys.lock} 解锁`);
    const cursor = screen.getCursorScreenPoint(), current = reader.getBounds();
    reader.setBounds(fitBounds({ ...current, x: Math.round(cursor.x - current.width / 2), y: Math.round(cursor.y - current.height / 2) }));
    broadcast(); settingsWindow?.hide(); syncVisibility(); return reader.getBounds();
  });
  handle('reader:quit', () => app.quit()); handle('reader:dialog', value => { suspended = value === true; syncVisibility(); });
  handle('reader:import', async () => {
    if (quitting || !reader || reader.isDestroyed()) throw new Error('阅读窗口已关闭，请重新打开应用');
    if (locked) throw new Error('阅读器已锁定，请先使用快捷键解锁');
    if (importing) throw new Error('文件选择窗口已打开，请先选择文件或取消');
    importing = true;
    const owner = reader;
    try {
      // 文件框必须有可见父窗口；先隐藏阅读窗再打开无归属文件框，可能让文件框落在其他应用后面。
      owner.show();
      const result = await dialog.showOpenDialog(owner, { title: '导入 TXT 小说', filters: [{ name: 'TXT 小说', extensions: ['txt'] }], properties: ['openFile'] });
      if (quitting || owner.isDestroyed()) return null;
      if (result.canceled || !result.filePaths.length) return null;
      const filename = result.filePaths[0];
      const stat = await fs.promises.stat(filename);
      if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error('请选择 5 MB 以内的 TXT 文件');
      const bytes = await fs.promises.readFile(filename);
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { text = new TextDecoder('gb18030', { fatal: true }).decode(bytes); }
      text = text.replace(/^\uFEFF/, '');
      if (!text.trim()) throw new Error('文件内容为空，请选择其他小说');
      return { name: path.basename(filename, path.extname(filename)), text };
    } finally { importing = false; syncVisibility(); }
  });
  handle('reader:resize-start', edge => { if (locked || !/^(?:n|s|e|w|ne|nw|se|sw)$/.test(edge)) return; interaction = { edge, bounds: reader.getBounds(), cursor: screen.getCursorScreenPoint() }; });
  handle('reader:resize-move', () => { if (interaction && !locked) reader.setBounds(resized(interaction.bounds, interaction.cursor, screen.getCursorScreenPoint(), interaction.edge)); });
  handle('reader:resize-end', () => { interaction = null; syncVisibility(); });
}
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on('second-instance', () => { if (ready) openSettings(); });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null); settingsPath = path.join(app.getPath('userData'), 'floating-preferences.json');
    try { const stored = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); prefs = { ...preferences(stored), bounds: stored.bounds }; setupNeeded = false; } catch { prefs = preferences(DEFAULTS); }
    try { registerKeys(prefs.hotkeys); } catch (error) { keyError = error.message; }
    setupIPC(); createReader();
    const trayIcon = nativeImage.createFromPath(path.join(__dirname, 'icons', 'tray.png'));
    if (process.platform === 'darwin') app.dock?.setIcon(path.join(__dirname, 'icons', 'app.png'));
    tray = new Tray(trayIcon); menu(); tray.on('click', openSettings); app.on('activate', openSettings);
  }).catch(error => { dialog.showErrorBox('留白启动失败', error.message); app.quit(); });
}
app.on('before-quit', () => { quitting = true; clearInterval(hoverTimer); clearTimeout(boundsTimer); if (reader && !reader.isDestroyed() && prefs) { try { writePrefs({ ...prefs, bounds: reader.getBounds() }); } catch { /* 保留上次成功保存的设置 */ } } });
app.on('will-quit', () => globalShortcut.unregisterAll());
