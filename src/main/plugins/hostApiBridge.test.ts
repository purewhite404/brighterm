import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, sep } from 'node:path'
import { PluginHost } from './pluginHost'
import { PluginHostApiBridge, PermissionDeniedError } from './hostApiBridge'
import type { ParsedBundleFile } from './bundleParser'

function pluginFiles(id: string, permissions: unknown[]): ParsedBundleFile[] {
  return [
    {
      path: 'manifest.json',
      content: JSON.stringify({
        id,
        name: id,
        version: '1.0.0',
        icon: 'note',
        kind: 'app',
        entry: 'index.html',
        permissions
      })
    },
    { path: 'index.html', content: '<html></html>' }
  ]
}

describe('PluginHostApiBridge', () => {
  let pluginsDir: string
  let dataDir: string
  let pluginHost: PluginHost
  let bridge: PluginHostApiBridge
  let publishedCards: unknown[]
  let clearedCardIds: string[]
  /** Folders the tests grant, removed after each test even when it fails. */
  let grantedDirs: string[] = []
  const grantedDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'brighterm-granted-'))
    grantedDirs.push(dir)
    return dir
  }

  beforeEach(() => {
    pluginsDir = mkdtempSync(join(tmpdir(), 'brighterm-plugins-'))
    dataDir = mkdtempSync(join(tmpdir(), 'brighterm-plugin-data-'))
    pluginHost = new PluginHost(pluginsDir)
    publishedCards = []
    clearedCardIds = []
    bridge = new PluginHostApiBridge(
      pluginHost,
      dataDir,
      (card) => publishedCards.push(card),
      (id) => clearedCardIds.push(id)
    )
  })

  afterEach(() => {
    rmSync(pluginsDir, { recursive: true, force: true })
    rmSync(dataDir, { recursive: true, force: true })
    for (const dir of grantedDirs) rmSync(dir, { recursive: true, force: true })
    grantedDirs = []
  })

  describe('storage', () => {
    it('rejects storage access without the storage permission', () => {
      pluginHost.install(pluginFiles('no-storage', []))
      expect(() => bridge.storageGet('no-storage', 'x')).toThrow(PermissionDeniedError)
    })

    it('round-trips get/set/remove/keys', () => {
      pluginHost.install(pluginFiles('with-storage', [{ type: 'storage' }]))
      expect(bridge.storageGet('with-storage', 'count')).toBeNull()

      bridge.storageSet('with-storage', 'count', 42)
      expect(bridge.storageGet('with-storage', 'count')).toBe(42)
      expect(bridge.storageKeys('with-storage')).toEqual(['count'])

      bridge.storageRemove('with-storage', 'count')
      expect(bridge.storageGet('with-storage', 'count')).toBeNull()
      expect(bridge.storageKeys('with-storage')).toEqual([])
    })

    it('keeps storage separate per plugin', () => {
      pluginHost.install(pluginFiles('plugin-a', [{ type: 'storage' }]))
      pluginHost.install(pluginFiles('plugin-b', [{ type: 'storage' }]))
      bridge.storageSet('plugin-a', 'x', 1)
      bridge.storageSet('plugin-b', 'x', 2)
      expect(bridge.storageGet('plugin-a', 'x')).toBe(1)
      expect(bridge.storageGet('plugin-b', 'x')).toBe(2)
    })

    it('persists storage across a new bridge instance pointed at the same data dir', () => {
      pluginHost.install(pluginFiles('persistent', [{ type: 'storage' }]))
      bridge.storageSet('persistent', 'x', 'hello')

      const reopened = new PluginHostApiBridge(pluginHost, dataDir, publishedCards.push.bind(publishedCards), () => {})
      expect(reopened.storageGet('persistent', 'x')).toBe('hello')
    })
  })

  describe('folders', () => {
    function seedFolderHandle(pluginId: string, handleId: string, rootPath: string): void {
      const pluginDataDir = join(dataDir, pluginId)
      mkdirSync(pluginDataDir, { recursive: true })
      writeFileSync(
        join(pluginDataDir, 'folders.json'),
        JSON.stringify({ [handleId]: { path: rootPath, label: 'root' } }),
        'utf-8'
      )
    }

    it('rejects folder access without the folders permission', () => {
      pluginHost.install(pluginFiles('no-folders', []))
      expect(() => bridge.listFiles('no-folders', 'folder-x')).toThrow(PermissionDeniedError)
    })

    it('lists, reads and writes files within a granted folder', () => {
      pluginHost.install(pluginFiles('file-plugin', [{ type: 'folders' }]))
      const rootPath = grantedDir()
      writeFileSync(join(rootPath, 'note.txt'), 'hello')
      seedFolderHandle('file-plugin', 'folder-1', rootPath)

      const files = bridge.listFiles('file-plugin', 'folder-1')
      expect(files).toEqual([{ name: 'note.txt', isDirectory: false, modifiedAt: expect.any(Number) }])
      // When it was last changed (ms since 1970), e.g. for sorting by date.
      expect(Math.abs(files[0].modifiedAt - Date.now())).toBeLessThan(60_000)
      expect(bridge.readFile('file-plugin', 'folder-1', 'note.txt')).toBe('hello')

      bridge.writeFile('file-plugin', 'folder-1', 'note.txt', 'updated')
      expect(bridge.readFile('file-plugin', 'folder-1', 'note.txt')).toBe('updated')

      bridge.deleteFile('file-plugin', 'folder-1', 'note.txt')
      expect(bridge.listFiles('file-plugin', 'folder-1')).toEqual([])
    })

    it('rejects deleting a file without the folders permission', () => {
      pluginHost.install(pluginFiles('no-folders-del', []))
      expect(() => bridge.deleteFile('no-folders-del', 'folder-1', 'note.txt')).toThrow(PermissionDeniedError)
    })

    it('gives images etc. a URL (fileUrl) and points readFile users there instead of returning garbage', () => {
      pluginHost.install(pluginFiles('photo-plugin', [{ type: 'folders' }]))
      const rootPath = grantedDir()
      mkdirSync(join(rootPath, '2024'))
      writeFileSync(join(rootPath, '2024', '富士山.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]))
      seedFolderHandle('photo-plugin', 'folder-1', rootPath)

      expect(bridge.listFiles('photo-plugin', 'folder-1')).toEqual([{ name: '2024', isDirectory: true, modifiedAt: expect.any(Number) }])
      expect(bridge.listFiles('photo-plugin', 'folder-1', '2024')).toEqual([{ name: '富士山.png', isDirectory: false, modifiedAt: expect.any(Number) }])
      expect(bridge.fileUrl('photo-plugin', 'folder-1', '2024/富士山.png')).toBe(
        `plugin-app://photo-plugin/__brighterm_file__/folder-1/2024/${encodeURIComponent('富士山.png')}`
      )
      expect(bridge.resolveFile('photo-plugin', 'folder-1', '2024/富士山.png')).toBe(join(rootPath, '2024', '富士山.png'))
      expect(() => bridge.readFile('photo-plugin', 'folder-1', '2024/富士山.png')).toThrow('fs.fileUrl(folder, path)')

      expect(() => bridge.fileUrl('photo-plugin', 'folder-1', 'missing.jpg')).toThrow(/ファイルが見つかりません/)
      expect(() => bridge.fileUrl('photo-plugin', 'folder-1', '../outside.jpg')).toThrow(/選んだフォルダの外/)
      // What the user's first AI-written Photo Viewer did: readFile(photo.path), with no folder handle.
      expect(() => bridge.fileUrl('photo-plugin', 'folder-1', undefined)).toThrow(/2つ目の引数/)
    })

    it('rejects fileUrl without the folders permission', () => {
      pluginHost.install(pluginFiles('no-folders-url', []))
      expect(() => bridge.fileUrl('no-folders-url', 'folder-1', 'a.jpg')).toThrow(PermissionDeniedError)
    })

    it('rejects a relative path that escapes the granted folder', () => {
      pluginHost.install(pluginFiles('escape-plugin', [{ type: 'folders' }]))
      const rootPath = grantedDir()
      seedFolderHandle('escape-plugin', 'folder-1', rootPath)

      expect(() => bridge.readFile('escape-plugin', 'folder-1', '../../etc/passwd')).toThrow(/選んだフォルダの外/)
    })

    it('grants a typed folder path (the folder bar): same folder → same handle, and its path goes back only to the shell', () => {
      pluginHost.install(pluginFiles('bar-plugin', [{ type: 'folders' }]))
      const rootPath = grantedDir()
      writeFileSync(join(rootPath, 'a.md'), 'A')

      const handle = bridge.grantFolder('bar-plugin', `  "${rootPath}${sep}"  `)
      expect(handle.label).toBe(basename(rootPath))
      expect(bridge.listFiles('bar-plugin', handle.id)).toEqual([{ name: 'a.md', isDirectory: false, modifiedAt: expect.any(Number) }])
      expect(bridge.grantFolder('bar-plugin', rootPath)).toEqual(handle)

      expect(bridge.folderBarPath('bar-plugin', handle)).toBe(rootPath)
      expect(bridge.folderBarPath('bar-plugin', handle.id)).toBe(rootPath)
      expect(bridge.folderBarPath('bar-plugin', null)).toBeNull()
      expect(() => bridge.folderBarPath('bar-plugin', { id: 'folder-nope', label: 'x' })).toThrow('pickFolder() が返したオブジェクト')
    })

    it('expands ~ in a typed path to the home folder', () => {
      pluginHost.install(pluginFiles('home-plugin', [{ type: 'folders' }]))
      const home = grantedDir()
      mkdirSync(join(home, 'notes'))
      const handle = bridge.grantFolder('home-plugin', '~/notes', home)
      expect(bridge.folderBarPath('home-plugin', handle)).toBe(join(home, 'notes'))
    })

    it('says in Japanese why a typed path cannot be used', () => {
      pluginHost.install(pluginFiles('bad-path', [{ type: 'folders' }]))
      const rootPath = grantedDir()
      writeFileSync(join(rootPath, 'file.txt'), 'x')
      expect(() => bridge.grantFolder('bad-path', join(rootPath, 'missing'))).toThrow(/フォルダが見つかりません/)
      expect(() => bridge.grantFolder('bad-path', join(rootPath, 'file.txt'))).toThrow(/ファイルではなくフォルダ/)
      expect(() => bridge.grantFolder('bad-path', 'relative/dir')).toThrow(/先頭からのパス/)
      expect(() => bridge.grantFolder('bad-path', '')).toThrow('フォルダのパスを入力してください')
    })

    it('rejects the folder bar without the folders permission', () => {
      pluginHost.install(pluginFiles('no-folders-bar', []))
      expect(() => bridge.folderBarPath('no-folders-bar', null)).toThrow(PermissionDeniedError)
      expect(() => bridge.grantFolder('no-folders-bar', tmpdir())).toThrow(PermissionDeniedError)
    })

    it('throws for an unknown folder handle', () => {
      pluginHost.install(pluginFiles('unknown-handle', [{ type: 'folders' }]))
      expect(() => bridge.listFiles('unknown-handle', 'no-such-handle')).toThrow('pickFolder() が返したオブジェクト')
    })
  })

  describe('netFetch', () => {
    it('rejects a request to a domain not declared in the manifest', async () => {
      pluginHost.install(pluginFiles('net-plugin', [{ type: 'network', domains: ['api.example.com'] }]))
      await expect(bridge.netFetch('net-plugin', 'https://evil.example.com/data')).rejects.toThrow(/evil.example.com.*許可されていません/)
    })

    it('allows a request to a declared domain', async () => {
      pluginHost.install(pluginFiles('net-plugin-2', [{ type: 'network', domains: ['api.example.com'] }]))
      const fetchMock = vi.fn().mockResolvedValue({ status: 200, text: () => Promise.resolve('{"ok":true}') })
      vi.stubGlobal('fetch', fetchMock)

      const result = await bridge.netFetch('net-plugin-2', 'https://api.example.com/data')
      expect(result).toEqual({ status: 200, text: '{"ok":true}' })
      expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/data', undefined)

      vi.unstubAllGlobals()
    })
  })

  describe('HQ cards', () => {
    it('rejects publishing a card without the hqCards permission', () => {
      pluginHost.install(pluginFiles('no-cards', []))
      expect(() =>
        bridge.publishCard('no-cards', { id: 'x', priority: 'normal', title: 'Hello' })
      ).toThrow(PermissionDeniedError)
    })

    it('forwards a published card with the source tagged as this plugin', () => {
      pluginHost.install(pluginFiles('card-plugin', [{ type: 'hqCards' }]))
      bridge.publishCard('card-plugin', { id: 'x', priority: 'high', title: 'Hello' })
      expect(publishedCards).toEqual([{ id: 'x', priority: 'high', title: 'Hello', source: 'plugin:card-plugin' }])
    })

    it('forwards a card clear request', () => {
      pluginHost.install(pluginFiles('card-plugin-2', [{ type: 'hqCards' }]))
      bridge.clearCard('card-plugin-2', 'x')
      expect(clearedCardIds).toEqual(['x'])
    })
  })

  it('throws when the plugin id is not installed at all', () => {
    expect(() => bridge.storageGet('ghost-plugin', 'x')).toThrow(/インストールされていません/)
  })
})
