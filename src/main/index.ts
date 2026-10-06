import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { ConfigStore } from './configStore'
import { createSafeStorageCrypto } from './cryptoAdapter'
import { SecretStore } from './secretStore'
import { applyWebTheme, registerAppIpc } from './appIpc'
import { createMainWindow, focusMainWindow, getMainWindow, inBackground, isShellSender, pluginFramePids, send, shellProcessId } from './window'
import { guardIpcSenders, installSecurityPolicies } from './security'
import { ViewManager } from './views/viewManager'
import { registerViewsIpc } from './views/ipc'
import { startMemoryLoop } from './views/memoryLoop'
import { PtyManager } from './terminal/ptyManager'
import { registerTerminalIpc } from './terminal/ipc'
import { terminalsToPrewarm } from './terminal/prewarm'
import { FsWatchRegistry } from './files/fsService'
import { registerFilesIpc } from './files/ipc'
import { registerSysmonIpc } from './sysmon/ipc'
import { EtcService } from './settings/etc/etcService'
import { registerSettingsIpc } from './settings/ipc'
import { PluginHost } from './plugins/pluginHost'
import { PluginHostApiBridge } from './plugins/hostApiBridge'
import { installBundledPlugins } from './plugins/bootstrapBundled'
import { registerPluginSchemeAsPrivileged, registerPluginProtocolHandler } from './plugins/protocol'
import { registerPluginsIpc } from './plugins/ipc'
import { GoogleConnector } from './google/google'
import { GoogleCredentialsStore } from './google/googleCredentialsStore'
import { registerGoogleIpc } from './google/ipc'
import { registerBuilderIpc } from './builder/ipc'
import { perfMark, profileStartup, timeIpcHandlers, traceStartup } from './perf'

perfMark('main:modules-loaded')
profileStartup()

/*
 * Boots the app: what has to happen before app.ready, then every service,
 * each feature's IPC (the ipc.ts in each folder), the window and the
 * background loops.
 */

// Single instance: a second launch just focuses the existing window instead
// of opening a duplicate command HQ. app.quit() doesn't stop this process
// right away, so the second instance must also skip all of the startup —
// otherwise it reinstalls the bundled plugins under the running instance,
// opens a window and flushes its stale copy of config.json before exiting.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  boot()
}

function boot(): void {
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
  if (inBackground()) {
    // E2E: the window sits off screen (window.ts). Without this, Chromium on Windows counts it as
    // occluded and marks every page hidden: no painting, no rAF, and the app's own pause-on-hidden.
    app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
    // The same on macOS (NSWindow occlusion): an off-screen page went `hidden` after its first frame
    // and capturePage() failed ("Current display surface not available"). MacWebContentsOcclusion
    // off alone didn't help; this switch did (bare Electron 44 script, 2026-10-06).
    if (process.platform === 'darwin') app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  }

  const fsWatchers = new FsWatchRegistry()
  let viewManager: ViewManager | undefined
  let ptyManager: PtyManager | undefined
  let stopGooglePolling: (() => void) | undefined
  let disposeSysmon: (() => void) | undefined

  app.whenReady().then(() => {
    perfMark('main:app-ready')
    traceStartup()
    applyWebTheme(configStore.get().appearance.webTheme)
    const userData = app.getPath('userData')

    const etcService = new EtcService(join(userData, 'etc-history'))
    const pluginHost = new PluginHost(join(userData, 'plugins'))
    // __dirname (not app.getAppPath()) so this resolves the same way in dev
    // (out/main/index.cjs) and packaged (app.asar/out/main/index.cjs) builds —
    // see protocol.ts's identical reasoning for packages/sdk.
    const bundledPluginIds = installBundledPlugins(pluginHost, join(__dirname, '../../plugins-builtin'), ['slack'])
    perfMark('main:bundled-plugins-installed')
    const hostApiBridge = new PluginHostApiBridge(
      pluginHost,
      join(userData, 'plugin-data'),
      (card) => send(IPC.hqCardPublished, card),
      (cardId) => send(IPC.hqCardCleared, cardId)
    )
    registerPluginProtocolHandler(pluginHost, hostApiBridge)

    const safeStorageCrypto = createSafeStorageCrypto()
    const googleConnector = new GoogleConnector(
      new GoogleCredentialsStore(join(userData, 'google-credentials.enc'), safeStorageCrypto)
    )
    const secretStore = new SecretStore(join(userData, 'builder-secrets.enc'), safeStorageCrypto)

    const views = new ViewManager({
      getWindow: getMainWindow,
      onSnapshotUpdated: (tileId, snapshot) => send(IPC.tileSnapshotUpdated, tileId, snapshot),
      onTitleUpdated: (tileId, title) => send(IPC.tileTitleUpdated, tileId, title),
      onNavigated: (tileId, state) => send(IPC.tileNavigated, tileId, state)
    })
    const ptys = new PtyManager({
      onData: (tileId, data) => send(IPC.ptyData, tileId, data),
      onExit: (tileId, exitCode) => send(IPC.ptyExit, tileId, exitCode)
    })
    viewManager = views
    ptyManager = ptys

    installSecurityPolicies(getMainWindow)
    guardIpcSenders(ipcMain, isShellSender)
    timeIpcHandlers(ipcMain)
    registerAppIpc(configStore, startupWebTheme)
    registerViewsIpc(views, (tileId) => {
      ptys.kill(tileId)
      fsWatchers.stop(tileId)
    })
    registerTerminalIpc(ptys)
    registerFilesIpc(fsWatchers, send)
    disposeSysmon = registerSysmonIpc()
    registerSettingsIpc(etcService)
    registerPluginsIpc(pluginHost, hostApiBridge, send, bundledPluginIds)
    const google = registerGoogleIpc(googleConnector, send)
    registerBuilderIpc({ configStore, secretStore, pluginHost, send })

    perfMark('main:services-ready')
    createMainWindow()
    perfMark('main:window-created')
    // Start the first workspace's shells now, while the window loads: PowerShell needs
    // ~0.7 s to show its prompt. The tile attaches to the running session (as when a
    // workspace is shown again) and resizes it to its real size.
    for (const { tileId, shellId, cwd } of terminalsToPrewarm(configStore.get())) {
      try {
        ptys.create(tileId, { shellId, cwd, cols: 100, rows: 30 })
      } catch (err) {
        console.error(`[terminal] could not start the shell for ${tileId} early:`, err)
      }
    }
    startMemoryLoop({
      viewManager: views,
      suspendAfterMs: () => configStore.get().suspendAfterMs,
      shellProcessId,
      pluginFramePids,
      windowShown: () => {
        const win = getMainWindow()
        return win !== null && win.isVisible() && !win.isMinimized()
      },
      send
    })
    google.startPolling()
    stopGooglePolling = google.stopPolling

    app.on('activate', () => {
      if (getMainWindow() === null) createMainWindow()
    })
  })

  app.on('second-instance', focusMainWindow)

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    configStore.flush()
    ptyManager?.disposeAll()
    fsWatchers.stopAll()
    viewManager?.disposeAll()
    stopGooglePolling?.()
    disposeSysmon?.()
  })
}
