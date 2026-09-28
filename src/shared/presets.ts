/**
 * Built-in choices offered in Settings, shared by main and renderer: which web
 * mail the Mail tile opens, and which search engine the Browser uses.
 */

import type { AppConfig, SearchEngineId } from './types'

// ---------------------------------------------------------------------------
// Mail providers
// ---------------------------------------------------------------------------

export interface MailProvider {
  id: string
  label: string
  url: string
  /** Session partition — providers sharing a login (e.g. Google) share one. */
  partitionId: string
}

export const MAIL_PROVIDERS: MailProvider[] = [
  { id: 'gmail', label: 'Gmail', url: 'https://mail.google.com/mail/u/0/', partitionId: 'google' },
  { id: 'outlook', label: 'Outlook.com', url: 'https://outlook.live.com/mail/', partitionId: 'microsoft' },
  { id: 'outlook365', label: 'Outlook (Microsoft 365 / 職場・学校)', url: 'https://outlook.office.com/mail/', partitionId: 'microsoft' },
  { id: 'yahoo', label: 'Yahoo!メール', url: 'https://mail.yahoo.co.jp/', partitionId: 'yahoo' },
  { id: 'icloud', label: 'iCloud メール', url: 'https://www.icloud.com/mail/', partitionId: 'icloud' },
  { id: 'proton', label: 'Proton Mail', url: 'https://mail.proton.me/', partitionId: 'proton' }
]

export function resolveMail(mail: AppConfig['mail']): { url: string; partitionId: string; label: string } {
  if (mail.provider === 'custom' && mail.customUrl) {
    return { url: mail.customUrl, partitionId: 'mail-custom', label: 'Mail' }
  }
  const preset = MAIL_PROVIDERS.find((p) => p.id === mail.provider) ?? MAIL_PROVIDERS[0]
  return { url: preset.url, partitionId: preset.partitionId, label: preset.label }
}

// ---------------------------------------------------------------------------
// Search engines
// ---------------------------------------------------------------------------

export const SEARCH_ENGINES: Record<SearchEngineId, { label: string; home: string; query: (q: string) => string }> = {
  duckduckgo: {
    label: 'DuckDuckGo',
    home: 'https://duckduckgo.com/',
    query: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`
  },
  google: {
    label: 'Google',
    home: 'https://www.google.com/',
    query: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`
  },
  bing: { label: 'Bing', home: 'https://www.bing.com/', query: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
  brave: {
    label: 'Brave Search',
    home: 'https://search.brave.com/',
    query: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`
  }
}

/** Address-bar input -> URL: things that look like URLs are opened, anything else is searched. */
export function resolveAddressInput(input: string, engine: SearchEngineId): string {
  const text = input.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text
  if (/^localhost(:\d+)?(\/.*)?$/i.test(text)) return `http://${text}`
  if (!/\s/.test(text) && /^[^/\s]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text)) return `https://${text}`
  return SEARCH_ENGINES[engine].query(text)
}
