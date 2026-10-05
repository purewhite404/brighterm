import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { encryptOrThrow, type CryptoAdapter } from './cryptoAdapter'

/**
 * A tiny generic encrypted key/value store for API keys (AI Builder
 * provider keys, etc.) that don't need their own bespoke module the way
 * Google's OAuth credentials do. One file, one safeStorage-encrypted JSON
 * blob. `crypto` is injected the same way GoogleCredentialsStore does, for
 * the same reason: testable without a real Electron runtime.
 */

export type { CryptoAdapter }

export class SecretStore {
  constructor(
    private readonly filePath: string,
    private readonly crypto: CryptoAdapter
  ) {}

  private readAll(): Record<string, string> {
    // Without encryption nothing can have been saved (see encryptOrThrow) — nor read back.
    if (!existsSync(this.filePath) || !this.crypto.isAvailable()) return {}
    try {
      return JSON.parse(this.crypto.decrypt(readFileSync(this.filePath)))
    } catch (err) {
      console.error('[SecretStore] failed to read secrets file:', err)
      return {}
    }
  }

  private writeAll(data: Record<string, string>): void {
    writeFileSync(this.filePath, encryptOrThrow(this.crypto, JSON.stringify(data)))
  }

  get(key: string): string | null {
    return this.readAll()[key] ?? null
  }

  has(key: string): boolean {
    return this.get(key) !== null
  }

  set(key: string, value: string): void {
    const data = this.readAll()
    data[key] = value
    this.writeAll(data)
  }

  remove(key: string): void {
    const data = this.readAll()
    delete data[key]
    this.writeAll(data)
  }
}
