// Note: blocks.js modifies the global Blockly object directly
// We import it to ensure it's loaded and executed
// blocks.js is loaded dynamically in startApp

import WorkspaceStorage from './storage.js';
import { initShareFeature } from "./share.js";
import { CollabManager } from "./collab.js";
import { CollabUI } from "./collab-ui.js";
import { PluginManager } from "./plugin.js";
import { PluginUI, PLUGIN_FEATURE_TOGGLES_STORAGE_KEY } from "./plugin-ui.js";
import { BlockSearch } from "./block-search.js";

const PROJECT_TITLE_STORAGE_KEY = 'edbb_project_title';

let workspace;
let storage;

const LIST_STORE_KEY = 'edbb_list_store';
const JSON_DATA_STORE_KEY = 'edbb_json_store';
const JSON_GUI_DATASET_LOCAL_KEY = 'edbb_json_gui_dataset_store_v1';

import { hasSweetAlert2, showConfirmDialog, showPromptDialog, showAlertDialog, showTopRightToast } from './core/ui.js';
import { analyzeWorkspaceForCodegen, generatePythonCode, generateSplitPythonFiles, downloadTextFile, renderSplitFiles } from './core/export.js';
import { setupBlocklyEnvironment, setupLiteralInputAutofill } from './core/workspace.js';

const listStore = (() => {
  let lists = new Map();

  const normalizeItems = (items) => {
    if (!Array.isArray(items)) return [];
    return items.map((item) => (item == null ? '' : String(item)));
  };

  const ensureList = (id) => {
    if (!id) return [];
    if (!lists.has(id)) lists.set(id, []);
    return lists.get(id) || [];
  };

  const setItems = (id, items) => {
    if (!id) return;
    lists.set(id, normalizeItems(items));
  };

  const getItems = (id) => lists.get(id) || [];

  const appendItem = (id, value = '') => {
    if (!id) return;
    const items = [...getItems(id), String(value)];
    lists.set(id, items);
  };

  const updateItem = (id, index, value) => {
    if (!id) return;
    const items = [...getItems(id)];
    if (index < 0 || index >= items.length) return;
    items[index] = String(value ?? '');
    lists.set(id, items);
  };

  const removeItem = (id, index) => {
    if (!id) return;
    const items = [...getItems(id)];
    if (index < 0 || index >= items.length) return;
    items.splice(index, 1);
    lists.set(id, items);
  };

  const removeList = (id) => {
    if (!id) return;
    lists.delete(id);
  };

  const getEntries = () =>
    Array.from(lists.entries()).map(([id, items]) => ({ id, items: [...items] }));

  const getIds = () => Array.from(lists.keys());

  const toJSON = (workspaceRef) => {
    const payload = { lists: [] };
    if (!workspaceRef) return payload;
    lists.forEach((items, id) => {
      const variable = workspaceRef.getVariableById(id);
      if (!variable) return;
      payload.lists.push({
        name: variable.name,
        items: [...items],
      });
    });
    return payload;
  };

  const fromJSON = (data, workspaceRef) => {
    lists = new Map();
    if (!data || typeof data !== 'object') return;

    if (Array.isArray(data.lists)) {
      data.lists.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const name = String(entry.name || '').trim();
        if (!name) return;
        let variable = null;
        if (workspaceRef?.getVariableMap) {
          const variableMap = workspaceRef.getVariableMap();
          variable =
            variableMap?.getVariable?.(name) ||
            variableMap?.getVariableByName?.(name) ||
            variableMap?.getAllVariables?.().find((item) => item.name === name) ||
            null;
        }
        if (!variable && workspaceRef?.createVariable) {
          variable = workspaceRef.createVariable(name);
        }
        if (!variable) return;
        lists.set(variable.getId(), normalizeItems(entry.items));
      });
      return;
    }

    // Backward compatibility: id -> items map
    Object.entries(data).forEach(([id, items]) => {
      if (!Array.isArray(items)) return;
      const variable = workspaceRef?.getVariableById?.(id);
      if (!variable) return;
      lists.set(variable.getId(), normalizeItems(items));
    });
  };

  return {
    ensureList,
    setItems,
    getItems,
    appendItem,
    updateItem,
    removeItem,
    removeList,
    getEntries,
    getIds,
    toJSON,
    fromJSON,
  };
})();

/**
 * JavaScriptの値をPythonのリテラル形式の文字列に変換します。
 */
