import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginHost } from './pluginHost'
import { readDirAsBundleFiles } from './dirBundle'

/**
 * Installs (or re-installs, to pick up fixes shipped in an app update) the
 * plugins bundled under plugins-builtin/ at every startup. This is how
 * Notes and Slack get onto the dock without the user ever touching the AI
 * Builder — it's the same PluginHost.install() path a user-generated
 * `.btplugin` goes through, just fed from disk instead of a parsed bundle.
 */

export function installBundledPlugins(
  pluginHost: PluginHost,
  builtinDir: string,
  defaultDisabledIds: string[] = []
): void {
  let entries: string[]
  try {
    entries = readdirSync(builtinDir)
  } catch (err) {
    console.error(`[bootstrapBundled] could not read ${builtinDir}:`, err)
    return
  }

  for (const name of entries) {
    const dir = join(builtinDir, name)
    if (!statSync(dir).isDirectory()) continue

    const wasAlreadyInstalled = pluginHost.getListItem(name) !== null
    const files = readDirAsBundleFiles(dir)
    const result = pluginHost.install(files)

    if (!result.ok) {
      console.error(`[bootstrapBundled] failed to install bundled plugin "${name}":`, result.errors)
      continue
    }
    if (!wasAlreadyInstalled && defaultDisabledIds.includes(name)) {
      pluginHost.setEnabled(name, false)
    }
  }
}
