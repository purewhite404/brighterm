import { protocol, net } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PluginHost } from './pluginHost'
import type { PluginHostApiBridge } from './hostApiBridge'
import { generateBridgeScript, injectIntoHtml, HOST_API_SCRIPT_PATH, TOKENS_CSS_PATH } from './bridgeScript'
import { PLUGIN_PROTOCOL, parsePluginFilePath } from './pluginFileUrl'
import { isInside } from '../utils/pathGuard'
import { pluginCsp, withCsp } from './pluginCsp'

export { PLUGIN_PROTOCOL }

const TOKENS_CSS_PATH_ON_DISK = resolve(__dirname, '../../packages/sdk/ui/tokens.css')

/** Must be called before app.ready — declares the scheme's security policy. */
export function registerPluginSchemeAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PLUGIN_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
        stream: true
      }
    }
  ])
}

/** Must be called after app.ready — installs the actual request handler. */
export function registerPluginProtocolHandler(pluginHost: PluginHost, hostApiBridge: PluginHostApiBridge): void {
  protocol.handle(PLUGIN_PROTOCOL, async (request) => {
    const url = new URL(request.url)
    const pluginId = url.hostname
    let relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    if (relativePath === '') relativePath = 'index.html'

    if (relativePath === HOST_API_SCRIPT_PATH.slice(1)) {
      return new Response(generateBridgeScript(pluginId), {
        headers: { 'content-type': 'text/javascript' }
      })
    }
    if (relativePath === TOKENS_CSS_PATH.slice(1)) {
      return serveFile(TOKENS_CSS_PATH_ON_DISK, 'text/css')
    }

    const item = pluginHost.getListItem(pluginId)
    if (!item || !item.enabled) {
      return new Response('plugin not found or disabled', { status: 404 })
    }
    // Every page and file the plugin loads carries its CSP — also files from the user's
    // folders (an .html opened in a nested <iframe> must not be a way around it).
    const csp = pluginCsp(item.manifest)

    // A file from a folder the user granted this plugin (see fs.fileUrl()).
    const granted = parsePluginFilePath(url.pathname)
    if (granted) {
      try {
        const path = hostApiBridge.resolveFile(pluginId, granted.handleId, granted.relativePath)
        return withCsp(await net.fetch(pathToFileURL(path).toString()), csp)
      } catch (err) {
        return new Response(err instanceof Error ? err.message : String(err), { status: 404 })
      }
    }

    const targetPath = resolve(item.dir, relativePath)
    if (!isInside(item.dir, targetPath)) {
      return new Response('forbidden', { status: 403 })
    }
    if (!existsSync(targetPath)) {
      // AGENTS.md promises plugins a `tokens.css` they can <link> without shipping it.
      if (relativePath === 'tokens.css') return serveFile(TOKENS_CSS_PATH_ON_DISK, 'text/css')
      return new Response('not found', { status: 404 })
    }

    const ext = extname(targetPath).toLowerCase()
    if (ext === '.html') {
      const html = readFileSync(targetPath, 'utf-8')
      return new Response(injectIntoHtml(html), { headers: { 'content-type': 'text/html', 'content-security-policy': csp } })
    }

    return withCsp(await net.fetch(pathToFileURL(targetPath).toString()), csp)
  })
}

function serveFile(pathOnDisk: string, contentType: string): Response {
  if (!existsSync(pathOnDisk)) return new Response('not found', { status: 404 })
  return new Response(readFileSync(pathOnDisk), { headers: { 'content-type': contentType } })
}

export function pluginAppUrl(pluginId: string, relativePath = ''): string {
  return `${PLUGIN_PROTOCOL}://${pluginId}/${relativePath}`
}
