import { describe, expect, it } from 'vitest'
import { formatPosixMode, formatWinMode, parseWinAttrListing, validateNewName } from './fsService'

describe('mode strings', () => {
  it('formats POSIX permissions like ls -l', () => {
    expect(formatPosixMode(0o755, 'dir')).toBe('drwxr-xr-x')
    expect(formatPosixMode(0o644, 'file')).toBe('-rw-r--r--')
    expect(formatPosixMode(0o777, 'link')).toBe('lrwxrwxrwx')
  })

  it('formats Windows attributes like PowerShell Mode', () => {
    expect(formatWinMode(true, new Set())).toBe('d----')
    expect(formatWinMode(false, new Set(['a']))).toBe('-a---')
    expect(formatWinMode(true, new Set(['r', 'h', 's']))).toBe('d-rhs')
    expect(formatWinMode(true, new Set(['h', 's', 'l']))).toBe('l--hs')
  })
})

describe('parseWinAttrListing', () => {
  it('collects each name under every attribute section it appears in', () => {
    const out = 'notes.txt\r\nNTUSER.DAT\r\n::r\r\nDocuments\r\n::h\r\nAppData\r\nNTUSER.DAT\r\n::s\r\nNTUSER.DAT\r\n::l\r\n'
    const map = parseWinAttrListing(out)
    expect([...map.get('notes.txt')!]).toEqual(['a'])
    expect([...map.get('NTUSER.DAT')!].sort()).toEqual(['a', 'h', 's'])
    expect([...map.get('Documents')!]).toEqual(['r'])
    expect([...map.get('AppData')!]).toEqual(['h'])
  })
})

describe('validateNewName', () => {
  it('accepts a plain name and rejects paths and reserved characters', () => {
    expect(validateNewName('メモ.txt')).toBeNull()
    expect(validateNewName('  ')).not.toBeNull()
    expect(validateNewName('..')).not.toBeNull()
    expect(validateNewName('a/b')).not.toBeNull()
    expect(validateNewName('a\b')).not.toBeNull()
    expect(validateNewName('what?')).not.toBeNull()
  })
})
