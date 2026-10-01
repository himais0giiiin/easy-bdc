import {
    FieldJsonDatasetDropdown,
    buildJsonRuntimeSaveCode,
    isJsonRuntimeDatasetCode,
    getJsonDatasetLiteral,
    buildJsonDatasetAccessCode,
    JSON_DATASET_EMPTY_ID
} from './core.js';

export function initJson() {
    Blockly.Blocks['json_load'] = {
        init: function () {
            this.appendValueInput('FILENAME').setCheck('String').appendField('📂 JSONファイルを読み込む (');
            this.appendDummyInput().appendField(')');
            this.setOutput(true, null);
            this.setColour(30);
        },
    };
    Blockly.Python.forBlock['json_load'] = function (block) {
        const key = Blockly.Python.valueToCode(block, 'FILENAME', Blockly.Python.ORDER_NONE) || '"key"';
        return [`_load_json_data(${key})`, Blockly.Python.ORDER_ATOMIC];
    };

    Blockly.Blocks['json_save'] = {
        init: function () {
            this.appendValueInput('DATA').setCheck(null).appendField('💾 データを保存: ');
            this.appendValueInput('FILENAME').setCheck('String').appendField(' ファイル名(');
            this.appendDummyInput().appendField(')');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(30);
        },
    };
    Blockly.Python.forBlock['json_save'] = function (block) {
        const key = Blockly.Python.valueToCode(block, 'FILENAME', Blockly.Python.ORDER_NONE) || '"key"';
        const value = Blockly.Python.valueToCode(block, 'DATA', Blockly.Python.ORDER_NONE) || 'None';
        return `_save_json_data(${key}, ${value})\n`;
    };

    Blockly.Blocks['dict_add'] = {
        init: function () {
            this.appendValueInput('DICT').setCheck(null).appendField('🧩 JSONに');
            this.appendValueInput('KEY').setCheck('String').appendField('キー');
            this.appendValueInput('VALUE').setCheck(null).appendField('値を追加');
            this.appendDummyInput().appendField('(同じキーは上書き)');
            this.setInputsInline(true);
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(30);
            this.setTooltip('JSONオブジェクトにキーと値を追加します。');
        },
    };
    Blockly.Python.forBlock['dict_add'] = function (block) {
        const dictCode = Blockly.Python.valueToCode(block, 'DICT', Blockly.Python.ORDER_MEMBER) || '{}';
        const keyCode = Blockly.Python.valueToCode(block, 'KEY', Blockly.Python.ORDER_NONE) || '""';
        const valueCode = Blockly.Python.valueToCode(block, 'VALUE', Blockly.Python.ORDER_NONE) || 'None';
        let code = `${dictCode}[${keyCode}] = ${valueCode}\n`;
        if (isJsonRuntimeDatasetCode(dictCode)) {
            code += buildJsonRuntimeSaveCode();
        }
        return code;
    };

    Blockly.Blocks['dict_delete'] = {
        init: function () {
            this.appendValueInput('DICT').setCheck(null).appendField('🗑️ JSONから');
            this.appendValueInput('KEY').setCheck('String').appendField('キーを削除');
            this.setInputsInline(true);
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(30);
            this.setTooltip('JSONオブジェクトから指定したキーを削除します。');
        },
    };
    Blockly.Python.forBlock['dict_delete'] = function (block) {
        const dictCode = Blockly.Python.valueToCode(block, 'DICT', Blockly.Python.ORDER_MEMBER) || '{}';
        const keyCode = Blockly.Python.valueToCode(block, 'KEY', Blockly.Python.ORDER_NONE) || '""';
        let code = `if ${keyCode} in ${dictCode}:\n    del ${dictCode}[${keyCode}]\n`;
        if (isJsonRuntimeDatasetCode(dictCode)) {
            code += buildJsonRuntimeSaveCode();
        }
        return code;
    };

    Blockly.Blocks['dict_has_key'] = {
        init: function () {
            this.appendValueInput('DICT').setCheck(null).appendField('❓ JSONに');
            this.appendValueInput('KEY').setCheck('String').appendField('キーがある');
            this.setInputsInline(true);
            this.setOutput(true, 'Boolean');
            this.setColour(30);
            this.setTooltip('指定したキーが存在すれば true を返します。');
        },
    };
    Blockly.Python.forBlock['dict_has_key'] = function (block) {
        const dictCode = Blockly.Python.valueToCode(block, 'DICT', Blockly.Python.ORDER_MEMBER) || '{}';
        const keyCode = Blockly.Python.valueToCode(block, 'KEY', Blockly.Python.ORDER_NONE) || '""';
        return [`(${keyCode} in ${dictCode})`, Blockly.Python.ORDER_RELATIONAL];
    };

    Blockly.Blocks['dict_keys'] = {
        init: function () {
            this.appendValueInput('DICT').setCheck(null).appendField('📋 JSONのキー一覧');
            this.setOutput(true, 'Array');
            this.setColour(30);
            this.setTooltip('JSONオブジェクトのキー一覧をリストで返します。');
        },
    };
    Blockly.Python.forBlock['dict_keys'] = function (block) {
        const dictCode = Blockly.Python.valueToCode(block, 'DICT', Blockly.Python.ORDER_MEMBER) || '{}';
        return [`list(${dictCode}.keys())`, Blockly.Python.ORDER_FUNCTION_CALL];
    };

    Blockly.Blocks['json_dataset_get'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('📦 JSONデータセット')
                .appendField(new FieldJsonDatasetDropdown(), 'DATASET');
            this.setOutput(true, null);
            this.setColour(30);
            this.setTooltip('選択したJSONデータセット全体を取り出します。');
        },
    };
    Blockly.Python.forBlock['json_dataset_get'] = function (block) {
        const datasetName = block.getFieldValue('DATASET');
        const literal = getJsonDatasetLiteral(datasetName);
        return [buildJsonDatasetAccessCode(datasetName, literal), Blockly.Python.ORDER_ATOMIC];
    };

    Blockly.Blocks['json_dataset_get_value'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('🔎 JSONデータセット')
                .appendField(new FieldJsonDatasetDropdown(), 'DATASET');
            this.appendValueInput('KEY').setCheck('String').appendField('のキー');
            this.setInputsInline(true);
            this.setOutput(true, null);
            this.setColour(30);
            this.setTooltip('指定したキーの値を取り出します。キーが無い場合は None です。');
        },
    };
    Blockly.Python.forBlock['json_dataset_get_value'] = function (block) {
        const datasetName = block.getFieldValue('DATASET');
        const keyCode = Blockly.Python.valueToCode(block, 'KEY', Blockly.Python.ORDER_NONE) || '""';
        const literal = getJsonDatasetLiteral(datasetName);
        const datasetCode = buildJsonDatasetAccessCode(datasetName, literal);
        return [`(${datasetCode}.get(${keyCode}, None))`, Blockly.Python.ORDER_ATOMIC];
    };

    Blockly.Blocks['json_dataset_set_value'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('🧩 JSONデータセット')
                .appendField(new FieldJsonDatasetDropdown(), 'DATASET');
            this.appendValueInput('KEY').setCheck('String').appendField('のキー');
            this.appendValueInput('VALUE').setCheck(null).appendField('を');
            this.appendDummyInput().appendField('に設定して保存');
            this.setInputsInline(true);
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(30);
            this.setTooltip('JSONデータセットにキーと値を保存し、ファイルに永続化します。');
        },
    };
    Blockly.Python.forBlock['json_dataset_set_value'] = function (block) {
        const datasetName = block.getFieldValue('DATASET');
        if (!datasetName || datasetName === JSON_DATASET_EMPTY_ID) return '';
        const keyCode = Blockly.Python.valueToCode(block, 'KEY', Blockly.Python.ORDER_NONE) || '""';
        const valueCode = Blockly.Python.valueToCode(block, 'VALUE', Blockly.Python.ORDER_NONE) || 'None';
        const literal = getJsonDatasetLiteral(datasetName);
        const datasetCode = buildJsonDatasetAccessCode(datasetName, literal);
        const datasetVar = Blockly.Python.nameDB_
            ? Blockly.Python.nameDB_.getDistinctName('__edbb_dataset', Blockly.Names.VARIABLE_NAME)
            : '__edbb_dataset';
        let code = `${datasetVar} = ${datasetCode}\n`;
        code += `${datasetVar}[${keyCode}] = ${valueCode}\n`;
        code += buildJsonRuntimeSaveCode();
        return code;
    };

    Blockly.Blocks['json_dataset_delete_key'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('🗑️ JSONデータセット')
                .appendField(new FieldJsonDatasetDropdown(), 'DATASET');
            this.appendValueInput('KEY').setCheck('String').appendField('のキー');
            this.appendDummyInput().appendField('を削除して保存');
            this.setInputsInline(true);
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(30);
            this.setTooltip('JSONデータセットからキーを削除し、ファイルに永続化します。');
        },
    };
    Blockly.Python.forBlock['json_dataset_delete_key'] = function (block) {
        const datasetName = block.getFieldValue('DATASET');
        if (!datasetName || datasetName === JSON_DATASET_EMPTY_ID) return '';
        const keyCode = Blockly.Python.valueToCode(block, 'KEY', Blockly.Python.ORDER_NONE) || '""';
        const literal = getJsonDatasetLiteral(datasetName);
        const datasetCode = buildJsonDatasetAccessCode(datasetName, literal);
        const datasetVar = Blockly.Python.nameDB_
            ? Blockly.Python.nameDB_.getDistinctName('__edbb_dataset', Blockly.Names.VARIABLE_NAME)
            : '__edbb_dataset';
        let code = `${datasetVar} = ${datasetCode}\n`;
        code += `if ${keyCode} in ${datasetVar}:\n    del ${datasetVar}[${keyCode}]\n`;
        code += buildJsonRuntimeSaveCode();
        return code;
    };

    Blockly.Blocks['json_dataset_save_now'] = {
        init: function () {
            this.appendDummyInput().appendField('💾 JSONデータセットを今すぐ保存');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(30);
            this.setTooltip('現在のJSONデータセットをファイルに保存します。');
        },
    };
    Blockly.Python.forBlock['json_dataset_save_now'] = function () {
        return buildJsonRuntimeSaveCode();
    };
}
