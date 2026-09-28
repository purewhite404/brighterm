import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { MAIL_PROVIDERS, SEARCH_ENGINES, type SearchEngineId, type WebTheme } from '@shared/types'

/** Brighterm's own preferences: which mail service the Mail tile opens, which search engine the Browser uses. */
export function AppPreferences(): React.JSX.Element | null {
  const config = useAppStore((s) => s.config)
  const updateConfig = useAppStore((s) => s.updateConfig)
  const [customUrl, setCustomUrl] = useState(config?.mail.customUrl ?? '')
  const [restartRequired, setRestartRequired] = useState(false)
  const [isPackaged, setIsPackaged] = useState(false)

  useEffect(() => {
    void window.api.app.restartRequired().then(setRestartRequired)
    void window.api.app.isPackaged().then(setIsPackaged)
  }, [])

  if (!config) return null

  return (
    <div className="bt-settings__prefs">
      <div className="bt-etc__title">Brighterm の設定</div>
      <label className="bt-settings__field">
        <span>メール</span>
        <select
          value={config.mail.provider}
          onChange={(e) => updateConfig({ mail: { ...config.mail, provider: e.target.value } })}
        >
          {MAIL_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">その他（URL を指定）</option>
        </select>
      </label>
      {config.mail.provider === 'custom' && (
        <label className="bt-settings__field">
          <span>メールの URL</span>
          <input
            value={customUrl}
            placeholder="https://mail.example.jp/"
            onChange={(e) => setCustomUrl(e.target.value)}
            onBlur={() => updateConfig({ mail: { ...config.mail, customUrl: customUrl.trim() } })}
          />
        </label>
      )}
      <label className="bt-settings__field">
        <span>検索エンジン</span>
        <select
          value={config.search.engine}
          onChange={(e) => updateConfig({ search: { ...config.search, engine: e.target.value as SearchEngineId } })}
        >
          {(Object.keys(SEARCH_ENGINES) as SearchEngineId[]).map((id) => (
            <option key={id} value={id}>
              {SEARCH_ENGINES[id].label}
            </option>
          ))}
        </select>
      </label>
      <label className="bt-settings__field">
        <span>Web ページの外観</span>
        <select
          value={config.appearance.webTheme}
          onChange={(e) => {
            updateConfig({ appearance: { webTheme: e.target.value as WebTheme } })
            // IPC is ordered, so main has the new value by the time this is answered.
            void window.api.app.restartRequired().then(setRestartRequired)
          }}
        >
          <option value="dark">ダーク（サイトが対応していれば）</option>
          <option value="force-dark">常にダーク（未対応のサイトも自動で暗く・再起動が必要）</option>
          <option value="system">OS の設定に合わせる</option>
          <option value="light">ライト</option>
        </select>
      </label>
      {restartRequired && (
        <div className="bt-settings__restart">
          この変更は再起動後に反映されます。
          {isPackaged ? (
            <button onClick={() => void window.api.app.relaunch()}>今すぐ再起動</button>
          ) : (
            <span>（開発モードでは <code>npm run dev</code> を起動し直してください）</span>
          )}
        </div>
      )}
      <div className="bt-text-muted" style={{ fontSize: 12 }}>
        カレンダーの Google 連携は、Calendar タイルの右上から設定できます。
      </div>
    </div>
  )
}
