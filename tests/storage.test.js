import test from 'node:test';
import assert from 'node:assert/strict';
import WorkspaceStorage from '../editor/storage.js';

function projectHarness(extra = {}) {
  const workspace = {
    state: { blocks: { languageVersion: 0, blocks: [] } }, extra: structuredClone(extra),
    getExtraState() { return this.extra; },
    setExtraState(value) {
      this.extra = structuredClone(value);
      if (value.brokenExtra) throw new Error('invalid extra state');
    },
  };
  const saved = new Map();
  globalThis.localStorage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  globalThis.window = { LZString: {
    compressToEncodedURIComponent: value => value,
    decompressFromEncodedURIComponent: value => value,
  } };
  globalThis.Blockly = {
    Events: { disable() {}, enable() {} },
    Xml: { textToDom: value => value, clearWorkspaceAndLoadFromXml: (_, ws) => { ws.state = {}; } },
    serialization: { workspaces: {
      save: ws => structuredClone(ws.state),
      load: (state, ws) => {
        ws.state = structuredClone(state);
        delete ws.state.edbbExtraState; // Blockly ignores unknown serializer keys.
        if (state.broken) throw new Error('invalid workspace');
      },
    } },
  };
  return { workspace, storage: new WorkspaceStorage(workspace) };
}

const projectExtra = {
  edbb_list_store: { lists: [{ id: 'list-id', items: ['one'] }] },
  edbb_json_store: { datasets: [{ name: 'data', data: { score: 5 } }] },
  edbbBotSettings: { commandPrefix: '?', members: true },
};

test('JSON files, autosave and shared links round-trip all project data', async () => {
  const { workspace, storage } = projectHarness(projectExtra);
  const file = storage.exportText();
  const shared = storage.exportMinified();
  assert.deepEqual(JSON.parse(file).edbbExtraState, projectExtra);
  assert.equal(storage.save(), true);
  workspace.extra = { stale: true };
  assert.equal(storage.importText(file), true);
  assert.deepEqual(workspace.extra, projectExtra);
  workspace.extra = { stale: true };
  assert.equal(storage.load(), true);
  assert.deepEqual(workspace.extra, projectExtra);
  workspace.extra = { stale: true };
  assert.equal(await storage.importMinified(shared), true);
  assert.deepEqual(workspace.extra, projectExtra);
});

test('legacy JSON, XML and shared projects clear unrelated extra data', async () => {
  const { workspace, storage } = projectHarness(projectExtra);
  assert.equal(storage.importText('{"blocks":{}}'), true);
  assert.deepEqual(workspace.extra, {});
  workspace.extra = structuredClone(projectExtra);
  assert.equal(storage.importText('<xml></xml>'), true);
  assert.deepEqual(workspace.extra, {});
  workspace.extra = structuredClone(projectExtra);
  assert.equal(await storage.importMinified('{"workspace":{"blocks":{}}}'), true);
  assert.deepEqual(workspace.extra, {});
});

test('legacy autosaves migrate browser-local JSON data instead of deleting it', () => {
  const { workspace, storage } = projectHarness(projectExtra);
  localStorage.setItem(WorkspaceStorage.STORAGE_KEY, '{"blocks":{}}');
  assert.equal(storage.load(), true);
  assert.deepEqual(workspace.extra, projectExtra);
  const migrated = JSON.parse(localStorage.getItem(WorkspaceStorage.STORAGE_KEY));
  assert.deepEqual(migrated.edbbExtraState, projectExtra);
});

test('legacy XML imports use the Blockly 11 XML parser', () => {
  const { workspace, storage } = projectHarness(projectExtra);
  delete Blockly.Xml.textToDom;
  Blockly.utils = { xml: { textToDom: text => text } };
  assert.equal(storage.importText('<xml></xml>'), true);
  assert.deepEqual(workspace.extra, {});
});

test('project serializer loads dropdown data after variables but before blocks', () => {
  const { workspace } = projectHarness(projectExtra);
  const serializers = new Map();
  Blockly.serialization.priorities = { VARIABLES: 100, BLOCKS: 50 };
  Blockly.serialization.registry = { register: (name, serializer) => serializers.set(name, serializer) };
  const storage = new WorkspaceStorage(workspace);
  new WorkspaceStorage(workspace);
  assert.equal(serializers.size, 1, 'register only once for each Blockly registry');
  const serializer = serializers.get('edbbExtraState');
  assert.ok(serializer.priority > Blockly.serialization.priorities.BLOCKS);
  assert.ok(serializer.priority < Blockly.serialization.priorities.VARIABLES);
  serializer.clear(workspace);
  assert.deepEqual(workspace.extra, {});
  serializer.load(projectExtra, workspace);
  assert.deepEqual(serializer.save(workspace), projectExtra);
  assert.deepEqual(JSON.parse(storage.exportText()).edbbExtraState, projectExtra);
});

test('failed extra-state restoration rolls back blocks and all project data', async () => {
  const { workspace, storage } = projectHarness(projectExtra);
  const before = structuredClone(workspace.state);
  const malformed = { blocks: {}, edbbExtraState: { brokenExtra: true } };
  assert.equal(storage.importText(JSON.stringify(malformed)), false);
  assert.deepEqual(workspace.state, before);
  assert.deepEqual(workspace.extra, projectExtra);
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await storage.importMinified(JSON.stringify({ workspace: malformed })), false);
  } finally { console.error = originalError; }
  assert.deepEqual(workspace.state, before);
  assert.deepEqual(workspace.extra, projectExtra);
});

test('unavailable browser storage cannot abort editor startup', () => {
  const { storage } = projectHarness();
  globalThis.localStorage.getItem = () => { throw new Error('storage blocked'); };
  const originalError = console.error;
  console.error = () => {};
  try { assert.equal(storage.load(), false); }
  finally { console.error = originalError; }
});

test('shared import reports failure and restores the previous workspace', async () => {
  const workspace = { state: { original: true } };
  globalThis.window = { LZString: { decompressFromEncodedURIComponent: () => JSON.stringify({ workspace: { broken: true } }) } };
  globalThis.Blockly = {
    Events: { disable() {}, enable() {} },
    serialization: { workspaces: {
      save: ws => structuredClone(ws.state),
      load: (state, ws) => {
        ws.state = structuredClone(state);
        if (state.broken) throw new Error('invalid workspace');
      }
    } }
  };
  const storage = new WorkspaceStorage(workspace);
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await storage.importMinified('payload'), false);
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(workspace.state, { original: true });
});

test('file text import is atomic when Blockly loading fails', () => {
  const workspace = { state: { original: true } };
  globalThis.Blockly = {
    serialization: { workspaces: {
      save: ws => structuredClone(ws.state),
      load: (state, ws) => {
        ws.state = structuredClone(state);
        if (state.broken) throw new Error('invalid workspace');
      }
    } }
  };
  const storage = new WorkspaceStorage(workspace);
  assert.equal(storage.importText('{"broken":true}'), false);
  assert.deepEqual(workspace.state, { original: true });
});
