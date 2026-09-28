import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { Send } from '../window'
import {
  createEntry,
  getHomeDir,
  inspectFile,
  listDir,
  readTextFile,
  statEntry,
  writeTextFile,
  type FsWatchRegistry
} from './fsService'

/** The Files tile: listing, previews (content-sniffed), creating entries, and watching folders. */
export function registerFilesIpc(fsWatchers: FsWatchRegistry, send: Send): void {
  ipcMain.handle(IPC.fsListDir, (_event, dirPath: string) => listDir(dirPath))
  ipcMain.handle(IPC.fsReadFile, (_event, filePath: string) => readTextFile(filePath))
  ipcMain.handle(IPC.fsWriteFile, (_event, filePath: string, content: string) => writeTextFile(filePath, content))
  ipcMain.handle(IPC.fsWatchStart, (_event, watchId: string, dirPath: string) => {
    fsWatchers.watch(watchId, dirPath, (event, changedPath) => {
      send(IPC.fsChanged, watchId, event, changedPath)
    })
  })
  ipcMain.handle(IPC.fsWatchStop, (_event, watchId: string) => fsWatchers.stop(watchId))
  ipcMain.handle(IPC.fsHomeDir, () => getHomeDir())
  ipcMain.handle(IPC.fsStatEntry, (_event, filePath: string) => statEntry(filePath))
  ipcMain.handle(IPC.fsInspect, (_event, filePath: string) => inspectFile(filePath))
  ipcMain.handle(IPC.fsCreate, (_event, parentDir: string, name: string, kind: 'dir' | 'file') =>
    createEntry(parentDir, name, kind)
  )
}
