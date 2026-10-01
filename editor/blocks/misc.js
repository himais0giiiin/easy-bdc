import { normalizeMathNumberInput, normalizeMathNumberLiteral, getBranchCode } from './core.js';

export function initMisc() {
    Blockly.Blocks['custom_python_code'] = {
        init: function () {
            this.appendDummyInput().appendField('🐍 Pythonコード実行');
            const FieldMultiline = (typeof FieldMultilineInput !== 'undefined')
                ? FieldMultilineInput
                : (Blockly.FieldMultilineInput || Blockly.FieldTextInput);

            this.appendDummyInput().appendField(
                new FieldMultiline("print('Hello World')"),
                'CODE',
            );
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(60);
            this.setTooltip('任意のPythonコードをここに記述して実行させます。');
        }
    };
    Blockly.Python.forBlock['custom_python_code'] = function (block) {
        const code = block.getFieldValue('CODE');
        return code + '\n';
    };

    Blockly.Blocks['math_number'] = {
        init: function () {
            this.appendDummyInput().appendField(
                new Blockly.FieldTextInput('0', normalizeMathNumberInput),
                'NUM',
            );
            this.setOutput(true, 'Number');
            if (typeof this.setStyle === 'function') {
                this.setStyle('math_blocks');
            } else {
                this.setColour(230);
            }
            this.setTooltip('数値を入力します（指数表記は通常の桁表記に変換されます）');
        },
    };
    Blockly.Python.forBlock['math_number'] = function (block) {
        const value = normalizeMathNumberLiteral(block.getFieldValue('NUM'));
        const order = value.startsWith('-') ? Blockly.Python.ORDER_UNARY_SIGN : Blockly.Python.ORDER_ATOMIC;
        return [value, order];
    };

    Blockly.Blocks['random_integer'] = {
        init: function () {
            this.appendValueInput('FROM').setCheck('Number').appendField('🎲 乱数 (最小');
            this.appendValueInput('TO').setCheck('Number').appendField('〜 最大');
            this.appendDummyInput().appendField(')');
            this.setInputsInline(true);
            this.setOutput(true, 'Number');
            this.setColour(230);
        },
    };
    Blockly.Python.forBlock['random_integer'] = function (block) {
        const from = Blockly.Python.valueToCode(block, 'FROM', Blockly.Python.ORDER_NONE) || '0';
        const to = Blockly.Python.valueToCode(block, 'TO', Blockly.Python.ORDER_NONE) || '100';
        return [`random.randint(${from}, ${to})`, Blockly.Python.ORDER_ATOMIC];
    };

    Blockly.Python.forBlock['math_round'] = function (block) {
        const num = Blockly.Python.valueToCode(block, 'NUM', Blockly.Python.ORDER_NONE) || '0';
        return [num, Blockly.Python.ORDER_NONE];
    };

    Blockly.Blocks['text_replace'] = {
        init: function () {
            this.appendValueInput('TEXT').setCheck('String').appendField('テキスト');
            this.appendValueInput('FROM').setCheck('String').appendField('の中の');
            this.appendValueInput('TO').setCheck('String').appendField('を');
            this.appendDummyInput().appendField('に置換する');
            this.setInputsInline(true);
            this.setOutput(true, 'String');
            this.setColour(160);
        },
    };
    Blockly.Python.forBlock['text_replace'] = function (block) {
        const text = Blockly.Python.valueToCode(block, 'TEXT', Blockly.Python.ORDER_MEMBER) || "''";
        const from = Blockly.Python.valueToCode(block, 'FROM', Blockly.Python.ORDER_NONE) || "''";
        const to = Blockly.Python.valueToCode(block, 'TO', Blockly.Python.ORDER_NONE) || "''";
        return [`str(${text}).replace(str(${from}), str(${to}))`, Blockly.Python.ORDER_MEMBER];
    };

    Blockly.Python.forBlock['text_charAt'] = function (block) {
        const where = block.getFieldValue('WHERE') || 'FROM_START';
        const text = Blockly.Python.valueToCode(block, 'VALUE', Blockly.Python.ORDER_MEMBER) || "''";
        let code, at;
        if (where === 'FROM_START') {
            at = Blockly.Python.valueToCode(block, 'AT', Blockly.Python.ORDER_ADDITIVE) || '1';
            at = Blockly.utils.string.isNumber(at) ? String(Number(at) - 1) : `((${at}) - 1)`;
            code = `${text}[${at}]`;
        } else if (where === 'FIRST') {
            code = `${text}[0]`;
        } else if (where === 'LAST') {
            code = `${text}[-1]`;
        } else if (where === 'FROM_END') {
            at = Blockly.Python.valueToCode(block, 'AT', Blockly.Python.ORDER_UNARY_SIGN) || '1';
            at = Blockly.utils.string.isNumber(at) ? String(-Number(at)) : `-(${at})`;
            code = `${text}[${at}]`;
        } else {
            code = `${text}[0]`;
        }
        return [code, Blockly.Python.ORDER_MEMBER];
    };

    Blockly.Blocks['print_to_console'] = {
        init: function () {
            this.appendValueInput('TEXT').setCheck(null).appendField('🖨️ コンソールに表示');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(160);
        },
    };
    Blockly.Python.forBlock['print_to_console'] = function (block) {
        const text = Blockly.Python.valueToCode(block, 'TEXT', Blockly.Python.ORDER_NONE) || '""';
        return `print(${text})\n`;
    };

    Blockly.Blocks['get_current_time'] = {
        init: function () {
            this.appendDummyInput().appendField('🕒 現在時刻 (文字列)');
            this.setOutput(true, 'String');
            this.setColour(260);
        },
    };
    Blockly.Python.forBlock['get_current_time'] = function (block) {
        return [`datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')`, Blockly.Python.ORDER_ATOMIC];
    };

    Blockly.Blocks['wait_seconds'] = {
        init: function () {
            this.appendValueInput('SECONDS').setCheck('Number').appendField('⏳');
            this.appendDummyInput().appendField('秒待つ');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(260);
        },
    };
    Blockly.Python.forBlock['wait_seconds'] = function (block) {
        const sec = Blockly.Python.valueToCode(block, 'SECONDS', Blockly.Python.ORDER_NONE) || '1';
        return `await asyncio.sleep(${sec})\n`;
    };

    Blockly.Python.forBlock['controls_if'] = function (block) {
        let code = '';
        let condition = Blockly.Python.valueToCode(block, 'IF0', Blockly.Python.ORDER_NONE) || 'False';
        let branchCode = getBranchCode(block, 'DO0');
        code += `if ${condition}:\n${branchCode}`;
        for (let i = 1; i <= block.elseifCount_; i++) {
            condition = Blockly.Python.valueToCode(block, 'IF' + i, Blockly.Python.ORDER_NONE) || 'False';
            branchCode = getBranchCode(block, 'DO' + i);
            code += `elif ${condition}:\n${branchCode}`;
        }
        if (block.elseCount_) {
            branchCode = getBranchCode(block, 'ELSE');
            code += `else:\n${branchCode}`;
        }
        return code;
    };

    Blockly.Python.forBlock['procedures_defnoreturn'] = Blockly.Python.forBlock['procedures_defreturn'] = function (block) {
        const funcName = Blockly.Python.nameDB_.getName(
            block.getFieldValue('NAME'),
            Blockly.Names.PROCEDURE_NAME,
        );
        const branch = getBranchCode(block, 'STACK');
        let args = [];
        for (let i = 0; i < block.arguments_.length; i++) {
            args.push(Blockly.Python.nameDB_.getName(block.arguments_[i], Blockly.Names.VARIABLE_NAME));
        }
        const argsString = args.join(', ');
        let returnValue = '';
        let returnCode = '';
        if (block.type === 'procedures_defreturn') {
            returnValue = Blockly.Python.valueToCode(block, 'RETURN', Blockly.Python.ORDER_NONE) || '';
            returnCode = `${Blockly.Python.INDENT}return ${returnValue}\n`;
        }
        return `\nasync def ${funcName}(${argsString}):\n${branch.trimEnd()}\n${returnCode.trimEnd()}\n`;
    };

    Blockly.Python.forBlock['procedures_callnoreturn'] = function (block) {
        const funcName = Blockly.Python.nameDB_.getName(
            block.getFieldValue('NAME'),
            Blockly.Names.PROCEDURE_NAME,
        );
        const args = [];
        for (let i = 0; i < block.arguments_.length; i++) {
            args.push(Blockly.Python.valueToCode(block, 'ARG' + i, Blockly.Python.ORDER_NONE) || 'None');
        }
        return `await ${funcName}(${args.join(', ')})\n`;
    };

    Blockly.Python.forBlock['procedures_callreturn'] = function (block) {
        const funcName = Blockly.Python.nameDB_.getName(
            block.getFieldValue('NAME'),
            Blockly.Names.PROCEDURE_NAME,
        );
        const args = [];
        for (let i = 0; i < block.arguments_.length; i++) {
            args.push(Blockly.Python.valueToCode(block, 'ARG' + i, Blockly.Python.ORDER_NONE) || 'None');
        }
        return [`await ${funcName}(${args.join(', ')})`, Blockly.Python.ORDER_FUNCTION_CALL];
    };

    Blockly.Blocks['uninstalled_block_placeholder'] = {
        init: function () {
            this.appendDummyInput()
                .appendField(new Blockly.FieldLabel('📦'), 'ICON')
                .appendField(new Blockly.FieldLabel(''), 'STATUS')
                .appendField(new Blockly.FieldLabel('不明なブロック'), 'NAME');
            this.appendDummyInput()
                .appendField('⚠️')
                .appendField(new Blockly.FieldLabel('プラグインが必要です'), 'PLUGIN');
            this.setColour('#e2e8f0');
            this.setTooltip('このブロックを使用するには、対象のプラグインをインストールして有効にしてください。');
            this.setEditable(false);
            this.setDeletable(false);
            this.setMovable(false);
            this.setInputsInline(false);
        }
    };

    if (Blockly?.Python) {
        Blockly.Python.INDENT = '    ';
        Blockly.Python.forBlock['uninstalled_block_placeholder'] = function (block) {
            return '';
        };
    }
}
