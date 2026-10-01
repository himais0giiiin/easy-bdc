// 共有機能全体で使う定数を定義
const SHARE_QUERY_KEY = 'share';
const SHARE_STATUS_SHOW_MS = 2500;
const SHARE_SHORTENER_ENDPOINT = '/share/create';
const SHARE_IMPORT_SKIP_KEY = 'share_import_dialog_skip';
const SHARE_CANONICAL_ORIGIN = 'https://share.himais0giiiin.com';
const SHARE_BETA_ORIGIN = 'https://beta-edbb.himaiso.workers.dev';
const BLOCKLY_CAPTURE_EXTRA_CSS = [
  '.blocklyText { fill:#fff !important; font-family: "Plus Jakarta Sans", "Noto Sans JP", sans-serif !important; }',
  '.blocklyEditableText { fill: #fff !important; }',
  '.blocklyEditableText .blocklyText:not(.blocklyDropdownText) { fill:#000 !important; font-family: "Plus Jakarta Sans", "Noto Sans JP", sans-serif !important; }',
].join('');

const SHARE_THUMBNAIL_PADDING = 32;
const SHARE_THUMBNAIL_MIN_DIMENSION = 64;
const SHARE_THUMBNAIL_WATERMARK_SRC = '/static/c-by-EDBB.svg';

// ローカルストレージを使った共有設定の永続化を行うクラス
class SharePreferenceManager {
  // コンストラクタでキー名を保持
  constructor() {
    this.skipKey = SHARE_IMPORT_SKIP_KEY;
  }

  // 共有インポート確認ダイアログをスキップすべきか判定
  shouldSkipImportDialog() {
    try {
      return window.localStorage?.getItem(this.skipKey) === '1';
    } catch (error) {
      return false;
    }
  }

  // 共有インポート確認ダイアログのスキップ設定を保存
  setSkipImportDialog(shouldSkip) {
    try {
      if (shouldSkip) {
        window.localStorage?.setItem(this.skipKey, '1');
      } else {
        window.localStorage?.removeItem(this.skipKey);
      }
    } catch (error) {
      // localStorageが無い環境では握りつぶし
    }
  }
}

// ステータストーストの表示/非表示を制御するクラス
class ShareStatusNotifier {
  // コンストラクタでステータス要素をハードコード取得
  constructor() {
    this.statusEl = document.getElementById('shareStatus');
    this.statusTextEl = document.getElementById('shareStatusText');
    this.timer = null;
  }

  // メッセージと状態を受け取りトーストを表示
  show(message, state = 'info') {
    if (!this.statusEl || !this.statusTextEl) return;
    this.statusTextEl.textContent = message;
    this.statusEl.dataset.state = state;
    this.statusEl.setAttribute('data-show', 'true');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.statusEl?.setAttribute('data-show', 'false');
    }, SHARE_STATUS_SHOW_MS);
  }
}

// 共有閲覧モード時のUIロックを担うクラス
class ShareViewStateController {
  // コンストラクタでワークスペースとオーバーレイ要素を保持
  constructor(workspace) {
    this.workspace = workspace;
    this.overlayEl = document.getElementById('shareViewOverlay');
    this.shareViewMode = false;
    this.listeners = new Set();
    this.applyUiState();
  }

  // 閲覧モードのON/OFFを切り替え
  setMode(enabled) {
    this.shareViewMode = enabled;
    this.applyUiState();
    this.emit();
  }

  // 現在閲覧モードかどうかを返却
  isEnabled() {
    return this.shareViewMode;
  }

  // リスナーを登録して状態変化を通知
  onChange(listener) {
    if (typeof listener !== 'function') return () => { };
    this.listeners.add(listener);
    try {
      listener(this.shareViewMode);
    } catch (error) {
      console.error('share view mode listener failed', error);
    }
    return () => this.listeners.delete(listener);
  }

  // UIを現在の閲覧モードに合わせて更新
  applyUiState() {
    const bodyEl = typeof document !== 'undefined' ? document.body : null;
    if (bodyEl?.classList) {
      bodyEl.classList.toggle('share-view-mode', this.shareViewMode);
    }
    if (this.overlayEl) {
      this.overlayEl.classList.toggle('hidden', !this.shareViewMode);
    }
    if (!this.workspace) return;
    const toolbox = this.workspace.getToolbox?.();
    if (toolbox && typeof toolbox.setVisible === 'function') {
      toolbox.setVisible(!this.shareViewMode);
    }
    const blocks = this.workspace.getAllBlocks?.(false) ?? [];
    blocks.forEach((block) => {
      if (typeof block.setMovable === 'function') block.setMovable(!this.shareViewMode);
      if (typeof block.setEditable === 'function') block.setEditable(!this.shareViewMode);
      if (typeof block.setDeletable === 'function') block.setDeletable(!this.shareViewMode);
    });
  }

