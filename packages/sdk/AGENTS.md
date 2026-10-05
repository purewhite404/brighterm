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
  "version": "0.1.0",
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
| `version` | ✓ | `0.1.0` のようなセマンティックバージョン |
| `icon` | ✓ | アイコン名（`note`, `image`, `list`, `chart` など一般的な英単語） |
| `kind` | ✓ | `"web"`（既存サイトの埋め込み）または `"app"`（自作のミニアプリ） |
| `url` | kind:"web" のとき必須 | 埋め込むページのURL |
| `entry` | kind:"app" のとき必須 | 起動する HTML ファイル名（通常 `index.html`） |
| `permissions` | - | 下記参照。宣言していない権限は実行時に使えません |
| `description` | - | 1〜2文の説明 |

### permissions の種類
- `{ "type": "network", "domains": ["api.example.com"] }` — この一覧のドメインとだけ通信できます
  （天気・翻訳などの API や、そこの画像）。ほかのサイトへの通信は、`fetch` も画像も
  すべてブロックされます
- `{ "type": "storage" }` — このプラグイン専用の KVS
- `{ "type": "folders" }` — ユーザーがフォルダピッカーで選んだフォルダだけ読み書きできます
- `{ "type": "notifications" }` — デスクトップ通知
- `{ "type": "hqCards" }` — 司令部(HQ)タイルにカードを出す

## kind: "app" のプラグインを書くときのルール

- `index.html` は依存パッケージを一切使わず、`<script src="main.js">` のような
  相対パスの読み込みだけにしてください（外部 CDN からの読み込みは禁止です。
  サンドボックスの CSP が外部スクリプトをブロックします）。
- 外部の API は `window.brighterm.net.fetch(url, init)` で呼んでください（manifest の
  `network` に書いた https のドメインだけ）。ふつうの `fetch` は、相手が CORS を許可して
  いるときしか動きません。画像・動画は `network` に書いたドメインの https URL なら
  `<img src>` などにそのまま使えます。`<form>` の送信先に外部サイトは使えません
  （`submit` イベントで `preventDefault()` して、自分で処理してください）。
- `window.brighterm` というグローバルオブジェクトが Host API です。**関数の正確な
  引数と戻り値は、この仕様書の後ろに付いている `host-api.d.ts` のとおりにしてくだ
  さい。**そこにない関数は存在しません。主なもの:
  - `window.brighterm.storage.get/set/remove/keys(...)`
  - `window.brighterm.fs.pickFolder() / listFiles() / fileUrl() / readFile() / writeFile() / deleteFile() / copyPath()`
  - `window.brighterm.fs.showFolderBar(folder) / onFolderBarChange(cb)` — タイル上部のフォルダのパスバー
  - `window.brighterm.net.fetch(url, init)` — manifest で宣言したドメインのみ
  - `window.brighterm.hq.publishCard({...}) / clearCard(id)`
  - `window.brighterm.notify(title, body)`
- フォルダ内のファイルの扱い方（`folders` 権限）。`fs.*` の1つ目の引数は、いつも
  `pickFolder()` が返したオブジェクトそのものです（パス文字列ではありません）。
  2つ目はそのフォルダからの相対パスです。**画像・動画・音声・PDF は `readFile`
  では読めません。`fileUrl` で得た URL を `src` に入れて表示してください。**

  ```js
  async function openFolder() {
    const folder = await window.brighterm.fs.pickFolder() // キャンセルなら null
    if (!folder) return
    await window.brighterm.storage.set('folder', folder)  // 次回もこのフォルダを使う（storage 権限）
    const entries = await window.brighterm.fs.listFiles(folder) // [{ name, isDirectory, modifiedAt }]（modifiedAt は更新日時のミリ秒）
    for (const entry of entries) {
      if (entry.isDirectory || !/\.(jpe?g|png|gif|webp|bmp|avif)$/i.test(entry.name)) continue
      const img = document.createElement('img')
      img.loading = 'lazy'     // 見えるところまでスクロールしてから読み込む
      img.decoding = 'async'
      img.src = await window.brighterm.fs.fileUrl(folder, entry.name)
      gallery.append(img)
    }
    const text = await window.brighterm.fs.readFile(folder, 'memo.txt') // テキストファイルだけ
  }
  ```
