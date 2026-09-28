import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { getSystemSnapshot } from './sysMonitor'

/** The System Monitor's CPU / memory / process polling. (App memory comes from views/memoryLoop.ts.) */
export function registerSysmonIpc(): void {
  ipcMain.handle(IPC.sysmonSnapshot, (_event, opts?: { processes?: boolean }) => getSystemSnapshot(opts))
}
