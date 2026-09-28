import { app, BaseWindow, WebContentsView, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { is } from './utils/env'
import { ConfigStore } from './configStore'
import { ViewManager } from './viewManager'
import { PtyManager, listAvailableShells, defaultShell } from './ptyManager'
import {
  FsWatchRegistry,
  createEntry,
  getHomeDir,
  inspectFile,
  listDir,
  readTextFile,
  statEntry,
  writeTextFile
} from './fsService'
import { getSystemSnapshot } from './sysMonitor'
import { summarizeAppMemory } from './appMemory'
import { EtcService } from './etc/etcService'
import { getShortcutsForOs, openShortcut, detectLinuxDesktopSettingsTool } from './settingsShortcuts'
import { PluginHost } from './plugins/pluginHost'
import { PluginHostApiBridge } from './plugins/hostApiBridge'
import { parseBundle } from './plugins/bundleParser'
import { installBundledPlugins } from './plugins/bootstrapBundled'
import { handleId } from './plugins/handleUtil'
import { registerPluginSchemeAsPrivileged, registerPluginProtocolHandler, pluginAppUrl } from './plugins/protocol'
import { GoogleCredentialsStore } from './connectors/googleCredentialsStore'
import { GoogleConnector } from './connectors/google'
import { createSafeStorageCrypto } from './cryptoAdapter'
import { SecretStore } from './secretStore'
import { AgentToolRunner, AGENT_TOOL_DEFS } from './builder/agentTools'
import { buildAgentSystemPrompt } from './builder/systemPrompt'
import { OpenAiAgentProvider } from './builder/providers/openai'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { IPC, type AppConfig, type Card, type Rect, type WebTheme } from '@shared/types'

// Single instance: a second launch just focuses the existing window instead
// of opening a duplicate command HQ.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

// Must run before app.ready.
registerPluginSchemeAsPrivileged()

// Config is read before app.ready (app.getPath works this early) because
// Chromium's forced dark mode can only be switched on at startup.
const configStore = new ConfigStore()
/** The web theme this process started with — force-dark can't change without a restart. */
const startupWebTheme = configStore.get().appearance.webTheme
if (startupWebTheme === 'force-dark') {
  // Chromium's "Auto Dark Mode for Web Contents": darkens pages that have no
  // dark theme of their own. Set through Blink's settings directly — the
  // WebContentsForceDark feature flag alone had no effect in this Electron.
  app.commandLine.appendSwitch('blink-settings', 'forceDarkModeEnabled=true')
}

/** Tells every embedded page which color scheme to prefer (takes effect immediately). */
function applyWebTheme(theme: WebTheme): void {
  nativeTheme.themeSource = theme === 'light' ? 'light' : theme === 'system' ? 'system' : 'dark'
}

let mainWindow: BaseWindow | null = null
let shellView: WebContentsView | null = null
let viewManager: ViewManager
let ptyManager: PtyManager
let etcService: EtcService
let pluginHost: PluginHost
let hostApiBridge: PluginHostApiBridge
let googleConnector: GoogleConnector
let googlePollTimer: NodeJS.Timeout | null = null
let lastGoogleCardIds: Set<string> = new Set()
let secretStore: SecretStore
const fsWatchers = new FsWatchRegistry()

/** Also the System Monitor's refresh rate for app memory. getAppMetrics() is cheap. */
const MEMORY_TICK_MS = 500

function send(channel: string, ...args: unknown[]): void {
  shellView?.webContents.send(channel, ...args)
}

function createWindow(): void {
  mainWindow = new BaseWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#0e0f13',
    autoHideMenuBar: true
  })

  shellView = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  })
  mainWindow.contentView.addChildView(shellView)
  resizeShellView()

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    shellView.webContents.loadURL(process.env['ELECTRON_RENDERER_URL'])
    shellView.webContents.openDevTools({ mode: 'detach' })
  } else {
    shellView.webContents.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('resize', resizeShellView)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  // BaseWindow has no 'ready-to-show' (that's BrowserWindow-only); show once the shell has painted.
  shellView.webContents.once('did-finish-load', () => mainWindow?.show())

  // Any link a tile or the shell wants to open externally goes to the OS browser.
  shellView.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
}

