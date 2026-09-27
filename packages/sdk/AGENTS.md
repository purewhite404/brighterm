# Brighterm プラグイン作成ガイド (AGENTS.md)

あなたは Brighterm という、複数のアプリを1つのタイル型ウィンドウにまとめるアプリに
新しいタイル（プラグイン）を追加する仕事を任されています。このファイルはあなた
（AI）向けの唯一の仕様書です。ここに書かれていないことは推測せず、シンプルに倒し
てください。

## 対象範囲 — 必ず守ること

**作ってよいもの**: メモ、ToDo、フォトビューア、RSS/ニュースリーダー、家計簿、簡単
なダッシュボード、既存 Web サービスの埋め込み、フォーム、一覧管理、簡単なゲーム
（数独やパズルなど CPU 負荷が低いもの）。

**作ってはいけないもの**: 3D描画やWebGLを使うゲーム、動画編集、高フレームレートの
リアルタイム描画、重い計算処理。理由は、これらはブラウザのサンドボックス内では
性能が出ず、ネイティブアプリのほうが確実に良い体験になるためです。こうした依頼
を受けたときは、代わりに「そのアプリを起動するショートカットタイル」（kind: "web"
で `steam://`, `epic://` のようなカスタムプロトコルURL、または対応する公式サイト
のURL）を提案してください。

## 出力形式（最重要）

必ず **1つのコードブロック** の中に、以下の区切り記法で複数ファイルをまとめて
出力してください（「btbundle」形式と呼びます）。ファイルをアップロードできない
チャット環境でも、コピー&ペースト1回で全ファイルを渡せるようにするためです。

```
=== file: manifest.json ===
{
  "id": "photo-viewer",
  "name": "Photo Viewer",
  "version": "1.0.0",
  "icon": "image",
  "kind": "app",
  "entry": "index.html",
  "permissions": [{ "type": "folders" }],
  "description": "指定したフォルダの画像を一覧・拡大表示します。"
}
=== file: index.html ===
<!doctype html>
<html>
  ...
</html>
=== file: main.js ===
...
=== file: style.css ===
...
```

ルール:
- 区切り行は必ず `=== file: <相対パス> ===` の形式（前後の空白は無視されます）。
- `manifest.json` は必須で、必ず1番最初のファイルにしてください。
- ファイルパスは相対パスのみ。`../` や `/` から始まるパスは拒否されます。
- コードブロックの外に説明文を書いても構いませんが、コードブロックの中身以外は
  取り込み処理に無視されます。

## manifest.json の仕様

| フィールド | 必須 | 説明 |
|---|---|---|
| `id` | ✓ | 小文字とハイフンのみ（例: `photo-viewer`）。インストール先のフォルダ名になります |
| `name` | ✓ | 表示名 |
| `version` | ✓ | `1.0.0` のようなセマンティックバージョン |
| `icon` | ✓ | アイコン名（`note`, `image`, `list`, `chart` など一般的な英単語） |
| `kind` | ✓ | `"web"`（既存サイトの埋め込み）または `"app"`（自作のミニアプリ） |
| `url` | kind:"web" のとき必須 | 埋め込むページのURL |
| `entry` | kind:"app" のとき必須 | 起動する HTML ファイル名（通常 `index.html`） |
| `permissions` | - | 下記参照。宣言していない権限は実行時に使えません |
| `description` | - | 1〜2文の説明 |

### permissions の種類
- `{ "type": "network", "domains": ["api.example.com"] }` — この一覧のドメインにしか `fetch` できません
- `{ "type": "storage" }` — このプラグイン専用の KVS
- `{ "type": "folders" }` — ユーザーがフォルダピッカーで選んだフォルダだけ読み書きできます
- `{ "type": "notifications" }` — デスクトップ通知
- `{ "type": "hqCards" }` — 司令部(HQ)タイルにカードを出す

## kind: "app" のプラグインを書くときのルール

- `index.html` は依存パッケージを一切使わず、`<script src="main.js">` のような
  相対パスの読み込みだけにしてください（外部 CDN からの読み込みは禁止です。
  サンドボックスの CSP が外部スクリプトをブロックします）。
- `window.brighterm` というグローバルオブジェクトが Host API です。型定義は
  `host-api.d.ts` を参照してください。主なメソッド:
  - `window.brighterm.storage.get/set/remove/keys(...)`
  - `window.brighterm.fs.pickFolder() / listFiles() / readFile() / writeFile()`
  - `window.brighterm.net.fetch(url, init)` — manifest で宣言したドメインのみ
  - `window.brighterm.hq.publishCard({...}) / clearCard(id)`
  - `window.brighterm.notify(title, body)`
- デザインは `tokens.css`（同梱）の CSS カスタムプロパティ（`--bt-bg-1`,
  `--bt-text-primary`, `--bt-accent` など）を使ってください。独自の色やフォント
  を決め打ちしないでください。アプリ全体と統一感のある見た目にするためです。
- `eval`, `new Function`, `document.write`, インラインの `<script>` タグの中で
  の `fetch` の動的URL生成などは検証で弾かれることがあります。素直に書いてくだ
  さい。

## kind: "web" のプラグインを書くときのルール

- `manifest.json` だけで完結します（`url` と、必要なら `permissions` の
  `network` に埋め込み先のドメインを書いてください）。
- 未読バッジはページタイトルの変化から自動で表示されます。特別な実装は不要です。
- 現バージョンでは、バックグラウンドで API をポーリングして司令部(HQ)にカードを
  出す「connector」の仕組みは、任意コード実行の安全性を十分に検証できていない
  ため見送っています（今後追加予定）。HQ カードが必要な連携は、今のところ
  Brighterm 本体に内蔵の Google 連携のような形でのみ提供されます。

## 出力後にすること

1. 生成したコードブロックをそのままコピーして、Brighterm の「AI Builder」タイル
   に貼り付けてもらってください。
2. アプリ側が自動でチェックし、プレビューを見せ、必要な権限を確認してから
   インストールします。エラーが出た場合は、そのエラーメッセージがそのまま
   あなたに返されるので、該当ファイルだけを直して同じ形式で出力し直してください。
   manifest.json 含め全ファイルを毎回まとめて出力してください（差分ではなく
   全文で構いません）。
