import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { BUILTIN_TILES, builtinTile, pluginTile, webTile } from '../tiles/catalog'
import { NEW_TILE_DRAG_MIME } from '../tiling/tileContexts'
import { Icon } from '../ui/Icon'
import type { PluginListItem } from '@shared/apiTypes'
import type { BuiltinTileType, TileInstance } from '@shared/types'

function DockButton({
  icon,
  label,
  active,
  className,
  onClick,
  ...rest
}: {
  icon: string
  label: string
  active?: boolean
  className?: string
  onClick: () => void
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'className'>): React.JSX.Element {
  return (
    <button
      className={`bt-dock__button${active ? ' bt-dock__button--active' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      title={label}
      {...rest}
    >
      <Icon name={icon} size={20} />
      <span className="bt-dock__label">{label}</span>
    </button>
  )
}

/**
 * Adds a tile: a click splits the largest tile (as before); a drag puts it where
 * it's dropped, with the same preview as moving a tile. The Dock closes as the
 * drag starts so the tiles under it can be dropped on — in a timeout, because
 * changing the dragged element's layout inside dragstart can cancel the drag.
 */
function AddTileButton({ icon, label, tile }: { icon: string; label: string; tile: Omit<TileInstance, 'id'> }): React.JSX.Element {
  const addTile = useAppStore((s) => s.addTile)
  const setDockOpen = useAppStore((s) => s.setDockOpen)
  const startTileDrag = useAppStore((s) => s.startTileDrag)
  return (
    <DockButton
      icon={icon}
      label={label}
      draggable
      onClick={() => {
        addTile(tile)
        setDockOpen(false)
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData(NEW_TILE_DRAG_MIME, label)
        e.dataTransfer.effectAllowed = 'copy'
        startTileDrag({ kind: 'new', tile })
        setTimeout(() => setDockOpen(false), 0)
      }}
    />
  )
}

/**
 * The bar on the left. Closed, it's a column of icons; the menu button (or
 * Ctrl+K) opens it wide over the tiles with every icon's name (it replaced the
 * command palette). Escape or a click outside closes it.
 * Open and closed are the same elements (only CSS differs), so a drag that
 * starts in the open Dock survives it closing.
 */
export function Dock(): React.JSX.Element {
  const config = useAppStore((s) => s.config)
  const open = useAppStore((s) => s.dockOpen)
  const setOpen = useAppStore((s) => s.setDockOpen)
  const switchWorkspace = useAppStore((s) => s.switchWorkspace)
  const createWorkspace = useAppStore((s) => s.createWorkspace)
  const deleteWorkspace = useAppStore((s) => s.deleteWorkspace)
  const arrangeTiles = useAppStore((s) => s.arrangeTiles)
  const [plugins, setPlugins] = useState<PluginListItem[]>([])
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const refresh = (): void => void window.api.plugins.list().then(setPlugins)
    refresh()
    return window.api.plugins.onChanged(refresh)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(!useAppStore.getState().dockOpen)
      } else if (e.key === 'Escape' && useAppStore.getState().dockOpen) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setOpen])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent): void => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [open, setOpen])

  if (!config) return <div className="bt-dock" />

  /** Run a Dock action and close the Dock (a no-op when it's closed already). */
  const act = (run: () => void) => () => {
    run()
    setOpen(false)
  }
  const enabledPlugins = plugins.filter((p) => p.enabled)

  return (
    <div className={`bt-dock${open ? ' bt-dock--open' : ''}`}>
      <div className="bt-dock__panel" ref={panelRef}>
        <div className="bt-dock__section">
          <DockButton
            icon="menu"
            label={open ? 'メニューを閉じる (Ctrl+K)' : 'メニューを開く (Ctrl+K)'}
            className="bt-dock__toggle"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          />
        </div>

        <div className="bt-dock__divider" />

        <div className="bt-dock__section">
          <div className="bt-dock__heading">ワークスペース</div>
          {config.workspaces.map((ws) => (
            <div key={ws.id} className="bt-dock__workspace">
              <DockButton
                icon={ws.icon}
                label={ws.name}
                active={ws.id === config.activeWorkspaceId}
                onClick={act(() => switchWorkspace(ws.id))}
              />
              {/* Only an empty workspace can be removed here, so no tiles are ever lost by a stray click. */}
              {config.workspaces.length > 1 && Object.keys(ws.tiles).length === 0 && (
                <button
                  className="bt-dock__workspace-remove"
                  title={`「${ws.name}」を削除`}
                  aria-label={`ワークスペース「${ws.name}」を削除`}
                  onClick={() => deleteWorkspace(ws.id)}
                >
                  <Icon name="close" size={10} />
                </button>
              )}
            </div>
          ))}
          <DockButton icon="plus" label="新しいワークスペース" onClick={act(() => createWorkspace('新規', 'home'))} />
        </div>

        <div className="bt-dock__divider" />

        <div className="bt-dock__section bt-dock__section--scroll">
          <div className="bt-dock__heading">タイル（クリックで追加・ドラッグで配置）</div>
          {(Object.entries(BUILTIN_TILES) as [BuiltinTileType, (typeof BUILTIN_TILES)[BuiltinTileType]][])
            .filter(([, def]) => def.dockVisible)
            .map(([id, def]) => (
              <AddTileButton key={id} icon={def.icon} label={def.title} tile={builtinTile(id)} />
            ))}

          {config.webTileDefinitions.length > 0 && <div className="bt-dock__heading">Web</div>}
          {config.webTileDefinitions.map((def) => (
            <AddTileButton key={def.id} icon={def.icon} label={def.title} tile={webTile(def)} />
          ))}

          {enabledPlugins.length > 0 && <div className="bt-dock__heading">プラグイン</div>}
          {enabledPlugins.map((p) => (
            <AddTileButton key={p.manifest.id} icon={p.manifest.icon} label={p.manifest.name} tile={pluginTile(p)} />
          ))}
        </div>

        <div className="bt-dock__divider" />
        <div className="bt-dock__section">
          <div className="bt-dock__heading">レイアウト</div>
          <DockButton icon="layout" label="タイルを整列" onClick={act(arrangeTiles)} />
        </div>
      </div>
    </div>
  )
}
