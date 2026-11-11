import { ProjectLibrary } from './projects.js';
import { BOT_TEMPLATES, templateState } from './templates.js';
import { showConfirmDialog, showPromptDialog, showTopRightToast } from './core/ui.js';

export const element = (tag, text, className = '') => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  node.className = className;
  return node;
};
export const button = (text, action, disabled = false) => {
  const node = element('button', text, 'project-button');
  node.type = 'button'; node.disabled = disabled;
  node.addEventListener('click', action);
  return node;
};
export const dateLabel = timestamp => new Date(timestamp).toLocaleString('ja-JP');
export function createDialog(id, title) {
  const dialog = element('dialog', null, 'project-dialog');
  dialog.id = id;
  dialog.setAttribute('aria-labelledby', `${id}Title`);
  const header = element('header', null, 'project-dialog-heading');
  const heading = element('h2', title); heading.id = `${id}Title`;
  const close = button('閉じる', () => dialog.close());
  header.append(heading, close);
  const status = element('p', '', 'project-notice'); status.setAttribute('role', 'status');
  const body = element('div', null, 'project-dialog-body');
  dialog.append(header, status, body);
  document.body.append(dialog);
  dialog.addEventListener('click', event => { if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  } });
  const report = error => {
    if (dialog.open) status.textContent = error.message || String(error);
    else showTopRightToast(error.message || String(error), { icon: 'error' });
  };
  return { dialog, body, status, report, open: () => { if (!dialog.open) dialog.showModal(); } };
}

