import { memo, useContext, useMemo } from 'react'
import { useAppStore, selectActiveWorkspace } from '../store/appStore'
import { resolveTileComponent } from '../tiles/registry'
import { Icon } from '../ui/Icon'
import { formatTileMemory } from '../ui/formatBytes'
import { TileDragContext, TILE_DRAG_MIME } from './tileContexts'

/**
 * A tile's frame (header + body). Memoized, and the body element too: the
 * memory figure in the header changes every 0.5 s and the layout on every
 * splitter release — neither must re-render a whole Files tree or Calendar.
 */
export const TileChrome = memo(function TileChrome({ tileId }: { tileId: string }): React.JSX.Element {
  const tile = useAppStore((s) => selectActiveWorkspace(s)?.tiles[tileId])
  const titleOverride = useAppStore((s) => s.runtime[tileId]?.titleOverride)
  // A number, not the snapshot's entry object: that one is new on every tick.
  const memoryBytes = useAppStore((s) => s.memorySnapshot?.tiles.find((t) => t.tileId === tileId)?.memoryBytes ?? 0)
  const closeTile = useAppStore((s) => s.closeTile)
  const drag = useContext(TileDragContext)

  // Only the component type matters here (a tile's own config is read inside it through useTileConfig).
  const Component = useMemo(() => (tile ? resolveTileComponent(tile) : null), [tile?.kind, tile?.typeId, tile?.config?.pluginKind]) // eslint-disable-line react-hooks/exhaustive-deps
  const body = useMemo(() => (Component ? <Component tileId={tileId} /> : null), [Component, tileId])

  if (!tile || !Component) return <div className="bt-tile" />

  const title = titleOverride || tile.title

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
        {memoryBytes > 0 && <span className="bt-tile__memory">{formatTileMemory(memoryBytes)}</span>}
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
      <div className="bt-tile__content">{body}</div>
    </div>
  )
})
