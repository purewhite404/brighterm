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
