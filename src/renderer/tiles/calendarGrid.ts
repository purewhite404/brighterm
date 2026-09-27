/** Pure date helpers for the Calendar tile (unit-tested in calendarGrid.test.ts). */

export interface CalendarCell {
  date: Date
  inMonth: boolean
}

export interface CalendarEventLike {
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
  url?: string
}

/** Local-time YYYY-MM-DD. */
export function dateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Sunday-first weeks covering the whole month (5 or 6 rows), padded with adjacent months' days. */
export function buildMonthGrid(year: number, month: number): CalendarCell[][] {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  const lastOfMonth = new Date(year, month + 1, 0)
  const weeks: CalendarCell[][] = []
  const cursor = new Date(start)
  while (weeks.length === 0 || cursor <= lastOfMonth) {
    const week: CalendarCell[] = []
    for (let i = 0; i < 7; i++) {
      week.push({ date: new Date(cursor), inMonth: cursor.getMonth() === month })
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}

/** Parses an event boundary: all-day "YYYY-MM-DD" is a local date, not UTC midnight. */
function parseBoundary(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value)
}

/**
 * Groups events by every local day they touch. All-day events use Google's
 * exclusive end date (an event on the 3rd has end = the 4th).
 */
export function eventsByDay(events: CalendarEventLike[]): Map<string, CalendarEventLike[]> {
  const map = new Map<string, CalendarEventLike[]>()
  for (const event of events) {
    const start = parseBoundary(event.start)
    let end = parseBoundary(event.end)
    if (event.allDay) end = new Date(end.getTime() - 1)
    if (end < start) end = start
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate())
    while (day <= end) {
      const key = dateKey(day)
      map.set(key, [...(map.get(key) ?? []), event])
      day.setDate(day.getDate() + 1)
    }
  }
  return map
}
