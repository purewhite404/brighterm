import type { SystemSnapshot } from '@shared/apiTypes'

export interface SysmonRequest {
  id: number
  opts?: { processes?: boolean; topN?: number }
}

export type SysmonResponse = { id: number; ok: true; snapshot: SystemSnapshot } | { id: number; ok: false; error: string }

/** The part of a worker_threads Worker the client uses (a fake in tests). */
export interface WorkerLike {
  postMessage(message: SysmonRequest): void
  on(event: 'message', listener: (response: SysmonResponse) => void): void
  on(event: 'error', listener: (err: Error) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  terminate(): unknown
}

/**
 * System Monitor snapshots come from a worker thread, so systeminformation (its
 * load, its `chcp` execSync, parsing the process list) never blocks the main
 * process — that's where terminals, IPC and web view bounds are handled.
 * The worker starts on the first request; if it dies, the next request starts a new one.
 */
export class SysmonClient {
  private worker: WorkerLike | null = null
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (s: SystemSnapshot) => void; reject: (err: Error) => void }>()

  constructor(private readonly createWorker: () => WorkerLike) {}

  snapshot(opts?: SysmonRequest['opts']): Promise<SystemSnapshot> {
    const worker = this.ensureWorker()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage({ id, opts })
    })
  }

  dispose(): void {
    const worker = this.worker
    this.worker = null
    void worker?.terminate()
    this.failAll(new Error('System Monitor を終了しました'))
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker
    const worker = this.createWorker()
    worker.on('message', (response) => {
      const entry = this.pending.get(response.id)
      if (!entry) return
      this.pending.delete(response.id)
      if (response.ok) entry.resolve(response.snapshot)
      else entry.reject(new Error(response.error))
    })
    const lost = (reason: string): void => {
      if (this.worker !== worker) return
      this.worker = null
      this.failAll(new Error(`System Monitor の取得処理が停止しました (${reason})。次の更新で再起動します。`))
    }
    worker.on('error', (err) => lost(err.message))
    worker.on('exit', (code) => lost(`exit ${code}`))
    this.worker = worker
    return worker
  }

  private failAll(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err)
    this.pending.clear()
  }
}
