import { test, expect } from '@playwright/test'
import { dock, launch } from './helpers'

test('System Monitor draws a CPU history chart and a system memory meter', async () => {
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

test('System Monitor: 0.5 s updates over a 60 s axis; app memory is counted without web tiles', async () => {
  const s = await launch()
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
    await s.cleanup()
  }
})

test('App memory is reported every 0.5 s', async () => {
  const s = await launch()
  try {
    const count = await s.window.evaluate(
      () =>
        new Promise<number>((done) => {
          let n = 0
          const off = window.api.memory.onSnapshot(() => n++)
          setTimeout(() => {
            off()
            done(n)
          }, 2600)
        })
    )
    expect(count).toBeGreaterThanOrEqual(4)
    await expect(s.window.locator('.bt-statusbar')).not.toContainText('/ 1.50 GB')
  } finally {
    await s.cleanup()
  }
})
