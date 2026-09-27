import { useEffect } from 'react'
import { useAppStore, selectActiveWorkspace } from './store/appStore'
import { Dock } from './dock/Dock'
import { TilingView } from './tiling/TilingView'
import { CommandPalette } from './palette/CommandPalette'
import { StatusBar } from './StatusBar'

export function App(): React.JSX.Element {
  const loaded = useAppStore((s) => s.loaded)
  const load = useAppStore((s) => s.load)
  const workspace = useAppStore((s) => selectActiveWorkspace(s))
  const setTileRuntime = useAppStore((s) => s.setTileRuntime)
  const setMemorySnapshot = useAppStore((s) => s.setMemorySnapshot)
  const publishHqCard = useAppStore((s) => s.publishHqCard)
  const removeHqCard = useAppStore((s) => s.removeHqCard)
  const addTile = useAppStore((s) => s.addTile)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const unsubTitle = window.api.tile.onTitleUpdated((tileId, title) => {
      setTileRuntime(tileId, { titleOverride: title })
    })
    const unsubSnapshot = window.api.tile.onSnapshotUpdated((tileId, snapshot) => {
      setTileRuntime(tileId, { snapshot })
    })
    const unsubMemory = window.api.memory.onSnapshot((snapshot) => {
      setMemorySnapshot(snapshot as Parameters<typeof setMemorySnapshot>[0])
    })
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
        <TilingView layout={workspace?.layout ?? null} />
        <StatusBar />
      </div>
      <CommandPalette />
    </div>
  )
}