  // 登録済みリスナーへイベントを発火
  emit() {
    this.listeners.forEach((listener) => {
      try {
        listener(this.shareViewMode);
      } catch (error) {
        console.error('share view mode listener failed', error);
      }
    });
  }
}

// BlocklyキャプチャとサムネイルUI制御をまとめたクラス
class ShareThumbnailManager {
  // コンストラクタでDOMをハードコード取得し初期状態を設定
  constructor(workspace, statusNotifier) {
    this.workspace = workspace;
    this.statusNotifier = statusNotifier;
    this.modalEl = document.getElementById('shareModal');
    this.wrapperEl = document.getElementById('shareThumbnailWrapper');
    this.imageEl = document.getElementById('shareThumbnailImage');
    this.messageEl = document.getElementById('shareThumbnailMessage');
    this.copyBtn = document.getElementById('shareThumbnailCopyBtn');
    this.thumbnailDataUrl = '';
    this.watermarkImagePromise = null;
    this.registerCopyHandler();
    this.setState('hidden');
  }

  // コピー用ボタンのクリックイベントを定義
  registerCopyHandler() {
    if (!this.copyBtn) return;
    this.copyBtn.addEventListener('click', async () => {
      if (!this.thumbnailDataUrl) return;
      if (
        !navigator.clipboard ||
        typeof navigator.clipboard.write !== 'function' ||
        typeof window.ClipboardItem !== 'function'
      ) {
        this.statusNotifier?.show('クリップボードに画像をコピーできません', 'error');
        return;
      }
      try {
        const blob = await (await fetch(this.thumbnailDataUrl)).blob();
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        this.statusNotifier?.show('プレビュー画像をコピーしました！', 'success');
      } catch (error) {
        console.error('Failed to copy thumbnail', error);
        this.statusNotifier?.show('画像のコピーに失敗しました', 'error');
      }
    });
  }

  // モーダルが開いた際の処理
  handleModalOpened() {
    this.setState('loading');
    this.refresh();
  }

  // モーダルが閉じた際の処理
  handleModalClosed() {
    this.setState('hidden');
  }

  // サムネイルUIの状態を更新
  setState(state, dataUrl = '') {
    if (!this.imageEl || !this.messageEl || !this.wrapperEl) return;
    if (state === 'ready' && dataUrl) {
      this.imageEl.src = dataUrl;
      this.imageEl.classList.remove('hidden');
      this.messageEl.classList.add('hidden');
      this.wrapperEl.classList.remove('opacity-70');
      this.thumbnailDataUrl = dataUrl;
      if (this.copyBtn) this.copyBtn.disabled = false;
      return;
    }
    this.imageEl.classList.add('hidden');
    this.wrapperEl.classList.toggle('opacity-70', state !== 'hidden');
    this.messageEl.classList.toggle('hidden', state === 'hidden');
    this.thumbnailDataUrl = '';
    if (this.copyBtn) this.copyBtn.disabled = true;
    if (state === 'loading') {
      this.messageEl.textContent = 'ブロックエリアを撮影しています...';
    } else if (state === 'error') {
      this.messageEl.textContent = 'サムネイルの生成に失敗しました。再試行してください。';
    } else {
      this.messageEl.textContent = '';
    }
  }

  // サムネイルの再キャプチャを試みる
  async refresh() {
    if (!this.modalEl || this.modalEl.classList.contains('hidden')) return null;
    this.setState('loading');
    try {
      const dataUrl = await this.captureWorkspaceThumbnail();
      if (dataUrl) {
        this.setState('ready', dataUrl);
      } else {
        this.setState('error');
      }
      return dataUrl;
    } catch (error) {
      console.error('Failed to capture workspace thumbnail', error);
      this.setState('error');
      return null;
    }
  }

