import { getBranchCode } from './core.js';

const normalizePythonIdentifierName = (value, fallback = 'arg') => {
    const normalized = String(value ?? '')
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/^[0-9]/, '_$&');
    return normalized || fallback;
};

const normalizeSlashCommandName = (value, fallback = 'hello') => {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');
    return normalized || fallback;
};

const normalizeIntLiteral = (value) => {
    const normalized = String(value ?? '').trim();
    return /^-?\d+$/.test(normalized) ? normalized : '0';
};

const createCommandArgBlock = (label, colour) => ({
    init: function () {
        this.appendDummyInput()
            .appendField(label)
            .appendField('\u540d\u524d')
            .appendField(new Blockly.FieldTextInput('arg'), 'ARG_NAME')
            .appendField('\u8aac\u660e')
            .appendField(new Blockly.FieldTextInput(''), 'ARG_DESC')
            .appendField('\u5fc5\u9808')
            .appendField(new Blockly.FieldCheckbox('TRUE'), 'REQUIRED');
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour(colour);
    },
});
export function initCommands() {
    Blockly.Blocks['on_command_executed'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('⚡ スラッシュコマンド /')
                .appendField(new Blockly.FieldTextInput('hello'), 'COMMAND_NAME')
                .appendField('を使われたとき');
            this.appendStatementInput('DO').setCheck(null).appendField('実行する処理');
            this.setColour(230);
        },
    };
    Blockly.Python.forBlock['on_command_executed'] = function (block) {
        const rawName = block.getFieldValue('COMMAND_NAME') || 'hello';
        const commandName = rawName.toLowerCase();
        const safeCommandName = commandName.replace(/[^a-z0-9_]/g, '_').replace(/^[0-9]/, '_$&');
        const branch = getBranchCode(block, 'DO');
        return `\n@bot.tree.command(name=${JSON.stringify(commandName)}, description=${JSON.stringify(commandName + " command")})\nasync def ${safeCommandName}_cmd(interaction: discord.Interaction):\n    ctx = interaction\n    user = interaction.user\n${branch.trimEnd()}\n`;
    };

    Blockly.Blocks['prefix_command'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('🗣️ プレフィックスコマンド')
                .appendField(new Blockly.FieldTextInput('!ping'), 'COMMAND_NAME')
                .appendField('を実行したとき');
            this.appendStatementInput('DO').setCheck(null).appendField('実行する処理');
            this.setColour(230);
        },
    };
    Blockly.Python.forBlock['prefix_command'] = function (block) {
        const rawName = block.getFieldValue('COMMAND_NAME') || 'ping';
        const commandName = rawName.replace(/^[!~#&?]/, '');
        const safeCommandName = commandName.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[0-9]/, '_$&');
        const branch = getBranchCode(block, 'DO');
        return `\n@bot.command(name=${JSON.stringify(commandName)})\nasync def ${safeCommandName}_cmd(ctx):\n    user = ctx.author\n${branch.trimEnd()}\n`;
    };

    Blockly.Blocks['get_command_arg'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('コマンド引数')
                .appendField(new Blockly.FieldTextInput('name'), 'ARG_NAME')
                .appendField('の値');
            this.setOutput(true, ['String', 'Number']);
            this.setColour(230);
        },
    };
    Blockly.Python.forBlock['get_command_arg'] = function (block) {
        const argName = block.getFieldValue('ARG_NAME') || 'name';
        return [`"${argName}"`, Blockly.Python.ORDER_ATOMIC];
    };

    Blockly.Blocks['bc_slash_command'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('\u5f15\u6570\u4ed8\u304d\u30b9\u30e9\u30c3\u30b7\u30e5\u30b3\u30de\u30f3\u30c9 /')
                .appendField(new Blockly.FieldTextInput('hello'), 'NAME')
                .appendField('\u8aac\u660e')
                .appendField(new Blockly.FieldTextInput('\u30b3\u30de\u30f3\u30c9\u306e\u8aac\u660e'), 'DESC');
            this.appendStatementInput('ARGS').appendField('\u5f15\u6570');
            this.appendStatementInput('BODY').appendField('\u5b9f\u884c\u3059\u308b\u51e6\u7406');
            this.setColour(240);
        },
    };

    Blockly.Blocks['bc_str_arg'] = createCommandArgBlock('\u6587\u5b57\u5217\u5f15\u6570', 120);
    Blockly.Blocks['bc_int_arg'] = createCommandArgBlock('\u6574\u6570\u5f15\u6570', 120);
    Blockly.Blocks['bc_bool_arg'] = createCommandArgBlock('\u771f\u507d\u5024\u5f15\u6570', 120);
    Blockly.Blocks['bc_member_arg'] = createCommandArgBlock('\u30e1\u30f3\u30d0\u30fc\u5f15\u6570', 120);
    Blockly.Blocks['bc_channel_arg'] = createCommandArgBlock('\u30c6\u30ad\u30b9\u30c8\u30c1\u30e3\u30f3\u30cd\u30eb\u5f15\u6570', 120);
    Blockly.Blocks['bc_vchannel_arg'] = createCommandArgBlock('VC\u30c1\u30e3\u30f3\u30cd\u30eb\u5f15\u6570', 120);

    Blockly.Blocks['bc_choice_arg'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('\u9078\u629e\u80a2\u5f15\u6570')
                .appendField('\u540d\u524d')
                .appendField(new Blockly.FieldTextInput('choice'), 'ARG_NAME')
                .appendField('\u8aac\u660e')
                .appendField(new Blockly.FieldTextInput(''), 'ARG_DESC')
                .appendField('\u578b')
                .appendField(new Blockly.FieldDropdown([
                    ['\u6587\u5b57\u5217(str)', 'str'],
                    ['\u6574\u6570(int)', 'int'],
                ]), 'CHOICE_TYPE')
                .appendField('\u5fc5\u9808')
                .appendField(new Blockly.FieldCheckbox('TRUE'), 'REQUIRED');
            this.appendStatementInput('CHOICES').appendField('\u9078\u629e\u80a2');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(270);
        },
    };

    Blockly.Blocks['bc_choice_item'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('\u9078\u629e\u80a2\u9805\u76ee')
                .appendField('\u8868\u793a\u540d')
                .appendField(new Blockly.FieldTextInput('\u9078\u629e\u80a2A'), 'LABEL')
                .appendField('\u5024')
                .appendField(new Blockly.FieldTextInput('value_a'), 'VALUE');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(270);
        },
    };

    Blockly.Blocks['bc_get_arg'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('\u5f15\u6570')
                .appendField(new Blockly.FieldTextInput('arg'), 'ARG_NAME')
                .appendField('\u306e\u5024');
            this.setOutput(true, null);
            this.setColour(120);
        },
    };

    Blockly.Blocks['bc_get_choice_val'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('\u9078\u629e\u80a2\u5f15\u6570')
                .appendField(new Blockly.FieldTextInput('choice'), 'ARG_NAME')
                .appendField('\u306e\u5024');
            this.setOutput(true, null);
            this.setColour(270);
        },
    };

    Blockly.Python.forBlock['bc_slash_command'] = function (block) {
        const name = normalizeSlashCommandName(block.getFieldValue('NAME'));
        const safeFunctionName = normalizePythonIdentifierName(name, 'hello');
        const desc = block.getFieldValue('DESC') || name + ' command';
        const params = [];
        const describes = [];
        const choiceDecorators = [];

        let argBlock = block.getInputTargetBlock('ARGS');
        while (argBlock) {
            const argName = normalizePythonIdentifierName(argBlock.getFieldValue('ARG_NAME'));
            const argDesc = argBlock.getFieldValue('ARG_DESC') || argName;
            const required = (argBlock.getFieldValue('REQUIRED') ?? 'TRUE') === 'TRUE';
            const defaultSuffix = required ? '' : ' = None';

            describes.push(argName + '=' + JSON.stringify(argDesc));

            if (argBlock.type === 'bc_str_arg') {
                params.push(argName + ': str' + defaultSuffix);
            } else if (argBlock.type === 'bc_int_arg') {
                params.push(argName + ': int' + defaultSuffix);
            } else if (argBlock.type === 'bc_bool_arg') {
                params.push(argName + ': bool' + defaultSuffix);
            } else if (argBlock.type === 'bc_member_arg') {
                params.push(argName + ': discord.Member' + defaultSuffix);
            } else if (argBlock.type === 'bc_channel_arg') {
                params.push(argName + ': discord.TextChannel' + defaultSuffix);
            } else if (argBlock.type === 'bc_vchannel_arg') {
                params.push(argName + ': discord.VoiceChannel' + defaultSuffix);
            } else if (argBlock.type === 'bc_choice_arg') {
                const choiceType = argBlock.getFieldValue('CHOICE_TYPE') || 'str';
                const items = [];
                let itemBlock = argBlock.getInputTargetBlock('CHOICES');
                while (itemBlock) {
                    const label = itemBlock.getFieldValue('LABEL') || '\u9078\u629e\u80a2';
                    const rawValue = itemBlock.getFieldValue('VALUE') || 'value';
                    const value = choiceType === 'int' ? normalizeIntLiteral(rawValue) : JSON.stringify(rawValue);
                    items.push('app_commands.Choice(name=' + JSON.stringify(label) + ', value=' + value + ')');
                    itemBlock = itemBlock.getNextBlock();
                }
                if (items.length > 0) {
                    choiceDecorators.push('@app_commands.choices(' + argName + '=[' + items.join(', ') + '])');
                }
                params.push(argName + ': app_commands.Choice[' + choiceType + ']' + defaultSuffix);
            }

            argBlock = argBlock.getNextBlock();
        }

        const branch = getBranchCode(block, 'BODY');
        let code = '\n@bot.tree.command(name=' + JSON.stringify(name) + ', description=' + JSON.stringify(desc) + ')\n';
        if (describes.length > 0) {
            code += '@app_commands.describe(' + describes.join(', ') + ')\n';
        }
        choiceDecorators.forEach((decorator) => {
            code += decorator + '\n';
        });
        const signatureParams = ['interaction: discord.Interaction', ...params].join(', ');
        code += 'async def ' + safeFunctionName + '_cmd(' + signatureParams + '):\n';
        code += '    ctx = interaction\n';
        code += '    user = interaction.user\n';
        code += branch.trimEnd() + '\n';
        return code;
    };

    const noop = () => '';
    [
        'bc_str_arg',
        'bc_int_arg',
        'bc_bool_arg',
        'bc_member_arg',
        'bc_channel_arg',
        'bc_vchannel_arg',
        'bc_choice_arg',
        'bc_choice_item',
    ].forEach((type) => {
        Blockly.Python.forBlock[type] = noop;
    });

    Blockly.Python.forBlock['bc_get_arg'] = function (block) {
        const argName = normalizePythonIdentifierName(block.getFieldValue('ARG_NAME'));
        return [argName, Blockly.Python.ORDER_ATOMIC];
    };

    Blockly.Python.forBlock['bc_get_choice_val'] = function (block) {
        const argName = normalizePythonIdentifierName(block.getFieldValue('ARG_NAME'), 'choice');
        return [argName + '.value', Blockly.Python.ORDER_MEMBER];
    };

}
