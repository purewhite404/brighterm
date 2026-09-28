/**
 * Shared types used by main, preload and renderer.
 * Keep this file free of Node/DOM-specific imports so it can be used from any process.
 */

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

/** How a tile's content is produced. */
export type TileKind = 'web' | 'builtin' | 'plugin'

/** The built-in tile types shipped with the app itself (kind: 'builtin'). */
export type BuiltinTileType =
  | 'terminal'
  | 'browser'
  | 'mail'
  | 'calendar'
  | 'file-explorer'
  | 'sysmon'
  | 'ai-builder'
  | 'settings'
  | 'hq'

/**
 * A tile instance placed in a workspace layout.
 * `typeId` is either a BuiltinTileType, or (for kind: 'web' / 'plugin') a
 * registry id pointing at a WebTileDefinition / PluginManifest.
 */
export interface TileInstance {
  /** Unique instance id (not the same as typeId — you can have two Browser tiles open). */
  id: string
  kind: TileKind
  typeId: string
  title: string
  icon?: string
  /** Free-form per-tile config (URL for web tiles, cwd for terminal, etc). */
  config?: Record<string, unknown>
}

/** A reusable definition of a web tile the user (or an AI plugin) can add to the Dock. */
export interface WebTileDefinition {
  id: string
  title: string
  icon: string
  url: string
  /** Electron session partition suffix; same id => shared cookies/login. */
  partitionId: string
  compactCss?: string
}

// ---------------------------------------------------------------------------
// Geometry (shared between main's ViewManager and the renderer's tiling engine)
// ---------------------------------------------------------------------------

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// Layout (tiling tree)
// ---------------------------------------------------------------------------

export type SplitDirection = 'row' | 'column'

export interface LayoutLeaf {
  type: 'leaf'
  tileId: string
}

export interface LayoutSplit {
  type: 'split'
  direction: SplitDirection
  /** Fraction (0..1) of space given to `a`. */
  ratio: number
  a: LayoutNode
  b: LayoutNode
}

export type LayoutNode = LayoutLeaf | LayoutSplit

export interface Workspace {
  id: string
  name: string
  icon: string
  /** null = empty workspace (no tiles yet). */
  layout: LayoutNode | null
  /** All tile instances referenced anywhere in `layout`, keyed by id. */
  tiles: Record<string, TileInstance>
}

// ---------------------------------------------------------------------------
// HQ cards
// ---------------------------------------------------------------------------

export type CardPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface Card {
  /** Stable id so re-publishing the same logical item updates it instead of duplicating. */
  id: string
  /** Which connector/plugin published this, e.g. "google-calendar", "plugin:slack". */
  source: string
  priority: CardPriority
  title: string
  detail?: string
  timestamp?: number
  /** Optional action: clicking the card performs this. */
  action?: {
    label: string
    openTileId?: string
    openTileTypeId?: string
    url?: string
  }
}

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

export type PluginPermission =
  | { type: 'network'; domains: string[] }
  | { type: 'storage' }
  | { type: 'folders' }
  | { type: 'notifications' }
  | { type: 'hqCards' }

export interface PluginManifest {
  id: string
  name: string
  version: string
  icon: string
  kind: 'web' | 'app'
  /** For kind: 'web' */
  url?: string
  /** For kind: 'app' */
  entry?: string
  permissions: PluginPermission[]
  description?: string
}

export interface InstalledPlugin {
  manifest: PluginManifest
  /** Absolute path to userData/plugins/<id>/<version>/ */
  dir: string
  enabled: boolean
  installedAt: number
}

// ---------------------------------------------------------------------------
// Memory / process info
// ---------------------------------------------------------------------------

export interface TileMemoryInfo {
  tileId: string
  /** Resident set size, in bytes. */
  memoryBytes: number
  suspended: boolean
  lastActiveAt: number
}

export interface SystemMemorySnapshot {
  totalAppBytes: number
  tiles: TileMemoryInfo[]
}

// ---------------------------------------------------------------------------
// App config (persisted)
// ---------------------------------------------------------------------------

export interface AppConfig {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  webTileDefinitions: WebTileDefinition[]
  suspendAfterMs: number
  mail: {
    /** One of MAIL_PROVIDERS' ids, or 'custom' to use `customUrl`. */
    provider: string
    customUrl?: string
  }
  search: {
    engine: SearchEngineId
    /** Page a new Browser tile opens. Defaults to the search engine's home page. */
    homeUrl?: string
  }
  calendar: {
    /** 'none' = a plain built-in month calendar; 'google' = also show Google Calendar events. */
    source: 'none' | 'google'
  }
  appearance: {
    /**
     * How embedded web pages (Browser, Mail, ChatGPT, ...) are themed:
     * - 'dark': pages see prefers-color-scheme: dark and use their own dark theme if they have one
     * - 'force-dark': additionally darken pages without a dark theme (Chromium auto dark; needs a restart)
     * - 'light' / 'system': the opposite / follow the OS
     */
    webTheme: WebTheme
  }
  aiBuilder: {
    mode: 'web-bridge' | 'api-agent'
    webBridgeUrl: string
    apiProvider: 'openai' | 'anthropic' | 'gemini' | 'openai-compatible'
    apiModel: string
    /** Custom base URL for openai-compatible (local LLM) providers. */
    apiBaseUrl?: string
  }
}

