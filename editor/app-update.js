// Only production builds carry a version. Development reloads stay with Vite.
export const isEditing = (documentRef) => Boolean(
  documentRef.activeElement?.matches?.('input, textarea, select, [contenteditable="true"]') ||
  documentRef.querySelector('dialog[open], .modal-backdrop.show-modal, .swal2-container, .blocklyWidgetDiv[style*="display: block"]')
);

export const updatedPageUrl = (href, version) => {
  const url = new URL(href);
  url.searchParams.set('_v', version);
  return url.href;
};

export const createUpdateController = ({ currentVersion, fetchVersion, save, reload,
  isBusy = () => false, isHidden = () => false, notify = () => {}, beforeSave = () => {},
  now = Date.now, idleMs = 15000 }) => {
  let lastActivity = now();
  let pendingVersion = '';
  let checking = false;
  let reloading = false;
  let failureNotified = false;
  const activity = () => { lastActivity = now(); };
  const apply = async () => {
    if (!pendingVersion || reloading || isHidden() || isBusy() || now() - lastActivity < idleMs) return false;
    reloading = true;
    try {
      beforeSave();
      if (await save() !== true) throw new Error('Project could not be saved');
      reload(pendingVersion);
      return true;
    } catch {
      reloading = false;
      if (!failureNotified) notify('新版がありますが保存できないため、更新を待っています。作品を書き出して保存してください。');
      failureNotified = true;
      return false;
    }
  };
  const check = async () => {
    if (!currentVersion || checking || reloading || isHidden()) return false;
    checking = true;
    try {
      const version = await fetchVersion();
      if (typeof version === 'string' && /^[a-zA-Z0-9_-]{6,80}$/.test(version) && version !== currentVersion) {
        if (version !== pendingVersion) notify('新版を確認しました。編集が落ち着いたら、作品を保存して自動更新します。');
        pendingVersion = version;
      } else if (version === currentVersion) {
        pendingVersion = '';
      }
    } catch {
      // Offline / failed deployments are not an instruction to reload.
      return false;
    } finally { checking = false; }
    return apply();
  };
  return { activity, apply, check };
};

export const startAppUpdater = ({ save, isBusy, notify, windowRef = window }) => {
  const documentRef = windowRef.document;
  const currentVersion = documentRef.querySelector('meta[name="edbb-app-version"]')?.content;
  if (!currentVersion) return null;
  const controller = createUpdateController({
    currentVersion, save, notify,
    isBusy: () => isEditing(documentRef) || isBusy(),
    isHidden: () => documentRef.hidden,
    beforeSave: () => windowRef.dispatchEvent(new windowRef.Event('edbb-before-app-update')),
    reload: version => windowRef.location.replace(updatedPageUrl(windowRef.location.href, version)),
    fetchVersion: async () => {
      const url = new URL('../version.json', windowRef.location.href);
      url.searchParams.set('_', String(Date.now()));
      const response = await windowRef.fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Version unavailable');
      return (await response.json()).version;
    },
  });
  const activityEvents = ['input', 'keydown', 'pointerdown', 'wheel'];
  activityEvents.forEach(name => documentRef.addEventListener(name, controller.activity, true));
  const resume = () => { controller.activity(); void controller.check(); };
  documentRef.addEventListener('visibilitychange', resume);
  windowRef.addEventListener('online', resume);
  const checkTimer = windowRef.setInterval(controller.check, 5 * 60 * 1000);
  const applyTimer = windowRef.setInterval(controller.apply, 5000);
  void controller.check();
  return { ...controller, stop: () => {
    windowRef.clearInterval(checkTimer);
    windowRef.clearInterval(applyTimer);
    activityEvents.forEach(name => documentRef.removeEventListener(name, controller.activity, true));
    documentRef.removeEventListener('visibilitychange', resume);
    windowRef.removeEventListener('online', resume);
  } };
};
