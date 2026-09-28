import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { DirEntry, FileInspection } from '../../main/fsService'
import { useAppStore, selectActiveWorkspace } from '../store/appStore'
import { Icon } from '../ui/Icon'
import { useEmbeddedWebView } from './useEmbeddedWebView'
import type { OpenFileRequest } from './PluginFrame'
import {
  COLUMN_LABELS,
  SORT_LABELS,
  arrangeEntries,
  creationTarget,
  formatSize,
  fitColumns,
  formatTimestamp,
  resolveView,
  type ColumnKey,
  type FileViewOptions,
  type SortKey
} from './fileView'

/**
 * How the tile is laid out, by its width:
 * - wide:  tree | side panel (settings + preview), always shown
 * - split: tree | preview (only while previewing); settings in a popover
 * - stack: tree above preview; settings in a popover
 */
type FilesLayout = 'wide' | 'split' | 'stack'
const WIDE_PX = 760
const SPLIT_PX = 420

function layoutFor(width: number, height: number): FilesLayout {
  if (width >= WIDE_PX) return 'wide'
  // Preview below the tree only when the tile is both narrow and tall enough for it.
  return width < SPLIT_PX && height > width ? 'stack' : 'split'
}
const NOTES_PLUGIN_ID = 'notes'

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

const FilesContext = createContext<FilesContextValue | null>(null)

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