function resizeShellView(): void {
  if (!mainWindow || !shellView) return
  const bounds = mainWindow.getContentBounds()
  shellView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height })
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC.configGet, () => configStore.get())
  ipcMain.handle(IPC.configSet, (_event, patch: Partial<AppConfig>) => {
    const next = configStore.set(patch)
    if (patch.appearance) applyWebTheme(next.appearance.webTheme)
    return next
  })
  ipcMain.handle('app:restart-required', () => {
    // Only switching force-dark on or off needs a restart.
    const now = configStore.get().appearance.webTheme
    return (now === 'force-dark') !== (startupWebTheme === 'force-dark')
  })
  ipcMain.handle('app:relaunch', () => {
    configStore.flush()
    app.relaunch()
    app.exit(0)
  })
  ipcMain.handle('app:is-packaged', () => app.isPackaged)

  ipcMain.handle(IPC.tileCreate, (_event, args: { tileId: string; kind: string; url?: string; partitionId?: string; compactCss?: string }) => {
    if (args.kind === 'web' || args.kind === 'plugin') {
      if (!args.url || !args.partitionId) return
      viewManager.create(args.tileId, args.url, args.partitionId, args.compactCss)
    }
  })
  ipcMain.handle(IPC.tileClose, async (_event, tileId: string) => {
    await viewManager.close(tileId)
    ptyManager.kill(tileId)
    fsWatchers.stop(tileId)
  })
  ipcMain.handle(IPC.tileSetBounds, (_event, tileId: string, rect: Rect) => {
    viewManager.setBounds(tileId, rect)
  })
  ipcMain.handle(IPC.tileFocus, (_event, tileId: string) => {
    viewManager.markActive(tileId)
  })
  ipcMain.handle(IPC.tileSuspend, async (_event, tileId: string) => {
    await viewManager.suspend(tileId)
  })
  ipcMain.handle('tile:hide', (_event, tileId: string) => viewManager.hide(tileId))
  ipcMain.handle('tile:navigate', (_event, tileId: string, url: string, onlyIfChanged?: boolean) =>
    viewManager.navigate(tileId, url, onlyIfChanged)
  )
  ipcMain.handle('tile:go-back', (_event, tileId: string) => viewManager.goBack(tileId))
  ipcMain.handle('tile:go-forward', (_event, tileId: string) => viewManager.goForward(tileId))
  ipcMain.handle('tile:reload', (_event, tileId: string) => viewManager.reload(tileId))
  ipcMain.handle(IPC.tileResume, (_event, tileId: string) => {
    viewManager.resume(tileId)
  })
  ipcMain.handle('overlay:show', async () => {
    await viewManager.hideAllForOverlay()
  })
  ipcMain.handle('overlay:hide', () => {
    viewManager.showAllAfterOverlay()
  })

  ipcMain.handle('shell:list-shells', () => listAvailableShells())
  ipcMain.handle('shell:default-shell', () => defaultShell())

  ipcMain.handle(IPC.ptyCreate, (_event, tileId: string, opts: { shellId?: string; cwd?: string; cols: number; rows: number }) => {
    return ptyManager.create(tileId, opts)
  })
  ipcMain.on(IPC.ptyWrite, (_event, tileId: string, data: string) => ptyManager.write(tileId, data))
  ipcMain.on(IPC.ptyResize, (_event, tileId: string, cols: number, rows: number) =>
    ptyManager.resize(tileId, cols, rows)
  )
  ipcMain.handle(IPC.ptyKill, (_event, tileId: string) => ptyManager.kill(tileId))

  ipcMain.handle(IPC.fsListDir, (_event, dirPath: string) => listDir(dirPath))
  ipcMain.handle(IPC.fsReadFile, (_event, filePath: string) => readTextFile(filePath))
  ipcMain.handle(IPC.fsWriteFile, (_event, filePath: string, content: string) => writeTextFile(filePath, content))
  ipcMain.handle(IPC.fsWatchStart, (_event, watchId: string, dirPath: string) => {
    fsWatchers.watch(watchId, dirPath, (event, changedPath) => {
      send(IPC.fsChanged, watchId, event, changedPath)
    })
  })
  ipcMain.handle(IPC.fsWatchStop, (_event, watchId: string) => fsWatchers.stop(watchId))
  ipcMain.handle('fs:home-dir', () => getHomeDir())
  ipcMain.handle('fs:stat-entry', (_event, filePath: string) => statEntry(filePath))
  ipcMain.handle('fs:inspect', (_event, filePath: string) => inspectFile(filePath))
  ipcMain.handle('fs:create', (_event, parentDir: string, name: string, kind: 'dir' | 'file') =>
    createEntry(parentDir, name, kind)
  )

  ipcMain.handle('sysmon:snapshot', (_event, opts?: { processes?: boolean }) => getSystemSnapshot(opts))

  ipcMain.handle('shell:open-external', (_event, url: string) => shell.openExternal(url))
  ipcMain.handle('shell:open-path', (_event, path: string) => shell.openPath(path))
  ipcMain.handle('shell:show-item', (_event, path: string) => shell.showItemInFolder(path))

  ipcMain.handle(IPC.settingsOpenOsShortcut, () => getShortcutsForOs())
  ipcMain.handle(IPC.settingsHasDesktopSettingsTool, () => detectLinuxDesktopSettingsTool() !== null)
  ipcMain.on('settings:open-shortcut-by-id', (_event, shortcutId: string) => {
    const shortcut = getShortcutsForOs().find((s) => s.id === shortcutId)
    if (shortcut) openShortcut(shortcut)
  })

  ipcMain.handle(IPC.etcList, () => etcService.listCommonFiles())
  ipcMain.handle(IPC.etcRead, (_event, path: string) => etcService.readFile(path))
  ipcMain.handle('etc:is-supported', () => etcService.isSupported())
  ipcMain.handle('etc:has-augeas', () => etcService.hasAugeas())
  ipcMain.handle('etc:read-augeas-tree', (_event, path: string) => etcService.readAugeasTree(path))
  ipcMain.handle(IPC.etcDiff, (_event, path: string, newContent: string) => etcService.preview(path, newContent))
  ipcMain.handle(IPC.etcValidate, (_event, path: string, candidateContent: string) =>
    etcService.validate(path, candidateContent)
  )
  ipcMain.handle(IPC.etcWrite, (_event, path: string, newContent: string) => etcService.writeFile(path, newContent))
  ipcMain.handle('etc:write-augeas-value', (_event, path: string, augPath: string, value: string) =>
    etcService.writeAugeasValue(path, augPath, value)
  )
  ipcMain.handle(IPC.etcHistory, (_event, path: string) => etcService.listHistory(path))
  ipcMain.handle(IPC.etcRestore, (_event, path: string, fileName: string) => etcService.restore(path, fileName))

  ipcMain.handle(IPC.pluginsList, () => pluginHost.list())
  ipcMain.handle('plugins:validate-bundle', (_event, rawText: string) => {
    const parsed = parseBundle(rawText)
    if (!parsed.ok) return { ok: false, errors: parsed.errors.map((message) => ({ message })), warnings: [] }
    return pluginHost.validate(parsed.files)
  })
  ipcMain.handle(IPC.pluginsInstallFromBundle, (_event, rawText: string) => {
    const parsed = parseBundle(rawText)
    if (!parsed.ok) return { ok: false, errors: parsed.errors.map((message) => ({ message })), warnings: [] }
    const result = pluginHost.install(parsed.files)
    if (result.ok) send('plugins:changed')
    return result
  })
  ipcMain.handle(IPC.pluginsSetEnabled, (_event, id: string, enabled: boolean) => {
    pluginHost.setEnabled(id, enabled)
    send('plugins:changed')
  })
  ipcMain.handle(IPC.pluginsRollback, (_event, id: string, toVersion: string) => {
    const ok = pluginHost.rollback(id, toVersion)
    if (ok) send('plugins:changed')
    return ok
  })
  ipcMain.handle(IPC.pluginsUninstall, (_event, id: string) => {
    pluginHost.uninstall(id)
    send('plugins:changed')
  })
  ipcMain.handle('plugins:app-url', (_event, id: string) => pluginAppUrl(id))
  ipcMain.handle('plugins:grant-folder', (_event, pluginId: string, path: string) =>
    hostApiBridge.grantFolder(pluginId, path)
  )
  ipcMain.handle(
    IPC.pluginsHostCall,
    async (_event, pluginId: string, method: string, args: unknown[]) => callHostApi(pluginId, method, args)
  )

  ipcMain.handle('google:has-client-credentials', () => googleConnector.hasClientCredentials())
  ipcMain.handle('google:is-connected', () => googleConnector.isConnected())
  ipcMain.handle('google:set-client-credentials', (_event, clientId: string, clientSecret: string) => {
    googleConnector.setClientCredentials(clientId, clientSecret)
  })
  ipcMain.handle('google:connect', async () => {
    await googleConnector.connect()
    await pollGoogleCards()
  })
  ipcMain.handle('google:list-events', (_event, timeMinIso: string, timeMaxIso: string) =>
    googleConnector.listEvents(timeMinIso, timeMaxIso)
  )
  ipcMain.handle('google:disconnect', () => {
    googleConnector.disconnect()
    for (const id of lastGoogleCardIds) send('hq:card-cleared', id)
    lastGoogleCardIds = new Set()
  })

  ipcMain.handle('builder:has-api-key', (_event, provider: string) => secretStore.has(provider))
  ipcMain.handle('builder:set-api-key', (_event, provider: string, apiKey: string) => secretStore.set(provider, apiKey))
  ipcMain.handle(IPC.builderAgentRun, async (_event, request: string) => runAgent(request))
  ipcMain.handle(IPC.builderExportKit, async () => exportAiKit())
}

