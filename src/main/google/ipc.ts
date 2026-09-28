import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { Send } from '../window'
import type { GoogleConnector } from './google'

const GOOGLE_POLL_MS = 5 * 60 * 1000

/**
 * Google (optional): the Calendar tile's events, and HQ cards for upcoming
 * events and mail that needs attention, re-fetched every 5 minutes.
 */
export function registerGoogleIpc(
  googleConnector: GoogleConnector,
  send: Send
): { startPolling: () => void; stopPolling: () => void } {
  let lastCardIds: Set<string> = new Set()
  let pollTimer: NodeJS.Timeout | null = null

  async function pollCards(): Promise<void> {
    if (!googleConnector.isConnected()) return
    try {
      const cards = await googleConnector.fetchCards()
      const newIds = new Set(cards.map((c) => c.id))
      for (const id of lastCardIds) {
        if (!newIds.has(id)) send(IPC.hqCardCleared, id)
      }
      for (const card of cards) send(IPC.hqCardPublished, card)
      lastCardIds = newIds
    } catch (err) {
      console.error('[Google] failed to fetch HQ cards:', err)
    }
  }

  ipcMain.handle(IPC.googleHasClientCredentials, () => googleConnector.hasClientCredentials())
  ipcMain.handle(IPC.googleIsConnected, () => googleConnector.isConnected())
  ipcMain.handle(IPC.googleSetClientCredentials, (_event, clientId: string, clientSecret: string) => {
    googleConnector.setClientCredentials(clientId, clientSecret)
  })
  ipcMain.handle(IPC.googleConnect, async () => {
    await googleConnector.connect()
    await pollCards()
  })
  ipcMain.handle(IPC.googleListEvents, (_event, timeMinIso: string, timeMaxIso: string) =>
    googleConnector.listEvents(timeMinIso, timeMaxIso)
  )
  ipcMain.handle(IPC.googleDisconnect, () => {
    googleConnector.disconnect()
    for (const id of lastCardIds) send(IPC.hqCardCleared, id)
    lastCardIds = new Set()
  })

  return {
    startPolling: () => {
      void pollCards()
      pollTimer = setInterval(() => void pollCards(), GOOGLE_POLL_MS)
    },
    stopPolling: () => {
      if (pollTimer) clearInterval(pollTimer)
    }
  }
}
