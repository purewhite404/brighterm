import { app } from 'electron'
import { IPC } from '@shared/ipc'
import type { SystemMemorySnapshot } from '@shared/types'
import { summarizeAppMemory } from '../sysmon/appMemory'
import type { Send } from '../window'
import type { ViewManager } from './viewManager'

/** Also the System Monitor's refresh rate for app memory. getAppMetrics() is cheap. */
const MEMORY_TICK_MS = 500

/**
 * Every 0.5 s: suspends web views idle for longer than the configured time,
 * then reports the app's memory per tile (tile headers, status bar, System Monitor).
 */
export function startMemoryLoop(deps: {
  viewManager: ViewManager
  suspendAfterMs: () => number
  shellProcessId: () => number | null
  send: Send
}): void {
  let inFlight = false
  setInterval(async () => {
    // Suspending captures a snapshot first; don't start another tick meanwhile.
    if (inFlight) return
    inFlight = true
    try {
      await memoryTick(deps)
    } finally {
      inFlight = false
    }
  }, MEMORY_TICK_MS)
}

async function memoryTick({
  viewManager,
  suspendAfterMs,
  shellProcessId,
  send
}: Parameters<typeof startMemoryLoop>[0]): Promise<void> {
  const suspendCandidates = viewManager.getSuspendCandidates(suspendAfterMs())
  for (const tileId of suspendCandidates) {
    await viewManager.suspend(tileId)
  }

  const { totalAppBytes, rows } = summarizeAppMemory(
    app.getAppMetrics().map((m) => ({ pid: m.pid, bytes: m.memory.workingSetSize * 1024 })),
    viewManager.getViewPids(),
    shellProcessId()
  )
  const snapshot: SystemMemorySnapshot = {
    totalAppBytes,
    tiles: rows.map(({ id: tileId, memoryBytes }) => ({
      tileId,
      memoryBytes,
      suspended: viewManager.isSuspended(tileId),
      lastActiveAt: Date.now()
    }))
  }
  send(IPC.memorySnapshot, snapshot)
}
