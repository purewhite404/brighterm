import { useEffect, useState } from 'react'
import type { SettingsShortcut } from '@shared/apiTypes'
import { Icon } from '../../ui/Icon'

/** Buttons that open the OS's own settings pages (Windows ms-settings:, macOS panes, Linux tools). */
export function OsShortcutList(): React.JSX.Element {
  const [shortcuts, setShortcuts] = useState<SettingsShortcut[]>([])

  useEffect(() => {
    void window.api.settings.getOsShortcuts().then(setShortcuts)
  }, [])

  return (
    <div className="bt-settings__grid">
      {shortcuts.map((s) => (
        <button key={s.id} className="bt-settings__shortcut" onClick={() => window.api.settings.openShortcut(s.id)}>
          <Icon name={s.icon} size={18} />
          <span>{s.label}</span>
        </button>
      ))}
    </div>
  )
}
