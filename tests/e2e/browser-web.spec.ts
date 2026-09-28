import { test, expect, type ElectronApplication } from '@playwright/test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dock, launch, launchIn, removeDir, startSite, tempDir, webViewUrls, type Session } from './helpers'

/** Renders a page in a hidden window and returns the brightness (0-255) of its top-left pixel. */
async function pageBrightness(app: ElectronApplication, html: string): Promise<number> {
  return app.evaluate(async ({ BrowserWindow }, markup) => {
    const win = new BrowserWindow({ show: false, width: 200, height: 200, paintWhenInitiallyHidden: true })
    await win.loadURL(`data:text/html,${encodeURIComponent(markup)}`)
    await new Promise((r) => setTimeout(r, 300))
    const image = await win.webContents.capturePage()
    const bitmap = image.toBitmap() // BGRA
    win.destroy()
    return (bitmap[0] + bitmap[1] + bitmap[2]) / 3
  }, html)
}

test('Browser defaults to DuckDuckGo', async () => {
  const s = await launch()
  try {
    await dock(s.window, 'Browser').click()
    await expect(s.window.locator('.bt-browser__address')).toHaveAttribute('placeholder', /DuckDuckGo/)
    expect(s.pageErrors).toEqual([])
  } finally {
    await s.cleanup()
  }
})

test('Browser: a new tile is only an address bar; the page it was on comes back after a restart', async () => {
  const site = await startSite()
  const dir = tempDir()
  let s: Session = await launchIn(dir)
  try {
    await dock(s.window, 'Browser').click()
    const address = s.window.locator('.bt-browser__address')
    await expect(address).toHaveValue('')
    await expect(address).toBeFocused()
    await expect(address).toHaveAttribute('placeholder', /DuckDuckGo で検索/)
    expect(await webViewUrls(s.app)).toEqual([]) // no search page opened

    // Plain words are searched with the configured engine.
    await address.fill('hello world')
    await address.press('Enter')
    await expect(address).toHaveValue('https://duckduckgo.com/?q=hello%20world')

    // A URL is opened as-is; following a link updates the bar.
    await address.fill(`${site.origin}/a`)
    await address.press('Enter')
    await expect.poll(() => webViewUrls(s.app)).toEqual([`${site.origin}/a`])
    await s.app.evaluate(({ BaseWindow }) => {
      const view = BaseWindow.getAllWindows()[0].contentView.children[1] as Electron.WebContentsView
      return view.webContents.executeJavaScript('document.getElementById("next").click()')
    })
    await expect(address).toHaveValue(`${site.origin}/b`)

    await s.app.close()
    s = await launchIn(dir)
    await expect(s.window.locator('.bt-browser__address')).toHaveValue(`${site.origin}/b`)
    await expect.poll(() => webViewUrls(s.app), { timeout: 10_000 }).toEqual([`${site.origin}/b`])
  } finally {
    await s.app.close()
    site.server.close()
    removeDir(dir)
  }
})

test('Web pages get the same 8px scrollbar as built-in tiles, overriding the site', async () => {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html')
    res.end(`<style>::-webkit-scrollbar{width:20px} #box{scrollbar-color:red blue}</style>
      <div id="box" style="width:200px;height:100px;overflow:scroll"><div style="height:1000px"></div></div>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  const s = await launch()
  try {
    await dock(s.window, 'Browser').click()
    const address = s.window.locator('.bt-browser__address')
    await address.fill(url)
    await address.press('Enter')
    const measure = () =>
      s.app.evaluate(({ BaseWindow }) => {
        const view = BaseWindow.getAllWindows()[0].contentView.children[1] as Electron.WebContentsView
        return view.webContents.executeJavaScript('(() => { const b = document.getElementById("box"); return b ? b.offsetWidth - b.clientWidth : -1 })()')
      })
    await expect.poll(measure, { timeout: 10_000 }).toBe(8)
  } finally {
    await s.cleanup()
    server.close()
  }
})

test('Web pages see prefers-color-scheme: dark by default, and the setting switches it live', async () => {
  const s = await launch()
  try {
    const prefersDark = (): Promise<boolean> =>
      s.app.evaluate(async ({ BrowserWindow }) => {
        const win = new BrowserWindow({ show: false })
        await win.loadURL('data:text/html,<p>x</p>')
        const dark = await win.webContents.executeJavaScript('matchMedia("(prefers-color-scheme: dark)").matches')
        win.destroy()
        return dark as boolean
      })

    expect(await prefersDark()).toBe(true)

    await dock(s.window, 'Settings').click()
    const theme = s.window.locator('.bt-settings__field', { hasText: 'Web ページの外観' }).locator('select')
    await theme.selectOption('light')
    await expect.poll(prefersDark).toBe(false)
    await theme.selectOption('dark')
    await expect.poll(prefersDark).toBe(true)

    // Force-dark needs a restart, and the UI says so.
    await theme.selectOption('force-dark')
    await expect(s.window.locator('.bt-settings__restart')).toBeVisible()
  } finally {
    await s.cleanup()
  }
})

test('"常にダーク" darkens a page that has no dark theme of its own (after restart)', async () => {
  const whitePage = '<html><body style="margin:0;background:#fff;height:100vh"></body></html>'

  const normal = await launch()
  let normalBrightness: number
  try {
    normalBrightness = await pageBrightness(normal.app, whitePage)
  } finally {
    await normal.cleanup()
  }

  const forced = await launch({ appearance: { webTheme: 'force-dark' } })
  try {
    const forcedBrightness = await pageBrightness(forced.app, whitePage)
    expect(normalBrightness).toBeGreaterThan(200)
    expect(forcedBrightness).toBeLessThan(80)
  } finally {
    await forced.cleanup()
  }
})
