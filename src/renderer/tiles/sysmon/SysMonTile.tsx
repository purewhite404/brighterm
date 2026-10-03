import { useEffect, useRef, useState } from 'react'
import type { ProcessInfo, SystemSnapshot } from '@shared/apiTypes'
import { useAppStore } from '../../store/appStore'
import { Icon } from '../../ui/Icon'
import { CpuChart, type CpuSample } from './CpuChart'
import { formatBytes } from '../../ui/formatBytes'
import { baseTileId } from '../shared/subViews'
import './sysmon.css'

const POLL_MS = 500
const HISTORY_MS = 60 * 1000

/**
 * The process list is fetched when the tile opens and when 更新 is pressed — never
 * polled: on Windows each listing runs PowerShell (~0.3 s of CPU, measured 2026-10-03),
 * which every 3 s was ~10 % of a core for as long as the tile was shown.
 */
function timeOfDay(ms: number): string {
  return new Date(ms).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Rows that aren't a tile of their own (see main/sysmon/appMemory.ts). */
const APP_ROW_NAMES: Record<string, string> = {
  __shell: 'UI・内蔵タイル（Terminal, Files, Calendar など）',
  __core: 'メイン・GPU ほか'
}

export function SysMonTile(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null)
  const [processes, setProcesses] = useState<ProcessInfo[]>([])
  const [processesAt, setProcessesAt] = useState<number | null>(null)
  const [loadingProcesses, setLoadingProcesses] = useState(false)
  const [processError, setProcessError] = useState<string | null>(null)
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

  const mounted = useRef(true)
  const loadProcesses = async (): Promise<void> => {
    setLoadingProcesses(true)
    try {
      const snap = await window.api.sysmon.snapshot({ processes: true })
      if (!mounted.current) return
      setProcesses(snap.topProcesses ?? [])
      setProcessesAt(Date.now())
      setProcessError(null)
    } catch (err) {
      if (mounted.current) setProcessError(err instanceof Error ? err.message : String(err))
    } finally {
      if (mounted.current) setLoadingProcesses(false)
    }
  }
  useEffect(() => {
    mounted.current = true
    void loadProcesses()
    return () => {
      mounted.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    let inFlight = false
    async function tick(): Promise<void> {
      // Skip a beat rather than pile up requests if one takes longer than POLL_MS.
      if (inFlight) return
      inFlight = true
      try {
        const snap = await window.api.sysmon.snapshot({ processes: false })
        if (cancelled) return
        setSnapshot(snap)
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
    // Only while the window can be seen (not minimized or fully covered).
    let interval: ReturnType<typeof setInterval> | undefined
    const sync = (): void => {
      if (document.hidden) {
        clearInterval(interval)
        interval = undefined
      } else if (!interval) {
        void tick()
        interval = setInterval(tick, POLL_MS)
      }
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', sync)
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
                {t.cpuPercent !== null && (
                  <span className="bt-sysmon__row-cpu" title="直近 2 秒の平均。100% = CPU 1 コアを使い切っている状態">
                    CPU {t.cpuPercent}%
                  </span>
                )}
                <span className="bt-sysmon__row-badge">{t.suspended ? '休止中' : formatBytes(t.memoryBytes)}</span>
              </div>
            ))
        ) : (
          <div className="bt-tile-body--centered bt-text-muted">まだデータがありません</div>
        )}
      </div>

      <div className="bt-sysmon__section-title bt-sysmon__section-title--with-action">
        <span>System processes</span>
        {processesAt !== null && <span className="bt-sysmon__as-of">{timeOfDay(processesAt)} 時点</span>}
        <button
          type="button"
          className="bt-sysmon__refresh"
          onClick={() => void loadProcesses()}
          disabled={loadingProcesses}
          title="プロセス一覧を取り直す（Windows では取得に PowerShell を使うため、自動では更新しません）"
        >
          <Icon name="refresh" size={12} /> {loadingProcesses ? '取得中…' : '更新'}
        </button>
      </div>
      {processError && <div className="bt-sysmon__error">プロセス一覧を取得できませんでした: {processError}</div>}
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
