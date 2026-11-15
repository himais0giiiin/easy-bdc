import test from 'node:test';
import assert from 'node:assert/strict';
import { setupProjectUI } from '../editor/project-ui.js';

function fixture() {
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  class Node {
    constructor() { this.value = ''; this.listeners = {}; }
    append() {} setAttribute() {} addEventListener(type, fn) { this.listeners[type] = fn; }
  }
  const nodes = new Map(['projectTitleInput', 'newProjectBtn', 'importBtn', 'projectsBtn'].map(id => [id, new Node()]));
  nodes.get('projectTitleInput').value = '移行したBot';
  globalThis.document = { createElement: () => new Node(), body: new Node(), getElementById: id => nodes.get(id) };
  globalThis.window = { addEventListener() {} };
  globalThis.Blockly = { Blocks: {}, Events: { disable() {}, enable() {} } };
  const workspace = { state: '{"blocks":{},"edbbExtraState":{"edbb_json_store":{"data":{"note":"元のデータ"}}}}', clearUndo() {} };
  let handler;
  let legacyLoads = 0;
  const storage = { exportText: () => workspace.state, importText: state => { workspace.state = state; return true; },
    load: () => { legacyLoads++; }, setSaveHandler: fn => { handler = fn; }, save: () => handler?.(workspace.state) ?? true };
  let shareView = false;
  const shareListeners = [];
  const shareFeature = { isShareViewMode: () => shareView, applyUiState() {},
    onShareViewModeChange: fn => { shareListeners.push(fn); fn(shareView); } };
  const collabListeners = [];
  const collabManager = { status: 'disconnected', initialLocalBackup: null, onStateChange: fn => collabListeners.push(fn) };
  const controller = setupProjectUI({ workspace, storage, shareFeature, collabManager, onLoad() {} });
  return { ...controller, workspace, storage, nodes, values, get legacyLoads() { return legacyLoads; },
    title: value => { nodes.get('projectTitleInput').value = value; },
    share(value) { shareView = value; shareListeners.forEach(fn => fn(value)); },
    status(status, isHost = false) { collabManager.status = status; collabListeners.forEach(fn => fn('status_change', { status, isHost })); },
    resume(restored) { collabListeners.forEach(fn => fn('local_edit_resumed', { restored })); },
  };
}

test('startup migrates legacy state once and shared-view changes cannot overwrite local projects', () => {
  const f = fixture();
  assert.equal(f.legacyLoads, 1);
  const original = f.library.active;
  f.share(true);
  f.workspace.state = '{"shared":true}'; f.title('共有の作品');
  f.storage.save();
  assert.deepEqual(f.library.active, original);
  assert.throws(() => f.checkpoint('test'), /共有/);
  assert.equal(f.nodes.get('newProjectBtn').disabled, true);
  assert.equal(f.nodes.get('importBtn').disabled, true);
});

test('guest entry flushes latest edits and keeping a room creates a separate project', () => {
  const f = fixture(); const originalId = f.library.active.id;
  const lastEdit = '{"latestLocalEdit":true}';
  f.workspace.state = lastEdit;
  f.status('connecting');
  assert.equal(f.library.active.state, lastEdit);
  f.workspace.state = '{"roomData":{"note":"共同編集のデータ"}}'; f.title('共同編集Bot');
  f.status('connected'); f.storage.save();
  assert.equal(f.library.active.state, lastEdit);
  f.status('disconnected'); f.storage.save();
  assert.equal(f.library.active.id, originalId);
  f.resume(false);
  assert.notEqual(f.library.active.id, originalId);
  assert.equal(f.library.get(originalId).state, lastEdit);
  assert.equal(f.library.active.state, f.workspace.state);
  assert.match(f.library.active.title, /共同編集/);
  assert.equal(f.nodes.get('newProjectBtn').disabled, false);
});

test('failed guest joins and restoring the pre-room backup return to local saving', () => {
  const f = fixture(); const original = f.library.active;
  f.status('connecting'); f.status('disconnected');
  assert.equal(f.nodes.get('newProjectBtn').disabled, false);
  f.workspace.state = '{"editAfterFailure":true}'; f.storage.save();
  assert.equal(f.library.active.state, f.workspace.state);
  f.status('connecting'); f.status('connected');
  f.workspace.state = '{"remote":true}'; f.storage.save(); f.status('disconnected');
  f.workspace.state = original.state; f.title(original.title); f.resume(true);
  assert.equal(f.library.list().length, 1);
  assert.equal(f.library.active.state, original.state);
});
