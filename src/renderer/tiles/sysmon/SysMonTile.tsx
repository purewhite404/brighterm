import { useEffect, useState } from 'react'
import type { ProcessInfo, SystemSnapshot } from '@shared/apiTypes'
import { useAppStore } from '../../store/appStore'
import { Icon } from '../../ui/Icon'
import { CpuChart, type CpuSample } from './CpuChart'
import { formatBytes } from '../../ui/formatBytes'
import { baseTileId } from '../shared/subViews'
import './sysmon.css'

const POLL_MS = 500
const HISTORY_MS = 60 * 1000
/** Listing processes costs far more than CPU/memory, so the process list refreshes less often. */
const PROCESS_POLL_MS = 3000

/** Rows that aren't a tile of their own (see main/appMemory.ts). */
const APP_ROW_NAMES: Record<string, string> = {
  __shell: 'UI・内蔵タイル（Terminal, Files, Notes など）',
  __core: 'メイン・GPU ほか'
}

export function SysMonTile(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null)
  const [processes, setProcesses] = useState<ProcessInfo[]>([])
  const [cpuHistory, setCpuHistory] = useState<CpuSample[]>([])
  const tileMemory = useAppStore((s) => s.memorySnapshot)
  const config = useAppStore((s) => s.config)
  const runtime = useAppStore((s) => s.runtime)

  /** "<tileId>::<sub>" views and tiles in other workspaces get a readable name too. */
  const tileName = (viewId: string): string => {
    if (APP_ROW_NAMES[viewId]) return APP_ROW_NAMES[viewId]
    const baseId = baseTileId(viewId)
    for (const ws of config?.workspaces ?? []) {
      const tile = ws.tiles[baseId]
      if (tile) return runtime[baseId]?.titleOverride || tile.title
    }
    return viewId
  }

  useEffect(() => {
    let cancelled = false
    let inFlight = false
    let lastProcessesAt = 0
    async function tick(): Promise<void> {
      // Skip a beat rather than pile up requests if one takes longer than POLL_MS.
      if (inFlight) return
      inFlight = true
      try {
        const wantProcesses = Date.now() - lastProcessesAt >= PROCESS_POLL_MS
        if (wantProcesses) lastProcessesAt = Date.now()
        const snap = await window.api.sysmon.snapshot({ processes: wantProcesses })
        if (cancelled) return
        setSnapshot(snap)
        if (snap.topProcesses) setProcesses(snap.topProcesses)
        const now = Date.now()
        setCpuHistory((prev) =>
          [...prev, { time: now, percent: snap.cpuLoadPercent }].filter((p) => now - p.time <= HISTORY_MS)
        )
      } catch {
        /* transient failure, retry next tick */
      } finally {
        inFlight = false
      }
    }
    void tick()
    const interval = setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const used = tileMemory?.totalAppBytes ?? 0
  // Brighterm's share of the machine's memory.
  const appPct = snapshot && snapshot.totalMemBytes > 0 ? Math.min(100, (used / snapshot.totalMemBytes) * 100) : 0
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
          <div className="bt-stat-card__label">Brighterm</div>
          <div className="bt-stat-card__value">{formatBytes(used)}</div>
          <div
            className="bt-meter"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(appPct)}
            aria-label="Brighterm が使っているシステムメモリの割合"
          >
            <div className="bt-meter__fill" style={{ width: `${appPct}%` }} />
          </div>
          <div className="bt-stat-card__sub">システムメモリの {appPct < 1 ? appPct.toFixed(1) : appPct.toFixed(0)}%</div>
        </div>
      </div>

      <div className="bt-sysmon__section-title">Brighterm の内訳</div>
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
        {processes.map((p) => (
          <div key={p.pid} className="bt-sysmon__row">
            <span className="bt-sysmon__row-name">{p.name}</span>
            <span className="bt-sysmon__row-badge">{formatBytes(p.memBytes)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
