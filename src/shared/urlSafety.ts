/**
 * Which URLs may leave the app or be loaded into a web view.
 *
 * `shell.openExternal` hands a URL to the OS: a `file:` URL to an .exe, a UNC
 * path or a protocol handler such as `ms-msdt:` would start a program. Only
 * the shell's own fixed OS-settings shortcuts (settingsShortcuts.ts) go there
 * with other schemes; everything that comes from a page, a plugin or a card
 * goes through these checks.
 */

function parse(url: unknown): URL | null {
  if (typeof url !== 'string') return null
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** http(s) with a host — what the Browser and web views may load, and what a plugin may link to. */
export function isWebUrl(url: unknown): boolean {
  const parsed = parse(url)
  return !!parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== ''
}

/** What may be opened in the OS's default app: web pages and mail links. */
export function isSafeExternalUrl(url: unknown): boolean {
  const parsed = parse(url)
  return !!parsed && (isWebUrl(url) || parsed.protocol === 'mailto:')
}