/** "AI キットを書き出す": copies the SDK docs/types/templates to a folder the user can hand to any chat AI. */
async function exportAiKit(): Promise<{ ok: boolean; path?: string }> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return { ok: false }

  const destDir = join(result.filePaths[0], 'brighterm-plugin-kit')
  const sdkDir = join(__dirname, '../../packages/sdk')
  cpSync(sdkDir, destDir, { recursive: true })
  return { ok: true, path: destDir }
}

async function runAgent(request: string): Promise<{ ok: boolean; error?: string }> {
  const config = configStore.get()
  const { apiProvider, apiModel, apiBaseUrl } = config.aiBuilder

  if (apiProvider !== 'openai' && apiProvider !== 'openai-compatible') {
    const message = `${apiProvider} プロバイダはまだ実装されていません（OpenAI / OpenAI 互換のみ対応）。`
    send(IPC.builderAgentEvent, { type: 'error', message })
    return { ok: false, error: message }
  }

  const apiKey = secretStore.get(apiProvider) ?? (apiProvider === 'openai-compatible' ? 'not-needed' : '')
  if (!apiKey) {
    const message = 'API キーが設定されていません。設定から入力してください。'
    send(IPC.builderAgentEvent, { type: 'error', message })
    return { ok: false, error: message }
  }

  const stagingDir = mkdtempSync(join(tmpdir(), 'brighterm-agent-'))
  const toolRunner = new AgentToolRunner(pluginHost, stagingDir)
  const provider = new OpenAiAgentProvider()

  try {
    await provider.run({
      systemPrompt: buildAgentSystemPrompt(),
      userMessage: request,
      tools: AGENT_TOOL_DEFS,
      callTool: (name, args) => toolRunner.call(name, args),
      onEvent: (event) => {
        send(IPC.builderAgentEvent, event)
        if (event.type === 'tool-result' && event.name === 'install_staged_bundle') {
          const result = event.result as { ok?: boolean } | undefined
          if (result?.ok) send('plugins:changed')
        }
      },
      apiKey,
      model: apiModel,
      baseUrl: apiProvider === 'openai-compatible' ? apiBaseUrl : undefined
    })
    return { ok: true }
  } finally {
    toolRunner.dispose()
  }
}