  // BlocklyキャンバスをSVG/PNG化
  async captureWorkspaceThumbnail() {
    if (!this.workspace) throw new Error('WORKSPACE_NOT_READY');

    const canvasSvg = this.workspace.getCanvas?.() ?? this.workspace.svgBlockCanvas_;
    if (!canvasSvg) throw new Error('CANVAS_NOT_FOUND');

    const blocks = this.workspace.getAllBlocks(false);
    if (!blocks.length) throw new Error('NO_BLOCKS_FOUND');

    // キャプチャ用にクローンを作成
    const clonedCanvas = canvasSvg.cloneNode(true);
    ['width', 'height', 'transform'].forEach((attr) => {
      if (clonedCanvas.removeAttribute) clonedCanvas.removeAttribute(attr);
    });

    // スタイル情報の取得
    const content = window.Blockly?.Css?.CONTENT;
    const cssPayload = (Array.isArray(content) ? content.join('') : (content || '')) + (BLOCKLY_CAPTURE_EXTRA_CSS || '');

    // 境界ボックスの取得
    const bbox = canvasSvg.getBBox();
    const padding = SHARE_THUMBNAIL_PADDING;
    const minDimension = SHARE_THUMBNAIL_MIN_DIMENSION;
    const viewWidth = Math.max(minDimension, Math.ceil(bbox.width + padding * 2));
    const viewHeight = Math.max(minDimension, Math.ceil(bbox.height + padding * 2));
    const viewX = bbox.x - padding;
    const viewY = bbox.y - padding;

    // SVG文字列の構築
    const xml = new XMLSerializer().serializeToString(clonedCanvas);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${viewWidth}" height="${viewHeight}" viewBox="${viewX} ${viewY} ${viewWidth} ${viewHeight}">
<style>${cssPayload}</style>
${xml}
</svg>`;

    const scaleFactor = Math.min(3, Math.max(1, window.devicePixelRatio || 1));

    return await new Promise((resolve, reject) => {
      const img = new Image();
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      img.onload = async () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewWidth * scaleFactor);
          canvas.height = Math.ceil(viewHeight * scaleFactor);
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            URL.revokeObjectURL(url);
            return reject(new Error('CANVAS_CONTEXT_NOT_AVAILABLE'));
          }

          // 背景を白（または透明）で塗りつぶし
          // 透明なままでも良いが、SNS共有を考慮すると背景があったほうが良い場合がある
          // ここでは透明なまま進め、必要に応じて背景色を追加できる

          ctx.scale(scaleFactor, scaleFactor);
          ctx.drawImage(img, 0, 0);

          try {
            const watermarkImage = await this.loadWatermarkImage();
            if (watermarkImage) {
              const paddingPx = Math.max(12, Math.min(48, Math.round(Math.min(viewWidth, viewHeight) * 0.06)));
              const maxWidth = Math.max(80, Math.min(220, viewWidth * 0.25));
              const naturalRatio = watermarkImage.naturalWidth && watermarkImage.naturalHeight ?
                watermarkImage.naturalWidth / watermarkImage.naturalHeight : 1;
              const targetWidth = Math.max(80, Math.min(maxWidth, watermarkImage.naturalWidth || maxWidth));
              const targetHeight = Math.round(targetWidth / naturalRatio);
              const targetX = paddingPx;
              const targetY = viewHeight - targetHeight - paddingPx;
              ctx.drawImage(watermarkImage, targetX, targetY, targetWidth, targetHeight);
            }
          } catch (e) {
            console.warn('Watermark load failed', e);
          }

          const result = canvas.toDataURL('image/png');
          URL.revokeObjectURL(url);
          resolve(result);
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };

      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    });
  }

  async loadWatermarkImage() {
    if (this.watermarkImagePromise) return this.watermarkImagePromise;
    this.watermarkImagePromise = new Promise((resolve) => {
      const watermark = new Image();
      watermark.crossOrigin = 'anonymous';
      watermark.onload = () => resolve(watermark);
      watermark.onerror = () => resolve(null);
      try {
        watermark.src = new URL(
          SHARE_THUMBNAIL_WATERMARK_SRC,
          typeof window !== 'undefined' ? window.location.href : undefined,
        ).toString();
      } catch (error) {
        console.warn('Failed to resolve watermark url, fallback to raw path', error);
        watermark.src = SHARE_THUMBNAIL_WATERMARK_SRC;
      }
    });
    return this.watermarkImagePromise;
  }

  // SVG文字列をBase64 DataURLに変換
  toBase64Svg(svgString) {
    return `data:image/svg+xml;base64,${window.btoa(unescape(encodeURIComponent(svgString)))}`;
  }
}

// 閲覧ビューと編集ビュー間の履歴管理を担当するクラス
class ShareHistoryManager {
  // 依存（storage / viewState / notifier / URL生成関数）をまとめて受け取る
  constructor({ storage, statusNotifier, viewStateController, buildShareUrl }) {
    this.storage = storage;
    this.statusNotifier = statusNotifier;
    this.viewStateController = viewStateController;
    this.buildShareUrl = typeof buildShareUrl === 'function' ? buildShareUrl : null;
    this.initialShareEncoded = '';
    this.historyEditSnapshot = '';
    this.historyTrackingActive = false;
    this.historyEditEntryCreated = false;
    this.boundPopstateHandler = null;
    this.boundPageShowHandler = null;
    this.skipShareViewOnBack = false;
    this.ensurePageShowListener();
  }

  // 閲覧ビュー用の履歴エントリを現在ページへマージ
  registerShareView(encoded) {
    if (!encoded || typeof window === 'undefined' || !window.history?.replaceState) {
      return false;
    }
    try {
      const shareUrl = this.resolveShareViewUrl(encoded);
      window.history.replaceState({ shareHistoryMode: 'share-view' }, '', shareUrl);
      this.initialShareEncoded = encoded;
      this.historyTrackingActive = true;
      this.skipShareViewOnBack = false;
      this.ensureHistoryListener();
      return true;
    } catch (error) {
      console.warn('Failed to register share view history entry', error);
      this.reset();
      return false;
    }
  }

  // 編集開始時に pushState で差分エントリを積む
  beginEditingTransition() {
    if (
      !this.historyTrackingActive ||
      this.historyEditEntryCreated ||
      typeof window === 'undefined' ||
      !window.history?.pushState
    ) {
      return false;
    }
    try {
      const editUrl = this.buildEditingHistoryUrl();
      window.history.pushState({ shareHistoryMode: 'edit-view' }, '', editUrl);
      this.historyEditEntryCreated = true;
      this.skipShareViewOnBack = true;
      this.ensureHistoryListener();
      return true;
    } catch (error) {
      console.warn('Failed to register editing history entry', error);
      return false;
    }
  }

  // popstate リスナーを重複なく登録
  ensureHistoryListener() {
    if (this.boundPopstateHandler || typeof window === 'undefined') return;
    this.boundPopstateHandler = (event) => this.handleHistoryNavigation(event);
    window.addEventListener('popstate', this.boundPopstateHandler);
  }

  // BFCache 復帰などの pageshow を監視して閲覧ビューへ戻す
  ensurePageShowListener() {
    if (this.boundPageShowHandler || typeof window === 'undefined') return;
    this.boundPageShowHandler = (event) => this.handlePageShow(event);
    window.addEventListener('pageshow', this.boundPageShowHandler);
  }

  // popstate発火でモードごとの復元処理を振り分け
  handleHistoryNavigation(event) {
    if (!this.historyTrackingActive) return;
    const mode = event.state?.shareHistoryMode;
    if (mode === 'share-view') {
      if (this.skipShareViewOnBack) {
        this.skipShareViewOnBack = false;
        window.history.back();
        return;
      }
      void this.restoreShareHistoryView();
    } else if (mode === 'edit-view') {
      void this.restoreEditingHistoryView();
    }
  }

  handlePageShow(event) {
    if (!this.initialShareEncoded) return;
    if (!this.wasHistoryNavigation(event)) return;
    // 履歴経由で戻った場合は常に閲覧ビューとして再読込（自動保存を防ぐ）
    this.historyEditEntryCreated = false;
    this.historyEditSnapshot = '';
    void this.restoreShareHistoryView({ silent: true, skipSnapshot: true });
  }

  wasHistoryNavigation(event) {
    if (event?.persisted) return true;
    const perf = typeof performance !== 'undefined' ? performance : null;
    const navEntries = perf?.getEntriesByType?.('navigation');
    const latestNav = Array.isArray(navEntries) ? navEntries[0] : null;
    if (latestNav?.type === 'back_forward') return true;
    const legacyNav = perf?.navigation;
    return !!legacyNav && legacyNav.type === legacyNav.TYPE_BACK_FORWARD;
  }

  // 編集ビューの現在状態を文字列でスナップショット化
  captureEditingSnapshot() {
    if (!this.storage || typeof this.storage.exportMinified !== 'function') {
      return '';
    }
    try {
      return this.storage.exportMinified() || '';
    } catch (error) {
      console.warn('Failed to export editing snapshot', error);
      return '';
    }
  }

  // 閲覧ビューへ戻る際に共有データを読み込み直す
  async restoreShareHistoryView({ silent = false, skipSnapshot = false } = {}) {
    if (!this.initialShareEncoded) return;
    if (!skipSnapshot) {
      const snapshot = this.captureEditingSnapshot();
      if (snapshot) {
        this.historyEditSnapshot = snapshot;
      }
    }
    try {
      await this.importEncodedPayload(this.initialShareEncoded);
      this.viewStateController?.setMode(true);
      if (!silent) {
        this.statusNotifier?.show('共有ビューを再読込しました', 'info');
      }
    } catch (error) {
      console.warn('Failed to restore share view state from history', error);
      if (!silent) {
        this.statusNotifier?.show('共有ビューへの復元に失敗しました', 'error');
      }
    }
  }

  // 編集ビューへ進む際に保存済みスナップショットを復元
  async restoreEditingHistoryView() {
    if (this.historyEditSnapshot) {
      try {
        await this.importEncodedPayload(this.historyEditSnapshot);
      } catch (error) {
        console.error('Failed to restore editing workspace from snapshot', error);
        this.statusNotifier?.show('編集内容の復元に失敗しました', 'error');
        return false;
      }
    }
    this.viewStateController?.setMode(false);
    // 復元した編集内容をローカル保存へ反映する
    this.storage?.save?.();
    this.statusNotifier?.show('編集ビューへ戻りました', 'info');
    this.skipShareViewOnBack = true;
    return true;
  }

  // storage へ Minified データを流し込む共通処理
  async importEncodedPayload(encoded) {
    if (!encoded) {
      throw new Error('ENCODE_MISSING');
    }
    if (!this.storage || typeof this.storage.importMinified !== 'function') {
      throw new Error('STORAGE_NOT_READY');
    }
    if (!await this.storage.importMinified(encoded)) {
      throw new Error('LOAD_FAILED');
    }
  }

  // 共有URLを生成（fallback は現在の location）
  resolveShareViewUrl(encoded) {
    if (this.buildShareUrl) {
      return this.buildShareUrl(encoded);
    }
    const { origin, pathname } = window.location;
    return `${origin}${pathname}?${SHARE_QUERY_KEY}=${encoded}`;
  }

  // share クエリを除いた編集用 URL を生成
  buildEditingHistoryUrl() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete(SHARE_QUERY_KEY);
      const search = url.searchParams.toString();
      const hash = url.hash || '';
      return `${url.pathname}${search ? `?${search}` : ''}${hash}`;
    } catch (error) {
      console.warn('Failed to build editing history url', error);
      return `${window.location.pathname}${window.location.hash || ''}`;
    }
  }

  // popstate 監視や内部状態を初期化
  reset() {
    this.historyTrackingActive = false;
    this.historyEditEntryCreated = false;
    this.historyEditSnapshot = '';
    this.initialShareEncoded = '';
    this.skipShareViewOnBack = false;
    if (this.boundPopstateHandler && typeof window !== 'undefined') {
      window.removeEventListener('popstate', this.boundPopstateHandler);
      this.boundPopstateHandler = null;
    }
  }
}

// 共有リンクモーダルの操作をまとめたクラス
class ShareModalController {
  // コンストラクタで依存を受け取りDOMを取得
  constructor({ statusNotifier, thumbnailManager, exportSharePayload, pluginManager }) {
    this.statusNotifier = statusNotifier;
    this.thumbnailManager = thumbnailManager;
    this.exportSharePayload = exportSharePayload;
    this.pluginManager = pluginManager;
    this.shareBtn = document.getElementById('shareBtn');
    this.modalEl = document.getElementById('shareModal');
    this.modalInput = document.getElementById('shareModalInput');
    this.closeBtn = document.getElementById('shareModalClose');
    this.linkCopyBtn = document.getElementById('shareModalCopyBtn');
    this.xBtn = document.getElementById('shareModalXBtn');
    this.bindEvents();
  }

  // 各種DOMイベントをバインド
  bindEvents() {
    this.shareBtn?.addEventListener('click', () => this.handleShareButtonClick());
    this.closeBtn?.addEventListener('click', () => this.toggle(false));
    this.modalEl?.addEventListener('click', (event) => {
      if (event.target === this.modalEl) this.toggle(false);
    });
    if (this.modalInput) {
      this.modalInput.addEventListener('focus', () => this.ensureUrlVisible());
      this.modalInput.addEventListener('click', () => this.ensureUrlVisible());
    }
    this.linkCopyBtn?.addEventListener('click', () => this.handleCopyButton());
    this.xBtn?.addEventListener('click', () => this.handleXButton());
    this.boundEscHandler = (event) => {
      if (event.key === 'Escape' && this.isModalOpen()) {
        this.toggle(false);
      }
    };
    document.addEventListener('keydown', this.boundEscHandler);
  }

  // モーダルが開いているか判定
  isModalOpen() {
    return !!this.modalEl && !this.modalEl.classList.contains('hidden');
  }

  // モーダルの開閉を制御
  toggle(isOpen, url = '') {
    if (!this.modalEl || !this.modalInput) return;
    this.modalEl.setAttribute('aria-hidden', isOpen ? 'false' : 'true');

    if (isOpen) {
      if (typeof Blockly !== 'undefined') Blockly.hideChaff();

      if (this.closeTimer) {
        clearTimeout(this.closeTimer);
        this.closeTimer = null;
      }

      this.modalInput.value = url;
      this.modalEl.classList.remove('hidden');
      this.modalEl.classList.add('flex');
      void this.modalEl.offsetWidth;
      this.modalEl.classList.add('show-modal');
      setTimeout(() => {
        this.modalInput?.focus();
        this.ensureUrlVisible();
        this.thumbnailManager?.handleModalOpened();
      }, 0);
    } else {
      this.modalEl.classList.remove('show-modal');
      if (this.closeTimer) clearTimeout(this.closeTimer);

      this.closeTimer = setTimeout(() => {
        this.modalEl?.classList.remove('flex');
        this.modalEl?.classList.add('hidden');
        this.closeTimer = null;
      }, 300);
      this.modalInput.value = '';
      this.thumbnailManager?.handleModalClosed();
    }
  }

  // 入力欄のスクロールをリセットして先頭を見せる
  ensureUrlVisible() {
    if (!this.modalInput) return;
    this.modalInput.select();
    if (typeof this.modalInput.setSelectionRange === 'function') {
      this.modalInput.setSelectionRange(0, this.modalInput.value.length);
    }
    this.modalInput.scrollLeft = 0;
  }

  // Shareボタン押下時の処理フロー
  async handleShareButtonClick() {
    if (!this.shareBtn || this.shareBtn.disabled) return;

    this.shareBtn.disabled = true;
    this.shareBtn.setAttribute('aria-busy', 'true');
    try {
      const { encoded, url } = this.exportSharePayload();
      this.toggle(true, url);

      // 127.0.0.1 (ローカル開発環境) の場合は短縮URLの生成をスキップ
      if (window.location.hostname === '127.0.0.1') {
        return;
      }

      try {
        const shortUrl = await this.createShortShareUrl(encoded);
        if (shortUrl && this.isModalOpen() && this.modalInput) {
          this.modalInput.value = shortUrl;
          this.ensureUrlVisible();
        }
      } catch (error) {
        console.error('Failed to create short share url', error);
        this.statusNotifier?.show('短縮URLの生成に失敗したため通常リンクを表示します', 'error');
      }
    } catch (error) {
      console.error('Failed to generate share url', error);
      this.statusNotifier?.show('共有リンクの生成に失敗しました', 'error');
    } finally {
      this.shareBtn.disabled = false;
      this.shareBtn.removeAttribute('aria-busy');
    }
  }

  // 「リンクをコピー」ボタン実行時の処理
  async handleCopyButton() {
    if (!this.modalInput) return;
    this.ensureUrlVisible();
    const copied = await this.tryCopyToClipboard(this.modalInput.value);
    if (copied) {
      this.statusNotifier?.show('共有リンクをコピーしました！', 'success');
    } else {
      this.statusNotifier?.show('クリップボードにアクセスできません', 'error');
    }
  }

  // Xボタン押下時にintentを展開
  handleXButton() {
    if (!this.modalInput || !this.modalInput.value) return;
    const baseText = encodeURIComponent('Easy Discord Bot BuilderでDiscord BOTを作成しました！ #EDBB');
    const encodedUrl = encodeURIComponent(this.modalInput.value);
    const intentUrl = `https://x.com/intent/tweet?text=${baseText}%0A${encodedUrl}`;
    window.open(intentUrl, '_blank', 'noopener,noreferrer');
    this.statusNotifier?.show('Xのポスト画面を開きました', 'info');
  }

