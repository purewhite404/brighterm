import { BaseWindow, WebContentsView, session } from 'electron'
import type { Rect } from '@shared/types'

/**
 * Owns every WebContentsView backing a "web" or "plugin" tile: creation,
 * positioning, and — the core memory-saving mechanism — suspension of views
 * that haven't been visible for a while, and resuming them on demand.
 *
 * A suspended tile keeps its url/partition and a snapshot image, but its
 * WebContents (and the memory + process it costs) is destroyed. Because the
 * session partition is `persist:`, resuming later doesn't require logging in
 * again.
 */

interface ManagedView {
  tileId: string
  url: string
  partitionId: string
  view: WebContentsView | null
  suspended: boolean
  lastActiveAt: number
  lastBounds: Rect | null
  /** data: URL PNG snapshot shown in the renderer while suspended or hidden behind an overlay. */
  snapshot: string | null
  compactCss?: string
  /** True while no tile on screen is showing this view (e.g. its workspace isn't active). */
  hidden: boolean
  /** When it became hidden — suspension only ever targets views hidden for a while. */
  hiddenSince: number
}

export interface ViewManagerOptions {
  getWindow: () => BaseWindow | null
  onSnapshotUpdated?: (tileId: string, snapshot: string | null) => void
  onTitleUpdated?: (tileId: string, title: string) => void
  onNavigated?: (tileId: string, state: NavigationState) => void
}

export interface NavigationState {
  url: string
  canGoBack: boolean
  canGoForward: boolean
}

/**
 * Gives every web page the built-in tiles' scrollbar (packages/sdk/ui/tokens.css):
 * 8px, rounded, transparent track. User-origin !important beats the site's own
 * ::-webkit-scrollbar rules; scrollbar-color is reset because any non-auto
 * value makes Chromium ignore ::-webkit-scrollbar. scrollbar-width is left to
 * the site so scrollbars it hides (width: none) stay hidden.
 */
export const SCROLLBAR_CSS = `
* { scrollbar-color: auto !important; }
::-webkit-scrollbar { width: 8px !important; height: 8px !important; background: transparent !important; }
::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent !important; border: none !important; }
::-webkit-scrollbar-button { display: none !important; }
::-webkit-scrollbar-thumb { background: #3a3e4f !important; border-radius: 4px !important; border: none !important; }
@media (prefers-color-scheme: light) {
  ::-webkit-scrollbar-thumb { background: #c4c8d2 !important; }
}
`

/** Partitions whose pages must not autoplay media (the Files tile's preview pane). */
const NO_AUTOPLAY_PARTITIONS = new Set(['files-preview'])

/** Strip the Electron/x.y.z token so Google (and others) don't block the embedded login flow. */
function desktopUserAgent(originalUA: string): string {
  return originalUA.replace(/\s*Electron\/\S+/, '').replace(/\s*brighterm\/\S+/, '')
}

export class ViewManager {
  private readonly views = new Map<string, ManagedView>()
  private readonly options: ViewManagerOptions

  constructor(options: ViewManagerOptions) {
    this.options = options
  }

  private get window(): BaseWindow | null {
    return this.options.getWindow()
  }

  has(tileId: string): boolean {
    return this.views.has(tileId)
  }

  /**
   * Idempotent: a tile component calls this every time it mounts (React may
   * mount twice in dev, and a tile remounts when its workspace is shown
   * again). An existing view is un-hidden, and resumed if it was suspended.
   */
  create(tileId: string, url: string, partitionId: string, compactCss?: string): void {
    const existing = this.views.get(tileId)
    if (existing) {
      existing.hidden = false
      existing.lastActiveAt = Date.now()
      if (existing.suspended) this.mountView(existing)
      return
    }
    const entry: ManagedView = {
      tileId,
      url,
      partitionId,
      view: null,
      suspended: false,
      lastActiveAt: Date.now(),
      lastBounds: null,
      snapshot: null,
      compactCss,
      hidden: false,
      hiddenSince: 0
    }
    this.views.set(tileId, entry)
    this.mountView(entry)
  }

