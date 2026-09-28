import { useState } from 'react'
import { Icon } from '../../ui/Icon'
import { COLUMN_LABELS, SORT_LABELS, type ColumnKey, type FileViewOptions, type SortKey } from './fileView'

/** Show hidden files, sort order, which columns to show, and creating a folder / an empty file. */
export function FilesSettingsPanel({
  view,
  onChange,
  target,
  onCreate
}: {
  view: FileViewOptions
  onChange: (next: FileViewOptions) => void
  target: string
  onCreate: (name: string, kind: 'dir' | 'file') => Promise<string | null>
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)

  const create = async (kind: 'dir' | 'file'): Promise<void> => {
    const error = await onCreate(name, kind)
    setMessage(error ? { error: true, text: error } : { error: false, text: `作成しました: ${name.trim()}` })
    if (!error) setName('')
  }

  return (
    <div className="bt-files__settings" aria-label="Files の設定">
      <label className="bt-files__check">
        <input
          type="checkbox"
          checked={view.showHidden}
          onChange={(e) => onChange({ ...view, showHidden: e.target.checked })}
        />
        隠しファイルを表示
      </label>

      <div className="bt-files__field">
        <span>並べ替え</span>
        <select
          aria-label="並べ替え"
          value={view.sortKey}
          onChange={(e) => onChange({ ...view, sortKey: e.target.value as SortKey })}
        >
          {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
        <select
          aria-label="並べ替えの向き"
          value={view.sortDesc ? 'desc' : 'asc'}
          onChange={(e) => onChange({ ...view, sortDesc: e.target.value === 'desc' })}
        >
          <option value="asc">昇順</option>
          <option value="desc">降順</option>
        </select>
      </div>

      <div className="bt-files__field bt-files__field--wrap">
        <span>表示する項目</span>
        {(Object.keys(COLUMN_LABELS) as ColumnKey[]).map((key) => (
          <label key={key} className="bt-files__check">
            <input
              type="checkbox"
              checked={view.columns[key]}
              onChange={(e) => onChange({ ...view, columns: { ...view.columns, [key]: e.target.checked } })}
            />
            {COLUMN_LABELS[key]}
          </label>
        ))}
      </div>

      <div className="bt-files__create">
        <div className="bt-files__create-target" title={target}>
          作成先: {target}
        </div>
        <div className="bt-files__field">
          <input
            aria-label="新しい名前"
            value={name}
            placeholder="名前"
            onChange={(e) => {
              setName(e.target.value)
              setMessage(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create('file')
            }}
          />
          <button onClick={() => void create('dir')} disabled={!name.trim()}>
            <Icon name="folder" size={13} /> フォルダ
          </button>
          <button onClick={() => void create('file')} disabled={!name.trim()}>
            <Icon name="file" size={13} /> 空ファイル
          </button>
        </div>
        {message && (
          <div className={message.error ? 'bt-files__message bt-files__message--error' : 'bt-files__message'}>{message.text}</div>
        )}
      </div>
    </div>
  )
}
