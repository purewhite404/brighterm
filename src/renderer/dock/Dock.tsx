import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { BUILTIN_TILES, builtinTile, pluginTile, webTile } from '../tiles/catalog'
import { Icon } from '../ui/Icon'
import type { PluginListItem } from '../../main/plugins/pluginHost'
import type { BuiltinTileType } from '@shared/types'

function DockButton({
  icon,
  label,
  active,
  onClick
}: {
  icon: string
  label: string
  active?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button className={`bt-dock__button${active ? ' bt-dock__button--active' : ''}`} onClick={onClick} title={label}>
      <Icon name={icon} size={20} />
    </button>
  )
}

export function Dock(): React.JSX.Element {
  const config = useAppStore((s) => s.config)
  const switchWorkspace = useAppStore((s) => s.switchWorkspace)
  const createWorkspace = useAppStore((s) => s.createWorkspace)
  const deleteWorkspace = useAppStore((s) => s.deleteWorkspace)
  const addTile = useAppStore((s) => s.addTile)
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen)
  const [plugins, setPlugins] = useState<PluginListItem[]>([])

  useEffect(() => {
    const refresh = (): void => void window.api.plugins.list().then(setPlugins)
    refresh()
    return window.api.plugins.onChanged(refresh)
  }, [])

  if (!config) return <div className="bt-dock" />

  return (
    <div className="bt-dock">
      <div className="bt-dock__section">
        {config.workspaces.map((ws) => (
          <div key={ws.id} className="bt-dock__workspace">
            <DockButton
              icon={ws.icon}
              label={ws.name}
              active={ws.id === config.activeWorkspaceId}
              onClick={() => switchWorkspace(ws.id)}
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
        <DockButton icon="plus" label="新しいワークスペース" onClick={() => createWorkspace('新規', 'home')} />
      </div>

      <div className="bt-dock__divider" />

      <div className="bt-dock__section bt-dock__section--scroll">
        {(Object.entries(BUILTIN_TILES) as [BuiltinTileType, (typeof BUILTIN_TILES)[BuiltinTileType]][])
          .filter(([, def]) => def.dockVisible)
          .map(([id, def]) => (
            <DockButton key={id} icon={def.icon} label={def.title} onClick={() => addTile(builtinTile(id))} />
          ))}

        {config.webTileDefinitions.map((def) => (
          <DockButton key={def.id} icon={def.icon} label={def.title} onClick={() => addTile(webTile(def))} />
        ))}

        {plugins
          .filter((p) => p.enabled)
          .map((p) => (
            <DockButton
              key={p.manifest.id}
              icon={p.manifest.icon}
              label={p.manifest.name}
              onClick={() => addTile(pluginTile(p))}
            />
          ))}
      </div>

      <div className="bt-dock__divider" />
      <div className="bt-dock__section">
        <DockButton icon="command" label="コマンドパレット (Ctrl+K)" onClick={() => setPaletteOpen(true)} />
      </div>
    </div>
  )
}
