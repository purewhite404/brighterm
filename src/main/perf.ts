import { contentTracing, type IpcMain } from 'electron'
import { writeFileSync } from 'node:fs'
import { Session } from 'node:inspector'

/*
 * Startup measurements, all off unless BRIGHTERM_PERF=1 (tests/e2e/perf.spec.ts sets it).
 * Times are epoch ms (performance.timeOrigin + now), so they line up with the shell
 * page's performance marks; `processStart` is the main process's own time origin.
 */
const enabled = process.env.BRIGHTERM_PERF === '1'

export interface PerfTimeline {
  processStart: number
  marks: Array<{ name: string; at: number }>
}

const timeline: PerfTimeline = { processStart: performance.timeOrigin, marks: [] }
// Read by the perf spec through app.evaluate.
if (enabled) (globalThis as { __brightermPerf?: PerfTimeline }).__brightermPerf = timeline

export function perfMark(name: string): void {
  if (enabled) timeline.marks.push({ name, at: performance.timeOrigin + performance.now() })
}

/** Marks every IPC handler whose synchronous part blocks the main process for 5 ms or more. Call before registering. */
export function timeIpcHandlers(ipcMain: IpcMain): void {
  if (!enabled) return
  const handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, listener) =>
    handle(channel, (...args) => {
      const start = performance.now()
      try {
        return listener(...args)
      } finally {
        const ms = performance.now() - start
        if (ms >= 5) perfMark(`ipc-blocked:${channel}:${Math.round(ms)}ms`)
      }
    })
}

/** BRIGHTERM_PERF_PROFILE=<file>: a CPU profile of the main process's first `ms` (open in Chrome DevTools). */
export function profileStartup(ms = 1500): void {
  const file = process.env.BRIGHTERM_PERF_PROFILE
  if (!enabled || !file) return
  const session = new Session()
  session.connect()
  session.post('Profiler.enable', () =>
    session.post('Profiler.setSamplingInterval', { interval: 200 }, () =>
      session.post('Profiler.start', () => {
        setTimeout(() => {
          session.post('Profiler.stop', (err, result) => {
            if (!err) writeFileSync(file, JSON.stringify(result.profile))
            session.disconnect()
          })
        }, ms)
      })
    )
  )
}

/** BRIGHTERM_PERF_TRACE=<file>: a Chromium trace of every process for `ms` after app.ready (chrome://tracing, Perfetto). */
export function traceStartup(ms = 1200): void {
  const file = process.env.BRIGHTERM_PERF_TRACE
  if (!enabled || !file) return
  void contentTracing
    .startRecording({
      included_categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8', 'blink', 'loading', 'toplevel', 'navigation']
    })
    .then(() => setTimeout(() => void contentTracing.stopRecording(file), ms))
}

/** For tests (app.evaluate can't require): globalThis.__brightermProfiler.start() / .stop() → a CPU profile of main. */
if (enabled) {
  let session: Session | null = null
  const post = <T>(method: string, params: object = {}): Promise<T> =>
    new Promise((resolve, reject) => session!.post(method, params, (err, res) => (err ? reject(err) : resolve(res as T))))
  ;(globalThis as { __brightermProfiler?: unknown }).__brightermProfiler = {
    async start(): Promise<void> {
      session = new Session()
      session.connect()
      await post('Profiler.enable')
      await post('Profiler.setSamplingInterval', { interval: 200 })
      await post('Profiler.start')
    },
    async stop(): Promise<unknown> {
      const { profile } = await post<{ profile: unknown }>('Profiler.stop')
      session?.disconnect()
      session = null
      return profile
    }
  }
}
