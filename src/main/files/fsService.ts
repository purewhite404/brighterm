import { closeSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import chokidar, { type FSWatcher } from 'chokidar'
import { sniffContent } from './fileSniff'
import type { DirEntry, FileInspection } from '@shared/apiTypes'

export function getHomeDir(): string {
  return homedir()
}

// ---------------------------------------------------------------------------
// Mode strings
// ---------------------------------------------------------------------------

/** "drwxr-xr-x" / "-rw-r--r--" / "lrwxrwxrwx" from a stat mode. */
export function formatPosixMode(mode: number, kind: 'file' | 'dir' | 'link'): string {
  const type = kind === 'dir' ? 'd' : kind === 'link' ? 'l' : '-'
  const bits = ['r', 'w', 'x']
  let perms = ''
  for (let shift = 6; shift >= 0; shift -= 3) {
    for (let i = 0; i < 3; i++) perms += mode & (1 << (shift + 2 - i)) ? bits[i] : '-'
  }
  return type + perms
}

/** Windows file attribute flags as used by `dir /a:<flag>`. */
export type WinAttr = 'a' | 'r' | 'h' | 's' | 'l'
const WIN_ATTRS: WinAttr[] = ['a', 'r', 'h', 's', 'l']

/** PowerShell's Mode column: d a r h s l, "-" where unset (e.g. "d----", "-a---", "la---"). */
export function formatWinMode(isDirectory: boolean, attrs: ReadonlySet<WinAttr>): string {
  if (attrs.has('l')) return 'l' + ['a', 'r', 'h', 's'].map((a) => (attrs.has(a as WinAttr) ? a : '-')).join('')
  return (isDirectory ? 'd' : '-') + ['a', 'r', 'h', 's'].map((a) => (attrs.has(a as WinAttr) ? a : '-')).join('')
}

/**
 * Parses the output of `dir /a:a /b & echo ::r & dir /a:r /b & ...` —
 * sections of bare names, each introduced by "::<flag>" (the first is 'a').
 */
export function parseWinAttrListing(output: string): Map<string, Set<WinAttr>> {
  const result = new Map<string, Set<WinAttr>>()
  let current: WinAttr = 'a'
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const marker = /^::([arhsl])$/.exec(line)
    if (marker) {
      current = marker[1] as WinAttr
      continue
    }
    const set = result.get(line) ?? new Set<WinAttr>()
    set.add(current)
    result.set(line, set)
  }
  return result
}

/**
 * Node can't read Windows attributes, so ask cmd's built-in `dir` (one
 * process for all flags). `/u` makes it write UTF-16, which keeps non-ASCII
 * names intact (the external `attrib` mangles them).
 */
function readWinAttributes(dirPath: string): Promise<Map<string, Set<WinAttr>>> {
  const quoted = `"${dirPath.replace(/"/g, '')}"`
  const script = WIN_ATTRS.map((flag, i) => `${i > 0 ? `echo ::${flag}& ` : ''}dir /a:${flag} /b ${quoted} 2>nul`).join(' & ')
  return new Promise((resolve) => {
    execFile(
      'cmd.exe',
      ['/u', '/d', '/s', '/c', `"${script}"`],
      { windowsVerbatimArguments: true, encoding: 'buffer', windowsHide: true, timeout: 5000 },
      (_err, stdout) => resolve(parseWinAttrListing(Buffer.from(stdout ?? []).toString('utf16le')))
    )
  })
}

/** Names in `find <dir> … -print0` output (NUL-separated full paths). */
export function parseFindPrint0(output: string): Set<string> {
  return new Set(output.split('\0').filter(Boolean).map((p) => basename(p)))
}

/**
 * macOS hides some entries from Finder with the `hidden` file flag (`chflags hidden`, e.g.
 * ~/Library) — the counterpart of Windows' h attribute. Node can't read file flags; BSD find
 * can (~5 ms per folder). NUL-separated, so any name survives.
 */
