# Brighterm — 自分一人の統合司令部

Terminal・Browser・Gmail・Google カレンダー・ファイル・システム監視・メモを、
1つのタイル型ウィンドウにまとめる Electron アプリです。使っていないタイルは
自動で休止してメモリを節約し、Google 連携で「次の予定」「要対応メール」を
司令部(HQ)ビューに集約します。

最大の特長は、**チャット AI に話しかけるだけで新しいタイル（プラグイン）を
安全に追加できる**ことです。既定では ChatGPT の Web 版（サインイン・API キー
不要）を使い、任意で OpenAI 等の API キーを使った全自動モードにも切り替えられ
ます。

Windows・macOS・Linux で動作します（Linux は検証環境がなく、コードレビューの
み。下記「既知の制約」を参照）。

## 開発を始める

```bash
npm install
npm run dev
```

初回の `npm install` 時、`node-pty` は各 OS 向けの N-API prebuild（事前ビルド
済みバイナリ）を使うため、C++ ビルドツールチェーンは不要です。

### よく使うコマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発モードで起動（ホットリロード） |
| `npm run test` | Vitest によるユニットテスト |
| `npm run typecheck` | main / preload / renderer の型チェック |
| `npm run build` | 型チェック + electron-vite のビルド |
| `npm run package` | `npm run build` + electron-builder でパッケージング（現在の OS 向け） |
| `npm run package:win` / `:mac` / `:linux` | 特定 OS 向けにパッケージング |

## アーキテクチャ

```
src/main/            … Electron メインプロセス(機能ごとのフォルダ。各フォルダの ipc.ts が IPC 窓口)
  index.ts             … 起動処理だけ(二重起動防止、各サービスの生成、IPC 登録、ループ開始)
  window.ts            … メインウィンドウ
  appIpc.ts            … 設定の読み書き・再起動・外部で開く
  configStore.ts       … userData/config.json の読み書き(デバウンス)
  views/               … Web/プラグインタイル用 WebContentsView の生成・配置・休止/復帰、メモリ集計
  terminal/            … ターミナル(node-pty)セッション、OS ごとのシェル検出
  files/               … ファイルツリー、ファイル読み書き・監視、内容からの種類判定
  sysmon/              … CPU/メモリ/プロセス一覧(systeminformation)、アプリのメモリ内訳
  settings/            … OS 設定へのショートカット、Linux 向け /etc エディタ(etc/)
                         (Augeas 連携・検証・pkexec・世代バックアップ)
  google/              … Google Calendar/Gmail 連携(OAuth・カード生成)
  plugins/             … プラグイン基盤(検証・インストール・サンドボックス実行)
  builder/             … AI Builder の API エージェントモード

src/preload/index.ts  … contextBridge 経由でレンダラーに公開する唯一の API
src/renderer/         … React 製 UI
  dock/ palette/ tiling/ store/ … ドック、コマンドパレット、タイリング、状態管理
  tiles/<タイル名>/    … 各タイルの画面と CSS(terminal, browser, mail, calendar, files,
                         sysmon, hq, ai-builder, settings, web, plugin)
  tiles/shared/        … タイル共通の部品(Web ビュー埋め込み、タイル設定の保存など)
  styles/app.css       … 外枠と複数タイル共通のスタイル
src/shared/           … 3プロセス共通
  types.ts             … タイル・レイアウト・設定の型
  ipc.ts / apiTypes.ts … IPC チャンネル名と、やり取りするデータの型
  presets.ts           … メール・検索エンジンの選択肢

packages/sdk/         … プラグイン開発者(と AI)向けの仕様
  AGENTS.md              … AI に渡す唯一の仕様書
  manifest.schema.ts      … manifest.json の zod スキーマ
  host-api.d.ts           … window.brighterm の型定義
  ui/tokens.css           … 全タイル共通のデザイントークン
  templates/              … 最小サンプル(web / app 各1)

plugins-builtin/      … 同梱プラグイン(起動時に自動インストール)
  notes/                 … 依存ゼロの軽量メモ帳(kind: app)
  slack/                 … Slack の Web 埋め込み(既定で無効。kind: web)
```

### タイルの3種類
- **内蔵タイル**: このアプリ自身が描画する画面(Terminal, HQ, FileTree, SysMon,
  AI Builder, Settings)。
- **Web タイル**: 既存サービスの Web 版を `WebContentsView` で埋め込んだもの
  (Mail, Calendar, Browser)。
- **プラグインタイル**: SDK 仕様に沿って追加された画面。`kind:"web"` は Web
  タイルと同じ仕組みで動き、`kind:"app"` はサンドボックス化した `<iframe>` の
  中で `plugin-app://` という専用プロトコル経由で動きます。

### メモリ節約の仕組み
非表示になって一定時間(既定10分、設定可)経ったタイルはスクリーンショットを
撮ってから `WebContents` を破棄します。セッションは `persist:` パーティション
なので、再表示時にログインし直す必要はありません。SysMon タイルでタイルごと
のメモリ使用量を確認できます。

## プラグイン(AI による機能追加)の仕組み

1. **検証パイプライン**: manifest.json のスキーマ検証 → 禁止パターン
   (`eval`, `require`, 未宣言ドメインへの通信など)の静的検査 → 権限一覧の
   提示、を経てからインストールされます。
