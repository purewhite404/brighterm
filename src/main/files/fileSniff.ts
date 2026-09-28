import type { SniffResult } from '@shared/apiTypes'
/**
 * Content-based file type detection, in the spirit of `file(1)`: magic bytes
 * for binary formats, then heuristics that tell plain text (notes, logs,
 * config) apart from markup and program source. The extension is never
 * consulted. Pure, so it's unit-tested and behaves the same on every OS.
 *
 * - 'text'  → "ASCII text" / "UTF-8 text" in file's terms: opened in Notes for editing
 * - 'code'  → HTML, XML, JSON, scripts, source code: read-only preview
 * - 'image' | 'pdf' | 'video' | 'audio' → rendered preview
 * - 'binary' → everything else: properties only
 */

interface Magic {
  test: (b: Uint8Array) => boolean
  result: SniffResult
}

const startsWith = (b: Uint8Array, bytes: number[], offset = 0): boolean =>
  b.length >= offset + bytes.length && bytes.every((v, i) => b[offset + i] === v)
const ascii = (b: Uint8Array, text: string, offset = 0): boolean =>
  startsWith(
    b,
    [...text].map((c) => c.charCodeAt(0)),
    offset
  )

const MAGICS: Magic[] = [
  { test: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47]), result: { kind: 'image', description: 'PNG image data', mime: 'image/png' } },
  { test: (b) => startsWith(b, [0xff, 0xd8, 0xff]), result: { kind: 'image', description: 'JPEG image data', mime: 'image/jpeg' } },
  { test: (b) => ascii(b, 'GIF8'), result: { kind: 'image', description: 'GIF image data', mime: 'image/gif' } },
  { test: (b) => ascii(b, 'RIFF') && ascii(b, 'WEBP', 8), result: { kind: 'image', description: 'WebP image data', mime: 'image/webp' } },
  { test: (b) => ascii(b, 'BM') && b.length > 14, result: { kind: 'image', description: 'BMP image data', mime: 'image/bmp' } },
  { test: (b) => startsWith(b, [0, 0, 1, 0]), result: { kind: 'image', description: 'MS Windows icon resource', mime: 'image/x-icon' } },
  {
    test: (b) => ascii(b, 'ftyp', 4) && (ascii(b, 'avif', 8) || ascii(b, 'avis', 8)),
    result: { kind: 'image', description: 'AVIF image data', mime: 'image/avif' }
  },
  { test: (b) => ascii(b, '%PDF-'), result: { kind: 'pdf', description: 'PDF document', mime: 'application/pdf' } },
  {
    test: (b) => ascii(b, 'ftyp', 4) && (ascii(b, 'M4A ', 8) || ascii(b, 'M4B ', 8)),
    result: { kind: 'audio', description: 'MPEG-4 audio', mime: 'audio/mp4' }
  },
  {
    test: (b) => ascii(b, 'ftyp', 4) && ascii(b, 'qt  ', 8),
    result: { kind: 'video', description: 'QuickTime movie', mime: 'video/quicktime' }
  },
  { test: (b) => ascii(b, 'ftyp', 4), result: { kind: 'video', description: 'ISO Media, MP4 video', mime: 'video/mp4' } },
  { test: (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]), result: { kind: 'video', description: 'WebM / Matroska data', mime: 'video/webm' } },
  { test: (b) => ascii(b, 'RIFF') && ascii(b, 'AVI ', 8), result: { kind: 'video', description: 'RIFF AVI video', mime: 'video/x-msvideo' } },
  { test: (b) => ascii(b, 'RIFF') && ascii(b, 'WAVE', 8), result: { kind: 'audio', description: 'RIFF WAVE audio', mime: 'audio/wav' } },
  { test: (b) => ascii(b, 'ID3') || startsWith(b, [0xff, 0xfb]) || startsWith(b, [0xff, 0xf3]), result: { kind: 'audio', description: 'MPEG audio (MP3)', mime: 'audio/mpeg' } },
  { test: (b) => ascii(b, 'OggS'), result: { kind: 'audio', description: 'Ogg data', mime: 'audio/ogg' } },
  { test: (b) => ascii(b, 'fLaC'), result: { kind: 'audio', description: 'FLAC audio', mime: 'audio/flac' } },
  { test: (b) => ascii(b, 'ftyp', 4) && /^(heic|heix|mif1|msf1)$/.test(latin1(b, 8, 4)), result: { kind: 'binary', description: 'HEIF image data' } },
  { test: (b) => ascii(b, 'II*\u0000') || ascii(b, 'MM\u0000*'), result: { kind: 'binary', description: 'TIFF image data' } },
  { test: (b) => ascii(b, '8BPS'), result: { kind: 'binary', description: 'Adobe Photoshop image' } },
  { test: (b) => ascii(b, 'MThd'), result: { kind: 'binary', description: 'Standard MIDI data' } },
  // Archives / compression. Zip-based formats are told apart by their first member's name.
  { test: (b) => isZip(b) && latin1(b, 30, 8) === 'mimetype' && latin1(b, 38, 20).startsWith('application/epub'), result: { kind: 'binary', description: 'EPUB document' } },
  { test: (b) => isZip(b) && zipHas(b, 'word/'), result: { kind: 'binary', description: 'Microsoft Word 2007+ document' } },
  { test: (b) => isZip(b) && zipHas(b, 'xl/'), result: { kind: 'binary', description: 'Microsoft Excel 2007+ spreadsheet' } },
  { test: (b) => isZip(b) && zipHas(b, 'ppt/'), result: { kind: 'binary', description: 'Microsoft PowerPoint 2007+ presentation' } },
  { test: (b) => isZip(b) && zipHas(b, '[Content_Types].xml'), result: { kind: 'binary', description: 'Microsoft OOXML document' } },
  { test: (b) => isZip(b) && zipHas(b, 'META-INF/'), result: { kind: 'binary', description: 'Java archive data (JAR)' } },
  { test: (b) => isZip(b), result: { kind: 'binary', description: 'Zip archive data' } },
  { test: (b) => startsWith(b, [0x1f, 0x8b]), result: { kind: 'binary', description: 'gzip compressed data' } },
  { test: (b) => startsWith(b, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]), result: { kind: 'binary', description: 'XZ compressed data' } },
  { test: (b) => ascii(b, 'BZh') && b[3] >= 0x31 && b[3] <= 0x39, result: { kind: 'binary', description: 'bzip2 compressed data' } },
  { test: (b) => startsWith(b, [0x28, 0xb5, 0x2f, 0xfd]), result: { kind: 'binary', description: 'Zstandard compressed data' } },
  { test: (b) => startsWith(b, [0x04, 0x22, 0x4d, 0x18]), result: { kind: 'binary', description: 'LZ4 compressed data' } },
  { test: (b) => startsWith(b, [0x5d, 0x00, 0x00]), result: { kind: 'binary', description: 'LZMA compressed data' } },
  { test: (b) => startsWith(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), result: { kind: 'binary', description: '7-zip archive data' } },
  { test: (b) => ascii(b, 'Rar!'), result: { kind: 'binary', description: 'RAR archive data' } },
  { test: (b) => ascii(b, 'ustar', 257), result: { kind: 'binary', description: 'POSIX tar archive' } },
  { test: (b) => ascii(b, 'MSCF'), result: { kind: 'binary', description: 'Microsoft Cabinet archive' } },
  { test: (b) => ascii(b, '!<arch>\n'), result: { kind: 'binary', description: 'ar archive (Debian package)' } },
  { test: (b) => startsWith(b, [0xed, 0xab, 0xee, 0xdb]), result: { kind: 'binary', description: 'RPM package' } },
  { test: (b) => ascii(b, 'CD001', 0x8001), result: { kind: 'binary', description: 'ISO 9660 CD-ROM filesystem data' } },
  // Documents / data
  { test: (b) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), result: { kind: 'binary', description: 'Composite Document File (MS Office 97-2003 / MSI)' } },
  { test: (b) => ascii(b, 'SQLite format 3'), result: { kind: 'binary', description: 'SQLite 3.x database' } },
  { test: (b) => ascii(b, 'PAR1'), result: { kind: 'binary', description: 'Apache Parquet' } },
  { test: (b) => startsWith(b, [0xd4, 0xc3, 0xb2, 0xa1]) || startsWith(b, [0x0a, 0x0d, 0x0d, 0x0a]), result: { kind: 'binary', description: 'pcap capture file' } },
  // Fonts
  { test: (b) => ascii(b, 'wOF2'), result: { kind: 'binary', description: 'Web Open Font Format (WOFF2)' } },
  { test: (b) => ascii(b, 'wOFF'), result: { kind: 'binary', description: 'Web Open Font Format (WOFF)' } },
  { test: (b) => ascii(b, 'OTTO'), result: { kind: 'binary', description: 'OpenType font data' } },
  { test: (b) => startsWith(b, [0x00, 0x01, 0x00, 0x00, 0x00]), result: { kind: 'binary', description: 'TrueType font data' } },
  // Executables / bytecode
  { test: (b) => ascii(b, 'MZ'), result: { kind: 'binary', description: 'PE32 executable (MS Windows)' } },
  { test: (b) => startsWith(b, [0x7f, 0x45, 0x4c, 0x46]), result: { kind: 'binary', description: 'ELF executable' } },
  { test: (b) => startsWith(b, [0xcf, 0xfa, 0xed, 0xfe]) || startsWith(b, [0xce, 0xfa, 0xed, 0xfe]), result: { kind: 'binary', description: 'Mach-O executable' } },
  { test: (b) => startsWith(b, [0xca, 0xfe, 0xba, 0xbe]), result: { kind: 'binary', description: 'compiled Java class data / Mach-O universal binary' } },
  { test: (b) => startsWith(b, [0x00, 0x61, 0x73, 0x6d]), result: { kind: 'binary', description: 'WebAssembly (wasm) binary module' } },
  { test: (b) => startsWith(b, [0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00]), result: { kind: 'binary', description: 'MS Windows shortcut' } }
]

