import { describe, expect, it } from 'vitest'
import type { TileMemoryInfo } from '@shared/types'
import { tileUsage } from './tileUsage'

const row = (tileId: string, memoryBytes: number, cpuPercent: number | null = null): TileMemoryInfo => ({
  tileId,
  memoryBytes,
  cpuPercent,
  suspended: false,
  lastActiveAt: 0
})

describe('tileUsage', () => {
  const rows = [
    row('files', 0),
    row('files::pane-preview', 40),
    row('ai', 10, 6),
    row('ai::pane-chat', 200, 30),
    row('notes', 80),
    row('__shell', 300, 12),
    row('filesystem', 999, 99) // another tile whose id starts the same
  ]

  it("adds the tile's sub-views (Files preview, AI Builder chat) to its own figures", () => {
    expect(tileUsage(rows, 'files')).toEqual({ memoryBytes: 40, cpuPercent: null })
    expect(tileUsage(rows, 'ai')).toEqual({ memoryBytes: 210, cpuPercent: 36 })
  })

  it('shows CPU only when some part of the tile is busy', () => {
    expect(tileUsage(rows, 'notes')).toEqual({ memoryBytes: 80, cpuPercent: null })
  })

  it('has nothing for a built-in tile (no row of its own) or before the first report', () => {
    expect(tileUsage(rows, 'terminal-1')).toEqual({ memoryBytes: 0, cpuPercent: null })
    expect(tileUsage(undefined, 'notes')).toEqual({ memoryBytes: 0, cpuPercent: null })
  })
})
