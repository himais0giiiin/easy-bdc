/**
 * EDBP Plugin API 2.0
 *
 * A capability based facade around the editor.  V2 plugins receive this
 * object as their first constructor argument and can keep all registrations
 * disposable.  The old Plugin(workspace) contract remains supported by the
 * plugin manager.
 */
export const EDBP_PLUGIN_API_VERSION = '2.0.0';

const asArray = (value) => Array.isArray(value) ? value : [];

class DisposableScope {
  constructor() { this.items = new Set(); this.closed = false; }
  add(dispose) {
    if (typeof dispose !== 'function') return dispose;
    if (this.closed) { try { dispose(); } catch (_) {} }
    else this.items.add(dispose);
    return dispose;
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    [...this.items].reverse().forEach((dispose) => { try { dispose(); } catch (error) { console.warn('[EDBP] plugin cleanup failed', error); } });
    this.items.clear();
  }
}

class EventBus {
  constructor(scope) { this.scope = scope; this.listeners = new Map(); }
  on(name, handler) {
    if (typeof handler !== 'function') throw new TypeError('event handler must be a function');
    const key = String(name);
    const set = this.listeners.get(key) || new Set();
    set.add(handler); this.listeners.set(key, set);
    const off = () => set.delete(handler);
    return this.scope.add(off);
  }
  once(name, handler) {
    let off = () => {};
    off = this.on(name, (...args) => { off(); return handler(...args); });
    return off;
  }
  emit(name, ...args) {
    const handlers = [...(this.listeners.get(String(name)) || [])];
    handlers.forEach((handler) => { try { handler(...args); } catch (error) { console.error(`[EDBP] plugin event '${name}' failed`, error); } });
  }
  clear() { this.listeners.clear(); }
}

