import { describe, expect, it } from 'vitest'
import { matchesPrefix, normalizeFolderInput, samePath, suggestionQuery, withTrailingSeparator } from './folderInput'

const WIN_HOME = 'C:\\Users\\satoshi'
const NIX_HOME = '/home/satoshi'

describe('normalizeFolderInput', () => {
  it('takes a plain Windows path, trimming spaces and trailing separators', () => {
    expect(normalizeFolderInput('  C:\\Users\\satoshi\\Documents\\  ', WIN_HOME, 'win32')).toBe('C:\\Users\\satoshi\\Documents')
    expect(normalizeFolderInput('C:/Users/satoshi/メモ', WIN_HOME, 'win32')).toBe('C:\\Users\\satoshi\\メモ')
  })

  it('drops the quotes of Explorer\'s "パスのコピー"', () => {
    expect(normalizeFolderInput('"C:\\Users\\satoshi\\My Notes"', WIN_HOME, 'win32')).toBe('C:\\Users\\satoshi\\My Notes')
    expect(normalizeFolderInput("'/home/satoshi/My Notes'", NIX_HOME, 'linux')).toBe('/home/satoshi/My Notes')
  })

  it('expands ~ to the home folder', () => {
    expect(normalizeFolderInput('~', WIN_HOME, 'win32')).toBe(WIN_HOME)
    expect(normalizeFolderInput('~\\Documents', WIN_HOME, 'win32')).toBe('C:\\Users\\satoshi\\Documents')
    expect(normalizeFolderInput('~/notes/', NIX_HOME, 'linux')).toBe('/home/satoshi/notes')
  })

  it('makes a bare drive its root, and keeps roots and UNC shares', () => {
    expect(normalizeFolderInput('D:', WIN_HOME, 'win32')).toBe('D:\\')
    expect(normalizeFolderInput('D:\\', WIN_HOME, 'win32')).toBe('D:\\')
    expect(normalizeFolderInput('\\\\nas\\share\\notes', WIN_HOME, 'win32')).toBe('\\\\nas\\share\\notes')
    expect(normalizeFolderInput('/', NIX_HOME, 'linux')).toBe('/')
  })

  it('resolves . and .. segments', () => {
    expect(normalizeFolderInput('/home/satoshi/a/../b/.', NIX_HOME, 'linux')).toBe('/home/satoshi/b')
  })

  it('rejects empty input and relative paths with a Japanese hint', () => {
    expect(() => normalizeFolderInput('   ', WIN_HOME, 'win32')).toThrow('フォルダのパスを入力してください')
    expect(() => normalizeFolderInput('Documents', WIN_HOME, 'win32')).toThrow(/C:\\Users\\名前\\Documents/)
    expect(() => normalizeFolderInput('\\Documents', WIN_HOME, 'win32')).toThrow(/先頭からのパス/)
    expect(() => normalizeFolderInput('notes', NIX_HOME, 'linux')).toThrow(/\/home\/名前\/Documents/)
  })
})

describe('suggestionQuery', () => {
  it('looks inside a folder typed with a trailing separator', () => {
    expect(suggestionQuery('C:\\Users\\', WIN_HOME, 'win32')).toEqual({ dir: 'C:\\Users', prefix: '' })
    expect(suggestionQuery('/home/', NIX_HOME, 'linux')).toEqual({ dir: '/home', prefix: '' })
    expect(suggestionQuery('C:', WIN_HOME, 'win32')).toEqual({ dir: 'C:\\', prefix: '' })
  })

  it('completes the last, partly typed name', () => {
    expect(suggestionQuery('C:\\Users\\satoshi\\Doc', WIN_HOME, 'win32')).toEqual({ dir: WIN_HOME, prefix: 'Doc' })
    expect(suggestionQuery('~/no', NIX_HOME, 'linux')).toEqual({ dir: NIX_HOME, prefix: 'no' })
  })

  it('lists the home folder for a bare ~', () => {
    expect(suggestionQuery('~', NIX_HOME, 'linux')).toEqual({ dir: NIX_HOME, prefix: '' })
  })

  it('has nothing to suggest for something that is not a path yet', () => {
    expect(suggestionQuery('', WIN_HOME, 'win32')).toBeNull()
    expect(suggestionQuery('Docu', WIN_HOME, 'win32')).toBeNull()
  })
})

describe('matchesPrefix', () => {
  it('ignores case on Windows and macOS, not on Linux', () => {
    expect(matchesPrefix('Documents', 'doc', 'win32')).toBe(true)
    expect(matchesPrefix('Documents', 'doc', 'darwin')).toBe(true)
    expect(matchesPrefix('Documents', 'doc', 'linux')).toBe(false)
    expect(matchesPrefix('Documents', 'Doc', 'linux')).toBe(true)
  })

  it('offers dot folders only when a dot was typed', () => {
    expect(matchesPrefix('.config', '', 'linux')).toBe(false)
    expect(matchesPrefix('.config', '.c', 'linux')).toBe(true)
  })
})

describe('samePath / withTrailingSeparator', () => {
  it('compares paths the way the OS does', () => {
    expect(samePath('C:\\Users\\A', 'c:\\users\\a', 'win32')).toBe(true)
    expect(samePath('/home/A', '/home/a', 'linux')).toBe(false)
  })

  it('adds a single separator', () => {
    expect(withTrailingSeparator('C:\\Users', 'win32')).toBe('C:\\Users\\')
    expect(withTrailingSeparator('D:\\', 'win32')).toBe('D:\\')
    expect(withTrailingSeparator('/home', 'linux')).toBe('/home/')
  })
})
