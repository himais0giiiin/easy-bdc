import { FieldListDropdown, LIST_VARIABLE_EMPTY_ID } from './core.js';

export function initLists() {
    Blockly.Blocks['empty_list_create'] = {
        init: function () {
            this.appendDummyInput().appendField('📋 空のリストを作成');
            this.setOutput(true, 'Array');
            this.setColour(210);
        },
    };
    Blockly.Python.forBlock['empty_list_create'] = function (block) {
        return ['[]', Blockly.Python.ORDER_ATOMIC];
    };

    Blockly.Blocks['list_variable_get'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('📋 リスト変数')
                .appendField(new FieldListDropdown(), 'VAR');
            this.setOutput(true, 'Array');
            this.setColour(210);
        },
    };
    Blockly.Python.forBlock['list_variable_get'] = function (block) {
        const varId = block.getFieldValue('VAR');
        if (!varId || varId === LIST_VARIABLE_EMPTY_ID) {
            return ['[]', Blockly.Python.ORDER_ATOMIC];
        }
        const variableModel = block.workspace?.getVariableById?.(varId);
        if (!variableModel) {
            return ['[]', Blockly.Python.ORDER_ATOMIC];
        }
        const getVarName =
            typeof Blockly.Python.getVariableName === 'function'
                ? Blockly.Python.getVariableName.bind(Blockly.Python)
                : (id) => Blockly.Python.nameDB_.getName(id, Blockly.Names.VARIABLE_NAME);
        const variable = getVarName(variableModel.getId?.() || varId);
        return [variable || '[]', Blockly.Python.ORDER_ATOMIC];
    };

    Blockly.Blocks['lists_append_to'] = {
        init: function () {
            this.appendValueInput('LIST').setCheck('Array').appendField('リスト');
            this.appendValueInput('ITEM').setCheck(null).appendField('に項目');
            this.appendDummyInput().appendField('を追加');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(210);
        },
    };
    Blockly.Python.forBlock['lists_append_to'] = function (block) {
        const list = Blockly.Python.valueToCode(block, 'LIST', Blockly.Python.ORDER_MEMBER) || '[]';
        const item = Blockly.Python.valueToCode(block, 'ITEM', Blockly.Python.ORDER_NONE) || 'None';
        return `${list}.append(${item})\n`;
    };

    Blockly.Blocks['random_choice'] = {
        init: function () {
            this.appendValueInput('LIST').setCheck('Array').appendField('🎲 リスト');
            this.appendDummyInput().appendField('からランダムに1つ選ぶ');
            this.setOutput(true, null);
            this.setColour(230);
        },
    };
    Blockly.Python.forBlock['random_choice'] = function (block) {
        const list = Blockly.Python.valueToCode(block, 'LIST', Blockly.Python.ORDER_NONE) || '[]';
        return [`random.choice(${list})`, Blockly.Python.ORDER_ATOMIC];
    };

    // 不使用ブロックの互換維持
    Blockly.Python.forBlock['lists_create_with'] = function (block) {
        const elements = [];
        for (let i = 0; i < block.itemCount_; i++) {
            elements.push(
                Blockly.Python.valueToCode(block, 'ADD' + i, Blockly.Python.ORDER_NONE) || 'None',
            );
        }
        return ['[' + elements.join(', ') + ']', Blockly.Python.ORDER_ATOMIC];
    };
    Blockly.Python.forBlock['lists_length'] = function (block) {
        const list = Blockly.Python.valueToCode(block, 'VALUE', Blockly.Python.ORDER_NONE) || '[]';
        return [`len(${list})`, Blockly.Python.ORDER_FUNCTION_CALL];
    };

    Blockly.Python.forBlock['lists_getIndex'] = function (block) {
        const mode = block.getFieldValue('MODE') || 'GET';
        const where = block.getFieldValue('WHERE') || 'FROM_START';
        const list = Blockly.Python.valueToCode(block, 'VALUE', Blockly.Python.ORDER_MEMBER) || '[]';
        let code, at;
        if (where === 'FROM_START') {
            at = Blockly.Python.valueToCode(block, 'AT', Blockly.Python.ORDER_ADDITIVE) || '1';
            at = Blockly.utils.string.isNumber(at) ? String(Number(at) - 1) : `((${at}) - 1)`;
            if (mode === 'GET') code = `${list}[${at}]`;
            else if (mode === 'GET_REMOVE') code = `${list}.pop(${at})`;
            else if (mode === 'REMOVE') code = `del ${list}[${at}]\n`;
        } else if (where === 'FROM_END') {
            at = Blockly.Python.valueToCode(block, 'AT', Blockly.Python.ORDER_UNARY_SIGN) || '1';
            at = Blockly.utils.string.isNumber(at) ? String(-Number(at)) : `-(${at})`;
            if (mode === 'GET') code = `${list}[${at}]`;
            else if (mode === 'GET_REMOVE') code = `${list}.pop(${at})`;
            else if (mode === 'REMOVE') code = `del ${list}[${at}]\n`;
        } else if (where === 'FIRST') {
            if (mode === 'GET') code = `${list}[0]`;
            else if (mode === 'GET_REMOVE') code = `${list}.pop(0)`;
            else if (mode === 'REMOVE') code = `del ${list}[0]\n`;
        } else if (where === 'LAST') {
            if (mode === 'GET') code = `${list}[-1]`;
            else if (mode === 'GET_REMOVE') code = `${list}.pop()`;
            else if (mode === 'REMOVE') code = `del ${list}[-1]\n`;
        } else {
            return Blockly.Python.lists_getIndex(block);
        }
        if (mode === 'REMOVE') return code;
        return [code, Blockly.Python.ORDER_MEMBER];
    };

    Blockly.Python.forBlock['lists_setIndex'] = function (block) {
        const mode = block.getFieldValue('MODE') || 'SET';
        const where = block.getFieldValue('WHERE') || 'FROM_START';
        const list = Blockly.Python.valueToCode(block, 'LIST', Blockly.Python.ORDER_MEMBER) || '[]';
        const value = Blockly.Python.valueToCode(block, 'TO', Blockly.Python.ORDER_NONE) || 'None';
        let code, at;
        if (where === 'FROM_START') {
            at = Blockly.Python.valueToCode(block, 'AT', Blockly.Python.ORDER_ADDITIVE) || '1';
            at = Blockly.utils.string.isNumber(at) ? String(Number(at) - 1) : `((${at}) - 1)`;
            if (mode === 'SET') code = `${list}[${at}] = ${value}\n`;
            else if (mode === 'INSERT') code = `${list}.insert(${at}, ${value})\n`;
        } else if (where === 'FIRST') {
            if (mode === 'SET') code = `${list}[0] = ${value}\n`;
            else if (mode === 'INSERT') code = `${list}.insert(0, ${value})\n`;
        } else if (where === 'LAST') {
            if (mode === 'SET') code = `${list}[-1] = ${value}\n`;
            else if (mode === 'INSERT') code = `${list}.append(${value})\n`;
        } else if (where === 'FROM_END') {
            at = Blockly.Python.valueToCode(block, 'AT', Blockly.Python.ORDER_UNARY_SIGN) || '1';
            if (mode === 'SET') {
                const setAt = Blockly.utils.string.isNumber(at) ? String(-Number(at)) : `-(${at})`;
                code = `${list}[${setAt}] = ${value}\n`;
            } else if (mode === 'INSERT') {
                const insertAt = Blockly.utils.string.isNumber(at)
                    ? `len(${list}) - ${Number(at)}`
                    : `len(${list}) - (${at})`;
                code = `${list}.insert(${insertAt}, ${value})\n`;
            }
        } else {
            return Blockly.Python.lists_setIndex(block);
        }
        return code;
    };
}
