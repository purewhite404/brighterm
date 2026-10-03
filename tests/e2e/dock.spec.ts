import { test, expect, type Page } from '@playwright/test'
import { dock, launch, launchIn, removeDir, seedWorkspace, settledPreview, startSite, tempDir } from './helpers'

const calendar = (id: string, title: string) => ({ id, kind: 'builtin', typeId: 'calendar', title, icon: 'calendar', config: {} })

const slot = (window: Page, title: string) =>
  window.locator('.bt-tile-slot', { has: window.locator('.bt-tile__title', { hasText: title }) })

type Box = { x: number; y: number; w: number; h: number }

async function box(locator: ReturnType<Page['locator']>): Promise<Box> {
  const b = (await locator.boundingBox())!
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
}

/**
 * Drags the Dock icon `title` to (x, y) and releases it there; returns the drop
 * preview shown just before the release. (Playwright's emulated drag sends dragover
 * only on the second move inside an element, hence the last small move.)
 */
async function dragIcon(window: Page, title: string, x: number, y: number): Promise<Box[]> {
  const icon = (await dock(window, title).boundingBox())!
  await window.mouse.move(icon.x + icon.width / 2, icon.y + icon.height / 2)
  await window.mouse.down()
  await window.mouse.move(icon.x + icon.width / 2 + 30, icon.y + icon.height / 2, { steps: 5 })
  await window.mouse.move(x - 4, y, { steps: 10 })
  await window.mouse.move(x, y, { steps: 2 })
  await settledPreview(window)
  const preview = await Promise.all((await window.locator('.bt-drop-preview').all()).map(box))
  await window.mouse.up()
  return preview
}

const newTiles = (window: Page) =>
  window.locator('.bt-tile-slot').filter({ hasNot: window.locator('.bt-tile__title', { hasText: 'Alpha' }) })

test('a Dock icon dragged onto a tile is added where the preview showed', async () => {
  const dir = tempDir()
  try {
    seedWorkspace(dir, { alpha: calendar('alpha', 'Alpha') })
    const s = await launchIn(dir)
    try {
      await expect(s.window.locator('.bt-tile-slot')).toHaveCount(1)
      const alpha = await box(slot(s.window, 'Alpha'))

      // Right part of Alpha: Alpha is halved, the new tile on the right.
      let preview = await dragIcon(s.window, 'Calendar', alpha.x + alpha.w - 20, alpha.y + alpha.h / 2)
      await expect(s.window.locator('.bt-tile-slot')).toHaveCount(2)
      await expect(s.window.locator('.bt-drop-preview')).toHaveCount(0)
      const first = await box(newTiles(s.window))
      expect(preview).toEqual([first])
      expect(first.x).toBeGreaterThan(alpha.x + alpha.w / 2 - 10)
      expect(Math.abs(first.h - alpha.h)).toBeLessThan(2)

      // Centre of Alpha (now a tall half): it is halved along its longer side, no swap.
      const halved = await box(slot(s.window, 'Alpha'))
      preview = await dragIcon(s.window, 'Calendar', halved.x + halved.w / 2, halved.y + halved.h / 2)
      await expect(s.window.locator('.bt-tile-slot')).toHaveCount(3)
      const second = (await Promise.all((await newTiles(s.window).all()).map(box))).find((b) => b.x < first.x)!
      expect(preview).toEqual([second])
      expect(second.x).toBe(halved.x)
      expect(second.y).toBeGreaterThan(halved.y + halved.h / 2 - 10)
      const top = await box(slot(s.window, 'Alpha'))
      expect([top.x, top.y, top.w]).toEqual([halved.x, halved.y, halved.w])
      expect(top.h).toBeLessThan(halved.h * 0.6)
      expect(second.y).toBeGreaterThan(top.y + top.h)
      // The first new tile didn't move.
      expect(await Promise.all((await newTiles(s.window).all()).map(box))).toContainEqual(first)
      expect(s.pageErrors).toEqual([])
    } finally {
      await s.app.close()
    }
  } finally {
    removeDir(dir)
  }
})

test('a Dock icon dropped on the bottom edge spans the whole width; into an empty workspace it fills it', async () => {
  const s = await launch()
  try {
    const root = await box(s.window.locator('.bt-tiling-root'))
    // Empty workspace: anywhere in the area.
    let preview = await dragIcon(s.window, 'Calendar', root.x + root.w / 2, root.y + root.h / 2)
    await expect(s.window.locator('.bt-tile-slot')).toHaveCount(1)
    const only = await box(s.window.locator('.bt-tile-slot'))
    expect(preview).toEqual([only])
    expect(only.w).toBeGreaterThan(root.w - 10)
    expect(only.h).toBeGreaterThan(root.h - 10)

    // Bottom edge of the whole area: full width, half the height (one more band than one row).
    preview = await dragIcon(s.window, 'System Monitor', root.x + root.w / 2, root.y + root.h - 6)
    await expect(s.window.locator('.bt-tile-slot')).toHaveCount(2)
    const sysmon = await box(s.window.locator('.bt-tile-slot', { has: s.window.locator('.bt-sysmon') }))
    expect(preview).toEqual([sysmon])
    expect(sysmon.w).toBeGreaterThan(root.w - 10)
    expect(sysmon.y + sysmon.h).toBeGreaterThan(root.y + root.h - 10)
    expect(Math.abs(sysmon.h - root.h / 2)).toBeLessThan(10)
    expect(s.pageErrors).toEqual([])
  } finally {
    await s.cleanup()
  }
})

