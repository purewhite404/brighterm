import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type { PluginHost } from './pluginHost'
import type { PluginManifest } from '@sdk/manifest.schema'
import type { Card } from '@shared/types'
import { buildPluginFileUrl } from './pluginFileUrl'
import { normalizeFolderInput, samePath } from './folderInput'
import { handleId as unwrapHandleId } from './handleUtil'
import { isWebUrl } from '@shared/urlSafety'
import { isInside } from '../utils/pathGuard'

/**
 * Implements the `window.brighterm` Host API's actual behavior, on the main
 * process side. Every call is scoped to one plugin id and checked against
 * that plugin's declared manifest permissions before doing anything.
 *
 * Error messages are Japanese and say how to fix the call: the plugin tile
 * shows them to the user, and the fix request hands them to the AI.
 */

const NET_MAX_REDIRECTS = 5
const NET_TIMEOUT_MS = 30_000
const NET_MAX_BYTES = 10 * 1024 * 1024

/** The body as text, refusing more than `maxBytes` (a plugin can't make main buffer gigabytes). */
async function readTextLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new Error(`応答が大きすぎます（${Math.round(maxBytes / 1024 / 1024)} MB まで）`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

export class PermissionDeniedError extends Error {
  constructor(pluginId: string, permission: string) {
    super(`プラグイン "${pluginId}" は manifest.json の permissions に { "type": "${permission}" } を宣言していません`)
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
    if (!item) throw new Error(`プラグイン "${pluginId}" はインストールされていません`)
    return item.manifest
  }

  private requirePermission(pluginId: string, type: string): void {
    const manifest = this.manifestOf(pluginId)
    if (!manifest.permissions.some((p) => p.type === type)) {
      throw new PermissionDeniedError(pluginId, type)
    }
  }

  /*
   * storage.json and folders.json are read once per plugin and then kept in memory
   * (written through on change): every fs.* call resolves its folder handle, and
   * re-reading + parsing the file each time was main-process work per call.
   * Only this class writes these files.
   */
  private readonly storageCache = new Map<string, Record<string, unknown>>()
  private readonly foldersCache = new Map<string, FolderRegistry>()
  private readonly createdDirs = new Set<string>()

  private pluginDir(pluginId: string): string {
    const dir = join(this.dataRoot, pluginId)
    if (!this.createdDirs.has(dir)) {
      mkdirSync(dir, { recursive: true })
      this.createdDirs.add(dir)
    }
    return dir
  }

  private readJson<T extends object>(path: string): T {
    if (!existsSync(path)) return {} as T
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as T
    } catch {
      return {} as T
    }
  }

  // ---- storage ----

  private storagePath(pluginId: string): string {
    return join(this.pluginDir(pluginId), 'storage.json')
  }

  /** A copy: callers change it and hand it to writeStorage. */
  private readStorage(pluginId: string): Record<string, unknown> {
    let data = this.storageCache.get(pluginId)
    if (!data) {
      data = this.readJson<Record<string, unknown>>(this.storagePath(pluginId))
      this.storageCache.set(pluginId, data)
    }
    return { ...data }
  }

  private writeStorage(pluginId: string, data: Record<string, unknown>): void {
    writeFileSync(this.storagePath(pluginId), JSON.stringify(data, null, 2), 'utf-8')
    this.storageCache.set(pluginId, data)
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

  /** A copy: callers change it and hand it to writeFolders. */
  private readFolders(pluginId: string): FolderRegistry {
    let folders = this.foldersCache.get(pluginId)
    if (!folders) {
      folders = this.readJson<FolderRegistry>(this.foldersPath(pluginId))
      this.foldersCache.set(pluginId, folders)
    }
    return { ...folders }
  }

  private writeFolders(pluginId: string, folders: FolderRegistry): void {
    writeFileSync(this.foldersPath(pluginId), JSON.stringify(folders, null, 2), 'utf-8')
    this.foldersCache.set(pluginId, folders)
  }

  private resolveHandle(pluginId: string, handleId: string): string {
    const folders = this.readFolders(pluginId)
    const entry = folders[handleId]
    if (!entry) {
      throw new Error(
        `フォルダの指定が正しくありません（受け取った値: ${handleId}）。1つ目の引数には pickFolder() が返したオブジェクトをそのまま渡してください`
      )
    }
    return entry.path
  }

  /** Resolves relativePath against the handle's root, rejecting any escape ("..", another drive, a UNC path). */
  private resolveWithinFolder(rootPath: string, relativePath: unknown): string {
    if (typeof relativePath !== 'string') {
      throw new Error(`2つ目の引数には、選んだフォルダからの相対パス（例: "photo.jpg"）を文字列で渡してください（受け取った値: ${String(relativePath)}）`)
    }
    const target = resolve(rootPath, relativePath)
    if (!isInside(rootPath, target)) {
      throw new Error(`選んだフォルダの外にはアクセスできません: ${relativePath}`)
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
    this.writeFolders(pluginId, folders)
    return { id, label }
  }

  /**
   * Grants a folder without a picker — used when the user opens a file from
   * the Files tile in a plugin (e.g. Notes) or types a path into the tile's
   * folder bar. Only the trusted shell calls this; `input` is what the user
   * typed (quotes, "~" and trailing separators are fine).
   * The same folder always maps to the same handle.
   */
  grantFolder(pluginId: string, input: string, homeDir: string = homedir()): { id: string; label: string } {
    this.requirePermission(pluginId, 'folders')
    const path = normalizeFolderInput(String(input ?? ''), homeDir)
    let isDirectory = false
    try {
      isDirectory = statSync(path).isDirectory()
    } catch {
      throw new Error(`フォルダが見つかりません: ${path}`)
    }
    if (!isDirectory) throw new Error(`ファイルではなくフォルダを指定してください: ${path}`)
    try {
      readdirSync(path)
    } catch {
      throw new Error(`このフォルダは開けません（アクセスが許可されていません）: ${path}`)
    }
    const folders = this.readFolders(pluginId)
    const existing = Object.entries(folders).find(([, entry]) => samePath(entry.path, path))
    if (existing) return { id: existing[0], label: existing[1].label }
    const label = path.split(/[\\/]/).pop() || path
    const id = `folder-${randomUUID()}`
    folders[id] = { path, label }
    this.writeFolders(pluginId, folders)
    return { id, label }
  }

  /**
   * The absolute path of a handle, for the folder bar the shell draws above
   * the plugin (`fs.showFolderBar`). Never goes to the plugin itself. Null
   * handle = the bar is shown empty, asking for a folder.
   */
  folderBarPath(pluginId: string, handle: unknown): string | null {
    this.requirePermission(pluginId, 'folders')
    if (handle === null || handle === undefined) return null
    return this.resolveHandle(pluginId, unwrapHandleId(handle))
  }

  listFiles(
    pluginId: string,
    handleId: string,
    relativeDir: unknown = ''
  ): Array<{ name: string; isDirectory: boolean; modifiedAt: number }> {
    this.requirePermission(pluginId, 'folders')
    const dir = this.resolveWithinFolder(this.resolveHandle(pluginId, handleId), relativeDir ?? '')
    return readdirSync(dir).map((name) => {
      let isDirectory = false
      let modifiedAt = 0
      try {
        const stat = statSync(join(dir, name))
        isDirectory = stat.isDirectory()
        modifiedAt = Math.round(stat.mtimeMs)
      } catch {
        /* a broken link: list it as a file */
      }
      return { name, isDirectory, modifiedAt }
    })
  }

  /** The absolute path of an existing file in a granted folder (also what the protocol serves fileUrl()s from). */
  resolveFile(pluginId: string, handleId: string, relativePath: unknown): string {
    this.requirePermission(pluginId, 'folders')
    const target = this.resolveWithinFolder(this.resolveHandle(pluginId, handleId), relativePath)
    if (!existsSync(target) || !statSync(target).isFile()) {
      throw new Error(`ファイルが見つかりません: ${String(relativePath)}`)
    }
    return target
  }

  /** A URL the plugin can put in <img>/<video>/<audio>/<iframe> src (see pluginFileUrl.ts). */
  fileUrl(pluginId: string, handleId: string, relativePath: unknown): string {
    this.resolveFile(pluginId, handleId, relativePath)
    return buildPluginFileUrl(pluginId, handleId, relativePath as string)
  }

  readFile(pluginId: string, handleId: string, relativePath: unknown): string {
    const content = readFileSync(this.resolveFile(pluginId, handleId, relativePath))
    // NUL bytes near the start = not text (images, video, zip…). Reading those as UTF-8 only yields garbage.
    if (content.subarray(0, 8000).includes(0)) {
      throw new Error(
        `テキストではないファイルは readFile では読めません: ${String(relativePath)}。画像・動画・音声・PDF は fs.fileUrl(folder, path) で URL を受け取り、<img> などの src に入れて表示してください`
      )
    }
    return content.toString('utf-8')
  }

  writeFile(pluginId: string, handleId: string, relativePath: unknown, content: string): void {
    this.requirePermission(pluginId, 'folders')
    const root = this.resolveHandle(pluginId, handleId)
    writeFileSync(this.resolveWithinFolder(root, relativePath), content, 'utf-8')
  }

  deleteFile(pluginId: string, handleId: string, relativePath: unknown): void {
    this.requirePermission(pluginId, 'folders')
    const root = this.resolveHandle(pluginId, handleId)
    unlinkSync(this.resolveWithinFolder(root, relativePath))
  }

  /** Full path of a file the plugin may access (for the user's clipboard — the plugin never sees the path itself). */
  resolveFullPath(pluginId: string, handleId: string, relativePath: unknown): string {
    this.requirePermission(pluginId, 'folders')
    return this.resolveWithinFolder(this.resolveHandle(pluginId, handleId), relativePath)
  }

  // ---- network (declared domains only) ----

  /**
   * https to the manifest's `network` domains only — checked again on every redirect
   * (a declared site redirecting elsewhere must not carry the request, and its body, there).
   */
  async netFetch(
    pluginId: string,
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string }
  ): Promise<{ status: number; text: string }> {
    const manifest = this.manifestOf(pluginId)
    const allowedDomains = manifest.permissions
      .filter((p): p is Extract<typeof p, { type: 'network' }> => p.type === 'network')
      .flatMap((p) => p.domains.map((d) => d.toLowerCase()))
    const checked = (target: string): URL => {
      let parsed: URL
      try {
        parsed = new URL(target)
      } catch {
        throw new Error(`URL の形が正しくありません: ${String(target).slice(0, 200)}`)
      }
      if (parsed.protocol !== 'https:') {
        throw new Error(`https:// で始まる URL とだけ通信できます（受け取った値: ${String(target).slice(0, 200)}）`)
      }
      const hostname = parsed.hostname.toLowerCase()
      if (!allowedDomains.includes(hostname)) {
        throw new Error(`"${hostname}" との通信は許可されていません。manifest.json の permissions の network の domains に追加してください`)
      }
      return parsed
    }

    let target = checked(String(url))
    let method = init?.method
    let body = init?.body
    for (let hop = 0; hop <= NET_MAX_REDIRECTS; hop++) {
      const response = await fetch(target.toString(), {
        method,
        headers: init?.headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(NET_TIMEOUT_MS)
      })
      const location = response.headers.get('location')
      if (response.status >= 300 && response.status < 400 && location) {
        target = checked(new URL(location, target).toString())
        // As browsers do: 303 (and 301/302 after a POST) continue as a GET without the body.
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && method && method.toUpperCase() === 'POST')) {
          method = 'GET'
          body = undefined
        }
        continue
      }
      return { status: response.status, text: await readTextLimited(response, NET_MAX_BYTES) }
    }
    throw new Error(`リダイレクトが多すぎます（${NET_MAX_REDIRECTS} 回まで）: ${String(url).slice(0, 200)}`)
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
    const url = card?.action?.url
    if (url !== undefined && !isWebUrl(url)) {
      throw new Error(`カードの action.url には http:// か https:// で始まる URL だけを指定できます（受け取った値: ${String(url).slice(0, 200)}）`)
    }
    this.onPublishCard({ ...card, source: `plugin:${pluginId}` })
  }

  clearCard(pluginId: string, cardId: string): void {
    this.requirePermission(pluginId, 'hqCards')
    this.onClearCard(cardId)
  }
}
