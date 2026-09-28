import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { Rect } from '@shared/types'
import type { ViewManager } from './viewManager'

/**
 * Tile lifecycle and the web views drawn over tiles (Browser, Mail, web
 * plugins, AI Builder chat, Files preview), plus hiding them all under an overlay.
 */
export function registerViewsIpc(
  viewManager: ViewManager,
  /** Frees everything else a closed tile held (its terminal, its file watchers). */
  onTileClosed: (tileId: string) => void
): void {
  ipcMain.handle(IPC.tileCreate, (_event, args: { tileId: string; kind: string; url?: string; partitionId?: string; compactCss?: string }) => {
    if (args.kind === 'web' || args.kind === 'plugin') {
      if (!args.url || !args.partitionId) return
      viewManager.create(args.tileId, args.url, args.partitionId, args.compactCss)
    }
  })
  ipcMain.handle(IPC.tileClose, async (_event, tileId: string) => {
    await viewManager.close(tileId)
    onTileClosed(tileId)
  })
  ipcMain.handle(IPC.tileSetBounds, (_event, tileId: string, rect: Rect) => {
    viewManager.setBounds(tileId, rect)
  })
  ipcMain.handle(IPC.tileFocus, (_event, tileId: string) => {
    viewManager.markActive(tileId)
  })
  ipcMain.handle(IPC.tileSuspend, async (_event, tileId: string) => {
    await viewManager.suspend(tileId)
  })
  ipcMain.handle(IPC.tileHide, (_event, tileId: string) => viewManager.hide(tileId))
  ipcMain.handle(IPC.tileNavigate, (_event, tileId: string, url: string, onlyIfChanged?: boolean) =>
    viewManager.navigate(tileId, url, onlyIfChanged)
  )
  ipcMain.handle(IPC.tileGoBack, (_event, tileId: string) => viewManager.goBack(tileId))
  ipcMain.handle(IPC.tileGoForward, (_event, tileId: string) => viewManager.goForward(tileId))
  ipcMain.handle(IPC.tileReload, (_event, tileId: string) => viewManager.reload(tileId))
  ipcMain.handle(IPC.tileResume, (_event, tileId: string) => {
    viewManager.resume(tileId)
  })
  ipcMain.handle(IPC.overlayShow, async () => {
    await viewManager.hideAllForOverlay()
  })
  ipcMain.handle(IPC.overlayHide, () => {
    viewManager.showAllAfterOverlay()
  })
}
