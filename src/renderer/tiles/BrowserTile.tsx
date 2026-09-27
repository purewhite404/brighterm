import { useEffect, useState } from 'react'
import { SEARCH_ENGINES, resolveAddressInput } from '@shared/types'
import { useAppStore, selectActiveWorkspace } from '../store/appStore'
import { useEmbeddedWebView } from './useEmbeddedWebView'
import { Icon } from '../ui/Icon'

/** A plain browser: address/search bar (DuckDuckGo by default) + back/forward/reload. */
export function BrowserTile({ tileId }: { tileId: string }): React.JSX.Element {
  const tile = useAppStore((s) => selectActiveWorkspace(s)?.tiles[tileId])
  const search = useAppStore((s) => s.config?.search) ?? { engine: 'duckduckgo' as const }
  const snapshot = useAppStore((s) => s.runtime[tileId]?.snapshot)

  const startUrl =
    ((tile?.config ?? {}) as { url?: string }).url ?? search.homeUrl ?? SEARCH_ENGINES[search.engine].home
  const [address, setAddress] = useState(startUrl)
  const [editing, setEditing] = useState(false)
  const [nav, setNav] = useState({ canGoBack: false, canGoForward: false })

  const ref = useEmbeddedWebView(tileId, { url: startUrl, partitionId: 'browser' })

  useEffect(
    () =>
      window.api.tile.onNavigated((id, state) => {
        if (id !== tileId) return
        setNav({ canGoBack: state.canGoBack, canGoForward: state.canGoForward })
        if (!editing) setAddress(state.url)
      }),
    [tileId, editing]
  )

  const go = (): void => {
    const url = resolveAddressInput(address, search.engine)
    setAddress(url)
    setEditing(false)
    void window.api.tile.navigate(tileId, url)
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
        <button onClick={() => void window.api.tile.reload(tileId)} title="再読み込み">
          <Icon name="refresh" size={14} />
        </button>
        <input
          className="bt-browser__address"
          value={address}
          spellCheck={false}
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
