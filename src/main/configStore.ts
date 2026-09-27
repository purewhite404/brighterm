import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AppConfig } from '@shared/types'

/**
 * Reads and writes userData/config.json — the one file that holds workspaces,
 * tile layouts, web tile definitions and app-wide settings.
 *
 * Writes are debounced so rapid UI-driven updates (dragging a splitter,
 * resizing a tile) don't hammer the disk.
 */

function defaultConfig(): AppConfig {
  return {
    workspaces: [
      {
        id: 'home',
        name: 'Home',
        icon: 'home',
        layout: null,
        tiles: {}
      }
    ],
    activeWorkspaceId: 'home',
    webTileDefinitions: [
      {
        id: 'mail',
        title: 'Mail',
        icon: 'mail',
        url: 'https://mail.google.com/mail/u/0/',
        partitionId: 'google'
      },
      {
        id: 'calendar',
        title: 'Calendar',
        icon: 'calendar',
        url: 'https://calendar.google.com/calendar/u/0/r',
        partitionId: 'google'
      },
      {
        id: 'browser',
        title: 'Browser',
        icon: 'browser',
        url: 'https://www.google.com',
        partitionId: 'browser'
      }
    ],
    memoryBudgetBytes: 1.5 * 1024 * 1024 * 1024,
    suspendAfterMs: 10 * 60 * 1000,
    aiBuilder: {
      mode: 'web-bridge',
      webBridgeUrl: 'https://chatgpt.com/',
      apiProvider: 'openai',
      apiModel: 'gpt-5.1'
    }
  }
}

export class ConfigStore {
  private readonly filePath: string
  private config: AppConfig
  private writeTimer: NodeJS.Timeout | null = null
  private readonly writeDelayMs = 400

  constructor(userDataPath: string = app.getPath('userData')) {
    mkdirSync(userDataPath, { recursive: true })
    this.filePath = join(userDataPath, 'config.json')
    this.config = this.load()
  }

  private load(): AppConfig {
    if (!existsSync(this.filePath)) {
      const initial = defaultConfig()
      this.persistNow(initial)
      return initial
    }
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<AppConfig>
      // Merge with defaults so new fields introduced by app updates get sane values.
      return { ...defaultConfig(), ...parsed }
    } catch (err) {
      console.error('[ConfigStore] failed to read config.json, falling back to defaults:', err)
      return defaultConfig()
    }
  }

  get(): AppConfig {
    return this.config
  }

  /** Shallow-merge `patch` into the current config and schedule a debounced write. */
  set(patch: Partial<AppConfig>): AppConfig {
    this.config = { ...this.config, ...patch }
    this.scheduleWrite()
    return this.config
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => {
      this.persistNow(this.config)
      this.writeTimer = null
    }, this.writeDelayMs)
  }

  /** Force an immediate, synchronous write. Used on app quit to avoid losing recent changes. */
  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    this.persistNow(this.config)
  }

  private persistNow(config: AppConfig): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(config, null, 2), 'utf-8')
    } catch (err) {
      console.error('[ConfigStore] failed to write config.json:', err)
    }
  }
}
