import type { BuiltinTileType, TileInstance } from '@shared/types'
import { TerminalTile } from './terminal/TerminalTile'
import { WebTile } from './web/WebTile'
import { FileExplorerTile } from './files/FileExplorerTile'
import { SysMonTile } from './sysmon/SysMonTile'
import { HqTile } from './hq/HqTile'
import { AiBuilderTile } from './ai-builder/AiBuilderTile'
import { SettingsTile } from './settings/SettingsTile'
import { PluginFrame } from './plugin/PluginFrame'
import { MailTile } from './mail/MailTile'
import { BrowserTile } from './browser/BrowserTile'
import { CalendarTile } from './calendar/CalendarTile'

type TileComponent = React.ComponentType<{ tileId: string }>

/** The component of each built-in tile (titles and icons are in catalog.ts). */
const BUILTIN_COMPONENTS: Record<BuiltinTileType, TileComponent> = {
  terminal: TerminalTile,
  browser: BrowserTile,
  mail: MailTile,
  calendar: CalendarTile,
  'file-explorer': FileExplorerTile,
  sysmon: SysMonTile,
  'ai-builder': AiBuilderTile,
  settings: SettingsTile,
  hq: HqTile
}

/** Resolves any tile instance (builtin, web, or plugin) to the component that renders it. */
export function resolveTileComponent(tile: TileInstance): TileComponent {
  if (tile.kind === 'builtin') {
    return BUILTIN_COMPONENTS[tile.typeId as BuiltinTileType] ?? FallbackTile
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
