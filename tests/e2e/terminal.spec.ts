import { test, expect } from '@playwright/test'
import { dock, launch } from './helpers'

test('Terminal shows a prompt, accepts input, and throws no errors', async () => {
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

test('Terminal starts PowerShell 7 on Windows', async () => {
  test.skip(process.platform !== 'win32', 'Windows only')
  const s = await launch()
  try {
    await dock(s.window, 'Terminal').click()
    const rows = s.window.locator('.xterm-rows')
    await expect(rows).toContainText(/PS .*>/, { timeout: 20_000 })
    await s.window.locator('.bt-terminal-tile').click()
    await s.window.keyboard.type('"ver=$($PSVersionTable.PSVersion.Major)"')
    await s.window.keyboard.press('Enter')
    await expect(rows).toContainText('ver=7', { timeout: 10_000 })
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

test('Terminal: the last row is fully inside the tile', async () => {
  const s = await launch()
  try {
    await dock(s.window, 'Terminal').click()
    await expect(s.window.locator('.xterm-rows')).toContainText(/\S/, { timeout: 15_000 })
    await s.window.waitForTimeout(500)
    const { screenBottom, tileBottom, rowHeight } = await s.window.evaluate(() => {
      const screen = document.querySelector('.xterm-screen')!.getBoundingClientRect()
      const tile = document.querySelector('.bt-terminal-tile')!.getBoundingClientRect()
      const rows = document.querySelector('.xterm-rows')!.children
      return { screenBottom: screen.bottom, tileBottom: tile.bottom, rowHeight: screen.height / rows.length }
    })
    expect(rowHeight).toBeGreaterThan(5)
    expect(screenBottom).toBeLessThanOrEqual(tileBottom)
  } finally {
    await s.cleanup()
  }
})
