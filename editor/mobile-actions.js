export const MOBILE_ACTION_TARGETS = Object.freeze({
  mobileUndoBtn: 'undoBtn',
  mobileRedoBtn: 'redoBtn',
  mobileTemplatesBtn: 'templatesBtn',
  mobileEditorSettingsBtn: 'editorSettingsBtn',
  mobileNewProjectBtn: 'newProjectBtn',
  mobileProjectsBtn: 'projectsBtn',
  mobileImportBtn: 'importBtn',
  mobileExportBtn: 'exportBtn',
  mobileShowCodeBtn: 'showCodeBtn',
  mobilePluginBtn: 'pluginBtn',
  mobileShareBtn: 'shareBtn',
  mobileCollabBtn: 'collabBtn',
  mobileJsonGuiBtn: 'jsonGuiBtn',
  mobileThemeBtn: 'themeToggle',
});

export const syncMobileActionAvailability = (documentRef) => {
  const viewOnly = documentRef.body?.classList.contains('share-view-mode');
  const connecting = documentRef.getElementById('projectTitleInput')?.disabled;
  for (const [mobileId, targetId] of Object.entries(MOBILE_ACTION_TARGETS)) {
    const button = documentRef.getElementById(mobileId);
    const target = documentRef.getElementById(targetId);
    const changesProject = targetId === 'newProjectBtn' || targetId === 'importBtn';
    const unavailable = !target || target.disabled || target.hidden || target.style?.display === 'none';
    if (button) button.disabled = Boolean(unavailable || (changesProject && (viewOnly || connecting)));
  }
  const title = documentRef.getElementById('projectTitleInput');
  if (title) title.readOnly = Boolean(viewOnly);
};

export const setupMobileActions = (documentRef, isMobile) => {
  const modal = documentRef.getElementById('mobileActionsModal');
  const more = documentRef.getElementById('mobileMoreBtn');
  const close = documentRef.getElementById('mobileActionsCloseBtn');
  const titleField = documentRef.getElementById('projectTitleField');
  const titleSlot = documentRef.getElementById('mobileProjectTitleSlot');
  const titleAnchor = documentRef.createComment('Desktop project title position');
  titleField?.before(titleAnchor);

  const isOpen = () => modal && !modal.classList.contains('hidden');
  const closeMenu = () => {
    const wasOpen = isOpen();
    // Release focus before applying aria-hidden to its container.
    if (wasOpen && modal.contains(documentRef.activeElement)) more?.focus();
    modal?.classList.remove('flex', 'show-modal');
    modal?.classList.add('hidden');
    modal?.setAttribute('aria-hidden', 'true');
    more?.setAttribute('aria-expanded', 'false');
  };
  const syncLayout = () => {
    closeMenu();
    // Move the original field, not a copy: imports and collaboration keep the
    // same title value, listeners and read-only restrictions on both layouts.
    if (isMobile()) {
      if (titleField && titleSlot) titleSlot.append(titleField);
    } else if (titleField) {
      titleAnchor.after(titleField);
    }
    syncMobileActionAvailability(documentRef);
  };

  more?.addEventListener('click', () => {
    if (!isMobile() || !modal) return;
    syncMobileActionAvailability(documentRef);
    modal.classList.remove('hidden');
    modal.classList.add('flex', 'show-modal');
    modal.setAttribute('aria-hidden', 'false');
    more.setAttribute('aria-expanded', 'true');
    close?.focus();
  });
  close?.addEventListener('click', closeMenu);
  modal?.addEventListener('click', (event) => {
    if (event.target === modal || event.target.closest('a')) closeMenu();
  });
  documentRef.addEventListener('keydown', (event) => {
    if (!isOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
    } else if (event.key === 'Tab') {
      const focusable = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href]')]
        .filter(element => element.getClientRects().length);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && documentRef.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && documentRef.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    }
  });
  for (const [mobileId, targetId] of Object.entries(MOBILE_ACTION_TARGETS)) {
    documentRef.getElementById(mobileId)?.addEventListener('click', () => {
      const target = documentRef.getElementById(targetId);
      syncMobileActionAvailability(documentRef);
      if (!target || documentRef.getElementById(mobileId)?.disabled) return;
      closeMenu();
      // Keep the same user gesture for clipboard, download and file pickers.
      target.click();
    });
  }

  const Observer = documentRef.defaultView?.MutationObserver;
  if (Observer) {
    const observer = new Observer(() => syncMobileActionAvailability(documentRef));
    for (const targetId of Object.values(MOBILE_ACTION_TARGETS)) {
      const target = documentRef.getElementById(targetId);
      if (target) observer.observe(target, { attributes: true, attributeFilter: ['disabled', 'hidden', 'style'] });
    }
    if (documentRef.body) observer.observe(documentRef.body, { attributes: true, attributeFilter: ['class'] });
    const title = documentRef.getElementById('projectTitleInput');
    if (title) observer.observe(title, { attributes: true, attributeFilter: ['disabled'] });
  }
  return { syncLayout, closeMenu };
};
