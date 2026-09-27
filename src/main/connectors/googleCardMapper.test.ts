import { describe, expect, it } from 'vitest'
import { calendarEventsToCards, gmailMessagesToCards, type CalendarEventLike, type GmailMessageLike } from './googleCardMapper'

const NOW = new Date('2026-01-01T10:00:00Z')

function inMinutes(mins: number): string {
  return new Date(NOW.getTime() + mins * 60000).toISOString()
}

describe('calendarEventsToCards', () => {
  it('maps a basic event with a dateTime start', () => {
    const events: CalendarEventLike[] = [
      { id: 'e1', summary: 'Standup', start: { dateTime: inMinutes(120) }, htmlLink: 'https://cal/e1' }
    ]
    const cards = calendarEventsToCards(events, NOW)
    expect(cards).toHaveLength(1)
    expect(cards[0].id).toBe('google-calendar:e1')
    expect(cards[0].source).toBe('google-calendar')
    expect(cards[0].title).toBe('Standup')
    expect(cards[0].priority).toBe('normal')
    expect(cards[0].action).toEqual({ label: 'カレンダーを開く', url: 'https://cal/e1' })
  })

  it('escalates priority to high within the next hour', () => {
    const events: CalendarEventLike[] = [{ id: 'e1', summary: 'x', start: { dateTime: inMinutes(30) } }]
    expect(calendarEventsToCards(events, NOW)[0].priority).toBe('high')
  })

  it('escalates priority to urgent within 5 minutes or already started', () => {
    const soon: CalendarEventLike[] = [{ id: 'e1', summary: 'x', start: { dateTime: inMinutes(3) } }]
    expect(calendarEventsToCards(soon, NOW)[0].priority).toBe('urgent')

    const started: CalendarEventLike[] = [{ id: 'e2', summary: 'x', start: { dateTime: inMinutes(-10) } }]
    expect(calendarEventsToCards(started, NOW)[0].priority).toBe('urgent')
    expect(calendarEventsToCards(started, NOW)[0].detail).toBe('進行中')
  })

  it('prefers the Meet link over the calendar link when both are present', () => {
    const events: CalendarEventLike[] = [
      { id: 'e1', summary: 'x', start: { dateTime: inMinutes(10) }, hangoutLink: 'https://meet/x', htmlLink: 'https://cal/x' }
    ]
    expect(calendarEventsToCards(events, NOW)[0].action).toEqual({ label: 'Meet に参加', url: 'https://meet/x' })
  })

  it('falls back to an all-day event using the "date" field', () => {
    const events: CalendarEventLike[] = [{ id: 'e1', summary: 'Holiday', start: { date: '2026-01-02' } }]
    const cards = calendarEventsToCards(events, NOW)
    expect(cards).toHaveLength(1)
    expect(cards[0].title).toBe('Holiday')
  })

  it('uses a placeholder title when summary is missing', () => {
    const events: CalendarEventLike[] = [{ id: 'e1', start: { dateTime: inMinutes(10) } }]
    expect(calendarEventsToCards(events, NOW)[0].title).toBe('(タイトルなし)')
  })

  it('skips events with no id or no start time', () => {
    const events: CalendarEventLike[] = [{ summary: 'no id', start: { dateTime: inMinutes(10) } }, { id: 'e2', summary: 'no start' }]
    expect(calendarEventsToCards(events, NOW)).toEqual([])
  })

  it('has no action when neither hangoutLink nor htmlLink is present', () => {
    const events: CalendarEventLike[] = [{ id: 'e1', summary: 'x', start: { dateTime: inMinutes(10) } }]
    expect(calendarEventsToCards(events, NOW)[0].action).toBeUndefined()
  })
})

describe('gmailMessagesToCards', () => {
  function message(id: string, from: string, subject: string): GmailMessageLike {
    return {
      id,
      payload: {
        headers: [
          { name: 'From', value: from },
          { name: 'Subject', value: subject }
        ]
      }
    }
  }

  it('maps subject and a cleaned-up sender name', () => {
    const cards = gmailMessagesToCards([message('m1', '"Jane Doe" <jane@example.com>', 'Please review')])
    expect(cards).toEqual([
      {
        id: 'google-mail:m1',
        source: 'google-mail',
        priority: 'normal',
        title: 'Please review',
        detail: 'Jane Doe',
        action: { label: 'Gmail で開く', url: 'https://mail.google.com/mail/u/0/#inbox/m1' }
      }
    ])
  })

  it('falls back to the raw From header when there is no quoted display name', () => {
    const cards = gmailMessagesToCards([message('m1', 'jane@example.com', 'Hi')])
    expect(cards[0].detail).toBe('jane@example.com')
  })

  it('uses placeholders when headers are missing', () => {
    const cards = gmailMessagesToCards([{ id: 'm1', payload: { headers: [] } }])
    expect(cards[0].title).toBe('(件名なし)')
    expect(cards[0].detail).toBe('(不明な送信者)')
  })

  it('skips messages with no id', () => {
    expect(gmailMessagesToCards([{ payload: { headers: [] } }])).toEqual([])
  })

  it('is case-insensitive when matching header names', () => {
    const cards = gmailMessagesToCards([
      { id: 'm1', payload: { headers: [{ name: 'subject', value: 'lowercase header' }] } }
    ])
    expect(cards[0].title).toBe('lowercase header')
  })
})
