import type { PluginManifest } from '@sdk/manifest.schema'

/**
 * The Content-Security-Policy every plugin-app:// response carries.
 *
 * A plugin reaches the internet only where its manifest says (`network` domains): through
 * `window.brighterm.net.fetch` (checked in main), or directly with fetch / <img> / <video>
 * to those https domains — weather icons, a translation API. Anything else (another site,
 * an external script, a form posting somewhere) is blocked, so a plugin can't send what it
 * reads from the user's folders anywhere undeclared. Inline <script>/<style> stay allowed:
 * the AI often writes them, and they can't load anything the policy doesn't allow.
 */
export function pluginCsp(manifest: Pick<PluginManifest, 'permissions'>): string {
  const domains = manifest.permissions
    .filter((p): p is Extract<PluginManifest['permissions'][number], { type: 'network' }> => p.type === 'network')
    .flatMap((p) => p.domains)
    .map((d) => d.toLowerCase())
    // The schema already only accepts host names; this keeps the header well-formed regardless.
    .filter((d) => /^[a-z0-9.-]+$/.test(d))
  const https = [...new Set(domains)].map((d) => `https://${d}`)
  const wss = [...new Set(domains)].map((d) => `wss://${d}`)
  const list = (...sources: string[]): string => sources.filter(Boolean).join(' ')
  return [
    "default-src 'self'",
    `script-src ${list("'self'", "'unsafe-inline'")}`,
    `style-src ${list("'self'", "'unsafe-inline'")}`,
    `img-src ${list("'self'", 'data:', 'blob:', ...https)}`,
    `media-src ${list("'self'", 'data:', 'blob:', ...https)}`,
    `font-src ${list("'self'", 'data:')}`,
    `connect-src ${list("'self'", ...https, ...wss)}`,
    `frame-src ${list("'self'", 'blob:')}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}

/** The same response with the plugin's CSP added (responses from net.fetch have immutable headers). */
export function withCsp(response: Response, csp: string): Response {
  const headers = new Headers(response.headers)
  headers.set('content-security-policy', csp)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
