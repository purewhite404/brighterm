import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { BUILTIN_TILE_DEFS } from '../tiles/registry'
import { Icon } from '../ui/Icon'
import type { BuiltinTileType } from '@shared/types'
import type { PluginListItem } from '../../main/plugins/pluginHost'

interface PaletteItem {
  id: string
  label: string
  icon: string
  group: string
  run: () => void
}

export function CommandPalette(): React.JSX.Element | null {
  const open = useAppStore((s) => s.paletteOpen)
  const setOpen = useAppStore((s) => s.setPaletteOpen)
  const config = useAppStore((s) => s.config)
  const switchWorkspace = useAppStore((s) => s.switchWorkspace)
  const addTile = useAppStore((s) => s.addTile)
  const [query, setQuery] = useState('')
  const [plugins, setPlugins] = useState<PluginListItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    if (open) void window.api.plugins.list().then(setPlugins)
  }, [open])

  useEffect(() => {
    if (open) {
      void window.api.overlay.show()
    } else {
      void window.api.overlay.hide()
      setQuery('')
      setSelectedIndex(0)
    }
  }, [open])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(!open)
      } else if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, setOpen])

  const items = useMemo<PaletteItem[]>(() => {
    if (!config) return []
    const result: PaletteItem[] = []

    for (const ws of config.workspaces) {
      result.push({
        id: `ws-${ws.id}`,
        label: ws.name,
        icon: ws.icon,
        group: 'ワークスペースを切り替え',
        run: () => switchWorkspace(ws.id)
      })
    }

    for (const [typeId, def] of Object.entries(BUILTIN_TILE_DEFS) as [
      BuiltinTileType,
      (typeof BUILTIN_TILE_DEFS)[BuiltinTileType]
    ][]) {
      if (!def.dockVisible) continue
      result.push({
        id: `builtin-${typeId}`,
        label: def.title,
        icon: def.icon,
        group: 'タイルを追加',
        run: () => addTile({ kind: 'builtin', typeId, title: def.title, icon: def.icon })
      })
    }

    for (const def of config.webTileDefinitions) {
      result.push({
        id: `web-${def.id}`,
        label: def.title,
        icon: def.icon,
        group: 'タイルを追加',
        run: () =>
          addTile({
            kind: 'web',
            typeId: def.id,
            title: def.title,
            icon: def.icon,
            config: { url: def.url, partitionId: def.partitionId, compactCss: def.compactCss }
          })
      })
    }

    for (const p of plugins.filter((p) => p.enabled)) {
      result.push({
        id: `plugin-${p.manifest.id}`,
        label: p.manifest.name,
        icon: p.manifest.icon,
        group: 'プラグインを追加',
        run: () =>
          addTile({
            kind: 'plugin',
            typeId: p.manifest.id,
            title: p.manifest.name,
            icon: p.manifest.icon,
            config:
              p.manifest.kind === 'web'
                ? { pluginKind: 'web', pluginId: p.manifest.id, url: p.manifest.url, partitionId: `plugin-${p.manifest.id}` }
                : { pluginKind: 'app', pluginId: p.manifest.id }
          })
      })
    }

    return result
  }, [config, plugins, addTile, switchWorkspace])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => item.label.toLowerCase().includes(q) || item.group.toLowerCase().includes(q))
  }, [items, query])

  if (!open) return null

  const runSelected = (item: PaletteItem): void => {
    item.run()
    setOpen(false)
  }

  return (
    <div className="bt-palette-overlay" onClick={() => setOpen(false)}>
      <div className="bt-palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="bt-palette__input"
          placeholder="タイルやワークスペースを検索…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelectedIndex(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSelectedIndex((i) => Math.min(filtered.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSelectedIndex((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter' && filtered[selectedIndex]) {
              runSelected(filtered[selectedIndex])
            }
          }}
        />
        <div className="bt-palette__list">
          {filtered.length === 0 && <div className="bt-palette__empty">見つかりませんでした</div>}
          {filtered.map((item, i) => (
            <button
              key={item.id}
              className={`bt-palette__item${i === selectedIndex ? ' bt-palette__item--active' : ''}`}
              onClick={() => runSelected(item)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
              <span className="bt-palette__group">{item.group}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
