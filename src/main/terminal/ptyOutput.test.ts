import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PtyOutput } from './ptyOutput'

describe('PtyOutput', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends a burst of chunks as one message, shortly after the first', () => {
    const sent: string[] = []
    const out = new PtyOutput((d) => sent.push(d), 1000, 5)
    out.push('a')
    out.push('b')
    out.push('c')
    expect(sent).toEqual([])
    vi.advanceTimersByTime(5)
    expect(sent).toEqual(['abc'])
    out.push('d')
    vi.advanceTimersByTime(5)
    expect(sent).toEqual(['abc', 'd'])
  })

  it('flush() sends what is waiting right away, and only once', () => {
    const sent: string[] = []
    const out = new PtyOutput((d) => sent.push(d), 1000, 5)
    out.push('x')
    out.flush()
    expect(sent).toEqual(['x'])
    vi.advanceTimersByTime(50)
    expect(sent).toEqual(['x'])
    out.flush()
    expect(sent).toEqual(['x'])
  })

  it('keeps the most recent `limit` characters as the backlog, in order', () => {
    const out = new PtyOutput(() => {}, 10, 5)
    for (const c of ['012', '345', '678', '9ab', 'cde']) out.push(c)
    expect(out.backlog()).toBe('56789abcde')
    out.push('f')
    expect(out.backlog()).toBe('6789abcdef')
    expect(out.hasOutput).toBe(true)
  })

  it('keeps a single chunk bigger than the limit, cut to the limit', () => {
    const out = new PtyOutput(() => {}, 4, 5)
    out.push('abcdefgh')
    expect(out.backlog()).toBe('efgh')
  })

  it("doesn't keep much more than the limit however much is printed", () => {
    const out = new PtyOutput(() => {}, 1000, 5)
    for (let i = 0; i < 10_000; i++) out.push('line of output\r\n')
    expect(out.backlog().length).toBe(1000)
    expect((out as unknown as { size: number }).size).toBeLessThan(1000 + 20)
  })

  it('dispose() drops what was not sent', () => {
    const sent: string[] = []
    const out = new PtyOutput((d) => sent.push(d), 1000, 5)
    out.push('lost')
    out.dispose()
    vi.advanceTimersByTime(50)
    expect(sent).toEqual([])
  })
})
