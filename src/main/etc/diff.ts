/**
 * A minimal line-based diff (Myers-ish LCS) — enough for a "here's what's
 * about to change" preview before writing to a root-owned config file. Not
 * meant to compete with a real diff library; kept dependency-free and easy
 * to unit test.
 */

export type DiffOp = { type: 'equal' | 'add' | 'remove'; line: string }

export function diffLines(before: string, after: string): DiffOp[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const n = a.length
  const m = b.length

  // LCS table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', line: a[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: 'remove', line: a[i] })
      i++
    } else {
      ops.push({ type: 'add', line: b[j] })
      j++
    }
  }
  while (i < n) {
    ops.push({ type: 'remove', line: a[i] })
    i++
  }
  while (j < m) {
    ops.push({ type: 'add', line: b[j] })
    j++
  }
  return ops
}
