import { memo, useMemo } from 'react'
import { useAppStore, selectActiveWorkspace } from '../store/appStore'
import { resolveTileComponent } from '../tiles/registry'
import { Icon } from '../ui/Icon'
import { formatTileMemory } from '../ui/formatBytes'
import { TILE_DRAG_MIME } from './tileContexts'
import { tileUsage } from './tileUsage'

/**
 * A tile's frame (header + body). Memoized, and the body element too: the
 * memory figure in the header changes every 0.5 s and the layout on every
 * splitter release — neither must re-render a whole Files tree or Calendar.
 */
export const TileChrome = memo(function TileChrome({ tileId }: { tileId: string }): React.JSX.Element {
  const tile = useAppStore((s) => selectActiveWorkspace(s)?.tiles[tileId])
  const titleOverride = useAppStore((s) => s.runtime[tileId]?.titleOverride)
  // Strings / numbers, not the snapshot's objects (new on every 0.5 s tick): the header only
  // re-renders when what it shows changes.
  const memoryLabel = useAppStore((s) => formatTileMemory(tileUsage(s.memorySnapshot?.tiles, tileId).memoryBytes))
  const cpuPercent = useAppStore((s) => tileUsage(s.memorySnapshot?.tiles, tileId).cpuPercent)
  const closeTile = useAppStore((s) => s.closeTile)
  const dragging = useAppStore((s) => s.tileDrag?.kind === 'tile' && s.tileDrag.tileId === tileId)
  const startTileDrag = useAppStore((s) => s.startTileDrag)

  // Only the component type matters here (a tile's own config is read inside it through useTileConfig).
  const Component = useMemo(() => (tile ? resolveTileComponent(tile) : null), [tile?.kind, tile?.typeId, tile?.config?.pluginKind]) // eslint-disable-line react-hooks/exhaustive-deps
  const body = useMemo(() => (Component ? <Component tileId={tileId} /> : null), [Component, tileId])

  if (!tile || !Component) return <div className="bt-tile" />

  const title = titleOverride || tile.title

  return (
    <div className="bt-tile" onMouseDownCapture={() => void window.api.tile.focus(tileId)}>
      <div
        className={`bt-tile__header${dragging ? ' bt-tile__header--dragging' : ''}`}
        draggable
        title="ドラッグして別のタイルの上下左右（入れ替えは中央）か、画面の端（端いっぱいに置く）にドロップ"
        onDragStart={(e) => {
          e.dataTransfer.setData(TILE_DRAG_MIME, tileId)
          e.dataTransfer.effectAllowed = 'move'
          startTileDrag({ kind: 'tile', tileId })
        }}
      >
        <Icon name={tile.icon ?? 'file'} size={13} />
        <span className="bt-tile__title" title={title}>
          {title}
        </span>
        {cpuPercent !== null && (
          <span className="bt-tile__cpu" title="このタイルの CPU 使用率（直近 2 秒の平均。100% = CPU 1 コアを使い切っている状態）。忙しいときだけ表示されます">
            CPU {cpuPercent}%
          </span>
        )}
        {memoryLabel && <span className="bt-tile__memory">{memoryLabel}</span>}
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
