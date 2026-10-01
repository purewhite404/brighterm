import { BaseWindow, WebContentsView, shell } from 'electron'
import { join } from 'node:path'
import { is } from './utils/env'

/** Sends an event to the renderer (a no-op while there's no window). */
export type Send = (channel: string, ...args: unknown[]) => void

/**
 * The one app window: a BaseWindow whose whole content is the shell page
 * (the React UI). Tiles' web views are drawn on top of it by ViewManager.
 */
let mainWindow: BaseWindow | null = null
let shellView: WebContentsView | null = null

export function getMainWindow(): BaseWindow | null {
  return mainWindow
}

export const send: Send = (channel, ...args) => {
  shellView?.webContents.send(channel, ...args)
}

/** The shell page's renderer process, where Terminal, Files, Notes & co. live. */
export function shellProcessId(): number | null {
  return shellView?.webContents.getOSProcessId() ?? null
}

export function createMainWindow(): void {
  mainWindow = new BaseWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#0e0f13',
    autoHideMenuBar: true
  })

  shellView = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  })
  mainWindow.contentView.addChildView(shellView)
  resizeShellView()

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    shellView.webContents.loadURL(process.env['ELECTRON_RENDERER_URL'])
    shellView.webContents.openDevTools({ mode: 'detach' })
  } else {
    shellView.webContents.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('resize', resizeShellView)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  // BaseWindow has no 'ready-to-show' (that's BrowserWindow-only); show once the shell has painted.
  // E2E runs (BRIGHTERM_BACKGROUND=1) show it without taking the keyboard from whatever the user is typing in.
  shellView.webContents.once('did-finish-load', () => (inBackground() ? mainWindow?.showInactive() : mainWindow?.show()))

  // Any link a tile or the shell wants to open externally goes to the OS browser.
  shellView.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
}

function resizeShellView(): void {
  if (!mainWindow || !shellView) return
  const bounds = mainWindow.getContentBounds()
  shellView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height })
}

/** Set by tests/e2e/helpers.ts: the app must never grab the focus from the user's other windows. */
const inBackground = (): boolean => process.env.BRIGHTERM_BACKGROUND === '1'

/** A second launch lands here (see the single-instance lock in index.ts). */
export function focusMainWindow(): void {
  if (mainWindow && !inBackground()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
}
