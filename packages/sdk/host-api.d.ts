/**
 * Ambient types for the Host API every kind:"app" plugin gets as
 * `window.brighterm`, injected into its sandboxed iframe. This file ships in
 * the AI plugin kit (see AGENTS.md) purely as documentation/typing for
 * whichever tool writes the plugin — it is not itself imported by the app.
 *
 * The real implementation lives in src/main/plugins/hostApiBridge.ts (main
 * process) and the injected preload the iframe gets
 * (src/renderer/plugins/pluginPreload.ts), talking over postMessage.
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

export interface BrightermFs {
  /** Opens the native folder picker; the user chooses what this plugin may read. */
  pickFolder(): Promise<BrightermFolderHandle | null>
  listFiles(handle: BrightermFolderHandle): Promise<{ name: string; isDirectory: boolean }[]>
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
