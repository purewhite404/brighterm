import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dock, launch, mockFolderPicker, removeDir, startSite, tempDir, webViewUrls } from './helpers'

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')
/** What the user's first try produced: readFile(photo.path) — no folder handle, and readFile can't read images anyway. */
const FIRST_TRY = readFileSync(join(FIXTURES, 'photo-viewer-first-try.btbundle.txt'), 'utf-8')
/** The same viewer written against the spec as it is now (fs.fileUrl). */
const FIXED = readFileSync(join(FIXTURES, 'photo-viewer-fixed.btbundle.txt'), 'utf-8')

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

function photoFolder(): string {
  const dir = tempDir('brighterm-photos-')
  writeFileSync(join(dir, 'a.png'), TINY_PNG)
  writeFileSync(join(dir, '富士山.png'), TINY_PNG)
  writeFileSync(join(dir, 'memo.txt'), 'not a photo')
  return dir
}

const step3 = (w: Page) => w.getByRole('region', { name: '3. 確認してインストール' })
const paste = (w: Page, bundle: string) => w.getByLabel('AI の返信', { exact: true }).fill(bundle)
const clipboard = (app: ElectronApplication) => app.evaluate(({ clipboard }) => clipboard.readText())

test('AI Builder switches back from API mode to the default mode', async () => {
  const s = await launch()
  try {
    await dock(s.window, 'AI Builder').click()
    await expect(s.window.locator('.bt-ai-builder__chat')).toBeVisible()
    await s.window.getByRole('button', { name: /API モード/ }).click()
    await expect(s.window.locator('.bt-ai-builder__chat')).toHaveCount(0)
    await s.window.getByRole('button', { name: /既定/ }).click()
    await expect(s.window.locator('.bt-ai-builder__chat')).toBeVisible()
  } finally {
    await s.cleanup()
  }
})

test('AI Builder: copying the prompt says "コピーしました" and puts the prompt on the clipboard', async () => {
  const s = await launch()
  try {
    await dock(s.window, 'AI Builder').click()
    await s.window.getByPlaceholder('例: 写真フォルダを見るビューアを追加して').fill('RSS リーダー')
    await s.window.getByRole('button', { name: '依頼文をコピー' }).click()
    await expect(s.window.getByRole('button', { name: /コピーしました/ })).toBeVisible()
    const copied = await clipboard(s.app)
    expect(copied).toContain('作ってほしいもの: RSS リーダー')
    // The exact Host API goes along, so the AI doesn't guess how to call it.
    expect(copied).toContain('fileUrl(handle: BrightermFolderHandle, relativePath: string): Promise<string>')
    // ...and goes back to normal afterwards.
    await expect(s.window.getByRole('button', { name: '依頼文をコピー' })).toBeVisible({ timeout: 4000 })
  } finally {
    await s.cleanup()
  }
})

test('AI Builder: pasting the prompt into the chat does not change the chat pane size', async () => {
  const site = await startSite()
  const s = await launch({
    aiBuilder: { mode: 'web-bridge', webBridgeUrl: `${site.origin}/chat`, apiProvider: 'openai', apiModel: 'gpt-4.1' }
  })
  try {
    await dock(s.window, 'AI Builder').click()
    await expect.poll(() => webViewUrls(s.app), { timeout: 10_000 }).toEqual([`${site.origin}/chat`])
    const bounds = () =>
      s.app.evaluate(({ BaseWindow }) => {
        const view = BaseWindow.getAllWindows()[0].contentView.children[1] as Electron.WebContentsView
        return view.getBounds()
      })
    const pane = await s.window.locator('.bt-ai-builder__chat').boundingBox()
    const before = await bounds()
    expect(before.width).toBeGreaterThan(0)
    expect(Math.abs(before.x + before.width - (pane!.x + pane!.width))).toBeLessThanOrEqual(2)

    await s.window.locator('.bt-ai-builder__row input').first().fill('写真ビューア')
    await s.window.getByRole('button', { name: /コピー/ }).first().click()
    await s.app.evaluate(async ({ BaseWindow }) => {
      const view = BaseWindow.getAllWindows()[0].contentView.children[1] as Electron.WebContentsView
      await view.webContents.executeJavaScript('document.getElementById("box").focus()')
      view.webContents.paste()
    })
    await s.window.waitForTimeout(500)
    const pasted = await s.app.evaluate(({ BaseWindow }) => {
      const view = BaseWindow.getAllWindows()[0].contentView.children[1] as Electron.WebContentsView
      return view.webContents.executeJavaScript(
        '({ len: document.getElementById("box").value.length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })'
      )
    })
    expect(pasted.len).toBeGreaterThan(1000)
    expect(pasted.overflow).toBe(0)
    expect(await bounds()).toEqual(before)
  } finally {
    await s.cleanup()
    site.server.close()
  }
})

test('AI Builder: the check explains what is wrong in Japanese and offers a fix request instead of an install button', async () => {
  const s = await launch()
  try {
    await dock(s.window, 'AI Builder').click()
    await expect(step3(s.window)).toContainText('2 に貼り付けると、ここで自動的にチェックします')
    await paste(s.window, '=== file: manifest.json ===\n{ "id": "Photo Viewer", "kind": "app" }')
    const result = step3(s.window).getByLabel('チェック結果')
    await expect(result).toContainText('このままではインストールできません')
    await expect(result).toContainText('「name」がありません')
    await expect(result).toContainText('「id」: 英小文字・数字・ハイフンだけにしてください')
    await expect(step3(s.window).getByRole('button', { name: /インストール/ })).toHaveCount(0)
    await result.getByRole('button', { name: '修正依頼をコピー' }).click()
    expect(await clipboard(s.app)).toContain('- manifest.json: 「name」がありません')
  } finally {
    await s.cleanup()
  }
})

