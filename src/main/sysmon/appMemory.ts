/**
 * Splits the app's total memory and CPU (every Electron process) into what the
 * System Monitor and the tile headers show: one row per web view and per plugin
 * tile (its iframe has a process of its own), the shell UI process (which runs
 * Terminal, Files, Calendar and the other built-in tiles — they can't be told
 * apart inside it), and everything else (main, GPU, utility processes).
 */

export const SHELL_ROW_ID = '__shell'
export const CORE_ROW_ID = '__core'

export interface ProcessUsage {
  pid: number
  bytes: number
  /** Since the previous sample; 100 = one core fully busy (Electron's percentCPUUsage × cores). */
  cpuPercent: number
}

export interface AppUsageRow {
  id: string
  memoryBytes: number
  cpuPercent: number
}

export interface AppMemoryBreakdown {
  totalAppBytes: number
  rows: AppUsageRow[]
}

/**
 * @param viewPids tile/view id -> OS pid of its renderer (web views and plugin
 *   iframes), or null if it has none (a suspended web view).
 */
export function summarizeAppMemory(
  processes: ProcessUsage[],
  viewPids: Map<string, number | null>,
  shellPid: number | null
): AppMemoryBreakdown {
  const byPid = new Map(processes.map((p) => [p.pid, p]))
  const claimed = new Set<number>()
  const rows: AppUsageRow[] = []

  for (const [id, pid] of viewPids) {
    // A frame that ended up in the shell's own process isn't a process of its own: it stays in the shell row.
    const process = pid === null || pid === shellPid ? undefined : byPid.get(pid)
    rows.push({ id, memoryBytes: process?.bytes ?? 0, cpuPercent: process?.cpuPercent ?? 0 })
    if (process) claimed.add(process.pid)
  }
  const shell = shellPid === null ? undefined : byPid.get(shellPid)
  if (shell) {
    rows.push({ id: SHELL_ROW_ID, memoryBytes: shell.bytes, cpuPercent: shell.cpuPercent })
    claimed.add(shell.pid)
  }
  const others = processes.filter((p) => !claimed.has(p.pid))
  const otherBytes = others.reduce((sum, p) => sum + p.bytes, 0)
  if (otherBytes > 0) {
    rows.push({ id: CORE_ROW_ID, memoryBytes: otherBytes, cpuPercent: others.reduce((sum, p) => sum + p.cpuPercent, 0) })
  }

  return { totalAppBytes: processes.reduce((sum, p) => sum + p.bytes, 0), rows }
}
