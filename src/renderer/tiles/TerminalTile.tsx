import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useAppStore, selectActiveWorkspace } from '../store/appStore'

/** xterm measures glyphs on a canvas, which can't resolve CSS variables — hand it the real font stack. */
function monoFontStack(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--bt-font-mono').trim()
  return value || 'Consolas, "Cascadia Code", Menlo, monospace'
}

export function TerminalTile({ tileId }: { tileId: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const tile = useAppStore((s) => selectActiveWorkspace(s)?.tiles[tileId])
  const config = (tile?.config ?? {}) as { shellId?: string; cwd?: string }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: monoFontStack(),
      fontSize: 13,
      allowTransparency: true,
      theme: { background: '#00000000', foreground: '#eef0f5', cursor: '#5b8cff' }
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)

    /** Fit only when the container actually has a size — fitting a 0x0 box is what threw 'dimensions'. */
    const safeFit = (): void => {
      if (disposed || container.clientWidth === 0 || container.clientHeight === 0) return
      try {
        fitAddon.fit()
      } catch {
        /* renderer not ready yet; the next resize will retry */
      }
    }
    safeFit()

    // Output that arrives before the create() reply is already part of the
    // backlog it returns (IPC messages are ordered), so drop it until then.
    let attached = false
    const unsubData = window.api.pty.onData((id, data) => {
      if (id === tileId && attached && !disposed) term.write(data)
    })
    const unsubExit = window.api.pty.onExit((id, exitCode) => {
      if (id === tileId && !disposed) term.write(`\r\n\x1b[90m[プロセスが終了しました (code ${exitCode})]\x1b[0m\r\n`)
    })
    const inputSub = term.onData((data) => window.api.pty.write(tileId, data))

    void window.api.pty
      .create(tileId, {
        shellId: config.shellId,
        cwd: config.cwd,
        cols: Math.max(term.cols, 2),
        rows: Math.max(term.rows, 1)
      })
      .then(({ backlog }) => {
        if (disposed) return
        if (backlog) term.write(backlog)
        attached = true
        term.focus()
      })

    const observer = new ResizeObserver(() => {
      safeFit()
      if (!disposed && term.cols > 0 && term.rows > 0) window.api.pty.resize(tileId, term.cols, term.rows)
    })
    observer.observe(container)

    return () => {
      // The pty keeps running — only closing the tile kills it (see closeTile).
      disposed = true
      observer.disconnect()
      unsubData()
      unsubExit()
      inputSub.dispose()
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileId])

  return <div ref={containerRef} className="bt-terminal-tile" onClick={() => containerRef.current?.querySelector('textarea')?.focus()} />
}
