import { test, expect } from '@playwright/test'
import { dock, launch, startSite, webViewUrls } from './helpers'

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
    const copy = s.window.getByRole('button', { name: /^コピー$/ })
    await copy.click()
    await expect(s.window.getByRole('button', { name: /コピーしました/ })).toBeVisible()
    const clipboard = await s.app.evaluate(({ clipboard }) => clipboard.readText())
    expect(clipboard).toContain('作ってほしいもの: RSS リーダー')
    // ...and goes back to normal afterwards.
    await expect(s.window.getByRole('button', { name: /^コピー$/ })).toBeVisible({ timeout: 4000 })
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
