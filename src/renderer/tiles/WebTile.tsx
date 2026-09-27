import { useAppStore, selectActiveWorkspace } from '../store/appStore'
import { useEmbeddedWebView } from './useEmbeddedWebView'

/**
 * The DOM placeholder for a "web" or "plugin" tile. The page itself is a
 * WebContentsView the main process draws exactly over this div; while it's
 * suspended or hidden behind an overlay (palette, drag & drop), the last
 * screenshot is shown here instead.
 */
export function WebTile({ tileId }: { tileId: string }): React.JSX.Element {
  const tile = useAppStore((s) => selectActiveWorkspace(s)?.tiles[tileId])
  const snapshot = useAppStore((s) => s.runtime[tileId]?.snapshot)
  const config = (tile?.config ?? {}) as { url?: string; partitionId?: string; compactCss?: string }

  const ref = useEmbeddedWebView(
    tileId,
    config.url && config.partitionId
      ? { url: config.url, partitionId: config.partitionId, compactCss: config.compactCss }
      : null
  )

  return (
    <div ref={ref} className="bt-web-tile">
      {snapshot && <img src={snapshot} alt="" className="bt-web-tile__snapshot" draggable={false} />}
    </div>
  )
}
