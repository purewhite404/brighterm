import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LayoutNode, Rect } from '@shared/types'
import {
  computeRects,
  computeSplitters,
  dropPreview,
  splitterOffset,
  splitterRatioAt,
  type DragSource,
  type Drop,
  type DropZone,
  type Edge,
  type SplitterRect
} from './layout'
import { useAppStore } from '../store/appStore'
import { TileChrome } from './TileChrome'
import { NEW_TILE_DRAG_MIME, TileRectContext, TILE_DRAG_MIME } from './tileContexts'

/**
 * Tiles are rendered as one flat, absolutely-positioned list keyed by tile
 * id — not as nested split containers. That way a layout change (adding a
 * tile, dragging a splitter, moving a tile) only changes each tile's
 * position; React never unmounts it, so a terminal session, an expanded
 * file tree or a plugin iframe survives every re-layout.
 */

const SPLITTER_THICKNESS = 6
const GAP = 2
const EDGES: Edge[] = ['left', 'right', 'top', 'bottom']

function insetRect(rect: Rect): Rect {
  return {
    x: rect.x + GAP,
    y: rect.y + GAP,
    width: Math.max(0, rect.width - GAP * 2),
    height: Math.max(0, rect.height - GAP * 2)
  }
}

function sameDrop(a: Drop | null, b: Drop | null): boolean {
  if (a === null || b === null) return a === b
  if (a.kind === 'area') return b.kind === 'area'
  if (a.kind === 'edge') return b.kind === 'edge' && a.edge === b.edge
  return b.kind === 'tile' && a.targetTileId === b.targetTileId && a.zone === b.zone
}

interface DropHandlers {
  hover: (drop: Drop) => void
  leave: (drop: Drop) => void
  drop: (drop: Drop) => void
}

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

/**
 * Drop handling for one target (another tile, or a strip along an edge of the
 * whole area). The hint isn't drawn here: TilingView draws where the tiles will
 * really end up (`dropPreview`).
 */