  private mountView(entry: ManagedView): void {
    const win = this.window
    if (!win) return

    const partition = `persist:${entry.partitionId}`
    const ses = session.fromPartition(partition)
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        // Files previews show audio/video with Chromium's player: only play once the user presses play.
        ...(NO_AUTOPLAY_PARTITIONS.has(entry.partitionId) ? { autoplayPolicy: 'document-user-activation-required' as const } : {})
      }
    })

    const ua = desktopUserAgent(view.webContents.getUserAgent())
    view.webContents.setUserAgent(ua)

    view.webContents.on('page-title-updated', (_event, title) => {
      this.options.onTitleUpdated?.(entry.tileId, title)
    })

    const reportNavigation = (): void => {
      const history = view.webContents.navigationHistory
      entry.url = view.webContents.getURL() || entry.url
      this.options.onNavigated?.(entry.tileId, {
        url: entry.url,
        canGoBack: history.canGoBack(),
        canGoForward: history.canGoForward()
      })
    }
    view.webContents.on('did-navigate', reportNavigation)
    view.webContents.on('did-navigate-in-page', reportNavigation)

    // Links that try to open a new window load in the same tile instead.
    view.webContents.setWindowOpenHandler(({ url }) => {
      void view.webContents.loadURL(url)
      return { action: 'deny' }
    })

    view.webContents.on('dom-ready', () => {
      view.webContents.insertCSS(SCROLLBAR_CSS, { cssOrigin: 'user' }).catch(() => {
        /* best-effort */
      })
    })

    if (entry.compactCss) {
      view.webContents.on('dom-ready', () => {
        view.webContents.insertCSS(entry.compactCss!).catch(() => {
          /* best-effort; site markup may have changed */
        })
      })
    }

    win.contentView.addChildView(view)
    view.webContents.loadURL(entry.url).catch((err) => {
      // ERR_ABORTED: superseded by a newer navigation (e.g. the next previewed file) — expected.
      if ((err as { code?: string }).code === 'ERR_ABORTED') return
      console.error(`[ViewManager] failed to load ${entry.url} for tile ${entry.tileId}:`, err)
    })

    entry.view = view
    entry.suspended = false
    entry.lastActiveAt = Date.now()
    if (entry.lastBounds && !entry.hidden) {
      view.setBounds(toIntRect(entry.lastBounds))
    } else {
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    }
  }

  setBounds(tileId: string, rect: Rect): void {
    const entry = this.views.get(tileId)
    if (!entry) return
    entry.lastBounds = rect
    entry.hidden = false
    if (entry.view) {
      entry.view.setBounds(toIntRect(rect))
    }
  }

  /** The tile showing this view went away (workspace switched, etc.) — keep the page alive but off screen. */
  hide(tileId: string): void {
    const entry = this.views.get(tileId)
    if (!entry || entry.hidden) return
    entry.hidden = true
    entry.hiddenSince = Date.now()
    entry.view?.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  }

  /** `onlyIfChanged`: skip when the view already shows `url` (e.g. a preview re-shown for the same file). */
  navigate(tileId: string, url: string, onlyIfChanged = false): void {
    const entry = this.views.get(tileId)
    if (!entry) return
    if (onlyIfChanged && entry.url === url) return
    entry.url = url
    void entry.view?.webContents.loadURL(url).catch(() => {
      /* failed navigations surface as an error page in the view itself */
    })
  }

  goBack(tileId: string): void {
    const history = this.views.get(tileId)?.view?.webContents.navigationHistory
    if (history?.canGoBack()) history.goBack()
  }

  goForward(tileId: string): void {
    const history = this.views.get(tileId)?.view?.webContents.navigationHistory
    if (history?.canGoForward()) history.goForward()
  }

  reload(tileId: string): void {
    this.views.get(tileId)?.view?.webContents.reload()
  }

  markActive(tileId: string): void {
    const entry = this.views.get(tileId)
    if (entry) entry.lastActiveAt = Date.now()
  }

  /** Destroys the tile's view and any sub-views it owns (ids of the form "<tileId>::<name>"). */
  async close(tileId: string): Promise<void> {
    for (const [id, entry] of [...this.views.entries()]) {
      if (id !== tileId && !id.startsWith(`${tileId}::`)) continue
      this.detachAndDestroy(entry)
      this.views.delete(id)
    }
  }

  /** Capture a snapshot and free the WebContents; keeps enough state to resume() later. */
  async suspend(tileId: string): Promise<void> {
    const entry = this.views.get(tileId)
    if (!entry || entry.suspended || !entry.view) return
    try {
      const image = await entry.view.webContents.capturePage()
      entry.snapshot = image.toDataURL()
      this.options.onSnapshotUpdated?.(tileId, entry.snapshot)
    } catch (err) {
      console.error(`[ViewManager] snapshot failed for ${tileId}:`, err)
    }
    this.detachAndDestroy(entry)
    entry.view = null
    entry.suspended = true
  }

  resume(tileId: string): void {
    const entry = this.views.get(tileId)
    if (!entry || !entry.suspended) return
    this.mountView(entry)
  }

  private detachAndDestroy(entry: ManagedView): void {
    if (!entry.view) return
    const win = this.window
    try {
      win?.contentView.removeChildView(entry.view)
    } catch {
      /* window may already be gone */
    }
    // WebContentsView has no explicit destroy(); dropping all references and
    // closing the underlying WebContents lets it be GC'd.
    try {
      entry.view.webContents.close()
    } catch {
      /* already closed */
    }
  }

  /** Hide every mounted view behind a snapshot, e.g. while the command palette is open. */
  async hideAllForOverlay(): Promise<void> {
    for (const entry of this.views.values()) {
      if (!entry.view || entry.suspended || entry.hidden) continue
      try {
        const image = await entry.view.webContents.capturePage()
        entry.snapshot = image.toDataURL()
        this.options.onSnapshotUpdated?.(entry.tileId, entry.snapshot)
        entry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
      } catch {
        /* best-effort */
      }
    }
  }

  showAllAfterOverlay(): void {
    for (const entry of this.views.values()) {
      if (!entry.view || entry.suspended || entry.hidden || !entry.lastBounds) continue
      entry.view.setBounds(toIntRect(entry.lastBounds))
      entry.snapshot = null
      this.options.onSnapshotUpdated?.(entry.tileId, null)
    }
  }

  /**
   * Views that have been off screen longer than `maxHiddenMs`, longest-hidden
   * first. A tile you can see is never suspended, however long since you
   * last clicked it.
   */
  getSuspendCandidates(maxHiddenMs: number): string[] {
    const now = Date.now()
    return [...this.views.values()]
      .filter((e) => !e.suspended && e.hidden && now - e.hiddenSince > maxHiddenMs)
      .sort((a, b) => a.hiddenSince - b.hiddenSince)
      .map((e) => e.tileId)
  }

  isSuspended(tileId: string): boolean {
    return this.views.get(tileId)?.suspended ?? false
  }

  /** Renderer process id of every view (null while suspended), for per-tile memory. */
  getViewPids(): Map<string, number | null> {
    const result = new Map<string, number | null>()
    for (const entry of this.views.values()) {
      result.set(entry.tileId, entry.view ? entry.view.webContents.getOSProcessId() : null)
    }
    return result
  }

  disposeAll(): void {
    for (const entry of this.views.values()) {
      this.detachAndDestroy(entry)
    }
    this.views.clear()
  }
}

function toIntRect(rect: Rect): Rect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  }
}
