import { describe, expect, it } from 'vitest'
import { sniffContent } from './fileSniff'

const text = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('sniffContent', () => {
  it('recognizes binary formats by magic bytes', () => {
    expect(sniffContent(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).kind).toBe('image')
    expect(sniffContent(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])).mime).toBe('image/jpeg')
    expect(sniffContent(text('%PDF-1.7\n...')).kind).toBe('pdf')
    expect(sniffContent(new Uint8Array([0, 0, 0, 0x20, ...text('ftypisom')])).kind).toBe('video')
    expect(sniffContent(text('ID3\u0004')).kind).toBe('audio')
    expect(sniffContent(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])).description).toBe('Zip archive data')
    expect(sniffContent(text('MZ\u0090\u0000')).kind).toBe('binary')
    expect(sniffContent(new Uint8Array([1, 2, 3, 0, 5, 6])).kind).toBe('binary')
  })

  it('names compressed and archive formats (e.g. .tar.xz) instead of plain "data"', () => {
    const desc = (bytes: number[] | Uint8Array) => sniffContent(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).description
    expect(desc([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00, 0x00, 0x04])).toBe('XZ compressed data')
    expect(desc([...text('BZh9'), 0x31, 0x41])).toBe('bzip2 compressed data')
    const tar = new Uint8Array(512)
    tar.set(text('hello.txt'), 0)
    tar.set(text('ustar'), 257)
    expect(desc(tar)).toBe('POSIX tar archive')
    const zipWith = (name: string) => new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(26).fill(0), ...text(name)])
    expect(desc(zipWith('[Content_Types].xml'))).toBe('Microsoft OOXML document')
    expect(desc(zipWith('word/document.xml'))).toBe('Microsoft Word 2007+ document')
    expect(desc(zipWith('photos/a.jpg'))).toBe('Zip archive data')
    expect(desc([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])).toMatch(/Composite Document/)
    expect(desc(text('wOF2\u0000\u0001'))).toMatch(/WOFF2/)
  })

  it('treats notes, logs and config files as editable text', () => {
    expect(sniffContent(text('# 買い物\n\n- 牛乳\n- パン\n'))).toEqual({ kind: 'text', description: 'UTF-8 text' })
    expect(sniffContent(text('2026-09-28 07:20:31 INFO started\n2026-09-28 07:20:32 WARN slow\n')).kind).toBe('text')
    expect(sniffContent(text('[core]\n\trepositoryformatversion = 0\n\tbare = false\n')).kind).toBe('text')
    expect(sniffContent(text('server:\n  port: 8080\n  host: localhost\n')).kind).toBe('text')
    expect(sniffContent(text('Just a sentence.\n')).description).toBe('ASCII text')
  })

  it('a markdown file stays text even with code blocks in it', () => {
    const md = '# Setup\n\nRun this:\n\n```js\nimport x from "y"\nconst a = 1;\nfunction f() {\n  return a;\n}\n```\n\nThen done.\n'
    expect(sniffContent(text(md)).kind).toBe('text')
  })

  it('treats markup, data and source code as preview-only code', () => {
    expect(sniffContent(text('<!DOCTYPE html>\n<html><body>hi</body></html>')).description).toBe('HTML document')
    expect(sniffContent(text('<?xml version="1.0"?>\n<root/>')).description).toBe('XML document')
    expect(sniffContent(text('{\n  "name": "x",\n  "version": "1.0.0"\n}\n')).description).toBe('JSON data')
    expect(sniffContent(text('#!/usr/bin/env python3\nprint("hi")\n')).description).toBe('Python script')
    expect(sniffContent(text('import os\nimport sys\n\ndef main():\n    print(os.getcwd())\n')).kind).toBe('code')
    expect(sniffContent(text("import { a } from './a'\n\nexport function b(): number {\n  return a\n}\n")).kind).toBe('code')
    expect(sniffContent(text('#include <stdio.h>\n\nint main(void) {\n  printf("hi\\n");\n  return 0;\n}\n')).kind).toBe('code')
    expect(sniffContent(text('body {\n  margin: 0;\n  color: red;\n}\n.a {\n  display: none;\n}\n')).kind).toBe('code')
  })

  it('JSON-lines logs are still text', () => {
    const log = '{"level":"info","msg":"a"}\n{"level":"warn","msg":"b"}\n{"level":"info","msg":"c"}\n'
    expect(sniffContent(text(log)).kind).toBe('text')
  })

  it('SVG is an image; empty files are empty', () => {
    expect(sniffContent(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).mime).toBe('image/svg+xml')
    expect(sniffContent(new Uint8Array()).kind).toBe('empty')
  })

  it('tolerates a multi-byte character cut off at the end of the sample', () => {
    const bytes = text('メモです')
    expect(sniffContent(bytes.subarray(0, bytes.length - 1)).kind).toBe('text')
  })
})
