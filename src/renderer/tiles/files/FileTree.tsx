import { createContext, useContext, useEffect, useState } from 'react'
import type { DirEntry } from '@shared/apiTypes'
import { Icon } from '../../ui/Icon'
import {
  COLUMN_LABELS,
  arrangeEntries,
  formatSize,
  formatTimestamp,
  type ColumnKey,
  type FileViewOptions
} from './fileView'

interface FilesContextValue {
  view: FileViewOptions
  /** Expanded folder paths, persisted in the tile config so the tree survives remounts and restarts. */
  expanded: ReadonlySet<string>
  selectedPath: string | null
  /** Bumped per folder to make it re-list (after creating something in it). */
  refreshTokens: Record<string, number>
  onToggle: (path: string, expand: boolean) => void
  onSelect: (entry: DirEntry) => void
  onOpenTerminalHere: (path: string) => void
}

export const FilesContext = createContext<FilesContextValue | null>(null)

function Columns({ entry }: { entry: DirEntry }): React.JSX.Element {
  const { view } = useContext(FilesContext)!
  return (
    <>
      {view.columns.mode && <span className="bt-file-row__col bt-file-row__col--mode">{entry.mode}</span>}
      {view.columns.size && <span className="bt-file-row__col bt-file-row__col--size">{formatSize(entry)}</span>}
      {view.columns.modified && <span className="bt-file-row__col bt-file-row__col--time">{formatTimestamp(entry.modifiedAt)}</span>}
      {view.columns.created && <span className="bt-file-row__col bt-file-row__col--time">{formatTimestamp(entry.createdAt)}</span>}
    </>
  )
}

export function TreeNode({ entry, depth }: { entry: DirEntry; depth: number }): React.JSX.Element {
  const ctx = useContext(FilesContext)!
  const isExpanded = entry.isDirectory && ctx.expanded.has(entry.path)
  const token = ctx.refreshTokens[entry.path] ?? 0
  const [children, setChildren] = useState<DirEntry[] | null>(null)
  const [loadedToken, setLoadedToken] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  // (Re)load children whenever the folder is expanded and hasn't been listed at the current token.
  useEffect(() => {
    if (!isExpanded || loadedToken === token) return
    let cancelled = false
    setLoading(true)
    window.api.fs
      .listDir(entry.path)
      .then((list) => !cancelled && setChildren(list))
      .catch(() => !cancelled && setChildren([]))
      .finally(() => {
        if (cancelled) return
        setLoading(false)
        setLoadedToken(token)
      })
    return () => {
      cancelled = true
    }
  }, [isExpanded, token, loadedToken, entry.path])

  const onClick = (): void => {
    if (entry.isDirectory) ctx.onToggle(entry.path, !isExpanded)
    ctx.onSelect(entry)
  }

  const selected = ctx.selectedPath === entry.path
  return (
    <div>
      <div
        className={`bt-file-row${selected ? ' bt-file-row--selected' : ''}${entry.hidden ? ' bt-file-row--hidden' : ''}`}
        onClick={onClick}
        onContextMenu={(e) => {
          e.preventDefault()
          if (entry.isDirectory) ctx.onOpenTerminalHere(entry.path)
        }}
        title={entry.isDirectory ? 'クリックで展開・右クリックでここでターミナルを開く' : entry.path}
      >
        <span className="bt-file-row__label" style={{ paddingLeft: depth * 14 }}>
          <Icon name={entry.isDirectory ? (isExpanded ? 'folder-open' : 'folder') : 'file'} size={14} />
          <span className="bt-file-row__name">{entry.name}</span>
          {loading && <span className="bt-file-row__loading">…</span>}
        </span>
        <Columns entry={entry} />
      </div>
      {isExpanded &&
        children &&
        arrangeEntries(children, ctx.view).map((child) => <TreeNode key={child.path} entry={child} depth={depth + 1} />)}
    </div>
  )
}

export function ColumnHeader({ view }: { view: FileViewOptions }): React.JSX.Element {
  return (
    <div className="bt-files__colheader">
      <span className="bt-file-row__label">名前</span>
      {(Object.keys(COLUMN_LABELS) as ColumnKey[])
        .filter((key) => view.columns[key])
        .map((key) => (
          <span
            key={key}
            className={`bt-file-row__col bt-file-row__col--${key === 'modified' || key === 'created' ? 'time' : key}`}
          >
            {COLUMN_LABELS[key]}
          </span>
        ))}
    </div>
  )
}