test('AI Builder: the user’s first Photo Viewer says in its tile why photos fail; the fixed one replaces it and shows them', async () => {
  const photos = photoFolder()
  const s = await launch()
  try {
    await mockFolderPicker(s.app, photos)
    await dock(s.window, 'AI Builder').click()

    // The "folders" permission is explained, not shown as a warning.
    await paste(s.window, FIRST_TRY)
    const result = step3(s.window).getByLabel('チェック結果')
    await expect(result).toContainText('問題は見つかりませんでした。インストールできます。')
    await expect(result).toContainText('あなたが選んだフォルダの中のファイルを読み書きします')
    await expect(result).not.toContainText('権限を要求')
    await step3(s.window).getByRole('button', { name: 'インストール' }).click()
    await expect(step3(s.window)).toContainText('「Photo Viewer」をインストールしました')
    await step3(s.window).getByRole('button', { name: '今すぐ開く' }).click()

    // The user's report: "写真の読み込みに失敗しました" — now the tile also says why.
    const viewer = s.window.frameLocator('iframe.bt-plugin-frame')
    await viewer.getByRole('button', { name: '写真フォルダを選択' }).click()
    await expect(viewer.locator('#status')).toHaveText('写真の読み込みに失敗しました。')
    const errors = s.window.getByRole('alert', { name: 'プラグインのエラー' })
    await expect(errors).toContainText('window.brighterm.fs.readFile')
    await expect(errors).toContainText('フォルダの指定が正しくありません')
    await errors.getByRole('button', { name: '修正依頼をコピー' }).click()
    const request = await clipboard(s.app)
    expect(request).toContain('「Photo Viewer」（id: photo-viewer）')
    expect(request).toContain('fileUrl(handle: BrightermFolderHandle, relativePath: string)')

    // The AI's fixed version replaces it; the open tile reloads with the new code.
    await paste(s.window, FIXED)
    await expect(result).toContainText('インストール済みの「Photo Viewer」（v1.0.0）を、このコードで置き換えます')
    await step3(s.window).getByRole('button', { name: '置き換えてインストール' }).click()
    await expect(errors).toBeHidden()
    await viewer.getByRole('button', { name: '写真フォルダを選択' }).click()
    await expect(viewer.locator('#status')).toContainText('2 枚')
    await expect
      .poll(() => viewer.locator('.gallery img').evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).naturalWidth)))
      .toEqual([1, 1])
    await expect(errors).toBeHidden()
  } finally {
    await s.cleanup()
    removeDir(photos)
  }
})

test('AI Builder: installed plugins can be disabled, enabled again and deleted; bundled ones only disabled', async () => {
  const s = await launch()
  try {
    await dock(s.window, 'AI Builder').click()
    await paste(s.window, FIXED)
    await step3(s.window).getByRole('button', { name: 'インストール' }).click()
    await step3(s.window).getByRole('button', { name: '今すぐ開く' }).click()
    await expect(s.window.locator('iframe.bt-plugin-frame')).toHaveCount(1)

    const list = s.window.getByRole('region', { name: 'インストール済みのプラグイン' })
    const row = list.locator('.bt-ai-builder__plugin-row', { hasText: 'Photo Viewer' })
    await row.getByRole('button', { name: '無効にする' }).click()
    await expect(dock(s.window, 'Photo Viewer')).toHaveCount(0)
    await expect(s.window.locator('iframe.bt-plugin-frame')).toHaveCount(0) // its open tile closed
    await expect(row).toContainText('・無効')
    await row.getByRole('button', { name: '有効にする' }).click()
    await expect(dock(s.window, 'Photo Viewer')).toBeVisible()

    await row.getByRole('button', { name: '「Photo Viewer」を削除' }).click()
    await expect(row).toContainText('削除しますか？')
    await row.getByRole('button', { name: '削除する' }).click()
    await expect(row).toHaveCount(0)
    await expect(dock(s.window, 'Photo Viewer')).toHaveCount(0)

    // Notes ships with the app (it comes back at every start): disable only.
    const notes = list.locator('.bt-ai-builder__plugin-row', { hasText: 'Notes' })
    await expect(notes).toContainText('同梱')
    await expect(notes.getByRole('button', { name: /削除/ })).toHaveCount(0)
    await notes.getByRole('button', { name: '無効にする' }).click()
    await expect(dock(s.window, 'Notes')).toHaveCount(0)
    await notes.getByRole('button', { name: '有効にする' }).click()
    await expect(dock(s.window, 'Notes')).toBeVisible()
  } finally {
    await s.cleanup()
  }
})

test('AI Builder: "AI キットを書き出す" (上級者向け) saves the spec, the Host API types and the templates', async () => {
  const target = tempDir('brighterm-kit-')
  const s = await launch()
  try {
    await mockFolderPicker(s.app, target)
    await dock(s.window, 'AI Builder').click()
    await s.window.getByText('上級者向け: 別の AI ツールでプラグインを作る').click()
    await s.window.getByRole('button', { name: 'AI キットを書き出す' }).click()
    const kit = join(target, 'brighterm-plugin-kit')
    await expect(s.window.getByText(`保存しました: ${kit}`)).toBeVisible()
    expect(readFileSync(join(kit, 'host-api.d.ts'), 'utf-8')).toContain('fileUrl(')
    for (const file of ['AGENTS.md', 'manifest.schema.ts', 'ui/tokens.css', 'templates/app-plugin/manifest.json']) {
      expect(existsSync(join(kit, file))).toBe(true)
    }
  } finally {
    await s.cleanup()
    removeDir(target)
  }
})
