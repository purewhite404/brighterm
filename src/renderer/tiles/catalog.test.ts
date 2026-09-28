import { describe, expect, it } from 'vitest'
import type { PluginListItem } from '../../main/plugins/pluginHost'
import { builtinTile, pluginTile, webTile } from './catalog'

const plugin = (kind: 'web' | 'app'): PluginListItem =>
  ({ manifest: { id: 'p', name: 'P', version: '1.0.0', icon: 'note', kind, url: 'https://p.example/', permissions: [] }, enabled: true }) as unknown as PluginListItem

describe('new tiles', () => {
  it('builtin: title and icon from the catalog, config only when given', () => {
    expect(builtinTile('terminal')).toEqual({ kind: 'builtin', typeId: 'terminal', title: 'Terminal', icon: 'terminal' })
    expect(builtinTile('terminal', { cwd: '/tmp' }).config).toEqual({ cwd: '/tmp' })
  })

  it('web: the definition’s page and session partition', () => {
    expect(webTile({ id: 'w', title: 'W', icon: 'globe', url: 'https://w.example/', partitionId: 'w' })).toEqual({
      kind: 'web',
      typeId: 'w',
      title: 'W',
      icon: 'globe',
      config: { url: 'https://w.example/', partitionId: 'w', compactCss: undefined }
    })
  })

  it('plugin: web plugins get their own partition, app plugins a frame; extra config is merged', () => {
    expect(pluginTile(plugin('web')).config).toEqual({ pluginKind: 'web', pluginId: 'p', url: 'https://p.example/', partitionId: 'plugin-p' })
    expect(pluginTile(plugin('app'), { openRequest: null })).toEqual({
      kind: 'plugin',
      typeId: 'p',
      title: 'P',
      icon: 'note',
      config: { pluginKind: 'app', pluginId: 'p', openRequest: null }
    })
  })
})
