import type { Card } from '@shared/types'

/**
 * Pure mapping from Google API response shapes to Brighterm's normalized
 * Card. Kept separate from the OAuth/network glue in google.ts so it can be
 * unit-tested without real credentials or network access.
 */

// Minimal shape of what we read from Calendar API's events.list response —
// not the full googleapis type, just the fields we use.
export interface CalendarEventLike {
  id?: string | null
  summary?: string | null
  start?: { dateTime?: string | null; date?: string | null } | null
  end?: { dateTime?: string | null; date?: string | null } | null
  hangoutLink?: string | null
  htmlLink?: string | null
}

export interface GmailMessageLike {
  id?: string | null
  snippet?: string | null
  payload?: {
    headers?: Array<{ name?: string | null; value?: string | null }> | null
  } | null
}

function headerValue(message: GmailMessageLike, name: string): string | undefined {
  return message.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined
}

/** Minutes from `now` until an event starts (negative if it already started). */
function minutesUntil(startIso: string, now: Date): number {
  return (new Date(startIso).getTime() - now.getTime()) / 60000
}

/**
 * Turns upcoming calendar events into cards. Priority escalates as the event
 * gets closer: normal >1h away, high within the next hour, urgent once it
 * has started or is starting within 5 minutes.
 */
export function calendarEventsToCards(events: CalendarEventLike[], now: Date = new Date()): Card[] {
  const cards: Card[] = []
  for (const event of events) {
    const startIso = event.start?.dateTime ?? event.start?.date
    if (!startIso || !event.id) continue

    const minsUntil = minutesUntil(startIso, now)
    const priority: Card['priority'] = minsUntil <= 5 ? 'urgent' : minsUntil <= 60 ? 'high' : 'normal'
    const title = event.summary || '(タイトルなし)'
    const detail =
      minsUntil <= 0
        ? '進行中'
        : minsUntil < 60
          ? `あと ${Math.round(minsUntil)} 分`
          : `${new Date(startIso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`

    cards.push({
      id: `google-calendar:${event.id}`,
      source: 'google-calendar',
      priority,
      title,
      detail,
      timestamp: new Date(startIso).getTime(),
      action: event.hangoutLink
        ? { label: 'Meet に参加', url: event.hangoutLink }
        : event.htmlLink
          ? { label: 'カレンダーを開く', url: event.htmlLink }
          : undefined
    })
  }
  return cards
}

/** Turns unread/important Gmail messages into cards (one per message, capped by the caller's query). */
export function gmailMessagesToCards(messages: GmailMessageLike[]): Card[] {
  const cards: Card[] = []
  for (const message of messages) {
    if (!message.id) continue
    const from = headerValue(message, 'From') ?? '(不明な送信者)'
    const subject = headerValue(message, 'Subject') ?? '(件名なし)'
    // "Name <email>" -> just the display name, for a shorter card.
    const fromName = from.replace(/<.*>/, '').trim().replace(/^"|"$/g, '') || from

    cards.push({
      id: `google-mail:${message.id}`,
      source: 'google-mail',
      priority: 'normal',
      title: subject,
      detail: fromName,
      action: { label: 'Gmail で開く', url: `https://mail.google.com/mail/u/0/#inbox/${message.id}` }
    })
  }
  return cards
}