  // 短縮URLを生成する非同期処理
  async createShortShareUrl(encoded) {
    const endpoints = this.resolveShortenerEndpoints();
    let lastError = null;

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ share: encoded }),
        });
        if (!response.ok) {
          lastError = new Error(`SHORTENER_HTTP_${response.status}`);
          continue;
        }
        const data = await response.json();
        if (!data?.url) {
          lastError = new Error('SHORTENER_RESPONSE_INVALID');
          continue;
        }
        return this.normalizeShortShareUrl(data.url);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('SHORTENER_UNAVAILABLE');
  }

  resolveShortenerEndpoints() {
    const endpoints = [];
    const pushUnique = (value) => {
      if (!value) return;
      if (!endpoints.includes(value)) {
        endpoints.push(value);
      }
    };

    const sameOriginEndpoint = new URL(SHARE_SHORTENER_ENDPOINT, window.location.origin).toString();
    pushUnique(sameOriginEndpoint);

    const hostname = window.location.hostname || '';
    const isBetaHost = /^beta(\.|-)/i.test(hostname);
    if (isBetaHost) {
      pushUnique(new URL(SHARE_SHORTENER_ENDPOINT, SHARE_BETA_ORIGIN).toString());
    }

    pushUnique(new URL(SHARE_SHORTENER_ENDPOINT, SHARE_CANONICAL_ORIGIN).toString());
    return endpoints;
  }

  // 短縮URLが期待ドメインになるように整形
  normalizeShortShareUrl(url) {
    try {
      const parsed = new URL(url, window.location.origin);
      const shareHost = new URL(SHARE_CANONICAL_ORIGIN).hostname;
      const isHimaisDomain =
        parsed.hostname === 'himais0giiiin.com' || parsed.hostname.endsWith('.himais0giiiin.com');
      if (isHimaisDomain && parsed.hostname !== shareHost) {
        parsed.protocol = 'https:';
        parsed.hostname = shareHost;
        return parsed.toString();
      }
      return parsed.toString();
    } catch (error) {
      console.warn('Failed to normalize short url', error);
      return url;
    }
  }

  // テキストのクリップボードコピーを試みる
  async tryCopyToClipboard(text) {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      return false;
    }
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.warn('Clipboard copy failed', error);
      return false;
    }
  }
}

