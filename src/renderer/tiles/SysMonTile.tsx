import { useEffect, useState } from 'react'
import type { SystemSnapshot } from '../../main/sysMonitor'
import { useAppStore } from '../store/appStore'
import { Icon } from '../ui/Icon'
import { CpuChart, type CpuSample } from './CpuChart'

const POLL_MS = 3000
const HISTORY_MS = 3 * 60 * 1000

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb < 1024) return `${mb.toFixed(0)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

export function SysMonTile(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null)
  const [cpuHistory, setCpuHistory] = useState<CpuSample[]>([])
  const tileMemory = useAppStore((s) => s.memorySnapshot)
  const config = useAppStore((s) => s.config)
  const runtime = useAppStore((s) => s.runtime)

  /** "<tileId>::<sub>" views and tiles in other workspaces get a readable name too. */
  const tileName = (viewId: string): string => {
    const baseId = viewId.split('::')[0]
    for (const ws of config?.workspaces ?? []) {
      const tile = ws.tiles[baseId]
      if (tile) return runtime[baseId]?.titleOverride || tile.title
    }
    return viewId
  }

  useEffect(() => {
    let cancelled = false
    async function tick(): Promise<void> {
      try {
        const snap = await window.api.sysmon.snapshot()
        if (cancelled) return
        setSnapshot(snap)
        const now = Date.now()
        setCpuHistory((prev) =>
          [...prev, { time: now, percent: snap.cpuLoadPercent }].filter((p) => now - p.time <= HISTORY_MS)
        )
      } catch {
        /* transient failure, retry next tick */
      }
    }
    void tick()
    const interval = setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const budget = config?.memoryBudgetBytes ?? 0
  const used = tileMemory?.totalAppBytes ?? 0
  const budgetPct = budget > 0 ? Math.min(100, (used / budget) * 100) : 0
  const memPct = snapshot && snapshot.totalMemBytes > 0 ? Math.min(100, (snapshot.usedMemBytes / snapshot.totalMemBytes) * 100) : 0

  return (
    <div className="bt-tile-body bt-sysmon">
      <div className="bt-stat-card bt-sysmon__cpu">
        <div className="bt-stat-card__label">
          <Icon name="activity" size={14} /> CPU
          <span className="bt-sysmon__cpu-now">{snapshot ? `${snapshot.cpuLoadPercent.toFixed(0)}%` : '—'}</span>
        </div>
        <CpuChart samples={cpuHistory} windowMs={HISTORY_MS} />
      </div>

      <div className="bt-sysmon__summary">
        <div className="bt-stat-card">
          <div className="bt-stat-card__label">Memory (system)</div>
          <div className="bt-stat-card__value">
            {snapshot ? `${formatBytes(snapshot.usedMemBytes)} / ${formatBytes(snapshot.totalMemBytes)}` : '—'}
          </div>
          <div
            className="bt-meter"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(memPct)}
            aria-label="システムメモリ使用率"
          >
            <div className={`bt-meter__fill${memPct > 90 ? ' bt-meter__fill--danger' : ''}`} style={{ width: `${memPct}%` }} />
          </div>
          <div className="bt-stat-card__sub">{memPct.toFixed(0)}% 使用中</div>
        </div>
        <div className="bt-stat-card">
          <div className="bt-stat-card__label">Brighterm tiles</div>
          <div className="bt-stat-card__value">{formatBytes(used)}</div>
          <div className="bt-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(budgetPct)} aria-label="タイルのメモリ予算の使用率">
            <div
              className={`bt-meter__fill${budgetPct > 90 ? ' bt-meter__fill--danger' : ''}`}
              style={{ width: `${budgetPct}%` }}
            />
          </div>
          <div className="bt-stat-card__sub">予算 {formatBytes(budget)} の {budgetPct.toFixed(0)}%</div>
        </div>
      </div>

      <div className="bt-sysmon__section-title">Tiles</div>
      <div className="bt-sysmon__list">
        {tileMemory?.tiles.length ? (
          tileMemory.tiles
            .slice()
            .sort((a, b) => b.memoryBytes - a.memoryBytes)
            .map((t) => (
              <div key={t.tileId} className="bt-sysmon__row">
                <span className="bt-sysmon__row-name">{tileName(t.tileId)}</span>
                <span className="bt-sysmon__row-badge">{t.suspended ? '休止中' : formatBytes(t.memoryBytes)}</span>
              </div>
            ))
        ) : (
          <div className="bt-tile-body--centered bt-text-muted">まだデータがありません</div>
        )}
      </div>

      <div className="bt-sysmon__section-title">System processes</div>
      <div className="bt-sysmon__list">
        {snapshot?.topProcesses.map((p) => (
          <div key={p.pid} className="bt-sysmon__row">
            <span className="bt-sysmon__row-name">{p.name}</span>
            <span className="bt-sysmon__row-badge">{formatBytes(p.memBytes)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
