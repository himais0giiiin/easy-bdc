import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getMobileViewport, installMobileInputGuard, installMobileViewport } from '../editor/mobile.js';
import { PluginUI } from '../editor/plugin-ui.js';

test('mobile input keeps native text, number and multiline editing and IME confirmation separate', () => {
  const calls = [];
  class FieldInput {
    showEditor_(...args) { calls.push(['open', this, args]); }
    onHtmlInputKeyDown_(event) { calls.push([event.key, this]); return 'native'; }
  }
  class FieldTextInput extends FieldInput {}
  class FieldNumber extends FieldInput {}
  class FieldMultilineInput extends FieldTextInput {}
  const nativeEditor = FieldInput.prototype.showEditor_;
  let mobile = true;
  const blockly = { FieldInput, FieldTextInput };
  installMobileInputGuard(blockly, () => mobile);
  const guardedHandler = FieldInput.prototype.onHtmlInputKeyDown_;
  installMobileInputGuard(blockly, () => mobile);
  assert.equal(FieldInput.prototype.onHtmlInputKeyDown_, guardedHandler);
  for (const Field of [FieldTextInput, FieldNumber, FieldMultilineInput]) {
    const field = new Field();
    assert.equal(field.showEditor_, nativeEditor);
    field.onHtmlInputKeyDown_({ key: 'Enter', isComposing: true });
    field.onHtmlInputKeyDown_({ key: 'Enter', keyCode: 229 });
    assert.equal(calls.length, 0, 'IME candidate confirmation must not close the editor');
    assert.equal(field.onHtmlInputKeyDown_({ key: 'Enter', isComposing: false }), 'native');
    assert.deepEqual(calls.pop(), ['Enter', field]);
    field.onHtmlInputKeyDown_({ key: 'Escape' });
    assert.deepEqual(calls.pop(), ['Escape', field]);
  }
  mobile = false;
  const field = new FieldTextInput();
  assert.equal(field.onHtmlInputKeyDown_({ key: 'Enter', isComposing: true }), 'native');
});

test('mobile viewport follows keyboard height and panning, but not pinch zoom', () => {
  assert.deepEqual(getMobileViewport({ innerHeight: 844 }), { height: 844, top: 0 });
  const windowRef = { innerHeight: 844, visualViewport: { height: 330.4, offsetTop: 85.5, scale: 1 } };
  assert.deepEqual(getMobileViewport(windowRef), { height: 330, top: 86 });
  windowRef.visualViewport.scale = 2;
  assert.deepEqual(getMobileViewport(windowRef), { height: 844, top: 0 });
  windowRef.visualViewport = { height: 900, scale: 1 };
  assert.deepEqual(getMobileViewport(windowRef), { height: 844, top: 0 });
});

test('viewport listeners update layout and release mobile overrides on desktop', () => {
  const windowRef = new EventTarget();
  Object.assign(windowRef, { innerHeight: 844, visualViewport: new EventTarget() });
  Object.assign(windowRef.visualViewport, { height: 844, offsetTop: 0, scale: 1 });
  const mobileQuery = new EventTarget();
  mobileQuery.matches = true;
  const styles = new Map();
  const root = { style: { setProperty: (key, value) => styles.set(key, value), removeProperty: key => styles.delete(key) } };
  const cleanup = installMobileViewport(windowRef, root, mobileQuery);
  windowRef.visualViewport.height = 300;
  windowRef.visualViewport.dispatchEvent(new Event('resize'));
  assert.equal(styles.get('--edbb-mobile-height'), '300px');
  windowRef.visualViewport.offsetTop = 60;
  windowRef.visualViewport.dispatchEvent(new Event('scroll'));
  assert.equal(styles.get('--edbb-mobile-top'), '60px');
  mobileQuery.matches = false;
  mobileQuery.dispatchEvent(new Event('change'));
  assert.equal(styles.size, 0);
  cleanup();
  mobileQuery.matches = true;
  windowRef.dispatchEvent(new Event('resize'));
  assert.equal(styles.size, 0);
});

function element() {
  const classes = new Set();
  return { innerHTML: '', scrollTop: 30,
    classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
    querySelector: () => null, querySelectorAll: () => [],
  };
}

function pluginUI() {
  const ui = Object.create(PluginUI.prototype);
  const detail = element();
  Object.assign(ui, {
    modal: element(), pluginDetailContent: element(), pluginDetailEmpty: element(),
    isMobileDevice: () => true, updateSidebarSelectionState() {}, getQuickSearchTags: () => [], searchQuery: '',
    escapeHtml: value => String(value ?? ''),
  });
  globalThis.document = { getElementById: () => detail };
  globalThis.lucide = { createIcons() {} };
  return { ui, detail };
}