export class EDBPPluginAPI {
  constructor({ workspace, manifest = {}, manager = null } = {}) {
    this.workspace = workspace;
    this.manifest = Object.freeze({ ...manifest });
    this.manager = manager;
    this.id = String(manifest.id || manifest.name || 'plugin');
    this.version = EDBP_PLUGIN_API_VERSION;
    this.scope = new DisposableScope();
    this.events = new EventBus(this.scope);
    this._commands = new Map();
    this._generators = new Map();
    this._blocks = new Set();
    this._toolboxEntries = [];
    this._settingsKey = `edbp:plugin:${this.id}:settings`;
    this.capabilities = Object.freeze({
      ui: manifest.affectsStyle === true,
      blocks: manifest.affectsBlocks === true,
      network: !!manifest.api,
      permissions: Object.freeze(asArray(manifest.permissions).slice())
    });

    this.log = ['debug', 'info', 'warn', 'error'].reduce((out, level) => {
      out[level] = (...args) => console[level](`[EDBP:${this.id}]`, ...args);
      return out;
    }, {});

    this.storage = {
      get: (key, fallback = null) => {
        try { const value = globalThis.localStorage?.getItem(`${this._settingsKey}:${key}`); return value === null || value === undefined ? fallback : JSON.parse(value); } catch (_) { return fallback; }
      },
      set: (key, value) => { globalThis.localStorage?.setItem(`${this._settingsKey}:${key}`, JSON.stringify(value)); this.events.emit('storage:change', key, value); return value; },
      remove: (key) => globalThis.localStorage?.removeItem(`${this._settingsKey}:${key}`),
      clear: () => Object.keys(globalThis.localStorage || {}).filter((key) => key.startsWith(`${this._settingsKey}:`)).forEach((key) => globalThis.localStorage.removeItem(key))
    };

    this.ui = {
      toast: (message, options = {}) => {
        this.events.emit('ui:toast', { message: String(message), ...options });
        if (typeof window !== 'undefined' && typeof window.showTopRightToast === 'function') window.showTopRightToast(String(message), options.type || 'info');
      },
      element: (tag = 'div', props = {}) => {
        if (!this.capabilities.ui) throw new Error('UI element creation requires affectsStyle=true');
        if (typeof document === 'undefined') return null;
        const element = document.createElement(tag);
        Object.entries(props).forEach(([key, value]) => key === 'text' ? element.textContent = value : element.setAttribute(key, value));
        this.scope.add(() => element.remove());
        return element;
      },
      addStyle: (css) => {
        if (!this.capabilities.ui) throw new Error('Style registration requires affectsStyle=true');
        if (typeof document === 'undefined') return () => {};
        const style = document.createElement('style');
        style.dataset.edbpPlugin = this.id;
        style.textContent = String(css);
        document.head.appendChild(style);
        return this.scope.add(() => style.remove());
      }
    };

    this.workspaceApi = {
      get: () => this.workspace,
      refresh: () => this.workspace?.resize?.(),
      clear: () => this.workspace?.clear?.(),
      save: () => globalThis.Blockly?.serialization?.workspaces?.save?.(this.workspace),
      load: (data, options = {}) => globalThis.Blockly?.serialization?.workspaces?.load?.(data, this.workspace, options),
      getSelected: () => this.workspace?.getSelected?.(),
      onChange: (handler) => this.events.on('workspace:change', handler)
    };

    this.network = { request: (url, options = {}) => this.request(url, options) };
    this.http = this.network;
    this.settings = this.storage;
    this.blocks = {
      register: (type, definition, generator, options) => this.block(type, definition, generator, options),
      unregister: (type) => this._unregisterBlock(type)
    };
    this.codegen = { register: (language, type, handler) => this.generator(language, type, handler) };
    this.project = {
      export: () => this.workspaceApi.save(),
      import: (data) => this.workspaceApi.load(data),
      getName: () => this.workspace?.__edbpProjectName || '',
      setName: (name) => { if (this.workspace) this.workspace.__edbpProjectName = String(name || ''); this.events.emit('project:name', String(name || '')); }
    };
    this.collaboration = {
      on: (event, handler) => this.on(`collab:${event}`, handler),
      emit: (event, payload) => this.emit(`collab:${event}`, payload)
    };

    const changeListener = (event) => this.events.emit('workspace:change', event);
    this.workspace?.addChangeListener?.(changeListener);
    this.scope.add(() => this.workspace?.removeChangeListener?.(changeListener));
  }

  on(name, handler) { return this.events.on(name, handler); }
  once(name, handler) { return this.events.once(name, handler); }
  emit(name, ...args) { this.events.emit(name, ...args); }
  use(disposable) { return this.scope.add(disposable); }

  _unregisterBlock(type) {
    const item = [...this._blocks].find((entry) => entry.type === String(type));
    if (!item) return false;
    if (item.previous) globalThis.Blockly.Blocks[item.type] = item.previous;
    else delete globalThis.Blockly.Blocks[item.type];
    const target = globalThis.Blockly[item.language];
    if (target?.forBlock) {
      if (item.hadPreviousGenerator) target.forBlock[item.type] = item.previousGenerator;
      else delete target.forBlock[item.type];
    }
    this._blocks.delete(item);
    return true;
  }

  command(id, handler, options = {}) {
    const key = String(id);
    if (this._commands.has(key)) throw new Error(`Command already registered: ${key}`);
    if (typeof handler !== 'function') throw new TypeError('command handler must be a function');
    const command = { handler, ...options };
    this.manager?.registerCommand?.(key, command, this.id);
    this._commands.set(key, command);
    const dispose = () => this._commands.delete(key);
    this.scope.add(dispose);
    this.scope.add(() => this.manager?.unregisterCommand?.(key, this.id));
    return dispose;
  }

  async executeCommand(id, ...args) {
    const command = this._commands.get(String(id)) || this.manager?.getCommand?.(String(id));
    if (!command) throw new Error(`Unknown command: ${id}`);
    return command.handler(...args);
  }

