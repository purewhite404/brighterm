/**
 * Parses the "btbundle" text format AGENTS.md asks an AI to reply with: one
 * fenced code block containing several files, each preceded by a
 * `=== file: <relative path> ===` marker line.
 *
 * This accepts either the *whole chat reply* (fenced code block included) or
 * just the bundle body someone already extracted — both are common depending
 * on what the user pastes in.
 */

export interface ParsedBundleFile {
  path: string
  content: string
}

export interface ParseBundleResult {
  ok: boolean
  files: ParsedBundleFile[]
  errors: string[]
}

const FILE_MARKER = /^===\s*file:\s*(.+?)\s*===$/

/** Pulls the first fenced code block's contents out of a larger chat reply, if there is one. */
function extractFirstCodeBlock(text: string): string {
  const match = text.match(/```[a-zA-Z0-9]*\n([\s\S]*?)```/)
  return match ? match[1] : text
}

function isSafeRelativePath(path: string): boolean {
  if (path.length === 0) return false
  if (path.startsWith('/') || path.startsWith('\\')) return false
  if (/^[a-zA-Z]:/.test(path)) return false // Windows drive letter absolute path
  const segments = path.split(/[/\\]/)
  if (segments.some((s) => s === '..')) return false
  if (segments.some((s) => s.trim() === '')) return false
  return true
}

export function parseBundle(rawText: string): ParseBundleResult {
  const errors: string[] = []
  const body = extractFirstCodeBlock(rawText)
  const lines = body.split('\n')

  const files: ParsedBundleFile[] = []
  let currentPath: string | null = null
  let currentLines: string[] = []

  const flush = (): void => {
    if (currentPath === null) return
    files.push({ path: currentPath, content: currentLines.join('\n').replace(/\n$/, '') })
  }

  for (const line of lines) {
    const marker = line.match(FILE_MARKER)
    if (marker) {
      flush()
      currentPath = marker[1]
      currentLines = []
    } else if (currentPath !== null) {
      currentLines.push(line)
    }
    // Lines before the first marker (stray prose) are silently dropped.
  }
  flush()

  if (files.length === 0) {
    errors.push('ファイル区切り "=== file: ... ===" が見つかりませんでした。')
    return { ok: false, files: [], errors }
  }

  const seenPaths = new Set<string>()
  const safeFiles: ParsedBundleFile[] = []
  for (const file of files) {
    if (!isSafeRelativePath(file.path)) {
      errors.push(`不正なファイルパスです（許可されません）: "${file.path}"`)
      continue
    }
    if (seenPaths.has(file.path)) {
      errors.push(`ファイルが重複しています: "${file.path}"`)
      continue
    }
    seenPaths.add(file.path)
    safeFiles.push(file)
  }

  if (!safeFiles.some((f) => f.path === 'manifest.json')) {
    errors.push('manifest.json が含まれていません。')
  }

  return { ok: errors.length === 0, files: safeFiles, errors }
}
