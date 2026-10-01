import { posix, win32 } from 'node:path'

/**
 * What the user types into a plugin tile's folder bar → an absolute folder
 * path. Pure (the platform is a parameter) so both path flavors are tested
 * on any OS. Errors are Japanese: the bar shows them as they are.
 */

type Platform = NodeJS.Platform

const pathFor = (platform: Platform): typeof posix => (platform === 'win32' ? win32 : posix)
const caseInsensitive = (platform: Platform): boolean => platform === 'win32' || platform === 'darwin'

/** Trims, drops the quotes Explorer's "パスのコピー" adds, expands "~" and a bare drive ("C:"). */
function expand(input: string, homeDir: string, platform: Platform): string {
  let text = input.trim()
  if (text.length >= 2 && (text[0] === '"' || text[0] === "'") && text.endsWith(text[0])) text = text.slice(1, -1).trim()
  if (text === '~') return homeDir
  if (text.startsWith('~/') || (platform === 'win32' && text.startsWith('~\\'))) {
    return pathFor(platform).join(homeDir, text.slice(2))
  }
  if (platform === 'win32' && /^[a-zA-Z]:$/.test(text)) return `${text}\\`
  return text
}

/** Absolute, and on Windows with a drive or a UNC share (not "\foo", which means "on the current drive"). */
function isFullPath(text: string, platform: Platform): boolean {
  if (platform === 'win32') return /^[a-zA-Z]:[\\/]/.test(text) || /^[\\/]{2}[^\\/]/.test(text)
  return posix.isAbsolute(text)
}

/** The absolute folder path the input means; throws (in Japanese) if it can't be one. */
export function normalizeFolderInput(input: string, homeDir: string, platform: Platform = process.platform): string {
  const text = expand(input, homeDir, platform)
  if (!text) throw new Error('フォルダのパスを入力してください')
  if (!isFullPath(text, platform)) {
    const example = platform === 'win32' ? 'C:\\Users\\名前\\Documents' : '/home/名前/Documents'
    throw new Error(`フォルダは「${example}」のように、先頭からのパスで入力してください（~ はホームフォルダ）`)
  }
  // resolve() also drops trailing separators and "." / ".." segments.
  return pathFor(platform).resolve(text)
}

/**
 * Where to look for completions of a partly typed path: the folder typed so
 * far and the start of the next name. Null when the input isn't a path yet.
 */
export function suggestionQuery(
  input: string,
  homeDir: string,
  platform: Platform = process.platform
): { dir: string; prefix: string } | null {
  const text = expand(input, homeDir, platform)
  if (!text || !isFullPath(text, platform)) return null
  const p = pathFor(platform)
  if (/[\\/]$/.test(text) || text === homeDir) return { dir: p.resolve(text), prefix: '' }
  return { dir: p.dirname(p.resolve(text)), prefix: p.basename(text) }
}

/** Whether a folder name should be offered for the typed prefix (dot folders only when asked for). */
export function matchesPrefix(name: string, prefix: string, platform: Platform = process.platform): boolean {
  if (name.startsWith('.') && !prefix.startsWith('.')) return false
  return caseInsensitive(platform) ? name.toLowerCase().startsWith(prefix.toLowerCase()) : name.startsWith(prefix)
}

/** Same folder? (Windows and macOS paths are case-insensitive.) */
export function samePath(a: string, b: string, platform: Platform = process.platform): boolean {
  return caseInsensitive(platform) ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** A suggestion as the bar fills it in: the full path plus a separator, so the next Tab lists its subfolders. */
export function withTrailingSeparator(path: string, platform: Platform = process.platform): string {
  const sep = platform === 'win32' ? '\\' : '/'
  return path.endsWith(sep) ? path : path + sep
}
