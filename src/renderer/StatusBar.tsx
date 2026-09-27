import { useAppStore, selectActiveWorkspace } from './store/appStore'
import { listTileIds } from './tiling/layout'
import { Icon } from './ui/Icon'

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb < 1024 ? `${mb.toFixed(0)} MB` : `${(mb / 1024).toFixed(2)} GB`
}

export function StatusBar(): React.JSX.Element {
  const memorySnapshot = useAppStore((s) => s.memorySnapshot)
  const workspace = useAppStore((s) => selectActiveWorkspace(s))
  const cardCount = useAppStore((s) => s.hqCards.length)

  const tileCount = workspace ? listTileIds(workspace.layout).length : 0
  const used = memorySnapshot?.totalAppBytes ?? 0
  const budget = memorySnapshot?.budgetBytes ?? 0
  const overBudget = budget > 0 && used > budget

  return (
    <div className="bt-statusbar">
      <span className="bt-statusbar__item">
        <Icon name="activity" size={12} /> {tileCount} タイル
      </span>
      <span className={`bt-statusbar__item${overBudget ? ' bt-statusbar__item--warning' : ''}`}>
        {formatBytes(used)}
        {budget > 0 ? ` / ${formatBytes(budget)}` : ''}
      </span>
      {cardCount > 0 && (
        <span className="bt-statusbar__item">
          <Icon name="command" size={12} /> {cardCount} 件の対応事項
        </span>
      )}
    </div>
  )
}
