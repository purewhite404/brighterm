import os from 'node:os'
import si from 'systeminformation'

export interface ProcessInfo {
  pid: number
  name: string
  cpu: number
  memBytes: number
  command: string
}

export interface SystemSnapshot {
  cpuLoadPercent: number
  totalMemBytes: number
  usedMemBytes: number
  /** Omitted when the caller didn't ask for processes (listing them is far slower than CPU/memory). */
  topProcesses?: ProcessInfo[]
}

/** Total / used memory. On Windows si.mem() spawns PowerShell (for swap), too slow to poll every 0.5 s. */
async function memoryUsage(): Promise<{ total: number; used: number }> {
  if (process.platform === 'win32') {
    const total = os.totalmem()
    return { total, used: total - os.freemem() }
  }
  const mem = await si.mem()
  return { total: mem.total, used: mem.active }
}

/** Snapshot of overall system load (+ optionally the heaviest processes), for the SysMon tile. */
export async function getSystemSnapshot(opts: { processes?: boolean; topN?: number } = {}): Promise<SystemSnapshot> {
  const { processes = true, topN = 15 } = opts
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
