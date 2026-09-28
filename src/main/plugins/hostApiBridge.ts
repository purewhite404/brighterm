import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { PluginHost } from './pluginHost'
import type { PluginManifest } from '@sdk/manifest.schema'
import type { Card } from '@shared/types'

/**
 * Implements the `window.brighterm` Host API's actual behavior, on the main
 * process side. Every call is scoped to one plugin id and checked against
 * that plugin's declared manifest permissions before doing anything.
 */

export class PermissionDeniedError extends Error {
  constructor(pluginId: string, permission: string) {
    super(`plugin "${pluginId}" has not declared the "${permission}" permission`)
  }
}

interface FolderRegistry {
  [handleId: string]: { path: string; label: string }
}

export class PluginHostApiBridge {
  constructor(
    private readonly pluginHost: PluginHost,
    private readonly dataRoot: string,
    private readonly onPublishCard: (card: Card) => void,
    private readonly onClearCard: (cardId: string) => void
  ) {
    mkdirSync(dataRoot, { recursive: true })
  }

  private manifestOf(pluginId: string): PluginManifest {
    const item = this.pluginHost.getListItem(pluginId)
    if (!item) throw new Error(`plugin "${pluginId}" is not installed`)
    return item.manifest
  }

  private requirePermission(pluginId: string, type: string): void {
    const manifest = this.manifestOf(pluginId)
    if (!manifest.permissions.some((p) => p.type === type)) {
      throw new PermissionDeniedError(pluginId, type)
    }
  }

  private pluginDir(pluginId: string): string {
    const dir = join(this.dataRoot, pluginId)
    mkdirSync(dir, { recursive: true })
    return dir
  }

  // ---- storage ----

  private storagePath(pluginId: string): string {
    return join(this.pluginDir(pluginId), 'storage.json')
  }

  private readStorage(pluginId: string): Record<string, unknown> {
    const path = this.storagePath(pluginId)
    if (!existsSync(path)) return {}
    try {
      return JSON.parse(readFileSync(path, 'utf-8'))
    } catch {
      return {}
    }
  }

  private writeStorage(pluginId: string, data: Record<string, unknown>): void {
    writeFileSync(this.storagePath(pluginId), JSON.stringify(data, null, 2), 'utf-8')
  }

  storageGet(pluginId: string, key: string): unknown {
    this.requirePermission(pluginId, 'storage')
    return this.readStorage(pluginId)[key] ?? null
  }

  storageSet(pluginId: string, key: string, value: unknown): void {
    this.requirePermission(pluginId, 'storage')
    const data = this.readStorage(pluginId)
    data[key] = value
    this.writeStorage(pluginId, data)
  }

  storageRemove(pluginId: string, key: string): void {
    this.requirePermission(pluginId, 'storage')
    const data = this.readStorage(pluginId)
    delete data[key]
    this.writeStorage(pluginId, data)
  }

  storageKeys(pluginId: string): string[] {
    this.requirePermission(pluginId, 'storage')
    return Object.keys(this.readStorage(pluginId))
  }

  // ---- folders (user-picked, path-traversal-guarded) ----

  private foldersPath(pluginId: string): string {
    return join(this.pluginDir(pluginId), 'folders.json')
  }

  private readFolders(pluginId: string): FolderRegistry {
    const path = this.foldersPath(pluginId)
    if (!existsSync(path)) return {}
    try {
      return JSON.parse(readFileSync(path, 'utf-8'))
    } catch {
      return {}
    }
  }

  private resolveHandle(pluginId: string, handleId: string): string {
    const folders = this.readFolders(pluginId)
    const entry = folders[handleId]
    if (!entry) throw new Error(`unknown folder handle "${handleId}"`)
    return entry.path
  }

  /** Resolves relativePath against the handle's root, rejecting any escape via "..". */
  private resolveWithinFolder(rootPath: string, relativePath: string): string {
    const target = resolve(rootPath, relativePath)
    const rel = relative(rootPath, target)
    const escapes = rel === '' ? false : rel.startsWith('..') || rel.split(/[\\/]/).includes('..')
    if (escapes) {
      throw new Error('path escapes the granted folder')
    }
    return target
  }

