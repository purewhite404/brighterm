import { describe, expect, it } from 'vitest'
import { formatBytes, formatTileMemory } from './formatBytes'

describe('formatBytes', () => {
  it('shows values under 1 MB in kB instead of rounding them to 0 MB', () => {
    expect(formatBytes(0)).toBe('0 kB')
    expect(formatBytes(512)).toBe('0.5 kB')
    expect(formatBytes(300 * 1024)).toBe('300 kB')
  })

  it('uses MB and GB for larger values', () => {
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB')
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.50 GB')
  })
})

describe('formatTileMemory', () => {
  it('is empty for nothing, whole MB below 1 GB, one decimal above', () => {
    expect(formatTileMemory(0)).toBe('')
    expect(formatTileMemory(250 * 1024 * 1024)).toBe('250 MB')
    expect(formatTileMemory(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB')
  })
})