const serializeToPythonLiteral = (value) => {
  if (value === null) return 'None';
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeToPythonLiteral(item)).join(', ')}]`;
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(
      ([key, item]) => `${JSON.stringify(key)}: ${serializeToPythonLiteral(item)}`,
    );
    return `{${entries.join(', ')}}`;
  }
  return 'None';
};

const jsonDataStore = (() => {
  const ALLOWED_TYPES = new Set(['string', 'number', 'boolean', 'null', 'object', 'array']);
  let datasets = new Map();

  const normalizeName = (name) => String(name ?? '').trim();
  const normalizeType = (type) => (ALLOWED_TYPES.has(type) ? type : 'string');
  const normalizeRow = (row) => ({
    key: String(row?.key ?? '').trim(),
    type: normalizeType(String(row?.type ?? 'string')),
    value: String(row?.value ?? ''),
  });
  const normalizeRows = (rows) => (Array.isArray(rows) ? rows.map((row) => normalizeRow(row)) : []);
  const cloneRows = (rows) => normalizeRows(rows);

  const setRows = (name, rows) => {
    const normalizedName = normalizeName(name);
    if (!normalizedName) return false;
    datasets.set(normalizedName, normalizeRows(rows));
    return true;
  };

  const getRows = (name) => cloneRows(datasets.get(normalizeName(name)) || []);

  const createDataset = (name, rows = []) => {
    const normalizedName = normalizeName(name);
    if (!normalizedName || datasets.has(normalizedName)) return false;
    datasets.set(normalizedName, normalizeRows(rows));
    return true;
  };

  const hasDataset = (name) => datasets.has(normalizeName(name));

  const renameDataset = (fromName, toName) => {
    const from = normalizeName(fromName);
    const to = normalizeName(toName);
    if (!from || !to || !datasets.has(from)) return false;
    if (from !== to && datasets.has(to)) return false;
    const rows = datasets.get(from) || [];
    datasets.delete(from);
    datasets.set(to, cloneRows(rows));
    return true;
  };

  const removeDataset = (name) => {
    const normalizedName = normalizeName(name);
    if (!normalizedName) return false;
    return datasets.delete(normalizedName);
  };

  const appendRow = (name, row = {}) => {
    const normalizedName = normalizeName(name);
    if (!normalizedName) return false;
    const rows = getRows(normalizedName);
    rows.push(normalizeRow(row));
    datasets.set(normalizedName, rows);
    return true;
  };

  const updateRow = (name, index, patch = {}) => {
    const normalizedName = normalizeName(name);
    if (!normalizedName) return false;
    const rows = getRows(normalizedName);
    if (index < 0 || index >= rows.length) return false;
    rows[index] = normalizeRow({ ...rows[index], ...patch });
    datasets.set(normalizedName, rows);
    return true;
  };

  const removeRow = (name, index) => {
    const normalizedName = normalizeName(name);
    if (!normalizedName) return false;
    const rows = getRows(normalizedName);
    if (index < 0 || index >= rows.length) return false;
    rows.splice(index, 1);
    datasets.set(normalizedName, rows);
    return true;
  };

  const parseBoolean = (rawValue) => {
    const lowered = String(rawValue ?? '')
      .trim()
      .toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(lowered)) return { value: true, error: null };
    if (['false', '0', 'no', 'off'].includes(lowered)) return { value: false, error: null };
    return { value: false, error: '真偽値は true / false で入力してください' };
  };

  const parseJsonStructure = (rawValue, expected) => {
    const fallback = expected === 'array' ? '[]' : '{}';
    const source = String(rawValue ?? '').trim() || fallback;
    try {
      const parsed = JSON.parse(source);
      if (expected === 'array' && !Array.isArray(parsed)) {
        return { value: [], error: '値はJSON配列で入力してください' };
      }
      if (expected === 'object' && (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')) {
        return { value: {}, error: '値はJSONオブジェクトで入力してください' };
      }
      return { value: parsed, error: null };
    } catch (error) {
      return {
        value: expected === 'array' ? [] : {},
        error: expected === 'array' ? 'JSON配列の形式が不正です' : 'JSONオブジェクトの形式が不正です',
      };
    }
  };

  const buildDatasetData = (name) => {
    const normalizedName = normalizeName(name);
    const rows = datasets.get(normalizedName) || [];
    const data = {};
    const errors = [];

    rows.forEach((row, index) => {
      const key = normalizeName(row.key);
      const type = normalizeType(row.type);
      const valueText = String(row.value ?? '');

      if (!key) {
        errors.push(`${index + 1}行目: キーが空です`);
        return;
      }

      let value = valueText;
      let error = null;

      if (type === 'number') {
        const parsed = Number(valueText);
        if (Number.isFinite(parsed)) {
          value = parsed;
        } else {
          value = 0;
          error = '数値の形式が不正です';
        }
      } else if (type === 'boolean') {
        const parsed = parseBoolean(valueText);
        value = parsed.value;
        error = parsed.error;
      } else if (type === 'null') {
        value = null;
      } else if (type === 'object') {
        const parsed = parseJsonStructure(valueText, 'object');
        value = parsed.value;
        error = parsed.error;
      } else if (type === 'array') {
        const parsed = parseJsonStructure(valueText, 'array');
        value = parsed.value;
        error = parsed.error;
      }

      if (error) {
        errors.push(`${index + 1}行目 (${key}): ${error}`);
      }

      data[key] = value;
    });

    return { data, errors };
  };

  const toPythonLiteral = (name) => {
    const { data } = buildDatasetData(name);
    return serializeToPythonLiteral(data);
  };

  const getDatasetNames = () => Array.from(datasets.keys());

  const toJSON = () => ({
    datasets: getDatasetNames().map((name) => ({
      name,
      rows: getRows(name),
    })),
  });

  const fromJSON = (state) => {
    datasets = new Map();
    if (!state || typeof state !== 'object') return;

    if (Array.isArray(state.datasets)) {
      state.datasets.forEach((entry) => {
        const name = normalizeName(entry?.name);
        if (!name) return;
        datasets.set(name, normalizeRows(entry?.rows));
      });
      return;
    }

    Object.entries(state).forEach(([name, rows]) => {
      const normalizedName = normalizeName(name);
      if (!normalizedName) return;
      datasets.set(normalizedName, normalizeRows(rows));
    });
  };

  return {
    hasDataset,
    createDataset,
    renameDataset,
    removeDataset,
    getDatasetNames,
    getRows,
    setRows,
    appendRow,
    updateRow,
    removeRow,
    buildDatasetData,
    toPythonLiteral,
    toJSON,
    fromJSON,
  };
})();

/**
 * UIから入力された生の文字列を、最適なPythonリテラル形式（数値、真偽値、または引用符付き文字列）に変換します。
 */
const parseRawToPythonLiteral = (raw) => {
  const original = String(raw ?? '');
  const trimmed = original.trim();
  if (!trimmed) return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  const lowered = trimmed.toLowerCase();
  if (lowered === 'true') return 'True';
  if (lowered === 'false') return 'False';
  if (lowered === 'none' || lowered === 'null') return 'None';
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  if (quoted) return trimmed;
  return JSON.stringify(original);
};

const buildListInitializationCode = (generator) => {
  if (!workspace) return '';
  const entries = listStore.getEntries();
  if (!entries.length) return '';
  if (!generator?.nameDB_) return '';
  const lines = [];
  entries.forEach(({ id, items }) => {
    const variable = workspace.getVariableById(id);
    if (!variable) return;
    const name = generator.nameDB_.getName(variable.name, Blockly.Names.VARIABLE_NAME);
    const serialized = items
      .map((item) => parseRawToPythonLiteral(item))
      .filter((item) => item !== null);
    lines.push(`${name} = [${serialized.join(', ')}]`);
  });
  return lines.join('\n');
};

const ensureListGenerator = (() => {
  let patched = false;
  return () => {
    if (patched || !Blockly?.Python?.finish) return;
    const originalFinish = Blockly.Python.finish;
    Blockly.Python.finish = function (code) {
      const listInit = buildListInitializationCode(this);
      if (listInit) {
        this.definitions_['edbb_list_init'] = listInit;
      } else if (this.definitions_) {
        delete this.definitions_['edbb_list_init'];
      }
      return originalFinish.call(this, code);
    };
    patched = true;
  };
})();




const html = document.documentElement;
const isMobileDevice =
  typeof window !== 'undefined' && window.innerWidth < 768;
if (isMobileDevice) {
  html.classList.add('is-mobile');
}

const applyMobileToolboxIcons = (toolboxEl) => {
  if (!isMobileDevice || !toolboxEl) return;
  const categories = toolboxEl.querySelectorAll('category');
  categories.forEach((cat) => {
    const icon = cat.getAttribute('data-icon');
    if (icon) {
      const currentName = cat.getAttribute('name') || '';
      cat.setAttribute('data-label', currentName);
      cat.setAttribute('name', icon);
    }
  });
};


const setupListManager = ({ workspace, storage, shareFeature, workspaceContainer }) => {
  const panel = document.createElement('div');
  panel.id = 'listPanel';
  panel.className = 'hidden';

  const header = document.createElement('div');
  header.className = 'list-panel__header';
  header.textContent = 'リスト管理';
  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'list-panel__body';
  panel.appendChild(body);

  workspaceContainer.appendChild(panel);

  const scheduleListSave = () => {
    window.__edbb_collab?.manager.broadcastExtraChange({ [LIST_STORE_KEY]: listStore.toJSON(workspace) });
    storage?.save();
  };

  const renderListPanel = () => {
    body.innerHTML = '';
    const entries = listStore.getEntries();

    if (!entries.length) {
      panel.classList.add('hidden');
      return;
    }

    panel.classList.remove('hidden');
    entries.forEach(({ id, items }) => {
      const variable = workspace.getVariableById(id);
      if (!variable) return;

      const card = document.createElement('div');
      card.className = 'list-panel__list';
      card.dataset.listId = id;

      const cardHeader = document.createElement('div');
      cardHeader.className = 'list-panel__list-header';
      const name = document.createElement('span');
      name.className = 'list-panel__list-name';
      name.textContent = variable.name;
      cardHeader.appendChild(name);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'list-panel__list-delete';
      deleteBtn.type = 'button';
      deleteBtn.textContent = '削除';
      deleteBtn.addEventListener('click', async () => {
        const confirmed = await showConfirmDialog(`リスト「${variable.name}」を削除しますか？`, {
          icon: 'warning',
          confirmButtonText: '削除',
        });
        if (!confirmed) return;
        if (typeof workspace.deleteVariableById === 'function') {
          workspace.deleteVariableById(id);
        } else if (typeof workspace.deleteVariable === 'function') {
          workspace.deleteVariable(variable);
        }
        listStore.removeList(id);
        renderListPanel();
        scheduleListSave();
      });
      cardHeader.appendChild(deleteBtn);
      card.appendChild(cardHeader);

      const itemList = document.createElement('div');
      itemList.className = 'list-panel__items';

      items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'list-panel__item';

        const indexLabel = document.createElement('span');
        indexLabel.className = 'list-panel__item-index';
        indexLabel.textContent = String(index + 1);

        const input = document.createElement('input');
        input.className = 'list-panel__item-input';
        input.type = 'text';
        input.value = item;
        input.addEventListener('input', () => {
          listStore.updateItem(id, index, input.value);
          scheduleListSave();
        });

        const removeBtn = document.createElement('button');
        removeBtn.className = 'list-panel__item-remove';
        removeBtn.type = 'button';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => {
          listStore.removeItem(id, index);
          renderListPanel();
          scheduleListSave();
        });

        row.appendChild(indexLabel);
        row.appendChild(input);
        row.appendChild(removeBtn);
        itemList.appendChild(row);
      });

      card.appendChild(itemList);

      const addBtn = document.createElement('button');
      addBtn.className = 'list-panel__item-add';
      addBtn.type = 'button';
      addBtn.textContent = '+ 追加';
      addBtn.addEventListener('click', () => {
        listStore.appendItem(id, '');
        renderListPanel();
        scheduleListSave();
        const latestInput = panel.querySelector(
          `[data-list-id="${id}"] .list-panel__item:last-child input`,
        );
        latestInput?.focus();
      });
      card.appendChild(addBtn);
      body.appendChild(card);
    });
  };

  const promptForListName = (callback) => {
    const defaultName = 'list';
    if (typeof Blockly.prompt === 'function') {
      Blockly.prompt('リスト名を入力してください', defaultName, (name) => callback(name));
    } else {
      void showPromptDialog('リスト名を入力してください', defaultName).then((name) => callback(name));
    }
  };

  const handleCreateList = () => {
    promptForListName((name) => {
      if (!name) return;
      const variable = workspace.createVariable(name);
      if (!variable) return;
      listStore.ensureList(variable.getId());
      renderListPanel();
      scheduleListSave();
    });
  };

  workspace.registerButtonCallback('CREATE_LIST_BUTTON', handleCreateList);

  const originalGetExtraState = workspace.getExtraState?.bind(workspace);
  const originalSetExtraState = workspace.setExtraState?.bind(workspace);

  workspace.getExtraState = () => {
    const base = originalGetExtraState ? originalGetExtraState() : {};
    const safeBase = base && typeof base === 'object' ? base : {};
    return { ...safeBase, [LIST_STORE_KEY]: listStore.toJSON(workspace) };
  };

  workspace.setExtraState = (state) => {
    if (originalSetExtraState) originalSetExtraState(state);
    listStore.fromJSON(state?.[LIST_STORE_KEY], workspace);
    renderListPanel();
  };

  workspace.addChangeListener((event) => {
    if (event.type === Blockly.Events.VAR_DELETE) {
      listStore.removeList(event.varId);
      renderListPanel();
      scheduleListSave();
    }
    if (event.type === Blockly.Events.VAR_RENAME) {
      renderListPanel();
      scheduleListSave();
    }
  });

  renderListPanel();

  return { renderListPanel, scheduleListSave };
};

const setupJsonDataManager = ({ workspace, storage, shareFeature }) => {
  const modal = document.getElementById('jsonGuiModal');
  const openBtn = document.getElementById('jsonGuiBtn');
  const closeBtn = document.getElementById('jsonGuiModalClose');
  const cancelBtn = document.getElementById('jsonGuiCloseBtn');
  const datasetSelect = document.getElementById('jsonGuiDatasetSelect');
  const addDatasetBtn = document.getElementById('jsonGuiAddDatasetBtn');
  const renameDatasetBtn = document.getElementById('jsonGuiRenameDatasetBtn');
  const deleteDatasetBtn = document.getElementById('jsonGuiDeleteDatasetBtn');
  const rowsBody = document.getElementById('jsonGuiRows');
  const addRowBtn = document.getElementById('jsonGuiAddRowBtn');
  const preview = document.getElementById('jsonGuiPreview');
  const errorLabel = document.getElementById('jsonGuiError');

  let selectedDataset = '';
  let closeTimer = null;
  let autoSaveTimer = null;
  let hasPendingAutoSave = false;

  const readJsonDatasetLocalState = () => {
    try {
      const raw = localStorage.getItem(JSON_GUI_DATASET_LOCAL_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      return null;
    }
  };

  const persistJsonDatasetLocalState = () => {
    try {
      localStorage.setItem(JSON_GUI_DATASET_LOCAL_KEY, JSON.stringify(jsonDataStore.toJSON()));
    } catch (error) {
      // ignore storage write failures
    }
  };

  const flushAutoSave = () => {
    if (!hasPendingAutoSave) return;
    hasPendingAutoSave = false;
    persistJsonDatasetLocalState();
    storage?.save?.();
  };

  const scheduleSave = () => {
    window.__edbb_collab?.manager.broadcastExtraChange({ [JSON_DATA_STORE_KEY]: jsonDataStore.toJSON() });
    hasPendingAutoSave = true;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null;
      flushAutoSave();
    }, 250);
  };

  const saveNow = () => {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
    persistJsonDatasetLocalState();
    flushAutoSave();
  };

  const resolveDatasetSelection = () => {
    const names = jsonDataStore.getDatasetNames();
    if (!names.length) {
      selectedDataset = '';
      return;
    }
    if (!selectedDataset || !names.includes(selectedDataset)) {
      selectedDataset = names[0];
    }
  };

  const ensureDefaultDataset = () => {
    const names = jsonDataStore.getDatasetNames();
    if (names.length) return;
    jsonDataStore.createDataset('メイン', [{ key: 'message', type: 'string', value: 'こんにちは' }]);
    selectedDataset = 'メイン';
    scheduleSave();
  };

  const renderDatasetSelect = () => {
    if (!datasetSelect) return;
    resolveDatasetSelection();
    datasetSelect.innerHTML = '';
    const names = jsonDataStore.getDatasetNames();
    if (!names.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'データセットがありません';
      datasetSelect.appendChild(option);
      datasetSelect.value = '';
      return;
    }

    names.forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      datasetSelect.appendChild(option);
    });
    datasetSelect.value = selectedDataset;
  };

  const renderPreview = () => {
    if (!preview || !errorLabel) return;
    if (!selectedDataset) {
      preview.value = '{}';
      errorLabel.textContent = '';
      errorLabel.classList.add('hidden');
      return;
    }
    const { data, errors } = jsonDataStore.buildDatasetData(selectedDataset);
    preview.value = JSON.stringify(data, null, 2);
    if (errors.length) {
      errorLabel.textContent = errors.join(' / ');
      errorLabel.classList.remove('hidden');
    } else {
      errorLabel.textContent = '';
      errorLabel.classList.add('hidden');
    }
  };

  const createTypeSelect = (value) => {
    const select = document.createElement('select');
    select.className =
      'json-gui__cell-select w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs';
    const options = [
      ['string', '文字 (あいうえお)'],
      ['number', '数値 (123)'],
      ['boolean', 'はい/いいえ'],
      ['null', 'なし (null)'],
      ['object', 'オブジェクト {}'],
      ['array', 'リスト []'],
    ];
    options.forEach(([raw, label]) => {
      const option = document.createElement('option');
      option.value = raw;
      option.textContent = label;
      select.appendChild(option);
    });
    select.value = value;
    return select;
  };

  const CELL_INPUT_CLASS =
    'json-gui__cell-input w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs';

  // 型に合わせた値エディタを作る (真偽値はドロップダウン、null は入力不要 など)
  const createValueEditor = (row, index) => {
    const commitValue = (value) => {
      jsonDataStore.updateRow(selectedDataset, index, { value });
      renderPreview();
      scheduleSave();
    };

    if (row.type === 'null') {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = 'null（値は保存されません）';
      input.disabled = true;
      input.className = `${CELL_INPUT_CLASS} opacity-60 cursor-not-allowed`;
      input.title = '「なし (null)」を選んだ場合、値の入力は不要です';
      return input;
    }

    if (row.type === 'boolean') {
      const select = document.createElement('select');
      select.className =
        'json-gui__cell-select w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs';
      [
        ['true', 'はい (true)'],
        ['false', 'いいえ (false)'],
      ].forEach(([raw, label]) => {
        const option = document.createElement('option');
        option.value = raw;
        option.textContent = label;
        select.appendChild(option);
      });
      const normalized = String(row.value ?? '').trim().toLowerCase();
      select.value = ['true', '1', 'yes', 'on'].includes(normalized) ? 'true' : 'false';
      select.addEventListener('change', () => commitValue(select.value));
      return select;
    }

    const input = document.createElement('input');
    if (row.type === 'number') {
      input.type = 'number';
      input.step = 'any';
      input.placeholder = '例: 100';
    } else {
      input.type = 'text';
      input.placeholder =
        row.type === 'object' ? '例: {"id": 1}' : row.type === 'array' ? '例: ["a", "b"]' : '例: こんにちは';
    }
    input.value = row.value;
    input.className = CELL_INPUT_CLASS;
    input.addEventListener('input', () => commitValue(input.value));
    return input;
  };

  const renderRows = () => {
    if (!rowsBody) return;
    rowsBody.innerHTML = '';
    if (!selectedDataset) {
      renderPreview();
      return;
    }

    const rows = jsonDataStore.getRows(selectedDataset);
    if (!rows.length) {
      const emptyRow = document.createElement('tr');
      emptyRow.innerHTML =
        '<td colspan="4" class="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400">まだデータがありません。<br>下の「行を追加」ボタンから最初のデータを作りましょう！</td>';
      rowsBody.appendChild(emptyRow);
      renderPreview();
      return;
    }

    rows.forEach((row, index) => {
      const tr = document.createElement('tr');
      tr.className =
        'border-b border-slate-100 dark:border-slate-800 odd:bg-white even:bg-slate-50/60 dark:odd:bg-slate-900 dark:even:bg-slate-950/40 hover:bg-indigo-50/40 dark:hover:bg-indigo-900/10 transition-colors';

      const keyCell = document.createElement('td');
      keyCell.className = 'px-2 py-2 align-top';
      const keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.value = row.key;
      keyInput.placeholder = '例: welcome_message';
      keyInput.className = CELL_INPUT_CLASS;
      keyInput.addEventListener('input', () => {
        jsonDataStore.updateRow(selectedDataset, index, { key: keyInput.value });
        renderPreview();
        scheduleSave();
      });
      keyCell.appendChild(keyInput);

      const typeCell = document.createElement('td');
      typeCell.className = 'px-2 py-2 align-top';
      const typeSelect = createTypeSelect(row.type);
      typeSelect.addEventListener('change', () => {
        const nextType = typeSelect.value;
        const patch = { type: nextType };
        // 型に合わない値が残ってエラーにならないように正規化する
        if (nextType === 'boolean') {
          const normalized = String(row.value ?? '').trim().toLowerCase();
          patch.value = ['true', '1', 'yes', 'on'].includes(normalized) ? 'true' : 'false';
        } else if (nextType === 'number') {
          const parsed = Number(String(row.value ?? '').trim());
          patch.value = Number.isFinite(parsed) ? String(parsed) : '0';
        }
        jsonDataStore.updateRow(selectedDataset, index, patch);
        // 値エディタを新しい型に合わせて切り替える
        renderRows();
        scheduleSave();
      });
      typeCell.appendChild(typeSelect);

      const valueCell = document.createElement('td');
      valueCell.className = 'px-2 py-2 align-top';
      valueCell.appendChild(createValueEditor(row, index));

      const actionCell = document.createElement('td');
      actionCell.className = 'px-2 py-2 align-top text-right';
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className =
        'inline-flex items-center justify-center rounded-lg border border-transparent p-1.5 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/20 transition-colors';
      deleteBtn.title = 'この行を削除';
      deleteBtn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i>';
      deleteBtn.addEventListener('click', () => {
        jsonDataStore.removeRow(selectedDataset, index);
        renderRows();
        scheduleSave();
      });
      actionCell.appendChild(deleteBtn);

      tr.appendChild(keyCell);
      tr.appendChild(typeCell);
      tr.appendChild(valueCell);
      tr.appendChild(actionCell);
      rowsBody.appendChild(tr);
    });

    if (typeof lucide !== 'undefined') lucide.createIcons();
    renderPreview();
  };

  const focusLastRowKeyInput = () => {
    if (!rowsBody) return;
    const scrollHost = rowsBody.closest('section');
    if (scrollHost) {
      scrollHost.scrollTop = scrollHost.scrollHeight;
    }
    const keyInput = rowsBody.querySelector('tr:last-child td:first-child input');
    if (!keyInput) return;
    keyInput.scrollIntoView({ block: 'nearest' });
    keyInput.focus();
    if (typeof keyInput.select === 'function') keyInput.select();
  };

  const render = () => {
    renderDatasetSelect();
    renderRows();
  };

  const createDatasetPrompt = async () => {
    const defaultName = `データセット_${jsonDataStore.getDatasetNames().length + 1}`;
    const name = await showPromptDialog('データセット名', defaultName);
    const normalized = String(name || '').trim();
    if (!normalized) return;
    if (jsonDataStore.hasDataset(normalized)) {
      await showAlertDialog('同名のデータセットが既に存在します。', { icon: 'error' });
      return;
    }
    jsonDataStore.createDataset(normalized, []);
    selectedDataset = normalized;
    render();
    scheduleSave();
  };

  const renameDatasetPrompt = async () => {
    if (!selectedDataset) return;
    const name = await showPromptDialog('データセット名を変更', selectedDataset);
    const normalized = String(name || '').trim();
    if (!normalized || normalized === selectedDataset) return;
    if (!jsonDataStore.renameDataset(selectedDataset, normalized)) {
      await showAlertDialog('データセット名の変更に失敗しました。', { icon: 'error' });
      return;
    }
    selectedDataset = normalized;
    render();
    scheduleSave();
  };

  const deleteDataset = async () => {
    if (!selectedDataset) return;
    const confirmed = await showConfirmDialog(`データセット「${selectedDataset}」を削除しますか？`, {
      icon: 'warning',
      confirmButtonText: '削除',
    });
    if (!confirmed) return;
    jsonDataStore.removeDataset(selectedDataset);
    resolveDatasetSelection();
    render();
    scheduleSave();
  };

  const openModal = () => {
    if (!modal) return;
    ensureDefaultDataset();
    render();
    if (typeof Blockly !== 'undefined') Blockly.hideChaff();
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    void modal.offsetWidth;
    modal.classList.add('show-modal');
  };

  const closeModal = () => {
    saveNow();
    if (!modal) return;
    modal.classList.remove('show-modal');
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      modal.classList.remove('flex');
      modal.classList.add('hidden');
      closeTimer = null;
    }, 300);
  };

  if (openBtn) {
    openBtn.addEventListener('click', () => {
      if (shareFeature?.isShareViewMode?.()) return;
      openModal();
    });
  }
  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });

  datasetSelect?.addEventListener('change', () => {
    selectedDataset = datasetSelect.value || '';
    render();
  });

  addDatasetBtn?.addEventListener('click', createDatasetPrompt);
  renameDatasetBtn?.addEventListener('click', renameDatasetPrompt);
  deleteDatasetBtn?.addEventListener('click', deleteDataset);

  addRowBtn?.addEventListener('click', () => {
    if (!selectedDataset) return;
    jsonDataStore.appendRow(selectedDataset, { key: '', type: 'string', value: '' });
    renderRows();
    requestAnimationFrame(() => {
      focusLastRowKeyInput();
    });
    scheduleSave();
  });

  const copyPreviewBtn = document.getElementById('jsonGuiCopyPreviewBtn');
  copyPreviewBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(preview?.value || '{}');
      showTopRightToast('JSONをコピーしました', { icon: 'success' });
    } catch (error) {
      showTopRightToast('コピーに失敗しました', { icon: 'error' });
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
      closeModal();
    }
  });
  window.addEventListener('beforeunload', saveNow);

  const applyShareViewState = (isViewOnly) => {
    if (!openBtn) return;
    openBtn.disabled = Boolean(isViewOnly);
    openBtn.classList.toggle('opacity-50', Boolean(isViewOnly));
    openBtn.classList.toggle('cursor-not-allowed', Boolean(isViewOnly));
    if (isViewOnly) closeModal();
  };

  shareFeature?.onShareViewModeChange?.(applyShareViewState);
  applyShareViewState(shareFeature?.isShareViewMode?.() || false);

  // Fallback source for legacy workspaces or save timing gaps.
  const localState = readJsonDatasetLocalState();
  if (localState) {
    jsonDataStore.fromJSON(localState);
    resolveDatasetSelection();
    render();
  }

  const originalGetExtraState = workspace.getExtraState?.bind(workspace);
  const originalSetExtraState = workspace.setExtraState?.bind(workspace);

  workspace.getExtraState = () => {
    const base = originalGetExtraState ? originalGetExtraState() : {};
    const safeBase = base && typeof base === 'object' ? base : {};
    return { ...safeBase, [JSON_DATA_STORE_KEY]: jsonDataStore.toJSON() };
  };

  workspace.setExtraState = (state) => {
    if (originalSetExtraState) originalSetExtraState(state);
    const hasJsonStore =
      Boolean(state) &&
      typeof state === 'object' &&
      Object.prototype.hasOwnProperty.call(state, JSON_DATA_STORE_KEY);
    if (hasJsonStore) {
      jsonDataStore.fromJSON(state?.[JSON_DATA_STORE_KEY]);
    } else {
      // A project without embedded JSON data must not inherit another
      // project's browser-local datasets.
      jsonDataStore.fromJSON(null);
    }
    persistJsonDatasetLocalState();
    resolveDatasetSelection();
    render();
  };

  return { render, saveNow };
};


const initializeApp = async () => {
  window.__edbb_initialized = true;
  lucide.createIcons();

  const { modernLightTheme, modernDarkTheme } = setupBlocklyEnvironment();

  const blocklyDiv = document.getElementById('blocklyDiv');
  const toolbox = document.getElementById('toolbox');
  const themeToggle = document.getElementById('themeToggle');
  const headerActions = document.getElementById('headerActions');
  const mobileHeaderToggle = document.getElementById('mobileHeaderToggle');
  // ヘッダーのコード生成ボタン
  const showCodeBtn = document.getElementById('showCodeBtn');
  const runBotBtn = document.getElementById('runBotBtn');
  const runBotBtnLabel = runBotBtn?.querySelector('span');
  const LOCAL_RUNNER_ORIGIN = 'http://localhost:6859';
  const currentHost = String(window.location.hostname || '').toLowerCase();
  const runnerAllowedHosts = new Set([
    'localhost',
    '127.0.0.1',
    '[::1]',
    'himais0giiiin.com',
    'beta.himais0giiiin.com',
    'edbplugin.github.io',
  ]);
  const canDirectConnectLocalRunner =
    (window.location.protocol === 'http:' || window.location.protocol === 'https:') &&
    runnerAllowedHosts.has(currentHost);
  const buildRunnerUrl = (path = '') => `${LOCAL_RUNNER_ORIGIN}${path}`;
  const getRunnerConnectionHintLines = () => [
    '[editor] この環境ではブラウザ制約により localhost:6859 へ直接接続できません。',
    `[editor] 現在のオリジン: ${window.location.origin}`,
    '[editor] http://localhost でエディタを開くか、同一オリジンのプロキシ経由で接続してください。',
  ];

  // Show run button only on Windows / Linux desktop clients.
  const clientPlatform = String(
    navigator.userAgentData?.platform || navigator.platform || '',
  ).toLowerCase();
  const clientUserAgent = String(navigator.userAgent || '').toLowerCase();
  const isWindowsClient = clientPlatform.includes('win') || clientUserAgent.includes('windows');
  const isLinuxClient =
    (clientPlatform.includes('linux') ||
      clientPlatform.includes('x11') ||
      clientUserAgent.includes('linux')) &&
    !clientUserAgent.includes('android');
  const isRunButtonSupportedClient = isWindowsClient || isLinuxClient;
  if (runBotBtn) {
    if (isRunButtonSupportedClient) {
      runBotBtn.classList.add('md:inline-flex');
    } else {
      runBotBtn.classList.remove('md:inline-flex');
      runBotBtn.classList.add('hidden');
    }
  }
  if (isLinuxClient) {
    try {
      const shouldShowLinuxRunnerNotice =
        localStorage.getItem(LINUX_RUNNER_NOTICE_DISMISS_KEY) !== '1';
      if (shouldShowLinuxRunnerNotice) {
        showTopRightToast('Linuxでも実行できるようになりました。', {
          icon: 'success',
          timer: 3600,
        });
        localStorage.setItem(LINUX_RUNNER_NOTICE_DISMISS_KEY, '1');
      }
    } catch {
      // Ignore storage errors in private mode or restricted browsers.
    }
  }

  // モーダル関連
  const codeModal = document.getElementById('codeModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const codeOutput = document.getElementById('codeOutput');
  const codeGenErrorBox = document.getElementById('codeGenErrorBox');
  const codeGenErrorList = document.getElementById('codeGenErrorList');
  const copyCodeBtn = document.getElementById('copyCodeBtn');
  const downloadZipBtn = document.getElementById('downloadZipBtn');
  const splitCodeBtn = document.getElementById('splitCodeBtn');
  const splitCodeModal = document.getElementById('splitCodeModal');
  const splitModalClose = document.getElementById('splitModalClose');
  const splitDownloadAllBtn = document.getElementById('splitDownloadAllBtn');
  const saveJsonModal = document.getElementById('saveJsonModal');
  const saveJsonCloseBtn = document.getElementById('saveJsonCloseBtn');
  const saveJsonCancelBtn = document.getElementById('saveJsonCancelBtn');
  const saveJsonConfirmBtn = document.getElementById('saveJsonConfirmBtn');
  const saveJsonFilenameInput = document.getElementById('saveJsonFilename');
  const saveJsonPrettyCheckbox = document.getElementById('saveJsonPretty');
  const saveJsonMethodSelect = document.getElementById('saveJsonMethod');
  const saveJsonMethodHint = document.getElementById('saveJsonMethodHint');
  const runnerDownloadModal = document.getElementById('runnerDownloadModal');
  const runnerDownloadModalClose = document.getElementById('runnerDownloadModalClose');
  const runnerDownloadCancelBtn = document.getElementById('runnerDownloadCancelBtn');
  const runnerDownloadBtn = document.getElementById('runnerDownloadBtn');
  const runnerConsoleModal = document.getElementById('runnerConsoleModal');
  const runnerConsoleCloseBtn = document.getElementById('runnerConsoleCloseBtn');
  const runnerConsoleClearBtn = document.getElementById('runnerConsoleClearBtn');
  const runnerConsoleOutput = document.getElementById('runnerConsoleOutput');
  const runnerConsoleStateText = document.getElementById('runnerConsoleStateText');
  const splitViewTabCodeBtn = document.getElementById('splitViewTabCodeBtn');
  const splitViewTabConsoleBtn = document.getElementById('splitViewTabConsoleBtn');
  const splitViewCodePanel = document.getElementById('splitViewCodePanel');
  const splitViewConsolePanel = document.getElementById('splitViewConsolePanel');
  const splitRunnerConsoleOutput = document.getElementById('splitRunnerConsoleOutput');
  const splitRunnerConsoleStateText = document.getElementById('splitRunnerConsoleStateText');

  const importBtn = document.getElementById('importBtn');
  const exportBtn = document.getElementById('exportBtn');
  const importInput = document.getElementById('importInput');
  const workspaceContainer = document.getElementById('workspace-container');
  const layoutBlockBtn = document.getElementById('layoutBlockBtn');
  const layoutSplitBtn = document.getElementById('layoutSplitBtn');
  const hljsThemeLight = document.getElementById('hljsThemeLight');
  const hljsThemeDark = document.getElementById('hljsThemeDark');
  const projectTitleInput = document.getElementById('projectTitleInput');
  const initialScale = isMobileDevice ? 0.85 : 1.0;
  const maxScale = isMobileDevice ? 2.2 : 3;
  const minScale = isMobileDevice ? 0.5 : 0.3;
  const SPLIT_LAYOUT_GAP = 12;
  const SPLIT_LAYOUT_MIN_BLOCK_WIDTH = 620;
  const SPLIT_LAYOUT_MIN_PREVIEW_WIDTH = 400;
  const SPLIT_LAYOUT_MIN_ASPECT_RATIO = 1.5;

  const resolveProjectTitle = () =>
    (projectTitleInput?.value || '').trim() || WorkspaceStorage.DEFAULT_TITLE;

  const supportsSaveFilePicker =
    typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';

  const applyCodeTheme = (theme) => {
    const useDark = theme === 'dark';
    if (hljsThemeLight) hljsThemeLight.disabled = useDark;
    if (hljsThemeDark) hljsThemeDark.disabled = !useDark;
    const liveCodeOutput = document.getElementById('codePreviewContent');
    if (liveCodeOutput?.textContent?.trim()) {
      // Remove highlighted dataset to prevent re-highlighting warning
      delete liveCodeOutput.dataset.highlighted;
      hljs.highlightElement(liveCodeOutput);
    }
  };

  const getDefaultJsonFileName = () =>
    storage?.getDefaultExportFileName?.() ||
    WorkspaceStorage.buildDownloadName(resolveProjectTitle());

  const normalizeJsonFileName = (rawName) =>
    WorkspaceStorage.normalizeDownloadName(rawName, getDefaultJsonFileName());

  const syncResponsiveSplitLayout = () => {
    if (!workspaceContainer) return;

    const rect = workspaceContainer.getBoundingClientRect();
    const safeHeight = Math.max(1, rect.height);
    const availableWidth = Math.max(0, rect.width - SPLIT_LAYOUT_GAP);
    const requiredWidth = SPLIT_LAYOUT_MIN_BLOCK_WIDTH + SPLIT_LAYOUT_MIN_PREVIEW_WIDTH;
    const aspectRatio = rect.width / safeHeight;
    const shouldUseCompactLayout =
      availableWidth < requiredWidth || aspectRatio < SPLIT_LAYOUT_MIN_ASPECT_RATIO;

    workspaceContainer.classList.toggle('split-view-compact', shouldUseCompactLayout);
  };

  const resizeWorkspace = (delayMs = 0) => {
    if (!workspace) return;
    const applyResize = () => {
      syncResponsiveSplitLayout();
      Blockly.svgResize(workspace);
    };
    if (delayMs > 0) {
      setTimeout(applyResize, delayMs);
      return;
    }
    applyResize();
  };

  const flashSaveStatus = (message = 'Saved') => {
    const status = document.getElementById('saveStatus');
    if (!status) return;
    const label = status.querySelector('span');
    const originalText = label?.textContent || 'Saved';
    if (label) {
      label.textContent = message;
    }
    status.setAttribute('data-show', 'true');
    setTimeout(() => {
      status.setAttribute('data-show', 'false');
      if (label) {
        label.textContent = originalText;
      }
    }, 2000);
  };

  const hydrateProjectTitle = () => {
    if (!projectTitleInput) return;
    try {
      const storedTitle = localStorage.getItem(PROJECT_TITLE_STORAGE_KEY);
      if (storedTitle) {
        projectTitleInput.value = storedTitle;
        return;
      }
    } catch (error) {
      // localStorage unavailable; fall back to default
    }
    if (!projectTitleInput.value) {
      projectTitleInput.value = WorkspaceStorage.DEFAULT_TITLE;
    }
  };

  hydrateProjectTitle();

  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') html.classList.add('dark');
  applyCodeTheme(savedTheme === 'dark' ? 'dark' : 'light');
  const initialTheme = savedTheme === 'dark' ? modernDarkTheme : modernLightTheme;
  applyMobileToolboxIcons(toolbox);

  // --- パレット固定化の強制適用 (Zoom Fix) ---
  // フライアウト（パレット）のスケールを常に1に固定するオーバーライド
  Blockly.VerticalFlyout.prototype.getFlyoutScale = function () {
    return isMobileDevice ? 0.9 : 1;
  };

  // --- Blocklyワークスペースの初期化 ---
  workspace = Blockly.inject(blocklyDiv, {
    toolbox: toolbox,
    horizontalLayout: false,
    trashcan: true,
    zoom: {
      controls: true,
      wheel: true,
      startScale: initialScale,
      maxScale,
      minScale,
      scaleSpeed: 1.2,
    },
    renderer: 'zelos',
    theme: initialTheme,
  });
  setupLiteralInputAutofill(workspace);

  // --- Smooth Resize Observer ---
  // CSSトランジション中も滑らかにBlocklyをリサイズさせる
  if (window.ResizeObserver && blocklyDiv) {
    const resizeObserver = new ResizeObserver(() => {
      if (workspace) {
        Blockly.svgResize(workspace);
      }
    });
    resizeObserver.observe(blocklyDiv);
  }

  // --- ワークスペース保存クラスの初期化 ---
  storage = new WorkspaceStorage(workspace);
  storage.setTitleProvider(() => resolveProjectTitle());
  if (typeof Blockly !== 'undefined') {
    Blockly.edbbListStore = listStore;
    Blockly.edbbJsonDataStore = jsonDataStore;
  }

  if (projectTitleInput) {
    projectTitleInput.addEventListener('input', () => {
      try {
        localStorage.setItem(PROJECT_TITLE_STORAGE_KEY, resolveProjectTitle());
      } catch (error) {
        // ignore storage errors
      }
    });
  }

  // --- Blocklyのブロック定義 ---
  const shareFeature = initShareFeature({
    workspace,
    storage,
  });

  // --- リアルタイム共同編集機能の初期化 ---
  const collabManager = new CollabManager(workspace);
  const collabUI = new CollabUI(collabManager);
  window.__edbb_collab = { manager: collabManager, ui: collabUI };
  window.__edbb_storage = storage;
  setupListManager({
    workspace,
    storage,
    shareFeature,
    workspaceContainer,
  });
  setupJsonDataManager({
    workspace,
    storage,
    shareFeature,
  });
  if (isMobileDevice && headerActions && mobileHeaderToggle) {
    mobileHeaderToggle.classList.remove('hidden');
    let headerExpanded = false;
    const syncHeaderVisibility = () => {
      headerActions.classList.toggle('collapsed', !headerExpanded);
      mobileHeaderToggle.setAttribute('aria-expanded', headerExpanded ? 'true' : 'false');
      const label = mobileHeaderToggle.querySelector('#mobileHeaderToggleText');
      if (label) label.textContent = headerExpanded ? '操作を閉じる' : '操作を表示';
      const icon = mobileHeaderToggle.querySelector('svg');
      if (icon) icon.style.transform = headerExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
      resizeWorkspace(150);
    };
    syncHeaderVisibility();
    mobileHeaderToggle.addEventListener('click', () => {
      headerExpanded = !headerExpanded;
      syncHeaderVisibility();
    });
  } else if (headerActions) {
    headerActions.classList.remove('collapsed');
  }

  // --- パレット（フライアウト）の固定設定 ---
  if (workspace.getToolbox()) {
    const flyout = workspace.getToolbox().getFlyout();
    if (flyout) {
      flyout.autoClose = false;
    }
  }

  // --- Layout Switching Logic ---
  const setLayout = (mode) => {
    if (mode === 'split') {
      workspaceContainer.classList.add('split-view');
      layoutSplitBtn.classList.remove('text-slate-500', 'dark:text-slate-400');
      layoutSplitBtn.classList.add(
        'bg-white',
        'dark:bg-slate-800',
        'shadow-sm',
        'text-indigo-600',
        'dark:text-indigo-400',
      );

      layoutBlockBtn.classList.remove(
        'bg-white',
        'dark:bg-slate-800',
        'shadow-sm',
        'text-indigo-600',
        'dark:text-indigo-400',
      );
      layoutBlockBtn.classList.add('text-slate-500', 'dark:text-slate-400');
    } else {
      workspaceContainer.classList.remove('split-view');
      layoutBlockBtn.classList.remove('text-slate-500', 'dark:text-slate-400');
      layoutBlockBtn.classList.add(
        'bg-white',
        'dark:bg-slate-800',
        'shadow-sm',
        'text-indigo-600',
        'dark:text-indigo-400',
      );

      layoutSplitBtn.classList.remove(
        'bg-white',
        'dark:bg-slate-800',
        'shadow-sm',
        'text-indigo-600',
        'dark:text-indigo-400',
      );
      layoutSplitBtn.classList.add('text-slate-500', 'dark:text-slate-400');
      if (!isRunnerConsoleModalOpen()) {
        stopRunnerConsolePolling();
      }
    }
    resizeWorkspace(450);
    if (mode === 'split') {
      scheduleLiveCodeRefresh();
    }
  };

  layoutBlockBtn.addEventListener('click', () => setLayout('block'));
  layoutSplitBtn.addEventListener('click', () => setLayout('split'));

  // Live Preview Sync
  const liveCodeOutput = document.getElementById('codePreviewContent');
  let livePreviewFrame = null;
  const refreshLiveCodePreview = () => {
    if (
      !workspaceContainer.classList.contains('split-view') ||
      !liveCodeOutput
    ) {
      return;
    }
    try {
      liveCodeOutput.textContent = generatePythonCode(workspace);
      // Remove highlighted dataset to prevent re-highlighting warning
      delete liveCodeOutput.dataset.highlighted;
      hljs.highlightElement(liveCodeOutput);
    } catch (error) {
      liveCodeOutput.textContent = `# Code preview update failed\n# ${error?.message || 'unknown error'}`;
    }
  };
  const scheduleLiveCodeRefresh = () => {
    if (livePreviewFrame != null) return;
    livePreviewFrame = requestAnimationFrame(() => {
      livePreviewFrame = null;
      refreshLiveCodePreview();
    });
  };
  collabManager.onStateChange((type, data) => {
    if (type === 'workspace_updated') {
      scheduleLiveCodeRefresh();
      if (!shareFeature.isShareViewMode()) storage.save();
      try { localStorage.setItem(PROJECT_TITLE_STORAGE_KEY, resolveProjectTitle()); } catch { /* optional */ }
    }
    if (type === 'status_change') {
      const connecting = data.status === 'connecting';
      // Keep the document intact but prevent unsent edits while the first snapshot is loading.
      document.getElementById('blocklyDiv').inert = connecting;
      const title = document.getElementById('projectTitleInput');
      if (title) title.disabled = connecting;
    }
  });
  let splitViewActiveTab = 'code';
  const splitViewConsoleCloseBtn = document.getElementById('splitViewConsoleCloseBtn');

  const setSplitViewTab = (tab) => {
    splitViewActiveTab = tab === 'console' ? 'console' : 'code';
    const showConsole = splitViewActiveTab === 'console';
    splitViewCodePanel?.classList.toggle('hidden', showConsole);
    splitViewConsolePanel?.classList.toggle('hidden', !showConsole);

    // Always show close button when split view is active (not just on console tab)
    // The button will close the entire split view panel
    const isSplitView = workspaceContainer?.classList.contains('split-view');
    splitViewConsoleCloseBtn?.classList.toggle('hidden', !isSplitView);

    if (splitViewTabCodeBtn && splitViewTabConsoleBtn) {
      splitViewTabCodeBtn.classList.toggle('bg-emerald-500/20', !showConsole);
      splitViewTabCodeBtn.classList.toggle('border-emerald-400/30', !showConsole);
      splitViewTabCodeBtn.classList.toggle('text-emerald-700', !showConsole);
      splitViewTabCodeBtn.classList.toggle('dark:text-emerald-200', !showConsole);
      splitViewTabCodeBtn.classList.toggle('text-slate-700', showConsole);
      splitViewTabCodeBtn.classList.toggle('dark:text-slate-300', showConsole);
      splitViewTabCodeBtn.classList.toggle('border-transparent', showConsole);
      splitViewTabCodeBtn.classList.toggle('hover:bg-slate-100', showConsole);
      splitViewTabCodeBtn.classList.toggle('dark:hover:bg-slate-800/60', showConsole);

      splitViewTabConsoleBtn.classList.toggle('bg-emerald-500/20', showConsole);
      splitViewTabConsoleBtn.classList.toggle('border-emerald-400/30', showConsole);
      splitViewTabConsoleBtn.classList.toggle('text-emerald-700', showConsole);
      splitViewTabConsoleBtn.classList.toggle('dark:text-emerald-200', showConsole);
      splitViewTabConsoleBtn.classList.toggle('text-slate-700', !showConsole);
      splitViewTabConsoleBtn.classList.toggle('dark:text-slate-300', !showConsole);
      splitViewTabConsoleBtn.classList.toggle('border-transparent', !showConsole);
      splitViewTabConsoleBtn.classList.toggle('hover:bg-slate-100', !showConsole);
      splitViewTabConsoleBtn.classList.toggle('dark:hover:bg-slate-800/60', !showConsole);
    }
    if (!showConsole) {
      scheduleLiveCodeRefresh();
    }
  };
  splitViewTabCodeBtn?.addEventListener('click', () => setSplitViewTab('code'));
  splitViewTabConsoleBtn?.addEventListener('click', () => {
    if (splitViewActiveTab === 'console') {
      setSplitViewTab('code');
      return;
    }
    setSplitViewTab('console');
    startRunnerConsolePolling(false);
  });
  splitViewConsoleCloseBtn?.addEventListener('click', () => {
    // Close the entire split view (right panel)
    setLayout('block');
  });
  setSplitViewTab('code');

  const saveStatusEl = document.getElementById('saveStatus');
  let workspaceAutoSaveTimer = null;
  let saveStatusHideTimer = null;
  const runWorkspaceAutoSave = () => {
    // 共有リンクの閲覧モード中はローカルプロジェクトを上書きしない
    if (shareFeature.isShareViewMode()) return;
    const saved = storage?.save();
    if (saved && saveStatusEl) {
      saveStatusEl.setAttribute('data-show', 'true');
      clearTimeout(saveStatusHideTimer);
      saveStatusHideTimer = setTimeout(() => saveStatusEl.setAttribute('data-show', 'false'), 2000);
    }
  };
  const flushWorkspaceAutoSave = () => {
    if (!workspaceAutoSaveTimer) return;
    clearTimeout(workspaceAutoSaveTimer);
    workspaceAutoSaveTimer = null;
    runWorkspaceAutoSave();
  };
  workspace.addChangeListener((e) => {
    if (workspaceContainer.classList.contains('split-view')) {
      scheduleLiveCodeRefresh();
    }

    // Auto-save (300msデバウンス)
    if (
      !e.isUiEvent &&
      e.type !== Blockly.Events.FINISHED_LOADING &&
      !shareFeature.isShareViewMode()
    ) {
      clearTimeout(workspaceAutoSaveTimer);
      workspaceAutoSaveTimer = setTimeout(() => {
        workspaceAutoSaveTimer = null;
        runWorkspaceAutoSave();
      }, 300);
    }
  });
  window.addEventListener('beforeunload', flushWorkspaceAutoSave);

  // --- Toolbox Pin Button (Re-implementation) ---
  const pinBtn = document.createElement('button');
  pinBtn.id = 'toolboxPinBtn';
  pinBtn.className =
    'absolute z-20 p-2 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:text-slate-500 dark:hover:text-indigo-400 dark:hover:bg-indigo-900/30 transition-all duration-200 shadow-sm border border-transparent hover:border-indigo-100 dark:hover:border-indigo-900/50';
  pinBtn.style.top = '12px';

  const updatePinState = () => {
    if (!workspace) return;
    const toolbox = workspace.getToolbox();
    if (!toolbox) return;

    let isVisible = true;
    if (typeof toolbox.isVisible === 'function') {
      isVisible = toolbox.isVisible();
    } else if (typeof toolbox.getWidth === 'function') {
      isVisible = toolbox.getWidth() > 0;
    }

    const width = typeof toolbox.getWidth === 'function' ? toolbox.getWidth() : 0;

    if (isVisible) {
      pinBtn.style.left = `${width - 38}px`;
      pinBtn.innerHTML =
        '<i data-lucide="pin" class="w-3.5 h-3.5 fill-indigo-500 text-indigo-600"></i>';
      pinBtn.classList.add('bg-white', 'dark:bg-slate-800');
    } else {
      pinBtn.style.left = '12px';
      pinBtn.innerHTML = '<i data-lucide="pin-off" class="w-3.5 h-3.5"></i>';
      pinBtn.classList.remove('bg-white', 'dark:bg-slate-800');
      pinBtn.classList.add('bg-white/80', 'dark:bg-slate-800/80', 'backdrop-blur-sm');
    }
    lucide.createIcons();
    updateSearchVisibility(); // Ensure search bar visibility updates with pin
  };

  pinBtn.onclick = () => {
    const toolbox = workspace.getToolbox();
    if (!toolbox) return;
    const isVisible =
      typeof toolbox.isVisible === 'function' ? toolbox.isVisible() : toolbox.getWidth() > 0;
    if (typeof toolbox.setVisible === 'function') toolbox.setVisible(!isVisible);
    resizeWorkspace();
    setTimeout(updatePinState, 50);
  };
  document.getElementById('blocklyDiv').appendChild(pinBtn);
  // ピン留めボタンの表示/非表示切り替え
  const syncPinVisibility = (isViewOnly = shareFeature.isShareViewMode()) => {
    pinBtn.classList.toggle('hidden', isViewOnly);
    pinBtn.setAttribute('aria-hidden', isViewOnly ? 'true' : 'false');
  };
  // 共有リンクの閲覧モードではユーザーにツールボックス表示切替を触らせない
  shareFeature.onShareViewModeChange((isViewOnly) => {
    syncPinVisibility(isViewOnly);
    if (!isViewOnly) {
      setTimeout(updatePinState, 50);
    }
  });
  syncPinVisibility();
  setTimeout(updatePinState, 100);
  window.addEventListener('resize', () => {
    resizeWorkspace();
    updatePinState();
  });
  workspace.addChangeListener((e) => {
    if (e.type === Blockly.Events.TOOLBOX_ITEM_SELECT) setTimeout(updatePinState, 50);
  });

  // 検索バーの表示・非表示をツールボックスに連動させる
  const isBlockSearchFeatureEnabled = () => {
    try {
      const raw = localStorage.getItem(PLUGIN_FEATURE_TOGGLES_STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return Boolean(parsed?.blockSearch);
    } catch (_) {
      return false;
    }
  };

  const updateSearchVisibility = () => {
    const toolbox = workspace.getToolbox();
    const searchContainer = document.getElementById('blockSearchContainer');
    const toolboxContents = document.querySelector('.blocklyToolboxContents');

    if (toolbox && searchContainer) {
      if (!isBlockSearchFeatureEnabled()) {
        searchContainer.style.display = 'none';
        return;
      }
      if (toolboxContents && searchContainer.parentNode !== toolboxContents) {
        toolboxContents.insertBefore(searchContainer, toolboxContents.firstChild);
      }

      const isVisible = toolbox.getWidth() > 0;
      searchContainer.style.display = isVisible ? 'block' : 'none';
    }
  };
  window.addEventListener('edbb-plugin-feature-settings-changed', updateSearchVisibility);

  // 初回呼び出し
  setTimeout(() => {
    updatePinState();
    updateSearchVisibility();
  }, 500);

  // --- Plugin System ---
  const pluginManager = new PluginManager(workspace);
  workspace.pluginManager = pluginManager; // storage.js からアクセスできるようにする
  storage.pluginManager = pluginManager; // share.js からアクセスできるようにする
  let pluginUIRef = null;

  // プラグインの状態が変更されたら共有ボタンの状態を更新する
  const originalEnable = pluginManager.enablePlugin.bind(pluginManager);
  pluginManager.enablePlugin = async (id) => {
    await originalEnable(id);
    pluginUIRef?.applyBlockVisibilityConfig?.();
    shareFeature?.updateShareButtonState?.();
  };
  const originalDisable = pluginManager.disablePlugin.bind(pluginManager);
  pluginManager.disablePlugin = async (id, options) => {
    await originalDisable(id, options);
    pluginUIRef?.applyBlockVisibilityConfig?.();
    shareFeature?.updateShareButtonState?.();
  };

  const pluginUI = new PluginUI(pluginManager);
  pluginUIRef = pluginUI;
  collabManager.setPluginManager(pluginManager);
  const collabPluginPrompts = new Set();
  collabManager.onStateChange(async (type, data) => {
    if (type !== 'plugin_download_offer' && type !== 'plugin_request') return;
    const plugin = data.plugin;
    if (!plugin?.id) return;
    const key = `${type}:${plugin.id}:${plugin.installRef || 'main'}`;
    if (collabPluginPrompts.has(key)) return;
    collabPluginPrompts.add(key);
    try {
      const installed = await pluginUI.confirmCollabPluginInstall(plugin, { requester: data.user });
      if (installed) collabManager.pluginReady(plugin);
    } finally {
      collabPluginPrompts.delete(key);
    }
  });
  pluginManager.onPluginsSuggested((entries) => {
    pluginUI.handleBulkInstall(entries.join(','));
  });
  await pluginManager.init();

  // --- Block Search Integration ---
  const blockSearch = new BlockSearch(workspace, pluginManager);
  window.blockSearch = blockSearch; // Expose for debugging if needed

  const searchInput = document.getElementById('blockSearchInput');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        blockSearch.updateToolbox();
      }, 400); // 400ミリ秒入力が止まったら検索を実行
    });

    // Initial index build after a short delay to ensure all blocks are loaded
    setTimeout(() => blockSearch.buildIndex(), 1000);

    // Re-build index when plugins change and refresh search results
    const originalEnable = pluginManager.enablePlugin.bind(pluginManager);
    pluginManager.enablePlugin = async (id) => {
      await originalEnable(id);
      await blockSearch.buildIndex();
      if (searchInput.value) {
        blockSearch.updateToolbox();
      }
    };
    const originalDisable = pluginManager.disablePlugin.bind(pluginManager);
    pluginManager.disablePlugin = async (id, options) => {
      await originalDisable(id, options);
      await blockSearch.buildIndex();
      if (searchInput.value) {
        blockSearch.updateToolbox();
      }
    };
  }


  // --- Load Saved Data ---
  const sharedApplied = await shareFeature.applySharedLayoutFromQuery();
  if (!sharedApplied) {
    storage?.load();
    // Keep block interactivity aligned with current (non-share) mode.
    shareFeature.applyUiState();
    // Check URL params for realtime collab only after storage is restored
    collabUI.checkUrlParams();
  }

  const toggleTheme = () => {
    const currentTheme = html.classList.contains('dark') ? 'dark' : 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    html.classList.remove(currentTheme);
    html.classList.add(newTheme);
    localStorage.setItem('theme', newTheme);
    applyCodeTheme(newTheme);
    if (workspace) {
      workspace.setTheme(newTheme === 'dark' ? modernDarkTheme : modernLightTheme);
    }
    // Re-apply share view UI state (e.g. hide toolbox)
    if (shareFeature.isShareViewMode()) {
      shareFeature.applyUiState();
    }
  };

  themeToggle.addEventListener('click', toggleTheme);

  const newProjectBtn = document.getElementById('newProjectBtn');
  newProjectBtn?.addEventListener('click', async () => {
    if (shareFeature.isShareViewMode()) return;
    const ok = await showConfirmDialog(
      '現在のブロックをすべて削除して新規プロジェクトを開始しますか？この操作は元に戻せません。',
      { icon: 'warning', confirmButtonText: '削除して新規作成' },
    );
    if (!ok) return;
    workspace.clear();
    workspace.setExtraState?.({});
    if (projectTitleInput) projectTitleInput.value = WorkspaceStorage.DEFAULT_TITLE;
    try {
      localStorage.setItem(PROJECT_TITLE_STORAGE_KEY, WorkspaceStorage.DEFAULT_TITLE);
      localStorage.removeItem(JSON_GUI_DATASET_LOCAL_KEY);
    } catch { /* optional local state */ }
    storage?.save();
    showTopRightToast('新規プロジェクトを開始しました', { icon: 'success' });
  });

  // Ctrl/Cmd+S でプロジェクトの保存（JSONエクスポート）ダイアログを開く
  document.addEventListener('keydown', (event) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === 's'
    ) {
      event.preventDefault();
      exportBtn?.click();
    }
  });

  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file || !storage) return;
    storage
      .importFile(file)
      .then((imported) => {
        if (!imported) {
          showTopRightToast('プロジェクトを読み込めませんでした。現在の内容は保持されています。', { icon: 'error' });
          return;
        }
        // Imported JSON/XML may contain stale block flags.
        shareFeature.applyUiState();
        resizeWorkspace();
      })
      .catch((err) => console.error(err))
      .finally(() => {
        e.target.value = '';
      });
  });

  exportBtn.addEventListener('click', () => {
    if (!saveJsonModal || !storage) {
      storage?.exportFile();
      return;
    }
    if (saveJsonFilenameInput) {
      saveJsonFilenameInput.value = getDefaultJsonFileName();
    }
    if (saveJsonMethodSelect && !supportsSaveFilePicker) {
      saveJsonMethodSelect.value = 'download';
    }
    toggleModal(saveJsonModal, true);
    setTimeout(() => {
      saveJsonFilenameInput?.focus();
      saveJsonFilenameInput?.select();
    }, 0);
  });

  // --- モーダル表示ロジック (アニメーション付き) ---
  const modalTimers = new Map();
  const toggleModal = (modal, isOpen) => {
    if (!modal) return;

    // 既存のタイマーをクリア
    if (modalTimers.has(modal)) {
      clearTimeout(modalTimers.get(modal));
      modalTimers.delete(modal);
    }

    if (isOpen) {
      if (typeof Blockly !== 'undefined') Blockly.hideChaff();
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      // Force reflow
      void modal.offsetWidth;
      modal.classList.add('show-modal');
    } else {
      modal.classList.remove('show-modal');
      const timer = setTimeout(() => {
        modal.classList.remove('flex');
        modal.classList.add('hidden');
        modalTimers.delete(modal);
      }, 300); // Wait for transition
      modalTimers.set(modal, timer);
    }
  };

  const RUNNER_CONSOLE_MAX_LINES = 1500;
  let runnerConsoleOffset = 0;
  let runnerConsolePollTimer = null;
  let runnerConsolePollInFlight = false;
  let runnerConsolePollSession = 0;
  let runnerConsoleBuffer = [];
  let runBotButtonState = 'idle';

  const setRunBotButtonState = (state) => {
    if (!runBotBtn) return;
    runBotButtonState = state;
    const isBusy = state === 'starting' || state === 'running';
    runBotBtn.classList.toggle('bg-amber-600', isBusy);
    runBotBtn.classList.toggle('hover:bg-amber-700', isBusy);
    runBotBtn.classList.toggle('shadow-amber-500/20', isBusy);
    runBotBtn.classList.toggle('bg-emerald-600', !isBusy);
    runBotBtn.classList.toggle('hover:bg-emerald-700', !isBusy);
    runBotBtn.classList.toggle('shadow-emerald-500/20', !isBusy);
    if (runBotBtnLabel) {
      runBotBtnLabel.textContent =
        state === 'running' ? '起動中' : state === 'starting' ? '起動中...' : '起動';
    }
  };
  setRunBotButtonState('idle');

  const setRunnerConsoleState = (text) => {
    if (runnerConsoleStateText) runnerConsoleStateText.textContent = text;
    if (splitRunnerConsoleStateText) splitRunnerConsoleStateText.textContent = text;
  };

  const appendRunnerConsoleLines = (lines = []) => {
    if (!Array.isArray(lines) || !lines.length) return;
    runnerConsoleBuffer.push(...lines.map((line) => String(line)));
    if (runnerConsoleBuffer.length > RUNNER_CONSOLE_MAX_LINES) {
      runnerConsoleBuffer.splice(0, runnerConsoleBuffer.length - RUNNER_CONSOLE_MAX_LINES);
    }
    const chunk = runnerConsoleBuffer.length ? `${runnerConsoleBuffer.join('\n')}\n` : '';
    const outputs = [runnerConsoleOutput, splitRunnerConsoleOutput].filter(Boolean);
    outputs.forEach((outputEl) => {
      const autoScroll =
        outputEl.scrollTop + outputEl.clientHeight >=
        outputEl.scrollHeight - 24;
      outputEl.textContent = chunk;
      if (autoScroll) {
        outputEl.scrollTop = outputEl.scrollHeight;
      }
    });
  };

  const clearRunnerConsoleView = () => {
    runnerConsoleBuffer = [];
    if (runnerConsoleOutput) runnerConsoleOutput.textContent = '';
    if (splitRunnerConsoleOutput) splitRunnerConsoleOutput.textContent = '';
  };

  const isRunnerConsoleModalOpen = () => {
    return !!runnerConsoleModal?.classList.contains('show-modal');
  };

  const isSplitConsoleVisible = () => {
    return workspaceContainer?.classList.contains('split-view') && splitViewActiveTab === 'console';
  };

  const shouldPollRunnerConsole = () => {
    return isRunnerConsoleModalOpen() || isSplitConsoleVisible();
  };

  const stopRunnerConsolePolling = () => {
    if (runnerConsolePollTimer) {
      clearInterval(runnerConsolePollTimer);
      runnerConsolePollTimer = null;
    }
    runnerConsolePollSession += 1;
    runnerConsolePollInFlight = false;
  };

  const pollRunnerConsoleLogs = async (session = runnerConsolePollSession) => {
    if (!shouldPollRunnerConsole() || runnerConsolePollInFlight || session !== runnerConsolePollSession) return;
    runnerConsolePollInFlight = true;
    const requestOffset = runnerConsoleOffset;
    if (!canDirectConnectLocalRunner) {
      setRunnerConsoleState('Runner に接続できません');
      appendRunnerConsoleLines(getRunnerConnectionHintLines());
      setRunBotButtonState('idle');
      stopRunnerConsolePolling();
      return;
    }
    try {
      const response = await fetch(buildRunnerUrl(`/logs?offset=${requestOffset}`), {
        method: 'GET',
        signal: AbortSignal.timeout(3500),
      });
      if (session !== runnerConsolePollSession) return;
      if (!response.ok) throw new Error('logs endpoint failed');
      const payload = await response.json();
      if (typeof payload.next_offset === 'number') {
        runnerConsoleOffset = Math.max(runnerConsoleOffset, payload.next_offset);
      }
      if (Array.isArray(payload.logs) && payload.logs.length) {
        appendRunnerConsoleLines(payload.logs);
      }
      if (payload.bot_running === true) {
        setRunnerConsoleState('BOT 実行中');
        setRunBotButtonState('running');
      } else {
        setRunnerConsoleState('Runner 接続中');
        if (runBotButtonState === 'running') {
          setRunBotButtonState('idle');
        }
      }
    } catch (error) {
      // Silently handle connection errors when runner is not available
      // Only log if it's an unexpected error (not connection refused)
      if (error.name !== 'TypeError' && !error.message?.includes('Failed to fetch')) {
        console.warn('Runner console polling error:', error);
      }
      setRunnerConsoleState('Runner に接続できません');
      setRunBotButtonState('idle');
    } finally {
      if (session === runnerConsolePollSession) {
        runnerConsolePollInFlight = false;
      }
    }
  };

  const startRunnerConsolePolling = (reset = false) => {
    runnerConsolePollSession += 1;
    const session = runnerConsolePollSession;
    runnerConsolePollInFlight = false;
    if (reset) {
      runnerConsoleOffset = 0;
      clearRunnerConsoleView();
    }
    if (runnerConsolePollTimer) {
      clearInterval(runnerConsolePollTimer);
      runnerConsolePollTimer = null;
    }
    void pollRunnerConsoleLogs(session);
    runnerConsolePollTimer = setInterval(() => {
      if (!shouldPollRunnerConsole()) {
        stopRunnerConsolePolling();
        return;
      }
      void pollRunnerConsoleLogs(session);
    }, 1000);
  };

  const openRunnerConsole = ({ reset = false } = {}) => {
    setLayout('split');
    setSplitViewTab('console');
    setRunnerConsoleState('接続中...');
    startRunnerConsolePolling(reset);
  };

  const openRunnerConsoleModal = ({ reset = false } = {}) => {
    if (!runnerConsoleModal) return;
    toggleModal(runnerConsoleModal, true);
    setRunnerConsoleState('接続中...');
    startRunnerConsolePolling(reset);
  };

  const closeRunnerConsole = () => {
    if (runnerConsoleModal) {
      toggleModal(runnerConsoleModal, false);
    }
    if (!shouldPollRunnerConsole()) {
      stopRunnerConsolePolling();
    }
  };

  const hideCodegenErrors = () => {
    if (!codeGenErrorBox || !codeGenErrorList) return;
    codeGenErrorList.innerHTML = '';
    codeGenErrorBox.classList.add('hidden');
  };

  const showCodegenErrors = (diagnostics) => {
    if (!Array.isArray(diagnostics) || !diagnostics.length) {
      hideCodegenErrors();
      return;
    }
    if (!codeGenErrorBox || !codeGenErrorList) {
      const messages = diagnostics.map((item) => item.message).join('\n');
      void showAlertDialog(`静的構文解析エラー:\n${messages}`, { icon: 'error' });
      return;
    }
    codeGenErrorList.innerHTML = '';
    diagnostics.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item.message;
      codeGenErrorList.appendChild(li);
    });
    codeGenErrorBox.classList.remove('hidden');
  };

  const validateBeforeCodegen = () => {
    const diagnostics = analyzeWorkspaceForCodegen(workspace);
    if (!diagnostics.length) {
      hideCodegenErrors();
      return true;
    }
    showCodegenErrors(diagnostics);
    if (codeOutput) {
      codeOutput.textContent = '';
      updateCodeStats('');
    }
    toggleModal(codeModal, true);
    return false;
  };

  const updateSaveJsonMethodHint = () => {
    if (!saveJsonMethodHint) return;
    const mode = saveJsonMethodSelect?.value || 'download';
    if (mode === 'picker') {
      saveJsonMethodHint.textContent = supportsSaveFilePicker
        ? '保存ダイアログを開いて、任意のフォルダに直接保存します。'
        : 'このブラウザでは「保存先を選んで保存」は使えません。通常ダウンロードを選んでください。';
      return;
    }
    saveJsonMethodHint.textContent =
      '通常のダウンロードとして保存します。ほぼ全ブラウザで利用できます。';
  };

  const closeSaveJsonModal = () => {
    if (!saveJsonModal) return;
    toggleModal(saveJsonModal, false);
  };

  const setSaveJsonBusy = (busy) => {
    if (!saveJsonConfirmBtn) return;
    saveJsonConfirmBtn.disabled = busy;
    saveJsonConfirmBtn.classList.toggle('opacity-70', busy);
    saveJsonConfirmBtn.classList.toggle('cursor-not-allowed', busy);
  };

  const handleSaveJsonConfirm = async () => {
    if (!storage) return;

    const pretty = Boolean(saveJsonPrettyCheckbox?.checked);
    const fileName = normalizeJsonFileName(saveJsonFilenameInput?.value || '');
    if (saveJsonFilenameInput) {
      saveJsonFilenameInput.value = fileName;
    }
    const method = saveJsonMethodSelect?.value || 'download';

    setSaveJsonBusy(true);
    let saved = false;
    try {
      if (method === 'picker' && supportsSaveFilePicker) {
        saved = await storage.saveFileWithPicker({ pretty, fileName });
      } else {
        saved = storage.exportFile({ pretty, fileName });
      }
    } finally {
      setSaveJsonBusy(false);
    }

    if (!saved) return;
    closeSaveJsonModal();
    flashSaveStatus('JSONを保存しました');
  };

  if (saveJsonMethodSelect && !supportsSaveFilePicker) {
    const pickerOption = saveJsonMethodSelect.querySelector('option[value="picker"]');
    if (pickerOption) {
      pickerOption.disabled = true;
    }
    saveJsonMethodSelect.value = 'download';
  }
  updateSaveJsonMethodHint();

  saveJsonMethodSelect?.addEventListener('change', updateSaveJsonMethodHint);
  saveJsonCloseBtn?.addEventListener('click', closeSaveJsonModal);
  saveJsonCancelBtn?.addEventListener('click', closeSaveJsonModal);
  saveJsonConfirmBtn?.addEventListener('click', () => {
    void handleSaveJsonConfirm();
  });
  saveJsonFilenameInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void handleSaveJsonConfirm();
  });
  saveJsonModal?.addEventListener('click', (event) => {
    if (event.target === saveJsonModal) {
      closeSaveJsonModal();
    }
  });

  const updateCodeStats = (code) => {
    const statsEl = document.getElementById('codeStats');
    if (!statsEl) return;
    if (!code) {
      statsEl.textContent = '';
      return;
    }
    const lines = code.split('\n').length;
    const bytes = new Blob([code]).size;
    const size = bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
    statsEl.textContent = `(${lines}行 / ${size})`;
  };

  showCodeBtn.addEventListener('click', () => {
    showCodeBtn.blur();
    // Blocklyの選択ハイライトなどを解除
    if (workspace) Blockly.hideChaff();
    if (!validateBeforeCodegen()) return;
    const generatedCode = generatePythonCode(workspace);
    codeOutput.textContent = generatedCode;
    updateCodeStats(generatedCode);
    // シンタックスハイライトを適用
    delete codeOutput.dataset.highlighted;
    if (typeof hljs !== 'undefined') hljs.highlightElement(codeOutput);
    toggleModal(codeModal, true);
  });

  // Run Bot Button - BOTの実行を開始
  runBotBtn?.addEventListener('click', async () => {
    runBotBtn.blur();
    if (workspace) Blockly.hideChaff();
    if (!validateBeforeCodegen()) return;
    if (!canDirectConnectLocalRunner) {
      setRunBotButtonState('idle');
      openRunnerConsole({ reset: true });
      setRunnerConsoleState('Runner に接続できません');
      const runBotStatus = document.getElementById('runBotStatus');
      const runBotStatusText = document.getElementById('runBotStatusText');
      if (runBotStatus && runBotStatusText) {
        runBotStatus.dataset.state = 'error';
        runBotStatusText.textContent = 'このURLでは localhost runner に接続できません';
        runBotStatus.setAttribute('data-show', 'true');
        setTimeout(() => runBotStatus.setAttribute('data-show', 'false'), 3500);
      }
      return;
    }
    setRunBotButtonState('starting');
    openRunnerConsole({ reset: true });
    appendRunnerConsoleLines(['[editor] 起動リクエストを送信しています...']);

    // Show toast with loading state
    const runBotStatus = document.getElementById('runBotStatus');
    const runBotStatusText = document.getElementById('runBotStatusText');
    if (runBotStatus && runBotStatusText) {
      runBotStatus.dataset.state = 'success';
      runBotStatusText.textContent = 'BOTを起動中...';
      runBotStatus.setAttribute('data-show', 'true');
    }

    try {
      const botCode = generatePythonCode(workspace);
      const response = await fetch(buildRunnerUrl(''), {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: botCode,
        signal: AbortSignal.timeout(7000),
      });

      // Parse JSON response
      const responseData = await response.json();

      if (response.ok && responseData.status === 'ok') {
        // Success - show success toast
        if (runBotStatus && runBotStatusText) {
          runBotStatus.dataset.state = 'success';
          runBotStatusText.textContent = 'BOTの起動を開始しました';
          runBotStatus.setAttribute('data-show', 'true');
          setTimeout(() => runBotStatus.setAttribute('data-show', 'false'), 3000);
        }
      } else {
        throw new Error('Failed to start bot');
      }
    } catch (error) {
      console.error('Failed to run bot:', error);
      setRunBotButtonState('idle');
      appendRunnerConsoleLines([
        `[editor] 起動に失敗しました: ${error?.message || 'unknown error'}`,
        '[editor] edbb-runner が起動しているか確認してください。',
      ]);

      // Error - show error toast
      if (runBotStatus && runBotStatusText) {
        runBotStatus.dataset.state = 'error';
        runBotStatusText.textContent = 'BOTの起動に失敗しました';
        runBotStatus.setAttribute('data-show', 'true');
        setTimeout(() => runBotStatus.setAttribute('data-show', 'false'), 3000);
      }

      // Show guidance modal after a short delay
      setTimeout(() => {
        // Stop polling when showing any error modal.
        stopRunnerConsolePolling();
        setRunBotButtonState('idle');
        if (runnerDownloadModal) {
          toggleModal(runnerDownloadModal, true);
        }
      }, 500);
    }
  });

  const closeRunnerDownloadModal = () => {
    if (runnerDownloadModal) {
      toggleModal(runnerDownloadModal, false);
    }
  };

  runnerConsoleCloseBtn?.addEventListener('click', closeRunnerConsole);
  runnerConsoleClearBtn?.addEventListener('click', () => {
    clearRunnerConsoleView();
  });
  runnerConsoleModal?.addEventListener('click', (event) => {
    if (event.target === runnerConsoleModal) {
      closeRunnerConsole();
    }
  });

  runnerDownloadModalClose?.addEventListener('click', closeRunnerDownloadModal);
  runnerDownloadCancelBtn?.addEventListener('click', closeRunnerDownloadModal);

  runnerDownloadBtn?.addEventListener('click', () => {
    const hostname = window.location.hostname || '';
    const isBetaHost = /^beta(\.|-)/i.test(hostname);
    const downloadUrl = isBetaHost
      ? 'https://github.com/himais0giiiin/edbb-runner/archive/refs/heads/main.zip'
      : 'https://github.com/himais0giiiin/edbb-runner/archive/refs/heads/main.zip';

    // Use direct archive endpoint + anchor click to avoid popup blockers.
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
    closeRunnerDownloadModal();
  });

  // Close modal on backdrop click
  runnerDownloadModal?.addEventListener('click', (e) => {
    if (e.target === runnerDownloadModal) {
      closeRunnerDownloadModal();
    }
  });

  const openSplitModal = () => {
    if (!splitCodeModal) return;
    if (!validateBeforeCodegen()) return;
    const files = generateSplitPythonFiles(workspace);
    renderSplitFiles(files);
    splitCodeModal.classList.remove('hidden');
    splitCodeModal.classList.add('flex');
    void splitCodeModal.offsetWidth;
    splitCodeModal.classList.add('show-modal');
  };

  splitCodeBtn?.addEventListener('click', () => {
    openSplitModal();
  });

  closeModalBtn.addEventListener('click', () => {
    toggleModal(codeModal, false);
  });

  // Backdrop click to close
  codeModal.addEventListener('click', (e) => {
    if (e.target === codeModal) toggleModal(codeModal, false);
  });

  splitModalClose?.addEventListener('click', () => {
    toggleModal(splitCodeModal, false);
  });

  splitDownloadAllBtn?.addEventListener('click', () => {
    if (!validateBeforeCodegen()) {
      toggleModal(splitCodeModal, false);
      return;
    }
    const files = generateSplitPythonFiles(workspace);
    Object.entries(files).forEach(([path, content]) => {
      if (content == null) return;
      const safeName = path.replace(/\//g, '__');
      downloadTextFile(safeName, content);
    });
  });

  downloadZipBtn?.addEventListener('click', async () => {
    if (!validateBeforeCodegen()) return;
    let code = generatePythonCode(workspace);

    // Inject imports for .env support (import os は生成コード側で常に含まれる)
    if (!code.includes('from dotenv import load_dotenv')) {
      code = code.replace('import discord', 'from dotenv import load_dotenv\nimport discord');
    }

    // Replace the main execution block to use .env
    const mainBlockRegex = /if __name__ == "__main__":[\s\S]+?bot\.run\((?:token|"TOKEN")\)/;
    const newMainBlock = `if __name__ == "__main__":
    load_dotenv()
    token = os.getenv("TOKEN")
    
    if not token:
        print("Error: TOKEN not found in .env file.")
        print("Please set your bot token in the .env file: TOKEN=... ")
    else:
        bot.run(token)`;

    code = code.replace(mainBlockRegex, newMainBlock);

    const zip = new JSZip();
    zip.file('bot.py', code);
    zip.file('.env', 'TOKEN=YOUR_TOKEN_HERE');
    zip.file('requirements.txt', 'discord.py[voice]\npython-dotenv');

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bot-project.zip';
    a.click();
    URL.revokeObjectURL(url);
  });

  copyCodeBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(codeOutput.textContent);
    const originalHtml = copyCodeBtn.innerHTML;
    copyCodeBtn.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5"></i> コピー完了';
    copyCodeBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-500');
    copyCodeBtn.classList.add('bg-emerald-600', 'hover:bg-emerald-500', 'border-emerald-400');
    lucide.createIcons();

    setTimeout(() => {
      copyCodeBtn.innerHTML = originalHtml;
      copyCodeBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-500');
      copyCodeBtn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500', 'border-emerald-400');
      lucide.createIcons();
    }, 2000);
  });
};

