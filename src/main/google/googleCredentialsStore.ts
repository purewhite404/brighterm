import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { encryptOrThrow, type CryptoAdapter } from '../cryptoAdapter'

/**
 * Persists the one thing Google OAuth needs across restarts: the refresh
 * token (plus the client id/secret the user entered, so we don't ask again).
 * Encrypted at rest via Electron's safeStorage (OS keychain/DPAPI-backed) —
 * injected as `crypto` so this is unit-testable without a real Electron
 * runtime.
 */

export interface GoogleCredentials {
  clientId: string
  clientSecret: string
  refreshToken?: string
}

export type { CryptoAdapter }

export class GoogleCredentialsStore {
  constructor(
    private readonly filePath: string,
    private readonly crypto: CryptoAdapter
  ) {}

  read(): GoogleCredentials | null {
    // Without encryption nothing can have been saved (see encryptOrThrow) — nor read back.
    if (!existsSync(this.filePath) || !this.crypto.isAvailable()) return null
    try {
      return JSON.parse(this.crypto.decrypt(readFileSync(this.filePath)))
    } catch (err) {
      console.error('[GoogleCredentialsStore] failed to read stored credentials:', err)
      return null
    }
  }

  write(creds: GoogleCredentials): void {
    writeFileSync(this.filePath, encryptOrThrow(this.crypto, JSON.stringify(creds)))
  }

  update(patch: Partial<GoogleCredentials>): GoogleCredentials {
    const current = this.read() ?? { clientId: '', clientSecret: '' }
    const next = { ...current, ...patch }
    this.write(next)
    return next
  }

  clear(): void {
    if (existsSync(this.filePath)) unlinkSync(this.filePath)
  }

  isConnected(): boolean {
    return !!this.read()?.refreshToken
  }
}
