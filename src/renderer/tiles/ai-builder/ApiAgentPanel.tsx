import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import type { AgentEvent } from '@shared/apiTypes'
import { Icon } from '../../ui/Icon'

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

/** "API モード": an agent in the main process (src/main/builder/) writes, validates and installs the plugin itself. */
export function ApiAgentPanel(): React.JSX.Element {
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

  useEffect(() => window.api.builder.onAgentEvent((e) => setEvents((prev) => [...prev, e])), [])

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
    <section className="bt-ai-builder__step" aria-label="API モード">
      {!supported && (
        <div className="bt-message bt-message--error">
          「{provider}」はまだ未対応です（OpenAI / OpenAI 互換のみ）。設定で切り替えてください。
        </div>
      )}
      {!hasKey && (
        <div>
          <div className="bt-section-title">API キー（{provider}）</div>
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
        <div className="bt-section-title">追加したいものを説明する</div>
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
    </section>
  )
}
