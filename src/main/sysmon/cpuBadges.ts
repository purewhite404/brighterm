/**
 * Which rows (tiles, the UI process…) get a CPU figure next to their memory, and
 * what it says. Only a busy row shows one, so headers stay quiet normally:
 * averaged over the last few samples (one 0.5 s spike doesn't count), it appears at
 * SHOW_AT % and goes away below HIDE_BELOW % (two thresholds, so a value hovering
 * around one of them doesn't make it blink). 100 % = one core fully busy.
 */
export const SHOW_AT = 5
export const HIDE_BELOW = 3
const WINDOW = 4 // samples: 2 s at the memory loop's 0.5 s

export class CpuBadges {
  private readonly history = new Map<string, number[]>()
  private readonly shown = new Set<string>()

  /** Feeds one sample per row; returns the figure to show (rounded), or null for none. */
  update(rows: Array<{ id: string; cpuPercent: number }>): Map<string, number | null> {
    const result = new Map<string, number | null>()
    const seen = new Set<string>()
    for (const { id, cpuPercent } of rows) {
      seen.add(id)
      const samples = this.history.get(id) ?? []
      samples.push(Number.isFinite(cpuPercent) ? Math.max(0, cpuPercent) : 0)
      if (samples.length > WINDOW) samples.shift()
      this.history.set(id, samples)
      const average = samples.reduce((sum, v) => sum + v, 0) / samples.length
      if (average >= SHOW_AT) this.shown.add(id)
      else if (average < HIDE_BELOW) this.shown.delete(id)
      result.set(id, this.shown.has(id) ? Math.round(average) : null)
    }
    // Rows that went away (closed tiles) start from scratch if they come back.
    for (const id of [...this.history.keys()]) {
      if (!seen.has(id)) {
        this.history.delete(id)
        this.shown.delete(id)
      }
    }
    return result
  }
}