test('returning to mobile plugin list clears selection so the same item can reopen', () => {
  const { ui, detail } = pluginUI();
  ui.currentDetailPluginKey = 'plugin-a';
  ui.openMobileDetail();
  assert.equal(ui.modal.classList.contains('detail-open'), true);
  assert.equal(detail.scrollTop, 0);
  ui.showEmptyDetail();
  assert.equal(ui.currentDetailPluginKey, null);
  assert.equal(ui.modal.classList.contains('detail-open'), false);
  assert.equal(ui.pluginDetailContent.classList.contains('hidden'), true);
  ui.currentDetailPluginKey = 'plugin-a';
  ui.openMobileDetail();
  assert.equal(ui.modal.classList.contains('detail-open'), true);
  ui.isMobileDevice = () => false;
  ui.modal.classList.remove('detail-open');
  ui.openMobileDetail();
  assert.equal(ui.modal.classList.contains('detail-open'), false);
});

test('late GitHub detail responses cannot overwrite the mobile list after going back', async () => {
  const { ui } = pluginUI();
  let finishReadme;
  ui.pluginManager = {
    getREADME: () => new Promise(resolve => { finishReadme = resolve; }),
    getReleases: async () => [], getBranches: async () => [],
    hasExternalDocOverride: async () => false, getManifestFromGitHub: async () => null,
  };
  const loading = ui.showGitHubDetail({ fullName: 'example/plugin', name: 'Plugin', defaultBranch: 'main' });
  const loadingContent = ui.pluginDetailContent.innerHTML;
  ui.showEmptyDetail();
  finishReadme('late README');
  await loading;
  assert.equal(ui.currentDetailPluginKey, null);
  assert.equal(ui.modal.classList.contains('detail-open'), false);
  assert.equal(ui.pluginDetailContent.innerHTML, loadingContent);
});

test('mobile plugin search synchronizes desktop query without stealing typing focus', () => {
  const { ui } = pluginUI();
  const desktopInput = { focus() { this.focused = true; } };
  const mobileInput = { focus() { this.focused = true; } };
  ui.pluginDetailEmpty.querySelector = () => desktopInput;
  document.getElementById = () => mobileInput;
  ui.renderMarketplace = () => {};
  ui.setSearchQuery('debug', { focus: false });
  assert.equal(desktopInput.value, 'debug');
  assert.equal(mobileInput.value, 'debug');
  assert.equal(desktopInput.focused, undefined);
  assert.equal(mobileInput.focused, undefined);
  ui.setSearchQuery('tag:utility');
  assert.equal(mobileInput.focused, true);
  assert.equal(desktopInput.focused, undefined);
});

test('older marketplace searches cannot append stale results after newer queries', async () => {
  const { ui } = pluginUI();
  const rendered = [];
  const requests = [];
  ui.pluginList = { set innerHTML(_) { rendered.length = 0; }, appendChild: item => rendered.push(item) };
  document.createElement = () => element();
  ui.pluginManager = {
    getRegistry: () => [], searchGitHubPlugins: () => new Promise(resolve => requests.push(resolve)),
  };
  ui.parseQuery = () => ({ tags: [], text: [] });
  ui.matchesPluginFilter = () => true;
  ui.getPluginRepoKey = plugin => plugin.name;
  ui.enrichGitHubPluginsWithManifestTags = async () => {};
  ui.addPluginItem = plugin => { rendered.push(plugin.name); return { isConnected: false }; };
  const oldSearch = ui.renderMarketplace();
  const newSearch = ui.renderMarketplace();
  requests[1]([{ name: 'new result' }]);
  await newSearch;
  requests[0]([{ name: 'stale result' }]);
  await oldSearch;
  assert.equal(rendered.includes('new result'), true);
  assert.equal(rendered.includes('stale result'), false);
});

test('mobile UI uses native inline editing, responsive flyout closing and scrollable plugin list', async () => {
  const script = await readFile(new URL('../editor/script.js', import.meta.url), 'utf8');
  const style = await readFile(new URL('../editor/mobile.css', import.meta.url), 'utf8');
  const mainStyle = await readFile(new URL('../editor/style.css', import.meta.url), 'utf8');
  const html = await readFile(new URL('../editor/index.html', import.meta.url), 'utf8');
  assert.match(script, /modalInputs: false/);
  assert.match(script, /flyout\.autoClose = isMobileDevice/);
  assert.match(style, /#pluginModal \.w-80\s*\{[^}]*display: flex;[^}]*min-height: 0;/);
  assert.doesNotMatch(html, /src="\.\/plugin-mobile\.js"/);
  assert.match(html, /id="closeModalBtn" aria-label="閉じる"/);
  assert.match(mainStyle, /#codeModalHeader\s*\{[^}]*flex-wrap: wrap;/);
  assert.match(mainStyle, /#projectTitleField\s*\{\s*width: 100% !important;\s*max-width: none !important;/);
});
