import type { TileMemoryInfo } from '@shared/types'
import { baseTileId } from '../tiles/shared/subViews'

/**
 * What a tile header shows: the memory of the tile's own web view / plugin frame
 * plus its sub-views (the Files preview, the AI Builder chat, Mail's other
 * providers), and CPU when any of them is busy. Built-in tiles have no row of
 * their own (they share the UI process), so nothing.
 */
export function tileUsage(rows: TileMemoryInfo[] | undefined, tileId: string): { memoryBytes: number; cpuPercent: number | null } {
  let memoryBytes = 0
  let cpuPercent: number | null = null
  for (const row of rows ?? []) {
    if (baseTileId(row.tileId) !== tileId) continue
    memoryBytes += row.memoryBytes
    if (row.cpuPercent !== null) cpuPercent = (cpuPercent ?? 0) + row.cpuPercent
  }
  return { memoryBytes, cpuPercent }
}
