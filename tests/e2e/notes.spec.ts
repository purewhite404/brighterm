import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { dock, launch, launchIn, mockFolderPicker, removeDir, tempDir } from './helpers'

/** The folder bar the shell draws on top of the Notes tile. */
const folderBar = (window: Page) => window.getByRole('combobox', { name: 'フォルダのパス' })

/** What the user does: type (or paste) the folder's path into the bar and press Enter. */
async function typeFolder(window: Page, dir: string): Promise<void> {
  await folderBar(window).click()
  await folderBar(window).fill(dir)
  await folderBar(window).press('Enter')
}

test('Notes: tokens.css loads and a folder typed into the bar lists its notes', async () => {
  const notesDir = tempDir('brighterm-notes-')
  writeFileSync(join(notesDir, 'hello.md'), '# hello')
  const s = await launch()
  try {
    await dock(s.window, 'Notes').click()
    const notes = s.window.frameLocator('iframe.bt-plugin-frame')
    // No folder yet: an empty bar on top, and the page points at it.
    await expect(folderBar(s.window)).toBeInViewport({ timeout: 10_000 })
    await expect(folderBar(s.window)).toHaveValue('')
    await expect(notes.locator('#picker-screen')).toContainText('上のバー')

    await typeFolder(s.window, notesDir)
    await expect(notes.locator('.file-row', { hasText: 'hello' })).toBeVisible({ timeout: 10_000 })
    await expect(notes.locator('#content')).toHaveValue('# hello')
    await expect(folderBar(s.window)).toHaveValue(notesDir)
    await expect(folderBar(s.window)).not.toBeFocused()

    expect(s.failedResponses.filter((r) => r.includes('tokens.css'))).toEqual([])
    expect(s.pageErrors).toEqual([])
    await expect(s.window.getByRole('alert', { name: 'プラグインのエラー' })).toHaveCount(0)
  } finally {
    await s.cleanup()
    removeDir(notesDir)
  }
})

test('Notes: an empty, freshly typed folder is immediately writable; the folder can be changed in the bar', async () => {
  const first = tempDir('brighterm-notes-a-')
  const second = tempDir('brighterm-notes-b-')
  writeFileSync(join(second, 'existing.md'), 'from folder B')
  const s = await launch()
  try {
    await dock(s.window, 'Notes').click()
    const notes = s.window.frameLocator('iframe.bt-plugin-frame')
    // Pasted from Explorer's "パスのコピー": with quotes and a trailing separator.
    await typeFolder(s.window, `"${first}${sep}"`)

    // The prompt must actually go away and the editor be on screen.
    await expect(notes.locator('#picker-screen')).toBeHidden()
    await expect(notes.locator('#content')).toBeInViewport()
    await expect(folderBar(s.window)).toHaveValue(first)

    // Typing straight away, with no note open, creates one.
    await notes.locator('#content').fill('最初のメモ')
    await expect.poll(() => readdirSync(first).filter((f) => f.endsWith('.md')).length, { timeout: 5000 }).toBe(1)
    const [created] = readdirSync(first).filter((f) => f.endsWith('.md'))
    expect(readFileSync(join(first, created), 'utf-8')).toBe('最初のメモ')
    await expect(notes.locator('.file-row')).toHaveCount(1)

    // "新規" + typing, then switching right away: what was typed is still saved in the first folder.
    await notes.locator('#new-note').click()
    await notes.locator('#content').fill('二つ目')
    await typeFolder(s.window, second)
    await expect(notes.locator('.file-row')).toHaveCount(1)
    await expect(notes.locator('#content')).toHaveValue('from folder B')
    await expect(folderBar(s.window)).toHaveValue(second)
    expect(readdirSync(first).filter((f) => f.endsWith('.md'))).toHaveLength(2)
    expect(readdirSync(first).map((f) => readFileSync(join(first, f), 'utf-8'))).toContain('二つ目')
  } finally {
    await s.cleanup()
    removeDir(first)
    removeDir(second)
  }
})

