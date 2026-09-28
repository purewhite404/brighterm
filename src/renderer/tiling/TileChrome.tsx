import { useContext, useMemo } from 'react'
import { useAppStore, selectActiveWorkspace } from '../store/appStore'
import { resolveTileComponent } from '../tiles/registry'
import { Icon } from '../ui/Icon'
import { formatTileMemory } from '../ui/formatBytes'
import { TileDragContext, TILE_DRAG_MIME } from './tileContexts'

export function TileChrome({ tileId }: { tileId: string }): React.JSX.Element {
  const tile = useAppStore((s) => selectActiveWorkspace(s)?.tiles[tileId])
  const runtime = useAppStore((s) => s.runtime[tileId])
  const memoryEntry = useAppStore((s) => s.memorySnapshot?.tiles.find((t) => t.tileId === tileId))
  const closeTile = useAppStore((s) => s.closeTile)
  const drag = useContext(TileDragContext)

  const Component = useMemo(() => (tile ? resolveTileComponent(tile) : null), [tile])

  if (!tile || !Component) return <div className="bt-tile" />

  const title = runtime?.titleOverride || tile.title

  return (
    <div className="bt-tile" onMouseDownCapture={() => void window.api.tile.focus(tileId)}>
      <div
        className={`bt-tile__header${drag.draggingTileId === tileId ? ' bt-tile__header--dragging' : ''}`}
        draggable
        title="ドラッグして別のタイルの上下左右（入れ替えは中央）にドロップ"
        onDragStart={(e) => {
          e.dataTransfer.setData(TILE_DRAG_MIME, tileId)
          e.dataTransfer.effectAllowed = 'move'
          drag.startDrag(tileId)
        }}
        onDragEnd={() => drag.endDrag()}
      >
        <Icon name={tile.icon ?? 'file'} size={13} />
        <span className="bt-tile__title" title={title}>
          {title}
        </span>
        {memoryEntry && memoryEntry.memoryBytes > 0 && (
          <span className="bt-tile__memory">{formatTileMemory(memoryEntry.memoryBytes)}</span>
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
