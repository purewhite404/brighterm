import { protocol, net } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PluginHost } from './pluginHost'
import { generateBridgeScript, injectIntoHtml, HOST_API_SCRIPT_PATH, TOKENS_CSS_PATH } from './bridgeScript'

/** The scheme kind:"app" plugins are served from: plugin-app://<pluginId>/<relative-path>. */
export const PLUGIN_PROTOCOL = 'plugin-app'

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
export function registerPluginProtocolHandler(pluginHost: PluginHost): void {
  protocol.handle(PLUGIN_PROTOCOL, (request) => {
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

    const targetPath = resolve(item.dir, relativePath)
    const rel = relative(item.dir, targetPath)
    if (rel.startsWith('..')) {
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
      return new Response(injectIntoHtml(html), { headers: { 'content-type': 'text/html' } })
    }

    return net.fetch(pathToFileURL(targetPath).toString())
  })
}

function serveFile(pathOnDisk: string, contentType: string): Response {
  if (!existsSync(pathOnDisk)) return new Response('not found', { status: 404 })
  return new Response(readFileSync(pathOnDisk), { headers: { 'content-type': contentType } })
}

export function pluginAppUrl(pluginId: string, relativePath = ''): string {
  return `${PLUGIN_PROTOCOL}://${pluginId}/${relativePath}`
}
