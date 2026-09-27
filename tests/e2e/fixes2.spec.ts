import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MAIN_ENTRY = resolve(__dirname, '../../out/main/index.cjs')

async function launch(seedConfig?: object): Promise<{ app: ElectronApplication; window: Page; cleanup: () => Promise<void> }> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'brighterm-e2e-'))
  if (seedConfig) writeFileSync(join(userDataDir, 'config.json'), JSON.stringify(seedConfig))
  // colorScheme: null — otherwise Playwright emulates prefers-color-scheme: light on every
  // page and hides the app's own theming, which is exactly what some tests here check.
  const app = await electron.launch({ args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`], colorScheme: null })
  const window = await app.firstWindow()
  await expect(window.locator('.bt-dock')).toBeVisible({ timeout: 15_000 })
  return {
    app,
    window,
    cleanup: async () => {
      await app.close()
      rmSync(userDataDir, { recursive: true, force: true })
    }
  }
}

const dock = (window: Page, title: string) => window.locator(`.bt-dock__button[title="${title}"]`)

async function mockFolderPicker(app: ElectronApplication, dir: string): Promise<void> {
  await app.evaluate(({ dialog }, d) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [d] })) as typeof dialog.showOpenDialog
  }, dir)
}

/** Renders a page in a hidden window and returns the brightness (0-255) of its top-left pixel. */
async function pageBrightness(app: ElectronApplication, html: string): Promise<number> {
  return app.evaluate(async ({ BrowserWindow }, markup) => {
    const win = new BrowserWindow({ show: false, width: 200, height: 200, paintWhenInitiallyHidden: true })
    await win.loadURL(`data:text/html,${encodeURIComponent(markup)}`)
    await new Promise((r) => setTimeout(r, 300))
    const image = await win.webContents.capturePage()
    const bitmap = image.toBitmap() // BGRA
    win.destroy()
    return (bitmap[0] + bitmap[1] + bitmap[2]) / 3
  }, html)
}

test('Notes: an empty, freshly picked folder is immediately writable; the folder can be changed', async () => {
  const first = mkdtempSync(join(tmpdir(), 'brighterm-notes-a-'))
  const second = mkdtempSync(join(tmpdir(), 'brighterm-notes-b-'))
  writeFileSync(join(second, 'existing.md'), 'from folder B')
  const s = await launch()
  try {
    await mockFolderPicker(s.app, first)
    await dock(s.window, 'Notes').click()
    const notes = s.window.frameLocator('iframe.bt-plugin-frame')
    await notes.locator('#pick-folder').click()

    // The picker must actually go away and the editor be on screen (the old bug: both stayed visible).
    await expect(notes.locator('#picker-screen')).toBeHidden()
    await expect(notes.locator('#content')).toBeInViewport()

    // Typing straight away, with no note open, creates one.
    await notes.locator('#content').fill('最初のメモ')
    await expect.poll(() => readdirSync(first).filter((f) => f.endsWith('.md')).length, { timeout: 5000 }).toBe(1)
    const [created] = readdirSync(first).filter((f) => f.endsWith('.md'))
    expect(readFileSync(join(first, created), 'utf-8')).toBe('最初のメモ')
    await expect(notes.locator('.file-row')).toHaveCount(1)

    // "新規" + typing also saves.
    await notes.locator('#new-note').click()
    await notes.locator('#content').fill('二つ目')
    await expect.poll(() => readdirSync(first).filter((f) => f.endsWith('.md')).length, { timeout: 5000 }).toBe(2)

    // Switch folders.
    await mockFolderPicker(s.app, second)
    await notes.locator('#change-folder').click()
    await expect(notes.locator('.file-row')).toHaveCount(1)
    await expect(notes.locator('#content')).toHaveValue('from folder B')
  } finally {
    await s.cleanup()
    rmSync(first, { recursive: true, force: true })
    rmSync(second, { recursive: true, force: true })
  }
})

test('AI Builder: copying the prompt says "コピーしました" and puts the prompt on the clipboard', async () => {
  const s = await launch()
  try {
    await dock(s.window, 'AI Builder').click()
    await s.window.getByPlaceholder('例: 写真フォルダを見るビューアを追加して').fill('RSS リーダー')
    const copy = s.window.getByRole('button', { name: /^コピー$/ })
    await copy.click()
    await expect(s.window.getByRole('button', { name: /コピーしました/ })).toBeVisible()
    const clipboard = await s.app.evaluate(({ clipboard }) => clipboard.readText())
    expect(clipboard).toContain('作ってほしいもの: RSS リーダー')
    // ...and goes back to normal afterwards.
    await expect(s.window.getByRole('button', { name: /^コピー$/ })).toBeVisible({ timeout: 4000 })
  } finally {
    await s.cleanup()
  }
})

test('Terminal: `exit` closes the tile', async () => {
  const s = await launch()
  try {
    await dock(s.window, 'Terminal').click()
    await expect(s.window.locator('.xterm-rows')).toContainText(/\S/, { timeout: 15_000 })
    await s.window.waitForTimeout(2200) // past the "failed to start" grace period
    await s.window.locator('.bt-terminal-tile').click()
    await s.window.keyboard.type('exit')
    await s.window.keyboard.press('Enter')
    await expect(s.window.locator('.bt-tile-slot')).toHaveCount(0, { timeout: 10_000 })
  } finally {
    await s.cleanup()
  }
})

test('Web pages see prefers-color-scheme: dark by default, and the setting switches it live', async () => {
  const s = await launch()
  try {
    const prefersDark = (): Promise<boolean> =>
      s.app.evaluate(async ({ BrowserWindow }) => {
        const win = new BrowserWindow({ show: false })
        await win.loadURL('data:text/html,<p>x</p>')
        const dark = await win.webContents.executeJavaScript('matchMedia("(prefers-color-scheme: dark)").matches')
        win.destroy()
        return dark as boolean
      })

    expect(await prefersDark()).toBe(true)

    await dock(s.window, 'Settings').click()
    const theme = s.window.locator('.bt-settings__field', { hasText: 'Web ページの外観' }).locator('select')
    await theme.selectOption('light')
    await expect.poll(prefersDark).toBe(false)
    await theme.selectOption('dark')
    await expect.poll(prefersDark).toBe(true)

    // Force-dark needs a restart, and the UI says so.
    await theme.selectOption('force-dark')
    await expect(s.window.locator('.bt-settings__restart')).toBeVisible()
  } finally {
    await s.cleanup()
  }
})

test('"常にダーク" darkens a page that has no dark theme of its own (after restart)', async () => {
  const whitePage = '<html><body style="margin:0;background:#fff;height:100vh"></body></html>'

  const normal = await launch()
  let normalBrightness: number
  try {
    normalBrightness = await pageBrightness(normal.app, whitePage)
  } finally {
    await normal.cleanup()
  }

  const forced = await launch({ appearance: { webTheme: 'force-dark' } })
  try {
    const forcedBrightness = await pageBrightness(forced.app, whitePage)
    expect(normalBrightness).toBeGreaterThan(200)
    expect(forcedBrightness).toBeLessThan(80)
  } finally {
    await forced.cleanup()
  }
})
