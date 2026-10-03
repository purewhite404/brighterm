import { test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchIn, removeDir, seedWorkspace, startSite, tempDir } from './helpers'

/*
 * Measurements, not assertions — skipped unless BRIGHTERM_PERF_SPEC=1:
 * startup timeline (src/main/perf.ts marks + the shell's performance marks),
 * splitter drag cost (CPU, IPC count), idle CPU. Results: %TEMP%\brighterm-perf\<PERF_LABEL>.json.
 *   cmd.exe /c "set BRIGHTERM_PERF_SPEC=1&& set PERF_LABEL=after&& npx playwright test tests/e2e/perf.spec.ts --reporter=line"
 * Optional: BRIGHTERM_PERF_PROFILE=<file> (main-process CPU profile), BRIGHTERM_PERF_TRACE=<file>
 * (Chromium trace) — see perf.ts.
 */
test.skip(process.env.BRIGHTERM_PERF_SPEC !== '1', 'measurement only: set BRIGHTERM_PERF_SPEC=1')

// Only for the apps these tests launch (all spec files share one worker process).
test.beforeAll(() => {
  process.env.BRIGHTERM_PERF = '1'
})
test.afterAll(() => {
  delete process.env.BRIGHTERM_PERF
})

const RUNS = Number(process.env.PERF_RUNS ?? 3)
const LABEL = process.env.PERF_LABEL ?? 'run'
const OUT = 'C:\\Users\\satoshi\\AppData\\Local\\Temp\\brighterm-perf'

const leaf = (tileId: string) => ({ type: 'leaf', tileId })
const split = (direction: 'row' | 'column', a: object, b: object, ratio = 0.5) => ({ type: 'split', direction, ratio, a, b })

function seed(dir: string, root: string, siteUrl: string): void {
  seedWorkspace(
    dir,
    {
      term: { id: 'term', kind: 'builtin', typeId: 'terminal', title: 'Terminal', icon: 'terminal', config: {} },
      files: { id: 'files', kind: 'builtin', typeId: 'file-explorer', title: 'Files', icon: 'folder', config: { rootPath: root, expandedPaths: [root] } },
      sysmon: { id: 'sysmon', kind: 'builtin', typeId: 'sysmon', title: 'System Monitor', icon: 'activity', config: {} },
      notes: { id: 'notes', kind: 'plugin', typeId: 'notes', title: 'Notes', icon: 'file', config: { pluginKind: 'app', pluginId: 'notes' } },
      browser: { id: 'browser', kind: 'builtin', typeId: 'browser', title: 'Browser', icon: 'globe', config: { url: siteUrl } },
      calendar: { id: 'calendar', kind: 'builtin', typeId: 'calendar', title: 'Calendar', icon: 'calendar', config: {} }
    },
    split(
      'column',
      split('row', leaf('term'), split('row', leaf('files'), leaf('browser'))),
      split('row', leaf('sysmon'), split('row', leaf('notes'), leaf('calendar')))
    )
  )
}

type Marks = Record<string, number>

async function timeline(app: ElectronApplication, window: Page): Promise<Marks> {
  const main = await app.evaluate(() => (globalThis as unknown as { __brightermPerf: { processStart: number; marks: { name: string; at: number }[] } }).__brightermPerf)
  const shell = await window.evaluate(() => {
    const at = (t: number) => performance.timeOrigin + t
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
    const script = performance.getEntriesByType('resource').find((r) => r.name.endsWith('.js')) as PerformanceResourceTiming | undefined
    return [
      { name: 'nav:timeOrigin', at: performance.timeOrigin },
      { name: 'nav:responseEnd', at: at(nav.responseEnd) },
      { name: 'nav:domInteractive', at: at(nav.domInteractive) },
      { name: 'nav:domContentLoadedEnd', at: at(nav.domContentLoadedEventEnd) },
      ...(script ? [{ name: 'nav:scriptLoaded', at: at(script.responseEnd) }] : []),
      ...performance.getEntriesByType('mark').map((m) => ({ name: m.name, at: at(m.startTime) }))
    ]
  })
  const out: Marks = {}
  for (const m of [...main.marks, ...shell]) out[m.name] ??= Math.round(m.at - main.processStart)
  return out
}

const results: Record<string, unknown> = {}

test.afterAll(() => {
  if (Object.keys(results).length === 0) return
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
})

test('startup timeline', async () => {
  test.setTimeout(180_000)
  const { origin, server } = await startSite()
  const runs: Marks[] = []
  try {
    // Run 0 is a cold-ish first install (plugins get installed); the rest relaunch the same profile.
    const dir = tempDir()
    const root = tempDir('brighterm-perf-root-')
    try {
      seed(dir, root, `${origin}/a`)
      for (let i = 0; i <= RUNS; i++) {
        const t0 = Date.now()
        const s = await launchIn(dir)
        const dockVisible = Date.now() - t0
        await s.window.waitForFunction(
          () => ['terminal-prompt:term', 'plugin-loaded:notes'].every((n) => performance.getEntriesByName(n).length > 0),
          undefined,
          { timeout: 30_000 }
        )
        await s.window.waitForTimeout(1500) // let the web view finish too
        const marks = await timeline(s.app, s.window)
        runs.push({ testSeesDock: dockVisible, ...marks })
        await s.app.close()
      }
    } finally {
      removeDir(dir)
      removeDir(root)
    }
  } finally {
    server.close()
  }
  results.startup = runs
})

