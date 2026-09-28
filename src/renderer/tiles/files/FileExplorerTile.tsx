import { useEffect, useRef, useState } from 'react'
import type { DirEntry, FileInspection } from '../../../main/fsService'
import { useAppStore, selectActiveWorkspace } from '../../store/appStore'
import { Icon } from '../../ui/Icon'
import { builtinTile } from '../catalog'
import type { OpenFileRequest } from '../plugin/PluginFrame'
import { useTileConfig } from '../shared/useTileConfig'
import { creationTarget, fitColumns, resolveView, type FileViewOptions } from './fileView'
import { ColumnHeader, FilesContext, TreeNode } from './FileTree'
import { FilesSettingsPanel } from './FilesSettingsPanel'
import { FilePreview } from './FilePreview'

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

export function FileExplorerTile({ tileId }: { tileId: string }): React.JSX.Element {
  const [config, updateConfig] = useTileConfig<{
    rootPath: string
    expandedPaths: string[]
    view: Partial<FileViewOptions>
  }>(tileId)
  const workspace = useAppStore((s) => selectActiveWorkspace(s))
  const addTile = useAppStore((s) => s.addTile)
  const updateTileConfig = useAppStore((s) => s.updateTileConfig)
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

  const setView = (next: FileViewOptions): void => updateConfig({ view: next })

  const onToggle = (path: string, expand: boolean): void => {
    const next = new Set(expanded)
    if (expand) next.add(path)
    else next.delete(path)
    setExpanded(next)
    updateConfig({ expandedPaths: [...next] })
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
    addTile(builtinTile('terminal', { cwd: path }))
  }

  if (!root) return <div className="bt-tile-body bt-tile-body--centered">読み込み中…</div>

  const previewIsText = inspection && (inspection.kind === 'text' || inspection.kind === 'empty')
  // Text files go to Notes; the side panel only previews everything else.
  const showPreview = previewEntry !== null && !(previewIsText && notesAvailable)
  const wide = layout === 'wide'
  // What's actually drawn: the chosen columns that fit beside the name (the saved choice is untouched).
  const shownView = mainWidth > 0 ? { ...view, columns: fitColumns(view.columns, mainWidth - 40) } : view
  const settings = (
    <FilesSettingsPanel view={view} onChange={setView} target={creationTarget(selected, root.path)} onCreate={onCreate} />
  )
  const preview =
    showPreview && previewEntry ? (
      <FilePreview
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
