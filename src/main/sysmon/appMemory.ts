/**
 * Splits the app's total memory (every Electron process) into what the
 * System Monitor lists: one row per web tile, the shell UI process (which
 * also runs Terminal, Files, Calendar, Notes and the other built-in tiles),
 * and everything else (main, GPU, utility processes).
 */

export const SHELL_ROW_ID = '__shell'
export const CORE_ROW_ID = '__core'

export interface ProcessMemory {
  pid: number
  bytes: number
}

export interface AppMemoryBreakdown {
  totalAppBytes: number
  rows: { id: string; memoryBytes: number }[]
}

/**
 * @param viewPids tile/view id -> OS pid of its renderer, or null if it has none (suspended).
 */
export function summarizeAppMemory(
  processes: ProcessMemory[],
  viewPids: Map<string, number | null>,
  shellPid: number | null
): AppMemoryBreakdown {
  const byPid = new Map(processes.map((p) => [p.pid, p.bytes]))
  const claimed = new Set<number>()
  const rows: AppMemoryBreakdown['rows'] = []

  for (const [id, pid] of viewPids) {
    rows.push({ id, memoryBytes: pid === null ? 0 : byPid.get(pid) ?? 0 })
    if (pid !== null) claimed.add(pid)
  }
  if (shellPid !== null && byPid.has(shellPid)) {
    rows.push({ id: SHELL_ROW_ID, memoryBytes: byPid.get(shellPid)! })
    claimed.add(shellPid)
  }
  const other = processes.filter((p) => !claimed.has(p.pid)).reduce((sum, p) => sum + p.bytes, 0)
  if (other > 0) rows.push({ id: CORE_ROW_ID, memoryBytes: other })

  return { totalAppBytes: processes.reduce((sum, p) => sum + p.bytes, 0), rows }
}
