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
  budgetBytes: number
  tiles: TileMemoryInfo[]
}

// ---------------------------------------------------------------------------
// App config (persisted)
// ---------------------------------------------------------------------------

export interface AppConfig {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  webTileDefinitions: WebTileDefinition[]
  memoryBudgetBytes: number
  suspendAfterMs: number
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
