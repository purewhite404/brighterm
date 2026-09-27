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
  onTitleUpdated?: (title: string) => void
}

export interface ViewManagerOptions {
  getWindow: () => BaseWindow | null
  onSnapshotUpdated?: (tileId: string, snapshot: string | null) => void
  onTitleUpdated?: (tileId: string, title: string) => void
}

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

  create(tileId: string, url: string, partitionId: string, compactCss?: string): void {
    if (this.views.has(tileId)) return
    const entry: ManagedView = {
      tileId,
      url,
      partitionId,
      view: null,
      suspended: false,
      lastActiveAt: Date.now(),
      lastBounds: null,
      snapshot: null,
      compactCss
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
        nodeIntegration: false
      }
    })

    const ua = desktopUserAgent(view.webContents.getUserAgent())
    view.webContents.setUserAgent(ua)

    view.webContents.on('page-title-updated', (_event, title) => {
      entry.onTitleUpdated?.(title)
      this.options.onTitleUpdated?.(entry.tileId, title)
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
      console.error(`[ViewManager] failed to load ${entry.url} for tile ${entry.tileId}:`, err)
    })

    entry.view = view
    entry.suspended = false
    entry.lastActiveAt = Date.now()
    if (entry.lastBounds) {
      view.setBounds(toIntRect(entry.lastBounds))
    } else {
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    }
  }

  setBounds(tileId: string, rect: Rect): void {
    const entry = this.views.get(tileId)
    if (!entry) return
    entry.lastBounds = rect
    if (entry.view) {
      entry.view.setBounds(toIntRect(rect))
    }
  }

  markActive(tileId: string): void {
    const entry = this.views.get(tileId)
    if (entry) entry.lastActiveAt = Date.now()
  }

  async close(tileId: string): Promise<void> {
    const entry = this.views.get(tileId)
    if (!entry) return
    this.detachAndDestroy(entry)
    this.views.delete(tileId)
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
      if (!entry.view || entry.suspended) continue
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
      if (!entry.view || entry.suspended || !entry.lastBounds) continue
      entry.view.setBounds(toIntRect(entry.lastBounds))
      entry.snapshot = null
      this.options.onSnapshotUpdated?.(entry.tileId, null)
    }
  }

  /** Tiles inactive longer than `maxIdleMs`, oldest first — candidates for suspension. */
  getSuspendCandidates(maxIdleMs: number): string[] {
    const now = Date.now()
    return [...this.views.values()]
      .filter((e) => !e.suspended && now - e.lastActiveAt > maxIdleMs)
      .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
      .map((e) => e.tileId)
  }

  async getMemoryByTile(): Promise<Map<string, number>> {
    const { app } = await import('electron')
    const metrics = app.getAppMetrics()
    const byPid = new Map(metrics.map((m) => [m.pid, m.memory.workingSetSize * 1024]))
    const result = new Map<string, number>()
    for (const entry of this.views.values()) {
      if (!entry.view) {
        result.set(entry.tileId, 0)
        continue
      }
      const pid = entry.view.webContents.getOSProcessId()
      result.set(entry.tileId, byPid.get(pid) ?? 0)
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