function latin1(b: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...b.subarray(offset, offset + length))
}

function isZip(b: Uint8Array): boolean {
  return startsWith(b, [0x50, 0x4b, 0x03, 0x04])
}

/** Whether a member name appears among the zip's local headers in the sample. */
function zipHas(b: Uint8Array, name: string): boolean {
  return latin1(b, 0, Math.min(b.length, 4096)).includes(name)
}

/** Decodes as text if the bytes look like text at all; null for binary. */
function decodeText(b: Uint8Array): { text: string; encoding: string } | null {
  if (startsWith(b, [0xff, 0xfe]) || startsWith(b, [0xfe, 0xff])) {
    const le = b[0] === 0xff
    return { text: new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(b.subarray(2)), encoding: 'UTF-16' }
  }
  const body = startsWith(b, [0xef, 0xbb, 0xbf]) ? b.subarray(3) : b
  if (body.includes(0)) return null
  let text: string
  try {
    // A multi-byte character may be cut at the end of the sample; drop up to 3 trailing bytes on failure.
    text = decodeUtf8Loose(body)
  } catch {
    return null
  }
  // Control characters other than tab/newline/CR/FF/ESC mean binary.
  let control = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x20 && c !== 9 && c !== 10 && c !== 13 && c !== 12 && c !== 27) control++
  }
  if (control > Math.max(2, text.length * 0.01)) return null
  const isAscii = body.every((v) => v < 0x80)
  return { text, encoding: isAscii ? 'ASCII' : 'UTF-8' }
}

