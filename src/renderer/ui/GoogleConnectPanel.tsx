import { useEffect, useState } from 'react'

/**
 * "Connect Google" card: collects the user's own OAuth client id/secret
 * (first time only) and runs the loopback OAuth flow. Renders nothing once
 * connected. Used by the HQ tile and the Calendar tile.
 */
export function GoogleConnectPanel({
  title = 'Google と連携（任意）',
  description = '次の予定と要対応メールをここに表示します。',
  onConnected
}: {
  title?: string
  description?: string
  onConnected?: () => void
}): React.JSX.Element | null {
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
      onConnected?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bt-card" style={{ cursor: 'default', flexDirection: 'column', gap: 8 }}>
      <div className="bt-card__title">{title}</div>
      <div className="bt-card__detail">
        {description}Google Cloud Console で「デスクトップアプリ」の
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

