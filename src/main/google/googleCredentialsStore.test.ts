import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GoogleCredentialsStore, type CryptoAdapter } from './googleCredentialsStore'

/** A fake "OS keychain" — reversible but not identity — to prove encrypt/decrypt round-trips. */
function fakeCrypto(available = true): CryptoAdapter {
  return {
    isAvailable: () => available,
    encrypt: (plainText) => Buffer.from(`ENC(${plainText})`, 'utf-8'),
    decrypt: (cipherText) => {
      const s = cipherText.toString('utf-8')
      return s.slice('ENC('.length, -1)
    }
  }
}

describe('GoogleCredentialsStore', () => {
  let dir: string
  let filePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brighterm-google-creds-'))
    filePath = join(dir, 'google.enc')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns null when nothing has been saved yet', () => {
    const store = new GoogleCredentialsStore(filePath, fakeCrypto())
    expect(store.read()).toBeNull()
    expect(store.isConnected()).toBe(false)
  })

  it('round-trips credentials through the crypto adapter', () => {
    const store = new GoogleCredentialsStore(filePath, fakeCrypto())
    store.write({ clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' })
    expect(store.read()).toEqual({ clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' })
    expect(store.isConnected()).toBe(true)
  })

  it('refuses to save credentials in plain text when encryption is unavailable', () => {
    const store = new GoogleCredentialsStore(filePath, fakeCrypto(false))
    expect(() => store.write({ clientId: 'id', clientSecret: 'secret' })).toThrow(/暗号化.*保存できません/)
    expect(existsSync(filePath)).toBe(false)
    expect(store.read()).toBeNull()
  })

  it('update() merges into existing credentials without clobbering unrelated fields', () => {
    const store = new GoogleCredentialsStore(filePath, fakeCrypto())
    store.write({ clientId: 'id', clientSecret: 'secret' })
    store.update({ refreshToken: 'newly-obtained' })
    expect(store.read()).toEqual({ clientId: 'id', clientSecret: 'secret', refreshToken: 'newly-obtained' })
  })

  it('update() starts from empty credentials when nothing was saved before', () => {
    const store = new GoogleCredentialsStore(filePath, fakeCrypto())
    const result = store.update({ clientId: 'id' })
    expect(result).toEqual({ clientId: 'id', clientSecret: '' })
  })

  it('clear() removes the file so isConnected() goes back to false', () => {
    const store = new GoogleCredentialsStore(filePath, fakeCrypto())
    store.write({ clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' })
    store.clear()
    expect(store.read()).toBeNull()
    expect(store.isConnected()).toBe(false)
  })

  it('clear() on an already-missing file does not throw', () => {
    const store = new GoogleCredentialsStore(filePath, fakeCrypto())
    expect(() => store.clear()).not.toThrow()
  })

  it('isConnected() is false when credentials exist but have no refresh token yet', () => {
    const store = new GoogleCredentialsStore(filePath, fakeCrypto())
    store.write({ clientId: 'id', clientSecret: 'secret' })
    expect(store.isConnected()).toBe(false)
  })

  it('returns null (not throw) if the file is corrupted', () => {
    const store = new GoogleCredentialsStore(filePath, fakeCrypto())
    writeFileSync(filePath, 'not valid encrypted data or json')
    expect(store.read()).toBeNull()
  })
})
