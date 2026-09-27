import type { BuiltinTileType, TileInstance } from '@shared/types'
import { TerminalTile } from './TerminalTile'
import { WebTile } from './WebTile'
import { FileExplorerTile } from './FileExplorerTile'
import { SysMonTile } from './SysMonTile'
import { HqTile } from './HqTile'
import { AiBuilderTile } from './AiBuilderTile'
import { SettingsTile } from './SettingsTile'
import { PluginFrame } from './PluginFrame'
import { MailTile } from './MailTile'
import { BrowserTile } from './BrowserTile'
import { CalendarTile } from './CalendarTile'

export interface BuiltinTileDef {
  title: string
  icon: string
  /** Shown in the Dock's "add tile" list. Some builtins (hq) are singletons managed separately. */
  dockVisible: boolean
  Component: React.ComponentType<{ tileId: string }>
}

export const BUILTIN_TILE_DEFS: Record<BuiltinTileType, BuiltinTileDef> = {
  terminal: { title: 'Terminal', icon: 'terminal', dockVisible: true, Component: TerminalTile },
  browser: { title: 'Browser', icon: 'browser', dockVisible: true, Component: BrowserTile },
  mail: { title: 'Mail', icon: 'mail', dockVisible: true, Component: MailTile },
  calendar: { title: 'Calendar', icon: 'calendar', dockVisible: true, Component: CalendarTile },
  'file-explorer': { title: 'Files', icon: 'folder', dockVisible: true, Component: FileExplorerTile },
  sysmon: { title: 'System Monitor', icon: 'activity', dockVisible: true, Component: SysMonTile },
  'ai-builder': { title: 'AI Builder', icon: 'sparkles', dockVisible: true, Component: AiBuilderTile },
  settings: { title: 'Settings', icon: 'settings', dockVisible: true, Component: SettingsTile },
  hq: { title: 'HQ', icon: 'command', dockVisible: true, Component: HqTile }
}

/** Resolves any tile instance (builtin, web, or plugin) to the component that renders it. */
export function resolveTileComponent(tile: TileInstance): React.ComponentType<{ tileId: string }> {
  if (tile.kind === 'builtin') {
    return BUILTIN_TILE_DEFS[tile.typeId as BuiltinTileType]?.Component ?? FallbackTile
  }
  if (tile.kind === 'web') {
    return WebTile
  }
  // kind === 'plugin'
  const config = (tile.config ?? {}) as { pluginKind?: 'web' | 'app' }
  return config.pluginKind === 'app' ? PluginFrame : WebTile
}

function FallbackTile(): React.JSX.Element {
  return <div className="bt-tile-body bt-tile-body--centered bt-text-muted">不明なタイルです</div>
}
