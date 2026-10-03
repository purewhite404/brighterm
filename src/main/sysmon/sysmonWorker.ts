import { parentPort } from 'node:worker_threads'
import { getSystemSnapshot } from './sysMonitor'
import type { SysmonRequest, SysmonResponse } from './sysmonClient'

/** Worker thread: answers the main process's snapshot requests (see sysmonClient.ts). */
parentPort?.on('message', async ({ id, opts }: SysmonRequest) => {
  let response: SysmonResponse
  try {
    response = { id, ok: true, snapshot: await getSystemSnapshot(opts) }
  } catch (err) {
    response = { id, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  parentPort?.postMessage(response)
})
