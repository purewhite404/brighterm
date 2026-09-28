import { describe, expect, it } from 'vitest'
import type { DirEntry } from '../../../main/fsService'
import { DEFAULT_VIEW, arrangeEntries, creationTarget, fitColumns, formatSize, formatTimestamp, resolveView } from './fileView'

const entry = (name: string, over: Partial<DirEntry> = {}): DirEntry => ({
  name,
  path: `C:\\root\\${name}`,
  isDirectory: false,
  sizeBytes: 0,
  modifiedAt: 0,
  createdAt: 0,
  hidden: name.startsWith('.'),
  mode: '-a---',
  ...over
})

describe('arrangeEntries', () => {
  const list = [
    entry('b.txt', { sizeBytes: 10, modifiedAt: 3 }),
    entry('.env', { sizeBytes: 5 }),
    entry('AppData', { isDirectory: true, hidden: true }),
    entry('src', { isDirectory: true }),
    entry('a.md', { sizeBytes: 99, modifiedAt: 1 }),
    entry('file10.log', { modifiedAt: 2 }),
    entry('file2.log', { modifiedAt: 2 })
  ]
  const names = (view = DEFAULT_VIEW) => arrangeEntries(list, view).map((e) => e.name)

  it('hides dot files and Windows-hidden entries by default, folders first', () => {
    expect(names()).toEqual(['src', 'a.md', 'b.txt', 'file2.log', 'file10.log'])
  })

  it('shows hidden entries when asked', () => {
    expect(names({ ...DEFAULT_VIEW, showHidden: true })).toEqual(['AppData', 'src', '.env', 'a.md', 'b.txt', 'file2.log', 'file10.log'])
  })

  it('sorts by size, date or extension, ascending or descending, folders still first', () => {
    expect(names({ ...DEFAULT_VIEW, sortKey: 'size', sortDesc: true })).toEqual(['src', 'a.md', 'b.txt', 'file10.log', 'file2.log'])
    expect(names({ ...DEFAULT_VIEW, sortKey: 'modified' })).toEqual(['src', 'a.md', 'file2.log', 'file10.log', 'b.txt'])
    expect(names({ ...DEFAULT_VIEW, sortKey: 'ext' })).toEqual(['src', 'file2.log', 'file10.log', 'a.md', 'b.txt'])
  })
})

describe('formatting', () => {
  it('formats sizes like ls -lh and leaves folders blank', () => {
    expect(formatSize({ isDirectory: false, sizeBytes: 812 })).toBe('812')
    expect(formatSize({ isDirectory: false, sizeBytes: 4300 })).toBe('4.2K')
    expect(formatSize({ isDirectory: false, sizeBytes: 250 * 1024 * 1024 })).toBe('250M')
    expect(formatSize({ isDirectory: true, sizeBytes: 4096 })).toBe('')
  })

  it('formats timestamps as local YYYY-MM-DD HH:mm', () => {
    expect(formatTimestamp(new Date(2026, 8, 28, 7, 5).getTime())).toBe('2026-09-28 07:05')
    expect(formatTimestamp(0)).toBe('')
  })
})

describe('resolveView / creationTarget', () => {
  it('fills missing saved options from the defaults', () => {
    expect(resolveView({ showHidden: true, columns: { created: true } as never })).toEqual({
      ...DEFAULT_VIEW,
      showHidden: true,
      columns: { ...DEFAULT_VIEW.columns, created: true }
    })
  })

  it('creates in the selected folder, the selected file\'s folder, or the root', () => {
    expect(creationTarget(null, 'C:\\root')).toBe('C:\\root')
    expect(creationTarget(entry('src', { isDirectory: true }), 'C:\\root')).toBe('C:\\root\\src')
    expect(creationTarget(entry('a.md'), 'C:\\x')).toBe('C:\\root')
    expect(creationTarget({ ...entry('a.md'), path: '/home/me/notes/a.md' }, '/home/me')).toBe('/home/me/notes')
  })
})

describe('fitColumns', () => {
  const all = { mode: true, size: true, modified: true, created: true }
  it('keeps every chosen column when there is room', () => {
    expect(fitColumns(DEFAULT_VIEW.columns, 900)).toEqual(DEFAULT_VIEW.columns)
  })
  it('drops the least important columns first as the tree narrows, keeping the name readable', () => {
    expect(fitColumns(all, 520)).toEqual({ mode: true, size: true, modified: true, created: false })
    expect(fitColumns(DEFAULT_VIEW.columns, 290)).toEqual({ mode: false, size: true, modified: false, created: false })
    expect(fitColumns(DEFAULT_VIEW.columns, 180)).toEqual({ mode: false, size: false, modified: false, created: false })
  })
})
