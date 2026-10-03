import { describe, expect, it } from 'vitest'
import { pluginFrameName, tileIdOfPluginFrame } from './pluginFrame'

describe('plugin frame names', () => {
  it('round-trips a tile id', () => {
    expect(tileIdOfPluginFrame(pluginFrameName('tile-1-abc'))).toBe('tile-1-abc')
  })
  it('ignores frames that are not a plugin tile', () => {
    expect(tileIdOfPluginFrame('')).toBeNull()
    expect(tileIdOfPluginFrame('something-else')).toBeNull()
    expect(tileIdOfPluginFrame('bt-tile:')).toBeNull()
  })
})
