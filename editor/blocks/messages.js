export function initMessages() {
    Blockly.Blocks['get_message_content'] = {
        init: function () {
            this.appendDummyInput().appendField('受信したメッセージの内容');
            this.setOutput(true, 'String');
            this.setColour(30);
        },
    };
    Blockly.Python.forBlock['get_message_content'] = function (block) {
        return [
            '(ctx.content if "ctx" in locals() and hasattr(ctx, "content") else "")',
            Blockly.Python.ORDER_ATOMIC,
        ];
    };

    Blockly.Blocks['message_contains_text'] = {
        init: function () {
            this.appendValueInput('WORD').setCheck('String').appendField('メッセージの内容に');
            this.appendDummyInput().appendField('を含む');
            this.setInputsInline(true);
            this.setOutput(true, 'Boolean');
            this.setColour(30);
        },
    };
    Blockly.Python.forBlock['message_contains_text'] = function (block) {
        const word = Blockly.Python.valueToCode(block, 'WORD', Blockly.Python.ORDER_NONE) || '""';
        return [
            `(str(${word}).lower() in str(ctx.content).lower() if "ctx" in locals() and hasattr(ctx, "content") else False)`,
            Blockly.Python.ORDER_ATOMIC,
        ];
    };

    Blockly.Blocks['reply_message'] = {
        init: function () {
            this.appendValueInput('MESSAGE').setCheck(['String', 'Embed']).appendField('↩️ 返信する');
            this.appendDummyInput()
                .appendField('自分だけに表示')
                .appendField(new Blockly.FieldCheckbox('FALSE'), 'EPHEMERAL');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(160);
        },
    };
    Blockly.Python.forBlock['reply_message'] = function (block) {
        const msg = Blockly.Python.valueToCode(block, 'MESSAGE', Blockly.Python.ORDER_NONE) || '""';
        const ephemeral = block.getFieldValue('EPHEMERAL') === 'TRUE' ? 'True' : 'False';
        const targetBlock = block.getInputTargetBlock('MESSAGE');
        const isEmbed = targetBlock && targetBlock.outputConnection &&
            (Array.isArray(targetBlock.outputConnection.getCheck())
                ? targetBlock.outputConnection.getCheck().includes('Embed')
                : targetBlock.outputConnection.getCheck() === 'Embed');
        let contentCode = isEmbed ? `embed=${msg}` : `content=${msg}`;
        return `\nif 'ctx' in locals():\n    if isinstance(ctx, discord.Interaction):\n        if ctx.response.is_done():\n            await ctx.followup.send(${contentCode}, ephemeral=${ephemeral})\n        else:\n            await ctx.response.send_message(${contentCode}, ephemeral=${ephemeral})\n    elif isinstance(ctx, commands.Context):\n        await ctx.send(${contentCode})\n    elif isinstance(ctx, discord.Message):\n        await ctx.reply(${contentCode})\n`;
    };

    Blockly.Blocks['send_dm'] = {
        init: function () {
            this.appendValueInput('USER_ID').setCheck('String').appendField('📩 DMを送信 (ユーザーID');
            this.appendValueInput('MESSAGE').setCheck(['String', 'Embed']).appendField(') 内容');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(160);
        },
    };
    Blockly.Python.forBlock['send_dm'] = function (block) {
        const userId = Blockly.Python.valueToCode(block, 'USER_ID', Blockly.Python.ORDER_NONE) || '0';
        const msg = Blockly.Python.valueToCode(block, 'MESSAGE', Blockly.Python.ORDER_NONE) || '""';
        const targetBlock = block.getInputTargetBlock('MESSAGE');
        const isEmbed = targetBlock && targetBlock.outputConnection &&
            (Array.isArray(targetBlock.outputConnection.getCheck())
                ? targetBlock.outputConnection.getCheck().includes('Embed')
                : targetBlock.outputConnection.getCheck() === 'Embed');
        const contentCode = isEmbed ? `embed=${msg}` : `content=${msg}`;
        return `\n_u_dm = bot.get_user(int(${userId})) or await bot.fetch_user(int(${userId}))\nif _u_dm:\n    await _u_dm.send(${contentCode})\n`;
    };

    Blockly.Blocks['defer_reply'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('⏳ 応答を保留する (考え中...)')
                .appendField('自分だけ')
                .appendField(new Blockly.FieldCheckbox('FALSE'), 'EPHEMERAL');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(160);
        },
    };
    Blockly.Python.forBlock['defer_reply'] = function (block) {
        const ephemeral = block.getFieldValue('EPHEMERAL') === 'TRUE' ? 'True' : 'False';
        return `\nif 'ctx' in locals():\n    if isinstance(ctx, discord.Interaction):\n        await ctx.response.defer(ephemeral=${ephemeral})\n    elif isinstance(ctx, commands.Context):\n        async with ctx.typing(): pass\n`;
    };

    Blockly.Blocks['edit_reply'] = {
        init: function () {
            this.appendValueInput('MESSAGE').setCheck(['String', 'Embed']).appendField('✏️ 返信を編集する');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(160);
        },
    };
    Blockly.Python.forBlock['edit_reply'] = function (block) {
        const msg = Blockly.Python.valueToCode(block, 'MESSAGE', Blockly.Python.ORDER_NONE) || '""';
        const targetBlock = block.getInputTargetBlock('MESSAGE');
        const isEmbed = targetBlock && targetBlock.outputConnection &&
            (Array.isArray(targetBlock.outputConnection.getCheck())
                ? targetBlock.outputConnection.getCheck().includes('Embed')
                : targetBlock.outputConnection.getCheck() === 'Embed');
        let contentCode = isEmbed ? `embed=${msg}` : `content=${msg}`;
        return `\nif 'ctx' in locals() and isinstance(ctx, discord.Interaction):\n    await ctx.edit_original_response(${contentCode})\n`;
    };

    Blockly.Blocks['edit_message_by_id'] = {
        init: function () {
            this.appendValueInput('CHANNEL_ID').setCheck('String').appendField('✏️ 編集: チャンネルID');
            this.appendValueInput('MESSAGE_ID').setCheck('String').appendField('メッセージID');
            this.appendValueInput('CONTENT').setCheck('String').appendField('新しい内容');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(160);
        },
    };
    Blockly.Python.forBlock['edit_message_by_id'] = function (block) {
        const channelId = Blockly.Python.valueToCode(block, 'CHANNEL_ID', Blockly.Python.ORDER_NONE) || '0';
        const messageId = Blockly.Python.valueToCode(block, 'MESSAGE_ID', Blockly.Python.ORDER_NONE) || '0';
        const content = Blockly.Python.valueToCode(block, 'CONTENT', Blockly.Python.ORDER_NONE) || '""';
        return `\ntry:\n    _ch = bot.get_channel(int(${channelId}))\n    if _ch:\n        _msg = await _ch.fetch_message(int(${messageId}))\n        if _msg: await _msg.edit(content=${content})\nexcept Exception as e:\n    print(f"Edit Error: {e}")\n`;
    };

    Blockly.Blocks['send_channel_message'] = {
        init: function () {
            this.appendValueInput('CHANNEL_ID').setCheck('String').appendField('#️⃣ チャンネルID');
            this.appendValueInput('MESSAGE').setCheck(['String', 'Embed']).appendField('に送信');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(160);
        },
    };
    Blockly.Python.forBlock['send_channel_message'] = function (block) {
        const channelId = Blockly.Python.valueToCode(block, 'CHANNEL_ID', Blockly.Python.ORDER_NONE) || '0';
        const msg = Blockly.Python.valueToCode(block, 'MESSAGE', Blockly.Python.ORDER_NONE) || '""';
        const targetBlock = block.getInputTargetBlock('MESSAGE');
        const isEmbed = targetBlock && targetBlock.outputConnection &&
            (Array.isArray(targetBlock.outputConnection.getCheck())
                ? targetBlock.outputConnection.getCheck().includes('Embed')
                : targetBlock.outputConnection.getCheck() === 'Embed');
        const contentArg = isEmbed ? `embed=${msg}` : `content=${msg}`;
        return `\n_ch_id = int(${channelId}) if str(${channelId}).isdigit() else 0\n_channel = bot.get_channel(_ch_id)\nif _channel:\n    await _channel.send(${contentArg})\n`;
    };

    Blockly.Blocks['delete_message'] = {
        init: function () {
            this.appendDummyInput().appendField('🗑️ このメッセージを削除');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(160);
        },
    };
    Blockly.Python.forBlock['delete_message'] = function (block) {
        return `\nif 'ctx' in locals():\n    if isinstance(ctx, discord.Message):\n        await ctx.delete()\n    elif isinstance(ctx, commands.Context):\n        await ctx.message.delete()\n`;
    };

    Blockly.Blocks['purge_messages'] = {
        init: function () {
            this.appendValueInput('LIMIT').setCheck('Number').appendField('🗑️ メッセージを一括削除（');
            this.appendDummyInput().appendField('件）');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(160);
        },
    };
    Blockly.Python.forBlock['purge_messages'] = function (block) {
        const limit = Blockly.Python.valueToCode(block, 'LIMIT', Blockly.Python.ORDER_NONE) || '5';
        return `\nif 'ctx' in locals() and hasattr(ctx, 'channel') and hasattr(ctx.channel, 'purge'):\n    await ctx.channel.purge(limit=int(${limit}))\n`;
    };

    Blockly.Blocks['pin_message'] = {
        init: function () {
            this.appendDummyInput().appendField('📌 このメッセージをピン留め');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(160);
        },
    };
    Blockly.Python.forBlock['pin_message'] = function (block) {
        return `\nif 'ctx' in locals():\n    if isinstance(ctx, discord.Message):\n        await ctx.pin()\n    elif isinstance(ctx, commands.Context):\n        await ctx.message.pin()\n`;
    };

    Blockly.Blocks['add_reaction'] = {
        init: function () {
            this.appendValueInput('EMOJI').setCheck('String').appendField('👍 リアクションを付ける');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(160);
        },
    };
    Blockly.Python.forBlock['add_reaction'] = function (block) {
        const emoji = Blockly.Python.valueToCode(block, 'EMOJI', Blockly.Python.ORDER_NONE) || '"👍"';
        return `\ntry:\n    if 'ctx' in locals():\n        if isinstance(ctx, discord.Message): \n            await ctx.add_reaction(${emoji})\n        elif isinstance(ctx, commands.Context): \n            await ctx.message.add_reaction(${emoji})\nexcept Exception:\n    pass\n`;
    };

    Blockly.Blocks['create_thread'] = {
        init: function () {
            this.appendValueInput('NAME').setCheck('String').appendField('🧵 スレッドを作成（名前');
            this.appendDummyInput().appendField('）');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(160);
        },
    };
    Blockly.Python.forBlock['create_thread'] = function (block) {
        const name = Blockly.Python.valueToCode(block, 'NAME', Blockly.Python.ORDER_NONE) || '"New Thread"';
        return `\ntry:\n    if 'ctx' in locals():\n        if isinstance(ctx, discord.Message): \n            await ctx.create_thread(name=${name})\n        elif isinstance(ctx, commands.Context): \n            await ctx.message.create_thread(name=${name})\nexcept Exception:\n    pass\n`;
    };

    Blockly.Blocks['wait_for_message'] = {
        init: function () {
            this.appendValueInput('TIMEOUT').setCheck('Number').appendField('⏳ 返信を待つ (最大');
            this.appendDummyInput().appendField('秒)');
            this.setOutput(true, 'String');
            this.setColour(290);
        },
    };
    Blockly.Python.forBlock['wait_for_message'] = function (block) {
        const timeout = Blockly.Python.valueToCode(block, 'TIMEOUT', Blockly.Python.ORDER_NONE) || '30';
        const code = `(await bot.wait_for('message', check=lambda m: m.channel == ctx.channel and m.author == user, timeout=${timeout})).content`;
        return [code, Blockly.Python.ORDER_ATOMIC];
    };
}
