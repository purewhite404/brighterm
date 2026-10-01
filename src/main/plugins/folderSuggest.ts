import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { matchesPrefix, suggestionQuery, withTrailingSeparator } from './folderInput'

/** Only a guard against huge folders — the list scrolls, and every subfolder must be reachable (12 cut off "QAM"). */
const MAX_SUGGESTIONS = 500

/**
 * Subfolders completing what's typed in a plugin tile's folder bar, as full
 * paths ending in a separator. Called on every keystroke, so it only reads
 * names (unlike the Files tile's listDir, which stats every entry and on
 * Windows runs `cmd` per folder). Anything unreadable just yields nothing.
 */
export function suggestFolders(input: string, homeDir: string): string[] {
  // Nothing typed yet: offer the home folder as a starting point.
  if (!input.trim()) return [withTrailingSeparator(homeDir)]
  const query = suggestionQuery(input, homeDir)
  if (!query) return []
  let dirents
  try {
    dirents = readdirSync(query.dir, { withFileTypes: true })
  } catch {
    return []
  }
  const names: string[] = []
  for (const dirent of dirents) {
    if (!matchesPrefix(dirent.name, query.prefix)) continue
    let isDirectory = dirent.isDirectory()
    if (!isDirectory && dirent.isSymbolicLink()) {
      try {
        isDirectory = statSync(join(query.dir, dirent.name)).isDirectory()
      } catch {
        /* dangling link */
      }
    }
    if (isDirectory) names.push(dirent.name)
  }
  return names
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
    .slice(0, MAX_SUGGESTIONS)
    .map((name) => withTrailingSeparator(join(query.dir, name)))
}
