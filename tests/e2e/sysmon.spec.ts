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

test('Minimized: no memory reports are sent; they come back with the window', async () => {
  const s = await launch()
  try {
    const countFor = (ms: number) =>
      s.window.evaluate(
        (duration) =>
          new Promise<number>((done) => {
            let n = 0
            const off = window.api.memory.onSnapshot(() => n++)
            setTimeout(() => {
              off()
              done(n)
            }, duration)
          }),
        ms
      )
    await s.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].minimize())
    await expect.poll(() => s.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].isMinimized())).toBe(true)
    expect(await countFor(1600)).toBe(0)
    await s.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].restore())
    expect(await countFor(1600)).toBeGreaterThanOrEqual(2)
  } finally {
    await s.cleanup()
  }
})

test('System Monitor stops polling while the window is hidden and catches up when shown', async () => {
  const s = await launch()
  try {
    // Count the tile's snapshot requests in main.
    await s.app.evaluate(({ ipcMain }) => {
      const g = globalThis as unknown as { __sysmonCalls: number }
      g.__sysmonCalls = 0
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> })._invokeHandlers
      const original = handlers.get('sysmon:snapshot')!
      handlers.set('sysmon:snapshot', (...a: unknown[]) => {
        g.__sysmonCalls++
        return original(...a)
      })
    })
    const calls = () => s.app.evaluate(() => (globalThis as unknown as { __sysmonCalls: number }).__sysmonCalls)
    await dock(s.window, 'System Monitor').click()
    await expect.poll(calls).toBeGreaterThan(1)

    // Playwright keeps every page "visible", so play the browser's part: hidden, then shown again.
    const setHidden = (hidden: boolean) =>
      s.window.evaluate((h) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => h })
        document.dispatchEvent(new Event('visibilitychange'))
      }, hidden)
    await setHidden(true)
    const atHide = await calls()
    await s.window.waitForTimeout(1600)
    expect(await calls()).toBeLessThanOrEqual(atHide + 1) // at most one already on its way
    await setHidden(false)
    await expect.poll(calls).toBeGreaterThan(atHide + 1)
    await expect(s.window.locator('.bt-cpu-chart__line')).toBeVisible()
  } finally {
    await s.cleanup()
  }
})

test('System Monitor lists processes when opened and on 更新 only — never polled', async () => {
  const s = await launch()
  try {
    // Count the requests that list processes (a PowerShell run each on Windows).
    await s.app.evaluate(({ ipcMain }) => {
      const g = globalThis as unknown as { __processCalls: number }
      g.__processCalls = 0
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> })._invokeHandlers
      const original = handlers.get('sysmon:snapshot')!
      handlers.set('sysmon:snapshot', (...a: unknown[]) => {
        if ((a[1] as { processes?: boolean } | undefined)?.processes) g.__processCalls++
        return original(...a)
      })
    })
    const processCalls = () => s.app.evaluate(() => (globalThis as unknown as { __processCalls: number }).__processCalls)

    await dock(s.window, 'System Monitor').click()
    const rows = s.window.locator('.bt-sysmon__list').last().locator('.bt-sysmon__row')
    await expect(rows.first()).toBeVisible({ timeout: 20_000 })
    await expect(s.window.locator('.bt-sysmon__as-of')).toHaveText(/\d{2}:\d{2}:\d{2} 時点/)
    await expect.poll(processCalls).toBe(1)

    // CPU keeps updating, the process list doesn't.
    await s.window.waitForTimeout(4000)
    expect(await processCalls()).toBe(1)

    const refresh = s.window.getByRole('button', { name: '更新' })
    await refresh.click()
    await expect.poll(processCalls).toBe(2)
    await expect(refresh).toBeEnabled({ timeout: 20_000 })
    await expect(rows.first()).toBeVisible()
    expect(s.pageErrors).toEqual([])
  } finally {
    await s.cleanup()
  }
})

/** A plugin that keeps one core busy for a few seconds when its button is pressed. */
const BURNER_BUNDLE = [
  '=== file: manifest.json ===',
  JSON.stringify({ id: 'cpu-burner', name: 'CPU Burner', version: '1.0.0', icon: 'activity', kind: 'app', entry: 'index.html', permissions: [] }),
  '=== file: index.html ===',
  '<!doctype html><html><body><button id="burn">burn</button><p id="state">idle</p><script src="main.js"></script></body></html>',
  '=== file: main.js ===',
  [
    "document.getElementById('burn').addEventListener('click', () => {",
    "  document.getElementById('state').textContent = 'burning'",
    '  setTimeout(() => {',
    '    const end = Date.now() + 4000',
    '    while (Date.now() < end) {}',
    "    document.getElementById('state').textContent = 'done'",
    '  }, 100)',
    '})'
  ].join('\n')
].join('\n')

test('Plugin tiles show their own memory, and CPU only while busy; System Monitor lists them by name', async () => {
  const s = await launch()
  try {
    const installed = await s.window.evaluate((text) => window.api.plugins.installFromBundle(text), BURNER_BUNDLE)
    expect(installed.ok).toBe(true)
    await dock(s.window, 'CPU Burner').click()
    await dock(s.window, 'System Monitor').click()

    const header = s.window.locator('.bt-tile', { has: s.window.locator('.bt-tile__title', { hasText: 'CPU Burner' }) }).locator('.bt-tile__header')
    // Its iframe's process is attributed to the tile (it used to fall into "メイン・GPU ほか").
    await expect(header.locator('.bt-tile__memory')).toHaveText(/\d+ MB/, { timeout: 10_000 })
    const sysmonRow = s.window.locator('.bt-sysmon__row', { hasText: 'CPU Burner' })
    await expect(sysmonRow.locator('.bt-sysmon__row-badge')).toHaveText(/\d+ MB/)
    await expect(s.window.locator('.bt-sysmon__row', { hasText: 'UI・内蔵タイル' })).not.toContainText('Notes')
    // Idle: no CPU figure.
    await s.window.waitForTimeout(2500)
    await expect(header.locator('.bt-tile__cpu')).toHaveCount(0)

    const plugin = s.window.frameLocator('iframe.bt-plugin-frame')
    await plugin.locator('#burn').click()
    // Busy: one core fully used reads ~100 % (the 2 s average climbs there).
    await expect(header.locator('.bt-tile__cpu')).toHaveText(/CPU \d+%/, { timeout: 5000 })
    const shownCpu = async () => Number(((await header.locator('.bt-tile__cpu').textContent({ timeout: 500 }).catch(() => '')) ?? '').match(/\d+/)?.[0] ?? 0)
    await expect.poll(shownCpu, { timeout: 4000 }).toBeGreaterThanOrEqual(70)
    console.log('busy plugin reads', await shownCpu(), '%')
    await expect(sysmonRow.locator('.bt-sysmon__row-cpu')).toBeVisible()
    // Calm again: it goes away.
    await expect(plugin.locator('#state')).toHaveText('done', { timeout: 10_000 })
    await expect(header.locator('.bt-tile__cpu')).toHaveCount(0, { timeout: 5000 })
    expect(s.pageErrors).toEqual([])
  } finally {
    await s.cleanup()
  }
})
