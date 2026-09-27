import { useEffect, useState } from 'react'
import type { SystemSnapshot } from '../../main/sysMonitor'
import { useAppStore } from '../store/appStore'
import { Icon } from '../ui/Icon'

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb < 1024) return `${mb.toFixed(0)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

export function SysMonTile(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null)
  const tileMemory = useAppStore((s) => s.memorySnapshot)
  const config = useAppStore((s) => s.config)

  useEffect(() => {
    let cancelled = false
    async function tick(): Promise<void> {
      try {
        const snap = await window.api.sysmon.snapshot()
        if (!cancelled) setSnapshot(snap)
      } catch {
        /* transient failure, retry next tick */
      }
    }
    void tick()
    const interval = setInterval(tick, 3000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const budget = config?.memoryBudgetBytes ?? 0
  const used = tileMemory?.totalAppBytes ?? 0
  const budgetPct = budget > 0 ? Math.min(100, (used / budget) * 100) : 0

  return (
    <div className="bt-tile-body bt-sysmon">
      <div className="bt-sysmon__summary">
        <div className="bt-stat-card">
          <div className="bt-stat-card__label">
            <Icon name="activity" size={14} /> CPU
          </div>
          <div className="bt-stat-card__value">{snapshot ? `${snapshot.cpuLoadPercent.toFixed(0)}%` : '—'}</div>
        </div>
        <div className="bt-stat-card">
          <div className="bt-stat-card__label">Memory (system)</div>
          <div className="bt-stat-card__value">
            {snapshot ? `${formatBytes(snapshot.usedMemBytes)} / ${formatBytes(snapshot.totalMemBytes)}` : '—'}
          </div>
        </div>
        <div className="bt-stat-card">
          <div className="bt-stat-card__label">Brighterm tiles</div>
          <div className="bt-stat-card__value">{formatBytes(used)}</div>
          <div className="bt-meter">
            <div
              className={`bt-meter__fill${budgetPct > 90 ? ' bt-meter__fill--danger' : ''}`}
              style={{ width: `${budgetPct}%` }}
            />
          </div>
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
                <span className="bt-sysmon__row-name">{t.tileId}</span>
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
