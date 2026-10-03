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
  /** A tile, a tile's sub-view ("<tileId>::<name>"), or the "__shell" / "__core" rows. */
  tileId: string
  /** Resident set size, in bytes. */
  memoryBytes: number
  /** Only while it's busy (see main/sysmon/cpuBadges.ts), else null. 100 = one core fully busy. */
  cpuPercent: number | null
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

/** AppConfig.appearance.webTheme (see its doc comment). */
export type WebTheme = 'dark' | 'force-dark' | 'light' | 'system'

/** AppConfig.search.engine — the engines themselves are in presets.ts. */
export type SearchEngineId = 'duckduckgo' | 'google' | 'bing' | 'brave'
