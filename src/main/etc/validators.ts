/**
 * Maps a config file to the command that can check it *without* applying it,
 * so a typo in sudoers doesn't lock the user out, a bad sshd_config doesn't
 * stop remote access, etc. Every entry here must be a dry-run / check-only
 * invocation — never the real reload command.
 */

export interface Validator {
  /** Human-readable name shown in the diff/confirm dialog. */
  label: string
  /** Build the argv for a check-only invocation against a candidate file path (may be a temp copy). */
  command: (candidatePath: string) => { cmd: string; args: string[] }
}

const VALIDATORS: Array<{ match: RegExp; validator: Validator }> = [
  {
    match: /\/etc\/sudoers(\.d\/.*)?$/,
    validator: { label: 'visudo -c', command: (p) => ({ cmd: 'visudo', args: ['-c', '-f', p] }) }
  },
  {
    match: /\/etc\/ssh\/sshd_config$/,
    validator: { label: 'sshd -t', command: (p) => ({ cmd: 'sshd', args: ['-t', '-f', p] }) }
  },
  {
    match: /\/etc\/nginx\//,
    validator: { label: 'nginx -t', command: (p) => ({ cmd: 'nginx', args: ['-t', '-c', p] }) }
  },
  {
    match: /\/etc\/fstab$/,
    // findmnt --verify supports checking an arbitrary fstab-format file.
    validator: { label: 'findmnt --verify', command: (p) => ({ cmd: 'findmnt', args: ['--verify', '--tab-file', p] }) }
  },
  {
    match: /\/etc\/systemd\/.*\.service$/,
    validator: {
      label: 'systemd-analyze verify',
      command: (p) => ({ cmd: 'systemd-analyze', args: ['verify', p] })
    }
  }
]

export function findValidator(targetPath: string): Validator | null {
  const hit = VALIDATORS.find((entry) => entry.match.test(targetPath))
  return hit?.validator ?? null
}

export interface ExecResult {
  ok: boolean
  output: string
}

export type ExecFn = (cmd: string, args: string[]) => ExecResult

export function runValidator(targetPath: string, candidatePath: string, exec: ExecFn): ExecResult | null {
  const validator = findValidator(targetPath)
  if (!validator) return null
  const { cmd, args } = validator.command(candidatePath)
  return exec(cmd, args)
}
