/**
 * Generates the `window.brighterm` client injected into every kind:"app"
 * plugin's page. It's pure string generation (easy to unit test) — the
 * runtime behavior is a postMessage RPC to the parent frame, which forwards
 * each call to PluginHostApiBridge over IPC and enforces permissions there.
 */
export function generateBridgeScript(pluginId: string): string {
  return `(() => {
  const PLUGIN_ID = ${JSON.stringify(pluginId)};
  let nextId = 1;
  const pending = new Map();

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.__brighterm !== true || typeof data.id !== 'number') return;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.error) entry.reject(new Error(data.error));
    else entry.resolve(data.result);
  });

  function call(method, args) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      window.parent.postMessage({ __brighterm: true, id, pluginId: PLUGIN_ID, method, args }, '*');
    });
  }

  window.brighterm = {
    storage: {
      get: (key) => call('storage.get', [key]),
      set: (key, value) => call('storage.set', [key, value]),
      remove: (key) => call('storage.remove', [key]),
      keys: () => call('storage.keys', [])
    },
    fs: {
      pickFolder: () => call('fs.pickFolder', []),
      listFiles: (handle) => call('fs.listFiles', [handle]),
      readFile: (handle, relativePath) => call('fs.readFile', [handle, relativePath]),
      writeFile: (handle, relativePath, content) => call('fs.writeFile', [handle, relativePath, content]),
      deleteFile: (handle, relativePath) => call('fs.deleteFile', [handle, relativePath])
    },
    net: {
      fetch: (url, init) => call('net.fetch', [url, init])
    },
    hq: {
      publishCard: (card) => call('hq.publishCard', [card]),
      clearCard: (id) => call('hq.clearCard', [id])
    },
    theme: {
      getTokens: () => {
        const style = getComputedStyle(document.documentElement);
        const tokens = {};
        for (const sheet of document.styleSheets) {
          try {
            for (const rule of sheet.cssRules) {
              if (rule.style) {
                for (let i = 0; i < rule.style.length; i++) {
                  const prop = rule.style[i];
                  if (prop.startsWith('--bt-')) tokens[prop] = style.getPropertyValue(prop).trim();
                }
              }
            }
          } catch (_e) { /* cross-origin stylesheet; ignore */ }
        }
        return Promise.resolve(tokens);
      },
      onThemeChanged: () => () => {}
    },
    notify: (title, body) => call('notify', [title, body]),
    openTile: (builtinTypeId) => call('openTile', [builtinTypeId])
  };
})();`
}

export const HOST_API_SCRIPT_PATH = '/__brighterm_host_api__.js'
export const TOKENS_CSS_PATH = '/__brighterm_tokens__.css'

/** Injects the host API script + design tokens stylesheet right after <head> (or at the very start if there's none). */
export function injectIntoHtml(html: string): string {
  const scriptTag = `<script src="${HOST_API_SCRIPT_PATH}"></script>`
  const linkTag = `<link rel="stylesheet" href="${TOKENS_CSS_PATH}">`
  const injected = `${linkTag}\n${scriptTag}`

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}\n${injected}`)
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (match) => `${match}\n<head>${injected}</head>`)
  }
  return `${injected}\n${html}`
}
