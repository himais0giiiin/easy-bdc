export function initUsers() {
    Blockly.Blocks['get_user_info'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('👤 実行者(対象)の')
                .appendField(
                    new Blockly.FieldDropdown([
                        ['ユーザーID', 'id'],
                        ['名前 (ユーザー名)', 'name'],
                        ['表示名 (ニックネーム)', 'display_name'],
                        ['メンション (<@ID>)', 'mention'],
                    ]),
                    'TYPE',
                );
            this.setOutput(true, 'String');
            this.setColour(260);
        },
    };
    Blockly.Python.forBlock['get_user_info'] = function (block) {
        const type = block.getFieldValue('TYPE');
        let code = `user.${type}`;
        if (type === 'name') code = 'user.name';
        if (type === 'display_name') code = 'user.display_name';
        return [`(${code} if "user" in locals() else "Unknown")`, Blockly.Python.ORDER_ATOMIC];
    };

    Blockly.Blocks['get_member_detail'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('👤 実行者(対象)の詳細:')
                .appendField(
                    new Blockly.FieldDropdown([
                        ['アバターURL', 'avatar.url'],
                        ['アカウント作成日', 'created_at'],
                        ['サーバー参加日', 'joined_at'],
                        ['ステータス', 'status'],
                    ]),
                    'TYPE',
                );
            this.setOutput(true, 'String');
            this.setColour(260);
        },
    };
    Blockly.Python.forBlock['get_member_detail'] = function (block) {
        const type = block.getFieldValue('TYPE');
        let code = `user.${type}`;
        if (type === 'avatar.url') code = 'str(user.avatar.url) if user.avatar else ""';
        if (type === 'created_at') code = 'str(user.created_at.strftime("%Y-%m-%d %H:%M"))';
        if (type === 'joined_at')
            code = 'str(user.joined_at.strftime("%Y-%m-%d %H:%M")) if hasattr(user, "joined_at") else ""';
        if (type === 'status') code = 'str(user.status) if hasattr(user, "status") else "unknown"';
        return [`(${code} if "user" in locals() else "Unknown")`, Blockly.Python.ORDER_ATOMIC];
    };

    Blockly.Blocks['member_has_role'] = {
        init: function () {
            this.appendValueInput('USER').setCheck('String').appendField('❓ ユーザー');
            this.appendValueInput('ROLE_ID').setCheck('String').appendField('がロール(ID)');
            this.appendDummyInput().appendField('を持っている');
            this.setOutput(true, 'Boolean');
            this.setColour(260);
        },
    };
    Blockly.Python.forBlock['member_has_role'] = function (block) {
        const userCode = Blockly.Python.valueToCode(block, 'USER', Blockly.Python.ORDER_NONE) || '0';
        const roleId = Blockly.Python.valueToCode(block, 'ROLE_ID', Blockly.Python.ORDER_NONE) || '0';
        const code = `(discord.utils.get(ctx.guild.get_member(int(${userCode})).roles, id=int(${roleId})) is not None if ("ctx" in locals() and ctx.guild and str(${userCode}).isdigit() and str(${roleId}).isdigit() and ctx.guild.get_member(int(${userCode}))) else False)`;
        return [code, Blockly.Python.ORDER_ATOMIC];
    };

    Blockly.Blocks['kick_user'] = {
        init: function () {
            this.appendValueInput('USER_ID').setCheck('String').appendField('👢 Kickする (ID');
            this.appendValueInput('REASON').setCheck('String').appendField('理由');
            this.appendDummyInput().appendField(')');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(0);
        },
    };
    Blockly.Python.forBlock['kick_user'] = function (block) {
        const user = Blockly.Python.valueToCode(block, 'USER_ID', Blockly.Python.ORDER_NONE) || '0';
        const reason = Blockly.Python.valueToCode(block, 'REASON', Blockly.Python.ORDER_NONE) || 'None';
        return `\nif 'ctx' in locals() and ctx.guild and str(${user}).isdigit():\n    _m = ctx.guild.get_member(int(${user}))\n    if _m: await _m.kick(reason=${reason})\n`;
    };

    Blockly.Blocks['ban_user'] = {
        init: function () {
            this.appendValueInput('USER_ID').setCheck('String').appendField('🚫 BANする (ID');
            this.appendValueInput('REASON').setCheck('String').appendField('理由');
            this.appendDummyInput().appendField(')');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(0);
        },
    };
    Blockly.Python.forBlock['ban_user'] = function (block) {
        const user = Blockly.Python.valueToCode(block, 'USER_ID', Blockly.Python.ORDER_NONE) || '0';
        const reason = Blockly.Python.valueToCode(block, 'REASON', Blockly.Python.ORDER_NONE) || 'None';
        return `\nif 'ctx' in locals() and ctx.guild and str(${user}).isdigit():\n    _m = ctx.guild.get_member(int(${user}))\n    if _m: await _m.ban(reason=${reason})\n`;
    };

    Blockly.Blocks['timeout_user'] = {
        init: function () {
            this.appendValueInput('USER_ID').setCheck('String').appendField('🔇 タイムアウト (ID');
            this.appendValueInput('MINUTES').setCheck('Number').appendField('分');
            this.appendDummyInput().appendField('間)');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(0);
        },
    };
    Blockly.Python.forBlock['timeout_user'] = function (block) {
        const user = Blockly.Python.valueToCode(block, 'USER_ID', Blockly.Python.ORDER_NONE) || '0';
        const mins = Blockly.Python.valueToCode(block, 'MINUTES', Blockly.Python.ORDER_NONE) || '5';
        return `\nif 'ctx' in locals() and ctx.guild and str(${user}).isdigit() and str(${mins}).isdigit():\n    _m = ctx.guild.get_member(int(${user}))\n    if _m:\n        await _m.timeout(datetime.timedelta(minutes=int(${mins})))\n`;
    };

    Blockly.Blocks['add_user_role'] = {
        init: function () {
            this.appendValueInput('USER_ID').setCheck('String').appendField('➕ ロール付与 (ユーザーID');
            this.appendValueInput('ROLE_ID').setCheck('String').appendField('ロールID');
            this.appendDummyInput().appendField(')');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(0);
        },
    };
    Blockly.Python.forBlock['add_user_role'] = function (block) {
        const user = Blockly.Python.valueToCode(block, 'USER_ID', Blockly.Python.ORDER_NONE) || '0';
        const role = Blockly.Python.valueToCode(block, 'ROLE_ID', Blockly.Python.ORDER_NONE) || '0';
        return `\nif 'ctx' in locals() and ctx.guild and str(${user}).isdigit() and str(${role}).isdigit():\n    _m = ctx.guild.get_member(int(${user}))\n    _r = ctx.guild.get_role(int(${role}))\n    if _m and _r: await _m.add_roles(_r)\n`;
    };

    Blockly.Blocks['remove_user_role'] = {
        init: function () {
            this.appendValueInput('USER_ID').setCheck('String').appendField('➖ ロール剥奪 (ユーザーID');
            this.appendValueInput('ROLE_ID').setCheck('String').appendField('ロールID');
            this.appendDummyInput().appendField(')');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(0);
        },
    };
    Blockly.Python.forBlock['remove_user_role'] = function (block) {
        const user = Blockly.Python.valueToCode(block, 'USER_ID', Blockly.Python.ORDER_NONE) || '0';
        const role = Blockly.Python.valueToCode(block, 'ROLE_ID', Blockly.Python.ORDER_NONE) || '0';
        return `\nif 'ctx' in locals() and ctx.guild and str(${user}).isdigit() and str(${role}).isdigit():\n    _m = ctx.guild.get_member(int(${user}))\n    _r = ctx.guild.get_role(int(${role}))\n    if _m and _r: await _m.remove_roles(_r)\n`;
    };

    Blockly.Blocks['change_nickname'] = {
        init: function () {
            this.appendValueInput('USER_ID').setCheck('String').appendField('🏷️ ニックネーム変更 (ID');
            this.appendValueInput('NAME').setCheck('String').appendField('新しい名前');
            this.appendDummyInput().appendField(')');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour(0);
        },
    };
    Blockly.Python.forBlock['change_nickname'] = function (block) {
        const user = Blockly.Python.valueToCode(block, 'USER_ID', Blockly.Python.ORDER_NONE) || '0';
        const name = Blockly.Python.valueToCode(block, 'NAME', Blockly.Python.ORDER_NONE) || '"New Nick"';
        return `\nif 'ctx' in locals() and ctx.guild and str(${user}).isdigit():\n    _m = ctx.guild.get_member(int(${user}))\n    if _m: await _m.edit(nick=${name})\n`;
    };
}
