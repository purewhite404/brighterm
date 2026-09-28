import { useEffect, useState } from 'react'
import { SEARCH_ENGINES, resolveAddressInput } from '@shared/types'
import { useAppStore, selectActiveWorkspace } from '../store/appStore'
import { useEmbeddedWebView } from './useEmbeddedWebView'
import { Icon } from '../ui/Icon'

/**
 * A plain browser: address/search bar + back/forward/reload.
 * A new tile starts with just the address bar (no page) unless a home page is
 * configured; the current URL is saved in the tile's config so the page comes
 * back after a restart.
 */
export function BrowserTile({ tileId }: { tileId: string }): React.JSX.Element {
  const tile = useAppStore((s) => selectActiveWorkspace(s)?.tiles[tileId])
  const search = useAppStore((s) => s.config?.search) ?? { engine: 'duckduckgo' as const }
  const snapshot = useAppStore((s) => s.runtime[tileId]?.snapshot)
  const updateTileConfig = useAppStore((s) => s.updateTileConfig)

  const savedUrl = ((tile?.config ?? {}) as { url?: string }).url ?? search.homeUrl
  // Only the first URL creates the view; later ones are navigations.
  const [startUrl, setStartUrl] = useState<string | null>(savedUrl ?? null)
  const [address, setAddress] = useState(savedUrl ?? '')
  const [editing, setEditing] = useState(false)
  const [nav, setNav] = useState({ canGoBack: false, canGoForward: false })

  const ref = useEmbeddedWebView(tileId, startUrl ? { url: startUrl, partitionId: 'browser' } : null)

  useEffect(
    () =>
      window.api.tile.onNavigated((id, state) => {
        if (id !== tileId) return
        setNav({ canGoBack: state.canGoBack, canGoForward: state.canGoForward })
        if (!editing) setAddress(state.url)
        updateTileConfig(tileId, { url: state.url })
      }),
    [tileId, editing, updateTileConfig]
  )

  const go = (): void => {
    if (!address.trim()) return
    const url = resolveAddressInput(address, search.engine)
    setAddress(url)
    setEditing(false)
    updateTileConfig(tileId, { url })
    if (startUrl) void window.api.tile.navigate(tileId, url)
    else setStartUrl(url)
  }

  return (
    <div className="bt-browser">
      <div className="bt-browser__toolbar">
        <button onClick={() => void window.api.tile.goBack(tileId)} disabled={!nav.canGoBack} title="戻る">
          <Icon name="arrow-left" size={14} />
        </button>
        <button onClick={() => void window.api.tile.goForward(tileId)} disabled={!nav.canGoForward} title="進む">
          <Icon name="arrow-right" size={14} />
        </button>
        <button onClick={() => void window.api.tile.reload(tileId)} disabled={!startUrl} title="再読み込み">
          <Icon name="refresh" size={14} />
        </button>
        <input
          className="bt-browser__address"
          value={address}
          spellCheck={false}
          autoFocus={!startUrl}
          placeholder={`${SEARCH_ENGINES[search.engine].label} で検索、または URL を入力`}
          onFocus={(e) => {
            setEditing(true)
            e.currentTarget.select()
          }}
          onBlur={() => setEditing(false)}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go()
            if (e.key === 'Escape') e.currentTarget.blur()
          }}
        />
      </div>
      <div ref={ref} className="bt-web-tile">
        {snapshot && <img src={snapshot} alt="" className="bt-web-tile__snapshot" draggable={false} />}
      </div>
    </div>
  )
}
