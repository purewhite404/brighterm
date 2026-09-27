import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { parseManifest, type PluginManifest, type PluginPermission } from '@sdk/manifest.schema'
import { type ParsedBundleFile } from './bundleParser'
import { scanFileForForbiddenPatterns, findUndeclaredDomains } from './staticAnalysis'

/**
 * Owns every installed plugin's on-disk state under
 * `<userData>/plugins/<id>/<version>/...`, plus a small registry.json that
 * tracks which version is "current" per plugin and whether it's enabled.
 *
 * Versions are never overwritten once installed (except the exact same
 * version re-submitted during the AI's fix loop) — that's what makes
 * rollback a directory swap instead of a restore-from-backup operation.
 */

export interface PluginRegistryVersionEntry {
  installedAt: number
}

export interface PluginRegistryEntry {
  enabled: boolean
  currentVersion: string
  versions: Record<string, PluginRegistryVersionEntry>
}

interface Registry {
  plugins: Record<string, PluginRegistryEntry>
}

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

function emptyRegistry(): Registry {
  return { plugins: {} }
}

export class PluginHost {
  private readonly registryPath: string

  constructor(private readonly pluginsRoot: string) {
    mkdirSync(pluginsRoot, { recursive: true })
    this.registryPath = join(pluginsRoot, 'installed.json')
  }

  private readRegistry(): Registry {
    if (!existsSync(this.registryPath)) return emptyRegistry()
    try {
      return { ...emptyRegistry(), ...JSON.parse(readFileSync(this.registryPath, 'utf-8')) }
    } catch {
      return emptyRegistry()
    }
  }

  private writeRegistry(registry: Registry): void {
    writeFileSync(this.registryPath, JSON.stringify(registry, null, 2), 'utf-8')
  }

  private versionDir(id: string, version: string): string {
    return join(this.pluginsRoot, id, version)
  }

  /**
   * Validate and install a parsed bundle. Does NOT ask for user confirmation
   * — the caller (IPC handler / AI Builder UI) is expected to show
   * `warnings` (declared permissions, static-analysis notes) and get
   * explicit approval before calling this, or to call `validateOnly` first.
   */
  install(files: ParsedBundleFile[]): PluginInstallResult {
    const validation = this.validate(files)
    if (!validation.ok || !validation.manifest) return validation

    const manifest = validation.manifest
    const dir = this.versionDir(manifest.id, manifest.version)
    mkdirSync(dir, { recursive: true })
    for (const file of files) {
      const fullPath = join(dir, file.path)
      mkdirSync(join(fullPath, '..'), { recursive: true })
      writeFileSync(fullPath, file.content, 'utf-8')
    }

    const registry = this.readRegistry()
    const existing = registry.plugins[manifest.id]
    registry.plugins[manifest.id] = {
      enabled: existing?.enabled ?? true,
      currentVersion: manifest.version,
      versions: {
        ...existing?.versions,
        [manifest.version]: { installedAt: Date.now() }
      }
    }
    this.writeRegistry(registry)

    return validation
  }

  /** Runs every check `install` would, without writing anything to disk. */
  validate(files: ParsedBundleFile[]): PluginInstallResult {
    const errors: PluginInstallIssue[] = []
    const warnings: PluginInstallIssue[] = []

    const manifestFile = files.find((f) => f.path === 'manifest.json')
    if (!manifestFile) {
      return { ok: false, errors: [{ message: 'manifest.json がありません。' }], warnings: [] }
    }

    let manifestRaw: unknown
    try {
      manifestRaw = JSON.parse(manifestFile.content)
    } catch {
      return { ok: false, errors: [{ file: 'manifest.json', message: 'manifest.json が正しい JSON ではありません。' }], warnings: [] }
    }

    const parsed = parseManifest(manifestRaw)
    if (!parsed.ok) {
      return {
        ok: false,
        errors: parsed.errors.map((message: string) => ({ file: 'manifest.json', message })),
        warnings: []
      }
    }
    const manifest = parsed.manifest

    if (manifest.kind === 'app') {
      const entryFile = files.find((f) => f.path === manifest.entry)
      if (!entryFile) {
        errors.push({ message: `manifest の entry で指定された "${manifest.entry}" が見つかりません。` })
      }
    }

    for (const file of files) {
      if (!/\.(js|html)$/.test(file.path)) continue
      for (const finding of scanFileForForbiddenPatterns(file.path, file.content)) {
        errors.push({ file: finding.file, message: finding.message })
      }
    }

    const declaredDomains = manifest.permissions
      .filter((p: PluginPermission): p is Extract<PluginPermission, { type: 'network' }> => p.type === 'network')
      .flatMap((p) => p.domains)
    for (const finding of findUndeclaredDomains(files, declaredDomains)) {
      warnings.push({
        file: finding.file,
        message: `manifest に宣言されていないドメインへの通信が見つかりました: ${finding.hostname}`
      })
    }

    if (manifest.permissions.length > 0) {
      warnings.push({
        message: `このプラグインは次の権限を要求します: ${manifest.permissions.map((p: PluginPermission) => p.type).join(', ')}`
      })
    }

    return { ok: errors.length === 0, manifest, errors, warnings }
  }

  list(): PluginListItem[] {
    const registry = this.readRegistry()
    const items: PluginListItem[] = []
    for (const [id, entry] of Object.entries(registry.plugins)) {
      const dir = this.versionDir(id, entry.currentVersion)
      const manifestPath = join(dir, 'manifest.json')
      if (!existsSync(manifestPath)) continue
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as PluginManifest
        items.push({
          manifest,
          dir,
          enabled: entry.enabled,
          installedAt: entry.versions[entry.currentVersion]?.installedAt ?? 0,
          versions: Object.keys(entry.versions).sort()
        })
      } catch {
        /* corrupt manifest on disk; skip rather than crash the whole list */
      }
    }
    return items
  }

  getListItem(id: string): PluginListItem | null {
    return this.list().find((p) => p.manifest.id === id) ?? null
  }

  setEnabled(id: string, enabled: boolean): void {
    const registry = this.readRegistry()
    const entry = registry.plugins[id]
    if (!entry) return
    entry.enabled = enabled
    this.writeRegistry(registry)
  }

  /** Point `currentVersion` at an already-installed older (or newer) version. */
  rollback(id: string, toVersion: string): boolean {
    const registry = this.readRegistry()
    const entry = registry.plugins[id]
    if (!entry || !entry.versions[toVersion]) return false
    entry.currentVersion = toVersion
    this.writeRegistry(registry)
    return true
  }

  uninstall(id: string): void {
    const registry = this.readRegistry()
    delete registry.plugins[id]
    this.writeRegistry(registry)
    rmSync(join(this.pluginsRoot, id), { recursive: true, force: true })
  }
}
