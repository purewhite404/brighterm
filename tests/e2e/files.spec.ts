import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dock, launch, launchIn, removeDir, seedWorkspace, tempDir, type Session } from './helpers'

const filesTile = (root: string, config: object = { expandedPaths: [root] }) => ({
  id: 'files',
  kind: 'builtin',
  typeId: 'file-explorer',
  title: 'Files',
  icon: 'folder',
  config: { rootPath: root, ...config }
})

/** A workspace with one Files tile rooted at `root`, already expanded. */
function seedFiles(userDataDir: string, root: string): void {
  seedWorkspace(userDataDir, { files: filesTile(root) })
}

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

function makeTree(): string {
  const root = tempDir('brighterm-files-')
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

const names = (w: Page) => w.locator('.bt-file-row__name').allTextContents()
const row = (w: Page, name: string) => w.locator('.bt-file-row').filter({ has: w.getByText(name, { exact: true }) })

test('Files: the expanded tree is restored after a restart', async () => {
  const root = tempDir('brighterm-tree-')
  mkdirSync(join(root, 'alpha', 'inner'), { recursive: true })
  mkdirSync(join(root, 'beta'))
  writeFileSync(join(root, 'alpha', 'inner', 'deep.txt'), '')
  const dir = tempDir()
  seedWorkspace(dir, { files: filesTile(root, {}) })
  let s: Session = await launchIn(dir)
  try {
    await expect.poll(() => names(s.window)).toEqual([root])
    await s.window.locator('.bt-file-row').first().click()
    await row(s.window, 'alpha').click()
    await row(s.window, 'inner').click()
    const expanded = [root, 'alpha', 'inner', 'deep.txt', 'beta']
    await expect.poll(() => names(s.window)).toEqual(expanded)

    await s.app.close()
    s = await launchIn(dir)
    await expect.poll(() => names(s.window), { timeout: 10_000 }).toEqual(expanded)

    // Collapsing is remembered too.
    await row(s.window, 'alpha').click()
    await expect.poll(() => names(s.window)).toEqual([root, 'alpha', 'beta'])
    await s.app.close()
    s = await launchIn(dir)
    await expect.poll(() => names(s.window), { timeout: 10_000 }).toEqual([root, 'alpha', 'beta'])
  } finally {
    await s.app.close()
    removeDir(dir)
    removeDir(root)
  }
})

test('Files: hidden entries are hidden by default, ls-style columns are shown, settings toggle them', async () => {
  const root = makeTree()
  const dir = tempDir()
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
    removeDir(dir)
    removeDir(root)
  }
})

test('Files: creates a folder and an empty file in the selected folder', async () => {
  const root = makeTree()
  const dir = tempDir()
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
    removeDir(dir)
    removeDir(root)
  }
})

test('Files: plain text opens in Notes for editing; code, HTML and images are previewed', async () => {
  const root = makeTree()
  const dir = tempDir()
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
    const preview = s.window.getByLabel('プレビュー', { exact: true })
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
    removeDir(dir)
    removeDir(root)
  }
})

test('Files: on a narrow tile the settings sit behind a gear button', async () => {
  const root = makeTree()
  const dir = tempDir()
  // Four tiles → each is a quarter of the window, narrower than the wide threshold.
  const calendar = (id: string) => ({ id, kind: 'builtin', typeId: 'calendar', title: 'Calendar', icon: 'calendar' })
  const leaf = (id: string) => ({ type: 'leaf', tileId: id })
  seedWorkspace(
    dir,
    { files: filesTile(root), c1: calendar('c1'), c2: calendar('c2'), c3: calendar('c3') },
    {
      type: 'split',
      direction: 'column',
      ratio: 0.5,
      a: { type: 'split', direction: 'row', ratio: 0.5, a: leaf('files'), b: leaf('c1') },
      b: { type: 'split', direction: 'row', ratio: 0.5, a: leaf('c2'), b: leaf('c3') }
    }
  )
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
    removeDir(dir)
    removeDir(root)
  }
})

