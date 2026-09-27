import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LayoutNode, Rect } from '@shared/types'
import { computeRects, computeSplitters, type DropZone, type SplitterRect } from './layout'
import { useAppStore } from '../store/appStore'
import { TileChrome } from './TileChrome'
import { TileDragContext, TileRectContext, TILE_DRAG_MIME } from './tileContexts'

/**
 * Tiles are rendered as one flat, absolutely-positioned list keyed by tile
 * id — not as nested split containers. That way a layout change (adding a
 * tile, dragging a splitter, moving a tile) only changes each tile's
 * position; React never unmounts it, so a terminal session, an expanded
 * file tree or a plugin iframe survives every re-layout.
 */

const SPLITTER_THICKNESS = 6
const GAP = 2
function zoneAt(event: React.DragEvent<HTMLDivElement>): DropZone {
  const box = event.currentTarget.getBoundingClientRect()
  const fx = (event.clientX - box.left) / box.width
  const fy = (event.clientY - box.top) / box.height
  if (fx > 0.3 && fx < 0.7 && fy > 0.3 && fy < 0.7) return 'center'
  const distances: Array<[DropZone, number]> = [
    ['left', fx],
    ['right', 1 - fx],
    ['top', fy],
    ['bottom', 1 - fy]
  ]
  distances.sort((a, b) => a[1] - b[1])
  return distances[0][0]
}

function DropTarget({ tileId }: { tileId: string }): React.JSX.Element {
  const moveTileTo = useAppStore((s) => s.moveTileTo)
  const [zone, setZone] = useState<DropZone | null>(null)

  return (
    <div
      className="bt-drop-target"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TILE_DRAG_MIME)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setZone(zoneAt(e))
      }}
      onDragLeave={() => setZone(null)}
      onDrop={(e) => {
        e.preventDefault()
        const draggedId = e.dataTransfer.getData(TILE_DRAG_MIME)
        const dropZone = zoneAt(e)
        setZone(null)
        if (draggedId) moveTileTo(draggedId, tileId, dropZone)
      }}
    >
      {zone && <div className={`bt-drop-target__hint bt-drop-target__hint--${zone}`} />}
    </div>
  )
}

function Splitter({ splitter, containerRef }: { splitter: SplitterRect; containerRef: React.RefObject<HTMLDivElement | null> }): React.JSX.Element {
  const resizeSplitAt = useAppStore((s) => s.resizeSplitAt)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const container = containerRef.current
      if (!container) return
      e.preventDefault()
      const origin = container.getBoundingClientRect()
      const { parent, direction, path } = splitter

      const onMove = (move: PointerEvent): void => {
        const ratio =
          direction === 'row'
            ? (move.clientX - origin.left - parent.x) / parent.width
            : (move.clientY - origin.top - parent.y) / parent.height
        resizeSplitAt(path, ratio)
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [containerRef, splitter, resizeSplitAt]
  )

  const { rect } = splitter
  return (
    <div
      className={`bt-splitter bt-splitter--${splitter.direction}`}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      onPointerDown={onPointerDown}
    />
  )
}

export function TilingView({ layout }: { layout: LayoutNode | null }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [draggingTileId, setDraggingTileId] = useState<string | null>(null)
  const setViewportAspect = useAppStore((s) => s.setViewportAspect)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect()
      setSize({ width, height })
      if (height > 0) setViewportAspect(width / height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [setViewportAspect])

  const area = useMemo<Rect>(() => ({ x: 0, y: 0, width: size.width, height: size.height }), [size])
  const tileRects = useMemo(() => computeRects(layout, area), [layout, area])
  const splitters = useMemo(() => computeSplitters(layout, area, SPLITTER_THICKNESS), [layout, area])

  // Stable DOM order (by id), regardless of where each tile sits: moving an
  // <iframe> element in the DOM would reload it.
  const orderedTiles = useMemo(
    () => [...tileRects].sort((a, b) => (a.tileId < b.tileId ? -1 : a.tileId > b.tileId ? 1 : 0)),
    [tileRects]
  )

  const dragContext = useMemo(
    () => ({
      draggingTileId,
      startDrag: (tileId: string) => {
        setDraggingTileId(tileId)
        // Native web views are drawn above the DOM; swap them for snapshots so drop targets are reachable.
        void window.api.overlay.show()
      },
      endDrag: () => {
        setDraggingTileId(null)
        void window.api.overlay.hide()
      }
    }),
    [draggingTileId]
  )

  return (
    <div ref={containerRef} className="bt-tiling-root">
      {layout === null && (
        <div className="bt-tiling-empty">
          <div className="bt-tiling-empty__hint">ドックのアイコンをクリックしてタイルを追加してください</div>
        </div>
      )}
      <TileDragContext.Provider value={dragContext}>
        {size.width > 0 &&
          orderedTiles.map(({ tileId, rect }) => {
            const inner: Rect = {
              x: rect.x + GAP,
              y: rect.y + GAP,
              width: Math.max(0, rect.width - GAP * 2),
              height: Math.max(0, rect.height - GAP * 2)
            }
            return (
              <div
                key={tileId}
                className="bt-tile-slot"
                style={{ left: inner.x, top: inner.y, width: inner.width, height: inner.height }}
              >
                <TileRectContext.Provider value={inner}>
                  <TileChrome tileId={tileId} />
                </TileRectContext.Provider>
                {draggingTileId && draggingTileId !== tileId && <DropTarget tileId={tileId} />}
              </div>
            )
          })}
      </TileDragContext.Provider>
      {!draggingTileId &&
        splitters.map((s) => <Splitter key={s.path.join('') || 'root'} splitter={s} containerRef={containerRef} />)}
    </div>
  )
}
