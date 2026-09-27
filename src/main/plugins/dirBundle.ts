import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ParsedBundleFile } from './bundleParser'

/** Recursively reads every file under `rootDir` into the same shape a parsed btbundle produces. */
export function readDirAsBundleFiles(rootDir: string, subPath = ''): ParsedBundleFile[] {
  const files: ParsedBundleFile[] = []
  const currentDir = join(rootDir, subPath)
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const relPath = subPath ? `${subPath}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...readDirAsBundleFiles(rootDir, relPath))
    } else {
      files.push({ path: relPath, content: readFileSync(join(rootDir, relPath), 'utf-8') })
    }
  }
  return files
}