  async pickFolder(pluginId: string): Promise<{ id: string; label: string } | null> {
    this.requirePermission(pluginId, 'folders')
    const { dialog } = await import('electron')
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    const path = result.filePaths[0]
    const label = path.split(/[\\/]/).pop() ?? path
    const id = `folder-${randomUUID()}`
    const folders = this.readFolders(pluginId)
    folders[id] = { path, label }
    writeFileSync(this.foldersPath(pluginId), JSON.stringify(folders, null, 2), 'utf-8')
    return { id, label }
  }

  /**
   * Grants a folder without a picker — used when the user opens a file from
   * the Files tile in a plugin (e.g. Notes). Only the trusted shell calls this.
   * The same folder always maps to the same handle.
   */
  grantFolder(pluginId: string, path: string): { id: string; label: string } {
    this.requirePermission(pluginId, 'folders')
    const folders = this.readFolders(pluginId)
    const existing = Object.entries(folders).find(([, entry]) => entry.path === path)
    if (existing) return { id: existing[0], label: existing[1].label }
    const label = path.split(/[\\/]/).pop() || path
    const id = `folder-${randomUUID()}`
    folders[id] = { path, label }
    writeFileSync(this.foldersPath(pluginId), JSON.stringify(folders, null, 2), 'utf-8')
    return { id, label }
  }

  listFiles(pluginId: string, handleId: string): Array<{ name: string; isDirectory: boolean }> {
    this.requirePermission(pluginId, 'folders')
    const root = this.resolveHandle(pluginId, handleId)
    return readdirSync(root).map((name) => ({
      name,
      isDirectory: statSync(join(root, name)).isDirectory()
    }))
  }

  readFile(pluginId: string, handleId: string, relativePath: string): string {
    this.requirePermission(pluginId, 'folders')
    const root = this.resolveHandle(pluginId, handleId)
    return readFileSync(this.resolveWithinFolder(root, relativePath), 'utf-8')
  }

  writeFile(pluginId: string, handleId: string, relativePath: string, content: string): void {
    this.requirePermission(pluginId, 'folders')
    const root = this.resolveHandle(pluginId, handleId)
    writeFileSync(this.resolveWithinFolder(root, relativePath), content, 'utf-8')
  }

  deleteFile(pluginId: string, handleId: string, relativePath: string): void {
    this.requirePermission(pluginId, 'folders')
    const root = this.resolveHandle(pluginId, handleId)
    unlinkSync(this.resolveWithinFolder(root, relativePath))
  }

  // ---- network (declared domains only) ----

  async netFetch(
    pluginId: string,
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string }
  ): Promise<{ status: number; text: string }> {
    const manifest = this.manifestOf(pluginId)
    const hostname = new URL(url).hostname.toLowerCase()
    const allowedDomains = manifest.permissions
      .filter((p): p is Extract<typeof p, { type: 'network' }> => p.type === 'network')
      .flatMap((p) => p.domains.map((d) => d.toLowerCase()))
    if (!allowedDomains.includes(hostname)) {
      throw new Error(`plugin "${pluginId}" is not permitted to reach "${hostname}"`)
    }
    const response = await fetch(url, init)
    const text = await response.text()
    return { status: response.status, text }
  }

  // ---- notifications ----

  async notify(pluginId: string, title: string, body?: string): Promise<void> {
    this.requirePermission(pluginId, 'notifications')
    const { Notification } = await import('electron')
    new Notification({ title, body }).show()
  }

  // ---- HQ cards ----

  publishCard(pluginId: string, card: Omit<Card, 'source'>): void {
    this.requirePermission(pluginId, 'hqCards')
    this.onPublishCard({ ...card, source: `plugin:${pluginId}` })
  }

  clearCard(pluginId: string, cardId: string): void {
    this.requirePermission(pluginId, 'hqCards')
    this.onClearCard(cardId)
  }
}
