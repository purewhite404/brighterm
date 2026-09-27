import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import { selectActiveWorkspace } from '../store/appStore'

/**
 * The DOM placeholder for a "web" or "plugin" tile. The actual page content
 * is rendered by a WebContentsView the main process positions exactly over
 * this div — this component's only real jobs are:
 *   1. tell main to create that view (once, on mount)
 *   2. keep main informed of this div's on-screen rect as it changes
 *   3. show the last-known screenshot instead, while suspended or hidden
 *      behind an overlay (command palette, etc.)
 */
export function WebTile({ tileId }: { tileId: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const created = useRef(false)

  const tile = useAppStore((s) => selectActiveWorkspace(s)?.tiles[tileId])
  const runtime = useAppStore((s) => s.runtime[tileId])

  useEffect(() => {
    if (!tile || created.current) return
    const config = (tile.config ?? {}) as { url?: string; partitionId?: string; compactCss?: string }
    if (!config.url || !config.partitionId) return
    created.current = true
    void window.api.tile.create({
      tileId,
      kind: tile.kind,
      url: config.url,
      partitionId: config.partitionId,
      compactCss: config.compactCss
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tile?.id])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const reportBounds = (): void => {
      const rect = el.getBoundingClientRect()
      void window.api.tile.setBounds(tileId, {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      })
    }

    const observer = new ResizeObserver(reportBounds)
    observer.observe(el)
    reportBounds()

    return () => observer.disconnect()
  }, [tileId])

  const showSnapshot = !!runtime?.snapshot

  return (
    <div ref={containerRef} className="bt-web-tile">
      {showSnapshot && (
        <img
          src={runtime!.snapshot!}
          alt=""
          className="bt-web-tile__snapshot"
          draggable={false}
        />
      )}
    </div>
  )
}
