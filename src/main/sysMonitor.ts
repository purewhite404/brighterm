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
  topProcesses: ProcessInfo[]
}

/** Snapshot of overall system load + the heaviest processes, for the SysMon tile. */
export async function getSystemSnapshot(topN = 15): Promise<SystemSnapshot> {
  const [load, mem, processes] = await Promise.all([si.currentLoad(), si.mem(), si.processes()])

  const topProcesses: ProcessInfo[] = processes.list
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
    usedMemBytes: mem.active,
    topProcesses
  }
}
