import { showTopRightToast } from './core/ui.js';

// Blockly only serializes its registered stores, not workspace.getExtraState().
// Keep the existing Blockly JSON shape and include our project data alongside it.
const EXTRA_STATE_KEY = 'edbbExtraState';
const registeredProjectSerializers = new WeakSet();
const registerProjectSerializer = () => {
  const registry = Blockly.serialization.registry;
  if (!registry || registeredProjectSerializers.has(registry)) return;
  registry.register(EXTRA_STATE_KEY, {
    // Restore variables first, then our dropdown data, then the blocks that use it.
    priority: Blockly.serialization.priorities.BLOCKS + 1,
    save: workspace => workspace.getExtraState?.() || null,
    clear: workspace => workspace.setExtraState?.({}),
    load: (state, workspace) => workspace.setExtraState?.(state),
  });
  registeredProjectSerializers.add(registry);
};
const captureWorkspace = (workspace) => {
  const state = Blockly.serialization.workspaces.save(workspace);
  if (workspace.getExtraState) state[EXTRA_STATE_KEY] = workspace.getExtraState();
  return JSON.parse(JSON.stringify(state));
};
const loadWorkspace = (state, workspace) => {
  Blockly.serialization.workspaces.load(state, workspace);
  // Legacy projects contain no extra data and must not inherit another project.
  if (!registeredProjectSerializers.has(Blockly.serialization.registry)) {
    workspace.setExtraState?.(state?.[EXTRA_STATE_KEY] || {});
  }
};

// 共有リンク用にワークスペースのJSONを極小化・圧縮するクラス
// 参照IDと追加データを保持し、LZStringでURL用に圧縮する
class WorkspaceShareCodec {
  static compress(workspace) {
    if (!workspace) return '';
    const lz = typeof window !== 'undefined' ? window.LZString : undefined;
    if (!lz?.compressToEncodedURIComponent) {
      console.error('LZStringが利用できないため圧縮できません。');
      return '';
    }
    try {
      // Preserve arbitrary IDs: variable fields and plugin extra state may use them.
      const raw = captureWorkspace(workspace);

      // プラグイン情報の付与
      const payloadObj = {
        workspace: raw,
        pluginUUIDs: workspace.pluginManager?.getPluginUUIDsForShare() || [],
        pluginInfo: workspace.pluginManager?.getSharablePluginsInfo() || []
      };

      const payload = JSON.stringify(payloadObj);
      const compressed = lz.compressToEncodedURIComponent(payload);
      if (!compressed) throw new Error('圧縮に失敗しました。');
      return compressed;
    } catch (error) {
      console.error('ワークスペースの圧縮に失敗しました。', error);
      return '';
    }
  }

  static async decompress(encoded, workspace) {
    if (!workspace || !encoded) return false;
    const lz = typeof window !== 'undefined' ? window.LZString : undefined;
    if (!lz?.decompressFromEncodedURIComponent) {
      console.error('LZStringが利用できないため復号できません。');
      return false;
    }
    try {
      const text = lz.decompressFromEncodedURIComponent(encoded);
      if (!text) throw new Error('データを展開できませんでした。');

      // 基本的な構造チェック (JSONの断片として妥当か)
      if (!text.trim().startsWith('{') && !text.trim().startsWith('[')) {
        throw new Error('復号されたデータ形式が不正です。');
      }

      const payload = JSON.parse(text);

      const isExtendedPayload = !!(payload && typeof payload === 'object' && payload.workspace);
      const workspaceData = isExtendedPayload ? payload.workspace : payload;

      // プラグイン情報の処理を先に行う (Blockly読込前に定義を揃えるため)
      if (isExtendedPayload && workspace.pluginManager) {
        const uuids = payload.pluginUUIDs || [];
        const pluginInfo = payload.pluginInfo || [];
        const missingPlugins = [];

        // インストール済みチェック
        if (pluginInfo.length > 0) {
          pluginInfo.forEach(entry => {
            // entry がリポジトリURLそのものになったため、正規化してチェック
            const cleanUrl = entry.split('?')[0].replace(/\/$/, '').replace(/\.git$/, '');
            const isInstalled = workspace.pluginManager.getRegistry().some(p => {
              const pClean = p.repo?.split('?')[0].replace(/\/$/, '').replace(/\.git$/, '');
              return pClean === cleanUrl;
            });
            if (!isInstalled) {
              missingPlugins.push(entry);
            }
          });
        }

        // 有効化 (awaitして定義を確定させる)
        for (const uuid of uuids) {
          const pluginId = workspace.pluginManager.getPluginIdByUUID(uuid);
          if (pluginId) {
            try {
              // タイムアウト付きで有効化を試みる
              const enablePromise = workspace.pluginManager.enablePlugin(pluginId);
              const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 3000));
              await Promise.race([enablePromise, timeoutPromise]);
            } catch (e) {
              console.warn(`Plugin activation failed or timed out: ${pluginId}`, e);
            }
          }
        }

        // 未インストールがあれば後で促す
        if (missingPlugins.length > 0) {
          // 確実にワークスペース読込が終わった後に表示させる
          requestAnimationFrame(() => {
            setTimeout(() => {
              if (workspace.pluginManager.suggestPlugins) {
                workspace.pluginManager.suggestPlugins(missingPlugins);
              }
            }, 1000);
          });
        }
      }

