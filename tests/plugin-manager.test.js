import test from 'node:test';
import assert from 'node:assert/strict';
import { PluginManager } from '../editor/plugin.js';

const createManager = (plugins, enabled = []) => {
  const manager = Object.create(PluginManager.prototype);
  manager.workspace = { addChangeListener() {}, removeChangeListener() {} };
  manager.installedPlugins = plugins;
  manager.enabledPlugins = new Set(enabled);
  manager.plugins = new Map();
  manager.pluginApis = new Map();
  manager.commands = new Map();
  manager.saveState = () => {};
  manager.saveInstalledPlugins = () => {};
  return manager;
};

test('enabled dependents prevent dependency disable and uninstall', async () => {
  const manager = createManager({
    base: { id: 'base', name: 'Base' },
    app: { id: 'app', name: 'App', requiredPlugins: ['base'] },
  }, ['base', 'app']);
  await assert.rejects(manager.disablePlugin('base'), /app/);
  await assert.rejects(manager.uninstallPlugin('base'), /app/);
  assert.ok(manager.installedPlugins.base);
  assert.ok(manager.enabledPlugins.has('base'));
});

test('failed plugin activation leaves no loaded instance or API', async () => {
  globalThis.Blockly = { Blocks: {} };
  globalThis.cleanupCount = 0;
  const manager = createManager({
    broken: {
      id: 'broken', name: 'Broken', apiVersion: '2.0', api: {},
      affectsStyle: true, affectsBlocks: true, requiredPlugins: [],
      script: `class Plugin {
        async onload() { throw new Error('boom'); }
        async onunload() { globalThis.cleanupCount += 1; }
      }`,
    },
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(manager.enablePlugin('broken'), /boom/);
  } finally {
    console.error = originalError;
  }
  assert.equal(globalThis.cleanupCount, 1);
  assert.equal(manager.plugins.has('broken'), false);
  assert.equal(manager.pluginApis.has('broken'), false);
  assert.equal(manager.enabledPlugins.has('broken'), false);
});
