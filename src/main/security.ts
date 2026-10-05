import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent, Session, WebContents } from 'electron'
import { isSafeExternalUrl } from '@shared/urlSafety'
import { PLUGIN_PROTOCOL } from './plugins/pluginFileUrl'

/*
 * App-wide guards around what pages may do. The decisions are pure functions (unit
 * tested); the install* functions hook them into Electron.
 *
 * Why: the shell page holds `window.api` (terminals, any file). If it ever showed another
 * page — a file or link dropped on the window, a plugin frame escaping — that page would
 * get the whole API. Web pages in tiles get Electron's default permissions otherwise,
 * which is "allow everything" (camera, microphone, location, launching other programs).
 */

// ---- navigation -------------------------------------------------------------------------

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** The shell never leaves its own page: only a reload / in-page change of the same document. */
export function shellMayNavigate(currentUrl: string, nextUrl: string): boolean {
  const current = parse(currentUrl)
  const next = parse(nextUrl)
  if (!current || !next) return false
  return current.protocol === next.protocol && current.host === next.host && current.pathname === next.pathname
}

/** Chromium's built-in PDF viewer (a plugin showing a PDF from fs.fileUrl() in an <iframe>). */
const PDF_VIEWER_ORIGIN = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai'

/**
 * A plugin <iframe> (and any frame inside it) stays on plugin-app:// — and on its own
 * plugin's host once it has one (it starts at about:blank before its src loads).
 * Otherwise a plugin could swap itself for any web site, which then gets its Host API
 * calls answered. Blank / srcdoc / blob: frames a plugin makes itself stay its own
 * (same opaque origin, same CSP).
 */
export function pluginFrameMayNavigate(
  /** URL of the plugin's own <iframe> (the frame right under the shell), for a frame inside it too. */
  ownerUrl: string,
  nextUrl: string
): boolean {
  if (nextUrl === 'about:blank' || nextUrl === 'about:srcdoc' || nextUrl.startsWith('blob:')) return true
  if (nextUrl.startsWith(`${PDF_VIEWER_ORIGIN}/`)) return true
  const next = parse(nextUrl)
  if (!next || next.protocol !== `${PLUGIN_PROTOCOL}:`) return false
  const owner = parse(ownerUrl)
  if (!owner || owner.protocol !== `${PLUGIN_PROTOCOL}:`) return true
  return owner.host === next.host
}

/**
 * The shell's session holds only the shell page and the plugin <iframe>s, and no frame in
 * it ever needs a web or file page. A plugin frame navigating itself to a web site is
 * already stopped by the shell page's CSP (`frame-src plugin-app:`, ERR_BLOCKED_BY_CSP);
 * this stops it again at the request, should that CSP ever change, and covers frames
 * nested inside a plugin. plugin-app:// requests don't come through here.
 */
export function shellSessionRequestAllowed(resourceType: string): boolean {
  return resourceType !== 'subFrame'
}

// ---- IPC ----------------------------------------------------------------------------------

/**
 * Only the shell page's main frame may call main. The preload is only there anyway; this
 * keeps it that way if a frame ever gets an ipcRenderer (Electron bug, a future preload).
 */
export function guardIpcSenders(ipc: IpcMain, isTrusted: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean): void {
  const handle = ipc.handle.bind(ipc)
  ipc.handle = (channel, listener) =>
    handle(channel, (event, ...args) => {
      if (!isTrusted(event)) throw new Error(`IPC "${channel}" from an untrusted frame`)
      return listener(event, ...args)
    })
  const on = ipc.on.bind(ipc)
  ipc.on = ((channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void) =>
    on(channel, (event, ...args) => {
      if (isTrusted(event)) listener(event, ...args)
    })) as typeof ipc.on
}

// ---- permissions --------------------------------------------------------------------------

export type PermissionPolicy = 'allow' | 'ask' | 'deny'

/** Harmless: writing to the clipboard on a user's click, a video going fullscreen. */
const ALWAYS_ALLOWED = new Set(['clipboard-sanitized-write', 'fullscreen'])
/** What a web page in a tile may get after the user says yes. */
const ASKABLE = new Set(['notifications', 'media', 'geolocation', 'clipboard-read', 'display-capture'])

/**
 * `fromWebView`: a page in a Browser / Mail / web-plugin tile (its own session). The shell
 * and the plugin <iframe>s (default session) never get more than the harmless ones.
 */
