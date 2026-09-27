import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { buildAddTilePrompt, buildFixPrompt } from '../ai/promptBuilder'
import { CopyButton } from '../ui/CopyButton'
import type { PluginInstallResult } from '../../main/plugins/pluginHost'
import { Icon } from '../ui/Icon'
import { useEmbeddedWebView } from './useEmbeddedWebView'

/** The chat side: a sub-view of this tile ("<tileId>::chat"), destroyed along with it. */
function EmbeddedChat({ viewId, url }: { viewId: string; url: string }): React.JSX.Element {
  const snapshot = useAppStore((s) => s.runtime[viewId]?.snapshot)
  const ref = useEmbeddedWebView(viewId, { url, partitionId: 'ai-builder-chat' })
  return (
    <div ref={ref} className="bt-web-tile">
      {snapshot && <img src={snapshot} alt="" className="bt-web-tile__snapshot" draggable={false} />}
    </div>
  )
}

type AgentEvent =
  | { type: 'assistant-text'; text: string }
  | { type: 'tool-call'; name: string; arguments: unknown }
  | { type: 'tool-result'; name: string; result: unknown }
  | { type: 'error'; message: string }
  | { type: 'done' }

const TOOL_LABELS: Record<string, string> = {
  list_plugins: 'インストール済み一覧を確認',
  read_plugin: '既存プラグインを読み込み',
  write_staging_file: 'ファイルを作成',
  validate_staged_bundle: '検証',
  install_staged_bundle: 'インストール'
}

function AgentEventRow({ event }: { event: AgentEvent }): React.JSX.Element | null {
  switch (event.type) {
    case 'assistant-text':
      return <div className="bt-ai-builder__issue">{event.text}</div>
    case 'tool-call':
      return (
        <div className="bt-text-muted">
          <Icon name="refresh" size={12} /> {TOOL_LABELS[event.name] ?? event.name}
          {event.name === 'write_staging_file' && (event.arguments as { path?: string })?.path
            ? `: ${(event.arguments as { path?: string }).path}`
            : ''}
        </div>
      )
    case 'tool-result': {
      const result = event.result as { ok?: boolean; errors?: unknown[] } | undefined
      if (event.name === 'validate_staged_bundle' || event.name === 'install_staged_bundle') {
        const ok = result?.ok
        return (
          <div className={ok ? 'bt-ai-builder__issue' : 'bt-ai-builder__issue--error'}>
            <Icon name={ok ? 'check' : 'alert'} size={12} />{' '}
            {event.name === 'install_staged_bundle' ? 'インストール' : '検証'}
            {ok ? ': OK' : `: ${result?.errors?.length ?? 0} 件の問題`}
          </div>
        )
      }
      return null
    }
    case 'error':
      return (
        <div className="bt-ai-builder__issue--error">
          <Icon name="alert" size={12} /> {event.message}
        </div>
      )
    case 'done':
      return (
        <div className="bt-ai-builder__issue">
          <Icon name="check" size={12} /> 完了しました。
        </div>
      )
  }
}

function ApiAgentPanel(): React.JSX.Element {
  const config = useAppStore((s) => s.config)
  const provider = config?.aiBuilder.apiProvider ?? 'openai'
  const [request, setRequest] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [running, setRunning] = useState(false)

  useEffect(() => {
    void window.api.builder.hasApiKey(provider).then(setHasKey)
  }, [provider])

  useEffect(() => window.api.builder.onAgentEvent((e) => setEvents((prev) => [...prev, e as AgentEvent])), [])

  const saveKey = async (): Promise<void> => {
    if (!apiKey.trim()) return
    await window.api.builder.setApiKey(provider, apiKey.trim())
    setHasKey(true)
    setApiKey('')
  }

  const run = async (): Promise<void> => {
    if (!request.trim()) return
    setEvents([])
    setRunning(true)
    try {
      await window.api.builder.runAgent(request)
    } finally {
      setRunning(false)
    }
  }

  const supported = provider === 'openai' || provider === 'openai-compatible'

  return (
    <div className="bt-ai-builder__panel">
      {!supported && (
        <div className="bt-etc__validation bt-etc__validation--error">
          「{provider}」はまだ未対応です（OpenAI / OpenAI 互換のみ）。設定で切り替えてください。
        </div>
      )}
      {!hasKey && (
        <div>
          <div className="bt-etc__title">API キー（{provider}）</div>
          <div className="bt-ai-builder__row">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider === 'openai-compatible' ? '不要な場合は何か1文字入力' : 'sk-...'}
            />
            <button onClick={saveKey}>保存</button>
          </div>
        </div>
      )}
      <div>
        <div className="bt-etc__title">追加したいものを説明する</div>
        <div className="bt-ai-builder__row">
          <input
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="例: RSS を表示するタイルを追加して"
          />
          <button onClick={run} disabled={!supported || !hasKey || running || !request.trim()} className="bt-btn-primary">
            {running ? '実行中…' : '実行'}
          </button>
        </div>
      </div>
      <div className="bt-ai-builder__issues">
        {events.map((e, i) => (
          <AgentEventRow key={i} event={e} />
        ))}
      </div>
    </div>
  )
}

