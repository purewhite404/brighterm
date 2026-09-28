import { useAppStore, selectActiveWorkspace } from './store/appStore'
import { listTileIds } from './tiling/layout'
import { Icon } from './ui/Icon'
import { formatBytes } from './ui/formatBytes'

export function StatusBar(): React.JSX.Element {
  const memorySnapshot = useAppStore((s) => s.memorySnapshot)
  const workspace = useAppStore((s) => selectActiveWorkspace(s))
  const cardCount = useAppStore((s) => s.hqCards.length)

  const tileCount = workspace ? listTileIds(workspace.layout).length : 0
  const used = memorySnapshot?.totalAppBytes ?? 0

  return (
    <div className="bt-statusbar">
      <span className="bt-statusbar__item">
        <Icon name="activity" size={12} /> {tileCount} タイル
      </span>
      <span className="bt-statusbar__item" title="Brighterm 全体のメモリ使用量">
        {formatBytes(used)}
      </span>
      {cardCount > 0 && (
        <span className="bt-statusbar__item">
          <Icon name="command" size={12} /> {cardCount} 件の対応事項
        </span>
      )}
    </div>
  )
}