export function permissionPolicy(
  permission: string,
  { fromWebView, externalURL }: { fromWebView: boolean; externalURL?: string }
): PermissionPolicy {
  if (ALWAYS_ALLOWED.has(permission)) return 'allow'
  if (!fromWebView) return 'deny'
  if (permission === 'openExternal') return externalURL && isSafeExternalUrl(externalURL) ? 'ask' : 'deny'
  return ASKABLE.has(permission) ? 'ask' : 'deny'
}

/** Japanese words for the confirmation dialog. */
export function permissionLabel(permission: string, mediaTypes?: string[]): string {
  switch (permission) {
    case 'notifications':
      return '通知の表示'
    case 'media': {
      const video = mediaTypes?.includes('video')
      const audio = mediaTypes?.includes('audio')
      return video && audio ? 'カメラとマイク' : video ? 'カメラ' : audio ? 'マイク' : 'カメラ・マイク'
    }
    case 'geolocation':
      return '現在地'
    case 'clipboard-read':
      return 'クリップボードの読み取り'
    case 'display-capture':
      return '画面の共有'
    case 'openExternal':
      return '外部アプリで開くこと'
    default:
      return permission
  }
}

export interface PermissionAsker {
  /** Shows the question; resolves true when the user allows it. */
  ask: (origin: string, what: string, detail?: string) => Promise<boolean>
}

/**
 * Installs the policy on one session. Answers are remembered per session + origin +
 * permission until the app quits (not on disk: a restart asks again).
 */
export function installPermissionPolicy(ses: Session, fromWebView: boolean, asker: PermissionAsker): void {
  const answers = new Map<string, boolean>()
  const originOf = (url: string): string => parse(url)?.origin ?? url

  ses.setPermissionRequestHandler((_wc: WebContents, permission, callback, details) => {
    const externalURL = 'externalURL' in details ? details.externalURL : undefined
    const policy = permissionPolicy(permission, { fromWebView, externalURL })
    if (policy !== 'ask') {
      callback(policy === 'allow')
      return
    }
    const origin = originOf(details.requestingUrl)
    // openExternal is asked per URL (each one is a different program to start).
    const key = permission === 'openExternal' ? `${permission}|${externalURL}` : `${permission}|${origin}`
    const known = answers.get(key)
    if (known !== undefined) {
      callback(known)
      return
    }
    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes as string[] | undefined) : undefined
    asker
      .ask(origin, permissionLabel(permission, mediaTypes), externalURL)
      .then((allowed) => {
        answers.set(key, allowed)
        callback(allowed)
      })
      .catch(() => callback(false))
  })

  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    const policy = permissionPolicy(permission, { fromWebView })
    if (policy === 'allow') return true
    if (policy === 'deny') return false
    return answers.get(`${permission}|${originOf(requestingOrigin)}`) === true
  })
}

// ---- wiring -------------------------------------------------------------------------------

/**
 * Called once after app.ready, before any window or web view exists: no <webview> anywhere,
 * the shell's session (shell page + plugin <iframe>s) gets only the harmless permissions,
 * every tile session (created later by ViewManager) asks the user first.
 */
export function installSecurityPolicies(getWindow: () => import('electron').BaseWindow | null): void {
  // Loaded here so the pure functions above stay importable in unit tests.
  const { app, dialog, session } = require('electron') as typeof import('electron')

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })

  const asker: PermissionAsker = {
    ask: async (origin, what, detail) => {
      const options = {
        type: 'question' as const,
        buttons: ['許可する', '許可しない'],
        defaultId: 1,
        cancelId: 1,
        title: 'Brighterm',
        message: `${origin} が「${what}」を求めています。許可しますか？`,
        detail: detail ? `開こうとしているもの: ${detail.slice(0, 300)}` : 'このアプリを終了するまで、この答えを覚えておきます。'
      }
      const win = getWindow()
      const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
      return response === 0
    }
  }

  installPermissionPolicy(session.defaultSession, false, asker)
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'file://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*'] },
    (details, callback) => {
      const allowed = shellSessionRequestAllowed(details.resourceType)
      if (!allowed) console.warn(`[security] blocked a frame loading ${details.url.slice(0, 200)}`)
      callback({ cancel: !allowed })
    }
  )
  app.on('session-created', (ses) => {
    if (ses !== session.defaultSession) installPermissionPolicy(ses, true, asker)
  })
}
