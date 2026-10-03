import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import electronPath from 'electron'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { MAIN_ENTRY, launch, launchIn, removeDir, tempDir } from './helpers'

test('opens the window, shows the dock, and can add a Terminal tile', async () => {
  const s = await launch()
  try {
    await expect(s.window).toHaveTitle('Brighterm')

    // Before adding anything, the tiling area shows its empty-state hint.
    await expect(s.window.locator('.bt-tiling-empty')).toBeVisible()

    // Clicking the Terminal dock button should add a tile to the (until now empty) workspace.
    await s.window.locator('.bt-dock__button[title="Terminal"]').click()
    await expect(s.window.locator('.bt-tile').first()).toBeVisible({ timeout: 15_000 })
    await expect(s.window.locator('.bt-tiling-empty')).toHaveCount(0)

    // Notes (a bundled plugin) should also be launchable from the dock.
    await expect(s.window.locator('.bt-dock__button[title="Notes"]')).toBeVisible()
  } finally {
    await s.cleanup()
  }
})

test('under test the window opens off screen, without the focus, and still paints', async () => {
  const s = await launch()
  try {
    await expect(s.window.locator('.bt-dock')).toBeVisible()
    const state = await s.app.evaluate(({ BaseWindow, screen }) => {
      const [win] = BaseWindow.getAllWindows()
      const b = win.getBounds()
      const overlapsADisplay = screen
        .getAllDisplays()
        .some(({ bounds: d }) => b.x < d.x + d.width && d.x < b.x + b.width && b.y < d.y + d.height && d.y < b.y + b.height)
      return { visible: win.isVisible(), focused: win.isFocused(), overlapsADisplay }
    })
    expect(state).toEqual({ visible: true, focused: false, overlapsADisplay: false })
    // Off screen must not mean occluded (index.ts turns that check off): the shell still paints.
    const shot = await s.app.evaluate(async ({ BaseWindow }) => {
      const shell = BaseWindow.getAllWindows()[0].contentView.children[0] as Electron.WebContentsView
      return shell.webContents.capturePage().then((image) => image.isEmpty())
    })
    expect(shot).toBe(false)
  } finally {
    await s.cleanup()
  }
})

test('a second launch exits without touching the running instance’s data', async () => {
  const userDataDir = tempDir()
  const s = await launchIn(userDataDir)
  try {
    // Everything the first instance wrote at startup: config.json and the bundled plugins.
    const mtimes = (): string =>
      JSON.stringify(
        (readdirSync(userDataDir, { recursive: true }) as string[])
          .filter((f) => f === 'config.json' || f.startsWith('plugins'))
          .map((f) => [f, statSync(join(userDataDir, f)).mtimeMs])
      )
    const before = mtimes()

    // Not app.process().spawnfile: Playwright launches Electron through cmd.exe on Windows.
    const second = spawn(electronPath as unknown as string, [MAIN_ENTRY, `--user-data-dir=${userDataDir}`], { stdio: 'ignore' })
    const exitCode = await new Promise<number | null>((done, fail) => {
      const timer = setTimeout(() => {
        second.kill()
        fail(new Error('the second instance kept running'))
      }, 10_000)
      second.on('exit', (code) => {
        clearTimeout(timer)
        done(code)
      })
    })

    expect(exitCode).toBe(0)
    expect(mtimes()).toBe(before)
    await expect(s.window.locator('.bt-dock')).toBeVisible()
  } finally {
    await s.app.close()
    removeDir(userDataDir)
  }
})