export function setupProjectUI({ workspace, storage, shareFeature, collabManager, onLoad }) {
  const ui = createDialog('projectsDialog', 'プロジェクトと変更履歴');
  const titleInput = document.getElementById('projectTitleInput');
  let library;
  let guestSession = false;
  let guestConnected = false;
  let loading = false;
  let tab = 'projects';
  const title = () => titleInput.value.trim() || 'bot-project';
  const blocked = () => !library || shareFeature.isShareViewMode() || collabManager.status !== 'disconnected' || guestSession;
  const setTitle = value => {
    titleInput.value = value;
    try { localStorage.setItem('edbb_project_title', value); } catch { /* library owns titles */ }
  };
  const readState = () => {
    const state = storage.exportText();
    if (!state) throw new Error('現在のプロジェクトを保存できません。');
    return state;
  };
  const guard = () => { if (blocked()) throw new Error('プロジェクトの変更は共同編集を終了し、共有の編集を開始してから行ってください。'); };
  const run = action => async () => { try { await action(); } catch (error) { ui.report(error); } };
  // Missing plugin blocks must fail before Blockly clears the workspace.
  const load = state => {
    const inspect = value => {
      if (!value || typeof value !== 'object') return;
      if (typeof value.type === 'string' && typeof value.id === 'string' && !Blockly.Blocks[value.type]) {
        throw new Error(`ブロック「${value.type}」がありません。必要なプラグインを有効にしてください。`);
      }
      Object.values(value).forEach(inspect);
    };
    inspect(JSON.parse(state).blocks);
    Blockly.Events.disable();
    loading = true;
    try { if (!storage.importText(state)) throw new Error('プロジェクトを読み込めませんでした。'); }
    finally { loading = false; Blockly.Events.enable(); }
  };
  const replace = (state, nextTitle, commit) => {
    const before = readState(); const previousTitle = titleInput.value;
    try { load(state); commit(); setTitle(nextTitle); }
    catch (error) { load(before); setTitle(previousTitle); throw error; }
    workspace.clearUndo();
    shareFeature.applyUiState();
    onLoad();
  };
  const save = label => { guard(); library.save(readState(), title(), label); };
  const create = (nextTitle, state = '{}') => {
    guard(); save('プロジェクト切替前');
    replace(state, nextTitle, () => library.create(nextTitle, state));
    ui.dialog.close();
  };
  const ask = async action => {
    // SweetAlert lives outside the native dialog's top layer.
    ui.dialog.close();
    try { return await action(); }
    finally { render(); ui.open(); }
  };
  const render = () => {
    ui.body.replaceChildren();
    const locked = blocked();
    ui.status.textContent = !library ? '保存データを読み込めません。JSONを書き出してバックアップしてください。'
      : locked ? '閲覧できます。切り替え・復元は共同編集終了後、共有の編集開始後に使えます。' : '';
    const tabs = element('div', null, 'project-toolbar');
    const projectsTab = button('プロジェクト一覧', () => { tab = 'projects'; render(); });
    const historyTab = button('変更履歴', () => { tab = 'history'; render(); });
    projectsTab.setAttribute('aria-pressed', String(tab === 'projects'));
    historyTab.setAttribute('aria-pressed', String(tab === 'history'));
    const templatesTab = button('テンプレート', () => { tab = 'templates'; render(); });
    templatesTab.setAttribute('aria-pressed', String(tab === 'templates'));
    tabs.append(projectsTab, historyTab, templatesTab); ui.body.append(tabs);
    ui.body.append(element('p', 'このブラウザに保存します。履歴は各プロジェクトの直近30件です。', 'project-muted'));
    if (!library) return;
    if (tab === 'templates') {
      ui.body.append(element('p', '現在の作品を保存して、新しいプロジェクトを作成します。追加プラグインは不要です。', 'project-muted'));
      for (const template of BOT_TEMPLATES) {
        const row = element('article', null, 'project-card');
        row.append(element('h3', template.title), element('p', template.summary), element('p', template.guide, 'project-muted'));
        row.append(button('このテンプレートで作成', run(() => create(template.title, templateState(template.id))), locked));
        ui.body.append(row);
      }
    } else if (tab === 'projects') {
      const form = element('form', null, 'project-toolbar');
      const input = element('input'); input.placeholder = '新しいプロジェクト名'; input.maxLength = 64;
      input.setAttribute('aria-label', '新しいプロジェクト名'); input.disabled = locked;
      const submit = button('新規作成', () => {} , locked); submit.type = 'submit';
      form.append(input, submit);
      form.addEventListener('submit', event => { event.preventDefault(); run(() => create(input.value.trim() || '新しいBot'))(); });
      ui.body.append(form);
      for (const p of library.list()) {
        const row = element('article', null, 'project-card');
        row.append(element('h3', `${p.title}${p.id === library.active.id ? ' · 編集中' : ''}`));
        row.append(element('p', `更新: ${dateLabel(p.updatedAt)} · 履歴 ${p.history.length}件`, 'project-muted'));
        const actions = element('div', null, 'project-toolbar');
        actions.append(button('開く', run(() => {
          guard(); save('プロジェクト切替前');
          const target = library.get(p.id);
          replace(target.state, target.title, () => library.activate(p.id)); ui.dialog.close();
        }), locked || p.id === library.active.id));
        actions.append(button('名前変更', run(async () => {
          const value = await ask(() => showPromptDialog('プロジェクト名', p.title));
          if (!value?.trim()) return;
          guard(); if (p.id === library.active.id) save();
          library.rename(p.id, value);
          if (p.id === library.active.id) setTitle(library.active.title);
          render();
        }), locked));
        actions.append(button('複製', run(() => {
          guard(); const source = p.id === library.active.id ? readState() : p.state;
          create(`${p.id === library.active.id ? title() : p.title}（コピー）`, source);
        }), locked));
        actions.append(button('削除', run(async () => {
          const yes = await ask(() => showConfirmDialog(`「${p.title}」とその変更履歴を削除しますか？`, { confirmButtonText: '削除' }));
          if (yes) { guard(); library.remove(p.id); render(); }
        }), locked || p.id === library.active.id));
        row.append(actions); ui.body.append(row);
      }
    } else {
      ui.body.append(element('h3', library.active.title));
      const form = element('form', null, 'project-toolbar');
      const input = element('input'); input.placeholder = '履歴のメモ（任意）'; input.maxLength = 100;
      input.setAttribute('aria-label', '履歴のメモ'); input.disabled = locked;
      const submit = button('現在の状態を履歴に保存', () => {}, locked); submit.type = 'submit';
      form.append(input, submit);
      form.addEventListener('submit', event => { event.preventDefault(); run(() => { save(input.value.trim() || '手動保存'); render(); })(); });
      ui.body.append(form);
      ui.body.append(element('p', '編集中の内容は自動保存され、変更がある場合は約1分ごとに履歴を残します。復元前の状態も履歴に残ります。', 'project-muted'));
      for (const h of [...library.active.history].reverse()) {
        const row = element('article', null, 'project-card');
        row.append(element('h3', h.label), element('p', `${dateLabel(h.createdAt)} · ${h.title}`, 'project-muted'));
        row.append(button('この状態に復元', run(() => {
          guard(); save();
          replace(h.state, h.title, () => library.restore(h.id)); render();
        }), locked));
        ui.body.append(row);
      }
    }
  };
  try {
    library = new ProjectLibrary();
    if (library.active) { load(library.active.state); setTitle(library.active.title); }
    else { storage.load(); library.create(title(), readState()); }
  } catch (error) { library = null; ui.report(error); }
  storage.setSaveHandler(state => {
    if (loading || shareFeature.isShareViewMode() || guestSession) return true;
    if (!library) throw new Error('プロジェクト一覧を読み込めないため、自動保存を停止しています。');
    library.save(state, title());
    return true;
  });
  titleInput.addEventListener('input', () => storage.save());
  window.addEventListener('beforeunload', () => { if (!loading) storage.save(); });
  document.getElementById('projectsBtn').addEventListener('click', run(() => {
    if (!blocked()) save(); render(); ui.open();
  }));
  document.getElementById('templatesBtn')?.addEventListener('click', run(() => {
    if (!blocked()) save(); tab = 'templates'; render(); ui.open();
  }));
  document.getElementById('newProjectBtn').addEventListener('click', run(async () => {
    guard();
    const value = await showPromptDialog('新しいプロジェクト名', '新しいBot', { confirmButtonText: '作成' });
    if (value != null) create(value.trim() || '新しいBot');
  }));
  collabManager.onStateChange((type, data) => {
    if (type === 'status_change' && data.status === 'connecting' && !data.isHost) {
      // Persist the last gesture before guest snapshots suppress local autosave.
      storage.save();
      guestSession = true; guestConnected = false;
    }
    if (type === 'status_change' && data.status === 'connected' && guestSession) guestConnected = true;
    if (type === 'status_change' && data.status === 'disconnected' && !guestConnected) guestSession = false;
    if (type === 'local_edit_resumed') {
      try {
        if (guestSession && !data.restored) library.create(`${title()}（共同編集）`, readState());
        guestSession = false; storage.save();
      } catch (error) { ui.report(error); }
    }
    document.getElementById('newProjectBtn').disabled = blocked();
    document.getElementById('importBtn').disabled = blocked();
    if (ui.dialog.open) render();
  });
  shareFeature.onShareViewModeChange(() => {
    document.getElementById('newProjectBtn').disabled = blocked();
    document.getElementById('importBtn').disabled = blocked();
    if (ui.dialog.open) render();
  });
  document.getElementById('newProjectBtn').disabled = blocked();
  document.getElementById('importBtn').disabled = blocked();
  return { library, render, checkpoint: save };
}
