const text = value => ({ type: 'text', fields: { TEXT: value } });
const reply = value => ({ type: 'reply_message', inputs: { MESSAGE: { block: text(value) } } });
const command = (name, body, type = 'on_command_executed') => ({
  type, fields: { COMMAND_NAME: name }, inputs: { DO: { block: body } },
});

export const BOT_TEMPLATES = [
  {
    id: 'hello', title: 'あいさつBot', summary: '/hello に「こんにちは！」と返信します。',
    guide: 'Discordで /hello を実行します。返信ブロックの文章を自由に変更できます。',
    blocks: [command('hello', reply('こんにちは！'))],
  },
  {
    id: 'poll', title: 'リアクション投票Bot', summary: '!vote のメッセージに 👍 / 👎 を付けて投票できます。',
    guide: 'Message Content IntentをDeveloper Portalでも有効にしてください。!vote 質問文 を送信し、そのメッセージのリアクション数で結果を確認します。自動締切・一人一票の制御はありません。',
    blocks: [command('!vote', {
      ...reply('質問への投票は、!vote のメッセージに付いた 👍 / 👎 を押してください！'),
      next: { block: { type: 'add_reaction', inputs: { EMOJI: { block: text('👍') } },
        next: { block: { type: 'add_reaction', inputs: { EMOJI: { block: text('👎') } } } } } },
    }, 'prefix_command')],
  },
  {
    id: 'ticket', title: 'チケットBot', summary: '/ticket で本人・Bot・管理者向けの非公開チャンネルを作成します。',
    guide: 'Botに「チャンネルの管理」権限が必要です。同じユーザーの未完了チケットは再利用します。対応後は管理者がチャンネルを削除してください。非公開設定はPythonコード実行ブロックにまとめています。',
    blocks: [command('ticket', { type: 'custom_python_code', fields: { CODE: `if ctx.guild is None:
    await ctx.response.send_message('サーバー内で実行してください。', ephemeral=True)
elif not ctx.guild.me.guild_permissions.manage_channels:
    await ctx.response.send_message('Botに「チャンネルの管理」権限を付けてください。', ephemeral=True)
else:
    await ctx.response.defer(ephemeral=True)
    ticket_name = f'ticket-{ctx.user.id}'
    ticket = discord.utils.get(ctx.guild.text_channels, name=ticket_name)
    if ticket is None:
        overwrites = {
            ctx.guild.default_role: discord.PermissionOverwrite(view_channel=False),
            ctx.user: discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True),
            ctx.guild.me: discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True),
        }
        ticket = await ctx.guild.create_text_channel(ticket_name, overwrites=overwrites)
        await ticket.send('お問い合わせ内容を書いてください。管理者が対応します。')
    await ctx.followup.send(f'チケット: {ticket.mention}', ephemeral=True)` } })],
  },
  {
    id: 'embed', title: 'Embedお知らせBot', summary: '/info でタイトルと説明付きのお知らせを表示します。',
    guide: 'Embedのタイトル・説明文を編集して、Discordで /info を実行します。',
    blocks: [command('info', { type: 'reply_message', inputs: { MESSAGE: { block: {
      type: 'create_embed', inputs: { PROPERTIES: { block: {
        type: 'set_embed_property', fields: { PROPERTY: 'title' }, inputs: { VALUE: { block: text('お知らせ') } },
        next: { block: { type: 'set_embed_property', fields: { PROPERTY: 'description' }, inputs: { VALUE: { block: text('ここにお知らせの内容を書きます。') } } } },
      } } },
    } } } })],
  },
];

// Return an independent Blockly snapshot for each new project.
export function templateState(id) {
  const template = BOT_TEMPLATES.find(item => item.id === id);
  if (!template) throw new Error('テンプレートが見つかりません。');
  return JSON.stringify({ blocks: { languageVersion: 0, blocks: template.blocks.map((block, i) => ({ ...block, x: 40, y: 40 + i * 240 })) } });
}
