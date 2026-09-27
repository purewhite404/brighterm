import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AppConfig, type Rect } from '@shared/types'
import type { ShellOption } from '../main/ptyManager'
import type { SystemSnapshot } from '../main/sysMonitor'
import type { DirEntry } from '../main/fsService'
import type { SettingsShortcut } from '../main/settingsShortcuts'
import type { EtcFileDescriptor, DiffOp, HistoryEntry, AugeasNode } from '../main/etc/etcService'
import type { ExecResult } from '../main/etc/validators'
import type { PluginListItem, PluginInstallResult } from '../main/plugins/pluginHost'
import type { Card } from '@shared/types'
import type { CalendarEvent } from '../main/connectors/google'

/**
 * The only surface the renderer sees. contextIsolation is on, so this is the
 * sole bridge between the sandboxed UI and the main process — every call is
 * an explicit, typed function, never a raw ipcRenderer passthrough.
 */
const api = {
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.configGet),
    set: (patch: Partial<AppConfig>): Promise<AppConfig> => ipcRenderer.invoke(IPC.configSet, patch)
  },

  tile: {
    create: (args: { tileId: string; kind: string; url?: string; partitionId?: string; compactCss?: string }) =>
      ipcRenderer.invoke(IPC.tileCreate, args),
    close: (tileId: string) => ipcRenderer.invoke(IPC.tileClose, tileId),
    setBounds: (tileId: string, rect: Rect) => ipcRenderer.invoke(IPC.tileSetBounds, tileId, rect),
    focus: (tileId: string) => ipcRenderer.invoke(IPC.tileFocus, tileId),
    suspend: (tileId: string) => ipcRenderer.invoke(IPC.tileSuspend, tileId),
    resume: (tileId: string) => ipcRenderer.invoke(IPC.tileResume, tileId),
    hide: (tileId: string) => ipcRenderer.invoke('tile:hide', tileId),
    navigate: (tileId: string, url: string) => ipcRenderer.invoke('tile:navigate', tileId, url),
    goBack: (tileId: string) => ipcRenderer.invoke('tile:go-back', tileId),
    goForward: (tileId: string) => ipcRenderer.invoke('tile:go-forward', tileId),
    reload: (tileId: string) => ipcRenderer.invoke('tile:reload', tileId),
    onNavigated: (cb: (tileId: string, state: { url: string; canGoBack: boolean; canGoForward: boolean }) => void) => {
      const listener = (_e: unknown, tileId: string, state: { url: string; canGoBack: boolean; canGoForward: boolean }) =>
        cb(tileId, state)
      ipcRenderer.on('tile:navigated', listener)
      return () => { ipcRenderer.removeListener('tile:navigated', listener) }
    },
    onTitleUpdated: (cb: (tileId: string, title: string) => void) => {
      const listener = (_e: unknown, tileId: string, title: string) => cb(tileId, title)
      ipcRenderer.on(IPC.tileTitleUpdated, listener)
      return () => { ipcRenderer.removeListener(IPC.tileTitleUpdated, listener) }
    },
    onSnapshotUpdated: (cb: (tileId: string, snapshot: string | null) => void) => {
      const listener = (_e: unknown, tileId: string, snapshot: string | null) => cb(tileId, snapshot)
      ipcRenderer.on('tile:snapshot-updated', listener)
      return () => { ipcRenderer.removeListener('tile:snapshot-updated', listener) }
    }
  },

  app: {
    restartRequired: (): Promise<boolean> => ipcRenderer.invoke('app:restart-required'),
    relaunch: (): Promise<void> => ipcRenderer.invoke('app:relaunch'),
    isPackaged: (): Promise<boolean> => ipcRenderer.invoke('app:is-packaged')
  },

  overlay: {
    show: (): Promise<void> => ipcRenderer.invoke('overlay:show'),
    hide: (): Promise<void> => ipcRenderer.invoke('overlay:hide')
  },

  memory: {
    onSnapshot: (cb: (snapshot: unknown) => void) => {
      const listener = (_e: unknown, snapshot: unknown) => cb(snapshot)
      ipcRenderer.on(IPC.memorySnapshot, listener)
      return () => { ipcRenderer.removeListener(IPC.memorySnapshot, listener) }
    }
  },

  shells: {
    list: (): Promise<ShellOption[]> => ipcRenderer.invoke('shell:list-shells'),
    getDefault: (): Promise<ShellOption> => ipcRenderer.invoke('shell:default-shell'),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),
    openPath: (path: string): Promise<string> => ipcRenderer.invoke('shell:open-path', path),
    showItem: (path: string): Promise<void> => ipcRenderer.invoke('shell:show-item', path)
  },

  pty: {
    create: (
      tileId: string,
      opts: { shellId?: string; cwd?: string; cols: number; rows: number }
    ): Promise<{ backlog: string }> => ipcRenderer.invoke(IPC.ptyCreate, tileId, opts),
    write: (tileId: string, data: string) => ipcRenderer.send(IPC.ptyWrite, tileId, data),
    resize: (tileId: string, cols: number, rows: number) => ipcRenderer.send(IPC.ptyResize, tileId, cols, rows),
    kill: (tileId: string) => ipcRenderer.invoke(IPC.ptyKill, tileId),
    onData: (cb: (tileId: string, data: string) => void) => {
      const listener = (_e: unknown, tileId: string, data: string) => cb(tileId, data)
      ipcRenderer.on(IPC.ptyData, listener)
      return () => { ipcRenderer.removeListener(IPC.ptyData, listener) }
    },
    onExit: (cb: (tileId: string, exitCode: number) => void) => {
      const listener = (_e: unknown, tileId: string, exitCode: number) => cb(tileId, exitCode)
      ipcRenderer.on(IPC.ptyExit, listener)
      return () => { ipcRenderer.removeListener(IPC.ptyExit, listener) }
    }
  },

  fs: {
    listDir: (dirPath: string): Promise<DirEntry[]> => ipcRenderer.invoke(IPC.fsListDir, dirPath),
    readFile: (filePath: string): Promise<string> => ipcRenderer.invoke(IPC.fsReadFile, filePath),
    writeFile: (filePath: string, content: string): Promise<void> =>
      ipcRenderer.invoke(IPC.fsWriteFile, filePath, content),
    watchStart: (watchId: string, dirPath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.fsWatchStart, watchId, dirPath),
    watchStop: (watchId: string): Promise<void> => ipcRenderer.invoke(IPC.fsWatchStop, watchId),
    homeDir: (): Promise<string> => ipcRenderer.invoke('fs:home-dir'),
    onChanged: (cb: (watchId: string, event: string, changedPath: string) => void) => {
      const listener = (_e: unknown, watchId: string, event: string, changedPath: string) =>
        cb(watchId, event, changedPath)
      ipcRenderer.on(IPC.fsChanged, listener)
      return () => { ipcRenderer.removeListener(IPC.fsChanged, listener) }
    }
  },

  sysmon: {
    snapshot: (): Promise<SystemSnapshot> => ipcRenderer.invoke('sysmon:snapshot')
  },

  settings: {
    getOsShortcuts: (): Promise<SettingsShortcut[]> => ipcRenderer.invoke(IPC.settingsOpenOsShortcut),
    hasDesktopSettingsTool: (): Promise<boolean> => ipcRenderer.invoke(IPC.settingsHasDesktopSettingsTool),
    openShortcut: (shortcutId: string) => ipcRenderer.send('settings:open-shortcut-by-id', shortcutId)
  },

  etc: {
    isSupported: (): Promise<boolean> => ipcRenderer.invoke('etc:is-supported'),
    listFiles: (): Promise<EtcFileDescriptor[]> => ipcRenderer.invoke(IPC.etcList),
    read: (path: string): Promise<string> => ipcRenderer.invoke(IPC.etcRead, path),
    hasAugeas: (): Promise<boolean> => ipcRenderer.invoke('etc:has-augeas'),
    readAugeasTree: (path: string): Promise<AugeasNode[]> => ipcRenderer.invoke('etc:read-augeas-tree', path),
    diff: (path: string, newContent: string): Promise<DiffOp[]> => ipcRenderer.invoke(IPC.etcDiff, path, newContent),
    validate: (path: string, candidateContent: string): Promise<ExecResult | null> =>
      ipcRenderer.invoke(IPC.etcValidate, path, candidateContent),
    write: (path: string, newContent: string): Promise<ExecResult> => ipcRenderer.invoke(IPC.etcWrite, path, newContent),
    writeAugeasValue: (path: string, augPath: string, value: string): Promise<ExecResult> =>
      ipcRenderer.invoke('etc:write-augeas-value', path, augPath, value),
    history: (path: string): Promise<HistoryEntry[]> => ipcRenderer.invoke(IPC.etcHistory, path),
    restore: (path: string, fileName: string): Promise<ExecResult> =>
      ipcRenderer.invoke(IPC.etcRestore, path, fileName)
  },

  plugins: {
    list: (): Promise<PluginListItem[]> => ipcRenderer.invoke(IPC.pluginsList),
    validateBundle: (rawText: string): Promise<PluginInstallResult> =>
      ipcRenderer.invoke('plugins:validate-bundle', rawText),
    installFromBundle: (rawText: string): Promise<PluginInstallResult> =>
      ipcRenderer.invoke(IPC.pluginsInstallFromBundle, rawText),
    setEnabled: (id: string, enabled: boolean): Promise<void> => ipcRenderer.invoke(IPC.pluginsSetEnabled, id, enabled),
    rollback: (id: string, toVersion: string): Promise<boolean> => ipcRenderer.invoke(IPC.pluginsRollback, id, toVersion),
    uninstall: (id: string): Promise<void> => ipcRenderer.invoke(IPC.pluginsUninstall, id),
    getAppUrl: (id: string): Promise<string> => ipcRenderer.invoke('plugins:app-url', id),
    hostCall: (pluginId: string, method: string, args: unknown[]): Promise<unknown> =>
      ipcRenderer.invoke(IPC.pluginsHostCall, pluginId, method, args),
    onChanged: (cb: () => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('plugins:changed', listener)
      return () => { ipcRenderer.removeListener('plugins:changed', listener) }
    },
    onRequestOpenTile: (cb: (builtinTypeId: string) => void) => {
      const listener = (_e: unknown, builtinTypeId: string) => cb(builtinTypeId)
      ipcRenderer.on('plugins:request-open-tile', listener)
      return () => { ipcRenderer.removeListener('plugins:request-open-tile', listener) }
    }
  },

  builder: {
    hasApiKey: (provider: string): Promise<boolean> => ipcRenderer.invoke('builder:has-api-key', provider),
    setApiKey: (provider: string, apiKey: string): Promise<void> =>
      ipcRenderer.invoke('builder:set-api-key', provider, apiKey),
    runAgent: (request: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.builderAgentRun, request),
    exportKit: (): Promise<{ ok: boolean; path?: string }> => ipcRenderer.invoke(IPC.builderExportKit),
    onAgentEvent: (cb: (event: unknown) => void) => {
      const listener = (_e: unknown, event: unknown) => cb(event)
      ipcRenderer.on(IPC.builderAgentEvent, listener)
      return () => { ipcRenderer.removeListener(IPC.builderAgentEvent, listener) }
    }
  },

  google: {
    hasClientCredentials: (): Promise<boolean> => ipcRenderer.invoke('google:has-client-credentials'),
    isConnected: (): Promise<boolean> => ipcRenderer.invoke('google:is-connected'),
    setClientCredentials: (clientId: string, clientSecret: string): Promise<void> =>
      ipcRenderer.invoke('google:set-client-credentials', clientId, clientSecret),
    connect: (): Promise<void> => ipcRenderer.invoke('google:connect'),
    disconnect: (): Promise<void> => ipcRenderer.invoke('google:disconnect'),
    listEvents: (timeMinIso: string, timeMaxIso: string): Promise<CalendarEvent[]> =>
      ipcRenderer.invoke('google:list-events', timeMinIso, timeMaxIso)
  },

  hq: {
    onCardPublished: (cb: (card: Card) => void) => {
      const listener = (_e: unknown, card: Card) => cb(card)
      ipcRenderer.on('hq:card-published', listener)
      return () => { ipcRenderer.removeListener('hq:card-published', listener) }
    },
    onCardCleared: (cb: (cardId: string) => void) => {
      const listener = (_e: unknown, cardId: string) => cb(cardId)
      ipcRenderer.on('hq:card-cleared', listener)
      return () => { ipcRenderer.removeListener('hq:card-cleared', listener) }
    }
  }
}

const apiWithPlatform = {
  ...api,
  platform: process.platform
}

export type BrightermApi = typeof apiWithPlatform

contextBridge.exposeInMainWorld('api', apiWithPlatform)
