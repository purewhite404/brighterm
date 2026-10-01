import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { suggestFolders } from './folderSuggest'

describe('suggestFolders', () => {
  let root = ''
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    root = ''
  })

  function seed(): string {
    root = mkdtempSync(join(tmpdir(), 'brighterm-suggest-'))
    for (const name of ['Notes', 'notebooks', 'Photos', '.hidden']) mkdirSync(join(root, name))
    writeFileSync(join(root, 'Notes.txt'), 'a file, not a folder')
    return root
  }

  it('lists the subfolders of a folder typed with a trailing separator (no files, no dot folders)', () => {
    const dir = seed()
    expect(suggestFolders(dir + sep, '/unused')).toEqual(
      ['notebooks', 'Notes', 'Photos'].map((n) => join(dir, n) + sep)
    )
  })

  it('completes a partly typed name', () => {
    const dir = seed()
    const found = suggestFolders(join(dir, 'Not'), '/unused')
    expect(found).toContain(join(dir, 'Notes') + sep)
    expect(found).not.toContain(join(dir, 'Photos') + sep)
  })

  it('offers the home folder when nothing is typed, and nothing for an unreadable place', () => {
    const dir = seed()
    expect(suggestFolders('', dir)).toEqual([dir + sep])
    expect(suggestFolders(join(dir, 'no-such', 'x'), dir)).toEqual([])
    expect(suggestFolders('relative', dir)).toEqual([])
  })
})
