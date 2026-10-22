const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
async function setup(importBook) {
  class Element {
    constructor() { this.textContent = ''; this.disabled = false; this.hidden = true; this.children = []; this.style = { setProperty() {} }; this.scrollHeight = 100; this.clientHeight = 100; this.scrollTop = 0; }
    addEventListener() {} replaceChildren(...items) { this.children = items; } append(...items) { this.children.push(...items); }
  }
  const elements = new Map(), get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  get('import').textContent = '导入 TXT'; get('import-more').textContent = '＋ 导入';
  const books = [], request = {}, storage = new Map();
  const db = { transaction() {
    const tx = { objectStore: () => ({ getAll: () => ({ result: books }), put: book => { books.push(book); return {}; } }) };
    queueMicrotask(() => tx.oncomplete?.()); return tx;
  } };
  const desktop = { importBook, get: async () => ({ ok: false }), onPreferences() {}, onPage() {}, onPointer() {} };
  const document = { getElementById: get, documentElement: new Element(), body: new Element(), querySelector: () => new Element(), querySelectorAll: () => [], createElement: () => new Element(), createDocumentFragment: () => new Element(), addEventListener() {} };
  const window = { desktop, createReaderToolbar: () => ({ close() {}, reset() {}, pointer() {} }), addEventListener() {} };
  const context = { document, window, indexedDB: { open: () => request }, crypto: { randomUUID: () => 'imported' }, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }, requestAnimationFrame: fn => fn(), setTimeout: () => 1, clearTimeout() {}, console };
  // contextBridge 暴露的 desktop 是不可重定义的全局属性；模拟真实环境，避免全局 const desktop 再次导致整个脚本无法加载。
  Object.defineProperty(context, 'desktop', { value: desktop, configurable: false, writable: false });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'), context);
  request.result = db; await request.onsuccess();
  return { get, books, storage };
}
test('首页导入按钮实际调用桌面 API、保存书籍并打开正文', async () => {
  let calls = 0, finish;
  const env = await setup(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const pending = env.get('import').onclick();
  assert.equal(calls, 1); assert(env.get('import').disabled); assert.equal(env.get('import').textContent, '选择文件…');
  await env.get('import-more').onclick(); assert.equal(calls, 1);
  finish({ ok: true, data: { name: '测试小说', text: '第一章\n小说正文' } });
  await pending;
  assert.equal(env.books[0].name, '测试小说'); assert.equal(env.storage.get('last-book'), 'imported');
  assert.equal(env.get('content').children[0].children[1].textContent, '小说正文');
  assert.equal(env.get('import').disabled, false); assert.equal(env.get('import').textContent, '导入 TXT');
});
test('取消文件选择和桌面 API 失败后恢复导入按钮，并展示具体错误', async () => {
  let calls = 0;
  const env = await setup(async () => ++calls === 1 ? { ok: true, data: null } : { ok: false, error: '文件框打开失败' });
  await env.get('import').onclick(); assert.equal(env.get('import').disabled, false); assert.equal(env.books.length, 0);
  await env.get('import-more').onclick(); assert.equal(env.get('toast').textContent, '文件框打开失败'); assert.equal(env.get('import-more').disabled, false);
});
