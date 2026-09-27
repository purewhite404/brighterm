import { useMemo } from 'react'
import { useAppStore, selectActiveWorkspace } from '../store/appStore'
import { resolveTileComponent } from '../tiles/registry'
import { Icon } from '../ui/Icon'

function formatBytes(bytes: number): string {
  if (bytes <= 0) return ''
  const mb = bytes / (1024 * 1024)
  return mb < 1024 ? `${mb.toFixed(0)} MB` : `${(mb / 1024).toFixed(1)} GB`
}

export function TileChrome({ tileId }: { tileId: string }): React.JSX.Element {
  const tile = useAppStore((s) => selectActiveWorkspace(s)?.tiles[tileId])
  const runtime = useAppStore((s) => s.runtime[tileId])
  const memoryEntry = useAppStore((s) => s.memorySnapshot?.tiles.find((t) => t.tileId === tileId))
  const closeTile = useAppStore((s) => s.closeTile)

  const Component = useMemo(() => (tile ? resolveTileComponent(tile) : null), [tile])

  if (!tile || !Component) return <div className="bt-tile" />

  const title = runtime?.titleOverride || tile.title

  return (
    <div className="bt-tile" onMouseDownCapture={() => void window.api.tile.focus(tileId)}>
      <div className="bt-tile__header">
        <Icon name={tile.icon ?? 'file'} size={13} />
        <span className="bt-tile__title" title={title}>
          {title}
        </span>
        {memoryEntry && memoryEntry.memoryBytes > 0 && (
          <span className="bt-tile__memory">{formatBytes(memoryEntry.memoryBytes)}</span>
        )}
        <button
          className="bt-tile__close"
          onClick={(e) => {
            e.stopPropagation()
            closeTile(tileId)
          }}
          title="閉じる"
        >
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className="bt-tile__content">
        <Component tileId={tileId} />
      </div>
    </div>
  )
}
