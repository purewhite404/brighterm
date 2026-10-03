import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useAppStore } from '../../store/appStore'
import { useTileConfig } from '../shared/useTileConfig'
import './terminal.css'

/** xterm measures glyphs on a canvas, which can't resolve CSS variables — hand it the real font stack. */
function monoFontStack(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--bt-font-mono').trim()
  return value || 'Consolas, "Cascadia Code", Menlo, monospace'
}

export function TerminalTile({ tileId }: { tileId: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [config] = useTileConfig<{ shellId: string; cwd: string }>(tileId)
  const closeTile = useAppStore((s) => s.closeTile)

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
    // For measuring startup (tests/e2e): when the shell's prompt first shows up.
    let promptSeen = false
    const write = (data: string): void => {
      term.write(data)
      if (!promptSeen && data.includes('>')) {
        promptSeen = true
        performance.mark(`terminal-prompt:${tileId}`)
      }
    }
    const unsubData = window.api.pty.onData((id, data) => {
      if (id === tileId && attached && !disposed) write(data)
    })
    let startedAt = Date.now()
    const unsubExit = window.api.pty.onExit((id, exitCode) => {
      if (id !== tileId || disposed) return
      // A shell that dies right after starting with an error is a failed
      // launch — keep the tile so its output can be read. Otherwise the user
      // typed `exit`: close the tile, like closing a terminal window.
      if (exitCode !== 0 && Date.now() - startedAt < 2000) {
        term.write(`\r\n\x1b[90m[シェルの起動に失敗しました (code ${exitCode})]\x1b[0m\r\n`)
        return
      }
      closeTile(tileId)
    })
    const inputSub = term.onData((data) => window.api.pty.write(tileId, data))

    performance.mark(`terminal-create-sent:${tileId}`)
    void window.api.pty
      .create(tileId, {
        shellId: config.shellId,
        cwd: config.cwd,
        cols: Math.max(term.cols, 2),
        rows: Math.max(term.rows, 1)
      })
      .then(({ backlog }) => {
        if (disposed) return
        if (backlog) write(backlog)
        else startedAt = Date.now()
        attached = true
        term.focus()
      })

    // Resizing: re-fit at most once a frame, and tell the shell only once the size has
    // settled and actually changed — every ConPTY resize makes the shell redraw its screen.
    let fitFrame = 0
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    let sentSize = ''
    const sendSize = (): void => {
      if (disposed || term.cols <= 0 || term.rows <= 0) return
      const size = `${term.cols}x${term.rows}`
      if (size === sentSize) return
      sentSize = size
      window.api.pty.resize(tileId, term.cols, term.rows)
    }
    const observer = new ResizeObserver(() => {
      if (fitFrame) return
      fitFrame = requestAnimationFrame(() => {
        fitFrame = 0
        safeFit()
        clearTimeout(resizeTimer)
        resizeTimer = setTimeout(sendSize, 80)
      })
    })
    observer.observe(container)

    return () => {
      // The pty keeps running — only closing the tile kills it (see closeTile).
      disposed = true
      observer.disconnect()
      cancelAnimationFrame(fitFrame)
      clearTimeout(resizeTimer)
      unsubData()
      unsubExit()
      inputSub.dispose()
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileId])

  // xterm goes in an unpadded inner box: FitAddon sizes rows from its parent's CSS height, which
  // (border-box) includes padding — with the padding on the same element the last row was cut off.
  return (
    <div className="bt-terminal-tile" onClick={() => containerRef.current?.querySelector('textarea')?.focus()}>
      <div ref={containerRef} className="bt-terminal-tile__host" />
    </div>
  )
}
