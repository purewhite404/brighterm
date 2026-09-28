import { useEffect } from 'react'
import type { DirEntry, FileInspection } from '@shared/apiTypes'
import { Icon } from '../../ui/Icon'
import { EmbeddedWebView } from '../shared/EmbeddedWebView'
import { sidePaneId } from '../shared/subViews'
import { formatSize, formatTimestamp } from './fileView'

/** PDF / video / audio: rendered by Chromium in a side pane of this tile (a sub web view). */
function MediaPreview({ viewId, url }: { viewId: string; url: string }): React.JSX.Element {
  useEffect(() => {
    // One view serves every preview and create() re-shows it as it was, so load this file
    // unless it's already showing it (runs after create — the child's effects run first,
    // and IPC calls arrive in order).
    void window.api.tile.navigate(viewId, url, true)
  }, [viewId, url])
  // Leaving the preview (another file selected, tile hidden) only hides the view, which would
  // keep audio/video playing — blank it so playback stops.
  useEffect(() => () => void window.api.tile.navigate(viewId, 'about:blank', true), [viewId])
  return <EmbeddedWebView viewId={viewId} source={{ url, partitionId: 'files-preview' }} className="bt-files__media" />
}

export function FilePreview({
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
    body = <MediaPreview viewId={sidePaneId(tileId, 'preview')} url={inspection.fileUrl} />
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
