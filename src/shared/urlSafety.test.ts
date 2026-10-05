import { describe, expect, it } from 'vitest'
import { isSafeExternalUrl, isWebUrl } from './urlSafety'

describe('isSafeExternalUrl', () => {
  it('allows web pages and mail links', () => {
    expect(isSafeExternalUrl('https://example.com/a?b=c')).toBe(true)
    expect(isSafeExternalUrl('http://localhost:8080/')).toBe(true)
    expect(isSafeExternalUrl('mailto:someone@example.com')).toBe(true)
  })

  it('rejects anything the OS would run or open as a file', () => {
    for (const url of [
      'file:///C:/Windows/System32/calc.exe',
      'file://attacker/share/x.exe',
      '\\\\attacker\\share\\x.exe',
      'C:\\Windows\\System32\\calc.exe',
      'ms-msdt:/id PCWDiagnostic',
      'search-ms:query=x',
      'javascript:alert(1)',
      'vbscript:x',
      'data:text/html,<script>1</script>',
      'smb://attacker/share',
      '',
      'not a url'
    ]) {
      expect(isSafeExternalUrl(url), url).toBe(false)
    }
    expect(isSafeExternalUrl(undefined)).toBe(false)
    expect(isSafeExternalUrl({ toString: () => 'https://x.com' })).toBe(false)
  })
})

describe('isWebUrl', () => {
  it('is http(s) only', () => {
    expect(isWebUrl('https://example.com')).toBe(true)
    expect(isWebUrl('mailto:a@b.c')).toBe(false)
    expect(isWebUrl('file:///etc/passwd')).toBe(false)
    expect(isWebUrl('about:blank')).toBe(false)
  })
})
