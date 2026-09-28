import { describe, expect, it } from 'vitest'
import { buildMonthGrid, dateKey, eventsByDay, initialMonth } from './calendarGrid'

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

describe('initialMonth', () => {
  it("opens on this month before its last week", () => {
    // Sep 2026: the 30th is a Wednesday, so the last week starts Sunday the 27th.
    expect(initialMonth(new Date(2026, 8, 26))).toEqual({ year: 2026, month: 8 })
  })

  it('opens on next month during the last week, whose grid still contains today', () => {
    expect(initialMonth(new Date(2026, 8, 27))).toEqual({ year: 2026, month: 9 })
    expect(initialMonth(new Date(2026, 8, 30, 23, 59))).toEqual({ year: 2026, month: 9 })
    const grid = buildMonthGrid(2026, 9)
    expect(grid[0].some((c) => dateKey(c.date) === '2026-09-28')).toBe(true)
  })

  it('rolls over the year in late December', () => {
    expect(initialMonth(new Date(2026, 11, 29))).toEqual({ year: 2027, month: 0 })
  })

  it('treats a month ending on Saturday as a full last week', () => {
    // Oct 2026 ends Saturday the 31st; its last week is 25–31.
    expect(initialMonth(new Date(2026, 9, 24))).toEqual({ year: 2026, month: 9 })
    expect(initialMonth(new Date(2026, 9, 25))).toEqual({ year: 2026, month: 10 })
  })
})