function decodeUtf8Loose(b: Uint8Array): string {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (let cut = 0; cut <= 3 && cut < b.length; cut++) {
    try {
      return decoder.decode(b.subarray(0, b.length - cut))
    } catch {
      /* try a shorter slice */
    }
  }
  throw new Error('not UTF-8')
}

const SHEBANG_NAMES: [RegExp, string][] = [
  [/python/, 'Python script'],
  [/node|deno|bun/, 'Node.js script'],
  [/\b(ba|z|k|da|fi)?sh\b/, 'shell script'],
  [/perl/, 'Perl script'],
  [/ruby/, 'Ruby script'],
  [/pwsh|powershell/, 'PowerShell script']
]

/** Line patterns that are strong evidence of program source (in the style of libmagic's text tests). */
const CODE_LINE_PATTERNS: RegExp[] = [
  /^\s*#\s*(include|define|ifndef|ifdef|endif|pragma)\b/,
  /^\s*(import\s+[\w.{},*\s]+\s+from\s+['"]|import\s+['"]|export\s+(default\s+)?(function|class|const|let|var|interface|type)\b)/,
  /^\s*(from\s+[\w.]+\s+import\s+|import\s+[\w.]+(\s+as\s+\w+)?\s*$)/,
  /^\s*(async\s+)?def\s+\w+\s*\(.*\)\s*(->\s*[^:]+)?:\s*$/,
  /^\s*class\s+\w+(\s*\(.*\))?\s*:\s*$/,
  /^\s*(public|private|protected)\s+(static\s+)?[\w<>[\],\s]+\s+\w+\s*\(/,
  /^\s*(public\s+)?(abstract\s+|sealed\s+|static\s+)?(class|interface|struct|enum)\s+\w+[^;]*\{?\s*$/,
  /^\s*(using\s+[\w.]+;|namespace\s+[\w.]+|package\s+[\w.]+;?)\s*$/,
  /^\s*func\s+(\(\w+\s+\*?\w+\)\s*)?\w+\s*\(/,
  /^\s*(pub\s+)?(fn|impl|trait|mod)\s+\w+/,
  /^\s*(async\s+)?function\s*\*?\s*\w*\s*\(/,
  /^\s*(const|let|var)\s+[\w{}[\],\s]+\s*=\s*.+[;,]?\s*$/,
  /^\s*(module\.exports|exports\.\w+)\s*=/,
  /\brequire\(['"][^'"]+['"]\)/,
  /^\s*(if|while|for|switch)\s*\(.*\)\s*\{\s*$/,
  /^\s*\}\s*(else\b.*)?\{?\s*$/,
  /^\s*(return\b.*;|\w+\(.*\);)\s*$/,
  /^\s*(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE)\b/i,
  /^\s*<\?php\b/,
  /^\s*(param\s*\(|function\s+[\w-]+\s*\{|\$\w+\s*=\s*.+)/
]

/** Markdown fenced blocks contain code, but the document itself is text. */
function stripFencedBlocks(text: string): string {
  return text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1\s*$/gm, '')
}

function classifyText(text: string, encoding: string): SniffResult {
  const head = text.trimStart()
  const lower = head.slice(0, 1024).toLowerCase()
  const plain = `${encoding} text`

  if (head.startsWith('#!')) {
    const line = head.split('\n', 1)[0]
    const match = SHEBANG_NAMES.find(([re]) => re.test(line))
    return { kind: 'code', description: match ? match[1] : 'script text executable' }
  }
  if (/^<svg[\s>]/.test(lower) || (/^<\?xml/.test(lower) && lower.includes('<svg'))) {
    return { kind: 'image', description: 'SVG Scalable Vector Graphics image', mime: 'image/svg+xml' }
  }
  if (/^<!doctype\s+html|^<html[\s>]|^<head[\s>]|^<body[\s>]/.test(lower) || /<(html|head|body|script|div)[\s>]/.test(lower.slice(0, 256))) {
    return { kind: 'code', description: 'HTML document' }
  }
  if (/^<\?xml\s/.test(lower)) return { kind: 'code', description: 'XML document' }
  if (/^<\?php\b/.test(lower)) return { kind: 'code', description: 'PHP script' }
  if (/^[[{]/.test(head)) {
    try {
      JSON.parse(text)
      return { kind: 'code', description: 'JSON data' }
    } catch {
      /* not (complete) JSON — fall through to the line heuristics */
    }
  }

  const lines = stripFencedBlocks(text)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
  if (lines.length === 0) return { kind: 'text', description: plain }
  const codeLines = lines.filter((l) => CODE_LINE_PATTERNS.some((re) => re.test(l))).length
  // Statement-ish lines (ending in `;` / `{`, or closing `}`) across many lines are typical of C-family code / CSS.
  const statementLines = lines.filter((l) => /[;{]\s*$|^\s*\}/.test(l)).length
  if (codeLines >= 2 && codeLines / lines.length >= 0.1) return { kind: 'code', description: 'source code' }
  if (lines.length >= 4 && statementLines / lines.length >= 0.4) return { kind: 'code', description: 'source code' }
  return { kind: 'text', description: plain }
}

/** Classifies a file from (a prefix of) its contents. */
export function sniffContent(bytes: Uint8Array): SniffResult {
  if (bytes.length === 0) return { kind: 'empty', description: 'empty' }
  for (const magic of MAGICS) {
    if (magic.test(bytes)) return magic.result
  }
  const decoded = decodeText(bytes)
  if (!decoded) return { kind: 'binary', description: 'data' }
  return classifyText(decoded.text, decoded.encoding)
}
