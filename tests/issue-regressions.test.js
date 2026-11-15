import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

test('Blockly 11 uses a compatible multiline input plugin and no deprecated number API', async () => {
  const editorHtml = await read('editor/index.html');
  assert.match(editorHtml, /@blockly\/field-multilineinput@5\.0\.17/);

  const blockDirectory = path.join(root, 'editor', 'blocks');
  const blockFiles = (await readdir(blockDirectory)).filter((name) => name.endsWith('.js'));
  const sources = await Promise.all(blockFiles.map((name) => readFile(path.join(blockDirectory, name), 'utf8')));
  assert.equal(sources.some((source) => /Blockly\.isNumber\b/.test(source)), false);
});

test('control flow, pane resizing, and bottom mobile controls remain exposed without a settings form', async () => {
  const [editorHtml, style, blockCore] = await Promise.all([
    read('editor/index.html'),
    read('editor/style.css'),
    read('editor/blocks/core.js'),
  ]);
  assert.match(editorHtml, /type="controls_flow_statements"/);
  assert.match(editorHtml, /type="flow_return_value"/);
  assert.doesNotMatch(editorHtml, /id="botSettings(?:Modal|Btn)"|id="mobileHeaderToggle"/);
  assert.match(editorHtml, /id="mobileActionsModal"/);
  assert.match(editorHtml, /id="workspaceResizeHandle"/);
  assert.match(editorHtml, /id="mobileActionDock"/);
  assert.match(style, /#workspaceResizeHandle/);
  assert.match(blockCore, /setHat\('cap'\)/);
});

test('terms page covers Discord rules, secrets, generated code, and third-party plugins', async () => {
  const terms = await read('terms.html');
  assert.match(terms, /Discord Developer Policy/);
  assert.match(terms, /トークン等の安全管理/);
  assert.match(terms, /生成コードとBotの運用/);
  assert.match(terms, /プラグイン・外部サービス/);
});