function TreeNode({ entry, depth }: { entry: DirEntry; depth: number }): React.JSX.Element {
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

function ColumnHeader({ view }: { view: FileViewOptions }): React.JSX.Element {
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

function SettingsPanel({
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

/** PDF / video / audio: rendered by Chromium in a sub web view of this tile ("<tileId>::preview"). */
function MediaPreview({ viewId, url }: { viewId: string; url: string }): React.JSX.Element {
  const snapshot = useAppStore((s) => s.runtime[viewId]?.snapshot)
  const ref = useEmbeddedWebView(viewId, { url, partitionId: 'files-preview' })
  useEffect(() => {
    // One view serves every preview and create() re-shows it as it was, so load this file
    // unless it's already showing it (runs after create — IPC calls arrive in order).
    void window.api.tile.navigate(viewId, url, true)
  }, [viewId, url])
  // Leaving the preview (another file selected, tile hidden) only hides the view, which would
  // keep audio/video playing — blank it so playback stops.
  useEffect(() => () => void window.api.tile.navigate(viewId, 'about:blank', true), [viewId])
  return (
    <div ref={ref} className="bt-web-tile bt-files__media">
      {snapshot && <img src={snapshot} alt="" className="bt-web-tile__snapshot" draggable={false} />}
    </div>
  )
}

function Preview({
  tileId,
  entry,
  inspection,
  error,
  onOpenInNotes,
  onClose,
  compact = false
}: {
  tileId: string
  entry: DirEntry
  inspection: FileInspection | null
  error: string | null
  onOpenInNotes: (() => void) | null
  onClose?: () => void
  /** Small tiles: actions as icon buttons in the title row, so the content keeps the space. */
  compact?: boolean
}): React.JSX.Element {
  let body: React.JSX.Element
  if (error) body = <div className="bt-files__preview-empty">読み込めませんでした: {error}</div>
  else if (!inspection) body = <div className="bt-files__preview-empty">読み込み中…</div>
  else if (inspection.kind === 'image' && inspection.dataUrl)
    body = (
      <div className="bt-files__image-wrap">
        <img className="bt-files__image" src={inspection.dataUrl} alt={entry.name} />
      </div>
    )
  else if (inspection.kind === 'pdf' || inspection.kind === 'video' || inspection.kind === 'audio')
    body = <MediaPreview viewId={`${tileId}::preview`} url={inspection.fileUrl} />
  else if (inspection.text !== undefined)
    body = (
      <pre className="bt-files__code">
        {inspection.text}
        {inspection.truncated ? '\n…（先頭のみ表示）' : ''}
      </pre>
    )
  else body = <div className="bt-files__preview-empty">このファイルはプレビューできません</div>

  return (
    <div className="bt-files__preview" aria-label="プレビュー">
      <div className="bt-files__preview-head">
        <div className="bt-files__preview-title">
          <div className="bt-files__preview-name" title={entry.path}>
            {entry.name}
          </div>
          {compact && (
            <>
              {onOpenInNotes && (
                <button className="bt-files__icon-button" title="Notes で開く" aria-label="Notes で開く" onClick={onOpenInNotes}>
                  <Icon name="note" size={13} />
                </button>
              )}
              <button
                className="bt-files__icon-button"
                title="既定のアプリで開く"
                aria-label="既定のアプリで開く"
                onClick={() => void window.api.shells.openPath(entry.path)}
              >
                <Icon name="arrow-right" size={13} />
              </button>
              <button
                className="bt-files__icon-button"
                title="フォルダを表示"
                aria-label="フォルダを表示"
                onClick={() => void window.api.shells.showItem(entry.path)}
              >
                <Icon name="folder-open" size={13} />
              </button>
            </>
          )}
          {onClose && (
            <button className="bt-files__icon-button" title="プレビューを閉じる" aria-label="プレビューを閉じる" onClick={onClose}>
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
        <div className="bt-files__preview-meta">
          {inspection?.description ?? ''}
          {entry.isDirectory ? '' : ` · ${formatSize(entry) || '0'}B · ${formatTimestamp(entry.modifiedAt)}`}
        </div>
        {!compact && (
        <div className="bt-files__preview-actions">
          {onOpenInNotes && (
            <button onClick={onOpenInNotes}>
              <Icon name="note" size={13} /> Notes で開く
            </button>
          )}
          <button onClick={() => void window.api.shells.openPath(entry.path)}>既定のアプリで開く</button>
          <button onClick={() => void window.api.shells.showItem(entry.path)}>フォルダを表示</button>
        </div>
        )}
      </div>
      {body}
    </div>
  )
}

export function FileExplorerTile({ tileId }: { tileId: string }): React.JSX.Element {
  const tile = useAppStore((s) => selectActiveWorkspace(s)?.tiles[tileId])
  const workspace = useAppStore((s) => selectActiveWorkspace(s))
  const addTile = useAppStore((s) => s.addTile)
  const updateTileConfig = useAppStore((s) => s.updateTileConfig)
  const config = (tile?.config ?? {}) as {
    rootPath?: string
    expandedPaths?: string[]
    view?: Partial<FileViewOptions>
  }
  const view = resolveView(config.view)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const mainRef = useRef<HTMLDivElement | null>(null)
  const [mainWidth, setMainWidth] = useState(0)
  const [layout, setLayout] = useState<FilesLayout>('wide')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [root, setRoot] = useState<DirEntry | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(config.expandedPaths ?? []))
  const [selected, setSelected] = useState<DirEntry | null>(null)
  const [previewEntry, setPreviewEntry] = useState<DirEntry | null>(null)
  const [inspection, setInspection] = useState<FileInspection | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [refreshTokens, setRefreshTokens] = useState<Record<string, number>>({})
  const [notesAvailable, setNotesAvailable] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function init(): Promise<void> {
      const rootPath = config.rootPath ?? (await window.api.fs.homeDir())
      const entry = await window.api.fs.statEntry(rootPath).catch(
        (): DirEntry => ({
          name: rootPath,
          path: rootPath,
          isDirectory: true,
          sizeBytes: 0,
          modifiedAt: 0,
          createdAt: 0,
          hidden: false,
          mode: ''
        })
      )
      if (!cancelled) setRoot({ ...entry, name: rootPath, isDirectory: true })
    }
    void init()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const refresh = (): void =>
      void window.api.plugins
        .list()
        .then((list) => setNotesAvailable(list.some((p) => p.manifest.id === NOTES_PLUGIN_ID && p.enabled)))
    refresh()
    return window.api.plugins.onChanged(refresh)
  }, [])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setLayout(layoutFor(el.clientWidth, el.clientHeight)))
    observer.observe(el)
    const main = mainRef.current
    const mainObserver = new ResizeObserver(() => main && setMainWidth(main.clientWidth))
    if (main) mainObserver.observe(main)
    return () => {
      observer.disconnect()
      mainObserver.disconnect()
    }
  }, [root])

  const setView = (next: FileViewOptions): void => updateTileConfig(tileId, { view: next })

  const onToggle = (path: string, expand: boolean): void => {
    const next = new Set(expanded)
    if (expand) next.add(path)
    else next.delete(path)
    setExpanded(next)
    updateTileConfig(tileId, { expandedPaths: [...next] })
  }

  /** Text (notes, logs, config) is edited in Notes — reusing an open Notes tile, or adding one. */
  const openInNotes = (entry: DirEntry): void => {
    const cut = Math.max(entry.path.lastIndexOf('/'), entry.path.lastIndexOf('\\'))
    const request: OpenFileRequest = {
      folderPath: entry.path.slice(0, cut),
      name: entry.path.slice(cut + 1),
      nonce: Date.now()
    }
    const existing = Object.values(workspace?.tiles ?? {}).find(
      (t) => t.kind === 'plugin' && (t.config as { pluginId?: string } | undefined)?.pluginId === NOTES_PLUGIN_ID
    )
    if (existing) updateTileConfig(existing.id, { openRequest: request })
    else
      addTile({
        kind: 'plugin',
        typeId: NOTES_PLUGIN_ID,
        title: 'Notes',
        icon: 'note',
        config: { pluginKind: 'app', pluginId: NOTES_PLUGIN_ID, openRequest: request }
      })
  }

  const onSelect = (entry: DirEntry): void => {
    setSelected(entry)
    if (entry.isDirectory) return
    setPreviewEntry(entry)
    setInspection(null)
    setPreviewError(null)
    window.api.fs
      .inspect(entry.path)
      .then((result) => {
        setInspection(result)
        // Plain text is for editing, not previewing (the type comes from the contents, not the extension).
        if ((result.kind === 'text' || result.kind === 'empty') && notesAvailable) openInNotes(entry)
      })
      .catch((err) => setPreviewError(err instanceof Error ? err.message : String(err)))
  }

  const onCreate = async (name: string, kind: 'dir' | 'file'): Promise<string | null> => {
    const parent = creationTarget(selected, root?.path ?? '')
    try {
      await window.api.fs.create(parent, name, kind)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return /EEXIST/.test(message) ? '同じ名前がすでにあります' : message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    }
    setRefreshTokens((prev) => ({ ...prev, [parent]: (prev[parent] ?? 0) + 1 }))
    if (!expanded.has(parent)) onToggle(parent, true)
    return null
  }

  const openTerminalHere = (path: string): void => {
    addTile({ kind: 'builtin', typeId: 'terminal', title: 'Terminal', icon: 'terminal', config: { cwd: path } })
  }

  if (!root) return <div className="bt-tile-body bt-tile-body--centered">読み込み中…</div>

  const previewIsText = inspection && (inspection.kind === 'text' || inspection.kind === 'empty')
  // Text files go to Notes; the side panel only previews everything else.
  const showPreview = previewEntry !== null && !(previewIsText && notesAvailable)
  const wide = layout === 'wide'
  // What's actually drawn: the chosen columns that fit beside the name (the saved choice is untouched).
  const shownView = mainWidth > 0 ? { ...view, columns: fitColumns(view.columns, mainWidth - 40) } : view
  const settings = (
    <SettingsPanel view={view} onChange={setView} target={creationTarget(selected, root.path)} onCreate={onCreate} />
  )
  const preview =
    showPreview && previewEntry ? (
      <Preview
        tileId={tileId}
        entry={previewEntry}
        inspection={inspection}
        error={previewError}
        onOpenInNotes={previewIsText ? () => openInNotes(previewEntry) : null}
        onClose={wide ? undefined : () => setPreviewEntry(null)}
        compact={!wide}
      />
    ) : null

  return (
    <FilesContext.Provider
      value={{
        view: shownView,
        expanded,
        selectedPath: selected?.path ?? null,
        refreshTokens,
        onToggle,
        onSelect,
        onOpenTerminalHere: openTerminalHere
      }}
    >
      <div ref={rootRef} className={`bt-files bt-files--${layout}`}>
        <div ref={mainRef} className="bt-files__main">
          <div className="bt-files__header">
            <ColumnHeader view={shownView} />
            {!wide && (
              <button
                className="bt-files__gear"
                title="設定"
                aria-label="Files の設定を開く"
                aria-pressed={settingsOpen}
                onClick={() => setSettingsOpen((o) => !o)}
              >
                <Icon name="settings" size={14} />
              </button>
            )}
          </div>
          <div className="bt-files__tree bt-file-explorer">
            <TreeNode entry={root} depth={0} />
          </div>
        </div>
        {wide ? (
          <div className="bt-files__side">
            {settings}
            {preview ?? <div className="bt-files__preview-empty">ファイルをクリックするとここにプレビューを表示します</div>}
          </div>
        ) : (
          preview && <div className="bt-files__side">{preview}</div>
        )}
        {!wide && settingsOpen && (
          <div className="bt-files__popover">
            <button className="bt-files__icon-button bt-files__popover-close" title="閉じる" onClick={() => setSettingsOpen(false)}>
              <Icon name="close" size={12} />
            </button>
            {settings}
          </div>
        )}
      </div>
    </FilesContext.Provider>
  )
}
