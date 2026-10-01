import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRegistryState,
  normalizePluginManifest,
  normalizePluginId,
  resolvePluginOrder,
  registryDiagnostics,
  validatePluginManifestV2
} from '../editor/plugin-registry-v2.js';
import { PluginManager } from '../editor/plugin.js';

test('normalizes IDs and recovers malformed registry entries', () => {
  assert.equal(normalizePluginId('  My Cool Plugin!! '), 'my-cool-plugin');
  const state = createRegistryState({ plugins: { 'Legacy Key': { name: 'Example', version: '1.0.0', author: 'A' }, broken: null }, enabled: ['Example', 'missing'] });
  assert.ok(state.plugins.example);
  assert.deepEqual([...state.enabled], ['example']);
});

test('resolves dependencies before dependents', () => {
  const state = createRegistryState({ plugins: { app: { id: 'app', name: 'App', version: '1.0.0', author: 'A', requiredPlugins: ['base'] }, base: { id: 'base', name: 'Base', version: '1.0.0', author: 'A' } }, enabled: ['app', 'base'] });
  assert.deepEqual(resolvePluginOrder(state.plugins, state.enabled).order, ['base', 'app']);
});

test('reports an installed but disabled required plugin', () => {
  const state = createRegistryState({ plugins: { app: { id: 'app', name: 'App', version: '1.0.0', author: 'A', requiredPlugins: ['base'] }, base: { id: 'base', name: 'Base', version: '1.0.0', author: 'A' } }, enabled: ['app'] });
  assert.deepEqual(resolvePluginOrder(state.plugins, state.enabled).missing, [
    { plugin: 'base', requiredBy: 'app', reason: 'disabled' }
  ]);
});

test('generated plugin UUID remains stable across version updates', () => {
  const first = normalizePluginManifest({ id: 'demo', name: 'Demo', version: '1.0.0', author: 'A' });
  const second = normalizePluginManifest({ id: 'demo', name: 'Demo', version: '2.0.0', author: 'A' });
  assert.equal(first.uuid, second.uuid);
});

test('normalized legacy V1 manifests remain installable', () => {
  const manifest = normalizePluginManifest({
    name: 'Legacy', version: '1.0.0', author: 'A',
    affectsStyle: false, affectsBlocks: false, minAppVersion: '1.0.0'
  }, 'github');
  const result = PluginManager.prototype.validateManifest.call({ warnDeprecatedLicense() {} }, manifest);
  assert.equal(result.valid, true);
});

test('reports missing dependencies and cycles', () => {
  const state = createRegistryState({ plugins: { a: { id: 'a', name: 'A', version: '1.0.0', author: 'A', requiredPlugins: ['b'] }, b: { id: 'b', name: 'B', version: '1.0.0', author: 'A', requiredPlugins: ['a'] } }, enabled: ['a', 'b'] });
  assert.ok(registryDiagnostics(state).cycles.length > 0);
});

test('validates the V2 manifest contract', () => {
  assert.equal(validatePluginManifestV2({ id: 'x', name: 'X', version: '1.0.0', apiVersion: '2.0', author: 'A', minAppVersion: '1.1.0' }).valid, true);
  assert.equal(validatePluginManifestV2({ name: 'X', version: 'bad', apiVersion: '2.0', author: 'A' }).valid, false);
});