test('Notes: a wrong path is explained and changes nothing; Esc puts the current folder back', async () => {
  const folder = tempDir('brighterm-notes-')
  writeFileSync(join(folder, 'a.md'), 'note A')
  writeFileSync(join(folder, 'file.txt'), 'not a folder')
  const s = await launch()
  try {
    await dock(s.window, 'Notes').click()
    const notes = s.window.frameLocator('iframe.bt-plugin-frame')
    await typeFolder(s.window, folder)
    await expect(notes.locator('#content')).toHaveValue('note A')

    const bar = s.window.locator('.bt-plugin-tile__folderbar')
    await typeFolder(s.window, join(folder, 'no-such-folder'))
    await expect(bar.getByRole('alert')).toContainText('フォルダが見つかりません')
    await expect(bar.getByRole('alert')).toBeInViewport()
    await expect(folderBar(s.window)).toBeFocused()

    await folderBar(s.window).fill(join(folder, 'file.txt'))
    await folderBar(s.window).press('Enter')
    await expect(bar.getByRole('alert')).toContainText('ファイルではなくフォルダ')

    await folderBar(s.window).fill('Documents')
    await folderBar(s.window).press('Enter')
    await expect(bar.getByRole('alert')).toContainText('先頭からのパス')

    // Nothing changed underneath.
    await expect(notes.locator('#content')).toHaveValue('note A')
    await folderBar(s.window).press('Escape') // closes the completions, if any
    await folderBar(s.window).press('Escape')
    await expect(folderBar(s.window)).toHaveValue(folder)
    await expect(bar.getByRole('alert')).toHaveCount(0)
  } finally {
    await s.cleanup()
    removeDir(folder)
  }
})

test('Notes: the bar completes subfolders (Tab, arrows, click)', async () => {
  const root = tempDir('brighterm-notes-root-')
  mkdirSync(join(root, 'Notes-work'))
  mkdirSync(join(root, 'Notes-home'))
  mkdirSync(join(root, 'Photos'))
  mkdirSync(join(root, 'Notes-work', 'meetings'))
  writeFileSync(join(root, 'Notes-work', 'meetings', 'monday.md'), 'Monday')
  writeFileSync(join(root, 'Notes-home', 'shopping.md'), 'Milk')
  const s = await launch()
  try {
    await dock(s.window, 'Notes').click()
    const notes = s.window.frameLocator('iframe.bt-plugin-frame')
    const options = s.window.getByRole('listbox', { name: 'フォルダの候補' }).getByRole('option')

    await folderBar(s.window).click()
    await folderBar(s.window).fill(join(root, 'Notes-'))
    await expect(options).toHaveCount(2)
    await expect(options.first()).toBeInViewport()
    await expect(options).toContainText(['Notes-home', 'Notes-work'])

    // ↓↓ picks the second, Tab takes it and lists what's inside.
    await folderBar(s.window).press('ArrowDown')
    await folderBar(s.window).press('ArrowDown')
    await folderBar(s.window).press('Tab')
    await expect(folderBar(s.window)).toHaveValue(join(root, 'Notes-work') + sep)
    await expect(options).toHaveCount(1)
    await expect(options.first()).toContainText('meetings')
    await folderBar(s.window).press('Tab')
    await folderBar(s.window).press('Enter')
    await expect(notes.locator('#content')).toHaveValue('Monday')
    await expect(folderBar(s.window)).toHaveValue(join(root, 'Notes-work', 'meetings'))

    // A click on a completion goes straight there.
    await folderBar(s.window).click()
    await folderBar(s.window).fill(join(root, 'Notes-h'))
    await options.filter({ hasText: 'Notes-home' }).click()
    await expect(notes.locator('#content')).toHaveValue('Milk')
    await expect(folderBar(s.window)).toHaveValue(join(root, 'Notes-home'))

    // A completion highlighted, then typing on: Enter takes what's typed, not the old completion.
    await folderBar(s.window).click()
    await folderBar(s.window).fill(join(root, 'Notes-'))
    await expect(options).toHaveCount(2)
    await folderBar(s.window).press('ArrowDown')
    await expect(options.first()).toHaveAttribute('aria-selected', 'true')
    await folderBar(s.window).fill(join(root, 'Notes-work'))
    await folderBar(s.window).press('Enter')
    await expect(folderBar(s.window)).not.toBeFocused()
    await expect(folderBar(s.window)).toHaveValue(join(root, 'Notes-work'))
    await expect(notes.locator('.file-row')).toHaveCount(0)
  } finally {
    await s.cleanup()
    removeDir(root)
  }
})

