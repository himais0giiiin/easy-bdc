import test from 'node:test';
import assert from 'node:assert/strict';
import { createPluginAPI } from '../editor/plugin-api-v2.js';

test('block override restores both the old definition and generator', () => {
  const oldBlock = { old: true };
  const oldGenerator = () => ['old', 0];
  globalThis.Blockly = { Blocks: { demo: oldBlock }, Python: { forBlock: { demo: oldGenerator } } };
  const api = createPluginAPI({ manifest: { id: 'test', affectsBlocks: true } });
  api.block('demo', { current: true }, () => ['new', 0], { override: true });
  api.dispose();
  assert.equal(globalThis.Blockly.Blocks.demo, oldBlock);
  assert.equal(globalThis.Blockly.Python.forBlock.demo, oldGenerator);
});

test('failed generator lookup leaves no partial block registration', () => {
  globalThis.Blockly = { Blocks: {} };
  const api = createPluginAPI({ manifest: { id: 'test', affectsBlocks: true } });
  assert.throws(() => api.block('demo', {}, () => {}, { language: 'Missing' }), /not available/);
  assert.equal(Object.hasOwn(globalThis.Blockly.Blocks, 'demo'), false);
});

test('block capabilities and global command ownership are enforced', () => {
  globalThis.Blockly = { Blocks: {}, Python: { forBlock: {} } };
  const commands = new Map();
  const manager = {
    registerCommand(id, command, owner) {
      const existing = commands.get(id);
      if (existing && existing.owner !== owner) throw new Error('collision');
      commands.set(id, { ...command, owner });
    },
    unregisterCommand(id, owner) { if (commands.get(id)?.owner === owner) commands.delete(id); }
  };
  const denied = createPluginAPI({ manifest: { id: 'denied', affectsBlocks: false }, manager });
  assert.throws(() => denied.block('demo', {}), /affectsBlocks/);
  assert.throws(() => denied.ui.element('div'), /affectsStyle/);
  const first = createPluginAPI({ manifest: { id: 'first' }, manager });
  const second = createPluginAPI({ manifest: { id: 'second' }, manager });
  first.command('shared', () => 1);
  assert.throws(() => second.command('shared', () => 2), /collision/);
  first.dispose();
  second.command('shared', () => 2);
  second.dispose();
});
