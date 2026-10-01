export function initEmbeds() {
    Blockly.Blocks['create_embed'] = {
        init: function () {
            this.appendDummyInput().appendField('✨ 新しい埋め込み(Embed)作成');
            this.appendStatementInput('PROPERTIES').setCheck(null);
            this.setOutput(true, 'Embed');
            this.setColour(100);
        },
    };
    Blockly.Python.forBlock['create_embed'] = function (block) {
        const embedVarName = Blockly.Python.nameDB_.getDistinctName('embed', Blockly.Names.VARIABLE_NAME);
        let code = `${embedVarName} = discord.Embed(title="No Title", description="...", color=0x3498DB)\n`;
        const propertiesCode = Blockly.Python.statementToCode(block, 'PROPERTIES');
        const lines = propertiesCode.split('\n');
        for (const line of lines) {
            if (!line.trim()) continue;
            if (line.includes('# EMBED_VAR_PLACEHOLDER')) {
                code += line.replace(/# EMBED_VAR_PLACEHOLDER/g, embedVarName) + '\n';
            } else if (line.trim().startsWith('embed.')) {
                code += line.replace(/embed\./g, `${embedVarName}.`) + '\n';
            }
        }
        return [`${code}${embedVarName}`, Blockly.Python.ORDER_ATOMIC];
    };

    Blockly.Blocks['set_embed_property'] = {
        init: function () {
            this.appendValueInput('VALUE')
                .setCheck(['String', 'Number'])
                .appendField('設定：')
                .appendField(
                    new Blockly.FieldDropdown([
                        ['タイトル', 'title'],
                        ['説明文', 'description'],
                        ['色 (0xHex)', 'color'],
                        ['画像URL', 'image'],
                    ]),
                    'PROPERTY',
                );
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(100);
        },
    };
    Blockly.Python.forBlock['set_embed_property'] = function (block) {
        const property = block.getFieldValue('PROPERTY');
        const value = Blockly.Python.valueToCode(block, 'VALUE', Blockly.Python.ORDER_NONE) || '""';
        if (property === 'color') return `embed.color = int(str(${value}), 0) if str(${value}).strip() else 0x3498DB\n`;
        if (property === 'image') return `embed.set_image(url=${value})\n`;
        if (property === 'title') return `embed.title = ${value}\n`;
        if (property === 'description') return `embed.description = ${value}\n`;
        return '';
    };

    Blockly.Blocks['add_embed_field'] = {
        init: function () {
            this.appendValueInput('NAME').setCheck('String').appendField('項目名');
            this.appendValueInput('VALUE').setCheck('String').appendField('内容');
            this.appendDummyInput()
                .appendField('横並び')
                .appendField(new Blockly.FieldCheckbox('TRUE'), 'INLINE');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(100);
        },
    };
    Blockly.Python.forBlock['add_embed_field'] = function (block) {
        const name = Blockly.Python.valueToCode(block, 'NAME', Blockly.Python.ORDER_NONE) || '"Name"';
        const value = Blockly.Python.valueToCode(block, 'VALUE', Blockly.Python.ORDER_NONE) || '"Value"';
        const inline = block.getFieldValue('INLINE') === 'TRUE' ? 'True' : 'False';
        return `# EMBED_VAR_PLACEHOLDER.add_field(name=${name}, value=${value}, inline=${inline})\n`;
    };
}
