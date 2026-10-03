import { describe, expect, it } from 'vitest'
import { CpuBadges, HIDE_BELOW, SHOW_AT } from './cpuBadges'

const feed = (badges: CpuBadges, id: string, values: number[]): Array<number | null> =>
  values.map((cpuPercent) => badges.update([{ id, cpuPercent }]).get(id) ?? null)

describe('CpuBadges', () => {
  it('stays quiet while a row is (nearly) idle', () => {
    expect(feed(new CpuBadges(), 'tile', [0, 1, 2, 0.5, 2, 1])).toEqual([null, null, null, null, null, null])
  })

  it('ignores a single short spike', () => {
    expect(feed(new CpuBadges(), 'tile', [0, 0, 0, 12, 0, 0])).toEqual([null, null, null, null, null, null])
  })

  it('shows a busy row, rounded, and hides it once it calms down', () => {
    const shown = feed(new CpuBadges(), 'tile', [100, 100, 100, 100, 0, 0, 0, 0])
    expect(shown.slice(0, 4)).toEqual([100, 100, 100, 100])
    expect(shown.slice(4, 7)).toEqual([75, 50, 25])
    expect(shown[7]).toBeNull()
  })

  it(`doesn't blink around the threshold: appears at ${SHOW_AT} %, leaves below ${HIDE_BELOW} %`, () => {
    const badges = new CpuBadges()
    expect(feed(badges, 'tile', [5, 5, 5, 5])).toEqual([5, 5, 5, 5])
    expect(feed(badges, 'tile', [4, 4, 4, 4])).toEqual([5, 5, 4, 4]) // between the two: still shown
    expect(feed(badges, 'tile', [2, 2, 2, 2])).toEqual([4, 3, null, null])
    expect(feed(badges, 'tile', [4, 4, 4, 4])).toEqual([null, null, null, null]) // between: still hidden
  })

  it('keeps rows apart and forgets rows that are gone', () => {
    const badges = new CpuBadges()
    for (let i = 0; i < 4; i++) badges.update([{ id: 'a', cpuPercent: 50 }, { id: 'b', cpuPercent: 0 }])
    const now = badges.update([{ id: 'a', cpuPercent: 50 }, { id: 'b', cpuPercent: 0 }])
    expect(now.get('a')).toBe(50)
    expect(now.get('b')).toBeNull()
    badges.update([{ id: 'b', cpuPercent: 0 }]) // "a" closed
    expect(badges.update([{ id: 'a', cpuPercent: 0 }]).get('a')).toBeNull() // back, without its old history
  })

  it('treats a missing or broken figure as idle', () => {
    expect(feed(new CpuBadges(), 'tile', [Number.NaN, -3, 0, 0])).toEqual([null, null, null, null])
  })
})
