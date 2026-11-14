import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../editor/script.js', import.meta.url), 'utf8');
const editorSource = source.slice(source.indexOf('  const CELL_INPUT_CLASS ='), source.indexOf('  const renderRows ='));
const typeChangeSource = source.slice(source.indexOf('        const nextType = typeSelect.value;'), source.indexOf('        // 値エディタを新しい型'));

test('JSON controls override the later utility styles with a readable touch-safe font', () => {
  const css = readFileSync(new URL('../editor/style.css', import.meta.url), 'utf8');
  assert.match(css, /#jsonGuiModal \.json-gui__cell-input, #jsonGuiModal \.json-gui__cell-select\s*\{[^}]*min-height: 44px;[^}]*font-size: 16px;/);
});

const makeElement = tag => {
  const element = { tagName: tag.toUpperCase(), children: [], listeners: {},
    appendChild(child) { this.children.push(child); },
    addEventListener(name, listener) { this.listeners[name] = listener; },
  };
  if (tag === 'textarea') Object.defineProperty(element, 'type', { get: () => 'textarea' });
  return element;
};

test('all six JSON value editors render with native multiline fields and commit edits', () => {
  const updates = [];
  const context = vm.createContext({
    document: { createElement: makeElement }, selectedDataset: 'main',
    jsonDataStore: { updateRow: (...args) => updates.push(args) }, renderPreview() {}, scheduleSave() {},
  });
  vm.runInContext(`'use strict';\n${editorSource}\nglobalThis.createEditor = createValueEditor;`, context);
  for (const type of ['string', 'object', 'array', 'number', 'boolean', 'null']) {
    const field = context.createEditor({ type, value: type === 'boolean' ? 'true' : '123' }, 2);
    assert.equal(field.tagName, ['string', 'object', 'array'].includes(type) ? 'TEXTAREA' : type === 'boolean' ? 'SELECT' : 'INPUT');
    if (type === 'null') { assert.equal(field.disabled, true); continue; }
    field.value = '456';
    (field.listeners.input || field.listeners.change)();
    assert.equal(updates.at(-1)[0], 'main');
    assert.equal(updates.at(-1)[1], 2);
    assert.equal(updates.at(-1)[2].value, '456');
  }
});

test('switching JSON types reads the latest store value rather than the stale rendered row', () => {
  for (const [type, value, expected] of [['number', '123', '123'], ['number', '0.25', '0.25'],
    ['boolean', 'true', 'true'], ['boolean', 'false', 'false']]) {
    let update;
    vm.runInNewContext(typeChangeSource, {
      typeSelect: { value: type }, row: { value: 'old text' }, index: 0, selectedDataset: 'main',
      jsonDataStore: { getRows: () => [{ value }], updateRow: (_name, _index, patch) => { update = patch; } },
    });
    assert.equal(update.type, type);
    assert.equal(update.value, expected);
  }
});