function IssueList({ result }: { result: PluginInstallResult }): React.JSX.Element {
  return (
    <div className="bt-ai-builder__issues">
      {result.errors.map((e, i) => (
        <div key={`e${i}`} className="bt-ai-builder__issue--error">
          <Icon name="alert" size={13} /> {e.file ? `${e.file}: ` : ''}
          {e.message}
        </div>
      ))}
      {result.warnings.map((w, i) => (
        <div key={`w${i}`} className="bt-ai-builder__issue--warning">
          <Icon name="alert" size={13} /> {w.file ? `${w.file}: ` : ''}
          {w.message}
        </div>
      ))}
      {result.ok && result.errors.length === 0 && result.warnings.length === 0 && (
        <div>
          <Icon name="check" size={13} /> 問題は見つかりませんでした。
        </div>
      )}
    </div>
  )
}

function ExportKitButton(): React.JSX.Element {
  const [message, setMessage] = useState<string | null>(null)
  const run = async (): Promise<void> => {
    const result = await window.api.builder.exportKit()
    setMessage(result.ok ? `書き出しました: ${result.path}` : null)
  }
  return (
    <div className="bt-ai-builder__scope-note">
      <button onClick={run}>
        <Icon name="copy" size={13} /> AI キットを書き出す（外部のチャット AI に渡す用）
      </button>
      {message && <div style={{ marginTop: 4 }}>{message}</div>}
    </div>
  )
}

export function AiBuilderTile({ tileId }: { tileId: string }): React.JSX.Element {
  const config = useAppStore((s) => s.config)
  const updateConfig = useAppStore((s) => s.updateConfig)
  const [request, setRequest] = useState('')
  const [bundleText, setBundleText] = useState('')
  const [validation, setValidation] = useState<PluginInstallResult | null>(null)
  const [installResult, setInstallResult] = useState<PluginInstallResult | null>(null)
  const [busy, setBusy] = useState(false)

  const mode = config?.aiBuilder.mode ?? 'web-bridge'
  const chatUrl = config?.aiBuilder.webBridgeUrl ?? 'https://chatgpt.com/'

  const setMode = (next: 'web-bridge' | 'api-agent'): void => {
    if (!config) return
    updateConfig({ aiBuilder: { ...config.aiBuilder, mode: next } })
  }

  const runValidate = async (): Promise<void> => {
    if (!bundleText.trim()) return
    setBusy(true)
    try {
      setValidation(await window.api.plugins.validateBundle(bundleText))
      setInstallResult(null)
    } finally {
      setBusy(false)
    }
  }

  const runInstall = async (): Promise<void> => {
    if (!bundleText.trim()) return
    setBusy(true)
    try {
      const result = await window.api.plugins.installFromBundle(bundleText)
      setInstallResult(result)
      setValidation(result)
    } finally {
      setBusy(false)
    }
  }

  const fixPromptText = (): string =>
    buildFixPrompt((validation?.errors ?? []).map((e) => (e.file ? `${e.file}: ${e.message}` : e.message)))

  const modeToggle = (
    <div className="bt-ai-builder__row" style={{ padding: '8px 8px 0' }}>
      <button
        className={mode === 'web-bridge' ? 'bt-btn-primary' : ''}
        onClick={() => setMode('web-bridge')}
      >
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
        <ApiAgentPanel />
        <ExportKitButton />
      </div>
    )
  }

  return (
    <div className="bt-ai-builder" style={{ flexDirection: 'column' }}>
      {modeToggle}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div className="bt-ai-builder__chat">
          <EmbeddedChat viewId={`${tileId}::chat`} url={chatUrl} />
        </div>
        <div className="bt-ai-builder__panel">
        <div>
          <div className="bt-etc__title">1. 追加したいものを説明する</div>
          <div className="bt-ai-builder__row">
            <input
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="例: 写真フォルダを見るビューアを追加して"
            />
            <CopyButton getText={() => buildAddTilePrompt(request)} disabled={!request.trim()} />
          </div>
          <div className="bt-ai-builder__scope-note">
            コピーした依頼文を左のチャットに貼り付けて送信してください。返ってきたコードブロックは下に貼り付けます。
          </div>
        </div>

        <div>
          <div className="bt-etc__title">2. AI の返信を貼り付ける</div>
          <textarea
            className="bt-ai-builder__textarea"
            value={bundleText}
            onChange={(e) => setBundleText(e.target.value)}
            placeholder="=== file: manifest.json ===&#10;..."
            spellCheck={false}
          />
          <div className="bt-ai-builder__row" style={{ marginTop: 8 }}>
            <button onClick={runValidate} disabled={busy || !bundleText.trim()}>
              検証
            </button>
            <button
              onClick={runInstall}
              disabled={busy || !bundleText.trim() || (validation !== null && !validation.ok)}
              className="bt-btn-primary"
            >
              インストール
            </button>
          </div>
        </div>

        {validation && (
          <div>
            <div className="bt-etc__title">結果</div>
            <IssueList result={validation} />
            {validation.errors.length > 0 && (
              <CopyButton getText={fixPromptText} label="修正依頼をコピー" style={{ marginTop: 8 }} />
            )}
          </div>
        )}

        {installResult?.ok && (
          <div className="bt-etc__validation">
            「{installResult.manifest?.name}」をインストールしました。ドックから起動できます。
          </div>
        )}

          <div className="bt-ai-builder__scope-note">
            対応範囲: メモ・フォト・ダッシュボード・Web サービスの埋め込みなど。ゲームや動画編集、3D 描画は
            ネイティブアプリのほうが向いているため対象外です（AI が代替案を提案します）。
          </div>
          <ExportKitButton />
        </div>
      </div>
    </div>
  )
}
