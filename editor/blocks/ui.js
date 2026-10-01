import { getBranchCode } from './core.js';

export function initUI() {
    Blockly.Blocks['send_button_message'] = {
        init: function () {
            this.appendValueInput('MESSAGE').setCheck('String').appendField('🔘 ボタン付きメッセージ送信');
            this.appendDummyInput()
                .appendField('ボタン名')
                .appendField(new Blockly.FieldTextInput('Click Me'), 'LABEL');
            this.appendDummyInput()
                .appendField('ボタンID')
                .appendField(new Blockly.FieldTextInput('button_1'), 'CUSTOM_ID');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(350);
        },
    };
    Blockly.Python.forBlock['send_button_message'] = function (block) {
        const msg = Blockly.Python.valueToCode(block, 'MESSAGE', Blockly.Python.ORDER_NONE) || '""';
        // JSON.stringify で Python 文字列リテラルとしても安全な形にエスケープする
        const label = JSON.stringify(String(block.getFieldValue('LABEL') || ''));
        const customId = JSON.stringify(String(block.getFieldValue('CUSTOM_ID') || ''));
        return `\nview = discord.ui.View()\nview.add_item(discord.ui.Button(label=${label}, custom_id=${customId}))\nif 'ctx' in locals():\n    if isinstance(ctx, discord.Interaction):\n        await ctx.response.send_message(content=${msg}, view=view)\n    else:\n        await ctx.send(content=${msg}, view=view)\n`;
    };

    Blockly.Blocks['on_button_click'] = {
        init: function () {
            this.appendDummyInput().appendField('🖱️ ボタンがクリックされたとき');
            this.appendDummyInput()
                .appendField('ボタンID:')
                .appendField(new Blockly.FieldTextInput('button_1'), 'CUSTOM_ID');
            this.appendStatementInput('DO').setCheck(null).appendField('実行する処理');
            this.setColour(350);
        },
    };
    Blockly.Python.forBlock['on_button_click'] = function (block) {
        const customId = block.getFieldValue('CUSTOM_ID') || 'button';
        const safeCustomId = customId.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[0-9]/, '_$&');
        const branch = getBranchCode(block, 'DO');
        return `\n# BUTTON_EVENT:${customId}\nasync def on_button_${safeCustomId}(interaction):\n    ctx = interaction\n    user = interaction.user\n    await interaction.response.defer()\n${branch.trimEnd()}\n`;
    };

    Blockly.Blocks['show_modal'] = {
        init: function () {
            this.appendDummyInput().appendField('📝 モーダル(入力フォーム)を表示');
            this.appendDummyInput()
                .appendField('タイトル:')
                .appendField(new Blockly.FieldTextInput('My Form'), 'TITLE');
            this.appendDummyInput()
                .appendField('フォームID:')
                .appendField(new Blockly.FieldTextInput('modal_1'), 'CUSTOM_ID');
            this.appendDummyInput()
                .appendField('入力項目1:')
                .appendField(new Blockly.FieldTextInput('Name'), 'LABEL1');
            this.appendDummyInput()
                .appendField('入力項目2(任意):')
                .appendField(new Blockly.FieldTextInput(''), 'LABEL2');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(350);
        },
    };
    Blockly.Python.forBlock['show_modal'] = function (block) {
        // JSON.stringify で Python リテラルとしても安全な形にエスケープする
        const title = JSON.stringify(String(block.getFieldValue('TITLE') || ''));
        const customId = JSON.stringify(String(block.getFieldValue('CUSTOM_ID') || ''));
        const label1 = String(block.getFieldValue('LABEL1') || '');
        const label2 = String(block.getFieldValue('LABEL2') || '');
        const inputEntries = [{ label: label1, id: 'input_0' }];
        if (label2) inputEntries.push({ label: label2, id: 'input_1' });
        const inputs = JSON.stringify(inputEntries);
        return `\nif isinstance(ctx, discord.Interaction):\n    await ctx.response.send_modal(EasyModal(title=${title}, custom_id=${customId}, inputs=${inputs}))\n`;
    };

    Blockly.Blocks['on_modal_submit'] = {
        init: function () {
            this.appendDummyInput().appendField('📩 モーダルが送信されたとき');
            this.appendDummyInput()
                .appendField('フォームID:')
                .appendField(new Blockly.FieldTextInput('modal_1'), 'CUSTOM_ID');
            this.appendStatementInput('DO').setCheck(null).appendField('実行する処理');
            this.setColour(350);
        },
    };
    Blockly.Python.forBlock['on_modal_submit'] = function (block) {
        const customId = block.getFieldValue('CUSTOM_ID') || 'modal';
        const safeCustomId = customId.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[0-9]/, '_$&');
        const branch = getBranchCode(block, 'DO');
        return `\n# MODAL_EVENT:${customId}\nasync def on_modal_${safeCustomId}(interaction):\n    ctx = interaction\n    user = interaction.user\n    await interaction.response.defer()\n${branch.trimEnd()}\n`;
    };

    Blockly.Blocks['get_input_value'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('入力項目')
                .appendField(
                    new Blockly.FieldDropdown([
                        ['1つ目', '0'],
                        ['2つ目', '1'],
                    ]),
                    'INDEX',
                )
                .appendField('の値');
            this.setOutput(true, 'String');
            this.setColour(350);
        },
    };
    Blockly.Python.forBlock['get_input_value'] = function (block) {
        const idx = block.getFieldValue('INDEX');
        const code = `(lambda _c: _c[${idx}].get('value', '') if len(_c) > ${idx} else "")((interaction.data.get('components', [{}])[0].get('components', [])))`;
        return [code, Blockly.Python.ORDER_ATOMIC];
    };
}
