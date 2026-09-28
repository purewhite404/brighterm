import { test, expect } from '@playwright/test'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dock, launch, mockFolderPicker, removeDir, tempDir } from './helpers'

test('Notes: tokens.css loads and a picked folder lists its notes', async () => {
  const notesDir = tempDir('brighterm-notes-')
  writeFileSync(join(notesDir, 'hello.md'), '# hello')
  const s = await launch()
  try {
    await mockFolderPicker(s.app, notesDir)
    await dock(s.window, 'Notes').click()
    const notes = s.window.frameLocator('iframe.bt-plugin-frame')
    await notes.locator('#pick-folder').click()
    await expect(notes.locator('.file-row', { hasText: 'hello' })).toBeVisible({ timeout: 10_000 })
    await notes.locator('.file-row', { hasText: 'hello' }).click()
    await expect(notes.locator('#content')).toHaveValue('# hello')

    expect(s.failedResponses.filter((r) => r.includes('tokens.css'))).toEqual([])
    expect(s.pageErrors).toEqual([])
  } finally {
    await s.cleanup()
    removeDir(notesDir)
  }
})

test('Notes: an empty, freshly picked folder is immediately writable; the folder can be changed', async () => {
  const first = tempDir('brighterm-notes-a-')
  const second = tempDir('brighterm-notes-b-')
  writeFileSync(join(second, 'existing.md'), 'from folder B')
  const s = await launch()
  try {
    await mockFolderPicker(s.app, first)
    await dock(s.window, 'Notes').click()
    const notes = s.window.frameLocator('iframe.bt-plugin-frame')
    await notes.locator('#pick-folder').click()

    // The picker must actually go away and the editor be on screen (the old bug: both stayed visible).
    await expect(notes.locator('#picker-screen')).toBeHidden()
    await expect(notes.locator('#content')).toBeInViewport()

    // Typing straight away, with no note open, creates one.
    await notes.locator('#content').fill('最初のメモ')
    await expect.poll(() => readdirSync(first).filter((f) => f.endsWith('.md')).length, { timeout: 5000 }).toBe(1)
    const [created] = readdirSync(first).filter((f) => f.endsWith('.md'))
    expect(readFileSync(join(first, created), 'utf-8')).toBe('最初のメモ')
    await expect(notes.locator('.file-row')).toHaveCount(1)

    // "新規" + typing also saves.
    await notes.locator('#new-note').click()
    await notes.locator('#content').fill('二つ目')
    await expect.poll(() => readdirSync(first).filter((f) => f.endsWith('.md')).length, { timeout: 5000 }).toBe(2)

    // Switch folders.
    await mockFolderPicker(s.app, second)
    await notes.locator('#change-folder').click()
    await expect(notes.locator('.file-row')).toHaveCount(1)
    await expect(notes.locator('#content')).toHaveValue('from folder B')
  } finally {
    await s.cleanup()
    removeDir(first)
    removeDir(second)
  }
})

test('Notes: on a small tile the file list folds away and opens on demand; on a big one it can be hidden', async () => {
  const folder = tempDir('brighterm-notes-')
  writeFileSync(join(folder, 'a.md'), 'note A')
  writeFileSync(join(folder, 'b.md'), 'note B')
  const s = await launch()
  try {
    await mockFolderPicker(s.app, folder)
    await dock(s.window, 'Notes').click()
    const notes = s.window.frameLocator('iframe.bt-plugin-frame')
    await notes.locator('#pick-folder').click()
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

    // Opens over the editor; picking a note closes it again.
    await notes.locator('#toggle-sidebar').click()
    await expect(sidebar).toBeVisible()
    await expect(sidebar).toBeInViewport()
    await notes.locator('.file-row', { hasText: 'b' }).click()
    await expect(notes.locator('#content')).toHaveValue('note B')
    await expect(sidebar).toBeHidden()
  } finally {
    await s.cleanup()
    removeDir(folder)
  }
})
