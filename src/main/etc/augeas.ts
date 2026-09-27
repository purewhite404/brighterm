/**
 * Thin adapter over the `augtool` CLI (Augeas). Kept dependency-injected
 * (the caller supplies how to actually run a process) so the parsing logic
 * can be unit-tested on any OS, including this Windows dev machine, without
 * a real Augeas install.
 *
 * We deliberately don't link against the native libaugeas — shelling out to
 * augtool is slower per call but needs no native module / rebuild step, and
 * this is an occasional, human-paced editing tool, not a hot path.
 */

export interface AugeasExecResult {
  ok: boolean
  stdout: string
  stderr: string
}

/** Runs `augtool <flags>` feeding `stdin` as its command script, one command per line. */
export type AugeasExecFn = (stdin: string) => AugeasExecResult

export interface AugeasNode {
  /** Full Augeas path, e.g. "/files/etc/hosts/1/ipaddr". */
  path: string
  value: string | null
}

export function isAugeasAvailable(exec: AugeasExecFn): boolean {
  const result = exec('help\n')
  return result.ok
}

/**
 * List every node under /files<targetPath>, using `augtool`'s own recursive
 * `print` command (augtool loads its normal set of lenses; we just scope the
 * query to the one file the user is editing).
 */
export function readTree(targetPath: string, exec: AugeasExecFn): AugeasNode[] {
  const augRoot = `/files${targetPath}`
  const result = exec(`print ${augRoot}\n`)
  if (!result.ok) return []
  return parsePrintOutput(result.stdout, augRoot)
}

/** Parses augtool's `print` output, e.g. "/files/etc/hosts/1/ipaddr = \"127.0.0.1\"". */
export function parsePrintOutput(output: string, scopeRoot: string): AugeasNode[] {
  const nodes: AugeasNode[] = []
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith(scopeRoot)) continue
    const eqIndex = line.indexOf(' = ')
    if (eqIndex === -1) {
      nodes.push({ path: line, value: null })
      continue
    }
    const path = line.slice(0, eqIndex)
    let value = line.slice(eqIndex + 3).trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    nodes.push({ path, value })
  }
  return nodes
}

/** Set one node's value and save. Returns whether the save succeeded (and augtool's message). */
export function setValueAndSave(augPath: string, value: string, exec: AugeasExecFn): AugeasExecResult {
  const escaped = value.replace(/"/g, '\\"')
  return exec(`set ${augPath} "${escaped}"\nsave\n`)
}

/** Remove one node and save. */
export function removeNodeAndSave(augPath: string, exec: AugeasExecFn): AugeasExecResult {
  return exec(`rm ${augPath}\nsave\n`)
}
