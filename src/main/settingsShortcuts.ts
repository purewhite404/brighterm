import { platform } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { shell } from 'electron'
import type { SettingsShortcut } from '@shared/apiTypes'

const WINDOWS_SHORTCUTS: SettingsShortcut[] = [
  { id: 'system', label: 'System', icon: 'settings', kind: 'uri', target: 'ms-settings:about' },
  { id: 'network', label: 'Network & internet', icon: 'wifi', kind: 'uri', target: 'ms-settings:network-status' },
  { id: 'bluetooth', label: 'Bluetooth & devices', icon: 'bluetooth', kind: 'uri', target: 'ms-settings:bluetooth' },
  { id: 'display', label: 'Display', icon: 'monitor', kind: 'uri', target: 'ms-settings:display' },
  { id: 'personalization', label: 'Personalization', icon: 'palette', kind: 'uri', target: 'ms-settings:personalization' },
  { id: 'apps', label: 'Apps', icon: 'grid', kind: 'uri', target: 'ms-settings:appsfeatures' },
  { id: 'accounts', label: 'Accounts', icon: 'user', kind: 'uri', target: 'ms-settings:yourinfo' },
  { id: 'privacy', label: 'Privacy & security', icon: 'shield', kind: 'uri', target: 'ms-settings:privacy' },
  { id: 'windowsupdate', label: 'Windows Update', icon: 'download', kind: 'uri', target: 'ms-settings:windowsupdate' }
]

const MACOS_SHORTCUTS: SettingsShortcut[] = [
  { id: 'general', label: 'General', icon: 'settings', kind: 'uri', target: 'x-apple.systempreferences:com.apple.preference.general' },
  { id: 'network', label: 'Network', icon: 'wifi', kind: 'uri', target: 'x-apple.systempreferences:com.apple.preference.network' },
  {
    id: 'bluetooth',
    label: 'Bluetooth',
    icon: 'bluetooth',
    kind: 'uri',
    target: 'x-apple.systempreferences:com.apple.preference.bluetooth'
  },
  {
    id: 'displays',
    label: 'Displays',
    icon: 'monitor',
    kind: 'uri',
    target: 'x-apple.systempreferences:com.apple.preference.displays'
  },
  {
    id: 'security',
    label: 'Security & Privacy',
    icon: 'shield',
    kind: 'uri',
    target: 'x-apple.systempreferences:com.apple.preference.security'
  },
  {
    id: 'users',
    label: 'Users & Groups',
    icon: 'users',
    kind: 'uri',
    target: 'x-apple.systempreferences:com.apple.preferences.users'
  },
  {
    id: 'software-update',
    label: 'Software Update',
    icon: 'download',
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
    return { id: 'gnome', label: 'Settings (GNOME)', icon: 'settings', kind: 'command', target: 'gnome-control-center', args: [] }
  }
  if (commandExists('systemsettings')) {
    return { id: 'kde', label: 'System Settings (KDE)', icon: 'settings', kind: 'command', target: 'systemsettings', args: [] }
  }
  if (commandExists('xfce4-settings-manager')) {
    return {
      id: 'xfce',
      label: 'Settings Manager (Xfce)',
      icon: 'settings',
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
