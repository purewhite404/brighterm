import { describe, expect, it } from 'vitest'
import { CORE_ROW_ID, SHELL_ROW_ID, summarizeAppMemory } from './appMemory'

describe('summarizeAppMemory', () => {
  const processes = [
    { pid: 1, bytes: 100 }, // main
    { pid: 2, bytes: 50 }, // gpu
    { pid: 10, bytes: 300 }, // shell renderer
    { pid: 20, bytes: 200 } // browser tile
  ]

  it('counts every process in the total, even with no web tiles open', () => {
    const result = summarizeAppMemory(processes.slice(0, 3), new Map(), 10)
    expect(result.totalAppBytes).toBe(450)
    expect(result.rows).toEqual([
      { id: SHELL_ROW_ID, memoryBytes: 300 },
      { id: CORE_ROW_ID, memoryBytes: 150 }
    ])
  })

  it('gives each web view its renderer and leaves the rest to the shell / core rows', () => {
    const result = summarizeAppMemory(processes, new Map([['tile-a', 20], ['tile-b', null]]), 10)
    expect(result.totalAppBytes).toBe(650)
    expect(result.rows).toEqual([
      { id: 'tile-a', memoryBytes: 200 },
      { id: 'tile-b', memoryBytes: 0 },
      { id: SHELL_ROW_ID, memoryBytes: 300 },
      { id: CORE_ROW_ID, memoryBytes: 150 }
    ])
  })
})