test('Notes: every subfolder is offered, and Tab completes right after typing (no waiting for the list)', async () => {
  // Like the user's Documents: more folders than fit, the wanted one far down the list.
  const root = tempDir('brighterm-notes-many-')
  const names = ['Arduino', 'Blender', 'Cad', 'Data', 'Excel', 'Fusion', 'Github', 'Hobby', 'Images', 'Java', 'KiCad', 'MATLAB',
    'Photos-2023', 'Photos-2024', 'QAM', 'Zotero']
  for (const n of names) mkdirSync(join(root, n))
  mkdirSync(join(root, 'QAM', 'sim'))
  writeFileSync(join(root, 'QAM', 'sim', 'result.md'), 'BER')
  const s = await launch()
  try {
    await dock(s.window, 'Notes').click()
    const notes = s.window.frameLocator('iframe.bt-plugin-frame')
    const bar = folderBar(s.window)
    const options = s.window.getByRole('listbox', { name: 'フォルダの候補' }).getByRole('option')

    await bar.click()
    await bar.fill(root + sep)
    await expect(options).toHaveCount(names.length)
    const last = options.filter({ hasText: 'Zotero' })
    await last.scrollIntoViewIfNeeded()
    await expect(last).toBeInViewport()

    // Type "Q" and Tab at once: QAM, not a completion of what was there before.
    await bar.press('End')
    await bar.pressSequentially('Q')
    await bar.press('Tab')
    await expect(bar).toHaveValue(join(root, 'QAM') + sep)
    await expect(bar).toBeFocused()
    // Its only subfolder, then open it.
    await bar.press('Tab')
    await expect(bar).toHaveValue(join(root, 'QAM', 'sim') + sep)
    await bar.press('Enter')
    await expect(notes.locator('#content')).toHaveValue('BER')

    // A path typed by hand and Tab straight away: completed, and the typing isn't lost.
    await bar.click()
    await bar.pressSequentially(join(root, 'zot'))
    await bar.press('Tab')
    await expect(bar).toHaveValue(join(root, 'Zotero') + sep)
    await expect(bar).toBeFocused()

    // Several matches: Tab fills what they have in common, like a shell.
    await bar.fill('')
    await bar.pressSequentially(join(root, 'Ph'))
    await bar.press('Tab')
    await expect(bar).toHaveValue(join(root, 'Photos-202'))
    await expect(options).toHaveCount(2)
  } finally {
    await s.cleanup()
    removeDir(root)
  }
})

test('Notes: the list sorts by name or by date, either way round; the choice survives a restart', async () => {
  const userDataDir = tempDir()
  const folder = tempDir('brighterm-notes-sort-')
  // Name order and date order differ on purpose; "メモ 2" must come before "メモ 10".
  const notes = [
    { name: 'メモ 10.md', daysAgo: 3 },
    { name: 'メモ 2.md', daysAgo: 1 },
    { name: 'apple.md', daysAgo: 2 },
    { name: 'Banana.md', daysAgo: 4 }
  ]
  for (const n of notes) {
    const file = join(folder, n.name)
    writeFileSync(file, n.name)
    const when = new Date(Date.now() - n.daysAgo * 86_400_000)
    utimesSync(file, when, when)
  }
  const rows = (window: Page) => window.frameLocator('iframe.bt-plugin-frame').locator('.file-row')
  let s = await launchIn(userDataDir)
  try {
    await dock(s.window, 'Notes').click()
    const frame = s.window.frameLocator('iframe.bt-plugin-frame')
    await typeFolder(s.window, folder)
    const sort = frame.getByRole('combobox', { name: '並べ替え' })

    // Default: by name, A→Z (numbers in names compare as numbers).
    await expect(rows(s.window)).toHaveText(['apple', 'Banana', 'メモ 2', 'メモ 10'])
    await sort.selectOption({ label: '名前 Z→A' })
    await expect(rows(s.window)).toHaveText(['メモ 10', 'メモ 2', 'Banana', 'apple'])
    await sort.selectOption({ label: '古い順' })
    await expect(rows(s.window)).toHaveText(['Banana', 'メモ 10', 'apple', 'メモ 2'])
    await sort.selectOption({ label: '新しい順' })
    await expect(rows(s.window)).toHaveText(['メモ 2', 'apple', 'メモ 10', 'Banana'])

    // Editing a note makes it the newest: it moves to the top.
    await rows(s.window).filter({ hasText: 'Banana' }).click()
    await frame.locator('#content').fill('更新した')
    await expect(rows(s.window)).toHaveText(['Banana', 'メモ 2', 'apple', 'メモ 10'], { timeout: 5000 })
    await expect.poll(() => readFileSync(join(folder, 'Banana.md'), 'utf-8')).toBe('更新した')

    // Search keeps the order.
    await frame.locator('#search').fill('メモ')
    await expect(rows(s.window)).toHaveText(['メモ 2', 'メモ 10'])
    await s.app.close()

    s = await launchIn(userDataDir)
    await expect(rows(s.window)).toHaveText(['Banana', 'メモ 2', 'apple', 'メモ 10'], { timeout: 10_000 })
    await expect(s.window.frameLocator('iframe.bt-plugin-frame').getByRole('combobox', { name: '並べ替え' })).toHaveValue(
      'date-desc'
    )
  } finally {
    await s.app.close()
    removeDir(userDataDir)
    removeDir(folder)
  }
})

