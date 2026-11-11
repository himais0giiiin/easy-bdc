import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MOBILE_ACTION_TARGETS, setupMobileActions, syncMobileActionAvailability } from '../editor/mobile-actions.js';

function fixture() {
  const elements = new Map();
  const documentRef = { getElementById: id => elements.get(id), activeElement: null, listeners: {},
    addEventListener(name, listener) { this.listeners[name] = listener; },
  };
  const makeElement = (id) => {
    const classes = new Set();
    const el = { id, disabled: false, attributes: {}, listeners: {}, children: [], clicks: 0,
      classList: { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name) },
      addEventListener(name, handler) { this.listeners[name] = handler; },
      setAttribute(name, value) { this.attributes[name] = value; },
      focus() { documentRef.activeElement = this; },
      click() { if (!this.disabled) { this.clicks++; this.listeners.click?.({ target: this }); } },
      append(child) { if (child.parent) child.parent.children = child.parent.children.filter(item => item !== child); child.parent = this; this.children.push(child); },
      before(anchor) { anchor.parent = this.parent; this.parent.children.splice(this.parent.children.indexOf(this), 0, anchor); },
      after(child) { if (child.parent) child.parent.children = child.parent.children.filter(item => item !== child); child.parent = this.parent; this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, child); },
      contains(child) { return child === this || this.children.some(item => item.contains(child)); },
      closest() { return null; }, getClientRects: () => [1], querySelectorAll: () => [],
    };
    elements.set(id, el);
    return el;
  };
  documentRef.createComment = () => makeElement('anchor');
  documentRef.body = makeElement('body');
  for (const [mobileId, targetId] of Object.entries(MOBILE_ACTION_TARGETS)) { makeElement(mobileId); makeElement(targetId); }
  for (const id of ['mobileActionsModal', 'mobileMoreBtn', 'mobileActionsCloseBtn', 'projectTitleField', 'projectTitleInput', 'mobileProjectTitleSlot', 'headerActions']) makeElement(id);
  const get = id => elements.get(id);
  get('mobileActionsModal').classList.add('hidden');
  get('headerActions').append(get('projectTitleField'));
  get('projectTitleField').append(get('projectTitleInput'));
  get('mobileActionsModal').append(get('mobileActionsCloseBtn'));
  get('mobileActionsModal').append(get('mobileProjectTitleSlot'));
  return { documentRef, get };
}

test('every mobile action invokes its existing handler and closes the menu synchronously', () => {
  const { documentRef, get } = fixture();
  setupMobileActions(documentRef, () => true).syncLayout();
  for (const [mobileId, targetId] of Object.entries(MOBILE_ACTION_TARGETS)) {
    get('mobileMoreBtn').click();
    assert.equal(get('mobileActionsModal').classList.contains('hidden'), false);
    get(targetId).listeners.click = () => assert.equal(get('mobileActionsModal').classList.contains('hidden'), true);
    get(mobileId).click();
    assert.equal(get(targetId).clicks, 1, targetId);
    assert.equal(get('mobileMoreBtn').attributes['aria-expanded'], 'false');
  }
});

test('mobile actions inherit disabled states and lock destructive actions in shared view or during sync', () => {
  const { documentRef, get } = fixture();
  get('shareBtn').disabled = true;
  syncMobileActionAvailability(documentRef);
  assert.equal(get('mobileShareBtn').disabled, true);
  get('shareBtn').disabled = false;
  documentRef.body.classList.add('share-view-mode');
  syncMobileActionAvailability(documentRef);
  assert.equal(get('mobileNewProjectBtn').disabled, true);
  assert.equal(get('mobileImportBtn').disabled, true);
  assert.equal(get('mobileExportBtn').disabled, false);
  assert.equal(get('projectTitleInput').readOnly, true);
  documentRef.body.classList.remove('share-view-mode');
  get('projectTitleInput').disabled = true;
  syncMobileActionAvailability(documentRef);
  assert.equal(get('mobileImportBtn').disabled, true);
  get('projectTitleInput').disabled = false;
  syncMobileActionAvailability(documentRef);
  assert.equal(get('mobileImportBtn').disabled, false);
  assert.equal(get('mobileShareBtn').disabled, false);
  assert.equal(get('projectTitleInput').readOnly, false);
  get('themeToggle').style = { display: 'none' };
  syncMobileActionAvailability(documentRef);
  assert.equal(get('mobileThemeBtn').disabled, true, 'respect the existing feature toggle');
});

test('moving the same project title field retains values and restores its desktop position', () => {
  const { documentRef, get } = fixture();
  let mobile = true;
  const controller = setupMobileActions(documentRef, () => mobile);
  const input = get('projectTitleInput');
  input.value = 'My project';
  controller.syncLayout();
  assert.equal(get('projectTitleField').parent, get('mobileProjectTitleSlot'));
  get('mobileMoreBtn').click();
  mobile = false;
  controller.syncLayout();
  assert.equal(get('mobileActionsModal').classList.contains('hidden'), true);
  assert.equal(get('projectTitleField').parent, get('headerActions'));
  assert.equal(input.value, 'My project');
  get('mobileMoreBtn').click();
  assert.equal(get('mobileActionsModal').classList.contains('hidden'), true);
});

test('mobile menu supports Escape, backdrop dismissal and bounded keyboard focus', () => {
  const { documentRef, get } = fixture();
  setupMobileActions(documentRef, () => true).syncLayout();
  const modal = get('mobileActionsModal');
  const first = get('mobileActionsCloseBtn');
  const last = get('projectTitleInput');
  modal.querySelectorAll = () => [first, last];
  get('mobileMoreBtn').click();
  let prevented = 0;
  documentRef.listeners.keydown({ key: 'Tab', shiftKey: true, preventDefault() { prevented++; } });
  assert.equal(documentRef.activeElement, last);
  documentRef.listeners.keydown({ key: 'Tab', shiftKey: false, preventDefault() { prevented++; } });
  assert.equal(documentRef.activeElement, first);
  assert.equal(prevented, 2);
  documentRef.listeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(documentRef.activeElement, get('mobileMoreBtn'));
  assert.equal(modal.attributes['aria-hidden'], 'true');
  get('mobileMoreBtn').click();
  modal.listeners.click({ target: modal });
  assert.equal(modal.classList.contains('hidden'), true);
});

test('bottom navigation covers all header actions supported on mobile without Bot settings or header toggle', async () => {
  const html = await readFile(new URL('../editor/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../editor/style.css', import.meta.url), 'utf8');
  const script = await readFile(new URL('../editor/script.js', import.meta.url), 'utf8');
  for (const mobileId of Object.keys(MOBILE_ACTION_TARGETS)) assert.match(html, new RegExp(`id="${mobileId}"`));
  assert.doesNotMatch(html, /id="(?:mobileHeaderToggle|botSettingsBtn|botSettingsModal|mobileSettingsBtn)"/);
  assert.doesNotMatch(script, /openBotSettings|headerExpanded/);
  assert.match(css, /html\.is-mobile #headerActions\s*\{\s*display: none !important;/);
  assert.match(css, /:has\(#mobileActionsModal\.show-modal\) #docsbotai-root\s*\{\s*visibility: hidden !important;/);
  assert.match(html, /画面分割・Botの直接起動はPC専用/);
});