function readMacHiddenNames(dirPath: string): Promise<Set<string>> {
  return new Promise((resolve) => {
    execFile(
      '/usr/bin/find',
      [dirPath, '-mindepth', '1', '-maxdepth', '1', '-flags', '+hidden', '-print0'],
      { encoding: 'utf8', timeout: 5000 },
      (_err, stdout) => resolve(parseFindPrint0(stdout ?? ''))
    )
  })
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/** List one directory's immediate children (not recursive — the tree expands lazily). */
export async function listDir(dirPath: string): Promise<DirEntry[]> {
  const dirents = readdirSync(dirPath, { withFileTypes: true })
  const winAttrs = process.platform === 'win32' ? await readWinAttributes(dirPath) : null
  const macHidden = process.platform === 'darwin' ? await readMacHiddenNames(dirPath) : null

  return dirents
    .map((dirent) => {
      const fullPath = join(dirPath, dirent.name)
      let sizeBytes = 0
      let modifiedAt = 0
      let createdAt = 0
      let posixMode = 0
      let isDirectory = dirent.isDirectory()
      const isLink = dirent.isSymbolicLink()
      try {
        const stat = statSync(fullPath)
        sizeBytes = stat.isDirectory() ? 0 : stat.size
        modifiedAt = stat.mtimeMs
        createdAt = stat.birthtimeMs
        posixMode = isLink ? lstatSync(fullPath).mode : stat.mode
        isDirectory = stat.isDirectory()
      } catch {
        /* race (removed since readdir), dangling link or no permission */
      }
      const attrs = winAttrs?.get(dirent.name) ?? new Set<WinAttr>()
      const hidden = dirent.name.startsWith('.') || attrs.has('h') || attrs.has('s') || !!macHidden?.has(dirent.name)
      const mode = winAttrs
        ? formatWinMode(isDirectory, attrs)
        : formatPosixMode(posixMode, isLink ? 'link' : isDirectory ? 'dir' : 'file')
      return { name: dirent.name, path: fullPath, isDirectory, sizeBytes, modifiedAt, createdAt, hidden, mode }
    })
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

/** A single entry (for the tree's root), with the same fields as listDir's. */
export async function statEntry(filePath: string): Promise<DirEntry> {
  const parent = dirname(filePath)
  if (parent !== filePath) {
    try {
      const found = (await listDir(parent)).find((e) => e.name === basename(filePath))
      if (found) return { ...found, name: filePath }
    } catch {
      /* unreadable parent — fall back to a plain stat below */
    }
  }
  const stat = statSync(filePath)
  return {
    name: filePath,
    path: filePath,
    isDirectory: stat.isDirectory(),
    sizeBytes: 0,
    modifiedAt: stat.mtimeMs,
    createdAt: stat.birthtimeMs,
    hidden: false,
    mode: process.platform === 'win32' ? formatWinMode(stat.isDirectory(), new Set()) : formatPosixMode(stat.mode, 'dir')
  }
}

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

/** A single path component; rejects separators, "." / "..", and characters Windows forbids. */
export function validateNewName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return '名前を入力してください'
  if (trimmed === '.' || trimmed === '..') return 'その名前は使えません'
  if (/[\\/:*?"<>|]/.test(trimmed) || /[\u0000-\u001f]/.test(trimmed)) return '使えない文字が含まれています（\\ / : * ? " < > |）'
  return null
}

/** Creates an empty folder or file in `parentDir`; fails if the name is taken. Returns the new path. */
export function createEntry(parentDir: string, name: string, kind: 'dir' | 'file'): string {
  const problem = validateNewName(name)
  if (problem) throw new Error(problem)
  const target = join(parentDir, name.trim())
  if (kind === 'dir') mkdirSync(target)
  else writeFileSync(target, '', { flag: 'wx' })
  return target
}

// ---------------------------------------------------------------------------
// Inspecting (preview)
// ---------------------------------------------------------------------------

const SNIFF_BYTES = 64 * 1024
const TEXT_PREVIEW_BYTES = 256 * 1024
const IMAGE_INLINE_LIMIT = 25 * 1024 * 1024

function readPrefix(filePath: string, bytes: number): Buffer {
  const fd = openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(bytes)
    const read = readSync(fd, buffer, 0, bytes, 0)
    return buffer.subarray(0, read)
  } finally {
    closeSync(fd)
  }
}

export function inspectFile(filePath: string): FileInspection {
  const sizeBytes = statSync(filePath).size
  const sniff = sniffContent(new Uint8Array(readPrefix(filePath, SNIFF_BYTES)))
  const result: FileInspection = { ...sniff, path: filePath, sizeBytes, fileUrl: pathToFileURL(filePath).href }
  if (sniff.kind === 'text' || sniff.kind === 'code') {
    const prefix = readPrefix(filePath, TEXT_PREVIEW_BYTES)
    result.text = new TextDecoder('utf-8').decode(prefix)
    result.truncated = sizeBytes > prefix.length
  } else if (sniff.kind === 'image' && sniff.mime && sizeBytes <= IMAGE_INLINE_LIMIT) {
    result.dataUrl = `data:${sniff.mime};base64,${readFileSync(filePath).toString('base64')}`
  }
  return result
}

export function readTextFile(filePath: string): string {
  return readFileSync(filePath, 'utf-8')
}

export function writeTextFile(filePath: string, content: string): void {
  writeFileSync(filePath, content, 'utf-8')
}

/**
 * Watches a directory (non-recursive by default to keep cost low) and calls
 * `onChange` whenever something inside it changes.
 */
export class FsWatchRegistry {
  private readonly watchers = new Map<string, FSWatcher>()

  watch(watchId: string, dirPath: string, onChange: (event: string, changedPath: string) => void): void {
    this.stop(watchId)
    const watcher = chokidar.watch(dirPath, {
      depth: 0,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
    })
    watcher.on('all', (event, changedPath) => onChange(event, changedPath))
    this.watchers.set(watchId, watcher)
  }

  stop(watchId: string): void {
    const watcher = this.watchers.get(watchId)
    if (watcher) {
      void watcher.close()
      this.watchers.delete(watchId)
    }
  }

  stopAll(): void {
    for (const id of [...this.watchers.keys()]) this.stop(id)
  }
}
