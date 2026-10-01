// editor/blocks/core.js
// Blockly のグローバルヘルパー関数と共通処理を定義します

export const SCIENTIFIC_NOTATION_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/;
export const DECIMAL_NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
export const PARTIAL_NUMBER_PATTERN = /^[+-]?(?:(?:\d+\.?\d*|\.\d+)?(?:[eE][+-]?\d*)?)?$/;

export const expandScientificNotation = (rawValue) => {
    const source = String(rawValue ?? '').trim();
    const match = source.match(SCIENTIFIC_NOTATION_PATTERN);
    if (!match) return source;
    const sign = match[1] || '';
    const integerPart = match[2] || '0';
    const fractionPart = match[3] || '';
    const exponent = Number.parseInt(match[4], 10);
    if (!Number.isFinite(exponent)) return source;
    const digits = `${integerPart}${fractionPart}`;
    const decimalIndex = integerPart.length + exponent;
    let plain;
    if (decimalIndex <= 0) {
        plain = `0.${'0'.repeat(Math.abs(decimalIndex))}${digits}`;
    } else if (decimalIndex >= digits.length) {
        plain = `${digits}${'0'.repeat(decimalIndex - digits.length)}`;
    } else {
        plain = `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
    }
    plain = plain.replace(/^0+(?=\d)/, '');
    if (plain.startsWith('.')) plain = `0${plain}`;
    return `${sign}${plain}`;
};

export const normalizeMathNumberLiteral = (rawValue) => {
    const compact = String(rawValue ?? '').trim().replace(/_/g, '');
    if (!compact) return '0';
    const expanded = expandScientificNotation(compact);
    if (!DECIMAL_NUMBER_PATTERN.test(expanded)) return '0';
    if (expanded.startsWith('.')) return `0${expanded}`;
    if (expanded.startsWith('-.')) return `-0${expanded.slice(1)}`;
    if (expanded.startsWith('+.')) return `+0${expanded.slice(1)}`;
    return expanded;
};

export const normalizeMathNumberInput = (newValue) => {
    const raw = String(newValue ?? '').trim();
    if (!raw) return '';
    const compact = raw.replace(/_/g, '');
    if (!PARTIAL_NUMBER_PATTERN.test(compact)) return null;
    if (SCIENTIFIC_NOTATION_PATTERN.test(compact)) {
        return expandScientificNotation(compact);
    }
    return compact;
};

export const JSON_DATASET_EMPTY_ID = '__edbb_json_dataset_empty__';
export const getJsonDataStore = () => (typeof Blockly !== 'undefined' ? Blockly.edbbJsonDataStore : null);
export const getJsonDatasetOptions = () => {
    const store = getJsonDataStore();
    const names = store?.getDatasetNames?.() || [];
    if (!names.length) {
        return [['データセット未作成', JSON_DATASET_EMPTY_ID]];
    }
    return names.map((name) => [name, name]);
};
export const toDatasetJsonFileName = (datasetName) => {
    const base = String(datasetName ?? '').trim();
    const safe = (base || 'dataset').replace(/[\\/:*?"<>|]/g, '_');
    return `${safe}.json`;
};
export const getJsonRuntimeStoreCode = (datasetName, fallbackLiteral = '{}') => {
    const safeName = JSON.stringify(String(datasetName ?? ''));
    const filename = JSON.stringify(toDatasetJsonFileName(datasetName));
    return `((lambda _cache, _files: _cache.setdefault(${safeName}, (_load_json_data(_files.setdefault(${safeName}, ${filename})) if os.path.exists(_resolve_json_path(_files.setdefault(${safeName}, ${filename}))) else ${fallbackLiteral})))(globals().setdefault('_edbb_json_dataset_cache', {}), globals().setdefault('_edbb_json_dataset_files', {})))`;
};
export const buildJsonDatasetAccessCode = (datasetName, fallbackLiteral = '{}') => {
    return getJsonRuntimeStoreCode(datasetName, fallbackLiteral);
};
export const buildJsonRuntimeSaveCode = () => `_save_json_dataset_cache()\n`;
export const isJsonRuntimeDatasetCode = (code) => typeof code === 'string' && code.includes('_edbb_json_dataset_cache');

export class FieldJsonDatasetDropdown extends Blockly.FieldDropdown {
    constructor() {
        super(function () {
            return getJsonDatasetOptions();
        });
    }
    init() {
        super.init();
        this.ensureValidValue_();
    }
    ensureValidValue_() {
        if (!getJsonDataStore()) return;
        const options = getJsonDatasetOptions();
        const values = options.map((option) => option[1]);
        const current = this.getValue();
        if (!current || !values.includes(current)) {
            this.setValue(values[0]);
        }
    }
    getText() {
        const options = getJsonDatasetOptions();
        const current = this.getValue();
        const match = options.find((option) => option[1] === current);
        return match ? match[0] : 'データセット未作成';
    }
}

export const LIST_VARIABLE_EMPTY_ID = '__edbb_list_empty__';
export const getListStore = () => (typeof Blockly !== 'undefined' ? Blockly.edbbListStore : null);
export const resolveListWorkspace = (field) => {
    const workspace = field?.getSourceBlock?.()?.workspace;
    if (workspace?.isFlyout && workspace?.targetWorkspace) {
        return workspace.targetWorkspace;
    }
    return workspace;
};
export const getListVariableOptions = (field) => {
    const workspace = resolveListWorkspace(field);
    const store = getListStore();
    const entries = store?.getEntries?.() || [];
    const options = [];
    if (workspace && entries.length) {
        entries.forEach((entry) => {
            const variable = workspace.getVariableById?.(entry.id);
            if (variable) options.push([variable.name, variable.getId()]);
        });
    }
    if (!options.length) {
        options.push(['リストがありません', LIST_VARIABLE_EMPTY_ID]);
    }
    return options;
};

export class FieldListDropdown extends Blockly.FieldDropdown {
    constructor() {
        super(function () {
            return getListVariableOptions(this);
        });
    }
    init() {
        super.init();
        this.ensureValidValue_();
    }
    ensureValidValue_() {
        if (!getListStore()) return;
        const options = getListVariableOptions(this);
        const values = options.map((option) => option[1]);
        const current = this.getValue();
        if (!current || !values.includes(current)) {
            this.setValue(values[0]);
        }
    }
    getText() {
        const store = getListStore();
        const hasLists = (store?.getIds?.() || []).length > 0;
        const current = this.getValue();
        if (!hasLists || current === LIST_VARIABLE_EMPTY_ID) {
            return 'リストがありません';
        }
        const options = getListVariableOptions(this);
        const match = options.find((option) => option[1] === current);
        if (!match) return 'リストを選択';
        return match[0];
    }
}

export const getBranchCode = (block, name) => {
    let code = Blockly.Python.statementToCode(block, name);
    if (!code || code.trim() === '') return Blockly.Python.INDENT + 'pass\n';
    return code;
};

export const getJsonDatasetLiteral = (datasetName) => {
    const store = getJsonDataStore();
    if (!store || !datasetName || datasetName === JSON_DATASET_EMPTY_ID) {
        return '{}';
    }
    const literal = store.toPythonLiteral?.(datasetName);
    if (typeof literal === 'string' && literal.trim()) {
        return literal;
    }
    return '{}';
};
