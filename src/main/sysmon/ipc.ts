import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { SysmonClient } from './sysmonClient'
import createSysmonWorker from './sysmonWorker?nodeWorker'

/**
 * The System Monitor's CPU / memory / process polling, answered by a worker
 * thread (see sysmonClient.ts). App memory comes from views/memoryLoop.ts.
 * Returns a dispose function for app quit.
 */
export function registerSysmonIpc(): () => void {
  const client = new SysmonClient(() => createSysmonWorker({}))
  ipcMain.handle(IPC.sysmonSnapshot, (_event, opts?: { processes?: boolean }) => client.snapshot(opts))
  return () => client.dispose()
}
