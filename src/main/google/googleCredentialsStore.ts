import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import type { CryptoAdapter } from '../cryptoAdapter'

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
    if (!existsSync(this.filePath)) return null
    try {
      const raw = readFileSync(this.filePath)
      const json = this.crypto.isAvailable() ? this.crypto.decrypt(raw) : raw.toString('utf-8')
      return JSON.parse(json)
    } catch (err) {
      console.error('[GoogleCredentialsStore] failed to read stored credentials:', err)
      return null
    }
  }

  write(creds: GoogleCredentials): void {
    const json = JSON.stringify(creds)
    const data = this.crypto.isAvailable() ? this.crypto.encrypt(json) : Buffer.from(json, 'utf-8')
    writeFileSync(this.filePath, data)
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
