/**
 * Every IPC channel between the main process and the preload bridge
 * (src/preload/index.ts), grouped by feature. Channels marked "→ renderer"
 * are events main sends; all others are calls the renderer makes.
 */
export const IPC = {
  // App & config
  configGet: 'config:get',
  configSet: 'config:set',
  appRestartRequired: 'app:restart-required',
  appRelaunch: 'app:relaunch',
  appIsPackaged: 'app:is-packaged',
  shellOpenExternal: 'shell:open-external',
  shellOpenPath: 'shell:open-path',
  shellShowItem: 'shell:show-item',

  // Web views (Browser, Mail, web plugins, AI Builder chat, Files preview) and overlays
  tileCreate: 'tile:create',
  tileClose: 'tile:close',
  tileSetBounds: 'tile:set-bounds',
  tileFocus: 'tile:focus',
  tileSuspend: 'tile:suspend',
  tileResume: 'tile:resume',
  tileHide: 'tile:hide',
  tileNavigate: 'tile:navigate',
  tileGoBack: 'tile:go-back',
  tileGoForward: 'tile:go-forward',
  tileReload: 'tile:reload',
  tileNavigated: 'tile:navigated', // → renderer
  tileTitleUpdated: 'tile:title-updated', // → renderer
  tileSnapshotUpdated: 'tile:snapshot-updated', // → renderer
  overlayShow: 'overlay:show',
  overlayHide: 'overlay:hide',
  memorySnapshot: 'memory:snapshot', // → renderer, every 0.5 s

  // Terminal
  shellList: 'shell:list-shells',
  shellDefault: 'shell:default-shell',
  ptyCreate: 'pty:create',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data', // → renderer
  ptyExit: 'pty:exit', // → renderer

  // Files
  fsHomeDir: 'fs:home-dir',
  fsListDir: 'fs:list-dir',
  fsStatEntry: 'fs:stat-entry',
  fsInspect: 'fs:inspect',
  fsReadFile: 'fs:read-file',
  fsWriteFile: 'fs:write-file',
  fsCreate: 'fs:create',
  fsWatchStart: 'fs:watch-start',
  fsWatchStop: 'fs:watch-stop',
  fsChanged: 'fs:changed', // → renderer

  // System Monitor
  sysmonSnapshot: 'sysmon:snapshot',

  // Settings: OS shortcuts and the Linux /etc editor
  settingsGetOsShortcuts: 'settings:get-os-shortcuts',
  settingsOpenShortcut: 'settings:open-shortcut',
  settingsHasDesktopSettingsTool: 'settings:has-desktop-settings-tool',
  etcIsSupported: 'etc:is-supported',
  etcHasAugeas: 'etc:has-augeas',
  etcList: 'etc:list',
  etcRead: 'etc:read',
  etcReadAugeasTree: 'etc:read-augeas-tree',
  etcDiff: 'etc:diff',
  etcValidate: 'etc:validate',
  etcWrite: 'etc:write',
  etcWriteAugeasValue: 'etc:write-augeas-value',
  etcHistory: 'etc:history',
  etcRestore: 'etc:restore',

  // Plugins
  pluginsList: 'plugins:list',
  pluginsValidateBundle: 'plugins:validate-bundle',
  pluginsInstallFromBundle: 'plugins:install-from-bundle',
  pluginsSetEnabled: 'plugins:set-enabled',
  pluginsRollback: 'plugins:rollback',
  pluginsUninstall: 'plugins:uninstall',
  pluginsAppUrl: 'plugins:app-url',
  pluginsGrantFolder: 'plugins:grant-folder',
  pluginsFolderBarPath: 'plugins:folder-bar-path',
  pluginsSuggestFolders: 'plugins:suggest-folders',
  pluginsHostCall: 'plugins:host-call',
  pluginsChanged: 'plugins:changed', // → renderer
  pluginsRequestOpenTile: 'plugins:request-open-tile', // → renderer

  // HQ cards
  hqCardPublished: 'hq:card-published', // → renderer
  hqCardCleared: 'hq:card-cleared', // → renderer

  // Google (Calendar events, HQ cards)
  googleHasClientCredentials: 'google:has-client-credentials',
  googleSetClientCredentials: 'google:set-client-credentials',
  googleIsConnected: 'google:is-connected',
  googleConnect: 'google:connect',
  googleDisconnect: 'google:disconnect',
  googleListEvents: 'google:list-events',

  // AI Builder
  builderHasApiKey: 'builder:has-api-key',
  builderSetApiKey: 'builder:set-api-key',
  builderAgentRun: 'builder:agent-run',
  builderAgentEvent: 'builder:agent-event', // → renderer
  builderExportKit: 'builder:export-kit'
} as const
