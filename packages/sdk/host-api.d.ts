/**
 * Ambient types for the Host API every kind:"app" plugin gets as
 * `window.brighterm`, injected into its sandboxed iframe. This file is
 * appended to the AI Builder's request text and ships in the AI plugin kit
 * (see AGENTS.md), as the exact reference for whichever AI writes the plugin
 * — it is not itself imported by the app.
 *
 * The real implementation lives in src/main/plugins/hostApiBridge.ts (main
 * process) and the script injected into the iframe
 * (src/main/plugins/bridgeScript.ts), talking over postMessage.
 */

export interface BrightermStorage {
  /** Small JSON-serializable key/value store, private to this plugin. */
  get<T = unknown>(key: string): Promise<T | null>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
  keys(): Promise<string[]>
}

export interface BrightermFolderHandle {
  /** Absolute path is never exposed to the plugin — only this opaque handle + listing. */
  id: string
  label: string
}

/**
 * Files in folders the user picked (needs the "folders" permission).
 * Every call takes the handle `pickFolder()` returned — pass the object itself,
 * never a path — plus a path relative to that folder ("photo.jpg", "2024/a.png").
 */
export interface BrightermFs {
  /**
   * Opens the native folder picker; the user chooses what this plugin may read.
   * Returns null if they cancel. The handle stays valid across restarts: save it
   * with `storage.set` (needs "storage") to reopen the same folder next time.
   */
  pickFolder(): Promise<BrightermFolderHandle | null>
  /** The folder's entries (only names — build paths as `${relativeDir}/${name}`). `relativeDir` defaults to the folder itself. */
  listFiles(handle: BrightermFolderHandle, relativeDir?: string): Promise<{ name: string; isDirectory: boolean }[]>
  /**
   * A URL to show the file with — `<img src>`, `<video src>`, `<audio src>`,
   * `<iframe src>` (PDF). Use this for anything that isn't text: images,
   * video, audio, PDF. The browser loads it on demand, so `<img loading="lazy">`
   * keeps big photo folders fast.
   */
  fileUrl(handle: BrightermFolderHandle, relativePath: string): Promise<string>
  /** Text files only (read as UTF-8). Rejects binary files — use `fileUrl` for those. */
  readFile(handle: BrightermFolderHandle, relativePath: string): Promise<string>
  writeFile(handle: BrightermFolderHandle, relativePath: string, content: string): Promise<void>
  deleteFile(handle: BrightermFolderHandle, relativePath: string): Promise<void>
}

export interface BrightermNet {
  /** Only reaches hosts listed in this plugin's manifest `permissions: [{type:"network", domains:[...]}]`. */
  fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{
    status: number
    text: string
  }>
}

export type CardPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface BrightermHq {
  /** Publish (or update, if `id` repeats) a card in the HQ tile. */
  publishCard(card: {
    id: string
    priority: CardPriority
    title: string
    detail?: string
    action?: { label: string; url?: string }
  }): Promise<void>
  /** Remove a previously published card. */
  clearCard(id: string): Promise<void>
}

export interface BrightermTheme {
  /** The active design tokens (see packages/sdk/ui/tokens.css) as a plain object, kept in sync live. */
  getTokens(): Promise<Record<string, string>>
  onThemeChanged(cb: (tokens: Record<string, string>) => void): () => void
}

export interface BrightermHost {
  storage: BrightermStorage
  fs: BrightermFs
  net: BrightermNet
  hq: BrightermHq
  theme: BrightermTheme
  notify(title: string, body?: string): Promise<void>
  openTile(builtinTypeId: string): Promise<void>
  /**
   * Called when the user opens a file in this plugin from the Files tile
   * (plugins with the "folders" permission). `folder` is already granted.
   * Returns an unsubscribe function.
   */
  onOpenFile(cb: (file: { folder: BrightermFolderHandle; name: string }) => void): () => void
}

declare global {
  interface Window {
    brighterm: BrightermHost
  }
}
