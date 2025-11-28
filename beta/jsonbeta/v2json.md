# v2 JSON 仕様 (block2ui)

EDBB のブロック UI を v2 レイアウトで記述する JSON スキーマのまとめです。対象ファイルは `beta/jsonbeta/block2ui.json` を想定しています。

## 全体構造
- 最上位はブロック名をキーにしたオブジェクト。各値がブロック定義 (schema)。
- v2 レイアウトとして扱うには、各ブロックに `"version": 2` を付ける。
- `title`: ブロック左上に表示する文字列 (絵文字も可)。省略可。
- `type`: `"statement"` または `"output"`。
- `color`: 数値 (HSV の H 相当)。
- `tooltip`: ホバー時に表示する説明。省略可。
- `previous` / `next`: statement ブロックの上下接続を許可するか。デフォルト true 相当。
- `output`: output ブロックの型 (`"String"` など文字列、配列、null を許容)。
- `statements`: ステートメント入力の名前配列 (例: `"DO"`)。
- `statementLabels`: ステートメント入力ごとのラベルマップ。キーは `statements` 内の名前。
- `dynamicItems`: true なら `ADD0..2` の ValueInput を自動生成 (最初のみラベル「項目」)。

## レイアウト (v2 専用)
- `fields`: ラベル/入力/値コネクタなどを並べる配列。
- `inputs`: 値コネクタ専用の省略形。内部で `{ kind: "value", ... }` として `fields` と結合される。
- `inline`: 配列。`fields`+`inputs` の順番を上書きしたいときに使う。`name` を文字列で参照するか、そのままアイテムオブジェクトを並べる。
- v2 では `setInputsInline(true)` を強制し、同じ行に並びます。行を切りたい場合は以下。

### アイテムの種類 (`fields` / `inline` 内)
- `kind: "label"`: `text` に表示文字列。
- `kind: "input"` または省略: `name` (Field 名)。`inputType` は `text` / `multiline_text` / `dropdown` / `checkbox`。`default` は初期値。`dropdown` は `options: [["表示", "値"], ...]`。`checkbox` は `label` と `default` ("TRUE" / "FALSE")。
- `kind: "value"`: 値入力。`name` 必須。`check` に型 (文字列 or 配列)。`label` を付けるとコネクタの左に表示。`align` で配置指定可。
- `kind: "\n"`: 明示的な改行トークン。
- どのアイテムでも `newline: true` を付けるとその要素の後で改行する。

## 改行の例
```json
{
  "version": 2,
  "type": "statement",
  "fields": [
    { "kind": "label", "text": "チャンネルID" },
    { "kind": "value", "name": "CHANNEL_ID", "check": "String", "newline": true },
    { "kind": "label", "text": "メッセージ" },
    { "kind": "value", "name": "MESSAGE", "check": ["String", "Embed"] }
  ],
  "previous": true,
  "next": true,
  "color": 160
}
```
- 行を分けずに並べたい場合は `newline` を外すか `"kind": "\n"` を挟まずに配置する。

## inline の例
```json
{
  "version": 2,
  "type": "output",
  "inline": ["TEXT", "FROM", "TO"],
  "fields": [
    { "kind": "label", "text": "テキスト" },
    { "name": "TEXT", "inputType": "text" },
    { "kind": "label", "text": "の中の" },
    { "name": "FROM", "inputType": "text" },
    { "kind": "label", "text": "を" },
    { "name": "TO", "inputType": "text" },
    { "kind": "label", "text": "に置換" }
  ],
  "output": "String",
  "color": 200
}
```
- `inline` が無い場合は `fields` → `inputs` の順で並ぶ。

## その他の挙動
- `title` がある場合、最上部にダミー入力として追加される。
- `tooltip` があれば Blockly の tooltip にセットされる。
- `type: "statement"` で `previous: false` や `next: false` を指定すると接続側を閉じられる。
