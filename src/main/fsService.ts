import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import chokidar, { type FSWatcher } from 'chokidar'

export function getHomeDir(): string {
  return homedir()
}

export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
  sizeBytes: number
  modifiedAt: number
}

/** List one directory's immediate children (not recursive — the tree expands lazily). */
export function listDir(dirPath: string): DirEntry[] {
  const names = readdirSync(dirPath, { withFileTypes: true })
  return names
    .map((dirent) => {
      const fullPath = join(dirPath, dirent.name)
      let sizeBytes = 0
      let modifiedAt = 0
      try {
        const stat = statSync(fullPath)
        sizeBytes = stat.size
        modifiedAt = stat.mtimeMs
      } catch {
        /* race: file removed between readdir and stat */
      }
      return {
        name: dirent.name,
        path: fullPath,
        isDirectory: dirent.isDirectory(),
        sizeBytes,
        modifiedAt
      }
    })
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
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
