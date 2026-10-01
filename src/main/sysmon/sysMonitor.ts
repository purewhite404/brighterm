import os from 'node:os'
import type { SystemSnapshot } from '@shared/apiTypes'

/** Loaded when a System Monitor first asks (~5 MB in the main process). */
let systeminformation: Promise<typeof import('systeminformation')> | null = null
function loadSi(): Promise<typeof import('systeminformation')> {
  systeminformation ??= import('systeminformation').then((m) => (m as { default?: typeof import('systeminformation') }).default ?? m)
  return systeminformation
}

/** Total / used memory. On Windows si.mem() spawns PowerShell (for swap), too slow to poll every 0.5 s. */
async function memoryUsage(): Promise<{ total: number; used: number }> {
  if (process.platform === 'win32') {
    const total = os.totalmem()
    return { total, used: total - os.freemem() }
  }
  const mem = await (await loadSi()).mem()
  return { total: mem.total, used: mem.active }
}

/** Snapshot of overall system load (+ optionally the heaviest processes), for the SysMon tile. */
export async function getSystemSnapshot(opts: { processes?: boolean; topN?: number } = {}): Promise<SystemSnapshot> {
  const { processes = true, topN = 15 } = opts
  const si = await loadSi()
  const [load, mem, procs] = await Promise.all([
    si.currentLoad(),
    memoryUsage(),
    processes ? si.processes() : Promise.resolve(null)
  ])

  const topProcesses = procs?.list
    .slice()
    .sort((a, b) => b.mem - a.mem)
    .slice(0, topN)
    .map((p) => ({
      pid: p.pid,
      name: p.name,
      cpu: p.cpu,
      memBytes: mem.total * (p.mem / 100),
      command: p.command
    }))

  return {
    cpuLoadPercent: load.currentLoad,
    totalMemBytes: mem.total,
    usedMemBytes: mem.used,
    topProcesses
  }
}
