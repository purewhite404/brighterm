import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { Icon } from '../../ui/Icon'
import { GoogleConnectPanel } from '../../ui/GoogleConnectPanel'
import { buildMonthGrid, dateKey, eventsByDay, initialMonth, type CalendarEventLike } from './calendarGrid'
import './calendar.css'

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/**
 * Built-in calendar. By default it only shows dates (no account needed);
 * with Google connected and enabled in its toolbar, the month's Google
 * Calendar events are overlaid.
 */
export function CalendarTile(): React.JSX.Element {
  const source = useAppStore((s) => s.config?.calendar.source ?? 'none')
  const updateConfig = useAppStore((s) => s.updateConfig)

  const today = new Date()
  const [cursor, setCursor] = useState(() => initialMonth(today))
  const [selected, setSelected] = useState(dateKey(today))
  const [events, setEvents] = useState<CalendarEventLike[]>([])
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null)
  const [showConnect, setShowConnect] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor])

  useEffect(() => {
    void window.api.google.isConnected().then(setGoogleConnected)
  }, [])

  useEffect(() => {
    if (source !== 'google' || !googleConnected) {
      setEvents([])
      return
    }
    let cancelled = false
    const first = grid[0][0].date
    const last = new Date(grid[grid.length - 1][6].date)
    last.setDate(last.getDate() + 1)
    window.api.google
      .listEvents(first.toISOString(), last.toISOString())
      .then((list) => {
        if (!cancelled) {
          setEvents(list)
          setError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [grid, source, googleConnected])

  const byDay = useMemo(() => eventsByDay(events), [events])
  const todayKey = dateKey(today)
  const selectedEvents = byDay.get(selected) ?? []

  const shiftMonth = (delta: number): void => {
    setCursor(({ year, month }) => {
      const d = new Date(year, month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }

  return (
    <div className="bt-tile-body bt-calendar">
      <div className="bt-calendar__toolbar">
        <button onClick={() => shiftMonth(-1)} title="前の月">
          <Icon name="chevron-left" size={14} />
        </button>
        <div className="bt-calendar__title">
          {cursor.year}年 {cursor.month + 1}月
        </div>
        <button onClick={() => shiftMonth(1)} title="次の月">
          <Icon name="chevron-right" size={14} />
        </button>
        <button
          onClick={() => {
            setCursor({ year: today.getFullYear(), month: today.getMonth() })
            setSelected(todayKey)
          }}
        >
          今日
        </button>
        <div style={{ flex: 1 }} />
        {source === 'google' && googleConnected ? (
          <button onClick={() => updateConfig({ calendar: { source: 'none' } })} title="Google カレンダーの予定を隠す">
            <Icon name="calendar" size={14} /> Google 表示中
          </button>
        ) : googleConnected ? (
          <button onClick={() => updateConfig({ calendar: { source: 'google' } })}>Google の予定を表示</button>
        ) : (
          <button onClick={() => setShowConnect((v) => !v)}>Google カレンダーと連携</button>
        )}
      </div>

      {showConnect && !googleConnected && (
        <GoogleConnectPanel
          title="Google カレンダーと連携（任意）"
          description="予定をこのカレンダーに表示します。"
          onConnected={() => {
            setGoogleConnected(true)
            setShowConnect(false)
            updateConfig({ calendar: { source: 'google' } })
          }}
        />
      )}
      {error && <div className="bt-message bt-message--error">{error}</div>}

      <div className="bt-calendar__grid">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={`bt-calendar__weekday${i === 0 ? ' is-sun' : i === 6 ? ' is-sat' : ''}`}>
            {w}
          </div>
        ))}
        {grid.flat().map((cell) => {
          const key = dateKey(cell.date)
          const dayEvents = byDay.get(key) ?? []
          const weekday = cell.date.getDay()
          return (
            <button
              key={key}
              className={[
                'bt-calendar__day',
                cell.inMonth ? '' : 'is-outside',
                key === todayKey ? 'is-today' : '',
                key === selected ? 'is-selected' : '',
                weekday === 0 ? 'is-sun' : weekday === 6 ? 'is-sat' : ''
              ].join(' ')}
              onClick={() => setSelected(key)}
            >
              <span className="bt-calendar__date">{cell.date.getDate()}</span>
              {dayEvents.slice(0, 3).map((e) => (
                <span key={e.id} className="bt-calendar__event-chip" title={e.title}>
                  {e.title}
                </span>
              ))}
              {dayEvents.length > 3 && <span className="bt-calendar__more">+{dayEvents.length - 3}</span>}
            </button>
          )
        })}
      </div>

      {source === 'google' && googleConnected && (
        <div className="bt-calendar__agenda">
          <div className="bt-section-title">{selected.replace(/-/g, '/')} の予定</div>
          {selectedEvents.length === 0 ? (
            <div className="bt-text-muted">予定はありません</div>
          ) : (
            selectedEvents.map((e) => (
              <button
                key={e.id}
                className="bt-calendar__agenda-row"
                onClick={() => e.url && void window.api.shells.openExternal(e.url)}
              >
                <span className="bt-calendar__agenda-time">
                  {e.allDay
                    ? '終日'
                    : new Date(e.start).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span>{e.title}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