function dropEvents(handlers: DropHandlers, dropAt: (e: React.DragEvent<HTMLDivElement>) => Drop) {
  return {
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
      const { types } = e.dataTransfer
      if (!types.includes(TILE_DRAG_MIME) && !types.includes(NEW_TILE_DRAG_MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = types.includes(NEW_TILE_DRAG_MIME) ? 'copy' : 'move'
      handlers.hover(dropAt(e))
    },
    onDragLeave: (e: React.DragEvent<HTMLDivElement>) => handlers.leave(dropAt(e)),
    onDrop: (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      handlers.drop(dropAt(e))
    }
  }
}

function DropTarget({ tileId, handlers }: { tileId: string; handlers: DropHandlers }): React.JSX.Element {
  return (
    <div
      className="bt-drop-target"
      {...dropEvents(handlers, (e) => ({ kind: 'tile', targetTileId: tileId, zone: zoneAt(e) satisfies DropZone }))}
    />
  )
}

/** A strip along one side of the whole tiling area: drops there span the full width / height. */
function EdgeDropTarget({ edge, handlers }: { edge: Edge; handlers: DropHandlers }): React.JSX.Element {
  return (
    <div
      className={`bt-edge-drop bt-edge-drop--${edge}`}
      data-edge={edge}
      {...dropEvents(handlers, () => ({ kind: 'edge', edge }))}
    />
  )
}

/** The whole (empty) tiling area, for a new tile dragged into an empty workspace. */
function AreaDropTarget({ handlers }: { handlers: DropHandlers }): React.JSX.Element {
  return <div className="bt-area-drop" {...dropEvents(handlers, () => ({ kind: 'area' }))} />
}

/**
 * Dragging a splitter only moves the handle itself, as a guide line; the layout
 * changes once, on release (Escape cancels). Resizing live re-laid out every
 * tile, re-fitted every terminal and moved every web view on each pointer move.
 * While dragging, web views are swapped for snapshots (as for a tile drag) so
 * the line stays visible over them.
 */
function Splitter({ splitter, containerRef }: { splitter: SplitterRect; containerRef: React.RefObject<HTMLDivElement | null> }): React.JSX.Element {
  const resizeSplitAt = useAppStore((s) => s.resizeSplitAt)
  const setResizing = useAppStore((s) => s.setResizing)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const container = containerRef.current
      if (!container || e.button !== 0) return
      e.preventDefault()
      const handle = e.currentTarget
      const pointerId = e.pointerId
      const origin = container.getBoundingClientRect()
      const axis = splitter.direction === 'row' ? 'X' : 'Y'
      let ratio: number | null = null
      let done = false

      // Capture: the moves keep coming even over a plugin's <iframe>.
      handle.setPointerCapture(pointerId)
      handle.classList.add('bt-splitter--dragging')
      document.body.classList.add(`bt-resizing-${splitter.direction}`)
      setResizing(true)

      const onMove = (move: PointerEvent): void => {
        ratio = splitterRatioAt(splitter, move.clientX - origin.left, move.clientY - origin.top)
        handle.style.transform = `translate${axis}(${splitterOffset(splitter, ratio)}px)`
      }
      const finish = (commit: boolean): void => {
        if (done) return
        done = true
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        handle.removeEventListener('lostpointercapture', onCancel)
        window.removeEventListener('keydown', onKey, true)
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
        handle.classList.remove('bt-splitter--dragging')
        handle.style.transform = ''
        document.body.classList.remove(`bt-resizing-${splitter.direction}`)
        setResizing(false)
        if (commit && ratio !== null) resizeSplitAt(splitter.path, ratio)
      }
      const onUp = (): void => finish(true)
      const onCancel = (): void => finish(false)
      const onKey = (key: KeyboardEvent): void => {
        if (key.key !== 'Escape') return
        key.preventDefault()
        key.stopPropagation()
        finish(false)
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('lostpointercapture', onCancel)
      window.addEventListener('keydown', onKey, true)
    },
    [containerRef, splitter, resizeSplitAt, setResizing]
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

export const TilingView = memo(function TilingView({ layout }: { layout: LayoutNode | null }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [hoveredDrop, setHoveredDrop] = useState<Drop | null>(null)
  const setViewportAspect = useAppStore((s) => s.setViewportAspect)
  const tileDrag = useAppStore((s) => s.tileDrag)
  const endTileDrag = useAppStore((s) => s.endTileDrag)
  const draggingTileId = tileDrag?.kind === 'tile' ? tileDrag.tileId : null

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

  const hasSize = size.width > 0
  useEffect(() => {
    if (hasSize) performance.mark('shell:tiles-rendered') // startup timeline (tests/e2e)
  }, [hasSize])

  const area = useMemo<Rect>(() => ({ x: 0, y: 0, width: size.width, height: size.height }), [size])
  const tileRects = useMemo(() => computeRects(layout, area), [layout, area])
  const splitters = useMemo(() => computeSplitters(layout, area, SPLITTER_THICKNESS), [layout, area])

  // Stable DOM order (by id), regardless of where each tile sits: moving an
  // <iframe> element in the DOM would reload it. `inner` is computed here (not
  // in render) so each tile's TileRectContext value only changes with its rect.
  const orderedTiles = useMemo(
    () =>
      [...tileRects]
        .sort((a, b) => (a.tileId < b.tileId ? -1 : a.tileId > b.tileId ? 1 : 0))
        .map(({ tileId, rect }) => ({ tileId, inner: insetRect(rect) })),
    [tileRects]
  )

  // A drag ends with dragend on its source (after a drop, or cancelled: released outside, Escape).
  // Listened to on the window: the source may be a Dock button or a tile header.
  useEffect(() => {
    if (!tileDrag) {
      setHoveredDrop(null)
      return
    }
    const onEnd = (): void => endTileDrag()
    window.addEventListener('dragend', onEnd, true)
    return () => window.removeEventListener('dragend', onEnd, true)
  }, [tileDrag, endTileDrag])

  const dropHandlers = useMemo<DropHandlers>(
    () => ({
      // Only re-render when the drop under the pointer changes (dragover fires every few ms).
      hover: (drop) => setHoveredDrop((current) => (sameDrop(current, drop) ? current : drop)),
      // dragenter on the next target can come before dragleave on this one: only clear our own drop.
      leave: (drop) => setHoveredDrop((current) => (sameDrop(current, drop) ? null : current)),
      drop: (drop) => {
        setHoveredDrop(null)
        const { tileDrag: drag, dropTile, addTile } = useAppStore.getState()
        if (drag?.kind === 'tile') dropTile(drag.tileId, drop)
        else if (drag?.kind === 'new') addTile(drag.tile, drop)
      }
    }),
    []
  )

  const dragSource = useMemo<DragSource | null>(
    () => (tileDrag === null ? null : tileDrag.kind === 'new' ? { kind: 'new' } : { kind: 'tile', tileId: tileDrag.tileId }),
    [tileDrag]
  )
  const preview = useMemo(
    () => (dragSource && hoveredDrop ? dropPreview(layout, area, dragSource, hoveredDrop).map(insetRect) : []),
    [layout, area, dragSource, hoveredDrop]
  )
  // A moved tile can't go to an edge if it's the only one; a new tile can, next to any tile.
  const edgeDrops = dragSource !== null && tileRects.length > (dragSource.kind === 'new' ? 0 : 1)

  return (
    <div ref={containerRef} className="bt-tiling-root">
      {layout === null && (
        <div className="bt-tiling-empty">
          <div className="bt-tiling-empty__hint">ドックのアイコンをクリックするか、ここへドラッグしてタイルを追加してください</div>
        </div>
      )}
      {size.width > 0 &&
        orderedTiles.map(({ tileId, inner }) => {
          return (
            <div
              key={tileId}
              className="bt-tile-slot"
              style={{ left: inner.x, top: inner.y, width: inner.width, height: inner.height }}
            >
              <TileRectContext.Provider value={inner}>
                <TileChrome tileId={tileId} />
              </TileRectContext.Provider>
              {dragSource && draggingTileId !== tileId && <DropTarget tileId={tileId} handlers={dropHandlers} />}
            </div>
          )
        })}
      {dragSource?.kind === 'new' && layout === null && <AreaDropTarget handlers={dropHandlers} />}
      {edgeDrops &&
        EDGES.map((edge) => <EdgeDropTarget key={edge} edge={edge} handlers={dropHandlers} />)}
      {preview.map((rect, i) => (
        <div
          key={i}
          className="bt-drop-preview"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        />
      ))}
      {/* Reversed: a split's handle is drawn after (over) the handles inside its halves. At a T
          junction the inner handle starts right at the outer line, so grabbing the middle of the
          long line used to grab the short one. */}
      {!dragSource &&
        [...splitters].reverse().map((s) => <Splitter key={s.path.join('') || 'root'} splitter={s} containerRef={containerRef} />)}
    </div>
  )
})
