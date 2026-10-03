import { describe, expect, it } from 'vitest'
import type { AppConfig, TileInstance } from '@shared/types'
import { terminalsToPrewarm } from './prewarm'

const tile = (id: string, typeId: string, config?: Record<string, unknown>, kind: TileInstance['kind'] = 'builtin'): TileInstance => ({
  id,
  kind,
  typeId,
  title: typeId,
  config
})

function configWith(active: string): AppConfig {
  return {
    activeWorkspaceId: active,
    workspaces: [
      {
        id: 'home',
        name: 'Home',
        icon: 'home',
        layout: null,
        tiles: {
          t1: tile('t1', 'terminal', { shellId: 'pwsh7', cwd: 'C:\\work' }),
          f1: tile('f1', 'file-explorer'),
          t2: tile('t2', 'terminal'),
          p1: tile('p1', 'terminal', {}, 'plugin')
        }
      },
      { id: 'other', name: 'Other', icon: 'home', layout: null, tiles: { t3: tile('t3', 'terminal') } }
    ]
  } as unknown as AppConfig
}

describe('terminalsToPrewarm', () => {
  it("returns the active workspace's Terminal tiles with their shell and folder", () => {
    expect(terminalsToPrewarm(configWith('home'))).toEqual([
      { tileId: 't1', shellId: 'pwsh7', cwd: 'C:\\work' },
      { tileId: 't2', shellId: undefined, cwd: undefined }
    ])
  })

  it('leaves other workspaces alone (their tiles mount only when shown)', () => {
    expect(terminalsToPrewarm(configWith('other'))).toEqual([{ tileId: 't3', shellId: undefined, cwd: undefined }])
  })

  it('copes with a missing active workspace and junk config values', () => {
    expect(terminalsToPrewarm(configWith('gone'))).toEqual([])
    const config = configWith('home')
    config.workspaces[0].tiles = { t: tile('t', 'terminal', { shellId: 42, cwd: null }) }
    expect(terminalsToPrewarm(config)).toEqual([{ tileId: 't', shellId: undefined, cwd: undefined }])
  })
})