2. **隔離**: `userData/plugins/<id>/<version>/` にバージョンごと保存されます。
   壊れたプラグインはそのタイルだけがエラー表示になり、他のタイルには影響しません。
3. **kind:"app" の実行環境**: `contextIsolation`・`sandbox` を効かせた
   `<iframe>` の中で動きます。`window.brighterm` という Host API だけを
   postMessage 経由で提供し、宣言された権限(`storage`/`folders`/`network`/
   `notifications`/`hqCards`)以外にはアクセスできません。

### AI Builder の2モード
- **既定: Web ブリッジモード**(ChatGPT・サインイン/API キー不要)
  タイル内に ChatGPT を埋め込み、次の3段階で進めます。
  1. 作りたいものを書いて「依頼文をコピー」→ 左のチャットに貼り付けて送信
     (依頼文には仕様書 AGENTS.md と Host API の型定義 host-api.d.ts が入っています)
  2. 返ってきたコードブロック(`=== file: ... ===` 区切りの「btbundle」形式)を貼り付け
  3. 自動でチェックされ、問題があれば日本語の説明と「修正依頼をコピー」、
     なければ「このプラグインが使う機能」を確認して「インストール」
  インストール後に動かしてエラーが出たときは、そのタイルの上部に理由と
  「修正依頼をコピー」が出ます。直ったコードを 2 に貼り付けて同じ id で
  入れ直すと、開いているタイルも新しいコードで読み込み直されます。
  インストール済みのプラグインは AI Builder の一覧から無効化・削除できます
  (同梱の Notes / Slack は無効化のみ)。
- **任意: API エージェントモード**(全自動、要 API キー)
  OpenAI / OpenAI 互換(Ollama など)の API キーを設定すると、AI がツール
  (`write_staging_file` → `validate_staged_bundle` → `install_staged_bundle`)
  を自分で呼び出し、確認なしで最後まで実行します。Anthropic / Gemini は
  型は用意済みですが未実装です(選ぶとその旨のエラーが表示されます)。
- どちらのモードでも、`packages/sdk/AGENTS.md` が唯一の仕様書です。
  「上級者向け」の「AI キットを書き出す」は、この仕様一式(型定義・見本を含む)
  をフォルダに保存します。Claude Code や Cursor などファイルを扱える AI ツールで
  Brighterm の外でプラグインを作るとき用で、上の 1〜3 の手順では不要です。

## Google 連携(HQ カード)のセットアップ

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを
   作成し、「OAuth 同意画面」を設定します(テストユーザーに自分を追加すれば
   十分です)。
2. 「認証情報」から OAuth クライアント ID を作成し、アプリケーションの種類は
   **デスクトップアプリ** を選びます。
3. Google Calendar API と Gmail API を有効にします。
4. HQ タイルの「Google と連携」から、発行された Client ID / Client Secret を
   入力して「接続する」を押します。ブラウザが開くので Google アカウントで
   許可してください。
5. 以後、次の予定と要対応メール(`is:unread is:important newer_than:2d`)が
   自動でカードとして表示されます(5分ごとに更新)。

Client ID/Secret と refresh token は `safeStorage`(Windows: DPAPI, macOS:
Keychain, Linux: libsecret)で暗号化して保存されます。

## 既知の制約・今後の課題

- **Linux 固有の機能は検証環境がありません。** `/etc` エディタ(Augeas・
  pkexec 連携)と、Linux 版デスクトップ設定ツールの検出は、実機(または
  VM/WSL)での動作確認をお願いします。
- **Google 連携・API エージェントモードは実際の認証情報で検証していません。**
  ドキュメント通りの実装ですが、実際の Google アカウント/OpenAI API キーが
  ない環境で書かれたため、初回セットアップで想定外の挙動が出た場合は
  issue 等でお知らせください。
- **プラグインのバックグラウンド連携(`connector.js`)は見送りました。**
  AGENTS.md にあった「Web プラグインが自前でバックグラウンドポーリングし
  HQ カードを出す」仕組みは、任意コード実行の安全性を十分検証できないため
  実装していません。Slack のカード連携が欲しい場合は、Google 連携と同じ形
  (`src/main/google/`)で個別に実装するのが安全です。
- **electron-builder 用のアイコンが未設定です。** `resources/` に実際の
  `.ico`/`.icns`/`.png` を置き、`electron-builder.yml` の該当行を有効化して
  ください。
- macOS 配布には Apple Developer 登録・コード署名・公証が必要です。現状は
  未署名ビルドの前提です。
- チャンクサイズの最適化(コード分割)は未着手です(`out/renderer/assets/*.js`
  が単一の ~1MB バンドル)。

## テスト

```bash
npm run test        # ユニットテスト(main プロセスのロジック全般)
npm run test:e2e     # Playwright による最小限の起動確認
```

ユニットテストは、レイアウトエンジン・プラグインの検証パイプライン・
manifest スキーマ・Augeas 出力パーサ・diff・履歴管理・Google 連携のカード
変換・エージェントツールなど、OS 非依存のロジックを広くカバーしています。
`pkexec`/`augtool`/実際の OAuth フローなど、外部プロセスや実際の認証情報を
要する部分は、実装レビュー済みですがこの環境では実行検証できていません
(各ファイルの冒頭コメントに明記しています)。
