import { useCallback, useRef } from 'react'
import type { LayoutNode } from '@shared/types'
import type { NodePath } from './layout'
import { useAppStore } from '../store/appStore'
import { TileChrome } from './TileChrome'

const SPLITTER_SIZE = 5

function Splitter({ direction, path }: { direction: 'row' | 'column'; path: NodePath }): React.JSX.Element {
  const resizeSplitAt = useAppStore((s) => s.resizeSplitAt)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const splitterEl = e.currentTarget
      const container = splitterEl.parentElement
      if (!container) return
      const rect = container.getBoundingClientRect()
      const total = direction === 'row' ? rect.width : rect.height
      splitterEl.setPointerCapture(e.pointerId)

      const onMove = (moveEvent: PointerEvent): void => {
        const pos =
          direction === 'row' ? moveEvent.clientX - rect.left : moveEvent.clientY - rect.top
        const ratio = Math.min(1, Math.max(0, pos / total))
        resizeSplitAt(path, ratio)
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [direction, path, resizeSplitAt]
  )

  return (
    <div
      ref={containerRef}
      className={`bt-splitter bt-splitter--${direction}`}
      onPointerDown={onPointerDown}
      style={{ flex: `0 0 ${SPLITTER_SIZE}px` }}
    />
  )
}

function LayoutNodeView({ node, path }: { node: LayoutNode; path: NodePath }): React.JSX.Element {
  if (node.type === 'leaf') {
    return (
      <div className="bt-layout-leaf">
        <TileChrome tileId={node.tileId} />
      </div>
    )
  }

  const { direction, ratio } = node
  return (
    <div className={`bt-layout-split bt-layout-split--${direction}`}>
      <div className="bt-layout-split__pane" style={{ flex: `${ratio} 1 0%` }}>
        <LayoutNodeView node={node.a} path={[...path, 'a']} />
      </div>
      <Splitter direction={direction} path={path} />
      <div className="bt-layout-split__pane" style={{ flex: `${1 - ratio} 1 0%` }}>
        <LayoutNodeView node={node.b} path={[...path, 'b']} />
      </div>
    </div>
  )
}

export function TilingView({ layout }: { layout: LayoutNode | null }): React.JSX.Element {
  if (layout === null) {
    return (
      <div className="bt-tiling-empty">
        <div className="bt-tiling-empty__hint">ドックのアイコンをクリックしてタイルを追加してください</div>
      </div>
    )
  }
  return (
    <div className="bt-tiling-root">
      <LayoutNodeView node={layout} path={[]} />
    </div>
  )
}