test('a Dock icon released outside the tiles adds nothing', async () => {
  const dir = tempDir()
  try {
    seedWorkspace(dir, { alpha: calendar('alpha', 'Alpha') })
    const s = await launchIn(dir)
    try {
      const alpha = await box(slot(s.window, 'Alpha'))
      const statusBar = (await s.window.locator('.bt-statusbar').boundingBox())!
      const preview = await dragIcon(s.window, 'Calendar', statusBar.x + statusBar.width / 2, statusBar.y + statusBar.height / 2)
      expect(preview).toEqual([])
      await expect(s.window.locator('.bt-drop-target')).toHaveCount(0) // the drag is over
      await expect(s.window.locator('.bt-splitter, .bt-edge-drop')).toHaveCount(0)
      await expect(s.window.locator('.bt-tile-slot')).toHaveCount(1)
      expect(await box(slot(s.window, 'Alpha'))).toEqual(alpha)
      expect(s.pageErrors).toEqual([])
    } finally {
      await s.app.close()
    }
  } finally {
    removeDir(dir)
  }
})

test('the menu button opens the Dock over the tiles with names; Escape, a click outside and Ctrl+K close it', async () => {
  const site = await startSite()
  const dir = tempDir()
  try {
    seedWorkspace(dir, {
      browser: { id: 'browser', kind: 'builtin', typeId: 'browser', title: 'Browser', icon: 'globe', config: { url: `${site.origin}/a` } },
      alpha: calendar('alpha', 'Alpha')
    })
    const s = await launchIn(dir)
    try {
      const viewWidth = () =>
        s.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].contentView.children[1]?.getBounds().width ?? 0)
      await expect.poll(viewWidth).toBeGreaterThan(0)
      const root = await box(s.window.locator('.bt-tiling-root'))
      const label = s.window.locator('.bt-dock__label', { hasText: 'System Monitor' })
      const toggle = s.window.locator('.bt-dock__toggle')
      await expect(label).toBeHidden()

      await toggle.click()
      await expect(label).toBeVisible()
      await expect(s.window.locator('.bt-dock__heading', { hasText: 'ワークスペース' })).toBeVisible()
      expect((await box(s.window.locator('.bt-dock__panel'))).w).toBeGreaterThan(200)
      // Over the tiles: the tiling area keeps its size, and the page is a snapshot under the Dock.
      expect(await box(s.window.locator('.bt-tiling-root'))).toEqual(root)
      await expect(s.window.locator('.bt-web-tile__snapshot')).toBeVisible()
      await expect.poll(viewWidth).toBe(0)

      await s.window.keyboard.press('Escape')
      await expect(label).toBeHidden()
      await expect(s.window.locator('.bt-web-tile__snapshot')).toHaveCount(0)
      await expect.poll(viewWidth).toBeGreaterThan(0)

      await toggle.click()
      await expect(label).toBeVisible()
      await slot(s.window, 'Alpha').locator('.bt-calendar').click({ position: { x: 300, y: 300 } })
      await expect(label).toBeHidden()

      await s.window.keyboard.press('Control+k')
      await expect(label).toBeVisible()
      await s.window.keyboard.press('Control+k')
      await expect(label).toBeHidden()

      // A click on an icon in the open Dock adds the tile (the usual way) and closes the Dock.
      await toggle.click()
      await label.click()
      await expect(label).toBeHidden()
      await expect(s.window.locator('.bt-tile-slot')).toHaveCount(3)
      await expect.poll(viewWidth).toBeGreaterThan(0)
      expect(s.pageErrors).toEqual([])
    } finally {
      await s.app.close()
    }
  } finally {
    removeDir(dir)
    site.server.close()
  }
})

test('a drag from the open Dock closes it and drops on the tile that was under it', async () => {
  const dir = tempDir()
  try {
    seedWorkspace(dir, { alpha: calendar('alpha', 'Alpha') })
    const s = await launchIn(dir)
    try {
      const alpha = await box(slot(s.window, 'Alpha'))
      await s.window.locator('.bt-dock__toggle').click()
      const panel = await box(s.window.locator('.bt-dock__panel'))
      expect(panel.x + panel.w).toBeGreaterThan(alpha.x + 100) // the open Dock covers Alpha's left side

      // Drop on Alpha's left part, where the open Dock was.
      const preview = await dragIcon(s.window, 'Calendar', alpha.x + 20, alpha.y + alpha.h / 2)
      await expect(s.window.locator('.bt-dock--open')).toHaveCount(0)
      await expect(s.window.locator('.bt-tile-slot')).toHaveCount(2)
      const added = await box(newTiles(s.window))
      expect(preview).toEqual([added])
      expect(added.x).toBe(alpha.x)
      expect((await box(slot(s.window, 'Alpha'))).x).toBeGreaterThan(added.x + added.w)
      expect(s.pageErrors).toEqual([])
    } finally {
      await s.app.close()
    }
  } finally {
    removeDir(dir)
  }
})
