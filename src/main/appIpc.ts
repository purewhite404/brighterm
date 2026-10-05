import { app, clipboard, ipcMain, nativeTheme, shell } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppConfig, WebTheme } from '@shared/types'
import type { ConfigStore } from './configStore'
import { isSafeExternalUrl } from '@shared/urlSafety'

/** Tells every embedded page which color scheme to prefer (takes effect immediately). */
export function applyWebTheme(theme: WebTheme): void {
  nativeTheme.themeSource = theme === 'light' ? 'light' : theme === 'system' ? 'system' : 'dark'
}

/** Config, restart and "open outside the app" calls. */
export function registerAppIpc(
  configStore: ConfigStore,
  /** The web theme this process started with — force-dark can't change without a restart. */
  startupWebTheme: WebTheme
): void {
  ipcMain.handle(IPC.configGet, () => configStore.get())
  ipcMain.handle(IPC.configSet, (_event, patch: Partial<AppConfig>) => {
    const next = configStore.set(patch)
    if (patch.appearance) applyWebTheme(next.appearance.webTheme)
    return next
  })
  ipcMain.handle(IPC.appRestartRequired, () => {
    // Only switching force-dark on or off needs a restart.
    const now = configStore.get().appearance.webTheme
    return (now === 'force-dark') !== (startupWebTheme === 'force-dark')
  })
  ipcMain.handle(IPC.appRelaunch, () => {
    configStore.flush()
    app.relaunch()
    app.exit(0)
  })
  ipcMain.handle(IPC.appIsPackaged, () => app.isPackaged)

  // Card / calendar links: web pages and mail links only (see urlSafety.ts).
  ipcMain.handle(IPC.shellOpenExternal, (_event, url: string) => {
    if (!isSafeExternalUrl(url)) throw new Error(`この URL は開けません（http / https / mailto だけ開けます）: ${String(url).slice(0, 200)}`)
    return shell.openExternal(url)
  })
  ipcMain.handle(IPC.shellOpenPath, (_event, path: string) => shell.openPath(path))
  ipcMain.handle(IPC.shellShowItem, (_event, path: string) => shell.showItemInFolder(path))
  ipcMain.handle(IPC.clipboardWriteText, (_event, text: string) => clipboard.writeText(String(text)))
}
