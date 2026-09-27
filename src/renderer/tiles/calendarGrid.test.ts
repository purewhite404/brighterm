import { describe, expect, it } from 'vitest'
import { buildMonthGrid, dateKey, eventsByDay } from './calendarGrid'

describe('buildMonthGrid', () => {
  it('starts on a Sunday and covers the whole month', () => {
    const grid = buildMonthGrid(2026, 8) // September 2026 starts on a Tuesday
    expect(grid[0][0].date.getDay()).toBe(0)
    expect(dateKey(grid[0][0].date)).toBe('2026-08-30')
    const inMonth = grid.flat().filter((c) => c.inMonth)
    expect(inMonth).toHaveLength(30)
    expect(grid.every((week) => week.length === 7)).toBe(true)
  })

  it('handles a month that starts on Sunday', () => {
    const grid = buildMonthGrid(2026, 1) // February 2026 starts on a Sunday
    expect(dateKey(grid[0][0].date)).toBe('2026-02-01')
    expect(grid).toHaveLength(4)
  })
})

describe('eventsByDay', () => {
  it('groups a timed event under its local day', () => {
    const map = eventsByDay([
      { id: 'a', title: 'x', start: new Date(2026, 8, 3, 10).toISOString(), end: new Date(2026, 8, 3, 11).toISOString(), allDay: false }
    ])
    expect([...map.keys()]).toEqual(['2026-09-03'])
  })

  it('treats the all-day end date as exclusive', () => {
    const map = eventsByDay([{ id: 'a', title: 'x', start: '2026-09-03', end: '2026-09-05', allDay: true }])
    expect([...map.keys()]).toEqual(['2026-09-03', '2026-09-04'])
  })

  it('spreads a multi-day timed event over every day it touches', () => {
    const map = eventsByDay([
      { id: 'a', title: 'x', start: new Date(2026, 8, 3, 22).toISOString(), end: new Date(2026, 8, 4, 2).toISOString(), allDay: false }
    ])
    expect([...map.keys()]).toEqual(['2026-09-03', '2026-09-04'])
  })
})
