import test from 'node:test';
import assert from 'node:assert/strict';
import { setupEditorActions } from '../editor/editor-actions.js';

test('history buttons follow stacks and cannot mutate shared or collaborative workspaces', () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const nodes = Object.fromEntries(['undoBtn', 'redoBtn', 'mobileUndoBtn', 'mobileRedoBtn', 'editorSettingsBtn'].map(id => [id, {
    disabled: false, addEventListener(type, fn) { this[type] = fn; },
  }]));
  const events = {};
  globalThis.document = { getElementById: id => nodes[id] };
  globalThis.window = { addEventListener: (type, fn) => { events[type] = fn; } };
  const undo = ['change']; const redo = [];
  const calls = [];
  let viewOnly = false; let onShare; let onCollab; let settings = false;
  const collab = { status: 'disconnected', onStateChange(fn) { onCollab = fn; } };
  try {
    setupEditorActions({
      workspace: { getUndoStack: () => undo, getRedoStack: () => redo, addChangeListener() {},
        undo(forward) { calls.push(forward); (forward ? undo : redo).push((forward ? redo : undo).pop()); } },
      shareFeature: { isShareViewMode: () => viewOnly, onShareViewModeChange(fn) { onShare = fn; } },
      collabManager: collab, pluginUI: { openSettingsModal() { settings = true; } },
    });
    assert.equal(nodes.redoBtn.disabled, true);
    nodes.undoBtn.click();
    assert.deepEqual(calls, [false]);
    assert.equal(nodes.mobileUndoBtn.disabled, true);
    assert.equal(nodes.redoBtn.disabled, false);
    viewOnly = true; onShare(); nodes.redoBtn.click();
    assert.deepEqual(calls, [false]);
    assert.equal(nodes.redoBtn.disabled, true);
    viewOnly = false; collab.status = 'connected'; onCollab(); nodes.redoBtn.click();
    assert.deepEqual(calls, [false]);
    collab.status = 'disconnected'; onCollab(); nodes.redoBtn.click();
    assert.deepEqual(calls, [false, true]);
    undo.length = 0; events['edbb-workspace-loaded']();
    assert.equal(nodes.undoBtn.disabled, true);
    nodes.editorSettingsBtn.click(); assert.equal(settings, true);
  } finally { globalThis.document = previousDocument; globalThis.window = previousWindow; }
});
