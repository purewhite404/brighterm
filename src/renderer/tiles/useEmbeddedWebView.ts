import { useContext, useEffect, useRef } from 'react'
import { TileRectContext } from '../tiling/tileContexts'

/**
 * Binds a main-process WebContentsView to a placeholder <div>.
 *
 * - On mount: asks main to create the view. That call is idempotent — an
 *   existing view is shown again (and resumed if it was suspended) — so
 *   StrictMode's double mount and re-showing a workspace both just work.
 * - While mounted: reports the div's on-screen rect whenever it may have
 *   changed (its size, its tile's position in the grid, the window size).
 * - On unmount: only *hides* the view. Destroying it is closeTile's job.
 */
export function useEmbeddedWebView(
  viewId: string,
  source: { url: string; partitionId: string; compactCss?: string } | null
): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null)
  const tileRect = useContext(TileRectContext)

  const url = source?.url
  const partitionId = source?.partitionId
  const compactCss = source?.compactCss
  // A tile may start without a page (a new Browser) and get one later.
  const hasSource = Boolean(url && partitionId)

  useEffect(() => {
    if (!url || !partitionId) return
    void window.api.tile.create({ tileId: viewId, kind: 'web', url, partitionId, compactCss })
    return () => {
      void window.api.tile.hide(viewId)
    }
    // The view's URL changes via navigation, not by re-creating it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId, partitionId, hasSource])

  const report = (): void => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    void window.api.tile.setBounds(viewId, { x: r.x, y: r.y, width: r.width, height: r.height })
  }

  useEffect(() => {
    const el = ref.current
    if (!el || !url) return
    const observer = new ResizeObserver(report)
    observer.observe(el)
    window.addEventListener('resize', report)
    report()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId, url])

  // A tile can move without changing size (e.g. swapped with an equal-sized one).
  useEffect(() => {
    // Wait for the new absolute position to be applied before measuring.
    const frame = requestAnimationFrame(report)
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileRect?.x, tileRect?.y, tileRect?.width, tileRect?.height])

  return ref
}