  block(type, definition, generator, options = {}) {
    if (!globalThis.Blockly) throw new Error('Blockly is not available');
    if (!this.capabilities.blocks) throw new Error('Block registration requires affectsBlocks=true');
    if (globalThis.Blockly.Blocks[type] && !options.override) throw new Error(`Block already registered: ${type}`);
    const language = options.language || 'Python';
    const target = generator ? globalThis.Blockly[language] : null;
    if (generator && !target) throw new Error(`Blockly generator not available: ${language}`);
    const previous = globalThis.Blockly.Blocks[type];
    const hadPreviousGenerator = !!target?.forBlock && Object.prototype.hasOwnProperty.call(target.forBlock, type);
    const previousGenerator = hadPreviousGenerator ? target.forBlock[type] : undefined;
    globalThis.Blockly.Blocks[type] = definition;
    if (generator) {
      target.forBlock ||= {};
      target.forBlock[type] = generator;
    }
    this._blocks.add({ type, language, previous, hadPreviousGenerator, previousGenerator });
    const dispose = () => this._unregisterBlock(type);
    return this.scope.add(dispose);
  }

  toolbox(entry) {
    if (!this.capabilities.blocks) throw new Error('Toolbox registration requires affectsBlocks=true');
    this._toolboxEntries.push(entry);
    const toolbox = this.workspace?.options?.languageTree;
    try {
      if (toolbox?.contents && typeof entry === 'object') {
        if (!toolbox.contents.some((item) => item?.name === entry.name)) toolbox.contents.push(entry);
        this.workspace.updateToolbox?.(toolbox);
      } else if (toolbox?.nodeType && typeof document !== 'undefined' && entry?.name) {
        const category = document.createElement('category');
        category.setAttribute('name', entry.name);
        if (entry.colour !== undefined) category.setAttribute('colour', entry.colour);
        asArray(entry.contents).forEach((item) => {
          if (item?.type) { const block = document.createElement('block'); block.setAttribute('type', item.type); category.appendChild(block); }
        });
        toolbox.appendChild(category); this.workspace.updateToolbox?.(toolbox);
      }
    } catch (error) { this.log.warn('toolbox registration failed', error); }
    this.events.emit('toolbox:add', entry);
    return this.scope.add(() => {
      const index = this._toolboxEntries.indexOf(entry); if (index >= 0) this._toolboxEntries.splice(index, 1);
      try {
        if (toolbox?.contents) { const itemIndex = toolbox.contents.indexOf(entry); if (itemIndex >= 0) toolbox.contents.splice(itemIndex, 1); this.workspace.updateToolbox?.(toolbox); }
        else if (toolbox?.querySelector) { const category = [...toolbox.querySelectorAll('category')].find((node) => node.getAttribute('name') === entry?.name); category?.remove(); this.workspace.updateToolbox?.(toolbox); }
      } catch (error) { this.log.warn('toolbox cleanup failed', error); }
      this.events.emit('toolbox:remove', entry);
    });
  }

  generator(language, type, handler) {
    if (!this.capabilities.blocks) throw new Error('Generator registration requires affectsBlocks=true');
    const target = globalThis.Blockly?.[language];
    if (!target) throw new Error(`Blockly generator not available: ${language}`);
    target.forBlock ||= {};
    const previous = target.forBlock[type]; target.forBlock[type] = handler;
    return this.scope.add(() => { if (previous) target.forBlock[type] = previous; else delete target.forBlock[type]; });
  }

  async request(url, options = {}) {
    const baseUrl = this.manifest.api?.baseUrl;
    if (!baseUrl) throw new Error('Network access requires manifest.api.baseUrl');
    const target = new URL(url, baseUrl);
    const allowed = target.origin === new URL(baseUrl).origin || asArray(this.manifest.api?.origins).includes(target.origin);
    if (!allowed) throw new Error(`Network origin is not allowed: ${target.origin}`);
    return fetch(target, options);
  }

  dispose() { this.scope.dispose(); this.events.clear(); }
}

export function createPluginAPI(options) { return new EDBPPluginAPI(options); }
