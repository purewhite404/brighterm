/**
 * A terminal session's output on its way to the renderer.
 *
 * - The backlog (replayed to a view that attaches later) is kept as chunks and
 *   trimmed by whole chunks: re-slicing one 200 KB string per chunk copied
 *   gigabytes for a few MB of output (measured 2026-10-03: 30,000 lines cost the
 *   main process ~5.9 s of CPU).
 * - Chunks are sent in batches, `flushMs` after the first unsent one: a shell
 *   printing a long listing emitted ~18,000 tiny chunks, each its own IPC message.
 */
export class PtyOutput {
  private chunks: string[] = []
  private size = 0
  private pending: string[] = []
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly send: (data: string) => void,
    private readonly limit = 200_000,
    private readonly flushMs = 5
  ) {}

  get hasOutput(): boolean {
    return this.size > 0
  }

  push(data: string): void {
    if (!data) return
    this.chunks.push(data)
    this.size += data.length
    // Drop whole old chunks while what's left still covers the limit.
    while (this.chunks.length > 1 && this.size - this.chunks[0].length >= this.limit) {
      this.size -= this.chunks.shift()!.length
    }
    this.pending.push(data)
    this.timer ??= setTimeout(() => this.flush(), this.flushMs)
  }

  /** Sends what's waiting now — before a view attaches (it gets the backlog instead) or the shell exits. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.pending.length === 0) return
    const data = this.pending.join('')
    this.pending = []
    this.send(data)
  }

  /** The most recent `limit` characters (everything sent so far — call flush() first). */
  backlog(): string {
    if (this.chunks.length > 1) this.chunks = [this.chunks.join('')]
    const all = this.chunks[0] ?? ''
    return all.length > this.limit ? all.slice(-this.limit) : all
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending = []
  }
}
