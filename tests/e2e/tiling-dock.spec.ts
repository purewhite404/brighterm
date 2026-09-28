import { test, expect, type Page } from '@playwright/test'
import { dock, launch } from './helpers'

async function slotRects(window: Page) {
  return window.locator('.bt-tile-slot').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    })
  )
}

test('tiles flow into a grid of roughly 16:9 cells instead of halving', async () => {
  const s = await launch()
  try {
    for (const title of ['Terminal', 'Files', 'System Monitor', 'Calendar']) {
      await dock(s.window, title).click()
    }
    await expect(s.window.locator('.bt-tile-slot')).toHaveCount(4)
    const rects = await slotRects(s.window)
    expect(new Set(rects.map((r) => r.x)).size).toBe(2)
    expect(new Set(rects.map((r) => r.y)).size).toBe(2)
    const widths = rects.map((r) => r.w)
    expect(Math.min(...widths) / Math.max(...widths)).toBeGreaterThan(0.9)
    expect(s.pageErrors).toEqual([])
  } finally {
    await s.cleanup()
  }
})

test('the file tree keeps its expanded state when another tile is added', async () => {
  const s = await launch()
  try {
    await dock(s.window, 'Files').click()
    const rows = s.window.locator('.bt-file-row')
    await expect(rows.first()).toBeVisible()
    await rows.first().click() // expand the home directory
    await expect.poll(() => rows.count()).toBeGreaterThan(1)
    const expandedCount = await rows.count()

    await dock(s.window, 'System Monitor').click()
    await expect(s.window.locator('.bt-tile-slot')).toHaveCount(2)
    expect(await rows.count()).toBe(expandedCount)
  } finally {
    await s.cleanup()
  }
})

test('dragging a tile header onto another tile moves it', async () => {
  const s = await launch()
  try {
    await dock(s.window, 'Files').click()
    await dock(s.window, 'Calendar').click()
    await expect(s.window.locator('.bt-tile-slot')).toHaveCount(2)

    const filesSlot = s.window.locator('.bt-tile-slot', { has: s.window.locator('.bt-file-explorer') })
    const calendarSlot = s.window.locator('.bt-tile-slot', { has: s.window.locator('.bt-calendar') })
    const before = await filesSlot.boundingBox()
    const target = await calendarSlot.boundingBox()
    expect(before && target).toBeTruthy()

    // Drop Files in the centre of Calendar -> they swap places.
    await filesSlot.locator('.bt-tile__header').dragTo(calendarSlot, {
      targetPosition: { x: target!.width / 2, y: target!.height / 2 }
    })
    await expect.poll(async () => (await filesSlot.boundingBox())?.y).toBe(target!.y)
    expect(s.pageErrors).toEqual([])
  } finally {
    await s.cleanup()
  }
})

test('Dock: an empty workspace can be removed, one with tiles cannot', async () => {
  const s = await launch()
  try {
    const workspaces = s.window.locator('.bt-dock__workspace')
    await expect(workspaces).toHaveCount(1)
    // The only workspace can't be removed.
    await workspaces.first().hover()
    await expect(s.window.locator('.bt-dock__workspace-remove')).toHaveCount(0)

    await dock(s.window, 'Terminal').click() // first workspace now has a tile
    await dock(s.window, '新しいワークスペース').click()
    await expect(workspaces).toHaveCount(2)

    await workspaces.first().hover()
    await expect(workspaces.first().locator('.bt-dock__workspace-remove')).toHaveCount(0)
    const remove = workspaces.nth(1).locator('.bt-dock__workspace-remove')
    await expect(remove).toBeHidden() // only on hover
    await workspaces.nth(1).hover()
    await expect(remove).toBeVisible()
    await remove.click()
    await expect(workspaces).toHaveCount(1)
    // Back on the remaining workspace, its terminal still there.
    await expect(s.window.locator('.bt-terminal-tile')).toBeVisible()
  } finally {
    await s.cleanup()
  }
})
