import { describe, expect, it } from 'vitest'
import { parseBundle } from './bundleParser'

const VALID_BUNDLE = `Here is your plugin:

\`\`\`
=== file: manifest.json ===
{ "id": "example", "kind": "app" }
=== file: index.html ===
<html></html>
=== file: main.js ===
console.log("hi")
\`\`\`

Let me know if you'd like changes.`

describe('parseBundle', () => {
  it('parses a well-formed bundle embedded in a chat reply with prose around it', () => {
    const result = parseBundle(VALID_BUNDLE)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.files).toEqual([
      { path: 'manifest.json', content: '{ "id": "example", "kind": "app" }' },
      { path: 'index.html', content: '<html></html>' },
      { path: 'main.js', content: 'console.log("hi")' }
    ])
  })

  it('parses a bundle with no surrounding code fence', () => {
    const raw = '=== file: manifest.json ===\n{}\n=== file: index.html ===\n<html></html>'
    const result = parseBundle(raw)
    expect(result.ok).toBe(true)
    expect(result.files).toEqual([
      { path: 'manifest.json', content: '{}' },
      { path: 'index.html', content: '<html></html>' }
    ])
  })

  it('preserves multi-line file content exactly', () => {
    const raw = ['=== file: manifest.json ===', '{}', '=== file: main.js ===', 'line1', 'line2', '', 'line4'].join(
      '\n'
    )
    const result = parseBundle(raw)
    const mainJs = result.files.find((f) => f.path === 'main.js')
    expect(mainJs?.content).toBe('line1\nline2\n\nline4')
  })

  it('fails when there are no file markers at all', () => {
    const result = parseBundle('just some prose, no bundle here')
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatch(/ファイル区切り/)
  })

  it('fails when manifest.json is missing', () => {
    const raw = '=== file: index.html ===\n<html></html>'
    const result = parseBundle(raw)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('manifest.json'))).toBe(true)
  })

  it('rejects path traversal attempts', () => {
    const raw = '=== file: manifest.json ===\n{}\n=== file: ../../evil.js ===\nconsole.log(1)'
    const result = parseBundle(raw)
    expect(result.ok).toBe(false)
    expect(result.files.map((f) => f.path)).toEqual(['manifest.json'])
    expect(result.errors.some((e) => e.includes('../../evil.js'))).toBe(true)
  })

  it('rejects absolute paths (unix and windows)', () => {
    const raw1 = '=== file: manifest.json ===\n{}\n=== file: /etc/passwd ===\nroot:x:0:0'
    expect(parseBundle(raw1).files.map((f) => f.path)).toEqual(['manifest.json'])

    const raw2 = '=== file: manifest.json ===\n{}\n=== file: C:\\Windows\\System32\\evil.dll ===\nbinary'
    expect(parseBundle(raw2).files.map((f) => f.path)).toEqual(['manifest.json'])
  })

  it('rejects duplicate file paths', () => {
    const raw = '=== file: manifest.json ===\n{"a":1}\n=== file: manifest.json ===\n{"a":2}'
    const result = parseBundle(raw)
    expect(result.ok).toBe(false)
    expect(result.files).toHaveLength(1)
    expect(result.errors.some((e) => e.includes('重複'))).toBe(true)
  })

  it('drops stray prose before the first file marker', () => {
    const raw = 'some intro text\nmore text\n=== file: manifest.json ===\n{}'
    const result = parseBundle(raw)
    expect(result.files).toEqual([{ path: 'manifest.json', content: '{}' }])
  })

  it('trims whitespace around the marker path', () => {
    const raw = '===   file:   manifest.json   ===\n{}'
    const result = parseBundle(raw)
    expect(result.files[0].path).toBe('manifest.json')
  })

  it('handles an empty file body', () => {
    const raw = '=== file: manifest.json ===\n{}\n=== file: empty.txt ===\n=== file: after.txt ===\ncontent'
    const result = parseBundle(raw)
    const empty = result.files.find((f) => f.path === 'empty.txt')
    expect(empty?.content).toBe('')
  })
})
