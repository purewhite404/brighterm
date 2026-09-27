import { describe, expect, it } from 'vitest'
import { resolveAddressInput, resolveMail } from './types'

describe('resolveAddressInput', () => {
  it('opens full URLs as-is', () => {
    expect(resolveAddressInput('https://example.com/x', 'duckduckgo')).toBe('https://example.com/x')
  })
  it('adds https:// to bare domains', () => {
    expect(resolveAddressInput('example.com', 'duckduckgo')).toBe('https://example.com')
    expect(resolveAddressInput('github.com/anthropics', 'duckduckgo')).toBe('https://github.com/anthropics')
  })
  it('uses http:// for localhost', () => {
    expect(resolveAddressInput('localhost:5173', 'duckduckgo')).toBe('http://localhost:5173')
  })
  it('searches anything else with the chosen engine (DuckDuckGo by default)', () => {
    expect(resolveAddressInput('electron tiling', 'duckduckgo')).toBe('https://duckduckgo.com/?q=electron%20tiling')
    expect(resolveAddressInput('天気', 'google')).toBe('https://www.google.com/search?q=%E5%A4%A9%E6%B0%97')
  })
})

describe('resolveMail', () => {
  it('resolves a preset provider', () => {
    expect(resolveMail({ provider: 'outlook' }).url).toBe('https://outlook.live.com/mail/')
  })
  it('uses the custom URL for provider "custom"', () => {
    expect(resolveMail({ provider: 'custom', customUrl: 'https://mail.example.jp/' })).toEqual({
      url: 'https://mail.example.jp/',
      partitionId: 'mail-custom',
      label: 'Mail'
    })
  })
  it('falls back to Gmail for an unknown provider id', () => {
    expect(resolveMail({ provider: 'nope' }).label).toBe('Gmail')
  })
})
