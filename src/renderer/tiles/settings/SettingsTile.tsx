import { useEffect, useState } from 'react'
import { AppPreferences } from './AppPreferences'
import { EtcEditor } from './EtcEditor'
import { OsShortcutList } from './OsShortcutList'

export function SettingsTile(): React.JSX.Element {
  const [hasDesktopTool, setHasDesktopTool] = useState<boolean | null>(null)
  const [etcSupported, setEtcSupported] = useState(false)
  const platform = window.api.platform

  useEffect(() => {
    if (platform === 'linux') {
      void window.api.settings.hasDesktopSettingsTool().then(setHasDesktopTool)
      void window.api.etc.isSupported().then(setEtcSupported)
    }
  }, [platform])

  const showEtcEditor = platform === 'linux' && hasDesktopTool === false && etcSupported

  return (
    <div className="bt-tile-body bt-settings">
      <AppPreferences />
      <div className="bt-etc__title" style={{ marginTop: 16 }}>
        {showEtcEditor ? 'システム設定ファイル' : 'OS の設定'}
      </div>
      {showEtcEditor ? <EtcEditor /> : <OsShortcutList />}
    </div>
  )
}
