import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useAppStore, selectActiveWorkspace } from '../store/appStore'

export function TerminalTile({ tileId }: { tileId: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const created = useRef(false)
  const tile = useAppStore((s) => selectActiveWorkspace(s)?.tiles[tileId])

  useEffect(() => {
    const container = containerRef.current
    if (!container || created.current) return
    created.current = true

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'var(--bt-font-mono)',
      fontSize: 13,
      theme: {
        background: '#00000000',
        foreground: '#eef0f5',
        cursor: '#5b8cff'
      },
      allowTransparency: true
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)
    fitAddon.fit()

    const config = (tile?.config ?? {}) as { shellId?: string; cwd?: string }
    void window.api.pty.create(tileId, {
      shellId: config.shellId,
      cwd: config.cwd,
      cols: term.cols,
      rows: term.rows
    })

    const unsubData = window.api.pty.onData((id, data) => {
      if (id === tileId) term.write(data)
    })
    const unsubExit = window.api.pty.onExit((id, exitCode) => {
      if (id === tileId) term.write(`\r\n\x1b[90m[process exited with code ${exitCode}]\x1b[0m\r\n`)
    })
    term.onData((data) => window.api.pty.write(tileId, data))

    const observer = new ResizeObserver(() => {
      fitAddon.fit()
      window.api.pty.resize(tileId, term.cols, term.rows)
    })
    observer.observe(container)

    return () => {
      unsubData()
      unsubExit()
      observer.disconnect()
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={containerRef} className="bt-terminal-tile" />
}
