import { useEffect } from 'react'
import { useAppStore, selectActiveWorkspace } from './store/appStore'
import { Dock } from './dock/Dock'
import { TilingView } from './tiling/TilingView'
import { StatusBar } from './StatusBar'
import { titledTileId } from './tiles/shared/subViews'

export function App(): React.JSX.Element {
  const loaded = useAppStore((s) => s.loaded)
  const load = useAppStore((s) => s.load)
  // Only the layout: the workspace object changes whenever any tile saves its config (a Browser's URL…).
  const layout = useAppStore((s) => selectActiveWorkspace(s)?.layout ?? null)
  const setTileRuntime = useAppStore((s) => s.setTileRuntime)
  const setMemorySnapshot = useAppStore((s) => s.setMemorySnapshot)
  const publishHqCard = useAppStore((s) => s.publishHqCard)
  const removeHqCard = useAppStore((s) => s.removeHqCard)
  const addTile = useAppStore((s) => s.addTile)
  // Web views are native views drawn over the DOM. While the Dock is open over the tiles, a tile
  // is dragged or a splitter moved, they're swapped for snapshots so the shell's DOM shows on
  // top. One place decides: overlay.show/hide is a plain on/off in main, so two callers each
  // hiding "their" overlay used to bring the views back while the other still needed it gone.
  const overlay = useAppStore((s) => s.dockOpen || s.tileDrag !== null || s.resizing)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!overlay) return
    void window.api.overlay.show()
    return () => void window.api.overlay.hide()
  }, [overlay])

  useEffect(() => {
    const unsubTitle = window.api.tile.onTitleUpdated((viewId, title) => {
      // Sub-views title their tile too — except side panes (the AI Builder chat, the Files preview).
      const tileId = titledTileId(viewId)
      if (tileId) setTileRuntime(tileId, { titleOverride: title })
    })
    const unsubSnapshot = window.api.tile.onSnapshotUpdated((tileId, snapshot) => {
      setTileRuntime(tileId, { snapshot })
    })
    const unsubMemory = window.api.memory.onSnapshot((snapshot) => setMemorySnapshot(snapshot))
    const unsubCardPublished = window.api.hq.onCardPublished((card) => publishHqCard(card))
    const unsubCardCleared = window.api.hq.onCardCleared((cardId) => removeHqCard(cardId))
    const unsubOpenTile = window.api.plugins.onRequestOpenTile((builtinTypeId) => {
      addTile({ kind: 'builtin', typeId: builtinTypeId, title: builtinTypeId, icon: 'command' })
    })

    return () => {
      unsubTitle()
      unsubSnapshot()
      unsubMemory()
      unsubCardPublished()
      unsubCardCleared()
      unsubOpenTile()
    }
  }, [setTileRuntime, setMemorySnapshot, publishHqCard, removeHqCard, addTile])

  if (!loaded) {
    return <div className="bt-boot-screen">Brighterm を起動しています…</div>
  }

  return (
    <div className="bt-app">
      <Dock />
      <div className="bt-app__main">
        <TilingView layout={layout} />
        <StatusBar />
      </div>
    </div>
  )
}
