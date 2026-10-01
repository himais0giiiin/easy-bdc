import { getBranchCode } from './core.js';

export function initEvents() {
    Blockly.Blocks['on_ready'] = {
        init: function () {
            this.appendDummyInput().appendField('🏁 Botが起動したとき');
            this.appendStatementInput('DO').setCheck(null).appendField('実行する処理');
            this.setColour(30);
            this.setTooltip('Botのログインが完了し、準備ができた時に1回だけ実行されます。');
        },
    };
    Blockly.Python.forBlock['on_ready'] = function (block) {
        const branch = getBranchCode(block, 'DO');
        return `\n@bot.event\nasync def on_ready():\n    print(f'Logged in as {bot.user}')\n    try:\n        synced = await bot.tree.sync()\n        print(f"Synced {len(synced)} command(s)")\n    except Exception as e:\n        print(e)\n${branch.trimEnd()}\n`;
    };

    Blockly.Blocks['on_message_create'] = {
        init: function () {
            this.appendDummyInput().appendField('📩 メッセージを受信したとき');
            this.appendStatementInput('DO').setCheck(null).appendField('実行する処理');
            this.setColour(30);
            this.setTooltip('誰かがメッセージを送信した時に実行されます。');
        },
    };
    Blockly.Python.forBlock['on_message_create'] = function (block) {
        const branch = getBranchCode(block, 'DO');
        return `\n@bot.event\nasync def on_message(message):\n    if message.author == bot.user:\n        return\n    ctx = message\n    user = message.author\n${branch.trimEnd()}\n    await bot.process_commands(message)\n`;
    };

    Blockly.Blocks['on_member_join'] = {
        init: function () {
            this.appendDummyInput().appendField('👤 メンバーが参加したとき');
            this.appendStatementInput('DO').setCheck(null).appendField('実行する処理');
            this.setColour(30);
            this.setTooltip('新しいメンバーがサーバーに参加した時に実行されます。');
        },
    };
    Blockly.Python.forBlock['on_member_join'] = function (block) {
        const branch = getBranchCode(block, 'DO');
        return `\n@bot.event\nasync def on_member_join(member):\n    user = member\n    ctx = member\n${branch.trimEnd()}\n`;
    };

    Blockly.Blocks['on_member_remove'] = {
        init: function () {
            this.appendDummyInput().appendField('👋 メンバーが退出したとき');
            this.appendStatementInput('DO').setCheck(null).appendField('実行する処理');
            this.setColour(30);
            this.setTooltip('メンバーがサーバーから退出（またはKick/Ban）された時に実行されます。');
        },
    };
    Blockly.Python.forBlock['on_member_remove'] = function (block) {
        const branch = getBranchCode(block, 'DO');
        return `\n@bot.event\nasync def on_member_remove(member):\n    user = member\n    ctx = member\n${branch.trimEnd()}\n`;
    };

    Blockly.Blocks['on_reaction_add'] = {
        init: function () {
            this.appendDummyInput().appendField('⭐ リアクションが付いたとき');
            this.appendDummyInput()
                .appendField('メッセージID(任意):')
                .appendField(new Blockly.FieldTextInput(''), 'MESSAGE_ID');
            this.appendDummyInput()
                .appendField('絵文字(任意):')
                .appendField(new Blockly.FieldTextInput(''), 'EMOJI');
            this.appendStatementInput('DO').setCheck(null).appendField('実行する処理');
            this.setColour(30);
        },
    };
    Blockly.Python.forBlock['on_reaction_add'] = function (block) {
        // JSON.stringify で Python 文字列リテラルとしても安全な形にエスケープする
        const msgId = JSON.stringify(String(block.getFieldValue('MESSAGE_ID') || '').trim());
        const emoji = JSON.stringify(String(block.getFieldValue('EMOJI') || '').trim());
        const branch = getBranchCode(block, 'DO');
        return `\n@bot.event\nasync def on_raw_reaction_add(payload):\n    if payload.user_id == bot.user.id:\n        return\n    if ${msgId} and str(payload.message_id) != ${msgId}:\n        return\n    if ${emoji} and str(payload.emoji) != ${emoji}:\n        return\n    channel = bot.get_channel(payload.channel_id) or await bot.fetch_channel(payload.channel_id)\n    if not channel:\n        return\n    message = await channel.fetch_message(payload.message_id)\n    user = payload.member or bot.get_user(payload.user_id)\n    ctx = message\n${branch.trimEnd()}\n`;
    };
}
