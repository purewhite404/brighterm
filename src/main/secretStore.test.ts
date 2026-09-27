import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecretStore, type CryptoAdapter } from './secretStore'

function fakeCrypto(available = true): CryptoAdapter {
  return {
    isAvailable: () => available,
    encrypt: (plainText) => Buffer.from(`ENC(${plainText})`, 'utf-8'),
    decrypt: (cipherText) => cipherText.toString('utf-8').slice('ENC('.length, -1)
  }
}

describe('SecretStore', () => {
  let dir: string
  let filePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brighterm-secrets-'))
    filePath = join(dir, 'secrets.enc')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns null / false for a key that was never set', () => {
    const store = new SecretStore(filePath, fakeCrypto())
    expect(store.get('openai')).toBeNull()
    expect(store.has('openai')).toBe(false)
  })

  it('round-trips a value through the crypto adapter', () => {
    const store = new SecretStore(filePath, fakeCrypto())
    store.set('openai', 'sk-test-123')
    expect(store.get('openai')).toBe('sk-test-123')
    expect(store.has('openai')).toBe(true)
  })

  it('stores multiple keys independently', () => {
    const store = new SecretStore(filePath, fakeCrypto())
    store.set('openai', 'key-a')
    store.set('anthropic', 'key-b')
    expect(store.get('openai')).toBe('key-a')
    expect(store.get('anthropic')).toBe('key-b')
  })

  it('remove() deletes only the given key', () => {
    const store = new SecretStore(filePath, fakeCrypto())
    store.set('openai', 'key-a')
    store.set('anthropic', 'key-b')
    store.remove('openai')
    expect(store.get('openai')).toBeNull()
    expect(store.get('anthropic')).toBe('key-b')
  })

  it('falls back to plaintext when encryption is unavailable', () => {
    const store = new SecretStore(filePath, fakeCrypto(false))
    store.set('openai', 'sk-test')
    expect(store.get('openai')).toBe('sk-test')
  })

  it('persists across a new instance pointed at the same file', () => {
    const store = new SecretStore(filePath, fakeCrypto())
    store.set('openai', 'sk-test')
    const reopened = new SecretStore(filePath, fakeCrypto())
    expect(reopened.get('openai')).toBe('sk-test')
  })
})