      // 最後にワークスペースを読み込む
      // イベントを止めて読み込むことで、自動保存などのリスナーが
      // 共有データでローカルの保存内容を上書きしてしまうのを防ぐ
      if (workspaceData) {
        const backup = captureWorkspace(workspace);
        Blockly.Events.disable();
        try {
          loadWorkspace(workspaceData, workspace);
        } catch (loadError) {
          try { loadWorkspace(backup, workspace); }
          catch (restoreError) { console.error('Failed to restore workspace after shared-data error:', restoreError); }
          throw loadError;
        } finally {
          Blockly.Events.enable();
        }
      }

      return true;
    } catch (error) {
      console.error('圧縮ワークスペースの読込みに致命的な失敗が発生しました。', error);
      return false;
    }
  }

}

export default class WorkspaceStorage {
  static STORAGE_KEY = 'discord_bot_builder_workspace_v5';
  static DEFAULT_TITLE = 'bot-project';

  #workspace;
  #titleProvider = () => WorkspaceStorage.DEFAULT_TITLE;
  #saveFailureNotified = false;
  #saveHandler = null;

  constructor(workspace) {
    this.#workspace = workspace;
    registerProjectSerializer();
  }

  setTitleProvider(provider) {
    if (typeof provider === 'function') {
      this.#titleProvider = provider;
    } else {
      this.#titleProvider = () => WorkspaceStorage.DEFAULT_TITLE;
    }
  }

  static sanitizeTitle(rawTitle) {
    if (!rawTitle || typeof rawTitle !== 'string') {
      return WorkspaceStorage.DEFAULT_TITLE;
    }
    const normalized = rawTitle.trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-');
    return normalized || WorkspaceStorage.DEFAULT_TITLE;
  }

  static buildDownloadName(title, date = new Date()) {
    const safeTitle = WorkspaceStorage.sanitizeTitle(title);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const timestamp = `${month}-${day}-${hours}${minutes}`;
    return `EDBB-${safeTitle}-${timestamp}.json`;
  }

  static normalizeDownloadName(rawName, fallbackName) {
    const fallback =
      typeof fallbackName === 'string' && fallbackName.trim()
        ? fallbackName.trim()
        : WorkspaceStorage.buildDownloadName(WorkspaceStorage.DEFAULT_TITLE);
    if (!rawName || typeof rawName !== 'string') {
      return fallback;
    }
    const cleaned = rawName.trim().replace(/[\\/:*?"<>|]/g, '');
    if (!cleaned) {
      return fallback;
    }
    return /\.json$/i.test(cleaned) ? cleaned : `${cleaned}.json`;
  }

  #resolveTitle() {
    try {
      const provided = typeof this.#titleProvider === 'function' ? this.#titleProvider() : '';
      return WorkspaceStorage.sanitizeTitle(provided);
    } catch (error) {
      console.warn('Failed to resolve project title', error);
      return WorkspaceStorage.DEFAULT_TITLE;
    }
  }

  #resolveDownloadName(fileName) {
    const fallback = WorkspaceStorage.buildDownloadName(this.#resolveTitle());
    return WorkspaceStorage.normalizeDownloadName(fileName, fallback);
  }

  // XMLかどうかの大まかな判定
  static #looksLikeXml(text) {
    return typeof text === 'string' && text.trim().startsWith('<');
  }

