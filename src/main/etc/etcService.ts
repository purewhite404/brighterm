import { platform } from 'node:os'
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { EtcHistory } from './history'
import { findValidator } from './validators'
import { isAugeasAvailable, readTree, setValueAndSave } from './augeas'
import { diffLines } from './diff'
import type { AugeasNode, DiffOp, EtcFileDescriptor, ExecResult, HistoryEntry } from '@shared/apiTypes'

/**
 * The Settings tile's Linux "no desktop settings tool" fallback: a small,
 * safety-railed editor for the handful of /etc files people actually touch
 * by hand. Every write goes through: backup -> (optional) validate -> pkexec.
 *
 * NOTE: this module is Linux-specific and was written and reviewed but could
 * not be exercised end-to-end on the Windows machine this was built on — the
 * pure pieces (diff, augeas output parsing, history bookkeeping) have unit
 * tests; the pkexec/augtool process-spawning glue here does not.
 */

const COMMON_FILES: Array<{ label: string; path: string }> = [
  { label: 'Hosts', path: '/etc/hosts' },
  { label: 'Filesystems (fstab)', path: '/etc/fstab' },
  { label: 'SSH daemon', path: '/etc/ssh/sshd_config' },
  { label: 'Sudoers', path: '/etc/sudoers' },
  { label: 'DNS resolver', path: '/etc/resolv.conf' },
  { label: 'Crontab (system)', path: '/etc/crontab' },
  { label: 'NetworkManager', path: '/etc/NetworkManager/NetworkManager.conf' },
  { label: 'Netplan (Ubuntu)', path: '/etc/netplan/01-network-manager-all.yaml' }
]

function runPlain(cmd: string, args: string[], input?: string): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, { input, encoding: 'utf-8', timeout: 15000 })
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error ? String(result.error) : '')
  }
}

/** Runs a command as root via pkexec, forwarding stdin (used for augtool scripts and `tee`). */
function runElevated(cmd: string, args: string[], input?: string): { ok: boolean; stdout: string; stderr: string } {
  return runPlain('pkexec', [cmd, ...args], input)
}

export class EtcService {
  private readonly history: EtcHistory

  constructor(historyRoot: string) {
    this.history = new EtcHistory(historyRoot)
  }

  /** Only Linux gets the /etc editor — macOS and Windows have their own settings apps. */
  isSupported(): boolean {
    return platform() === 'linux'
  }

  listCommonFiles(): EtcFileDescriptor[] {
    return COMMON_FILES.map((f) => ({ ...f, exists: existsSync(f.path) }))
  }

  /** Read a file, transparently escalating via pkexec if it's not world-readable (e.g. sudoers). */
  readFile(path: string): string {
    try {
      return readFileSync(path, 'utf-8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EACCES') throw err
      const result = runElevated('cat', [path])
      if (!result.ok) throw new Error(result.stderr || 'permission denied')
      return result.stdout
    }
  }

  hasAugeas(): boolean {
    return isAugeasAvailable((stdin) => this.execAugeas(stdin, false))
  }

  readAugeasTree(path: string): AugeasNode[] {
    let nodes = readTree(path, (stdin) => this.execAugeas(stdin, false))
    if (nodes.length === 0) {
      // Might be a permissions issue (e.g. sudoers) rather than a genuinely empty file.
      nodes = readTree(path, (stdin) => this.execAugeas(stdin, true))
    }
    return nodes
  }

  preview(path: string, newContent: string): DiffOp[] {
    const current = this.tryRead(path)
    return diffLines(current, newContent)
  }

  validate(path: string, candidateContent: string): ExecResult | null {
    const validator = findValidator(path)
    if (!validator) return null
    const tmpDir = mkdtempSync(join(tmpdir(), 'brighterm-etc-'))
    const candidatePath = join(tmpDir, 'candidate')
    try {
      writeFileSync(candidatePath, candidateContent, 'utf-8')
      const { cmd, args } = validator.command(candidatePath)
      const result = runPlain(cmd, args)
      return { ok: result.ok, output: result.ok ? result.stdout : result.stderr || result.stdout }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  /**
   * Write plain text content to a root-owned file: backup -> pkexec tee.
   * Callers are expected to have already shown the diff and (if applicable)
   * run validate() and gotten user confirmation.
   */
  writeFile(path: string, newContent: string): ExecResult {
    const current = this.tryRead(path)
    this.history.backup(path, current)
    const result = runElevated('tee', [path], newContent)
    return { ok: result.ok, output: result.ok ? 'saved' : result.stderr }
  }

  /** Structured (Augeas) write path: set one node's value, save, and back up first. */
  writeAugeasValue(path: string, augPath: string, value: string): ExecResult {
    const current = this.tryRead(path)
    this.history.backup(path, current)
    const result = setValueAndSave(augPath, value, (stdin) => this.execAugeas(stdin, true))
    return { ok: result.ok, output: result.ok ? result.stdout : result.stderr }
  }

  listHistory(path: string): HistoryEntry[] {
    return this.history.list(path)
  }

  /** Restore a previous generation, itself going through the same backup + pkexec write path. */
  restore(path: string, fileName: string): ExecResult {
    const content = this.history.read(path, fileName)
    return this.writeFile(path, content)
  }

  private tryRead(path: string): string {
    try {
      return this.readFile(path)
    } catch {
      return ''
    }
  }

  private execAugeas(stdin: string, elevated: boolean): { ok: boolean; stdout: string; stderr: string } {
    return elevated ? runElevated('augtool', [], stdin) : runPlain('augtool', [], stdin)
  }
}
