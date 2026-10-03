import { useContext, useEffect, useRef } from 'react'
import { TileRectContext } from '../../tiling/tileContexts'

export interface WebViewSource {
  url: string
  /** Electron session partition suffix; same id => shared cookies/login. */
  partitionId: string
  compactCss?: string
}

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
  source: WebViewSource | null
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

  // The rect last sent to main, and the frame a report is waiting for: several
  // triggers (size, the tile's position, the window) collapse into one measurement
  // per frame, and main only hears about a rect that changed.
  const lastSent = useRef('')
  const pendingFrame = useRef(0)

  const measureNow = (): void => {
    pendingFrame.current = 0
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const rect = { x: r.x, y: r.y, width: r.width, height: r.height }
    const key = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`
    if (key === lastSent.current) return
    lastSent.current = key
    void window.api.tile.setBounds(viewId, rect)
  }
  // Wait for the frame: a new absolute position must be applied before measuring.
  const report = (): void => {
    if (!pendingFrame.current) pendingFrame.current = requestAnimationFrame(measureNow)
  }

  useEffect(() => {
    const el = ref.current
    if (!el || !url) return
    lastSent.current = '' // a (re)created view must hear its bounds
    const observer = new ResizeObserver(report)
    observer.observe(el)
    window.addEventListener('resize', report)
    measureNow()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
      cancelAnimationFrame(pendingFrame.current)
      pendingFrame.current = 0
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId, url])

  // A tile can move without changing size (e.g. swapped with an equal-sized one).
  useEffect(report, [tileRect?.x, tileRect?.y, tileRect?.width, tileRect?.height]) // eslint-disable-line react-hooks/exhaustive-deps

  return ref
}
