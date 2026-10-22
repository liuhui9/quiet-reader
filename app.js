(function initializeReader() {
'use strict';
const $ = id => document.getElementById(id);
let books = [], active = null, busy = false, db, toastTimer, scrollTimer, renderVersion = 0;
let storageError = '';
const desktop = window.desktop;
const navigation = window.createReaderToolbar({ root: $('reader'), toolbar: document.querySelector('.reader-toolbar'), library: $('library-panel'), toc: $('toc'), libraryButton: $('library-toggle'), tocButton: $('toc-toggle'), closeButton: $('library-close'), scroll: $('scroll') });
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500); }
function applyPreferences(value) {
  const hex = value.backgroundColor.slice(1);
  document.documentElement.style.setProperty('--background-rgb', [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16)).join(','));
  document.documentElement.style.setProperty('--background-opacity', value.backgroundOpacity / 100);
  document.documentElement.style.setProperty('--reader-size', `${value.fontSize}px`);
  document.body.style.color = value.textColor;
  if ($('hotkey-hint')) $('hotkey-hint').textContent = `${value.hotkeys.lock.replace('CommandOrControl', value.platform === 'darwin' ? '⌘' : 'Ctrl')} 锁定 / 解锁`;
}
function transact(mode, operation) { return new Promise((resolve, reject) => { const tx = db.transaction('books', mode); const req = operation(tx.objectStore('books')); tx.oncomplete = () => resolve(req.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); }
async function storeBook(book) { await transact('readwrite', store => store.put(book)); }
function ratio() { const s = $('scroll'); return s.scrollHeight > s.clientHeight ? s.scrollTop / (s.scrollHeight - s.clientHeight) : 0; }
function capture() { if (active) active.position = Math.max(0, Math.min(1, ratio())); }
async function persist() { if (!active || !db) return; capture(); try { await storeBook(active); } catch { toast('进度保存失败，请检查磁盘空间'); } }
function renderLibrary() {
  $('library').replaceChildren();
  if (!books.length) { const p = document.createElement('p'); p.textContent = '还没有书籍，点击导入开始阅读'; $('library').append(p); }
  for (const book of books) {
    const row = document.createElement('div'); row.className = `book-row${active?.id === book.id ? ' active' : ''}`;
    const open = document.createElement('button'); open.className = 'book-open';
    const title = document.createElement('span'); title.className = 'book-title'; title.textContent = book.name;
    const meta = document.createElement('span'); meta.className = 'book-meta'; meta.textContent = `${Math.round(book.position * 100)}% 已读`;
    open.append(title, meta); open.onclick = () => { void openBook(book); };
    row.append(open); $('library').append(row);
  }
}
async function openBook(book) {
  if (busy) return; busy = true;
  try {
    clearTimeout(scrollTimer); await persist(); active = book;
    const savedPosition = book.position, version = ++renderVersion;
    $('content').replaceChildren(); $('toc').replaceChildren();
    const fragment = document.createDocumentFragment(); let chapters = 0;
    for (const line of book.text.replace(/\r\n?/g, '\n').split('\n')) {
      if (!line.trim()) continue;
      const heading = /^\s*(第[零〇一二三四五六七八九十百千万两\d]+[章回节卷部篇].{0,60}|序章|楔子|前言|后记|尾声|chapter\s+\d+.{0,60})\s*$/i.test(line);
      const element = document.createElement(heading ? 'h2' : 'p'); element.textContent = line.trim();
      if (heading) { element.id = `chapter-${chapters++}`; const button = document.createElement('button'); button.textContent = line.trim(); button.onclick = () => { element.scrollIntoView({ block: 'start' }); navigation.close(); }; $('toc').append(button); }
      fragment.append(element);
    }
    $('content').append(fragment);
    if (!chapters) { const p = document.createElement('p'); p.textContent = '未识别到章节，请直接滚动阅读'; $('toc').append(p); }
    navigation.close();
    try { localStorage.setItem('last-book', book.id); } catch { toast('无法保存最近阅读记录'); }
    requestAnimationFrame(() => { if (version !== renderVersion) return; $('scroll').scrollTop = savedPosition * Math.max(0, $('scroll').scrollHeight - $('scroll').clientHeight); updateProgress(); });
    renderLibrary();
  } finally { busy = false; }
}
function updateProgress() { $('progress').textContent = `${Math.round(ratio() * 100)}%`; }
$('scroll').addEventListener('scroll', () => { updateProgress(); clearTimeout(scrollTimer); scrollTimer = setTimeout(() => { void persist().then(renderLibrary); }, 180); }, { passive: true });
async function importBook() {
  if (!db) return toast(storageError || '本地书架正在打开，请稍后再试');
  if (busy) return toast('正在处理，请先完成文件选择或等待导入结束');
  busy = true;
  const importButtons = [$('import'), $('import-more')].filter(Boolean);
  const labels = importButtons.map(button => button.textContent);
  importButtons.forEach(button => { button.disabled = true; button.textContent = '选择文件…'; });
  try {
    const result = await desktop.importBook();
    if (!result.ok) return toast(result.error);
    if (!result.data) return;
    importButtons.forEach(button => { button.textContent = '导入中…'; });
    const book = { id: crypto.randomUUID(), ...result.data, position: 0 };
    await storeBook(book); books.unshift(book); busy = false; await openBook(book);
  } catch (error) { toast(`导入失败：${error.message || '请检查文件和存储空间'}`); }
  finally { busy = false; importButtons.forEach((button, index) => { button.disabled = false; button.textContent = labels[index]; }); }
}
$('import').onclick = importBook; $('import-more').onclick = importBook;
$('settings-open').onclick = () => desktop.settings();
$('reader-close').onclick = () => desktop.quit();
function page(direction) { $('scroll').scrollBy({ top: direction * $('scroll').clientHeight * .88, behavior: 'auto' }); }
function preserveAnchor(operation) {
  const position = ratio(); operation();
  requestAnimationFrame(() => { $('scroll').scrollTop = position * Math.max(0, $('scroll').scrollHeight - $('scroll').clientHeight); updateProgress(); });
}
if (desktop) {
  desktop.get().then(result => { if (result.ok) applyPreferences(result.data); });
  desktop.onPreferences(value => preserveAnchor(() => applyPreferences(value)));
  desktop.onPage(page);
  desktop.onPointer(value => navigation.pointer(value));
} else toast('请在桌面应用中打开阅读器');
for (const grip of document.querySelectorAll('[data-edge]')) {
  let resizing = false, pending = false;
  grip.addEventListener('pointerdown', async event => { if (event.button !== 0 || !desktop) return; event.preventDefault(); grip.setPointerCapture(event.pointerId); resizing = true; await desktop.resizeStart(grip.dataset.edge); });
  grip.addEventListener('pointermove', () => { if (!resizing || pending) return; pending = true; requestAnimationFrame(() => { desktop.resizeMove().finally(() => { pending = false; }); }); });
  const end = () => { if (!resizing) return; resizing = false; desktop.resizeEnd(); };
  grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end); grip.addEventListener('lostpointercapture', end);
}
window.addEventListener('blur', () => { void persist(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { void persist(); navigation.reset(); } });
window.addEventListener('pagehide', () => { void persist(); });
document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
  if (['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(event.key)) { event.preventDefault(); page(['ArrowLeft', 'PageUp'].includes(event.key) ? -1 : 1); }
});
const request = indexedDB.open('quiet-reader', 1);
request.onupgradeneeded = () => request.result.createObjectStore('books', { keyPath: 'id' });
request.onerror = () => { storageError = '本地书架无法打开，请检查应用数据目录权限后重启'; toast(storageError); };
request.onblocked = () => { storageError = '书架被其他阅读器窗口占用，请退出旧版后重试'; toast(storageError); };
request.onsuccess = async () => {
  db = request.result;
  storageError = '';
  try { books = await transact('readonly', store => store.getAll()); renderLibrary(); const id = localStorage.getItem('last-book'); const last = books.find(book => book.id === id) || books[0]; if (last) await openBook(last); }
  catch { toast('书架读取失败，请重启应用'); }
};
$('sample').onclick = async () => {
  if (!db || busy) return;
  const existing = books.find(book => book.id === 'sample');
  if (existing) return openBook(existing);
  const book = { id: 'sample', name: '山间来信（原创示例）', position: 0, text: '第一章 雨停以后\n午后的雨刚停，林间的路还泛着微光。许舟把那封没有署名的信折好，放进外套口袋。\n他已经很多年没有回过这个小镇。车站旁的杂货店换了招牌，门口却还是那棵老树，树下坐着一个正在修伞的人。\n“你回来得正好。”老人没有抬头，像是早知道他会在今天出现。\n许舟停下脚步。远处山上的钟声越过屋顶，一声，又一声。信里只写了一句话：雨停以后，去看看那间旧书店。\n第二章 旧书店\n书店的门没有锁。推门时，铜铃发出很轻的一声响，空气里是纸张和木头的味道。\n窗边放着一杯还温着的茶，一本书摊开在桌面。夹在书页里的照片上，是一座他从没见过的桥。\n许舟翻过照片。背面写着今天的日期。\n他拉开椅子坐下，决定先把这一页读完。窗外有人经过，脚步停了一下，又慢慢远去。\n第三章 留白\n有些故事并不着急给出答案，就像山里的云，总要绕过几座山才肯散开。\n他想起小时候的夏天，整整一个下午都可以用来读一本书。那时候，他从不担心还剩多少页。\n茶渐渐凉了，阳光落在下一行字上。许舟伸手翻页，远处又传来了钟声。' };
  try { await storeBook(book); books.unshift(book); await openBook(book); } catch { toast('示例打开失败，请重试'); }
};

})();