for (const count of [4, 9, 16]) {
  test(`Files: in a 1/${count} tile the preview fits inside the tile next to the tree`, async () => {
    const root = makeTree()
    const dir = tempDir()
    seedFiles(dir, root)
    const s = await launchIn(dir)
    try {
      for (let i = 1; i < count; i++) await dock(s.window, 'Calendar').click()
      await expect(s.window.locator('.bt-tile-slot')).toHaveCount(count)
      for (const name of ['main.py', 'pixel.png']) {
        await row(s.window, name).click()
        const preview = s.window.getByLabel('プレビュー', { exact: true })
        await expect(preview.locator('.bt-files__preview-name')).toHaveText(name)
        const tile = (await s.window.locator('.bt-files').boundingBox())!
        const box = (await preview.boundingBox())!
        // Inside the Files tile...
        expect(box.x).toBeGreaterThanOrEqual(tile.x - 1)
        expect(box.y).toBeGreaterThanOrEqual(tile.y - 1)
        expect(box.x + box.width).toBeLessThanOrEqual(tile.x + tile.width + 1)
        expect(box.y + box.height).toBeLessThanOrEqual(tile.y + tile.height + 1)
        // ...and the tree stays usable beside it: file names visible, not covered.
        const nameBox = (await row(s.window, 'main.py').locator('.bt-file-row__name').boundingBox())!
        expect(nameBox.width).toBeGreaterThan(30)
        expect(nameBox.x + nameBox.width <= box.x + 1 || nameBox.y + nameBox.height <= box.y + 1).toBe(true)
        // The content itself gets real space.
        const content = preview.locator(name === 'pixel.png' ? '.bt-files__image-wrap' : '.bt-files__code')
        expect(((await content.boundingBox())?.height ?? 0)).toBeGreaterThan(60)
      }
    } finally {
      await s.app.close()
      removeDir(dir)
      removeDir(root)
    }
  })
}

test('Files: PDF / audio previews follow the clicked file; the Files tile keeps its name', async () => {
  const root = makeTree()
  const dir = tempDir()
  seedFiles(dir, root)
  // Make real PDFs with Chromium first (a throwaway launch), so the tree lists them from the start.
  const gen = await launch()
  try {
    for (const name of ['report', 'second']) {
      const pdf64 = await gen.app.evaluate(async ({ BrowserWindow }, title) => {
        const w = new BrowserWindow({ show: false })
        await w.loadURL(`data:text/html,<h1>${title}</h1>`)
        const data = await w.webContents.printToPDF({})
        w.destroy()
        return data.toString('base64')
      }, name)
      writeFileSync(join(root, `${name}.pdf`), Buffer.from(pdf64, 'base64'))
    }
  } finally {
    await gen.cleanup()
  }
  writeFileSync(join(root, 'beep.wav'), wav())

  const s = await launchIn(dir)
  try {
    const preview = s.window.getByLabel('プレビュー', { exact: true })
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
    // The view is drawn over its placeholder (polled: the side panel may still be settling).
    const offset = async (): Promise<number> => {
      const pane = (await preview.locator('.bt-files__media').boundingBox())!
      const { bounds } = await previewView()
      return Math.max(Math.abs(bounds!.x - pane.x), Math.abs(bounds!.width - pane.width))
    }
    await expect.poll(offset).toBeLessThanOrEqual(2)

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
    removeDir(dir)
    removeDir(root)
  }
})

test('Files: audio/video previews do not autoplay and stop when another file is selected', async () => {
  const root = makeTree()
  writeFileSync(join(root, 'long.wav'), wav(8000 * 5))
  const dir = tempDir()
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
    await expect(s.window.getByLabel('プレビュー', { exact: true }).locator('.bt-files__code')).toBeVisible()
    await expect.poll(() => inPreview<string>('location.href')).toBe('about:blank')
  } finally {
    await s.app.close()
    removeDir(dir)
    removeDir(root)
  }
})

test('Files: after the user has clicked play in one preview, the next file still does not autoplay', async () => {
  const root = makeTree()
  writeFileSync(join(root, 'one.wav'), wav(8000 * 5))
  writeFileSync(join(root, 'two.wav'), wav(8000 * 5))
  const dir = tempDir()
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
    removeDir(dir)
    removeDir(root)
  }
})

test('Files: a .tar.xz is described by its format, not as "data"', async () => {
  const root = makeTree()
  execFileSync('tar', ['-cJf', 'bundle.tar.xz', 'memo.txt'], { cwd: root })
  execFileSync('tar', ['-cf', 'plain.tar', 'memo.txt'], { cwd: root })
  const dir = tempDir()
  seedFiles(dir, root)
  const s = await launchIn(dir)
  try {
    const preview = s.window.getByLabel('プレビュー', { exact: true })
    await row(s.window, 'bundle.tar.xz').click()
    await expect(preview.locator('.bt-files__preview-meta')).toContainText('XZ compressed data')
    await row(s.window, 'plain.tar').click()
    await expect(preview.locator('.bt-files__preview-meta')).toContainText('POSIX tar archive')
  } finally {
    await s.app.close()
    removeDir(dir)
    removeDir(root)
  }
})
