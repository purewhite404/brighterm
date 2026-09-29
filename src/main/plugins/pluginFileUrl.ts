/** The scheme kind:"app" plugins are served from: plugin-app://<pluginId>/<relative-path>. */
export const PLUGIN_PROTOCOL = 'plugin-app'

/**
 * `fs.fileUrl()` hands a plugin URLs of the form
 * plugin-app://<pluginId>/__brighterm_file__/<handleId>/<path in that folder>,
 * which the protocol handler serves after the same permission and
 * stay-inside-the-folder checks as `fs.readFile`. They're under the plugin's
 * own origin, so the browser loads images/video/PDF from them directly.
 */
const FILE_PREFIX = '__brighterm_file__'

export function buildPluginFileUrl(pluginId: string, handleId: string, relativePath: string): string {
  const segments = relativePath.split(/[\\/]+/).filter((s) => s !== '' && s !== '.')
  return `${PLUGIN_PROTOCOL}://${pluginId}/${FILE_PREFIX}/${encodeURIComponent(handleId)}/${segments.map(encodeURIComponent).join('/')}`
}

/** The raw (still percent-encoded) pathname of a request → which granted file it asks for, or null if it's not a file URL. */
export function parsePluginFilePath(rawPathname: string): { handleId: string; relativePath: string } | null {
  const [prefix, handle, ...rest] = rawPathname.replace(/^\/+/, '').split('/')
  if (prefix !== FILE_PREFIX || !handle || rest.length === 0) return null
  try {
    return { handleId: decodeURIComponent(handle), relativePath: rest.map(decodeURIComponent).join('/') }
  } catch {
    return null
  }
}
