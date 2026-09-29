import { describe, expect, it } from 'vitest'
import { handleId } from './handleUtil'

describe('handleId', () => {
  it('extracts .id from a BrightermFolderHandle object (the shape fs.pickFolder actually returns)', () => {
    expect(handleId({ id: 'folder-abc', label: 'My Folder' })).toBe('folder-abc')
  })

  it('passes through a bare string unchanged', () => {
    expect(handleId('folder-abc')).toBe('folder-abc')
  })

  it('throws for null/undefined instead of silently coercing to "[object Object]" (regression)', () => {
    expect(() => handleId(null)).toThrow(/フォルダの指定が正しくありません/)
    expect(() => handleId(undefined)).toThrow(/フォルダの指定が正しくありません/)
  })

  it('throws for an object with no id field', () => {
    expect(() => handleId({ label: 'no id here' })).toThrow(/フォルダの指定が正しくありません/)
  })

  it('coerces a non-string id field to a string', () => {
    expect(handleId({ id: 123 })).toBe('123')
  })
})
