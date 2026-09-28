/** Human-readable byte count: kB below 1 MB (so small values don't round to "0 MB"), then MB, then GB. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 kB'
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : kb.toFixed(0)} kB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(0)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

/** A tile header's compact memory badge: whole MB, then GB; nothing for 0. */
export function formatTileMemory(bytes: number): string {
  if (bytes <= 0) return ''
  const mb = bytes / (1024 * 1024)
  return mb < 1024 ? `${mb.toFixed(0)} MB` : `${(mb / 1024).toFixed(1)} GB`
}
