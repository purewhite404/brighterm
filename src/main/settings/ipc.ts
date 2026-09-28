import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { EtcService } from './etc/etcService'
import { detectLinuxDesktopSettingsTool, getShortcutsForOs, openShortcut } from './settingsShortcuts'

/** The Settings tile: shortcuts into the OS's own settings, and the Linux /etc editor. */
export function registerSettingsIpc(etcService: EtcService): void {
  ipcMain.handle(IPC.settingsGetOsShortcuts, () => getShortcutsForOs())
  ipcMain.handle(IPC.settingsHasDesktopSettingsTool, () => detectLinuxDesktopSettingsTool() !== null)
  ipcMain.on(IPC.settingsOpenShortcut, (_event, shortcutId: string) => {
    const shortcut = getShortcutsForOs().find((s) => s.id === shortcutId)
    if (shortcut) openShortcut(shortcut)
  })

  ipcMain.handle(IPC.etcList, () => etcService.listCommonFiles())
  ipcMain.handle(IPC.etcRead, (_event, path: string) => etcService.readFile(path))
  ipcMain.handle(IPC.etcIsSupported, () => etcService.isSupported())
  ipcMain.handle(IPC.etcHasAugeas, () => etcService.hasAugeas())
  ipcMain.handle(IPC.etcReadAugeasTree, (_event, path: string) => etcService.readAugeasTree(path))
  ipcMain.handle(IPC.etcDiff, (_event, path: string, newContent: string) => etcService.preview(path, newContent))
  ipcMain.handle(IPC.etcValidate, (_event, path: string, candidateContent: string) =>
    etcService.validate(path, candidateContent)
  )
  ipcMain.handle(IPC.etcWrite, (_event, path: string, newContent: string) => etcService.writeFile(path, newContent))
  ipcMain.handle(IPC.etcWriteAugeasValue, (_event, path: string, augPath: string, value: string) =>
    etcService.writeAugeasValue(path, augPath, value)
  )
  ipcMain.handle(IPC.etcHistory, (_event, path: string) => etcService.listHistory(path))
  ipcMain.handle(IPC.etcRestore, (_event, path: string, fileName: string) => etcService.restore(path, fileName))
}
