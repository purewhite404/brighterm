import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Auth, google as GoogleApis } from 'googleapis'
import { shell } from 'electron'
import { calendarEventsToCards, gmailMessagesToCards } from './googleCardMapper'
import type { GoogleCredentialsStore } from './googleCredentialsStore'
import type { Card } from '@shared/types'
import type { CalendarEvent } from '@shared/apiTypes'

/**
 * Google Calendar + Gmail -> HQ cards, via the standard "installed app"
 * loopback OAuth flow (no embedded browser — Google blocks those for OAuth).
 * The user supplies their own OAuth client id/secret (from a "Desktop app"
 * credential in Google Cloud Console); Brighterm never ships a shared one.
 *
 * NOTE: written and reviewed against the googleapis/OAuth2 docs, but not
 * exercised against a real Google account in this environment — there was
 * no test Google Cloud project/credentials available to verify against.
 */

/**
 * googleapis is loaded on first use: requiring it costs the main process ~80 MB and ~0.8 s,
 * and most sessions never connect Google.
 */
let googleApis: Promise<typeof GoogleApis> | null = null
function loadGoogleApis(): Promise<typeof GoogleApis> {
  googleApis ??= import('googleapis').then((m) => m.google)
  return googleApis
}

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly'
]

export class GoogleConnector {
  constructor(private readonly store: GoogleCredentialsStore) {}

  isConnected(): boolean {
    return this.store.isConnected()
  }

  hasClientCredentials(): boolean {
    const creds = this.store.read()
    return !!(creds?.clientId && creds?.clientSecret)
  }

  setClientCredentials(clientId: string, clientSecret: string): void {
    this.store.update({ clientId, clientSecret })
  }

  /** Runs the loopback OAuth flow end-to-end: open browser -> catch redirect -> exchange code -> store refresh token. */
  async connect(): Promise<void> {
    const creds = this.store.read()
    if (!creds?.clientId || !creds?.clientSecret) {
      throw new Error('Google の Client ID と Client Secret を先に入力してください。')
    }

    const google = await loadGoogleApis()
    const server = http.createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const redirectUri = `http://127.0.0.1:${port}/oauth2callback`

    const oauth2Client = new google.auth.OAuth2(creds.clientId, creds.clientSecret, redirectUri)
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES
    })

    const codePromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('認証がタイムアウトしました（5分）。もう一度お試しください。'))
        server.close()
      }, 5 * 60 * 1000)

      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', redirectUri)
        if (url.pathname !== '/oauth2callback') {
          res.writeHead(404).end()
          return
        }
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(
          '<html><body style="font-family:sans-serif;padding:2em">' +
            '<h2>認証が完了しました</h2><p>このタブは閉じて Brighterm に戻ってください。</p>' +
            '</body></html>'
        )
        clearTimeout(timeout)
        if (error) reject(new Error(String(error)))
        else if (code) resolve(code)
        else reject(new Error('認証コードを受け取れませんでした。'))
      })
    })

    await shell.openExternal(authUrl)

    try {
      const code = await codePromise
      const { tokens } = await oauth2Client.getToken(code)
      if (!tokens.refresh_token) {
        throw new Error(
          '既に承認済みのため refresh token を取得できませんでした。Google アカウントの' +
            '「サードパーティ製アプリとサービスへのアクセス」からこのアプリのアクセス権を一度取り消し、' +
            'もう一度お試しください。'
        )
      }
      this.store.update({ refreshToken: tokens.refresh_token })
    } finally {
      server.close()
    }
  }

  /** Forgets the refresh token (and, for simplicity, the client id/secret — re-entering them is quick). */
  disconnect(): void {
    this.store.clear()
  }

  private async authClient(): Promise<{ google: typeof GoogleApis; auth: Auth.OAuth2Client } | null> {
    const creds = this.store.read()
    if (!creds?.refreshToken) return null
    const google = await loadGoogleApis()
    const client = new google.auth.OAuth2(creds.clientId, creds.clientSecret)
    client.setCredentials({ refresh_token: creds.refreshToken })
    return { google, auth: client }
  }

  /** Events on the primary calendar between two instants, for the built-in Calendar tile. */
  async listEvents(timeMinIso: string, timeMaxIso: string): Promise<CalendarEvent[]> {
    const client = await this.authClient()
    if (!client) return []
    const { google, auth } = client
    const calendar = google.calendar({ version: 'v3', auth })
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMinIso,
      timeMax: timeMaxIso,
      maxResults: 250,
      singleEvents: true,
      orderBy: 'startTime'
    })
    return (res.data.items ?? []).flatMap((e) => {
      const start = e.start?.dateTime ?? e.start?.date
      if (!e.id || !start) return []
      return [
        {
          id: e.id,
          title: e.summary || '(タイトルなし)',
          start,
          end: e.end?.dateTime ?? e.end?.date ?? start,
          allDay: !e.start?.dateTime,
          url: e.htmlLink ?? undefined
        }
      ]
    })
  }

  async fetchCards(): Promise<Card[]> {
    const client = await this.authClient()
    if (!client) return []
    const { google, auth } = client

    const calendar = google.calendar({ version: 'v3', auth })
    const gmail = google.gmail({ version: 'v1', auth })

    const now = new Date()
    const horizon = new Date(now.getTime() + 48 * 60 * 60 * 1000)

    const [eventsRes, messageListRes] = await Promise.all([
      calendar.events.list({
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: horizon.toISOString(),
        maxResults: 8,
        singleEvents: true,
        orderBy: 'startTime'
      }),
      gmail.users.messages.list({ userId: 'me', q: 'is:unread is:important newer_than:2d', maxResults: 8 })
    ])

    const calendarCards = calendarEventsToCards(eventsRes.data.items ?? [], now)

    const messageRefs = messageListRes.data.messages ?? []
    const messages = await Promise.all(
      messageRefs
        .filter((m): m is { id: string } => !!m.id)
        .map((m) =>
          gmail.users.messages
            .get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['From', 'Subject'] })
            .then((r) => r.data)
        )
    )
    const mailCards = gmailMessagesToCards(messages)

    return [...calendarCards, ...mailCards]
  }
}