test('Notes: the folder bar shows the saved folder again after a restart; the picker button still works', async () => {
  const userDataDir = tempDir()
  const first = tempDir('brighterm-notes-a-')
  const second = tempDir('brighterm-notes-b-')
  writeFileSync(join(first, 'a.md'), 'note A')
  writeFileSync(join(second, 'b.md'), 'note B')
  let s = await launchIn(userDataDir)
  try {
    await dock(s.window, 'Notes').click()
    await typeFolder(s.window, first)
    await expect(s.window.frameLocator('iframe.bt-plugin-frame').locator('#content')).toHaveValue('note A')
    await s.app.close()

    s = await launchIn(userDataDir)
    const notes = s.window.frameLocator('iframe.bt-plugin-frame')
    await expect(folderBar(s.window)).toHaveValue(first, { timeout: 10_000 })
    await expect(notes.locator('.file-row', { hasText: 'a' })).toBeVisible()

    // For those who'd rather click: the button next to the bar opens the native picker.
    await mockFolderPicker(s.app, second)
    await s.window.getByRole('button', { name: 'フォルダを選ぶウィンドウを開く' }).click()
    await expect(notes.locator('#content')).toHaveValue('note B')
    await expect(folderBar(s.window)).toHaveValue(second)
  } finally {
    await s.app.close()
    removeDir(userDataDir)
    removeDir(first)
    removeDir(second)
  }
})

test('Notes: on a small tile the file list folds away and opens on demand; on a big one it can be hidden', async () => {
  const base = tempDir('brighterm-notes-')
  // Long enough not to fit in the bar of a 1/9 tile.
  const folder = join(base, 'ずいぶん長い名前のメモ用フォルダ-a-rather-long-folder-name')
  mkdirSync(folder)
  writeFileSync(join(folder, 'a.md'), 'note A')
  writeFileSync(join(folder, 'b.md'), 'note B')
  const s = await launch()
  try {
    await dock(s.window, 'Notes').click()
    const notes = s.window.frameLocator('iframe.bt-plugin-frame')
    await typeFolder(s.window, folder)
    await expect(notes.locator('#content')).toHaveValue('note A')

    // Big tile: the list is a column; the button hides and shows it.
    const sidebar = notes.locator('#sidebar')
    await expect(sidebar).toBeVisible()
    await notes.locator('#toggle-sidebar').click()
    await expect(sidebar).toBeHidden()
    await notes.locator('#toggle-sidebar').click()
    await expect(sidebar).toBeVisible()

    // Small tile (1/9): folded away, the editor gets the width.
    for (let i = 1; i < 9; i++) await dock(s.window, 'Calendar').click()
    await expect(sidebar).toBeHidden()
    const frame = (await s.window.locator('iframe.bt-plugin-frame').boundingBox())!
    expect(frame.width).toBeLessThan(560)
    const editor = (await notes.locator('#content').boundingBox())!
    expect(editor.width).toBeGreaterThan(frame.width * 0.8)
    // The folder bar still fits, above the plugin.
    await expect(folderBar(s.window)).toBeInViewport()
    const bar = (await folderBar(s.window).boundingBox())!
    expect(bar.y + bar.height).toBeLessThanOrEqual(frame.y + 1)
    expect(bar.width).toBeGreaterThan(frame.width * 0.6)
    // A path longer than the bar shows its end — the folder's own name — even after the tile shrank.
    const scroll = () =>
      folderBar(s.window).evaluate((el: HTMLInputElement) => ({
        overflows: el.scrollWidth > el.clientWidth,
        atEnd: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
      }))
    expect((await scroll()).overflows).toBe(true)
    await expect.poll(async () => (await scroll()).atEnd).toBe(true)

    // Opens over the editor; picking a note closes it again.
    await notes.locator('#toggle-sidebar').click()
    await expect(sidebar).toBeVisible()
    await expect(sidebar).toBeInViewport()
    await notes.locator('.file-row', { hasText: 'b' }).click()
    await expect(notes.locator('#content')).toHaveValue('note B')
    await expect(sidebar).toBeHidden()
  } finally {
    await s.cleanup()
    removeDir(base)
  }
})
