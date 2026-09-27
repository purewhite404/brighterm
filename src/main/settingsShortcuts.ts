import { platform } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { shell } from 'electron'

/** One clickable entry in the Settings tile's OS shortcut list. */
export interface SettingsShortcut {
  id: string
  label: string
  /** A `ms-settings:` URI, an `x-apple.systempreferences:` URI, or an argv-style shell command. */
  kind: 'uri' | 'command'
  target: string
  args?: string[]
}

const WINDOWS_SHORTCUTS: SettingsShortcut[] = [
  { id: 'system', label: 'System', kind: 'uri', target: 'ms-settings:about' },
  { id: 'network', label: 'Network & internet', kind: 'uri', target: 'ms-settings:network-status' },
  { id: 'bluetooth', label: 'Bluetooth & devices', kind: 'uri', target: 'ms-settings:bluetooth' },
  { id: 'display', label: 'Display', kind: 'uri', target: 'ms-settings:display' },
  { id: 'personalization', label: 'Personalization', kind: 'uri', target: 'ms-settings:personalization' },
  { id: 'apps', label: 'Apps', kind: 'uri', target: 'ms-settings:appsfeatures' },
  { id: 'accounts', label: 'Accounts', kind: 'uri', target: 'ms-settings:yourinfo' },
  { id: 'privacy', label: 'Privacy & security', kind: 'uri', target: 'ms-settings:privacy' },
  { id: 'windowsupdate', label: 'Windows Update', kind: 'uri', target: 'ms-settings:windowsupdate' }
]

const MACOS_SHORTCUTS: SettingsShortcut[] = [
  { id: 'general', label: 'General', kind: 'uri', target: 'x-apple.systempreferences:com.apple.preference.general' },
  { id: 'network', label: 'Network', kind: 'uri', target: 'x-apple.systempreferences:com.apple.preference.network' },
  {
    id: 'bluetooth',
    label: 'Bluetooth',
    kind: 'uri',
    target: 'x-apple.systempreferences:com.apple.preference.bluetooth'
  },
  {
    id: 'displays',
    label: 'Displays',
    kind: 'uri',
    target: 'x-apple.systempreferences:com.apple.preference.displays'
  },
  {
    id: 'security',
    label: 'Security & Privacy',
    kind: 'uri',
    target: 'x-apple.systempreferences:com.apple.preference.security'
  },
  {
    id: 'users',
    label: 'Users & Groups',
    kind: 'uri',
    target: 'x-apple.systempreferences:com.apple.preferences.users'
  },
  {
    id: 'software-update',
    label: 'Software Update',
    kind: 'uri',
    target: 'x-apple.systempreferences:com.apple.preferences.softwareupdate'
  }
]

function commandExists(cmd: string): boolean {
  try {
    const result = spawnSync(platform() === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' })
    return result.status === 0
  } catch {
    return false
  }
}

/** Which desktop-environment settings app is actually installed on this Linux box, if any. */
export function detectLinuxDesktopSettingsTool(): SettingsShortcut | null {
  if (commandExists('gnome-control-center')) {
    return { id: 'gnome', label: 'Settings (GNOME)', kind: 'command', target: 'gnome-control-center', args: [] }
  }
  if (commandExists('systemsettings')) {
    return { id: 'kde', label: 'System Settings (KDE)', kind: 'command', target: 'systemsettings', args: [] }
  }
  if (commandExists('xfce4-settings-manager')) {
    return {
      id: 'xfce',
      label: 'Settings Manager (Xfce)',
      kind: 'command',
      target: 'xfce4-settings-manager',
      args: []
    }
  }
  return null
}

export function getShortcutsForOs(): SettingsShortcut[] {
  switch (platform()) {
    case 'win32':
      return WINDOWS_SHORTCUTS
    case 'darwin':
      return MACOS_SHORTCUTS
    default: {
      const tool = detectLinuxDesktopSettingsTool()
      return tool ? [tool] : []
    }
  }
}

export function openShortcut(shortcut: SettingsShortcut): void {
  if (shortcut.kind === 'uri') {
    void shell.openExternal(shortcut.target)
  } else {
    // spawn (not spawnSync), detached + unref'd: launch the GUI settings app and don't wait on it.
    const child = spawn(shortcut.target, shortcut.args ?? [], { detached: true, stdio: 'ignore' })
    child.unref()
  }
}
