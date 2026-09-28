/** Pure view logic for the Files tile: filtering, sorting and formatting of entries (unit-tested). */
import type { DirEntry } from '@shared/apiTypes'

export type SortKey = 'name' | 'ext' | 'modified' | 'created' | 'size'
export type ColumnKey = 'mode' | 'size' | 'modified' | 'created'

export interface FileViewOptions {
  showHidden: boolean
  sortKey: SortKey
  sortDesc: boolean
  columns: Record<ColumnKey, boolean>
}

/** Like `ls -l` / PowerShell `ls`: mode, size and modification time are shown by default. */
export const DEFAULT_VIEW: FileViewOptions = {
  showHidden: false,
  sortKey: 'name',
  sortDesc: false,
  columns: { mode: true, size: true, modified: true, created: false }
}

export const SORT_LABELS: Record<SortKey, string> = {
  name: '名前',
  ext: '種類（拡張子）',
  modified: '更新日時',
  created: '作成日時',
  size: 'サイズ'
}

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  mode: 'モード',
  size: 'サイズ',
  modified: '更新日時',
  created: '作成日時'
}

/** Approximate on-screen width (px) of each column, including the gap before it. */
const COLUMN_PX: Record<ColumnKey, number> = { mode: 92, size: 60, modified: 132, created: 132 }
/** The name column never gets narrower than this; columns are dropped instead. */
export const MIN_NAME_PX = 150
/** Least important first: which chosen columns give way when the tree is narrow. */
const DROP_ORDER: ColumnKey[] = ['created', 'modified', 'mode', 'size']

/** The chosen columns that fit in `width` px next to the name, dropping the least important first. */
export function fitColumns(columns: Record<ColumnKey, boolean>, width: number): Record<ColumnKey, boolean> {
  const fitted = { ...columns }
  const used = (): number =>
    MIN_NAME_PX + (Object.keys(fitted) as ColumnKey[]).reduce((sum, key) => sum + (fitted[key] ? COLUMN_PX[key] : 0), 0)
  for (const key of DROP_ORDER) {
    if (used() <= width) break
    fitted[key] = false
  }
  return fitted
}

/** Saved options merged over the defaults (tolerates older / partial saved configs). */
export function resolveView(saved: Partial<FileViewOptions> | undefined): FileViewOptions {
  return { ...DEFAULT_VIEW, ...saved, columns: { ...DEFAULT_VIEW.columns, ...saved?.columns } }
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** Hidden entries dropped unless shown; folders first, then by the chosen key (name breaks ties). */
export function arrangeEntries(entries: DirEntry[], view: FileViewOptions): DirEntry[] {
  const visible = view.showHidden ? entries : entries.filter((e) => !e.hidden)
  const byName = (a: DirEntry, b: DirEntry): number => a.name.localeCompare(b.name, undefined, { numeric: true })
  const compare = (a: DirEntry, b: DirEntry): number => {
    switch (view.sortKey) {
      case 'ext':
        return extension(a.name).localeCompare(extension(b.name)) || byName(a, b)
      case 'modified':
        return a.modifiedAt - b.modifiedAt || byName(a, b)
      case 'created':
        return a.createdAt - b.createdAt || byName(a, b)
      case 'size':
        return a.sizeBytes - b.sizeBytes || byName(a, b)
      default:
        return byName(a, b)
    }
  }
  return visible.slice().sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    const result = compare(a, b)
    return view.sortDesc ? -result : result
  })
}

/** "2026-09-28 07:20", like `ls -l --time-style=long-iso`. */
export function formatTimestamp(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** `ls -lh`-style size; folders show nothing. */
export function formatSize(entry: Pick<DirEntry, 'isDirectory' | 'sizeBytes'>): string {
  if (entry.isDirectory) return ''
  const units = ['B', 'K', 'M', 'G', 'T']
  let value = entry.sizeBytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return unit === 0 ? `${value}` : `${value < 10 ? value.toFixed(1) : value.toFixed(0)}${units[unit]}`
}

/** Where "new folder / new file" goes: the selected folder, else the selected file's folder, else the root. */
export function creationTarget(selected: DirEntry | null, rootPath: string): string {
  if (!selected) return rootPath
  if (selected.isDirectory) return selected.path
  const cut = Math.max(selected.path.lastIndexOf('/'), selected.path.lastIndexOf('\\'))
  return cut > 0 ? selected.path.slice(0, cut) : rootPath
}
