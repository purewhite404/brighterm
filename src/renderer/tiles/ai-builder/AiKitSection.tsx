import { useState } from 'react'

/** "上級者向け": the plugin spec as files, for building plugins with an AI tool outside Brighterm. */
export function AiKitSection(): React.JSX.Element {
  const [result, setResult] = useState<{ ok: boolean; text: string; path?: string } | null>(null)

  const run = async (): Promise<void> => {
    const r = await window.api.builder.exportKit()
    if (r.ok && r.path) setResult({ ok: true, text: `保存しました: ${r.path}`, path: r.path })
    else if (r.error) setResult({ ok: false, text: `保存できませんでした: ${r.error}` })
    else setResult(null) // the folder picker was cancelled
  }

  return (
    <details className="bt-ai-builder__advanced">
      <summary>上級者向け: 別の AI ツールでプラグインを作る</summary>
      <div className="bt-ai-builder__hint">
        Claude Code や Cursor など、パソコン上のファイルを読み書きできる AI
        ツールでプラグインを作るときに渡す資料一式（仕様書・関数の型定義・見本・デザイン定義）を、選んだフォルダに「brighterm-plugin-kit」として保存します。できあがったコードは、上の
        2 に貼り付けてインストールします。
      </div>
      <div className="bt-ai-builder__hint">
        上の 1〜3 の手順だけなら不要です（1 でコピーする依頼文に同じ内容が入っています）。
      </div>
      <div>
        <button onClick={() => void run()}>AI キットを書き出す</button>
      </div>
      {result && (
        <div className={result.ok ? 'bt-message' : 'bt-message bt-message--error'}>
          {result.text}
          {result.path && (
            <>
              {' '}
              <button onClick={() => void window.api.shells.openPath(result.path!)}>フォルダを開く</button>
            </>
          )}
        </div>
      )}
    </details>
  )
}
