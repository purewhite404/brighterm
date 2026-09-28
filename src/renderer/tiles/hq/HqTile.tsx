import { useAppStore } from '../../store/appStore'
import { Icon } from '../../ui/Icon'
import { GoogleConnectPanel } from '../../ui/GoogleConnectPanel'
import type { Card } from '@shared/types'
import './hq.css'

function priorityIcon(priority: Card['priority']): string {
  return priority === 'urgent' || priority === 'high' ? 'alert' : 'command'
}

function CardRow({ card }: { card: Card }): React.JSX.Element {
  const addTile = useAppStore((s) => s.addTile)

  const handleClick = (): void => {
    if (card.action?.url) {
      void window.api.shells.openExternal(card.action.url)
      return
    }
    if (card.action?.openTileTypeId) {
      addTile({
        kind: 'builtin',
        typeId: card.action.openTileTypeId,
        title: card.action.label,
        icon: 'command'
      })
    }
  }

  return (
    <button
      className={`bt-card bt-card--${card.priority}`}
      onClick={handleClick}
      disabled={!card.action}
    >
      <Icon name={priorityIcon(card.priority)} size={16} className="bt-card__icon" />
      <div className="bt-card__body">
        <div className="bt-card__title">{card.title}</div>
        {card.detail && <div className="bt-card__detail">{card.detail}</div>}
        <div className="bt-card__source">{card.source}</div>
      </div>
      {card.action && <span className="bt-card__action">{card.action.label}</span>}
    </button>
  )
}

export function HqTile(): React.JSX.Element {
  const cards = useAppStore((s) => s.hqCards)

  return (
    <div className="bt-tile-body bt-hq">
      <div className="bt-hq__header">
        <Icon name="command" size={18} />
        <span>司令部</span>
      </div>
      <GoogleConnectPanel />
      {cards.length === 0 ? (
        <div className="bt-tile-body--centered bt-text-muted">
          今のところ対応が必要なものはありません。
          <br />
          Google カレンダーや Slack プラグインを設定すると、ここにカードが並びます。
        </div>
      ) : (
        <div className="bt-hq__list">
          {cards.map((card) => (
            <CardRow key={card.id} card={card} />
          ))}
        </div>
      )}
    </div>
  )
}
