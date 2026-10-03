import { useEffect, useState } from 'react'
import type { PluginInstallResult } from '@shared/apiTypes'
import { useAppStore } from '../../store/appStore'
import { CopyButton } from '../../ui/CopyButton'
import { pluginTile } from '../catalog'
import { EmbeddedWebView } from '../shared/EmbeddedWebView'
import { sidePaneId } from '../shared/subViews'
import { usePluginList } from '../shared/usePluginList'
import { AiKitSection } from './AiKitSection'
import { ApiAgentPanel } from './ApiAgentPanel'
import { InstalledPlugins } from './InstalledPlugins'
import { buildAddTilePrompt } from './promptBuilder'
import { ValidationResult } from './ValidationResult'
import './ai-builder.css'

/** How long typing/pasting in step 2 pauses before the code is checked. */
const CHECK_DELAY_MS = 400

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="bt-ai-builder__step" aria-label={`${n}. ${title}`}>
      <div className="bt-ai-builder__step-title">
        <span className="bt-ai-builder__step-number">{n}</span>
        {title}
      </div>
      {children}
    </section>
  )
}

function ScopeNote(): React.JSX.Element {
  return (
    <div className="bt-ai-builder__scope-note">
      対応範囲: メモ・フォト・ダッシュボード・Web サービスの埋め込みなど。ゲームや動画編集、3D 描画は
      ネイティブアプリのほうが向いているため対象外です（AI が代替案を提案します）。
    </div>
  )
}

export function AiBuilderTile({ tileId }: { tileId: string }): React.JSX.Element {
  const aiBuilder = useAppStore((s) => s.config?.aiBuilder)
  const updateConfig = useAppStore((s) => s.updateConfig)
  const addTile = useAppStore((s) => s.addTile)
  const plugins = usePluginList()
  const [request, setRequest] = useState('')
  const [bundleText, setBundleText] = useState('')
  const [validation, setValidation] = useState<PluginInstallResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [installResult, setInstallResult] = useState<PluginInstallResult | null>(null)
  const [busy, setBusy] = useState(false)

  const mode = aiBuilder?.mode ?? 'web-bridge'
  const chatUrl = aiBuilder?.webBridgeUrl ?? 'https://chatgpt.com/'

  const setMode = (next: 'web-bridge' | 'api-agent'): void => {
    if (!aiBuilder) return
    updateConfig({ aiBuilder: { ...aiBuilder, mode: next } })
  }

  // Step 3 checks whatever is in step 2, shortly after it stops changing.
  useEffect(() => {
    setInstallResult(null)
    if (!bundleText.trim()) {
      setValidation(null)
      setChecking(false)
      return
    }
    let stale = false
    setChecking(true)
    const timer = setTimeout(() => {
      void window.api.plugins.validateBundle(bundleText).then((result) => {
        if (stale) return
        setValidation(result)
        setChecking(false)
      })
    }, CHECK_DELAY_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [bundleText])

  const runInstall = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.api.plugins.installFromBundle(bundleText)
      setValidation(result)
      setInstallResult(result)
    } finally {
      setBusy(false)
    }
  }

  const installed = validation?.manifest ? plugins.find((p) => p.manifest.id === validation.manifest!.id) ?? null : null

  const modeToggle = (
    <div className="bt-ai-builder__row" style={{ padding: '8px 8px 0' }}>
      <button className={mode === 'web-bridge' ? 'bt-btn-primary' : ''} onClick={() => setMode('web-bridge')}>
        既定（ChatGPT・API キー不要）
      </button>
      <button className={mode === 'api-agent' ? 'bt-btn-primary' : ''} onClick={() => setMode('api-agent')}>
        API モード（全自動）
      </button>
    </div>
  )

  if (mode === 'api-agent') {
    return (
      <div className="bt-ai-builder" style={{ flexDirection: 'column' }}>
        {modeToggle}
        <div className="bt-ai-builder__panel">
          <ApiAgentPanel />
          <InstalledPlugins plugins={plugins} />
          <ScopeNote />
          <AiKitSection />
        </div>
      </div>
    )
  }

  return (
    <div className="bt-ai-builder" style={{ flexDirection: 'column' }}>
      {modeToggle}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div className="bt-ai-builder__chat">
          {/* A sub-view of this tile, destroyed along with it. */}
          <EmbeddedWebView viewId={sidePaneId(tileId, 'chat')} source={{ url: chatUrl, partitionId: 'ai-builder-chat' }} />
        </div>
        <div className="bt-ai-builder__panel">
          <Step n={1} title="作りたいものを説明する">
            <div className="bt-ai-builder__row">
              <input
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                placeholder="例: 写真フォルダを見るビューアを追加して"
              />
              <CopyButton getText={() => buildAddTilePrompt(request)} disabled={!request.trim()} label="依頼文をコピー" />
            </div>
            <div className="bt-ai-builder__hint">
              「依頼文をコピー」を押して、左のチャットに貼り付けて送信してください。依頼文には、Brighterm
              のプラグインの作り方（仕様書）が入っています。
            </div>
          </Step>

          <Step n={2} title="AI の返信を貼り付ける">
            <div className="bt-ai-builder__hint">
              返信の中の「=== file: manifest.json ===」から始まるコードブロックを、ブロック右上のコピーボタンでコピーして、ここに貼り付けます。
            </div>
            <textarea
              className="bt-ai-builder__textarea"
              value={bundleText}
              onChange={(e) => setBundleText(e.target.value)}
              placeholder="=== file: manifest.json ===&#10;..."
              aria-label="AI の返信"
              spellCheck={false}
            />
          </Step>

          <Step n={3} title="確認してインストール">
            {!bundleText.trim() ? (
              <div className="bt-ai-builder__hint">2 に貼り付けると、ここで自動的にチェックします。</div>
            ) : checking || !validation ? (
              <div className="bt-ai-builder__hint">チェックしています…</div>
            ) : (
              <>
                <ValidationResult result={validation} installed={installed} />
                {validation.ok && !installResult?.ok && (
                  <div>
                    <button className="bt-btn-primary" onClick={() => void runInstall()} disabled={busy}>
                      {installed ? '置き換えてインストール' : 'インストール'}
                    </button>
                  </div>
                )}
              </>
            )}
            {installResult?.ok && installResult.manifest && (
              <div className="bt-message" role="status">
                「{installResult.manifest.name}」をインストールしました。ドックにも追加されています。{' '}
                <button onClick={() => addTile(pluginTile({ manifest: installResult.manifest! }))}>今すぐ開く</button>
              </div>
            )}
          </Step>

          <InstalledPlugins plugins={plugins} />
          <ScopeNote />
          <AiKitSection />
        </div>
      </div>
    </div>
  )
}
