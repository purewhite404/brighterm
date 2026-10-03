/**
 * The `name` of a plugin tile's <iframe>. The iframe runs in a process of its
 * own; the main process finds it by this name (WebFrameMain.name) to show that
 * tile's memory and CPU.
 */
const PREFIX = 'bt-tile:'

export function pluginFrameName(tileId: string): string {
  return PREFIX + tileId
}

export function tileIdOfPluginFrame(name: string): string | null {
  return name.startsWith(PREFIX) && name.length > PREFIX.length ? name.slice(PREFIX.length) : null
}
