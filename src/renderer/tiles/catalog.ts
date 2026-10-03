import type { BuiltinTileType, PluginManifest, TileInstance, WebTileDefinition, Workspace } from '@shared/types'

export interface BuiltinTileInfo {
  title: string
  icon: string
  /** Shown in the Dock's "add tile" list. Some builtins (hq) are singletons managed separately. */
  dockVisible: boolean
}

/** Every built-in tile the Dock offers. Their components are in registry.tsx. */
export const BUILTIN_TILES: Record<BuiltinTileType, BuiltinTileInfo> = {
  terminal: { title: 'Terminal', icon: 'terminal', dockVisible: true },
  browser: { title: 'Browser', icon: 'browser', dockVisible: true },
  mail: { title: 'Mail', icon: 'mail', dockVisible: true },
  calendar: { title: 'Calendar', icon: 'calendar', dockVisible: true },
  'file-explorer': { title: 'Files', icon: 'folder', dockVisible: true },
  sysmon: { title: 'System Monitor', icon: 'activity', dockVisible: true },
  'ai-builder': { title: 'AI Builder', icon: 'sparkles', dockVisible: true },
  settings: { title: 'Settings', icon: 'settings', dockVisible: true },
  hq: { title: 'HQ', icon: 'command', dockVisible: true }
}

/** What `addTile` takes. */
export type NewTile = Omit<TileInstance, 'id'>

export function builtinTile(typeId: BuiltinTileType, config?: Record<string, unknown>): NewTile {
  const { title, icon } = BUILTIN_TILES[typeId]
  return { kind: 'builtin', typeId, title, icon, ...(config ? { config } : {}) }
}

export function webTile(def: WebTileDefinition): NewTile {
  return {
    kind: 'web',
    typeId: def.id,
    title: def.title,
    icon: def.icon,
    config: { url: def.url, partitionId: def.partitionId, compactCss: def.compactCss }
  }
}

/** A plugin tile: a web page (its own session partition) or an app in a sandboxed iframe (PluginFrame). */
export function pluginTile(item: { manifest: PluginManifest }, config?: Record<string, unknown>): NewTile {
  const { manifest } = item
  return {
    kind: 'plugin',
    typeId: manifest.id,
    title: manifest.name,
    icon: manifest.icon,
    config:
      manifest.kind === 'web'
        ? { pluginKind: 'web', pluginId: manifest.id, url: manifest.url, partitionId: `plugin-${manifest.id}`, ...config }
        : { pluginKind: 'app', pluginId: manifest.id, ...config }
  }
}

/** Every open tile of a plugin, in any workspace (to close them when it's deleted or disabled). */
export function pluginTileIds(workspaces: Workspace[], pluginId: string): string[] {
  return workspaces.flatMap((w) =>
    Object.values(w.tiles)
      .filter((t) => t.kind === 'plugin' && (t.config as { pluginId?: string } | undefined)?.pluginId === pluginId)
      .map((t) => t.id)
  )
}
