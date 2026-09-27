import { describe, expect, it } from 'vitest'
import { diffLines } from './diff'

describe('diffLines', () => {
  it('reports no changes for identical input', () => {
    const ops = diffLines('a\nb\nc', 'a\nb\nc')
    expect(ops.every((op) => op.type === 'equal')).toBe(true)
    expect(ops.map((op) => op.line)).toEqual(['a', 'b', 'c'])
  })

  it('detects a single added line', () => {
    const ops = diffLines('a\nb', 'a\nx\nb')
    expect(ops).toEqual([
      { type: 'equal', line: 'a' },
      { type: 'add', line: 'x' },
      { type: 'equal', line: 'b' }
    ])
  })

  it('detects a single removed line', () => {
    const ops = diffLines('a\nx\nb', 'a\nb')
    expect(ops).toEqual([
      { type: 'equal', line: 'a' },
      { type: 'remove', line: 'x' },
      { type: 'equal', line: 'b' }
    ])
  })

  it('detects a replaced line as remove+add', () => {
    const ops = diffLines('127.0.0.1 localhost', '127.0.0.1 localhost.localdomain')
    expect(ops).toEqual([
      { type: 'remove', line: '127.0.0.1 localhost' },
      { type: 'add', line: '127.0.0.1 localhost.localdomain' }
    ])
  })

  it('handles empty-to-nonempty', () => {
    const ops = diffLines('', 'a\nb')
    // splitting '' on '\n' yields [''] so the first op is a remove of the empty line
    expect(ops.filter((o) => o.type === 'add').map((o) => o.line)).toEqual(['a', 'b'])
  })

  it('handles a fully rewritten file', () => {
    const ops = diffLines('one\ntwo', 'three\nfour')
    expect(ops.filter((o) => o.type === 'equal')).toHaveLength(0)
    expect(ops.filter((o) => o.type === 'remove').map((o) => o.line)).toEqual(['one', 'two'])
    expect(ops.filter((o) => o.type === 'add').map((o) => o.line)).toEqual(['three', 'four'])
  })
})