  // Fileオブジェクトをテキストとして読む
  static #readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => resolve(event.target?.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file, 'utf-8');
    });
  }

  // --- 公開API ---

  // JSON文字列として取得（ダウンロードせずに利用）
  exportText({ pretty = false } = {}) {
    if (!this.#workspace) return '';
    try {
      const data = captureWorkspace(this.#workspace);
      return JSON.stringify(data, null, pretty ? 2 : 0);
    } catch (error) {
      console.error('ワークスペースのシリアライズに失敗しました。', error);
      return '';
    }
  }

  // JSONまたはXML文字列を判別して読み込む
  importText(text, { preserveLegacyExtraState = false } = {}) {
    let backup;
    try { backup = captureWorkspace(this.#workspace); }
    catch (_) { backup = null; }
    if (WorkspaceStorage.#looksLikeXml(text)) {
      try {
        const textToDom = Blockly.utils?.xml?.textToDom || Blockly.Xml.textToDom;
        const dom = textToDom(text);
        Blockly.Xml.clearWorkspaceAndLoadFromXml(dom, this.#workspace);
        this.#workspace.setExtraState?.(preserveLegacyExtraState ? backup?.[EXTRA_STATE_KEY] || {} : {});
        return true;
      } catch (error) {
        this.#restoreBackup(backup);
        return false;
      }
    }
    try {
      // JSONはシリアライズAPIを使って復元
      const data = JSON.parse(text);
      if (preserveLegacyExtraState && data && typeof data === 'object' && !Object.hasOwn(data, EXTRA_STATE_KEY)) {
        // Older autosaves kept JSON GUI data in a separate browser key. Migrate
        // that startup fallback once; file/shared imports still start clean.
        data[EXTRA_STATE_KEY] = backup?.[EXTRA_STATE_KEY] || {};
      }
      loadWorkspace(data, this.#workspace);
      return true;
    } catch (error) {
      this.#restoreBackup(backup);
      return false;
    }
  }

  setSaveHandler(handler) { this.#saveHandler = handler; }

  #restoreBackup(backup) {
    if (!backup) return;
    try { loadWorkspace(backup, this.#workspace); }
    catch (restoreError) { console.error('ワークスペースの復元に失敗しました。', restoreError); }
  }

  // 共有URL向けの極小データを生成
  exportMinified() {
    return WorkspaceShareCodec.compress(this.#workspace);
  }

  // 極小データを復元
  async importMinified(encoded) {
    return await WorkspaceShareCodec.decompress(encoded, this.#workspace);
  }

  // 現在のワークスペース状態をlocalStorageへ保存
  // 成功時は true、失敗時は false を返す
  save() {
    const json = this.exportText({ pretty: false });
    if (!json) return false;
    try {
      if (this.#saveHandler) {
        if (this.#saveHandler(json) === false) return false;
      } else localStorage.setItem(WorkspaceStorage.STORAGE_KEY, json);
      this.#saveFailureNotified = false;
      return true;
    } catch (error) {
      console.error('ワークスペースの保存に失敗しました。', error);
      // 容量超過などの保存失敗をユーザーへ通知（成功するまで1回だけ）
      if (!this.#saveFailureNotified) {
        this.#saveFailureNotified = true;
        showTopRightToast(
          `自動保存に失敗しました。${error?.message || 'ブラウザの保存容量が不足している可能性があります。'} JSONエクスポートでバックアップしてください。`,
          { icon: 'error', timer: 6000 },
        );
      }
      return false;
    }
  }

  // localStorageから保存済みデータを復元
  load() {
    try {
      const stored = localStorage.getItem(WorkspaceStorage.STORAGE_KEY);
      if (!stored) return false;
      if (this.importText(stored, { preserveLegacyExtraState: true })) {
        // XMLから読み込んだ場合でも即JSONに変換し直す
        this.save();
        return true;
      }
    } catch (error) {
      console.error('ワークスペースの読み込みに失敗しました。', error);
    }
    return false;
  }

  // JSONファイルとしてダウンロード
  exportFile({ pretty = true, fileName } = {}) {
    const json = this.exportText({ pretty });
    if (!json) return false;
    try {
      const resolvedName = this.#resolveDownloadName(fileName);
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resolvedName;
      a.click();
      URL.revokeObjectURL(url);
      return true;
    } catch (error) {
      console.error('ワークスペースのエクスポートに失敗しました。', error);
      return false;
    }
  }

  getDefaultExportFileName() {
    return this.#resolveDownloadName('');
  }

  async saveFileWithPicker({ pretty = true, fileName } = {}) {
    if (typeof window === 'undefined' || typeof window.showSaveFilePicker !== 'function') {
      return false;
    }
    const json = this.exportText({ pretty });
    if (!json) return false;

    const resolvedName = this.#resolveDownloadName(fileName);
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: resolvedName,
        types: [
          {
            description: 'JSON Files',
            accept: {
              'application/json': ['.json'],
            },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([json], { type: 'application/json;charset=utf-8' }));
      await writable.close();
      return true;
    } catch (error) {
      if (error?.name === 'AbortError') {
        return false;
      }
      console.error('ファイルピッカー経由の保存に失敗しました。', error);
      return false;
    }
  }

  // ユーザーが選択したファイルを読み込み
  async importFile(file) {
    if (!file) return false;
    try {
      const text = await WorkspaceStorage.#readFile(file);
      if (typeof text !== 'string') throw new Error('ファイルを読み込めませんでした。');
      if (!this.importText(text)) {
        throw new Error('対応していないファイル形式です。');
      }
      this.save();
      return true;
    } catch (error) {
      console.error('ワークスペースのインポートに失敗しました。', error);
      return false;
    }
  }
}