// Initialize app when DOM is ready and all modules are loaded
const startApp = async (retryCount = 0) => {
  if (window.__edbb_initialized) return;

  // Use a second flag to prevent overlapping initialization attempts
  if (window.__edbb_starting && retryCount === 0) return;
  window.__edbb_starting = true;

  // Limit retries
  if (retryCount > 100) {
    console.error('App initialization timed out.');
    window.__edbb_starting = false;
    return;
  }

  // Ensure Blockly is fully initialized
  if (typeof Blockly === 'undefined' || !Blockly.Blocks || !Blockly.Python) {
    setTimeout(() => startApp(retryCount + 1), 100);
    return;
  }

  // Dynamically load blocks/index.js
  if (!Blockly.Blocks['on_ready']) {
    try {
      await import('./blocks/index.js');
    } catch (e) {
      console.error('Failed to load blocks/index.js', e);
    }
  }

  if (!Blockly.Blocks['on_ready']) {
    setTimeout(() => startApp(retryCount + 1), 100);
    return;
  }

  // All systems ready
  try {
    await initializeApp();
    window.__edbb_initialized = true;
  } catch (e) {
    console.error('App initialization failed:', e);
  } finally {
    window.__edbb_starting = false;
  }
};

const triggerStart = () => {
  if (window.__start_triggered) return;
  window.__start_triggered = true;
  setTimeout(startApp, 50);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', triggerStart);
} else {
  triggerStart();
}
