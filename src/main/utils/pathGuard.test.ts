import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isInside } from './pathGuard'

describe('isInside (Windows paths)', () => {
  const w = path.win32
  const root = 'C:\\Users\\me\\Notes'
  const inside = (p: string): boolean => isInside(root, w.resolve(root, p), w)

  it('accepts the folder itself and anything below it', () => {
    expect(inside('')).toBe(true)
    expect(inside('a.md')).toBe(true)
    expect(inside('sub\\deeper\\b.md')).toBe(true)
    expect(inside('sub/../c.md')).toBe(true)
    expect(inside('..notes.md')).toBe(true) // a name that merely starts with dots
  })

  it('rejects going up', () => {
    expect(inside('..')).toBe(false)
    expect(inside('..\\secret.txt')).toBe(false)
    expect(inside('sub\\..\\..\\x')).toBe(false)
    expect(inside('C:\\Windows\\win.ini')).toBe(false)
  })

  it('rejects another drive, UNC shares and device paths (path.relative returns them absolute)', () => {
    expect(inside('D:\\secret.txt')).toBe(false)
    expect(inside('D:secret.txt')).toBe(false)
    expect(inside('\\\\attacker\\share\\x')).toBe(false)
    expect(inside('//attacker/share/x')).toBe(false)
    expect(inside('\\\\.\\PhysicalDrive0')).toBe(false)
    expect(inside('\\\\?\\C:\\Windows\\win.ini')).toBe(false)
  })

  it('compares case-insensitively like Windows does', () => {
    expect(isInside(root, 'c:\\users\\ME\\notes\\a.md', w)).toBe(true)
  })
})

describe('isInside (POSIX paths)', () => {
  const p = path.posix
  const root = '/home/me/notes'
  it('accepts below, rejects above and absolute elsewhere', () => {
    expect(isInside(root, p.resolve(root, 'a/b.md'), p)).toBe(true)
    expect(isInside(root, p.resolve(root, '../x'), p)).toBe(false)
    expect(isInside(root, p.resolve(root, '/etc/passwd'), p)).toBe(false)
    expect(isInside(root, '/home/me/notes-other/x', p)).toBe(false)
  })
})
