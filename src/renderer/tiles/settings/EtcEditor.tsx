import { useEffect, useState } from 'react'
import type { EtcFileDescriptor, DiffOp, HistoryEntry } from '../../../main/etc/etcService'
import type { ExecResult } from '../../../main/etc/validators'

function DiffView({ ops }: { ops: DiffOp[] }): React.JSX.Element {
  return (
    <pre className="bt-etc__diff">
      {ops.map((op, i) => (
        <div key={i} className={`bt-etc__diff-line bt-etc__diff-line--${op.type}`}>
          {op.type === 'add' ? '+ ' : op.type === 'remove' ? '- ' : '  '}
          {op.line}
        </div>
      ))}
    </pre>
  )
}

/**
 * Linux without a desktop settings app: edit common /etc files with a diff
 * preview, validation, a pkexec-approved save and restorable history.
 */
export function EtcEditor(): React.JSX.Element {
  const [files, setFiles] = useState<EtcFileDescriptor[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [original, setOriginal] = useState('')
  const [draft, setDraft] = useState('')
  const [diff, setDiff] = useState<DiffOp[] | null>(null)
  const [validation, setValidation] = useState<ExecResult | null | undefined>(undefined)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [saveResult, setSaveResult] = useState<ExecResult | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.api.etc.listFiles().then(setFiles)
  }, [])

  const openFile = async (path: string): Promise<void> => {
    setBusy(true)
    try {
      const content = await window.api.etc.read(path)
      setSelected(path)
      setOriginal(content)
      setDraft(content)
      setDiff(null)
      setValidation(undefined)
      setSaveResult(null)
      setHistory(await window.api.etc.history(path))
    } catch (err) {
      setSaveResult({ ok: false, output: String(err) })
    } finally {
      setBusy(false)
    }
  }

  const runPreview = async (): Promise<void> => {
    if (!selected) return
    setDiff(await window.api.etc.diff(selected, draft))
    setValidation(await window.api.etc.validate(selected, draft))
  }

  const save = async (): Promise<void> => {
    if (!selected) return
    setBusy(true)
    try {
      const result = await window.api.etc.write(selected, draft)
      setSaveResult(result)
      if (result.ok) {
        setOriginal(draft)
        setHistory(await window.api.etc.history(selected))
      }
    } finally {
      setBusy(false)
    }
  }

  const restore = async (fileName: string): Promise<void> => {
    if (!selected) return
    setBusy(true)
    try {
      const result = await window.api.etc.restore(selected, fileName)
      setSaveResult(result)
      if (result.ok) await openFile(selected)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bt-etc">
      <div className="bt-etc__sidebar">
        <div className="bt-section-title">よく使う /etc ファイル</div>
        {files.map((f) => (
          <button
            key={f.path}
            className={`bt-etc__file${selected === f.path ? ' bt-etc__file--active' : ''}`}
            disabled={!f.exists}
            onClick={() => openFile(f.path)}
            title={f.path}
          >
            {f.label}
            {!f.exists && <span className="bt-text-muted"> (未検出)</span>}
          </button>
        ))}
      </div>
      <div className="bt-etc__main">
        {!selected ? (
          <div className="bt-tile-body--centered bt-text-muted">左のファイルを選んでください</div>
        ) : (
          <>
            <div className="bt-etc__path">{selected}</div>
            <textarea
              className="bt-etc__textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
            />
            <div className="bt-etc__actions">
              <button onClick={runPreview} disabled={busy || draft === original}>
                差分を確認
              </button>
              <button onClick={save} disabled={busy || draft === original} className="bt-btn-primary">
                保存（要 pkexec 承認）
              </button>
              <button onClick={() => setDraft(original)} disabled={busy || draft === original}>
                元に戻す
              </button>
            </div>
            {diff && <DiffView ops={diff} />}
            {validation !== undefined && (
              <div className={`bt-message${validation && !validation.ok ? ' bt-message--error' : ''}`}>
                {validation === null ? 'この種類のファイルには自動検証がありません。' : validation.output}
              </div>
            )}
            {saveResult && (
              <div className={`bt-message${!saveResult.ok ? ' bt-message--error' : ''}`}>
                {saveResult.output}
              </div>
            )}
            {history.length > 0 && (
              <div className="bt-etc__history">
                <div className="bt-section-title">履歴</div>
                {history.map((h) => (
                  <div key={h.fileName} className="bt-etc__history-row">
                    <span>{new Date(h.timestamp).toLocaleString('ja-JP')}</span>
                    <button onClick={() => restore(h.fileName)} disabled={busy}>
                      この時点に戻す
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
