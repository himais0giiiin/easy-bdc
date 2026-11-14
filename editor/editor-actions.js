export function setupEditorActions({ workspace, shareFeature, collabManager, pluginUI }) {
  const undo = document.getElementById('undoBtn');
  const redo = document.getElementById('redoBtn');
  const locked = () => shareFeature.isShareViewMode() || collabManager.status !== 'disconnected';
  const sync = () => {
    undo.disabled = locked() || !workspace.getUndoStack().length;
    redo.disabled = locked() || !workspace.getRedoStack().length;
    for (const [id, source] of [['mobileUndoBtn', undo], ['mobileRedoBtn', redo]]) {
      const target = document.getElementById(id);
      if (target) target.disabled = source.disabled;
    }
  };
  for (const [button, forward] of [[undo, false], [redo, true]]) {
    button.addEventListener('click', () => { if (!locked()) workspace.undo(forward); sync(); });
  }
  document.getElementById('editorSettingsBtn').addEventListener('click', () => pluginUI.openSettingsModal(null));
  const more = document.getElementById('editorMoreBtn');
  const menu = document.getElementById('editorMorePopover');
  if (more && menu) {
    const positionMenu = () => {
      const anchor = more.getBoundingClientRect();
      menu.style.top = `${anchor.bottom + 8}px`;
      menu.style.left = `${Math.max(8, Math.min(anchor.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
    };
    menu.addEventListener('toggle', event => { if (event.newState === 'open') positionMenu(); });
    menu.addEventListener('click', event => { if (event.target.closest('button')) menu.hidePopover(); }, true);
    window.addEventListener('resize', () => menu.hidePopover());
  }
  workspace.addChangeListener(() => queueMicrotask(sync));
  shareFeature.onShareViewModeChange(sync);
  collabManager.onStateChange(sync);
  window.addEventListener('edbb-workspace-loaded', sync);
  sync();
}
