/**
 * Data the main process hands the renderer over IPC (see ipc.ts for the
 * channels, src/preload/index.ts for the calls), grouped by the tile that
 * uses it. Types only — no Node/DOM imports — so every process can use them.
 */

import type { PluginManifest } from './types'

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

export interface ShellOption {
  id: string
  label: string
  path: string
  args: string[]
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
  sizeBytes: number
  modifiedAt: number
  createdAt: number
  /** Dot files everywhere; on Windows also anything with the Hidden or System attribute. */
  hidden: boolean
  /** `ls -l` style on POSIX ("drwxr-xr-x"), PowerShell `Mode` style on Windows ("d-r--"). */
  mode: string
}

/** What a file's contents are (see fileSniff.ts in main) — decides how Files previews it. */
export type SniffKind = 'text' | 'code' | 'image' | 'pdf' | 'video' | 'audio' | 'binary' | 'empty'

export interface SniffResult {
  kind: SniffKind
  /** Human-readable, `file`-style description, e.g. "PNG image data", "UTF-8 text", "Python script". */
  description: string
  /** MIME type when it matters for rendering (images, media, pdf). */
  mime?: string
}

export interface FileInspection extends SniffResult {
  path: string
  sizeBytes: number
  /** Beginning of the file for text/code (truncated at TEXT_PREVIEW_BYTES). */
  text?: string
  truncated?: boolean
  /** data: URL for images small enough to inline. */
  dataUrl?: string
  /** file:// URL, for media/PDF shown in a web view. */
  fileUrl: string
}

// ---------------------------------------------------------------------------
// System Monitor
// ---------------------------------------------------------------------------

export interface ProcessInfo {
  pid: number
  name: string
  cpu: number
  memBytes: number
  command: string
}

export interface SystemSnapshot {
  cpuLoadPercent: number
  totalMemBytes: number
  usedMemBytes: number
  /** Omitted when the caller didn't ask for processes (listing them is far slower than CPU/memory). */
  topProcesses?: ProcessInfo[]
}

// ---------------------------------------------------------------------------
// Settings (OS shortcuts, Linux /etc editor)
// ---------------------------------------------------------------------------

/** One clickable entry in the Settings tile's OS shortcut list. */
export interface SettingsShortcut {
  id: string
  label: string
  /** A `ms-settings:` URI, an `x-apple.systempreferences:` URI, or an argv-style shell command. */
  kind: 'uri' | 'command'
  /** Icon name from the renderer's Icon set. */
  icon: string
  target: string
  args?: string[]
}

export interface EtcFileDescriptor {
  label: string
  path: string
  exists: boolean
}

export type DiffOp = { type: 'equal' | 'add' | 'remove'; line: string }

export interface HistoryEntry {
  timestamp: number
  fileName: string
  content: string
}

export interface AugeasNode {
  /** Full Augeas path, e.g. "/files/etc/hosts/1/ipaddr". */
  path: string
  value: string | null
}

export interface ExecResult {
  ok: boolean
  output: string
}

// ---------------------------------------------------------------------------
// Plugins (Dock, command palette, AI Builder)
// ---------------------------------------------------------------------------

export interface PluginInstallIssue {
  file?: string
  message: string
}

export interface PluginInstallResult {
  ok: boolean
  manifest?: PluginManifest
  errors: PluginInstallIssue[]
  /** Non-fatal but worth surfacing to the user before they approve the permission list. */
  warnings: PluginInstallIssue[]
}

export interface PluginListItem {
  manifest: PluginManifest
  dir: string
  enabled: boolean
  installedAt: number
  versions: string[]
}

// ---------------------------------------------------------------------------
// AI Builder (API mode)
// ---------------------------------------------------------------------------

export type AgentEvent =
  | { type: 'assistant-text'; text: string }
  | { type: 'tool-call'; name: string; arguments: unknown }
  | { type: 'tool-result'; name: string; result: unknown }
  | { type: 'error'; message: string }
  | { type: 'done' }

// ---------------------------------------------------------------------------
// Calendar (Google)
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  id: string
  title: string
  /** ISO date-time, or YYYY-MM-DD for all-day events. */
  start: string
  end: string
  allDay: boolean
  url?: string
}
