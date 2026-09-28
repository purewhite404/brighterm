import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MAIN_ENTRY = resolve(__dirname, '../../out/main/index.cjs')

/** Launches against a given user-data dir, so a test can quit and relaunch "the same install". */
async function launchIn(userDataDir: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({ args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`], colorScheme: null })
  const window = await app.firstWindow()
  await expect(window.locator('.bt-dock')).toBeVisible({ timeout: 15_000 })
  return { app, window }
}

const dock = (window: Page, title: string) => window.locator(`.bt-dock__button[title="${title}"]`)

/** Tiny local site (the sandbox can't rely on the internet): /a links to /b. */
async function startSite(): Promise<{ origin: string; server: Server }> {
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

/** URL of every web view drawn over the shell (the shell's own view excluded). */
async function webViewUrls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ BaseWindow }) => {
    const [win] = BaseWindow.getAllWindows()
    return win.contentView.children
      .slice(1)
      .map((v) => (v as Electron.WebContentsView).webContents.getURL())
  })
}

test('Terminal starts PowerShell 7 on Windows', async () => {
  test.skip(process.platform !== 'win32', 'Windows only')
  const dir = mkdtempSync(join(tmpdir(), 'brighterm-e2e-'))
  const s = await launchIn(dir)
  try {
    await dock(s.window, 'Terminal').click()
    const rows = s.window.locator('.xterm-rows')
    await expect(rows).toContainText(/PS .*>/, { timeout: 20_000 })
    await s.window.locator('.bt-terminal-tile').click()
    await s.window.keyboard.type('"ver=$($PSVersionTable.PSVersion.Major)"')
    await s.window.keyboard.press('Enter')
    await expect(rows).toContainText('ver=7', { timeout: 10_000 })
  } finally {
    await s.app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Browser: a new tile is only an address bar; the page it was on comes back after a restart', async () => {
  const site = await startSite()
  const dir = mkdtempSync(join(tmpdir(), 'brighterm-e2e-'))
  let s = await launchIn(dir)
  try {
    await dock(s.window, 'Browser').click()
    const address = s.window.locator('.bt-browser__address')
    await expect(address).toHaveValue('')
    await expect(address).toBeFocused()
    await expect(address).toHaveAttribute('placeholder', /DuckDuckGo で検索/)
    expect(await webViewUrls(s.app)).toEqual([]) // no search page opened

    // Plain words are searched with the configured engine.
    await address.fill('hello world')
    await address.press('Enter')
    await expect(address).toHaveValue('https://duckduckgo.com/?q=hello%20world')

    // A URL is opened as-is; following a link updates the bar.
    await address.fill(`${site.origin}/a`)
    await address.press('Enter')
    await expect.poll(() => webViewUrls(s.app)).toEqual([`${site.origin}/a`])
    await s.app.evaluate(({ BaseWindow }) => {
      const view = BaseWindow.getAllWindows()[0].contentView.children[1] as Electron.WebContentsView
      return view.webContents.executeJavaScript('document.getElementById("next").click()')
    })
    await expect(address).toHaveValue(`${site.origin}/b`)

    await s.app.close()
    s = await launchIn(dir)
    await expect(s.window.locator('.bt-browser__address')).toHaveValue(`${site.origin}/b`)
    await expect.poll(() => webViewUrls(s.app), { timeout: 10_000 }).toEqual([`${site.origin}/b`])
  } finally {
    await s.app.close()
    site.server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Files: the expanded tree is restored after a restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brighterm-tree-'))
  mkdirSync(join(root, 'alpha', 'inner'), { recursive: true })
  mkdirSync(join(root, 'beta'))
  writeFileSync(join(root, 'alpha', 'inner', 'deep.txt'), '')
  const dir = mkdtempSync(join(tmpdir(), 'brighterm-e2e-'))
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({
      workspaces: [
        {
          id: 'ws',
          name: 'Home',
          icon: 'home',
          layout: { type: 'leaf', tileId: 'files' },
          tiles: {
            files: { id: 'files', kind: 'builtin', typeId: 'file-explorer', title: 'Files', icon: 'folder', config: { rootPath: root } }
          }
        }
      ],
      activeWorkspaceId: 'ws'
    })
  )
  const names = (w: Page) => w.locator('.bt-file-row__name').allTextContents()
  const row = (w: Page, name: string) => w.locator('.bt-file-row').filter({ has: w.getByText(name, { exact: true }) })
  let s = await launchIn(dir)
  try {
    await expect.poll(() => names(s.window)).toEqual([root])
    await s.window.locator('.bt-file-row').first().click()
    await row(s.window, 'alpha').click()
    await row(s.window, 'inner').click()
    const expanded = [root, 'alpha', 'inner', 'deep.txt', 'beta']
    await expect.poll(() => names(s.window)).toEqual(expanded)

    await s.app.close()
    s = await launchIn(dir)
    await expect.poll(() => names(s.window), { timeout: 10_000 }).toEqual(expanded)

    // Collapsing is remembered too.
    await row(s.window, 'alpha').click()
    await expect.poll(() => names(s.window)).toEqual([root, 'alpha', 'beta'])
    await s.app.close()
    s = await launchIn(dir)
    await expect.poll(() => names(s.window), { timeout: 10_000 }).toEqual([root, 'alpha', 'beta'])
  } finally {
    await s.app.close()
    rmSync(dir, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('Dock: an empty workspace can be removed, one with tiles cannot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brighterm-e2e-'))
  const s = await launchIn(dir)
  try {
    const workspaces = s.window.locator('.bt-dock__workspace')
    await expect(workspaces).toHaveCount(1)
    // The only workspace can't be removed.
    await workspaces.first().hover()
    await expect(s.window.locator('.bt-dock__workspace-remove')).toHaveCount(0)

    await dock(s.window, 'Terminal').click() // first workspace now has a tile
    await dock(s.window, '新しいワークスペース').click()
    await expect(workspaces).toHaveCount(2)

    await workspaces.first().hover()
    await expect(workspaces.first().locator('.bt-dock__workspace-remove')).toHaveCount(0)
    const remove = workspaces.nth(1).locator('.bt-dock__workspace-remove')
    await expect(remove).toBeHidden() // only on hover
    await workspaces.nth(1).hover()
    await expect(remove).toBeVisible()
    await remove.click()
    await expect(workspaces).toHaveCount(1)
    // Back on the remaining workspace, its terminal still there.
    await expect(s.window.locator('.bt-terminal-tile')).toBeVisible()
  } finally {
    await s.app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('System Monitor: 0.5 s updates over a 60 s axis; app memory is counted without web tiles', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brighterm-e2e-'))
  const s = await launchIn(dir)
  try {
    await dock(s.window, 'System Monitor').click()
    await expect(s.window.locator('.bt-cpu-chart__axis', { hasText: '60秒前' })).toBeVisible({ timeout: 10_000 })
    // ~0.5 s per sample: after 3 s there are several points, not one or two.
    await s.window.waitForTimeout(3000)
    const points = await s.window
      .locator('.bt-cpu-chart__line')
      .evaluate((el) => (el.getAttribute('points') ?? '').trim().split(/\s+/).length)
    expect(points).toBeGreaterThanOrEqual(4)

    // No web tile is open, yet the UI process (Terminal/Files/... live there) is listed with real memory.
    const shellRow = s.window.locator('.bt-sysmon__row', { hasText: 'UI・内蔵タイル' })
    await expect(shellRow).toBeVisible({ timeout: 10_000 })
    await expect(shellRow.locator('.bt-sysmon__row-badge')).toHaveText(/\d+ MB/)
    const total = s.window.locator('.bt-stat-card', { hasText: 'Brighterm' }).locator('.bt-stat-card__value')
    await expect(total).toHaveText(/\d+ MB|GB/)
  } finally {
    await s.app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('AI Builder: pasting the prompt into the chat does not change the chat pane size', async () => {
  const site = await startSite()
  const dir = mkdtempSync(join(tmpdir(), 'brighterm-e2e-'))
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({
      aiBuilder: { mode: 'web-bridge', webBridgeUrl: `${site.origin}/chat`, apiProvider: 'openai', apiModel: 'gpt-4.1' }
    })
  )
  const s = await launchIn(dir)
  try {
    await dock(s.window, 'AI Builder').click()
    await expect.poll(() => webViewUrls(s.app), { timeout: 10_000 }).toEqual([`${site.origin}/chat`])
    const bounds = () =>
      s.app.evaluate(({ BaseWindow }) => {
        const view = BaseWindow.getAllWindows()[0].contentView.children[1] as Electron.WebContentsView
        return view.getBounds()
      })
    const pane = await s.window.locator('.bt-ai-builder__chat').boundingBox()
    const before = await bounds()
    expect(before.width).toBeGreaterThan(0)
    expect(Math.abs(before.x + before.width - (pane!.x + pane!.width))).toBeLessThanOrEqual(2)

    await s.window.locator('.bt-ai-builder__row input').first().fill('写真ビューア')
    await s.window.getByRole('button', { name: /コピー/ }).first().click()
    await s.app.evaluate(async ({ BaseWindow }) => {
      const view = BaseWindow.getAllWindows()[0].contentView.children[1] as Electron.WebContentsView
      await view.webContents.executeJavaScript('document.getElementById("box").focus()')
      view.webContents.paste()
    })
    await s.window.waitForTimeout(500)
    const pasted = await s.app.evaluate(({ BaseWindow }) => {
      const view = BaseWindow.getAllWindows()[0].contentView.children[1] as Electron.WebContentsView
      return view.webContents.executeJavaScript(
        '({ len: document.getElementById("box").value.length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })'
      )
    })
    expect(pasted.len).toBeGreaterThan(1000)
    expect(pasted.overflow).toBe(0)
    expect(await bounds()).toEqual(before)
  } finally {
    await s.app.close()
    site.server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
