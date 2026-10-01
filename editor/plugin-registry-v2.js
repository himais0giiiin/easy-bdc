/**
 * Stable plugin discovery/state layer.
 *
 * This module intentionally has no DOM or Blockly dependency. It is used by
 * the editor and can also be imported by tests and tooling.
 */
export const PLUGIN_REGISTRY_SCHEMA = 2;
export const PLUGIN_API_VERSIONS = new Set(['1', '1.0', '1.1', '2', '2.0', '2.0.0']);

export function safeParseJson(value, fallback) {
  try { return value == null ? fallback : JSON.parse(value); } catch (_) { return fallback; }
}

export function normalizePluginId(value) {
  const id = String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');
  return id.slice(0, 96);
}

export function semver(value) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9a-z.-]+)?$/i);
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null;
}

export function compareVersions(a, b) {
  const left = semver(a) || { major: 0, minor: 0, patch: 0 };
  const right = semver(b) || { major: 0, minor: 0, patch: 0 };
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

export function validatePluginManifestV2(manifest, { currentAppVersion = '1.1.0' } = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { valid: false, errors: ['manifest must be an object'], warnings: [] };
  if (!normalizePluginId(manifest.id || manifest.name)) errors.push('id or name is required');
  for (const field of ['name', 'version', 'author']) if (typeof manifest[field] !== 'string' || !manifest[field].trim()) errors.push(`${field} is required`);
  if (!semver(manifest.version)) errors.push('version must use major.minor.patch');
  if (manifest.apiVersion !== undefined && !PLUGIN_API_VERSIONS.has(String(manifest.apiVersion))) errors.push('apiVersion must be 2.0 for new plugins');
  for (const field of ['affectsStyle', 'affectsBlocks']) if (manifest[field] !== undefined && typeof manifest[field] !== 'boolean') errors.push(`${field} must be boolean`);
  for (const field of ['requiredPlugins', 'pipInstall', 'externalPackages', 'permissions']) {
    if (manifest[field] !== undefined && (!Array.isArray(manifest[field]) || manifest[field].some(item => typeof item !== 'string' || !item.trim()))) errors.push(`${field} must be an array of strings`);
  }
  if (manifest.entry !== undefined && typeof manifest.entry !== 'string') errors.push('entry must be a string');
  if (manifest.api !== undefined && (!manifest.api || typeof manifest.api !== 'object' || Array.isArray(manifest.api))) errors.push('api must be an object');
  if (manifest.api?.baseUrl && !/^https?:\/\//i.test(manifest.api.baseUrl)) errors.push('api.baseUrl must be an http(s) URL');
  if (manifest.minAppVersion && !semver(manifest.minAppVersion)) errors.push('minAppVersion must use major.minor.patch');
  if (manifest.minAppVersion && semver(manifest.minAppVersion) && compareVersions(currentAppVersion, manifest.minAppVersion) < 0) errors.push(`requires EDBP ${manifest.minAppVersion} or newer`);
  return { valid: errors.length === 0, errors, warnings: [] };
}

export function normalizePluginManifest(input, source = 'local') {
  const manifest = { ...(input || {}) };
  const id = normalizePluginId(manifest.id || manifest.name);
  return {
    ...manifest,
    id,
    // Keep generated identities stable across plugin version updates.
    uuid: String(manifest.uuid || (id ? `edbp-${id}` : '')).slice(0, 160),
    apiVersion: manifest.apiVersion ? String(manifest.apiVersion) : '1.0',
    source: manifest.source || source,
    installedFrom: manifest.installedFrom ?? (source === 'github' ? 1 : 0),
    requiredPlugins: Array.from(new Set((Array.isArray(manifest.requiredPlugins) ? manifest.requiredPlugins : []).map(normalizePluginId).filter(Boolean))),
    blockTypes: Array.from(new Set(Array.isArray(manifest.blockTypes) ? manifest.blockTypes.filter(Boolean).map(String) : []))
  };
}

export function resolvePluginOrder(records, enabledIds) {
  const enabled = new Set([...enabledIds].map(normalizePluginId));
  const order = [], visiting = new Set(), visited = new Set(), cycles = [], missing = [];
  const visit = (id, chain = []) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) { cycles.push([...chain, id]); return; }
    const record = records[id];
    if (!record) { missing.push({ plugin: id, requiredBy: chain.at(-1) || null }); return; }
    visiting.add(id);
    for (const dependency of record.requiredPlugins || []) {
      if (enabled.has(dependency)) visit(dependency, [...chain, id]);
      else missing.push({ plugin: dependency, requiredBy: id, reason: records[dependency] ? 'disabled' : 'not-installed' });
    }
    visiting.delete(id); visited.add(id); order.push(id);
  };
  enabled.forEach(id => visit(id));
  return { order, cycles, missing };
}

export function createRegistryState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const plugins = {};
  const collisionWarnings = [];
  Object.entries(source.plugins && typeof source.plugins === 'object' ? source.plugins : source).forEach(([key, value]) => {
    if (!value || typeof value !== 'object') return;
    const plugin = normalizePluginManifest({ ...value, id: value.id || value.name || key }, value.source || (value.installedFrom === 1 ? 'github' : 'local'));
    if (!plugin.id) return;
    if (plugins[plugin.id] && plugins[plugin.id].uuid !== plugin.uuid) collisionWarnings.push(`duplicate plugin id: ${plugin.id}`);
    plugins[plugin.id] = plugin;
  });
  const enabledRaw = Array.isArray(source.enabled) ? source.enabled : [];
  const enabled = new Set(enabledRaw.map(normalizePluginId).filter(id => plugins[id]));
  return { schema: PLUGIN_REGISTRY_SCHEMA, plugins, enabled, collisionWarnings };
}

export function registryDiagnostics(state, currentAppVersion = '1.1.0') {
  const invalid = [], ids = new Set();
  Object.values(state.plugins).forEach(plugin => {
    if (String(plugin.apiVersion || '').startsWith('2')) {
      const validation = validatePluginManifestV2(plugin, { currentAppVersion });
      if (!validation.valid) invalid.push({ id: plugin.id, errors: validation.errors });
    }
    if (ids.has(plugin.id)) invalid.push({ id: plugin.id, errors: ['duplicate id'] });
    ids.add(plugin.id);
  });
  const dependency = resolvePluginOrder(state.plugins, state.enabled);
  return { invalid, collisionWarnings: state.collisionWarnings, cycles: dependency.cycles, missingDependencies: dependency.missing };
}
