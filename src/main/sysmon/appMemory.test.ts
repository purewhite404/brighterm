import { describe, expect, it } from 'vitest'
import { CORE_ROW_ID, SHELL_ROW_ID, summarizeAppMemory } from './appMemory'

describe('summarizeAppMemory', () => {
  const processes = [
    { pid: 1, bytes: 100, cpuPercent: 1 }, // main
    { pid: 2, bytes: 50, cpuPercent: 2 }, // gpu
    { pid: 10, bytes: 300, cpuPercent: 3 }, // shell renderer
    { pid: 20, bytes: 200, cpuPercent: 40 }, // browser tile
    { pid: 30, bytes: 80, cpuPercent: 7 } // a plugin tile's iframe
  ]

  it('counts every process in the total, even with no web tiles open', () => {
    const result = summarizeAppMemory(processes.slice(0, 3), new Map(), 10)
    expect(result.totalAppBytes).toBe(450)
    expect(result.rows).toEqual([
      { id: SHELL_ROW_ID, memoryBytes: 300, cpuPercent: 3 },
      { id: CORE_ROW_ID, memoryBytes: 150, cpuPercent: 3 }
    ])
  })

  it('gives each web view and plugin frame its process and leaves the rest to the shell / core rows', () => {
    const result = summarizeAppMemory(processes, new Map([['tile-a', 20], ['tile-b', null], ['plugin-tile', 30]]), 10)
    expect(result.totalAppBytes).toBe(730)
    expect(result.rows).toEqual([
      { id: 'tile-a', memoryBytes: 200, cpuPercent: 40 },
      { id: 'tile-b', memoryBytes: 0, cpuPercent: 0 },
      { id: 'plugin-tile', memoryBytes: 80, cpuPercent: 7 },
      { id: SHELL_ROW_ID, memoryBytes: 300, cpuPercent: 3 },
      { id: CORE_ROW_ID, memoryBytes: 150, cpuPercent: 3 }
    ])
  })

  it("leaves a frame that runs in the shell's own process in the shell row (not counted twice)", () => {
    const result = summarizeAppMemory(processes.slice(0, 3), new Map([['plugin-tile', 10]]), 10)
    expect(result.rows).toEqual([
      { id: 'plugin-tile', memoryBytes: 0, cpuPercent: 0 },
      { id: SHELL_ROW_ID, memoryBytes: 300, cpuPercent: 3 },
      { id: CORE_ROW_ID, memoryBytes: 150, cpuPercent: 3 }
    ])
  })
})