// 共有インポート確認モーダルの挙動をまとめたクラス
class ShareImportModalController {
  // コンストラクタでDOMと依存を取得
  constructor({
    storage,
    statusNotifier,
    preferenceManager,
    viewStateController,
    historyManager,
  }) {
    this.storage = storage;
    this.statusNotifier = statusNotifier;
    this.preferenceManager = preferenceManager;
    this.viewStateController = viewStateController;
    this.historyManager = historyManager;
    this.modalEl = document.getElementById('shareImportModal');
    this.confirmBtn = document.getElementById('shareImportConfirmBtn');
    this.cancelBtn = document.getElementById('shareImportCancelBtn');
    this.closeBtn = document.getElementById('shareImportModalClose');
    this.downloadBtn = document.getElementById('shareImportDownloadBtn');
    this.skipCheckbox = document.getElementById('shareImportSkipCheckbox');
    this.startEditingBtn = document.getElementById('shareViewStartEditingBtn');
    this.pendingShareEncoded = '';
    this.bindEvents();
  }

  // イベントやショートカットを登録
  bindEvents() {
    this.confirmBtn?.addEventListener('click', () => this.handleConfirm());
    this.cancelBtn?.addEventListener('click', () => this.handleCancel());
    this.closeBtn?.addEventListener('click', () => this.handleCancel());
    this.downloadBtn?.addEventListener('click', () => {
      this.storage?.exportFile();
    });
    this.modalEl?.addEventListener('click', (event) => {
      if (event.target === this.modalEl) {
        this.handleCancel();
      }
    });
    if (this.skipCheckbox) {
      this.skipCheckbox.addEventListener('change', (event) => {
        this.preferenceManager?.setSkipImportDialog(Boolean(event.target?.checked));
      });
    }
    this.startEditingBtn?.addEventListener('click', () => this.handleStartEditingRequest());
    this.boundEscHandler = (event) => {
      if (event.key === 'Escape' && this.isOpen()) {
        this.handleCancel();
      }
    };
    document.addEventListener('keydown', this.boundEscHandler);
  }

