import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { Icon } from '../ui/Icon'
import type { Card } from '@shared/types'

function priorityIcon(priority: Card['priority']): string {
  return priority === 'urgent' || priority === 'high' ? 'alert' : 'command'
}

function CardRow({ card }: { card: Card }): React.JSX.Element {
  const addTile = useAppStore((s) => s.addTile)

  const handleClick = (): void => {
    if (card.action?.url) {
      void window.api.shells.openExternal(card.action.url)
      return
    }
    if (card.action?.openTileTypeId) {
      addTile({
        kind: 'builtin',
        typeId: card.action.openTileTypeId,
        title: card.action.label,
        icon: 'command'
      })
    }
  }

  return (
    <button
      className={`bt-card bt-card--${card.priority}`}
      onClick={handleClick}
      disabled={!card.action}
    >
      <Icon name={priorityIcon(card.priority)} size={16} className="bt-card__icon" />
      <div className="bt-card__body">
        <div className="bt-card__title">{card.title}</div>
        {card.detail && <div className="bt-card__detail">{card.detail}</div>}
        <div className="bt-card__source">{card.source}</div>
      </div>
      {card.action && <span className="bt-card__action">{card.action.label}</span>}
    </button>
  )
}

function GoogleConnectPanel(): React.JSX.Element | null {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [hasCreds, setHasCreds] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    setConnected(await window.api.google.isConnected())
    setHasCreds(await window.api.google.hasClientCredentials())
  }

  useEffect(() => {
    void refresh()
  }, [])

  if (connected === null) return null
  if (connected) return null // no UI needed once connected — cards just start flowing

  const saveCredsAndConnect = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (clientId.trim() && clientSecret.trim()) {
        await window.api.google.setClientCredentials(clientId.trim(), clientSecret.trim())
      }
      await window.api.google.connect()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bt-card" style={{ cursor: 'default', flexDirection: 'column', gap: 8 }}>
      <div className="bt-card__title">Google と連携（任意）</div>
      <div className="bt-card__detail">
        次の予定と要対応メールをここに表示します。Google Cloud Console で「デスクトップアプリ」の
        OAuth クライアントを作成し、Client ID と Client Secret を入力してください。
      </div>
      {!hasCreds && (
        <>
          <input
            placeholder="Client ID"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            style={{ padding: 6 }}
          />
          <input
            placeholder="Client Secret"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            style={{ padding: 6 }}
          />
        </>
      )}
      <button onClick={saveCredsAndConnect} disabled={busy} style={{ alignSelf: 'flex-start' }}>
        接続する（ブラウザが開きます）
      </button>
      {error && <div className="bt-etc__validation bt-etc__validation--error">{error}</div>}
    </div>
  )
}

export function HqTile(): React.JSX.Element {
  const cards = useAppStore((s) => s.hqCards)

  return (
    <div className="bt-tile-body bt-hq">
      <div className="bt-hq__header">
        <Icon name="command" size={18} />
        <span>司令部</span>
      </div>
      <GoogleConnectPanel />
      {cards.length === 0 ? (
        <div className="bt-tile-body--centered bt-text-muted">
          今のところ対応が必要なものはありません。
          <br />
          Google カレンダーや Slack プラグインを設定すると、ここにカードが並びます。
        </div>
      ) : (
        <div className="bt-hq__list">
          {cards.map((card) => (
            <CardRow key={card.id} card={card} />
          ))}
        </div>
      )}
    </div>
  )
}
