import { useAppStore } from '../../store/appStore'
import { useEmbeddedWebView, type WebViewSource } from './useEmbeddedWebView'

/**
 * The DOM placeholder of a web view (see useEmbeddedWebView). The page itself
 * is a WebContentsView the main process draws exactly over this div; while
 * it's suspended or hidden behind an overlay (open Dock, drag & drop), the last
 * screenshot is shown here instead.
 */
export function EmbeddedWebView({
  viewId,
  source,
  className
}: {
  viewId: string
  /** null: no page yet (a new Browser tile). */
  source: WebViewSource | null
  className?: string
}): React.JSX.Element {
  const snapshot = useAppStore((s) => s.runtime[viewId]?.snapshot)
  const ref = useEmbeddedWebView(viewId, source)
  return (
    <div ref={ref} className={className ? `bt-web-tile ${className}` : 'bt-web-tile'}>
      {snapshot && <img src={snapshot} alt="" className="bt-web-tile__snapshot" draggable={false} />}
    </div>
  )
}
