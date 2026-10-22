'use strict';
const $ = id => document.getElementById(id);
let saved, hotkeys = {}, dirtySize = false;
const presets = { day: { textColor: '#393f55', backgroundColor: '#ffffff' }, mist: { textColor: '#4a5b78', backgroundColor: '#e9eff8' }, night: { textColor: '#c8d1eb', backgroundColor: '#30364c' } };
function selectTab(name, focus = false) {
  for (const tab of document.querySelectorAll('[data-tab]')) {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    $(`panel-${tab.dataset.tab}`).hidden = !active;
    if (active && focus) tab.focus();
  }
}
const tabs = [...document.querySelectorAll('[data-tab]')];
tabs.forEach((tab, index) => {
  tab.onclick = () => selectTab(tab.dataset.tab);
  tab.onkeydown = event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length;
    selectTab(tabs[next].dataset.tab, true);
  };
});
function markDirty() { message('有未保存的更改'); $('save').classList.remove('saved'); }
function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
function displayKey(key) { return key.replace('CommandOrControl', saved?.platform === 'darwin' ? '⌘' : 'Ctrl').replace('Control', 'Ctrl').replace('Super', saved?.platform === 'darwin' ? '⌘' : 'Win'); }
function status(value) {
  $('lock-state').textContent = value.locked ? `已锁定 · ${displayKey(value.hotkeys.lock)} 解锁` : `悬停阅读已就绪`;
  $('lock-state').classList.toggle('locked', value.locked);
  $('locate').disabled = value.locked;
}
function populate(value) {
  saved = value; hotkeys = { ...value.hotkeys };
  document.body.dataset.platform = value.platform;
  for (const key of ['fontSize', 'backgroundOpacity', 'textColor', 'backgroundColor', 'width', 'height']) $(key).value = value[key];
  $('alwaysOnTop').checked = value.alwaysOnTop;
  for (const key of ['lock', 'prev', 'next']) $(key).value = displayKey(hotkeys[key]);
  outputs(); status(value); dirtySize = false;
  if (value.shortcutError) message(value.shortcutError, true);
}
function outputs() {
  $('font-output').textContent = `${$('fontSize').value} px`; $('opacity-output').textContent = `${$('backgroundOpacity').value}%`;
  for (const key of ['fontSize', 'backgroundOpacity']) { const input = $(key); input.style.setProperty('--range-fill', `${(Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100}%`); }
  const color = $('backgroundColor').value;
  const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16)).join(',');
  $('preview-reader').style.backgroundColor = `rgba(${rgb}, ${Number($('backgroundOpacity').value) / 100})`;
  $('preview-reader').style.color = $('textColor').value;
  $('preview-text').style.fontSize = `${$('fontSize').value}px`;
  $('text-hex').textContent = $('textColor').value.toUpperCase(); $('background-hex').textContent = color.toUpperCase();
  $('preview-size').textContent = `${$('width').value} × ${$('height').value} px`;
  document.querySelectorAll('[data-preset]').forEach(button => { const preset = presets[button.dataset.preset]; button.setAttribute('aria-pressed', String(preset.textColor === $('textColor').value && preset.backgroundColor === color)); });
}
function preview() {
  outputs(); if (!saved) return;
  markDirty();
  window.desktop.preview({ fontSize: Number($('fontSize').value), backgroundOpacity: Number($('backgroundOpacity').value), textColor: $('textColor').value, backgroundColor: $('backgroundColor').value }).then(result => { if (!result.ok) message(result.error, true); }).catch(() => message('预览暂不可用，请重试', true));
}
for (const key of ['fontSize', 'backgroundOpacity', 'textColor', 'backgroundColor']) $(key).addEventListener('input', preview);
document.querySelectorAll('[data-preset]').forEach(button => { button.onclick = () => { const preset = presets[button.dataset.preset]; $('textColor').value = preset.textColor; $('backgroundColor').value = preset.backgroundColor; preview(); }; });
for (const key of ['width', 'height']) { $(key).addEventListener('input', () => { dirtySize = true; outputs(); markDirty(); }); $(key).addEventListener('invalid', () => selectTab('window')); }
$('alwaysOnTop').addEventListener('change', markDirty);
for (const action of ['lock', 'prev', 'next']) {
  $(action).addEventListener('input', () => {
    hotkeys[action] = $(action).value.trim().replace(/\s/g, '').replace(/Ctrl/gi, 'Control').replace(/Cmd|⌘|Win/gi, 'Super');
    markDirty();
  });
  $(action).addEventListener('keydown', event => {
  if (event.key === 'Tab') return;
  if (!event.ctrlKey && !event.metaKey && !event.altKey) return;
  if ((event.ctrlKey || event.metaKey) && ['KeyA', 'KeyC', 'KeyV', 'KeyX'].includes(event.code) && !event.altKey && !event.shiftKey) return;
  event.preventDefault();
  const modifiers = [];
  if (event.ctrlKey) modifiers.push('Control'); if (event.metaKey) modifiers.push('Super'); if (event.altKey) modifiers.push('Alt'); if (event.shiftKey) modifiers.push('Shift');
  const names = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', ' ': 'Space', Escape: 'Escape', Enter: 'Enter', PageUp: 'PageUp', PageDown: 'PageDown', Home: 'Home', End: 'End' };
  let key = names[event.key];
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (/^Digit\d$/.test(event.code)) key = event.code.slice(5);
  else if (/^F(?:[1-9]|1\d|2[0-4])$/.test(event.key)) key = event.key;
  if (!key) return;
  if (!modifiers.some(modifier => modifier !== 'Shift')) return message('请同时按下 Ctrl / ⌘ 或 Alt 等修饰键', true);
  hotkeys[action] = [...modifiers, key].join('+'); $(action).value = displayKey(hotkeys[action]); markDirty();
  });
}
$('settings-form').onsubmit = async event => {
  event.preventDefault(); $('save').disabled = true;
  try {
    const value = { fontSize: Number($('fontSize').value), backgroundOpacity: Number($('backgroundOpacity').value), textColor: $('textColor').value, backgroundColor: $('backgroundColor').value,
      width: Number($('width').value), height: Number($('height').value), alwaysOnTop: $('alwaysOnTop').checked, hotkeys };
    const result = await window.desktop.save(value);
    if (!result.ok) return message(result.error, true);
    populate(result.data); message('偏好已保存'); $('save').classList.add('saved');
  } catch { message('保存失败，请重试', true); }
  finally { $('save').disabled = false; }
};
$('locate').onclick = async () => { const result = await window.desktop.locate(); if (!result.ok) message(result.error, true); };
$('quit').onclick = () => window.desktop.quit();
window.desktop.get().then(result => { if (result.ok) populate(result.data); else message(result.error, true); });
window.desktop.onPreferences(value => { saved = { ...saved, locked: value.locked }; status(value); });
window.desktop.onBounds(bounds => { if (!dirtySize) { $('width').value = bounds.width; $('height').value = bounds.height; outputs(); } });
window.desktop.onError(text => message(text, true));
