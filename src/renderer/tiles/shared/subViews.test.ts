import { describe, expect, it } from 'vitest'
import { baseTileId, sidePaneId, subViewId, titledTileId } from './subViews'

describe('sub-view ids', () => {
  it('belong to their tile', () => {
    expect(baseTileId(subViewId('tile-1', 'gmail'))).toBe('tile-1')
    expect(baseTileId(sidePaneId('tile-1', 'chat'))).toBe('tile-1')
    expect(baseTileId('tile-1')).toBe('tile-1')
  })

  it('title their tile, except side panes', () => {
    expect(titledTileId('tile-1')).toBe('tile-1')
    expect(titledTileId(subViewId('tile-1', 'gmail'))).toBe('tile-1')
    expect(titledTileId(sidePaneId('tile-1', 'preview'))).toBeNull()
  })
})