/** Dispatches a `window.brighterm.*` call by the exact method name bridgeScript.ts sends. */
async function callHostApi(pluginId: string, method: string, args: unknown[]): Promise<unknown> {
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
      return hostApiBridge.listFiles(pluginId, handleId(args[0]))
    case 'fs.readFile':
      return hostApiBridge.readFile(pluginId, handleId(args[0]), args[1] as string)
    case 'fs.writeFile':
      return hostApiBridge.writeFile(pluginId, handleId(args[0]), args[1] as string, args[2] as string)
    case 'fs.deleteFile':
      return hostApiBridge.deleteFile(pluginId, handleId(args[0]), args[1] as string)
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
      send('plugins:request-open-tile', args[0] as string)
      return undefined
    default:
      throw new Error(`unknown host API method: ${method}`)
  }
}

const GOOGLE_POLL_MS = 5 * 60 * 1000

async function pollGoogleCards(): Promise<void> {
  if (!googleConnector.isConnected()) return
  try {
    const cards = await googleConnector.fetchCards()
    const newIds = new Set(cards.map((c) => c.id))
    for (const id of lastGoogleCardIds) {
      if (!newIds.has(id)) send('hq:card-cleared', id)
    }
    for (const card of cards) send('hq:card-published', card)
    lastGoogleCardIds = newIds
  } catch (err) {
    console.error('[Google] failed to fetch HQ cards:', err)
  }
}

