import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Generation-based backup for every write the /etc editor makes. Kept as
 * plain files (not a database) so a user can inspect or restore them by hand
 * even if the app itself won't start.
 *
 * Layout: <historyRoot>/<sanitized-target-path>/<timestamp>.bak
 */

export function sanitizeForDirName(targetPath: string): string {
  return targetPath.replace(/[/\\:]/g, '_').replace(/^_+/, '')
}

export interface HistoryEntry {
  timestamp: number
  fileName: string
  content: string
}

export class EtcHistory {
  constructor(private readonly historyRoot: string) {}

  private dirFor(targetPath: string): string {
    return join(this.historyRoot, sanitizeForDirName(targetPath))
  }

  /** Save `previousContent` as a new generation before a write happens. Returns the backup file name. */
  backup(targetPath: string, previousContent: string): string {
    const dir = this.dirFor(targetPath)
    mkdirSync(dir, { recursive: true })
    const fileName = `${Date.now()}.bak`
    writeFileSync(join(dir, fileName), previousContent, 'utf-8')
    return fileName
  }

  list(targetPath: string): HistoryEntry[] {
    const dir = this.dirFor(targetPath)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((f) => f.endsWith('.bak'))
      .map((fileName) => {
        const timestamp = Number(fileName.replace('.bak', ''))
        return { timestamp, fileName, content: '' }
      })
      .sort((a, b) => b.timestamp - a.timestamp)
  }

  read(targetPath: string, fileName: string): string {
    return readFileSync(join(this.dirFor(targetPath), fileName), 'utf-8')
  }
}
