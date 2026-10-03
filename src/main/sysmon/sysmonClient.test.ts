import { describe, expect, it } from 'vitest'
import { SysmonClient, type SysmonRequest, type SysmonResponse, type WorkerLike } from './sysmonClient'
import type { SystemSnapshot } from '@shared/apiTypes'

const snap = (cpu: number): SystemSnapshot => ({ cpuLoadPercent: cpu, totalMemBytes: 1, usedMemBytes: 1, topProcesses: undefined })

class FakeWorker implements WorkerLike {
  sent: SysmonRequest[] = []
  terminated = false
  private listeners: Record<string, Array<(arg: never) => void>> = {}
  postMessage(message: SysmonRequest): void {
    this.sent.push(message)
  }
  on(event: string, listener: (arg: never) => void): void {
    ;(this.listeners[event] ??= []).push(listener)
  }
  terminate(): void {
    this.terminated = true
  }
  emit(event: 'message', arg: SysmonResponse): void
  emit(event: 'error', arg: Error): void
  emit(event: 'exit', arg: number): void
  emit(event: string, arg: unknown): void {
    for (const l of this.listeners[event] ?? []) l(arg as never)
  }
}

function setup() {
  const workers: FakeWorker[] = []
  const client = new SysmonClient(() => {
    const w = new FakeWorker()
    workers.push(w)
    return w
  })
  return { client, workers }
}

describe('SysmonClient', () => {
  it('starts the worker only on the first request', () => {
    const { client, workers } = setup()
    expect(workers).toHaveLength(0)
    void client.snapshot()
    void client.snapshot({ processes: false })
    expect(workers).toHaveLength(1)
    expect(workers[0].sent).toEqual([{ id: 1, opts: undefined }, { id: 2, opts: { processes: false } }])
  })

  it('matches answers to requests by id, in any order', async () => {
    const { client, workers } = setup()
    const a = client.snapshot()
    const b = client.snapshot()
    workers[0].emit('message', { id: 2, ok: true, snapshot: snap(20) })
    workers[0].emit('message', { id: 1, ok: true, snapshot: snap(10) })
    expect((await a).cpuLoadPercent).toBe(10)
    expect((await b).cpuLoadPercent).toBe(20)
  })

  it('passes a failed snapshot on as an error', async () => {
    const { client, workers } = setup()
    const a = client.snapshot()
    workers[0].emit('message', { id: 1, ok: false, error: 'boom' })
    await expect(a).rejects.toThrow('boom')
  })

  it('a dead worker fails what was pending, and the next request starts a new one', async () => {
    const { client, workers } = setup()
    const a = client.snapshot()
    workers[0].emit('exit', 1)
    await expect(a).rejects.toThrow(/再起動/)
    const b = client.snapshot()
    expect(workers).toHaveLength(2)
    workers[1].emit('message', { id: 2, ok: true, snapshot: snap(5) })
    expect((await b).cpuLoadPercent).toBe(5)
    // The old worker's late events don't touch the new one.
    workers[0].emit('error', new Error('late'))
    const c = client.snapshot()
    expect(workers).toHaveLength(2)
    workers[1].emit('message', { id: 3, ok: true, snapshot: snap(7) })
    expect((await c).cpuLoadPercent).toBe(7)
  })

  it('dispose terminates the worker and rejects pending requests', async () => {
    const { client, workers } = setup()
    const a = client.snapshot()
    client.dispose()
    expect(workers[0].terminated).toBe(true)
    await expect(a).rejects.toThrow()
  })
})