function startGooglePollLoop(): void {
  void pollGoogleCards()
  googlePollTimer = setInterval(() => void pollGoogleCards(), GOOGLE_POLL_MS)
}

function startMemoryLoop(): void {
  let inFlight = false
  setInterval(async () => {
    // Suspending captures a snapshot first; don't start another tick meanwhile.
    if (inFlight) return
    inFlight = true
    try {
      await memoryTick()
    } finally {
      inFlight = false
    }
  }, MEMORY_TICK_MS)
}

async function memoryTick(): Promise<void> {
    const config = configStore.get()
    const suspendCandidates = viewManager.getSuspendCandidates(config.suspendAfterMs)
    for (const tileId of suspendCandidates) {
      await viewManager.suspend(tileId)
    }

    const { totalAppBytes, rows } = summarizeAppMemory(
      app.getAppMetrics().map((m) => ({ pid: m.pid, bytes: m.memory.workingSetSize * 1024 })),
      viewManager.getViewPids(),
      shellView?.webContents.getOSProcessId() ?? null
    )
    send(IPC.memorySnapshot, {
      totalAppBytes,
      tiles: rows.map(({ id: tileId, memoryBytes }) => ({
        tileId,
        memoryBytes,
        suspended: viewManager.isSuspended(tileId),
        lastActiveAt: Date.now()
      }))
    })
}

app.whenReady().then(() => {
  applyWebTheme(configStore.get().appearance.webTheme)
  etcService = new EtcService(join(app.getPath('userData'), 'etc-history'))
  pluginHost = new PluginHost(join(app.getPath('userData'), 'plugins'))
  // __dirname (not app.getAppPath()) so this resolves the same way in dev
  // (out/main/index.cjs) and packaged (app.asar/out/main/index.cjs) builds —
  // see protocol.ts's identical reasoning for packages/sdk.
  installBundledPlugins(pluginHost, join(__dirname, '../../plugins-builtin'), ['slack'])
  hostApiBridge = new PluginHostApiBridge(
    pluginHost,
    join(app.getPath('userData'), 'plugin-data'),
    (card) => send('hq:card-published', card),
    (cardId) => send('hq:card-cleared', cardId)
  )
  registerPluginProtocolHandler(pluginHost)

  const safeStorageCrypto = createSafeStorageCrypto()
  googleConnector = new GoogleConnector(
    new GoogleCredentialsStore(join(app.getPath('userData'), 'google-credentials.enc'), safeStorageCrypto)
  )
  secretStore = new SecretStore(join(app.getPath('userData'), 'builder-secrets.enc'), safeStorageCrypto)

  viewManager = new ViewManager({
    getWindow: () => mainWindow,
    onSnapshotUpdated: (tileId, snapshot) => send('tile:snapshot-updated', tileId, snapshot),
    onTitleUpdated: (tileId, title) => send(IPC.tileTitleUpdated, tileId, title),
    onNavigated: (tileId, state) => send('tile:navigated', tileId, state)
  })
  ptyManager = new PtyManager({
    onData: (tileId, data) => send(IPC.ptyData, tileId, data),
    onExit: (tileId, exitCode) => send(IPC.ptyExit, tileId, exitCode)
  })

  registerIpcHandlers()
  createWindow()
  startMemoryLoop()
  startGooglePollLoop()

  app.on('activate', () => {
    if (mainWindow === null) createWindow()
  })
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  configStore?.flush()
  ptyManager?.disposeAll()
  fsWatchers.stopAll()
  viewManager?.disposeAll()
  if (googlePollTimer) clearInterval(googlePollTimer)
})
