import { BaseWindow, WebContentsView, screen, shell, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { join } from 'node:path'
import { is } from './utils/env'
import { perfMark } from './perf'
import { tileIdOfPluginFrame } from '@shared/pluginFrame'
import { isSafeExternalUrl } from '@shared/urlSafety'
import { pluginFrameMayNavigate, shellMayNavigate } from './security'

/** Sends an event to the renderer (a no-op while there's no window). */
export type Send = (channel: string, ...args: unknown[]) => void

/**
 * The one app window: a BaseWindow whose whole content is the shell page
 * (the React UI). Tiles' web views are drawn on top of it by ViewManager.
 */
let mainWindow: BaseWindow | null = null
let shellView: WebContentsView | null = null

/** Only the shell page's main frame may call main over IPC (see guardIpcSenders in security.ts). */
export function isShellSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const wc = shellView?.webContents
  if (!wc || wc.isDestroyed() || event.sender !== wc) return false
  const frame = event.senderFrame
  return !!frame && frame.frameTreeNodeId === wc.mainFrame.frameTreeNodeId
}

export function getMainWindow(): BaseWindow | null {
  return mainWindow
}

export const send: Send = (channel, ...args) => {
  shellView?.webContents.send(channel, ...args)
}

/** The shell page's renderer process, where Terminal, Files, Calendar & co. live. */
export function shellProcessId(): number | null {
  return shellView?.webContents.getOSProcessId() ?? null
}

/** tileId -> OS pid of each plugin tile's <iframe> (they run in processes of their own). */
export function pluginFramePids(): Map<string, number> {
  const result = new Map<string, number>()
  if (!shellView || shellView.webContents.isDestroyed()) return result
  for (const frame of shellView.webContents.mainFrame.framesInSubtree) {
    const tileId = tileIdOfPluginFrame(frame.name)
    if (tileId) result.set(tileId, frame.osProcessId)
  }
  return result
}

export function createMainWindow(): void {
  mainWindow = new BaseWindow({
    width: 1400,
    height: 900,
    ...(inBackground() ? offScreenOptions() : {}),
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
      // Sandboxed: the preload only needs contextBridge + ipcRenderer.
      sandbox: true,
      nodeIntegration: false
    }
  })
  lockNavigation(shellView.webContents)
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
  shellView.webContents.once('did-finish-load', () => {
    perfMark('main:shell-loaded')
    if (inBackground()) mainWindow?.showInactive()
    else mainWindow?.show()
  })

  // A link the shell or a plugin <iframe> opens in a new window goes to the OS browser —
  // web pages and mail links only: a file:// / UNC / custom-protocol URL would start a program.
  shellView.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    else console.warn(`[window] refused to open ${url.slice(0, 200)}`)
    return { action: 'deny' }
  })
}

/**
 * The shell page holds window.api (terminals, any file), so it never shows another page:
 * a file or link dropped on the window would otherwise replace it — with the API. Plugin
 * <iframe>s stay on their own plugin-app:// pages.
 */
function lockNavigation(wc: WebContents): void {
  wc.on('will-frame-navigate', (event) => {
    const frame = event.frame
    if (event.isMainFrame) {
      if (shellMayNavigate(wc.getURL(), event.url)) return
    } else if (frame) {
      // The plugin's own <iframe>: the ancestor right under the shell page.
      let owner = frame
      while (owner.parent && owner.parent.frameTreeNodeId !== wc.mainFrame.frameTreeNodeId) owner = owner.parent
      if (pluginFrameMayNavigate(owner.url, event.url)) return
    }
    event.preventDefault()
    console.warn(`[window] blocked navigation to ${event.url.slice(0, 200)}`)
  })
}

function resizeShellView(): void {
  if (!mainWindow || !shellView) return
  const bounds = mainWindow.getContentBounds()
  shellView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height })
}

/**
 * Set by tests/e2e/helpers.ts: the app must neither take the focus from the user's other windows nor
 * cover them. The window opens past the right edge of every display (frameless on macOS, see
 * offScreenOptions); index.ts turns Chromium's occlusion check off in this mode so the page still counts as visible and keeps painting
 * (Playwright's input and screenshots go through the DevTools protocol, not the screen).
 */
export const inBackground = (): boolean => process.env.BRIGHTERM_BACKGROUND === '1'

function offScreenOptions(): Electron.BaseWindowConstructorOptions {
  const right = Math.max(...screen.getAllDisplays().map((d) => d.bounds.x + d.bounds.width))
  const position = { x: right + 100, y: 0 }
  // macOS pulls a framed window back on screen when it's shown (and keeps 40 px of it on screen
  // after setPosition). Electron leaves a frameless window with enableLargerThanScreen where it was put.
  if (process.platform === 'darwin') return { ...position, frame: false, enableLargerThanScreen: true }
  return position
}

/** A second launch lands here (see the single-instance lock in index.ts). */
export function focusMainWindow(): void {
  if (mainWindow && !inBackground()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
}
