import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppConfig, Card, Rect, SystemMemorySnapshot } from '@shared/types'
import type {
  AgentEvent,
  AugeasNode,
  CalendarEvent,
  DiffOp,
  DirEntry,
  EtcFileDescriptor,
  ExecResult,
  FileInspection,
  HistoryEntry,
  PluginInstallResult,
  PluginListItem,
  SettingsShortcut,
  ShellOption,
  SystemSnapshot
} from '@shared/apiTypes'

/** Listens to an event main sends; returns the unsubscribe function. */
function subscribe<Args extends unknown[]>(channel: string, cb: (...args: Args) => void): () => void {
  const listener = (_event: unknown, ...args: unknown[]): void => cb(...(args as Args))
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

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
    hide: (tileId: string) => ipcRenderer.invoke(IPC.tileHide, tileId),
    navigate: (tileId: string, url: string, onlyIfChanged?: boolean) =>
      ipcRenderer.invoke(IPC.tileNavigate, tileId, url, onlyIfChanged),
    goBack: (tileId: string) => ipcRenderer.invoke(IPC.tileGoBack, tileId),
    goForward: (tileId: string) => ipcRenderer.invoke(IPC.tileGoForward, tileId),
    reload: (tileId: string) => ipcRenderer.invoke(IPC.tileReload, tileId),
    onNavigated: (cb: (tileId: string, state: { url: string; canGoBack: boolean; canGoForward: boolean }) => void) =>
      subscribe(IPC.tileNavigated, cb),
    onTitleUpdated: (cb: (tileId: string, title: string) => void) => subscribe(IPC.tileTitleUpdated, cb),
    onSnapshotUpdated: (cb: (tileId: string, snapshot: string | null) => void) => subscribe(IPC.tileSnapshotUpdated, cb)
  },

  app: {
    restartRequired: (): Promise<boolean> => ipcRenderer.invoke(IPC.appRestartRequired),
    relaunch: (): Promise<void> => ipcRenderer.invoke(IPC.appRelaunch),
    isPackaged: (): Promise<boolean> => ipcRenderer.invoke(IPC.appIsPackaged)
  },

  overlay: {
    show: (): Promise<void> => ipcRenderer.invoke(IPC.overlayShow),
    hide: (): Promise<void> => ipcRenderer.invoke(IPC.overlayHide)
  },

  memory: {
    onSnapshot: (cb: (snapshot: SystemMemorySnapshot) => void) => subscribe(IPC.memorySnapshot, cb)
  },

  shells: {
    list: (): Promise<ShellOption[]> => ipcRenderer.invoke(IPC.shellList),
    getDefault: (): Promise<ShellOption> => ipcRenderer.invoke(IPC.shellDefault),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.shellOpenExternal, url),
    openPath: (path: string): Promise<string> => ipcRenderer.invoke(IPC.shellOpenPath, path),
    showItem: (path: string): Promise<void> => ipcRenderer.invoke(IPC.shellShowItem, path)
  },

  pty: {
    create: (
      tileId: string,
      opts: { shellId?: string; cwd?: string; cols: number; rows: number }
    ): Promise<{ backlog: string }> => ipcRenderer.invoke(IPC.ptyCreate, tileId, opts),
    write: (tileId: string, data: string) => ipcRenderer.send(IPC.ptyWrite, tileId, data),
    resize: (tileId: string, cols: number, rows: number) => ipcRenderer.send(IPC.ptyResize, tileId, cols, rows),
    kill: (tileId: string) => ipcRenderer.invoke(IPC.ptyKill, tileId),
    onData: (cb: (tileId: string, data: string) => void) => subscribe(IPC.ptyData, cb),
    onExit: (cb: (tileId: string, exitCode: number) => void) => subscribe(IPC.ptyExit, cb)
  },

  fs: {
    listDir: (dirPath: string): Promise<DirEntry[]> => ipcRenderer.invoke(IPC.fsListDir, dirPath),
    readFile: (filePath: string): Promise<string> => ipcRenderer.invoke(IPC.fsReadFile, filePath),
    writeFile: (filePath: string, content: string): Promise<void> =>
      ipcRenderer.invoke(IPC.fsWriteFile, filePath, content),
    watchStart: (watchId: string, dirPath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.fsWatchStart, watchId, dirPath),
    watchStop: (watchId: string): Promise<void> => ipcRenderer.invoke(IPC.fsWatchStop, watchId),
    homeDir: (): Promise<string> => ipcRenderer.invoke(IPC.fsHomeDir),
    statEntry: (filePath: string): Promise<DirEntry> => ipcRenderer.invoke(IPC.fsStatEntry, filePath),
    inspect: (filePath: string): Promise<FileInspection> => ipcRenderer.invoke(IPC.fsInspect, filePath),
    create: (parentDir: string, name: string, kind: 'dir' | 'file'): Promise<string> =>
      ipcRenderer.invoke(IPC.fsCreate, parentDir, name, kind),
    onChanged: (cb: (watchId: string, event: string, changedPath: string) => void) => subscribe(IPC.fsChanged, cb)
  },

  sysmon: {
    snapshot: (opts?: { processes?: boolean }): Promise<SystemSnapshot> => ipcRenderer.invoke(IPC.sysmonSnapshot, opts)
  },

  settings: {
    getOsShortcuts: (): Promise<SettingsShortcut[]> => ipcRenderer.invoke(IPC.settingsGetOsShortcuts),
    hasDesktopSettingsTool: (): Promise<boolean> => ipcRenderer.invoke(IPC.settingsHasDesktopSettingsTool),
    openShortcut: (shortcutId: string) => ipcRenderer.send(IPC.settingsOpenShortcut, shortcutId)
  },

  etc: {
    isSupported: (): Promise<boolean> => ipcRenderer.invoke(IPC.etcIsSupported),
    listFiles: (): Promise<EtcFileDescriptor[]> => ipcRenderer.invoke(IPC.etcList),
    read: (path: string): Promise<string> => ipcRenderer.invoke(IPC.etcRead, path),
    hasAugeas: (): Promise<boolean> => ipcRenderer.invoke(IPC.etcHasAugeas),
    readAugeasTree: (path: string): Promise<AugeasNode[]> => ipcRenderer.invoke(IPC.etcReadAugeasTree, path),
    diff: (path: string, newContent: string): Promise<DiffOp[]> => ipcRenderer.invoke(IPC.etcDiff, path, newContent),
    validate: (path: string, candidateContent: string): Promise<ExecResult | null> =>
      ipcRenderer.invoke(IPC.etcValidate, path, candidateContent),
    write: (path: string, newContent: string): Promise<ExecResult> => ipcRenderer.invoke(IPC.etcWrite, path, newContent),
    writeAugeasValue: (path: string, augPath: string, value: string): Promise<ExecResult> =>
      ipcRenderer.invoke(IPC.etcWriteAugeasValue, path, augPath, value),
    history: (path: string): Promise<HistoryEntry[]> => ipcRenderer.invoke(IPC.etcHistory, path),
    restore: (path: string, fileName: string): Promise<ExecResult> =>
      ipcRenderer.invoke(IPC.etcRestore, path, fileName)
  },

  plugins: {
    list: (): Promise<PluginListItem[]> => ipcRenderer.invoke(IPC.pluginsList),
    validateBundle: (rawText: string): Promise<PluginInstallResult> =>
      ipcRenderer.invoke(IPC.pluginsValidateBundle, rawText),
    installFromBundle: (rawText: string): Promise<PluginInstallResult> =>
      ipcRenderer.invoke(IPC.pluginsInstallFromBundle, rawText),
    setEnabled: (id: string, enabled: boolean): Promise<void> => ipcRenderer.invoke(IPC.pluginsSetEnabled, id, enabled),
    rollback: (id: string, toVersion: string): Promise<boolean> => ipcRenderer.invoke(IPC.pluginsRollback, id, toVersion),
    uninstall: (id: string): Promise<void> => ipcRenderer.invoke(IPC.pluginsUninstall, id),
    getAppUrl: (id: string): Promise<string> => ipcRenderer.invoke(IPC.pluginsAppUrl, id),
    grantFolder: (pluginId: string, path: string): Promise<{ id: string; label: string }> =>
      ipcRenderer.invoke(IPC.pluginsGrantFolder, pluginId, path),
    hostCall: (pluginId: string, method: string, args: unknown[]): Promise<unknown> =>
      ipcRenderer.invoke(IPC.pluginsHostCall, pluginId, method, args),
    onChanged: (cb: () => void) => subscribe(IPC.pluginsChanged, cb),
    onRequestOpenTile: (cb: (builtinTypeId: string) => void) => subscribe(IPC.pluginsRequestOpenTile, cb)
  },

  builder: {
    hasApiKey: (provider: string): Promise<boolean> => ipcRenderer.invoke(IPC.builderHasApiKey, provider),
    setApiKey: (provider: string, apiKey: string): Promise<void> =>
      ipcRenderer.invoke(IPC.builderSetApiKey, provider, apiKey),
    runAgent: (request: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.builderAgentRun, request),
    exportKit: (): Promise<{ ok: boolean; path?: string }> => ipcRenderer.invoke(IPC.builderExportKit),
    onAgentEvent: (cb: (event: AgentEvent) => void) => subscribe(IPC.builderAgentEvent, cb)
  },

  google: {
    hasClientCredentials: (): Promise<boolean> => ipcRenderer.invoke(IPC.googleHasClientCredentials),
    isConnected: (): Promise<boolean> => ipcRenderer.invoke(IPC.googleIsConnected),
    setClientCredentials: (clientId: string, clientSecret: string): Promise<void> =>
      ipcRenderer.invoke(IPC.googleSetClientCredentials, clientId, clientSecret),
    connect: (): Promise<void> => ipcRenderer.invoke(IPC.googleConnect),
    disconnect: (): Promise<void> => ipcRenderer.invoke(IPC.googleDisconnect),
    listEvents: (timeMinIso: string, timeMaxIso: string): Promise<CalendarEvent[]> =>
      ipcRenderer.invoke(IPC.googleListEvents, timeMinIso, timeMaxIso)
  },

  hq: {
    onCardPublished: (cb: (card: Card) => void) => subscribe(IPC.hqCardPublished, cb),
    onCardCleared: (cb: (cardId: string) => void) => subscribe(IPC.hqCardCleared, cb)
  }
}

const apiWithPlatform = {
  ...api,
  platform: process.platform
}

export type BrightermApi = typeof apiWithPlatform

contextBridge.exposeInMainWorld('api', apiWithPlatform)
