# プラグイン開発の入口

EDBPのプラグインは、ブラウザ上で動くJavaScriptモジュールです。Blocklyのブロック、Pythonコード生成、UI、設定、コマンド、イベント、外部通信、共同制作を拡張できます。

## どの文書を読むか

| 目的 | 文書 |
| --- | --- |
| 初めて作る、APIを調べる | [Plugin API 2.0 開発者ガイド](./Plugin-API-2.0.md) |
| 既存V1プラグインを直す | [互換リファレンス](./Plugin.md) |
| 配布用READMEを書く | [READMEテンプレート](./PluginREADME_Template.md) |

## 最短ルート

1. `manifest.json`と`plugin.js`を作る。
2. manifestに`"apiVersion": "2.0"`を指定する。
3. `Plugin(api)`の中でAPIを使って登録する。
4. 無効化してもブロック、イベント、CSS、コマンドが残らないことを確認する。
5. 2ファイルをZIP直下に置き、READMEと一緒にGitHubへ公開する。

```js
class Plugin {
  constructor(api) {
    this.api = api;
    api.command('my-plugin:hello', () => api.ui.toast('Hello'));
  }

  async onload() {}
  async onunload() {}
}
```

## 対応ランタイム

プラグインランタイムはJavaScriptのみです。PHP runtime、`Blockly.PHP`、`plugin.php`は廃止されています。

プラグインから生成するBotコードの言語は、`api.codegen.register(language, type, handler)`で拡張できます。現在の標準出力はPythonです。

## 困ったとき

認識されない場合は、manifestのJSON、`id`、`version`、`apiVersion`、ZIPの階層を確認してください。依存関係の問題は、次の診断APIで確認できます。

```js
pluginManager.getPluginDiagnostics();
```