  // モーダルが表示中かどうかを判定
  isOpen() {
    return !!this.modalEl && !this.modalEl.classList.contains('hidden');
  }

  // モーダルを開く処理
  showModal() {
    if (!this.modalEl) return;
    if (this.skipCheckbox && this.preferenceManager) {
      this.skipCheckbox.checked = this.preferenceManager.shouldSkipImportDialog();
    }
    this.modalEl.setAttribute('aria-hidden', 'false');
    this.modalEl.classList.remove('hidden');
    this.modalEl.classList.add('flex');
    void this.modalEl.offsetWidth;
    this.modalEl.classList.add('show-modal');
    setTimeout(() => {
      this.confirmBtn?.focus();
    }, 0);
  }

  // モーダルを閉じる処理
  hideModal() {
    if (!this.modalEl) return Promise.resolve();
    this.modalEl.setAttribute('aria-hidden', 'true');
    this.modalEl.classList.remove('show-modal');
    return new Promise((resolve) => {
      setTimeout(() => {
        this.modalEl?.classList.remove('flex');
        this.modalEl?.classList.add('hidden');
        resolve();
      }, 300);
    });
  }

  // 閉じた後の後処理 (閲覧モード解除など)
  finalize(applied) {
    return this.hideModal().then(() => {
      if (applied) {
        const historyHandled =
          this.historyManager?.beginEditingTransition?.() ?? false; // pushState 成功時はURLを書き換え済み
        this.pendingShareEncoded = '';
        this.viewStateController?.setMode(false);
        // 共有読込中はイベント抑止で自動保存が走らないため、編集開始時に明示的に保存する
        this.storage?.save?.();
        if (!historyHandled) {
          this.cleanupShareQuery();
        }
      }
    });
  }

