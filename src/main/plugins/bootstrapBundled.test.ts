import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginHost } from './pluginHost'
import { installBundledPlugins } from './bootstrapBundled'

function writeManifest(dir: string, manifest: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf-8')
}

describe('installBundledPlugins', () => {
  let pluginsDir: string
  let builtinDir: string
  let pluginHost: PluginHost

  beforeEach(() => {
    pluginsDir = mkdtempSync(join(tmpdir(), 'brighterm-plugins-'))
    builtinDir = mkdtempSync(join(tmpdir(), 'brighterm-builtin-'))
    pluginHost = new PluginHost(pluginsDir)
  })

  afterEach(() => {
    rmSync(pluginsDir, { recursive: true, force: true })
    rmSync(builtinDir, { recursive: true, force: true })
  })

  it('installs every plugin found under the builtin directory', () => {
    writeManifest(join(builtinDir, 'notes'), {
      id: 'notes',
      name: 'Notes',
      version: '1.0.0',
      icon: 'note',
      kind: 'web',
      url: 'https://example.com',
      permissions: []
    })
    writeManifest(join(builtinDir, 'slack'), {
      id: 'slack',
      name: 'Slack',
      version: '1.0.0',
      icon: 'slack',
      kind: 'web',
      url: 'https://app.slack.com/client',
      permissions: []
    })

    installBundledPlugins(pluginHost, builtinDir)

    const ids = pluginHost.list().map((p) => p.manifest.id)
    expect(ids.sort()).toEqual(['notes', 'slack'])
  })

  it('reads nested files (not just manifest.json) for an app-kind plugin', () => {
    const dir = join(builtinDir, 'notes')
    writeManifest(dir, {
      id: 'notes',
      name: 'Notes',
      version: '1.0.0',
      icon: 'note',
      kind: 'app',
      entry: 'index.html',
      permissions: []
    })
    writeFileSync(join(dir, 'index.html'), '<html></html>', 'utf-8')
    writeFileSync(join(dir, 'main.js'), 'console.log(1)', 'utf-8')

    installBundledPlugins(pluginHost, builtinDir)
    expect(pluginHost.list()).toHaveLength(1)
    expect(pluginHost.list()[0].manifest.entry).toBe('index.html')
  })

  it('disables ids listed in defaultDisabledIds only on first install', () => {
    writeManifest(join(builtinDir, 'slack'), {
      id: 'slack',
      name: 'Slack',
      version: '1.0.0',
      icon: 'slack',
      kind: 'web',
      url: 'https://app.slack.com/client',
      permissions: []
    })

    installBundledPlugins(pluginHost, builtinDir, ['slack'])
    expect(pluginHost.list()[0].enabled).toBe(false)

    // The user re-enables it; a later re-install (e.g. app restart) must not
    // silently flip it back off.
    pluginHost.setEnabled('slack', true)
    installBundledPlugins(pluginHost, builtinDir, ['slack'])
    expect(pluginHost.list()[0].enabled).toBe(true)
  })

  it('does not disable ids absent from defaultDisabledIds', () => {
    writeManifest(join(builtinDir, 'notes'), {
      id: 'notes',
      name: 'Notes',
      version: '1.0.0',
      icon: 'note',
      kind: 'web',
      url: 'https://example.com',
      permissions: []
    })
    installBundledPlugins(pluginHost, builtinDir, ['slack'])
    expect(pluginHost.list()[0].enabled).toBe(true)
  })

  it('continues installing other plugins when one has an invalid manifest', () => {
    writeManifest(join(builtinDir, 'broken'), { id: 'Not Valid!' })
    writeManifest(join(builtinDir, 'notes'), {
      id: 'notes',
      name: 'Notes',
      version: '1.0.0',
      icon: 'note',
      kind: 'web',
      url: 'https://example.com',
      permissions: []
    })

    installBundledPlugins(pluginHost, builtinDir)
    const ids = pluginHost.list().map((p) => p.manifest.id)
    expect(ids).toEqual(['notes'])
  })

  it('does not throw when the builtin directory does not exist', () => {
    expect(() => installBundledPlugins(pluginHost, join(builtinDir, 'nonexistent'))).not.toThrow()
    expect(pluginHost.list()).toEqual([])
  })

  it('re-running picks up updated file contents for the same version (ships a fix)', () => {
    const dir = join(builtinDir, 'notes')
    writeManifest(dir, {
      id: 'notes',
      name: 'Notes',
      version: '1.0.0',
      icon: 'note',
      kind: 'app',
      entry: 'index.html',
      permissions: []
    })
    writeFileSync(join(dir, 'index.html'), '<html>v1</html>', 'utf-8')
    installBundledPlugins(pluginHost, builtinDir)

    writeFileSync(join(dir, 'index.html'), '<html>v2</html>', 'utf-8')
    installBundledPlugins(pluginHost, builtinDir)

    const written = readFileSync(join(pluginsDir, 'notes', '1.0.0', 'index.html'), 'utf-8')
    expect(written).toBe('<html>v2</html>')
  })
})