// ---------------------------------------------------------------------------
// Mail providers / search engines (presets shared by main and renderer)
// ---------------------------------------------------------------------------

export interface MailProvider {
  id: string
  label: string
  url: string
  /** Session partition — providers sharing a login (e.g. Google) share one. */
  partitionId: string
}

export const MAIL_PROVIDERS: MailProvider[] = [
  { id: 'gmail', label: 'Gmail', url: 'https://mail.google.com/mail/u/0/', partitionId: 'google' },
  { id: 'outlook', label: 'Outlook.com', url: 'https://outlook.live.com/mail/', partitionId: 'microsoft' },
  { id: 'outlook365', label: 'Outlook (Microsoft 365 / 職場・学校)', url: 'https://outlook.office.com/mail/', partitionId: 'microsoft' },
  { id: 'yahoo', label: 'Yahoo!メール', url: 'https://mail.yahoo.co.jp/', partitionId: 'yahoo' },
  { id: 'icloud', label: 'iCloud メール', url: 'https://www.icloud.com/mail/', partitionId: 'icloud' },
  { id: 'proton', label: 'Proton Mail', url: 'https://mail.proton.me/', partitionId: 'proton' }
]

export function resolveMail(mail: AppConfig['mail']): { url: string; partitionId: string; label: string } {
  if (mail.provider === 'custom' && mail.customUrl) {
    return { url: mail.customUrl, partitionId: 'mail-custom', label: 'Mail' }
  }
  const preset = MAIL_PROVIDERS.find((p) => p.id === mail.provider) ?? MAIL_PROVIDERS[0]
  return { url: preset.url, partitionId: preset.partitionId, label: preset.label }
}

export type WebTheme = 'dark' | 'force-dark' | 'light' | 'system'

export type SearchEngineId = 'duckduckgo' | 'google' | 'bing' | 'brave'

export const SEARCH_ENGINES: Record<SearchEngineId, { label: string; home: string; query: (q: string) => string }> = {
  duckduckgo: {
    label: 'DuckDuckGo',
    home: 'https://duckduckgo.com/',
    query: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`
  },
  google: {
    label: 'Google',
    home: 'https://www.google.com/',
    query: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`
  },
  bing: { label: 'Bing', home: 'https://www.bing.com/', query: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
  brave: {
    label: 'Brave Search',
    home: 'https://search.brave.com/',
    query: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`
  }
}

/** Address-bar input -> URL: things that look like URLs are opened, anything else is searched. */
export function resolveAddressInput(input: string, engine: SearchEngineId): string {
  const text = input.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text
  if (/^localhost(:\d+)?(\/.*)?$/i.test(text)) return `http://${text}`
  if (!/\s/.test(text) && /^[^/\s]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text)) return `https://${text}`
  return SEARCH_ENGINES[engine].query(text)
}

// ---------------------------------------------------------------------------
// IPC channel names (used by both preload's contextBridge exposure and main's handlers)
// ---------------------------------------------------------------------------

export const IPC = {
  configGet: 'config:get',
  configSet: 'config:set',

  workspaceSwitch: 'workspace:switch',
  workspaceCreate: 'workspace:create',
  workspaceUpdateLayout: 'workspace:update-layout',
  workspaceDelete: 'workspace:delete',

  tileCreate: 'tile:create',
  tileClose: 'tile:close',
  tileSetBounds: 'tile:set-bounds',
  tileFocus: 'tile:focus',
  tileSuspend: 'tile:suspend',
  tileResume: 'tile:resume',
  tileTitleUpdated: 'tile:title-updated', // main -> renderer event

  memorySnapshot: 'memory:snapshot', // main -> renderer event (periodic)

  hqCardsGet: 'hq:cards-get',
  hqCardsUpdated: 'hq:cards-updated', // main -> renderer event

  ptyCreate: 'pty:create',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data', // main -> renderer event
  ptyExit: 'pty:exit', // main -> renderer event

  fsListDir: 'fs:list-dir',
  fsReadFile: 'fs:read-file',
  fsWriteFile: 'fs:write-file',
  fsWatchStart: 'fs:watch-start',
  fsWatchStop: 'fs:watch-stop',
  fsChanged: 'fs:changed', // main -> renderer event

  pluginsList: 'plugins:list',
  pluginsInstallFromPath: 'plugins:install-from-path',
  pluginsInstallFromBundle: 'plugins:install-from-bundle',
  pluginsSetEnabled: 'plugins:set-enabled',
  pluginsRollback: 'plugins:rollback',
  pluginsUninstall: 'plugins:uninstall',
  pluginsHostCall: 'plugins:host-call',

  settingsOpenOsShortcut: 'settings:open-os-shortcut',
  settingsHasDesktopSettingsTool: 'settings:has-desktop-settings-tool',
  etcList: 'etc:list',
  etcRead: 'etc:read',
  etcWrite: 'etc:write',
  etcDiff: 'etc:diff',
  etcValidate: 'etc:validate',
  etcHistory: 'etc:history',
  etcRestore: 'etc:restore',

  builderExportKit: 'builder:export-kit',
  builderAgentRun: 'builder:agent-run',
  builderAgentEvent: 'builder:agent-event' // main -> renderer event
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