  // 「編集開始」ボタンから呼び出される処理
  handleStartEditingRequest() {
    if (!this.viewStateController?.isEnabled()) return;
    if (this.preferenceManager?.shouldSkipImportDialog()) {
      this.handleConfirm();
      return;
    }
    this.showModal();
  }

  // 確認ボタン押下時の処理
  async handleConfirm() {
    if (!this.pendingShareEncoded) {
      this.finalize(false);
      return;
    }
    if (this.confirmBtn) {
      this.confirmBtn.disabled = true;
      this.confirmBtn.setAttribute('aria-busy', 'true');
    }
    try {
      await this.tryImportEncodedPayload(this.pendingShareEncoded);
      this.statusNotifier?.show('共有ブロックの編集を開始します。(Tips: ブラウザバックで元のブロックを復元できます)', 'success');
      await this.finalize(true);
    } catch (error) {
      console.warn('Failed to read shared layout', error);
      this.statusNotifier?.show('共有データを適用できませんでした', 'error');
      await this.finalize(false);
    } finally {
      if (this.confirmBtn) {
        this.confirmBtn.disabled = false;
        this.confirmBtn.removeAttribute('aria-busy');
      }
    }
  }

  // キャンセル系操作時の処理
  handleCancel() {
    if (!this.isOpen()) return;
    this.statusNotifier?.show('共有ブロックの読み込みをキャンセルしました', 'info');
    this.finalize(false);
  }

