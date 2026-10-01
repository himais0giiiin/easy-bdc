# EDBP プラグイン仕様（互換リファレンス）

新しくプラグインを作る場合は、まず [Plugin API 2.0 開発者ガイド](./Plugin-API-2.0.md) を読んでください。

この文書は、既存のV1プラグインを保守するための互換仕様です。新規開発ではAPI 2.0を使用してください。

## ファイル構成

プラグインのZIPは、`manifest.json`と`plugin.js`をルートに含めます。

```text
plugin.zip
├─ manifest.json
└─ plugin.js
```

V1プラグインは`Plugin(workspace)`クラスを実装します。

```js
class Plugin {
  constructor(workspace) {
    this.workspace = workspace;
  }

  async onload() {}
  async onunload() {}
}
```

V1のグローバル登録は現在も読み込めますが、解除漏れや他プラグインとの衝突を起こしやすいため、変更時はV2へ移行してください。

## V1 manifest

```json
{
  "id": "legacy-plugin",
  "name": "Legacy Plugin",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "既存プラグインの例",
  "affectsStyle": false,
  "affectsBlocks": true,
  "minAppVersion": "1.1.0"
}
```

`minAppVersion`のruntime `1`（PHP）は廃止されています。PHPプラグイン、`Blockly.PHP`、`plugin.php`はサポートされません。

## V1からV2への対応表

| V1 | V2 |
| --- | --- |
| `constructor(workspace)` | `constructor(api)` |
| `Blockly.Blocks[type] = definition` | `api.blocks.register(type, definition, generator)` |
| `Blockly.Python.forBlock[type] = fn` | `api.codegen.register('Python', type, fn)` |
| `localStorage`を直接操作 | `api.settings.get/set/remove` |
| 手動でイベントを解除 | `api.on`の戻り値、または`api.use` |

詳細な移行手順は [Plugin API 2.0](./Plugin-API-2.0.md#4-移行ガイド) を参照してください。

## 関連文書

- [Plugin API 2.0 開発者ガイド](./Plugin-API-2.0.md)
- [プラグイン開発の入口](./Plugins.md)
- [プラグインREADMEテンプレート](./PluginREADME_Template.md)
