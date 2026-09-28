import { expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const MAIN_ENTRY = resolve(__dirname, '../../out/main/index.cjs')

export interface Session {
  app: ElectronApplication
  window: Page
  /** Uncaught errors in the shell page. */
  pageErrors: string[]
  /** Shell responses with status >= 400. */
  failedResponses: string[]
}

export function tempDir(prefix = 'brighterm-e2e-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

/**
 * Launches the built app against `userDataDir`, so a test can quit and relaunch "the same install".
 * colorScheme: null — otherwise Playwright emulates prefers-color-scheme: light on every page
 * and hides the app's own theming.
 */
export async function launchIn(userDataDir: string): Promise<Session> {
  const app = await electron.launch({ args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`], colorScheme: null })
  const window = await app.firstWindow()
  const pageErrors: string[] = []
  const failedResponses: string[] = []
  window.on('pageerror', (err) => pageErrors.push(err.message))
  window.on('response', (res) => {
    if (res.status() >= 400) failedResponses.push(`${res.status()} ${res.url()}`)
  })
  await expect(window.locator('.bt-dock')).toBeVisible({ timeout: 15_000 })
  return { app, window, pageErrors, failedResponses }
}

/** Launches a fresh install (optionally seeded with a config.json); `cleanup` quits and deletes it. */
export async function launch(config?: object): Promise<Session & { cleanup: () => Promise<void> }> {
  const userDataDir = tempDir()
  if (config) seedConfig(userDataDir, config)
  const session = await launchIn(userDataDir)
  return {
    ...session,
    cleanup: async () => {
      await session.app.close()
      removeDir(userDataDir)
    }
  }
}

export function seedConfig(userDataDir: string, config: object): void {
  writeFileSync(join(userDataDir, 'config.json'), JSON.stringify(config))
}

/** One workspace with the given tiles and layout (by default: one tile, or the first two side by side). */
export function seedWorkspace(userDataDir: string, tiles: Record<string, object>, layout?: object): void {
  const ids = Object.keys(tiles)
  const leaf = (id: string): object => ({ type: 'leaf', tileId: id })
  seedConfig(userDataDir, {
    workspaces: [
      {
        id: 'ws',
        name: 'Home',
        icon: 'home',
        layout: layout ?? (ids.length === 1 ? leaf(ids[0]) : { type: 'split', direction: 'row', ratio: 0.5, a: leaf(ids[0]), b: leaf(ids[1]) }),
        tiles
      }
    ],
    activeWorkspaceId: 'ws'
  })
}

export const dock = (window: Page, title: string) => window.locator(`.bt-dock__button[title="${title}"]`)

/** Stands in for the native folder picker. */
export async function mockFolderPicker(app: ElectronApplication, dir: string): Promise<void> {
  await app.evaluate(({ dialog }, d) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [d] })) as typeof dialog.showOpenDialog
  }, dir)
}

/** URL of every web view drawn over the shell (the shell's own view excluded). */
export async function webViewUrls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ BaseWindow }) => {
    const [win] = BaseWindow.getAllWindows()
    return win.contentView.children.slice(1).map((v) => (v as Electron.WebContentsView).webContents.getURL())
  })
}

/** Tiny local site (the sandbox can't rely on the internet): /a links to /b, /chat is a textarea. */
export async function startSite(): Promise<{ origin: string; server: Server }> {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    if (req.url === '/a') res.end('<title>Page A</title><a id="next" href="/b">to B</a>')
    else if (req.url === '/chat')
      res.end('<title>Chat</title><body style="margin:0"><textarea id="box" style="width:100%;height:200px"></textarea></body>')
    else res.end('<title>Page B</title><p>page b</p>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server }
}