  // URLクエリに含まれる共有データを適用
  async applySharedLayoutFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get(SHARE_QUERY_KEY);
    if (!encoded) return false;

    this.pendingShareEncoded = encoded;
    try {
      await this.tryImportEncodedPayload(encoded);
      this.historyManager?.registerShareView(encoded); // 閲覧ビューのURLを履歴に固定
      this.viewStateController?.setMode(true);
      this.statusNotifier?.show('共有ブロックを閲覧専用で開いています', 'info');
      return true;
    } catch (error) {
      console.warn('Failed to read shared layout', error);
      this.statusNotifier?.show('共有データを適用できませんでした', 'error');
      this.pendingShareEncoded = '';
      this.viewStateController?.setMode(false);
      this.cleanupShareQuery();
      return false;
    }
  }

  // クエリーパラメータからshareを削除
  cleanupShareQuery() {
    if (typeof window.history.replaceState === 'function') {
      window.history.replaceState({}, '', window.location.pathname); // share= を即時除去
    }
    this.historyManager?.reset?.(); // History API 非対応環境では内部状態も破棄
  }

  // storageへ共有データを書き戻す (失敗時は例外)
  async tryImportEncodedPayload(encoded) {
    const success = await this.storage?.importMinified(encoded);
    if (!success) {
      throw new Error('LOAD_FAILED');
    }
  }
}

// 各コンポーネントをまとめ上げるエントリーポイントクラス
class ShareFeature {
  // コンストラクタで依存を受け取り必要なコントローラを生成
  constructor({ workspace, storage }) {
    this.workspace = workspace;
    this.storage = storage;
    this.statusNotifier = new ShareStatusNotifier();
    this.preferenceManager = new SharePreferenceManager();
    this.viewStateController = new ShareViewStateController(workspace);
    this.thumbnailManager = new ShareThumbnailManager(workspace, this.statusNotifier);
    this.historyManager = new ShareHistoryManager({
      storage,
      statusNotifier: this.statusNotifier,
      viewStateController: this.viewStateController,
      buildShareUrl: (encoded) => this.buildShareUrl(encoded),
    });
    this.shareModalController = new ShareModalController({
      statusNotifier: this.statusNotifier,
      thumbnailManager: this.thumbnailManager,
      exportSharePayload: () => this.exportSharePayload(),
      pluginManager: storage.pluginManager, // storageからアクセスできるようにするか、引数で渡す
    });
    this.shareImportModalController = new ShareImportModalController({
      storage,
      statusNotifier: this.statusNotifier,
      preferenceManager: this.preferenceManager,
      viewStateController: this.viewStateController,
      historyManager: this.historyManager,
    });

    // 自作プラグインの状態を監視してボタンの見た目を更新
    this.updateShareButtonState();
  }

  updateShareButtonState() {
    const shareBtn = document.getElementById('shareBtn');
    if (!shareBtn) return;

    shareBtn.classList.remove('hidden');
    shareBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    shareBtn.title = '';
  }

  // 共有URLを組み立て
  buildShareUrl(encoded) {
    const { origin, pathname } = window.location;
    const base =
      origin && origin !== 'null'
        ? `${origin}${pathname}`
        : window.location.href.split('?')[0].split('#')[0];
    return `${base}?${SHARE_QUERY_KEY}=${encoded}`;
  }

  // workspace+storageから共有ペイロードを生成
  exportSharePayload() {
    if (!this.workspace || !this.storage) throw new Error('WORKSPACE_NOT_READY');
    const encoded = this.storage.exportMinified();
    if (!encoded) throw new Error('ENCODE_FAILED');
    return {
      encoded,
      url: this.buildShareUrl(encoded),
    };
  }

  // 共有クエリを強制適用させる
  async applySharedLayoutFromQuery() {
    return await this.shareImportModalController.applySharedLayoutFromQuery();
  }

  // 閲覧モードの真偽を返す
  isShareViewMode() {
    return this.viewStateController.isEnabled();
  }

  // 閲覧モードリスナー登録を仲介
  onShareViewModeChange(listener) {
    return this.viewStateController.onChange(listener);
  }

  // 外部へ公開するAPIを取得
  getPublicApi() {
    return {
      applySharedLayoutFromQuery: async () => await this.applySharedLayoutFromQuery(),
      isShareViewMode: () => this.isShareViewMode(),
      onShareViewModeChange: (listener) => this.onShareViewModeChange(listener),
      applyUiState: () => this.viewStateController.applyUiState(),
      updateShareButtonState: () => this.updateShareButtonState(),
    };
  }
}

// 共有機能を初期化し、公開APIを返すエントリーポイント
export const initShareFeature = ({ workspace, storage }) => {
  const feature = new ShareFeature({ workspace, storage });
  return feature.getPublicApi();
};
