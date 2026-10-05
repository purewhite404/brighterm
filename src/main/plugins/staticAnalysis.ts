/**
 * Best-effort static scan of a plugin's JS/HTML source, run before it's ever
 * executed. This is NOT a sandbox substitute — the iframe sandbox, the
 * plugin's CSP (pluginCsp.ts) and the declared-domains-only fetch bridge
 * are what actually contain a plugin.
 * This scan exists to reject obviously-wrong or obviously-hostile code
 * early, with a clear message the AI (or the user) can act on, rather than
 * silently letting it fail once loaded — or worse, having something subtle
 * make it into the sandbox at all.
 */

export interface StaticFinding {
  file: string
  message: string
}

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /\beval\s*\(/, message: 'eval(...) は使えません' },
  { pattern: /new\s+Function\s*\(/, message: 'new Function(...) は使えません' },
  { pattern: /document\.write\s*\(/, message: 'document.write(...) は使えません' },
  { pattern: /\brequire\s*\(/, message: 'require(...) は使えません（プラグインから Node.js は使えません）' },
  { pattern: /\bprocess\s*\./, message: 'process.* は使えません（プラグインから Node.js は使えません）' },
  { pattern: /window\.brighterm\s*=/, message: 'window.brighterm を上書きしてはいけません' },
  {
    pattern: /<script[^>]*\ssrc\s*=\s*["']https?:\/\//i,
    message: '外部のスクリプト（<script src="http(s)://...">）は読み込めません。コードはプラグイン内のファイルにしてください'
  }
]

const HOSTNAME_FROM_URL = /(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(\s*["'`](https?:\/\/|wss?:\/\/)([^/"'`]+)/g

export function scanFileForForbiddenPatterns(path: string, content: string): StaticFinding[] {
  const findings: StaticFinding[] = []
  for (const { pattern, message } of FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) findings.push({ file: path, message })
  }
  return findings
}

/** Every hostname referenced by a network call literal in the source, best-effort. */
export function extractReferencedHostnames(content: string): string[] {
  const hosts = new Set<string>()
  for (const match of content.matchAll(HOSTNAME_FROM_URL)) {
    const hostname = match[2].split(':')[0] // drop a port if present
    hosts.add(hostname.toLowerCase())
  }
  return [...hosts]
}

export interface UndeclaredDomainFinding {
  file: string
  hostname: string
}

/** Cross-checks referenced hostnames against the manifest's declared `network` permission domains. */
export function findUndeclaredDomains(
  files: Array<{ path: string; content: string }>,
  declaredDomains: string[]
): UndeclaredDomainFinding[] {
  const allowed = new Set(declaredDomains.map((d) => d.toLowerCase()))
  const findings: UndeclaredDomainFinding[] = []
  for (const file of files) {
    if (!/\.(js|html)$/.test(file.path)) continue
    for (const hostname of extractReferencedHostnames(file.content)) {
      if (!allowed.has(hostname)) {
        findings.push({ file: file.path, hostname })
      }
    }
  }
  return findings
}
