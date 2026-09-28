import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { defaultShell, listAvailableShells, type PtyManager } from './ptyManager'

/** Terminal tiles: one pty per tile, which keeps running while the tile is off screen. */
export function registerTerminalIpc(ptyManager: PtyManager): void {
  ipcMain.handle(IPC.shellList, () => listAvailableShells())
  ipcMain.handle(IPC.shellDefault, () => defaultShell())

  ipcMain.handle(IPC.ptyCreate, (_event, tileId: string, opts: { shellId?: string; cwd?: string; cols: number; rows: number }) => {
    return ptyManager.create(tileId, opts)
  })
  ipcMain.on(IPC.ptyWrite, (_event, tileId: string, data: string) => ptyManager.write(tileId, data))
  ipcMain.on(IPC.ptyResize, (_event, tileId: string, cols: number, rows: number) =>
    ptyManager.resize(tileId, cols, rows)
  )
  ipcMain.handle(IPC.ptyKill, (_event, tileId: string) => ptyManager.kill(tileId))
}
