import { useEffect, useRef, useState } from 'react'

export interface CpuSample {
  time: number
  percent: number
}

const HEIGHT = 120
const PAD = { top: 8, right: 8, bottom: 18, left: 34 }
const GRID_LINES = [0, 50, 100]

/**
 * CPU load over time: one 2px line on a 0–100% axis with recessive grid
 * lines, and a hover crosshair + tooltip for the value at any point.
 */
export function CpuChart({ samples, windowMs }: { samples: CpuSample[]; windowMs: number }): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const plotW = Math.max(0, width - PAD.left - PAD.right)
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const now = samples.length ? samples[samples.length - 1].time : Date.now()
  const x = (t: number): number => PAD.left + plotW * (1 - (now - t) / windowMs)
  const y = (p: number): number => PAD.top + plotH * (1 - Math.min(100, Math.max(0, p)) / 100)

  const points = samples.map((s) => `${x(s.time).toFixed(1)},${y(s.percent).toFixed(1)}`).join(' ')
  const area =
    samples.length > 1
      ? `M${x(samples[0].time)},${y(0)} L${points.replace(/ /g, ' L')} L${x(samples[samples.length - 1].time)},${y(0)} Z`
      : ''

  const onMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (samples.length === 0) return
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left
    let best = 0
    for (let i = 1; i < samples.length; i++) {
      if (Math.abs(x(samples[i].time) - px) < Math.abs(x(samples[best].time) - px)) best = i
    }
    setHoverIndex(best)
  }

  const hovered = hoverIndex !== null ? samples[hoverIndex] : null
  const seconds = Math.round(windowMs / 1000)

  return (
    <div ref={wrapRef} className="bt-cpu-chart">
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`CPU 使用率の推移（直近 ${seconds} 秒）`}
          onPointerMove={onMove}
          onPointerLeave={() => setHoverIndex(null)}
        >
          {GRID_LINES.map((g) => (
            <g key={g}>
              <line className="bt-cpu-chart__grid" x1={PAD.left} x2={PAD.left + plotW} y1={y(g)} y2={y(g)} />
              <text className="bt-cpu-chart__axis" x={PAD.left - 6} y={y(g)} dy="0.32em" textAnchor="end">
                {g}%
              </text>
            </g>
          ))}
          <text className="bt-cpu-chart__axis" x={PAD.left} y={HEIGHT - 4}>
            {seconds}秒前
          </text>
          <text className="bt-cpu-chart__axis" x={PAD.left + plotW} y={HEIGHT - 4} textAnchor="end">
            現在
          </text>
          {area && <path className="bt-cpu-chart__area" d={area} />}
          {samples.length > 1 && <polyline className="bt-cpu-chart__line" points={points} />}
          {hovered && (
            <g>
              <line
                className="bt-cpu-chart__crosshair"
                x1={x(hovered.time)}
                x2={x(hovered.time)}
                y1={PAD.top}
                y2={PAD.top + plotH}
              />
              <circle className="bt-cpu-chart__dot" cx={x(hovered.time)} cy={y(hovered.percent)} r={4} />
            </g>
          )}
        </svg>
      )}
      {hovered && (
        <div
          className="bt-cpu-chart__tooltip"
          style={{ left: Math.min(Math.max(x(hovered.time), 60), width - 60), top: 0 }}
        >
          <strong>{hovered.percent.toFixed(0)}%</strong>{' '}
          {new Date(hovered.time).toLocaleTimeString('ja-JP')}
        </div>
      )}
    </div>
  )
}