- フォルダを切り替えて使うプラグインは、「フォルダを選ぶ」ボタンを自分で作るより、
  `fs.showFolderBar` を呼ぶのがおすすめです。タイルの上部に Brighterm がパスの入力欄
  (補完付き)を出し、ユーザーが別のフォルダを入力すると `onFolderBarChange` に許可済みの
  フォルダが届きます。パスの文字列はプラグインには渡りません(届くのはいつものフォルダ
  のオブジェクトです)。フォルダが変わったら、そのたびに `showFolderBar` を呼び直して
  ください。

  ```js
  async function start() {
    let folder = await window.brighterm.storage.get('folder')
    await window.brighterm.fs.showFolderBar(folder) // null なら空欄のバー(「上のバーに入力」と案内する)
    if (folder) await render(folder)
  }
  window.brighterm.fs.onFolderBarChange(async (folder) => {
    await window.brighterm.storage.set('folder', folder)
    await window.brighterm.fs.showFolderBar(folder)
    await render(folder)
  })
  ```
- デザインは `tokens.css`（同梱）の CSS カスタムプロパティ（`--bt-bg-1`,
  `--bt-text-primary`, `--bt-accent` など）を使ってください。独自の色やフォント
  を決め打ちしないでください。アプリ全体と統一感のある見た目にするためです。
- `eval`, `new Function`, `document.write`, インラインの `<script>` タグの中で
  の `fetch` の動的URL生成などは検証で弾かれることがあります。素直に書いてくだ
  さい。

### 軽く動かすためのルール（必ず守ること）

プラグインは、ターミナルやブラウザなどほかのタイルと同じパソコンの上で、一日中
開いたままにされます。見ていない間も CPU・メモリ・ディスクを使い続ける書き方は
しないでください。

- **保存はまとめる。** 入力のたびに `fs.writeFile` や `storage.set` を呼ばず、入力が
  止まってから 0.5〜1 秒後に1回だけ保存してください（下の例）。フォルダやファイルを
  切り替える直前には、待っている保存をすぐ実行してください（書きかけを失わないため）。

  ```js
  let saveTimer = null
  editor.addEventListener('input', () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(save, 700) // 打ち終わって 0.7 秒後に1回
  })
  async function flushSave() {        // 切り替えの前に呼ぶ
    if (!saveTimer) return
    clearTimeout(saveTimer)
    saveTimer = null
    await save()
  }
  ```
- **見張らない。** `setInterval` や `setTimeout` の繰り返しで、フォルダの中身や状態の
  変化を確かめ続けないでください。変化はイベント（`input`, `click`,
  `onFolderBarChange` など）で受け取り、フォルダの中身はユーザーが操作したとき
  （フォルダを開いた・更新ボタンを押した・ファイルを作った）にだけ読み直します。
- どうしても定期的な処理が要るとき（時計、外部 API の取得など）は、間隔を 1 秒以上
  （ネットワークは 1 分以上）にし、タイルが見えていない間（`document.hidden` が
  `true` の間）は止めてください。

  ```js
  let timer = null
  function syncTimer() {
    clearInterval(timer)
    timer = document.hidden ? null : setInterval(refresh, 60_000)
  }
  document.addEventListener('visibilitychange', syncTimer)
  syncTimer()
  ```
- `requestAnimationFrame` を回し続けないでください。動きは CSS のアニメーションや
  トランジションで付け、JavaScript で動かすのは動いている間だけにします。
- **画像は必要な分だけ。** `fileUrl` の URL を `<img loading="lazy" decoding="async">`
  で表示してください。数百枚を超えるフォルダでは、全部を一度に `<img>` にせず、見え
  ている範囲の分だけ作ってください（`IntersectionObserver` など）。CSS で小さく表示
  しても、画像は元の大きさのままメモリに展開されます。
- 一覧の表示を作り直すのは、中身が変わったときだけにしてください。検索欄の絞り込みは
  入力が止まってから（0.2〜0.3 秒）にし、たくさんの要素は `DocumentFragment` にまとめて
  一度に追加します。
- `storage` は設定や小さな状態（選んだフォルダ、並び順など）のためのものです。
  ファイルの中身のような大きなデータは入れないでください（`storage.set` のたびに保存
  領域全体が書き直されます）。大きなデータはフォルダのファイルに保存します。

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
2. アプリ側が自動でチェックし、使う権限をユーザーに見せてからインストールします。
   チェックで問題が見つかったときや、インストール後に動かしてエラーが出たときは、
   そのエラーメッセージがあなたに送られてきます。直した全ファイルを、manifest.json
   も含めて同じ形式でもう一度出力してください（差分ではなく全文）。`id` は変え
   ないでください。同じ `id` なら上書きでインストールされます。
