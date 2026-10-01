# EDBP Plugin API 2.0 開発者ガイド

このページは、初めてEDBPプラグインを作る人が、manifestの作成から公開まで迷わず進めるためのガイドです。API 2.0は、ブロックだけではなく、UI、設定、コマンド、イベント、コード生成、通信、共同制作を同じライフサイクルで拡張できます。

## 1. 最小構成

ZIPの直下に次の2ファイルを置きます。

```text
my-plugin.zip
├─ manifest.json
└─ plugin.js
```

`manifest.json`:

```json
{
  "id": "welcome-tools",
  "name": "Welcome Tools",
  "version": "1.0.0",
  "apiVersion": "2.0",
  "author": "Your Name",
  "description": "歓迎メッセージ用のブロックを追加します。",
  "minAppVersion": "1.1.0",
  "affectsStyle": false,
  "affectsBlocks": true,
  "permissions": ["workspace.read", "workspace.write"],
  "requiredPlugins": []
}
```

`plugin.js`:

```js
class Plugin {
  constructor(api) {
    this.api = api;
    api.blocks.register(
      'welcome_text',
      {
        init() {
          this.appendDummyInput().appendField('👋 歓迎メッセージ');
          this.setPreviousStatement(true);
          this.setNextStatement(true);
          this.setColour(160);
        }
      },
      () => 'print("Welcome!")\\n'
    );
    api.toolbox({
      kind: 'category', name: '✨ Welcome Tools', colour: 160,
      contents: [{ kind: 'block', type: 'welcome_text' }]
    });
  }

  async onload() { this.api.ui.toast('Welcome Tools を有効化しました'); }
  async onunload() {}
}
```

V2では、登録したイベント・ブロック・生成器・CSS・コマンドが無効化時に自動解除されます。`onunload`では外部リソースや自分で作ったタイマーだけを片付けてください。

## 2. manifestの項目

| 項目 | 必須 | 内容 |
| --- | --- | --- |
| `id` | 推奨 | 小文字英数字、`-`、`_`、`.`で構成する一意なID。未指定時はnameから生成。 |
| `name` | 必須 | 表示名。 |
| `version` | 必須 | `major.minor.patch`形式。 |
| `apiVersion` | V2では必須 | `2.0`または`2.0.0`。 |
| `author` | 必須 | 作者名または団体名。 |
| `description` | 任意 | マーケット一覧に表示する説明。 |
| `minAppVersion` | 任意 | 必要なEDBPのバージョン。 |
| `affectsBlocks` | 推奨 | Blocklyブロックを登録するなら`true`。 |
| `affectsStyle` | 推奨 | CSSやUIを追加するなら`true`。 |
| `permissions` | 任意 | 利用する権限の宣言。例：`workspace.write`, `network`, `collaboration`。 |
| `requiredPlugins` | 任意 | 先に有効化するプラグインIDの配列。循環依存は拒否される。 |
| `api` | 通信時必須 | `baseUrl`と追加の`origins`を指定。 |

インストール時にID、バージョン、依存関係、URL、権限を検証します。古いプラグインのID表記ゆれや壊れた保存データは、起動時に正規化されます。

## 3. APIリファレンス

### ライフサイクルとイベント

```js
api.on('workspace:change', event => {});
api.once('project:name', name => {});
api.emit('my-plugin:event', { value: 1 });
api.use(() => clearInterval(timer));
```

主なイベントは`workspace:change`、`storage:change`、`toolbox:add`、`toolbox:remove`、`project:name`です。プラグイン独自イベントはIDを付けて衝突を避けてください。

### ブロックとコード生成

```js
const dispose = api.blocks.register(type, definition, generator, {
  language: 'Python',
  override: false
});
api.codegen.register('Python', type, block => 'pass\\n');
api.blocks.unregister(type);
```

`Blockly.Python.forBlock`を直接変更せず、必ずAPI経由で登録してください。解除時に以前の生成器へ戻ります。

### ツールボックス

```js
api.toolbox({
  kind: 'category', name: 'My Blocks', colour: 200,
  contents: [{ kind: 'block', type: 'my_block' }]
});
```

BlocklyのJSON形式とXML形式の両方を扱います。ブロック登録より後に呼び出してください。

### UI

```js
api.ui.toast('保存しました', { type: 'success' });
const panel = api.ui.element('section', { class: 'my-panel' });
panel.textContent = '設定';
document.body.appendChild(panel);
api.ui.addStyle('.my-panel { padding: 1rem; }');
```

`element`で作成した要素は自動削除されます。`document.body.appendChild`など自分で行ったDOM操作は`onunload`で戻してください。

### 設定とワークスペース

```js
api.settings.set('channelId', '123');
const channelId = api.settings.get('channelId', '');
const json = api.project.export();
api.project.import(json);
api.workspaceApi.getSelected();
```

設定はプラグインIDごとに分離されます。別プラグインのキーを読み取ることはできません。

### コマンド

```js
api.command('reload', async () => {
  api.ui.toast('再読み込みしました');
}, { title: '再読み込み' });
await api.executeCommand('reload');
```

コマンドIDは全プラグインで共有されます。一般的な名前は避け、`pluginId:action`形式を推奨します。

### 外部通信

```json
"api": {
  "baseUrl": "https://api.example.com",
  "origins": ["https://cdn.example.com"]
}
```

```js
const response = await api.http.request('/settings');
const data = await response.json();
```

宣言されていないOriginへの通信は拒否されます。トークンやユーザー情報をログ・URL・共有データへ保存しないでください。

### 共同制作

```js
api.collaboration.on('message', payload => {});
api.collaboration.emit('message', { type: 'request', value: 1 });
```

共同制作で同期すべきデータは小さなJSONにし、受信側で必ず型・サイズを確認してください。認証情報やファイル全体をイベントに入れないでください。

## 4. 移行ガイド

V1の`constructor(workspace)`、`Blockly.Blocks[...]`、`Blockly.Python[...]`は動作します。新規コードでは次のように置き換えます。

| V1 | V2 |
| --- | --- |
| `constructor(workspace)` | `constructor(api)` |
| `Blockly.Blocks[type] = ...` | `api.blocks.register(type, ...)` |
| `Blockly.Python.forBlock[type] = ...` | `api.codegen.register('Python', type, fn)` |
| `localStorage.setItem(...)` | `api.settings.set(...)` |
| 手動のイベント解除 | `api.on(...)`の戻り値、または自動解除 |

段階移行中はmanifestの`apiVersion`を外せばV1としてロードできます。V2へ切り替える前に、ブロックIDの衝突と依存関係を確認してください。

## 5. デバッグと公開

1. 開発中は`api.log.debug()`を使い、プラグインID付きログを確認します。
2. 設定画面で無効化→再有効化を行い、ブロック・CSS・イベントが残っていないことを確認します。
3. `manifest.json`と`plugin.js`をZIP直下に置きます。
4. READMEに必要権限、外部通信先、追加ブロック、対応バージョンを明記します。
5. GitHubリポジトリには`edbp-plugin`トピックを付けます。

認識に失敗する場合は、プラグインID、manifestの検証エラー、依存関係の循環、未インストール依存を順に確認してください。EDBPのプラグイン診断APIでは、これらをまとめて取得できます。

```js
const diagnostics = pluginManager.getPluginDiagnostics();
console.table(diagnostics.invalid);
console.log(diagnostics.cycles, diagnostics.missingDependencies);
```
