'use strict';
const DEFAULTS = Object.freeze({ fontSize: 18, backgroundOpacity: 65, textColor: '#32383f', backgroundColor: '#ffffff', width: 520, height: 280, alwaysOnTop: true,
  hotkeys: { lock: 'CommandOrControl+Alt+L', prev: 'CommandOrControl+Alt+Left', next: 'CommandOrControl+Alt+Right' } });
function inside(point, rect) { return point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height; }
function visibility({ locked, suspended, ready, interacting, inside: hovered }) { return !locked && ready && !suspended && (interacting || hovered); }
function accelerator(value) {
  if (typeof value !== 'string' || value.length > 100) throw new Error('快捷键格式不正确');
  const parts = value.replace(/CommandOrControl/g, process.platform === 'darwin' ? 'Super' : 'Control').split('+'), key = parts.pop();
  const modifiers = ['CommandOrControl', 'Control', 'Alt', 'Shift', 'Super'];
  if (!parts.length || parts.some(part => !modifiers.includes(part)) || new Set(parts).size !== parts.length || !parts.some(part => part !== 'Shift') || !/^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Left|Right|Up|Down|PageUp|PageDown|Home|End|Space|Escape|Enter)$/.test(key)) throw new Error('快捷键需包含 Ctrl / ⌘、Alt 或系统键，以及一个普通按键');
  return [...modifiers.filter(part => parts.includes(part)), key].join('+');
}
function preferences(input) {
  if (!input || typeof input !== 'object') throw new Error('设置格式不正确');
  const result = {};
  for (const [key, min, max] of [['fontSize', 10, 48], ['backgroundOpacity', 0, 100], ['width', 180, 3840], ['height', 80, 2160]]) {
    if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max) throw new Error(`${key} 超出允许范围 ${min}–${max}`);
    result[key] = input[key];
  }
  for (const key of ['textColor', 'backgroundColor']) { if (typeof input[key] !== 'string' || !/^#[\da-f]{6}$/i.test(input[key])) throw new Error('颜色格式不正确'); result[key] = input[key]; }
  if (typeof input.alwaysOnTop !== 'boolean') throw new Error('置顶设置不正确');
  result.alwaysOnTop = input.alwaysOnTop;
  result.hotkeys = Object.fromEntries(['lock', 'prev', 'next'].map(key => [key, accelerator(input.hotkeys?.[key])]));
  const canonical = Object.values(result.hotkeys).map(key => key.replace(/CommandOrControl/g, process.platform === 'darwin' ? 'Super' : 'Control'));
  if (new Set(canonical).size !== canonical.length) throw new Error('不同功能不能使用相同快捷键');
  return result;
}
function replaceHotkeys(api, oldKeys, newKeys, callbacks) {
  const oldValues = new Set(Object.values(oldKeys)), added = [];
  try { for (const value of new Set(Object.values(newKeys))) { if (oldValues.has(value)) continue;
    if (!api.register(value, () => callbacks.dispatch(value))) throw new Error(`快捷键 ${value} 已被占用或不受系统支持，请换一组`);
    added.push(value);
  } } catch (error) { added.forEach(value => api.unregister(value)); throw error; }
  const current = new Set(Object.values(newKeys));
  for (const value of oldValues) if (!current.has(value)) api.unregister(value);
}
function resized(bounds, start, cursor, edge) {
  let { x, y, width, height } = bounds;
  const dx = cursor.x - start.x, dy = cursor.y - start.y;
  if (edge.includes('e')) width = Math.max(180, Math.min(3840, width + dx));
  if (edge.includes('s')) height = Math.max(80, Math.min(2160, height + dy));
  if (edge.includes('w')) { width = Math.max(180, Math.min(3840, width - dx)); x = bounds.x + bounds.width - width; }
  if (edge.includes('n')) { height = Math.max(80, Math.min(2160, height - dy)); y = bounds.y + bounds.height - height; }
  return { x, y, width, height };
}
module.exports = { DEFAULTS, inside, visibility, accelerator, preferences, replaceHotkeys, resized };
