import os from 'node:os'
import { existsSync } from 'node:fs'
import * as pty from 'node-pty'

/**
 * Owns every terminal (node-pty) session, one per Terminal tile instance.
 * OS-specific shell discovery lives here so the renderer never has to know
 * about PowerShell vs. zsh vs. $SHELL.
 */

export interface ShellOption {
  id: string
  label: string
  path: string
  args: string[]
}

/** Enumerate shells that actually exist on this machine, best guess first. */
export function listAvailableShells(): ShellOption[] {
  const platform = os.platform()
  const candidates: ShellOption[] = []

  if (platform === 'win32') {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    const pwsh7 = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
    const powershell = `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    const cmd = `${systemRoot}\\System32\\cmd.exe`
    const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const wslExe = `${systemRoot}\\System32\\wsl.exe`

    if (existsSync(pwsh7)) candidates.push({ id: 'pwsh7', label: 'PowerShell 7', path: pwsh7, args: [] })
    if (existsSync(powershell))
      candidates.push({ id: 'powershell', label: 'Windows PowerShell', path: powershell, args: [] })
    if (existsSync(gitBash)) candidates.push({ id: 'git-bash', label: 'Git Bash', path: gitBash, args: ['--login', '-i'] })
    if (existsSync(wslExe)) candidates.push({ id: 'wsl', label: 'WSL', path: wslExe, args: [] })
    if (existsSync(cmd)) candidates.push({ id: 'cmd', label: 'Command Prompt', path: cmd, args: [] })
  } else if (platform === 'darwin') {
    const zsh = '/bin/zsh'
    const bash = '/bin/bash'
    const userShell = process.env.SHELL
    if (userShell && existsSync(userShell) && userShell !== zsh) {
      candidates.push({ id: 'login-shell', label: `${userShell} (login shell)`, path: userShell, args: ['-l'] })
    }
    if (existsSync(zsh)) candidates.push({ id: 'zsh', label: 'zsh', path: zsh, args: ['-l'] })
    if (existsSync(bash)) candidates.push({ id: 'bash', label: 'bash', path: bash, args: ['-l'] })
  } else {
    // Linux and other POSIX platforms.
    const userShell = process.env.SHELL
    if (userShell && existsSync(userShell)) {
      candidates.push({ id: 'login-shell', label: `${userShell} (login shell)`, path: userShell, args: ['-l'] })
    }
    for (const [id, shellPath] of [
      ['bash', '/bin/bash'],
      ['zsh', '/usr/bin/zsh'],
      ['fish', '/usr/bin/fish'],
      ['nu', '/usr/bin/nu'],
      ['sh', '/bin/sh']
    ] as const) {
      if (existsSync(shellPath) && !candidates.some((c) => c.path === shellPath)) {
        candidates.push({ id, label: id, path: shellPath, args: [] })
      }
    }
  }

  return candidates
}

export function defaultShell(): ShellOption {
  const shells = listAvailableShells()
  if (shells.length > 0) return shells[0]
  // Last-resort fallback if detection found nothing.
  return os.platform() === 'win32'
    ? { id: 'cmd', label: 'Command Prompt', path: 'cmd.exe', args: [] }
    : { id: 'sh', label: 'sh', path: '/bin/sh', args: [] }
}

/**
 * The environment a shell starts with. Windows PowerShell 5.1 started from a
 * PowerShell 7 session (e.g. `npm run dev` in pwsh) inherits PS7's
 * PSModulePath and then fails to load its own PSReadLine — no history, no
 * line editing. Dropping the variable lets 5.1 rebuild its default path.
 */
export function shellEnv(shell: ShellOption, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) env[key] = value
  }
  if (shell.id === 'powershell') {
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === 'psmodulepath') delete env[key]
    }
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  return env
}

interface PtySession {
  proc: pty.IPty
  /** Recent output, replayed to a terminal view that attaches after it was emitted. */
  backlog: string
}

/** How much recent output to keep per session for replay (characters). */
const BACKLOG_LIMIT = 200_000

export interface PtyManagerOptions {
  onData: (tileId: string, data: string) => void
  onExit: (tileId: string, exitCode: number) => void
}

export class PtyManager {
  private readonly sessions = new Map<string, PtySession>()
  private readonly options: PtyManagerOptions

  constructor(options: PtyManagerOptions) {
    this.options = options
  }

  /**
   * Starts a session for the tile, or — if one is already running (the tile's
   * view re-mounted) — resizes it and returns its recent output so the new
   * view can show what it missed.
   */
  create(
    tileId: string,
    opts: { shellId?: string; cwd?: string; cols: number; rows: number }
  ): { backlog: string } {
    const existing = this.sessions.get(tileId)
    if (existing) {
      this.resize(tileId, opts.cols, opts.rows)
      return { backlog: existing.backlog }
    }

    const shells = listAvailableShells()
    const chosen = (opts.shellId ? shells.find((s) => s.id === opts.shellId) : undefined) ?? defaultShell()

    const proc = pty.spawn(chosen.path, chosen.args, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd ?? os.homedir(),
      env: shellEnv(chosen)
    })

    const session: PtySession = { proc, backlog: '' }
    proc.onData((data) => {
      session.backlog = (session.backlog + data).slice(-BACKLOG_LIMIT)
      this.options.onData(tileId, data)
    })
    proc.onExit(({ exitCode }) => {
      this.sessions.delete(tileId)
      this.options.onExit(tileId, exitCode)
    })

    this.sessions.set(tileId, session)
    return { backlog: '' }
  }

  write(tileId: string, data: string): void {
    this.sessions.get(tileId)?.proc.write(data)
  }

  resize(tileId: string, cols: number, rows: number): void {
    const session = this.sessions.get(tileId)
    if (!session) return
    try {
      session.proc.resize(Math.max(1, cols), Math.max(1, rows))
    } catch {
      /* pty may have just exited */
    }
  }

  kill(tileId: string): void {
    const session = this.sessions.get(tileId)
    if (!session) return
    try {
      session.proc.kill()
    } catch {
      /* already dead */
    }
    this.sessions.delete(tileId)
  }

  disposeAll(): void {
    for (const tileId of [...this.sessions.keys()]) {
      this.kill(tileId)
    }
  }
}
