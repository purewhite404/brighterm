import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MAIN_ENTRY = resolve(__dirname, '../../out/main/index.cjs')

interface Session {
  app: ElectronApplication
  window: Page
  pageErrors: string[]
  failedResponses: string[]
  cleanup: () => Promise<void>
}

async function launch(): Promise<Session> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'brighterm-e2e-'))
  const app = await electron.launch({ args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`] })
  const window = await app.firstWindow()
  const pageErrors: string[] = []
  const failedResponses: string[] = []
  window.on('pageerror', (err) => pageErrors.push(err.message))
  window.on('response', (res) => {
    if (res.status() >= 400) failedResponses.push(`${res.status()} ${res.url()}`)
  })
  await expect(window.locator('.bt-dock')).toBeVisible({ timeout: 15_000 })
  return {
    app,
    window,
    pageErrors,
    failedResponses,
    cleanup: async () => {
      await app.close()
      rmSync(userDataDir, { recursive: true, force: true })
    }
  }
}

function dock(window: Page, title: string) {
  return window.locator(`.bt-dock__button[title="${title}"]`)
}

async function slotRects(window: Page) {
  return window.locator('.bt-tile-slot').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    })
  )
}

test('terminal shows a prompt, accepts input, and throws no errors (items 2, 4)', async () => {
  const s = await launch()
  try {
    await dock(s.window, 'Terminal').click()
    const rows = s.window.locator('.xterm-rows')
    await expect(rows).toContainText(/\S/, { timeout: 15_000 })
    await s.window.locator('.bt-terminal-tile').click()
    await s.window.keyboard.type('echo brighterm-ok-123')
    await s.window.keyboard.press('Enter')
    await expect(rows).toContainText('brighterm-ok-123', { timeout: 10_000 })
    // The command line and its output: the marker appears at least twice.
    await expect
      .poll(async () => ((await rows.innerText()).match(/brighterm-ok-123/g) ?? []).length, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(2)
    expect(s.pageErrors).toEqual([])
  } finally {
    await s.cleanup()
  }
})

test('tiles flow into a grid of roughly 16:9 cells instead of halving (item 1)', async () => {
  const s = await launch()
  try {
    for (const title of ['Terminal', 'Files', 'System Monitor', 'Calendar']) {
      await dock(s.window, title).click()
    }
    await expect(s.window.locator('.bt-tile-slot')).toHaveCount(4)
    const rects = await slotRects(s.window)
    expect(new Set(rects.map((r) => r.x)).size).toBe(2)
    expect(new Set(rects.map((r) => r.y)).size).toBe(2)
    const widths = rects.map((r) => r.w)
    expect(Math.min(...widths) / Math.max(...widths)).toBeGreaterThan(0.9)
    expect(s.pageErrors).toEqual([])
  } finally {
    await s.cleanup()
  }
})

test('the file tree keeps its expanded state when another tile is added (item 6)', async () => {
  const s = await launch()
  try {
    await dock(s.window, 'Files').click()
    const rows = s.window.locator('.bt-file-row')
    await expect(rows.first()).toBeVisible()
    await rows.first().click() // expand the home directory
    await expect.poll(() => rows.count()).toBeGreaterThan(1)
    const expandedCount = await rows.count()

    await dock(s.window, 'System Monitor').click()
    await expect(s.window.locator('.bt-tile-slot')).toHaveCount(2)
    expect(await rows.count()).toBe(expandedCount)
  } finally {
    await s.cleanup()
  }
})

test('dragging a tile header onto another tile moves it (item 1)', async () => {
  const s = await launch()
  try {
    await dock(s.window, 'Files').click()
    await dock(s.window, 'Calendar').click()
    await expect(s.window.locator('.bt-tile-slot')).toHaveCount(2)

    const filesSlot = s.window.locator('.bt-tile-slot', { has: s.window.locator('.bt-file-explorer') })
    const calendarSlot = s.window.locator('.bt-tile-slot', { has: s.window.locator('.bt-calendar') })
    const before = await filesSlot.boundingBox()
    const target = await calendarSlot.boundingBox()
    expect(before && target).toBeTruthy()

    // Drop Files in the centre of Calendar -> they swap places.
    await filesSlot.locator('.bt-tile__header').dragTo(calendarSlot, {
      targetPosition: { x: target!.width / 2, y: target!.height / 2 }
    })
    await expect.poll(async () => (await filesSlot.boundingBox())?.y).toBe(target!.y)
    expect(s.pageErrors).toEqual([])
  } finally {
    await s.cleanup()
  }
})

test('Notes: tokens.css loads and a picked folder lists its notes (items 3, 5)', async () => {
  const notesDir = mkdtempSync(join(tmpdir(), 'brighterm-notes-'))
  writeFileSync(join(notesDir, 'hello.md'), '# hello')
  const s = await launch()
  try {
    // Stand in for the native folder picker.
    await s.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog
    }, notesDir)

    await dock(s.window, 'Notes').click()
    const notes = s.window.frameLocator('iframe.bt-plugin-frame')
    await notes.locator('#pick-folder').click()
    await expect(notes.locator('.file-row', { hasText: 'hello' })).toBeVisible({ timeout: 10_000 })
    await notes.locator('.file-row', { hasText: 'hello' }).click()
    await expect(notes.locator('#content')).toHaveValue('# hello')

    expect(s.failedResponses.filter((r) => r.includes('tokens.css'))).toEqual([])
    expect(s.pageErrors).toEqual([])
  } finally {
    await s.cleanup()
    rmSync(notesDir, { recursive: true, force: true })
  }
})

test('AI Builder switches back from API mode to the default mode (item 8)', async () => {
  const s = await launch()
  try {
    await dock(s.window, 'AI Builder').click()
    await expect(s.window.locator('.bt-ai-builder__chat')).toBeVisible()
    await s.window.getByRole('button', { name: /API モード/ }).click()
    await expect(s.window.locator('.bt-ai-builder__chat')).toHaveCount(0)
    await s.window.getByRole('button', { name: /既定/ }).click()
    await expect(s.window.locator('.bt-ai-builder__chat')).toBeVisible()
  } finally {
    await s.cleanup()
  }
})

test('Settings shortcuts use distinct icons, and mail/search preferences are there (items 9, 10, 12)', async () => {
  const s = await launch()
  try {
    await dock(s.window, 'Settings').click()
    const shortcuts = s.window.locator('.bt-settings__shortcut')
    await expect(shortcuts.first()).toBeVisible()
    const paths = await shortcuts.evaluateAll((els) => els.map((el) => el.querySelector('path')?.getAttribute('d')))
    expect(new Set(paths).size).toBeGreaterThan(paths.length / 2)

    const mailSelect = s.window.locator('.bt-settings__field', { hasText: 'メール' }).locator('select')
    await expect(mailSelect).toHaveValue('gmail')
    await mailSelect.selectOption('outlook')
    await expect(mailSelect).toHaveValue('outlook')

    const searchSelect = s.window.locator('.bt-settings__field', { hasText: '検索エンジン' }).locator('select')
    await expect(searchSelect).toHaveValue('duckduckgo')
  } finally {
    await s.cleanup()
  }
})

test('Browser defaults to DuckDuckGo; Calendar shows this month with today marked (items 11, 12)', async () => {
  const s = await launch()
  try {
    await dock(s.window, 'Browser').click()
    await expect(s.window.locator('.bt-browser__address')).toHaveAttribute('placeholder', /DuckDuckGo/)

    await dock(s.window, 'Calendar').click()
    // This month — or the next one during this month's last week (its first row still has today).
    const now = new Date()
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const inLastWeek = now.getDate() >= last.getDate() - last.getDay()
    const shown = new Date(now.getFullYear(), now.getMonth() + (inLastWeek ? 1 : 0), 1)
    await expect(s.window.locator('.bt-calendar__title')).toHaveText(`${shown.getFullYear()}年 ${shown.getMonth() + 1}月`)
    await expect(s.window.locator('.bt-calendar__day.is-today')).toHaveCount(1)
    expect(s.pageErrors).toEqual([])
  } finally {
    await s.cleanup()
  }
})

test('System Monitor draws a CPU history chart and a system memory meter (item 7)', async () => {
  const s = await launch()
  try {
    await dock(s.window, 'System Monitor').click()
    await expect(s.window.locator('.bt-cpu-chart svg')).toBeVisible({ timeout: 10_000 })
    await expect(s.window.locator('.bt-cpu-chart__line')).toBeVisible({ timeout: 15_000 })
    await expect(s.window.locator('[aria-label="システムメモリ使用率"]')).toBeVisible()
  } finally {
    await s.cleanup()
  }
})
