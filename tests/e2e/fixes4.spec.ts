import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MAIN_ENTRY = resolve(__dirname, '../../out/main/index.cjs')

async function launchIn(userDataDir: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({ args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`], colorScheme: null })
  const window = await app.firstWindow()
  await expect(window.locator('.bt-dock')).toBeVisible({ timeout: 15_000 })
  return { app, window }
}

const dock = (window: Page, title: string) => window.locator(`.bt-dock__button[title="${title}"]`)

/** A workspace with one Files tile rooted at `root` (and optionally more tiles). */
function seedFiles(userDataDir: string, root: string, extraTiles: Record<string, object> = {}): void {
  const tiles: Record<string, object> = {
    files: { id: 'files', kind: 'builtin', typeId: 'file-explorer', title: 'Files', icon: 'folder', config: { rootPath: root, expandedPaths: [root] } },
    ...extraTiles
  }
  const ids = Object.keys(tiles)
  const layout =
    ids.length === 1
      ? { type: 'leaf', tileId: ids[0] }
      : { type: 'split', direction: 'row', ratio: 0.5, a: { type: 'leaf', tileId: ids[0] }, b: { type: 'leaf', tileId: ids[1] } }
  writeFileSync(
    join(userDataDir, 'config.json'),
    JSON.stringify({ workspaces: [{ id: 'ws', name: 'Home', icon: 'home', layout, tiles }], activeWorkspaceId: 'ws' })
  )
}

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

function makeTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'brighterm-files-'))
  mkdirSync(join(root, 'docs'))
  mkdirSync(join(root, '.git'))
  mkdirSync(join(root, 'WinHidden'))
  writeFileSync(join(root, '.env'), 'SECRET=1\n')
  writeFileSync(join(root, 'memo.txt'), '買い物リスト\n- 牛乳\n')
  writeFileSync(join(root, 'app.log'), '2026-09-28 07:20:31 INFO started\n')
  // Content decides, not the extension: HTML in a .txt is previewed, plain text in a .dat is edited.
  writeFileSync(join(root, 'page.txt'), '<!doctype html>\n<html><body><h1>hi</h1></body></html>\n')
  writeFileSync(join(root, 'plain.dat'), 'just some words\n')
  writeFileSync(join(root, 'main.py'), 'import os\nimport sys\n\ndef main():\n    print(os.getcwd())\n')
  writeFileSync(join(root, 'pixel.png'), TINY_PNG)
  if (process.platform === 'win32') execFileSync('attrib', ['+h', join(root, 'WinHidden')])
  return root
}

const names = (w: Page) => w.locator('.bt-file-row__name').allTextContents()
const row = (w: Page, name: string) => w.locator('.bt-file-row').filter({ has: w.getByText(name, { exact: true }) })

test('Files: hidden entries are hidden by default, ls-style columns are shown, settings toggle them', async () => {
  const root = makeTree()
  const dir = mkdtempSync(join(tmpdir(), 'brighterm-e2e-'))
  seedFiles(dir, root)
  const s = await launchIn(dir)
  try {
    await expect.poll(() => names(s.window)).toEqual([root, 'docs', 'app.log', 'main.py', 'memo.txt', 'page.txt', 'pixel.png', 'plain.dat'])

    // Mode / size / modified columns by default.
    const memo = row(s.window, 'memo.txt')
    await expect(memo.locator('.bt-file-row__col--mode')).toHaveText(process.platform === 'win32' ? /^-a---$/ : /^-rw/)
    await expect(memo.locator('.bt-file-row__col--size')).toHaveText(String(statSync(join(root, 'memo.txt')).size))
    await expect(memo.locator('.bt-file-row__col--time')).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)

    // The settings panel is always visible on a wide tile.
    const settings = s.window.getByLabel('Files の設定', { exact: true })
    await expect(settings).toBeVisible()
    await settings.getByLabel('隠しファイルを表示').check()
    await expect.poll(() => names(s.window)).toContain('.env')
    expect(await names(s.window)).toEqual(
      expect.arrayContaining(['.git', '.env', ...(process.platform === 'win32' ? ['WinHidden'] : [])])
    )

    await settings.getByLabel('作成日時').check()
    await expect(memo.locator('.bt-file-row__col--time')).toHaveCount(2)
    await settings.getByLabel('モード').uncheck()
    await expect(memo.locator('.bt-file-row__col--mode')).toHaveCount(0)

    await settings.getByLabel('並べ替え', { exact: true }).selectOption('size')
    await settings.getByLabel('並べ替えの向き').selectOption('desc')
    const files = (await names(s.window)).filter((n) => !['docs', '.git', 'WinHidden', root].includes(n))
    expect(files[0]).toBe('pixel.png') // the largest file
  } finally {
    await s.app.close()
    rmSync(dir, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('Files: creates a folder and an empty file in the selected folder', async () => {
  const root = makeTree()
  const dir = mkdtempSync(join(tmpdir(), 'brighterm-e2e-'))
  seedFiles(dir, root)
  const s = await launchIn(dir)
  try {
    await row(s.window, 'docs').click() // select (and expand) docs
    const settings = s.window.getByLabel('Files の設定', { exact: true })
    await expect(settings).toContainText(`作成先: ${join(root, 'docs')}`)
    await settings.getByLabel('新しい名前').fill('sub')
    await settings.getByRole('button', { name: 'フォルダ' }).click()
    await expect.poll(() => existsSync(join(root, 'docs', 'sub'))).toBe(true)
    await settings.getByLabel('新しい名前').fill('empty.txt')
    await settings.getByRole('button', { name: '空ファイル' }).click()
    await expect.poll(() => existsSync(join(root, 'docs', 'empty.txt'))).toBe(true)
    expect(readFileSync(join(root, 'docs', 'empty.txt'), 'utf-8')).toBe('')
    await expect.poll(() => names(s.window)).toEqual(expect.arrayContaining(['sub', 'empty.txt']))

    // A duplicate name is refused with a message.
    await settings.getByLabel('新しい名前').fill('sub')
    await settings.getByRole('button', { name: 'フォルダ' }).click()
    await expect(settings).toContainText('同じ名前がすでにあります')
  } finally {
    await s.app.close()
    rmSync(dir, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('Files: plain text opens in Notes for editing; code, HTML and images are previewed', async () => {
  const root = makeTree()
  const dir = mkdtempSync(join(tmpdir(), 'brighterm-e2e-'))
  seedFiles(dir, root)
  const s = await launchIn(dir)
  try {
    const notes = s.window.frameLocator('iframe.bt-plugin-frame')

    // memo.txt → Notes opens with it, and edits are saved back to the file.
    await row(s.window, 'memo.txt').click()
    await expect(notes.locator('#content')).toHaveValue('買い物リスト\n- 牛乳\n', { timeout: 10_000 })
    await expect(notes.locator('#title')).toHaveValue('memo.txt')
    await notes.locator('#content').fill('買い物リスト\n- 牛乳\n- 卵\n')
    await expect.poll(() => readFileSync(join(root, 'memo.txt'), 'utf-8'), { timeout: 5000 }).toBe('買い物リスト\n- 牛乳\n- 卵\n')

    // Another text file (no text extension at all) reuses the same Notes tile.
    await row(s.window, 'plain.dat').click()
    await expect(notes.locator('#content')).toHaveValue('just some words\n')
    await expect(s.window.locator('iframe.bt-plugin-frame')).toHaveCount(1)

    // HTML (even named .txt) → read-only preview, Notes keeps what it had.
    await row(s.window, 'page.txt').click()
    const preview = s.window.getByLabel('プレビュー')
    await expect(preview).toContainText('HTML document')
    await expect(preview.locator('.bt-files__code')).toContainText('<h1>hi</h1>')
    await expect(notes.locator('#content')).toHaveValue('just some words\n')

    await row(s.window, 'main.py').click()
    await expect(preview.locator('.bt-files__code')).toContainText('def main():')

    await row(s.window, 'pixel.png').click()
    await expect(preview).toContainText('PNG image data')
    await expect(preview.locator('img.bt-files__image')).toBeVisible()
  } finally {
    await s.app.close()
    rmSync(dir, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('Files: on a narrow tile the settings sit behind a gear button', async () => {
  const root = makeTree()
  const dir = mkdtempSync(join(tmpdir(), 'brighterm-e2e-'))
  // Four tiles → each is a quarter of the window, narrower than the wide threshold.
  const term = (id: string) => ({ id, kind: 'builtin', typeId: 'calendar', title: 'Calendar', icon: 'calendar' })
  const tiles = {
    files: { id: 'files', kind: 'builtin', typeId: 'file-explorer', title: 'Files', icon: 'folder', config: { rootPath: root, expandedPaths: [root] } },
    c1: term('c1'),
    c2: term('c2'),
    c3: term('c3')
  }
  const leaf = (id: string) => ({ type: 'leaf', tileId: id })
  const layout = {
    type: 'split',
    direction: 'column',
    ratio: 0.5,
    a: { type: 'split', direction: 'row', ratio: 0.5, a: leaf('files'), b: leaf('c1') },
    b: { type: 'split', direction: 'row', ratio: 0.5, a: leaf('c2'), b: leaf('c3') }
  }
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ workspaces: [{ id: 'ws', name: 'Home', icon: 'home', layout, tiles }], activeWorkspaceId: 'ws' }))
  const s = await launchIn(dir)
  try {
    await s.app.evaluate(({ BaseWindow }) => {
      const win = BaseWindow.getAllWindows()[0]
      win.unmaximize()
      win.setContentSize(1200, 800)
    })
    await expect.poll(() => s.window.locator('.bt-files').evaluate((el) => el.clientWidth)).toBeLessThan(760)
    await expect.poll(() => names(s.window)).toContain('docs')
    const settings = s.window.getByLabel('Files の設定', { exact: true })
    await expect(settings).toHaveCount(0)
    await s.window.getByLabel('Files の設定を開く').click()
    await expect(settings).toBeVisible()
    await expect(settings).toBeInViewport()
  } finally {
    await s.app.close()
    rmSync(dir, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('Terminal: the last row is fully inside the tile', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brighterm-e2e-'))
  const s = await launchIn(dir)
  try {
    await dock(s.window, 'Terminal').click()
    await expect(s.window.locator('.xterm-rows')).toContainText(/\S/, { timeout: 15_000 })
    await s.window.waitForTimeout(500)
    const { screenBottom, tileBottom, rowHeight } = await s.window.evaluate(() => {
      const screen = document.querySelector('.xterm-screen')!.getBoundingClientRect()
      const tile = document.querySelector('.bt-terminal-tile')!.getBoundingClientRect()
      const rows = document.querySelector('.xterm-rows')!.children
      return { screenBottom: screen.bottom, tileBottom: tile.bottom, rowHeight: screen.height / rows.length }
    })
    expect(rowHeight).toBeGreaterThan(5)
    expect(screenBottom).toBeLessThanOrEqual(tileBottom)
  } finally {
    await s.app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('App memory is reported every 0.5 s', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brighterm-e2e-'))
  const s = await launchIn(dir)
  try {
    const count = await s.window.evaluate(
      () =>
        new Promise<number>((done) => {
          let n = 0
          const off = window.api.memory.onSnapshot(() => n++)
          setTimeout(() => {
            off()
            done(n)
          }, 2600)
        })
    )
    expect(count).toBeGreaterThanOrEqual(4)
    await expect(s.window.locator('.bt-statusbar')).not.toContainText('/ 1.50 GB')
  } finally {
    await s.app.close()
    rmSync(dir, { recursive: true, force: true })
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
  const dir = mkdtempSync(join(tmpdir(), 'brighterm-e2e-'))
  const s = await launchIn(dir)
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
    await s.app.close()
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

/** A silent mono 8 kHz WAV, 0.1 s long by default. */
function wav(samples = 800): Buffer {
  const b = Buffer.alloc(44 + samples)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + samples, 4)
  b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(8000, 24)
  b.writeUInt32LE(8000, 28)
  b.writeUInt16LE(1, 32)
  b.writeUInt16LE(8, 34)
  b.write('data', 36)
  b.writeUInt32LE(samples, 40)
  b.fill(128, 44)
  return b
}

test('Files: PDF / audio previews follow the clicked file; the Files tile keeps its name', async () => {
  const root = makeTree()
  const dir = mkdtempSync(join(tmpdir(), 'brighterm-e2e-'))
  seedFiles(dir, root)
  // Make real PDFs with Chromium first (a throwaway launch), so the tree lists them from the start.
  const gen = await electron.launch({ args: [MAIN_ENTRY, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'brighterm-gen-'))}`] })
  await gen.firstWindow()
  for (const name of ['report', 'second']) {
    const pdf64 = await gen.evaluate(async ({ BrowserWindow }, title) => {
      const w = new BrowserWindow({ show: false })
      await w.loadURL(`data:text/html,<h1>${title}</h1>`)
      const data = await w.webContents.printToPDF({})
      w.destroy()
      return data.toString('base64')
    }, name)
    writeFileSync(join(root, `${name}.pdf`), Buffer.from(pdf64, 'base64'))
  }
  await gen.close()
  writeFileSync(join(root, 'beep.wav'), wav())

  const s = await launchIn(dir)
  try {
    const preview = s.window.getByLabel('プレビュー')
    /** URL + bounds + how much is painted, of the (single) preview view. */
    const previewView = () =>
      s.app.evaluate(async ({ BaseWindow }) => {
        const views = BaseWindow.getAllWindows()[0]
          .contentView.children.slice(1)
          .map((c) => c as Electron.WebContentsView)
          .filter((c) => c.webContents.getURL().startsWith('file:'))
        if (views.length !== 1) return { count: views.length, url: '', painted: 0, bounds: null }
        const bmp = (await views[0].webContents.capturePage()).toBitmap()
        let painted = 0
        for (let i = 0; i < bmp.length; i += 4 * 97) if (bmp[i] > 40) painted++
        return { count: 1, url: views[0].webContents.getURL(), painted, bounds: views[0].getBounds() }
      })

    await row(s.window, 'report.pdf').click()
    await expect(preview).toContainText('PDF document')
    await expect.poll(async () => (await previewView()).url, { timeout: 10_000 }).toMatch(/report\.pdf$/)
    await expect.poll(async () => (await previewView()).painted, { timeout: 10_000 }).toBeGreaterThan(100)
    const pane = await preview.locator('.bt-files__media').boundingBox()
    const { bounds } = await previewView()
    expect(Math.abs(bounds!.x - pane!.x)).toBeLessThanOrEqual(2)
    expect(Math.abs(bounds!.width - pane!.width)).toBeLessThanOrEqual(2)

    // The user's report: every later file kept showing the first one.
    for (const name of ['second.pdf', 'beep.wav', 'report.pdf']) {
      await row(s.window, name).click()
      await expect(preview.locator('.bt-files__preview-name')).toHaveText(name)
      await expect.poll(async () => (await previewView()).url, { timeout: 10_000 }).toMatch(new RegExp(`${name.replace('.', '\\.')}$`))
    }
    await expect(preview).toContainText('PDF document')
    expect((await previewView()).count).toBe(1)
    await expect(s.window.locator('.bt-tile__title')).toHaveText('Files')
  } finally {
    await s.app.close()
    rmSync(dir, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('Files: audio/video previews do not autoplay and stop when another file is selected', async () => {
  const root = makeTree()
  writeFileSync(join(root, 'long.wav'), wav(8000 * 5))
  const dir = mkdtempSync(join(tmpdir(), 'brighterm-e2e-'))
  seedFiles(dir, root)
  const s = await launchIn(dir)
  const inPreview = <T,>(script: string) =>
    s.app.evaluate(async ({ BaseWindow }, js) => {
      const view = BaseWindow.getAllWindows()[0]
        .contentView.children.slice(1)
        .map((c) => c as Electron.WebContentsView)
        .find((c) => c.webContents.getURL().startsWith('file:') || c.webContents.getURL() === 'about:blank')
      return view ? view.webContents.executeJavaScript(js) : null
    }, script) as Promise<T | null>
  try {
    await row(s.window, 'long.wav').click()
    await expect.poll(() => inPreview<boolean>('!!document.querySelector("video, audio")'), { timeout: 10_000 }).toBe(true)
    await s.window.waitForTimeout(1500)
    // Loaded, but not playing.
    expect(await inPreview('(() => { const m = document.querySelector("video, audio"); return { paused: m.paused, t: m.currentTime } })()')).toEqual({ paused: true, t: 0 })

    // Start it (as the user would with the play button), then select another file.
    await s.app.evaluate(({ BaseWindow }) => {
      const view = BaseWindow.getAllWindows()[0].contentView.children.slice(1).map((c) => c as Electron.WebContentsView).find((c) => c.webContents.getURL().endsWith('long.wav'))!
      return view.webContents.executeJavaScript('document.querySelector("video, audio").play().then(() => true)', true)
    })
    await expect.poll(() => inPreview<boolean>('!document.querySelector("video, audio").paused')).toBe(true)
    await row(s.window, 'main.py').click()
    await expect(s.window.getByLabel('プレビュー').locator('.bt-files__code')).toBeVisible()
    await expect.poll(() => inPreview<string>('location.href')).toBe('about:blank')
  } finally {
    await s.app.close()
    rmSync(dir, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('Files: after the user has clicked play in one preview, the next file still does not autoplay', async () => {
  const root = makeTree()
  writeFileSync(join(root, 'one.wav'), wav(8000 * 5))
  writeFileSync(join(root, 'two.wav'), wav(8000 * 5))
  const dir = mkdtempSync(join(tmpdir(), 'brighterm-e2e-'))
  seedFiles(dir, root)
  const s = await launchIn(dir)
  const media = () =>
    s.app.evaluate(async ({ BaseWindow }) => {
      const view = BaseWindow.getAllWindows()[0]
        .contentView.children.slice(1)
        .map((c) => c as Electron.WebContentsView)
        .find((c) => c.webContents.getURL().endsWith('.wav'))
      if (!view) return null
      return view.webContents.executeJavaScript(
        '(() => { const m = document.querySelector("video, audio"); return m && { url: location.pathname.split("/").pop(), paused: m.paused } })()'
      )
    }) as Promise<{ url: string; paused: boolean } | null>
  try {
    await row(s.window, 'one.wav').click()
    await expect.poll(async () => (await media())?.url, { timeout: 10_000 }).toBe('one.wav')
    await s.window.waitForTimeout(1000)
    expect((await media())?.paused).toBe(true)

    // The user starts playback (a user gesture inside the preview document).
    await s.app.evaluate(({ BaseWindow }) => {
      const view = BaseWindow.getAllWindows()[0].contentView.children.slice(1).map((c) => c as Electron.WebContentsView).find((c) => c.webContents.getURL().endsWith('.wav'))!
      return view.webContents.executeJavaScript('document.querySelector("video, audio").play().then(() => true)', true)
    })
    await expect.poll(async () => (await media())?.paused, { timeout: 5000 }).toBe(false)

    await row(s.window, 'two.wav').click()
    await expect.poll(async () => (await media())?.url, { timeout: 10_000 }).toBe('two.wav')
    await s.window.waitForTimeout(1500)
    expect((await media())?.paused).toBe(true)
  } finally {
    await s.app.close()
    rmSync(dir, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('Files: a .tar.xz is described by its format, not as "data"', async () => {
  const root = makeTree()
  execFileSync('tar', ['-cJf', 'bundle.tar.xz', 'memo.txt'], { cwd: root })
  execFileSync('tar', ['-cf', 'plain.tar', 'memo.txt'], { cwd: root })
  const dir = mkdtempSync(join(tmpdir(), 'brighterm-e2e-'))
  seedFiles(dir, root)
  const s = await launchIn(dir)
  try {
    const preview = s.window.getByLabel('プレビュー')
    await row(s.window, 'bundle.tar.xz').click()
    await expect(preview.locator('.bt-files__preview-meta')).toContainText('XZ compressed data')
    await row(s.window, 'plain.tar').click()
    await expect(preview.locator('.bt-files__preview-meta')).toContainText('POSIX tar archive')
  } finally {
    await s.app.close()
    rmSync(dir, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})