test('splitter drag and idle cost', async () => {
  test.setTimeout(120_000)
  const { origin, server } = await startSite()
  const dir = tempDir()
  const root = tempDir('brighterm-perf-root-')
  try {
    seed(dir, root, `${origin}/a`)
    const s = await launchIn(dir)
    try {
      await s.window.waitForFunction(() => performance.getEntriesByName('terminal-prompt:term').length > 0, undefined, { timeout: 30_000 })
      await s.window.waitForTimeout(2000)

      // Idle: CPU of the shell renderer and the main process over 5 s.
      const cpu = async () =>
        s.app.evaluate(({ app }) => app.getAppMetrics().map((m) => ({ type: m.type, cpu: m.cpu.percentCPUUsage })))
      await cpu()
      await s.window.waitForTimeout(5000)
      results.idleCpu = await cpu()

      // Drag the top-left vertical splitter (Terminal | Files) back and forth.
      const splitter = s.window.locator('.bt-splitter--row').first()
      const box = (await splitter.boundingBox())!
      const y = box.y + box.height / 2

      // Count IPC calls (invoke handlers + sends) and CPU time per process during the drag.
      await s.app.evaluate(({ ipcMain }) => {
        const g = globalThis as unknown as { __ipc: Record<string, number> }
        g.__ipc = {}
        const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> })._invokeHandlers
        for (const [channel, fn] of handlers) {
          handlers.set(channel, (...a: unknown[]) => {
            g.__ipc[channel] = (g.__ipc[channel] ?? 0) + 1
            return fn(...a)
          })
        }
        ipcMain.on('pty:resize', () => void (g.__ipc['pty:resize(send)'] = (g.__ipc['pty:resize(send)'] ?? 0) + 1))
      })
      const cpuTotals = async () =>
        s.app.evaluate(({ app }) => {
          const byType: Record<string, number> = { main: process.cpuUsage().user / 1e6 + process.cpuUsage().system / 1e6 }
          for (const m of app.getAppMetrics()) {
            if (m.type === 'Browser') continue
            byType[m.type] = (byType[m.type] ?? 0) + (m.cpu.cumulativeCPUUsage ?? 0)
          }
          return byType
        })
      const cdp = await s.window.context().newCDPSession(s.window)
      await cdp.send('Performance.enable')
      const metric = async () => {
        const { metrics } = await cdp.send('Performance.getMetrics')
        const get = (n: string) => metrics.find((m) => m.name === n)?.value ?? 0
        return { script: get('ScriptDuration'), layout: get('LayoutDuration'), task: get('TaskDuration'), recalc: get('RecalcStyleDuration') }
      }
      const cpu0 = await cpuTotals()
      const m0 = await metric()
      await s.window.evaluate(() => {
        const w = window as unknown as { __frames: number[]; __stop: boolean }
        w.__frames = []
        w.__stop = false
        const tick = (t: number) => {
          w.__frames.push(t)
          if (!w.__stop) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      const t0 = Date.now()
      await s.window.mouse.move(box.x + 3, y)
      await s.window.mouse.down()
      for (let round = 0; round < 3; round++) {
        await s.window.mouse.move(box.x + 250, y, { steps: 60 })
        await s.window.mouse.move(box.x - 250, y, { steps: 60 })
      }
      await s.window.mouse.up()
      const dragMs = Date.now() - t0
      await s.window.waitForTimeout(500)
      const m1 = await metric()
      const cpu1 = await cpuTotals()
      const ms = (v: number) => Math.round(v * 1000)
      results.dragShellMs = { script: ms(m1.script - m0.script), layout: ms(m1.layout - m0.layout), recalc: ms(m1.recalc - m0.recalc), task: ms(m1.task - m0.task) }
      results.dragCpuMs = Object.fromEntries(Object.keys(cpu1).map((k) => [k, ms(cpu1[k] - (cpu0[k] ?? 0))]))
      results.dragIpc = await s.app.evaluate(() => (globalThis as unknown as { __ipc: Record<string, number> }).__ipc)
      const frames = await s.window.evaluate(() => {
        const w = window as unknown as { __frames: number[]; __stop: boolean }
        w.__stop = true
        return w.__frames
      })
      const gaps = frames.slice(1).map((t, i) => t - frames[i])
      gaps.sort((a, b) => a - b)
      results.drag = {
        dragMs,
        frames: gaps.length,
        p50: Math.round(gaps[Math.floor(gaps.length * 0.5)]),
        p95: Math.round(gaps[Math.floor(gaps.length * 0.95)]),
        max: Math.round(gaps[gaps.length - 1]),
        over50ms: gaps.filter((g) => g > 50).length
      }
    } finally {
      await s.app.close()
    }
  } finally {
    removeDir(dir)
    removeDir(root)
    server.close()
  }
})
