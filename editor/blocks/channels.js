export function initChannels() {
    Blockly.Blocks['get_channel_info'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('📺 現在の')
                .appendField(
                    new Blockly.FieldDropdown([
                        ['チャンネルID', 'id'],
                        ['チャンネル名', 'name'],
                        ['メンション (<#ID>)', 'mention'],
                    ]),
                    'TYPE',
                );
            this.setOutput(true, 'String');
            this.setColour(260);
        },
    };
    Blockly.Python.forBlock['get_channel_info'] = function (block) {
        const type = block.getFieldValue('TYPE');
        let code = `ctx.channel.${type}`;
        return [
            `(${code} if "ctx" in locals() and hasattr(ctx, "channel") else "Unknown")`,
            Blockly.Python.ORDER_ATOMIC,
        ];
    };

    Blockly.Blocks['create_text_channel'] = {
        init: function () {
            this.appendValueInput('NAME').setCheck('String').appendField('📁 テキストチャンネル作成');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(340);
        },
    };
    Blockly.Python.forBlock['create_text_channel'] = function (block) {
        const name = Blockly.Python.valueToCode(block, 'NAME', Blockly.Python.ORDER_NONE) || '"new-channel"';
        return `\nif 'ctx' in locals() and ctx.guild:\n    await ctx.guild.create_text_channel(name=${name})\n`;
    };

    Blockly.Blocks['delete_channel'] = {
        init: function () {
            this.appendValueInput('CHANNEL_ID').setCheck('String').appendField('🗑️ チャンネル削除 (ID');
            this.appendDummyInput().appendField(')');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(340);
        },
    };
    Blockly.Python.forBlock['delete_channel'] = function (block) {
        const channelId = Blockly.Python.valueToCode(block, 'CHANNEL_ID', Blockly.Python.ORDER_NONE) || '0';
        return `\n_ch_id_val = ${channelId}\n_ch_id = int(_ch_id_val) if str(_ch_id_val).isdigit() else 0\n_ch = bot.get_channel(_ch_id)\nif _ch:\n    await _ch.delete()\n`;
    };

    Blockly.Blocks['get_server_info'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('🌐 サーバーの')
                .appendField(
                    new Blockly.FieldDropdown([
                        ['サーバーID', 'id'],
                        ['サーバー名', 'name'],
                        ['メンバー数', 'member_count'],
                    ]),
                    'TYPE',
                );
            this.setOutput(true, ['String', 'Number']);
            this.setColour(260);
        },
    };
    Blockly.Python.forBlock['get_server_info'] = function (block) {
        const type = block.getFieldValue('TYPE');
        let code = `ctx.guild.${type}`;
        return [
            `(${code} if "ctx" in locals() and hasattr(ctx, "guild") and ctx.guild else "Unknown")`,
            Blockly.Python.ORDER_ATOMIC,
        ];
    };

    Blockly.Blocks['create_role'] = {
        init: function () {
            this.appendValueInput('NAME').setCheck('String').appendField('🔰 新規ロール作成 (名前');
            this.appendDummyInput().appendField(')');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(0);
        },
    };
    Blockly.Python.forBlock['create_role'] = function (block) {
        const name = Blockly.Python.valueToCode(block, 'NAME', Blockly.Python.ORDER_NONE) || '"New Role"';
        return `\nif 'ctx' in locals() and ctx.guild:\n    await ctx.guild.create_role(name=${name})\n`;
    };

    Blockly.Blocks['set_bot_status'] = {
        init: function () {
            this.appendValueInput('STATUS').setCheck('String').appendField('🎮 ステータスを');
            this.appendDummyInput()
                .appendField(
                    new Blockly.FieldDropdown([
                        ['プレイ中', 'playing'],
                        ['視聴中', 'watching'],
                        ['再生中', 'listening'],
                    ]),
                    'TYPE',
                )
                .appendField('にする');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(260);
        },
    };
    Blockly.Python.forBlock['set_bot_status'] = function (block) {
        const status = Blockly.Python.valueToCode(block, 'STATUS', Blockly.Python.ORDER_NONE) || '"Bot"';
        const type = block.getFieldValue('TYPE');
        let activityCode = `discord.Game(name=${status})`;
        if (type === 'watching') activityCode = `discord.Activity(type=discord.ActivityType.watching, name=${status})`;
        if (type === 'listening') activityCode = `discord.Activity(type=discord.ActivityType.listening, name=${status})`;
        return `await bot.change_presence(activity=${activityCode})\n`;
    };

    Blockly.Blocks['join_voice_channel'] = {
        init: function () {
            this.appendDummyInput().appendField('🔊 実行者のボイスチャンネルに参加');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(340);
        },
    };
    Blockly.Python.forBlock['join_voice_channel'] = function (block) {
        return `\nif 'user' in locals() and user.voice:\n    await user.voice.channel.connect()\n`;
    };

    Blockly.Blocks['play_audio_file'] = {
        init: function () {
            this.appendValueInput('FILEPATH').setCheck('String').appendField('🔊 音楽ファイルを再生');
            this.appendDummyInput().appendField('(パス)');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(340);
            this.setTooltip('VC内で音楽を再生します。FFmpegが必要です。');
        },
    };
    Blockly.Python.forBlock['play_audio_file'] = function (block) {
        const path = Blockly.Python.valueToCode(block, 'FILEPATH', Blockly.Python.ORDER_NONE) || '""';
        return `\nif 'ctx' in locals() and getattr(ctx, 'guild', None) and getattr(ctx.guild, 'voice_client', None):\n    if not ctx.guild.voice_client.is_playing():\n        ctx.guild.voice_client.play(discord.FFmpegPCMAudio(${path}))\n`;
    };

    Blockly.Blocks['leave_voice_channel'] = {
        init: function () {
            this.appendDummyInput().appendField('🔇 ボイスチャンネルから切断');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(340);
        },
    };
    Blockly.Python.forBlock['leave_voice_channel'] = function (block) {
        return `\nif 'ctx' in locals() and getattr(ctx, 'guild', None) and getattr(ctx.guild, 'voice_client', None):\n    await ctx.guild.voice_client.disconnect()\n`;
    };
}
