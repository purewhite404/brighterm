import { homedir } from 'node:os'
import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { Card } from '@shared/types'
import type { Send } from '../window'
import { parseBundle } from './bundleParser'
import { suggestFolders } from './folderSuggest'
import { handleId } from './handleUtil'
import type { PluginHostApiBridge } from './hostApiBridge'
import type { PluginHost } from './pluginHost'
import { pluginAppUrl } from './protocol'

/** Installing / enabling / rolling back plugins, and every `window.brighterm.*` call a plugin makes. */
export function registerPluginsIpc(
  pluginHost: PluginHost,
  hostApiBridge: PluginHostApiBridge,
  send: Send,
  /** Bundled plugins (Notes, Slack) are reinstalled at every startup — they can be disabled, not deleted. */
  bundledIds: string[]
): void {
  ipcMain.handle(IPC.pluginsList, () => pluginHost.list().map((item) => ({ ...item, bundled: bundledIds.includes(item.manifest.id) })))
  ipcMain.handle(IPC.pluginsValidateBundle, (_event, rawText: string) => {
    const parsed = parseBundle(rawText)
    if (!parsed.ok) return { ok: false, errors: parsed.errors.map((message) => ({ message })), warnings: [] }
    return pluginHost.validate(parsed.files)
  })
  ipcMain.handle(IPC.pluginsInstallFromBundle, (_event, rawText: string) => {
    const parsed = parseBundle(rawText)
    if (!parsed.ok) return { ok: false, errors: parsed.errors.map((message) => ({ message })), warnings: [] }
    const result = pluginHost.install(parsed.files)
    if (result.ok) send(IPC.pluginsChanged)
    return result
  })
  ipcMain.handle(IPC.pluginsSetEnabled, (_event, id: string, enabled: boolean) => {
    pluginHost.setEnabled(id, enabled)
    send(IPC.pluginsChanged)
  })
  ipcMain.handle(IPC.pluginsRollback, (_event, id: string, toVersion: string) => {
    const ok = pluginHost.rollback(id, toVersion)
    if (ok) send(IPC.pluginsChanged)
    return ok
  })
  ipcMain.handle(IPC.pluginsUninstall, (_event, id: string) => {
    pluginHost.uninstall(id)
    send(IPC.pluginsChanged)
  })
  ipcMain.handle(IPC.pluginsAppUrl, (_event, id: string) => pluginAppUrl(id))
  // The folder bar above a plugin (and Files → "open in Notes"): only the shell calls these, never the plugin.
  ipcMain.handle(IPC.pluginsGrantFolder, (_event, pluginId: string, path: string) =>
    hostApiBridge.grantFolder(pluginId, path)
  )
  ipcMain.handle(IPC.pluginsFolderBarPath, (_event, pluginId: string, handle: unknown) =>
    hostApiBridge.folderBarPath(pluginId, handle)
  )
  ipcMain.handle(IPC.pluginsSuggestFolders, (_event, input: string) => suggestFolders(String(input ?? ''), homedir()))
  ipcMain.handle(IPC.pluginsHostCall, async (_event, pluginId: string, method: string, args: unknown[]) =>
    callHostApi(hostApiBridge, send, pluginId, method, args)
  )
}

/** Dispatches a `window.brighterm.*` call by the exact method name bridgeScript.ts sends. */
async function callHostApi(
  hostApiBridge: PluginHostApiBridge,
  send: Send,
  pluginId: string,
  method: string,
  args: unknown[]
): Promise<unknown> {
  switch (method) {
    case 'storage.get':
      return hostApiBridge.storageGet(pluginId, args[0] as string)
    case 'storage.set':
      return hostApiBridge.storageSet(pluginId, args[0] as string, args[1])
    case 'storage.remove':
      return hostApiBridge.storageRemove(pluginId, args[0] as string)
    case 'storage.keys':
      return hostApiBridge.storageKeys(pluginId)
    case 'fs.pickFolder':
      return hostApiBridge.pickFolder(pluginId)
    case 'fs.listFiles':
      return hostApiBridge.listFiles(pluginId, handleId(args[0]), args[1])
    case 'fs.fileUrl':
      return hostApiBridge.fileUrl(pluginId, handleId(args[0]), args[1])
    case 'fs.readFile':
      return hostApiBridge.readFile(pluginId, handleId(args[0]), args[1])
    case 'fs.writeFile':
      return hostApiBridge.writeFile(pluginId, handleId(args[0]), args[1], args[2] as string)
    case 'fs.deleteFile':
      return hostApiBridge.deleteFile(pluginId, handleId(args[0]), args[1])
    case 'net.fetch':
      return hostApiBridge.netFetch(
        pluginId,
        args[0] as string,
        args[1] as { method?: string; headers?: Record<string, string>; body?: string } | undefined
      )
    case 'hq.publishCard':
      return hostApiBridge.publishCard(pluginId, args[0] as Omit<Card, 'source'>)
    case 'hq.clearCard':
      return hostApiBridge.clearCard(pluginId, args[0] as string)
    case 'notify':
      return hostApiBridge.notify(pluginId, args[0] as string, args[1] as string | undefined)
    case 'openTile':
      send(IPC.pluginsRequestOpenTile, args[0] as string)
      return undefined
    default:
      throw new Error(`window.brighterm.${method} という機能はありません（host-api.d.ts にある関数だけが使えます）`)
  }
}
