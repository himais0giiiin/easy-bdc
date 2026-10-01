import test from 'node:test';
import assert from 'node:assert/strict';
import WorkspaceStorage from '../editor/storage.js';

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
