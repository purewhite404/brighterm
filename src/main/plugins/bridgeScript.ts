/**
 * Generates the `window.brighterm` client injected into every kind:"app"
 * plugin's page. It's pure string generation (easy to unit test) — the
 * runtime behavior is a postMessage RPC to the parent frame, which forwards
 * each call to PluginHostApiBridge over IPC and enforces permissions there.
 * Uncaught errors in the plugin are reported to the parent frame too, so the
 * tile can show them and offer a fix request for the AI.
 *
 * Host -> plugin events: "openFile" (Files tile) and "folderBarChange" (the
 * folder bar the tile draws above the plugin, see fs.showFolderBar).
 */
export function generateBridgeScript(pluginId: string): string {
  return `(() => {
  const PLUGIN_ID = ${JSON.stringify(pluginId)};
  let nextId = 1;
  const pending = new Map();
  // Host -> plugin events (e.g. "open this file"), queued until a handler is registered.
  const eventHandlers = {};
  const queuedEvents = {};

  function onEvent(name, cb) {
    eventHandlers[name] = cb;
    const queued = queuedEvents[name] || [];
    delete queuedEvents[name];
    for (const payload of queued) cb(payload);
    return () => { if (eventHandlers[name] === cb) delete eventHandlers[name]; };
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window.parent) return;
    if (data && data.__brighterm === true && typeof data.event === 'string') {
      const handler = eventHandlers[data.event];
      if (handler) handler(data.payload);
      else (queuedEvents[data.event] = queuedEvents[data.event] || []).push(data.payload);
      return;
    }
    if (!data || data.__brighterm !== true || typeof data.id !== 'number') return;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.error) entry.reject(new Error(data.error));
    else entry.resolve(data.result);
  });

  // Errors the plugin doesn't handle itself -> the tile's error bar.
  function report(message) {
    window.parent.postMessage({ __brighterm: true, report: 'error', message: String(message) }, '*');
  }
  window.addEventListener('error', (event) => {
    const where = event.filename ? ' (' + event.filename.split('/').pop() + ':' + event.lineno + ')' : '';
    report((event.message || 'Error') + where);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    report(reason && reason.message ? reason.message : reason);
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
      // Answered by the tile itself (PluginFrame): it draws the bar; the path never comes back here.
      showFolderBar: (handle) => call('fs.showFolderBar', [handle === undefined ? null : handle]),
      onFolderBarChange: (cb) => onEvent('folderBarChange', cb),
      listFiles: (handle, relativeDir) => call('fs.listFiles', [handle, relativeDir]),
      fileUrl: (handle, relativePath) => call('fs.fileUrl', [handle, relativePath]),
      readFile: (handle, relativePath) => call('fs.readFile', [handle, relativePath]),
      writeFile: (handle, relativePath, content) => call('fs.writeFile', [handle, relativePath, content]),
      deleteFile: (handle, relativePath) => call('fs.deleteFile', [handle, relativePath]),
      copyPath: (handle, relativePath) => call('fs.copyPath', [handle, relativePath])
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
    openTile: (builtinTypeId) => call('openTile', [builtinTypeId]),
    onOpenFile: (cb) => onEvent('openFile', cb)
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
