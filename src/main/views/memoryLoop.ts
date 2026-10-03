import { app } from 'electron'
import { availableParallelism } from 'node:os'
import { IPC } from '@shared/ipc'
import type { SystemMemorySnapshot } from '@shared/types'
import { summarizeAppMemory } from '../sysmon/appMemory'
import { CpuBadges } from '../sysmon/cpuBadges'
import type { Send } from '../window'
import type { ViewManager } from './viewManager'

/** Also the System Monitor's refresh rate for app memory. getAppMetrics() is cheap (~0.1 ms, measured). */
const MEMORY_TICK_MS = 500

/**
 * Every 0.5 s: suspends web views idle for longer than the configured time,
 * then — unless the window is minimized — reports the app's memory (and CPU,
 * while busy) per tile: tile headers, status bar, System Monitor.
 */
export function startMemoryLoop(deps: {
  viewManager: ViewManager
  suspendAfterMs: () => number
  shellProcessId: () => number | null
  /** tileId -> pid of each plugin tile's iframe. */
  pluginFramePids: () => Map<string, number>
  /** False while the window is minimized / hidden: nobody sees the numbers then. */
  windowShown: () => boolean
  send: Send
}): void {
  let inFlight = false
  const cpuBadges = new CpuBadges()
  setInterval(async () => {
    // Suspending captures a snapshot first; don't start another tick meanwhile.
    if (inFlight) return
    inFlight = true
    try {
      await memoryTick(deps, cpuBadges)
    } finally {
      inFlight = false
    }
  }, MEMORY_TICK_MS)
}

async function memoryTick(
  { viewManager, suspendAfterMs, shellProcessId, pluginFramePids, windowShown, send }: Parameters<typeof startMemoryLoop>[0],
  cpuBadges: CpuBadges
): Promise<void> {
  const suspendCandidates = viewManager.getSuspendCandidates(suspendAfterMs())
  for (const tileId of suspendCandidates) {
    await viewManager.suspend(tileId)
  }
  // The headers, status bar and System Monitor are refreshed with the next tick once it's back.
  if (!windowShown()) return

  const viewPids: Map<string, number | null> = viewManager.getViewPids()
  for (const [tileId, pid] of pluginFramePids()) viewPids.set(tileId, pid)

  // percentCPUUsage is a share of the whole machine (100 = every core busy; one busy core read
  // ~3 % on a 32-thread PC): scale it to "100 = one core", which tells a busy tile apart.
  const cores = availableParallelism()
  const { totalAppBytes, rows } = summarizeAppMemory(
    app.getAppMetrics().map((m) => ({ pid: m.pid, bytes: m.memory.workingSetSize * 1024, cpuPercent: m.cpu.percentCPUUsage * cores })),
    viewPids,
    shellProcessId()
  )
  const cpu = cpuBadges.update(rows)
  const snapshot: SystemMemorySnapshot = {
    totalAppBytes,
    tiles: rows.map(({ id: tileId, memoryBytes }) => ({
      tileId,
      memoryBytes,
      cpuPercent: cpu.get(tileId) ?? null,
      suspended: viewManager.isSuspended(tileId),
      lastActiveAt: Date.now()
    }))
  }
  send(IPC.memorySnapshot, snapshot)
}
