/**
 * Shared shape for "encrypt this string at rest" used by both
 * GoogleCredentialsStore and SecretStore. Kept as an injected interface
 * (rather than importing Electron's `safeStorage` directly in those
 * modules) so both stores can be unit-tested with a fake outside Electron.
 */
export interface CryptoAdapter {
  isAvailable: () => boolean
  encrypt: (plainText: string) => Buffer
  decrypt: (cipherText: Buffer) => string
}

/**
 * Secrets (API keys, Google tokens) are never written in plain text: without the OS's
 * encryption (Linux without a keyring) saving them fails with this message instead.
 */
export const ENCRYPTION_UNAVAILABLE =
  'この環境では OS の暗号化（Windows の資格情報 / macOS のキーチェーン / Linux の gnome-keyring・KWallet など）が使えないため、キーやトークンを保存できません。'

export function encryptOrThrow(crypto: CryptoAdapter, plainText: string): Buffer {
  if (!crypto.isAvailable()) throw new Error(ENCRYPTION_UNAVAILABLE)
  return crypto.encrypt(plainText)
}

/** The real thing — call only from main/index.ts, after app.ready. */
export function createSafeStorageCrypto(): CryptoAdapter {
  // Imported lazily so this file itself stays require()-safe outside Electron.
  const { safeStorage } = require('electron') as typeof import('electron')
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plainText) => safeStorage.encryptString(plainText),
    decrypt: (cipherText) => safeStorage.decryptString(cipherText)
  }
}
