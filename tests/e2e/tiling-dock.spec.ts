import { test, expect, type Page } from '@playwright/test'
import { dock, launch, launchIn, removeDir, seedWorkspace, startSite, tempDir } from './helpers'

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

/** Left edge and width of every tile slot, left to right. */
async function slotXs(window: Page) {
  return (await slotRects(window)).sort((a, b) => a.x - b.x).map((r) => ({ x: r.x, w: r.w }))
}

test('dragging a splitter moves only a guide line; the tiles resize on release, Escape cancels', async () => {
  const dir = tempDir()
  try {
    seedWorkspace(dir, {
      sysmon: { id: 'sysmon', kind: 'builtin', typeId: 'sysmon', title: 'System Monitor', icon: 'activity', config: {} },
      calendar: { id: 'calendar', kind: 'builtin', typeId: 'calendar', title: 'Calendar', icon: 'calendar', config: {} }
    })
    const s = await launchIn(dir)
    try {
      await expect(s.window.locator('.bt-tile-slot')).toHaveCount(2)
      const before = await slotXs(s.window)

      const splitter = s.window.locator('.bt-splitter--row')
      const box = (await splitter.boundingBox())!
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2

      await s.window.mouse.move(x, y)
      await s.window.mouse.down()
      await s.window.mouse.move(x + 150, y, { steps: 10 })
      // The line follows the pointer…
      await expect(splitter).toHaveClass(/bt-splitter--dragging/)
      await expect.poll(async () => Math.round((await splitter.boundingBox())!.x - box.x)).toBe(150)
      // …while the tiles stay as they were.
      expect(await slotXs(s.window)).toEqual(before)
      await s.window.mouse.up()

      await expect(splitter).not.toHaveClass(/bt-splitter--dragging/)
      await expect.poll(async () => (await slotXs(s.window))[0].w - before[0].w).toBeGreaterThan(140)
      const resized = await slotXs(s.window)

      // Escape: the line goes back and nothing changes.
      const box2 = (await splitter.boundingBox())!
      await s.window.mouse.move(box2.x + box2.width / 2, y)
      await s.window.mouse.down()
      await s.window.mouse.move(box2.x - 200, y, { steps: 10 })
      await s.window.keyboard.press('Escape')
      await s.window.mouse.up()
      await expect(splitter).not.toHaveClass(/bt-splitter--dragging/)
      expect(await slotXs(s.window)).toEqual(resized)
      expect(Math.round((await splitter.boundingBox())!.x)).toBe(Math.round(box2.x))
      expect(s.pageErrors).toEqual([])
    } finally {
      await s.app.close()
    }
  } finally {
    removeDir(dir)
  }
})

test('splitter drag next to a web page: a snapshot stands in while dragging, the page follows on release', async () => {
  const site = await startSite()
  const dir = tempDir()
  try {
    seedWorkspace(dir, {
      browser: { id: 'browser', kind: 'builtin', typeId: 'browser', title: 'Browser', icon: 'globe', config: { url: `${site.origin}/a` } },
      calendar: { id: 'calendar', kind: 'builtin', typeId: 'calendar', title: 'Calendar', icon: 'calendar', config: {} }
    })
    const s = await launchIn(dir)
    try {
      const placeholder = s.window.locator('.bt-web-tile')
      const viewBounds = () =>
        s.app.evaluate(({ BaseWindow }) => {
          const [win] = BaseWindow.getAllWindows()
          // Not created yet right after launch: count it as not shown (expect.poll doesn't retry a throw).
          return win.contentView.children[1]?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 }
        })
      const placeholderBounds = async () => {
        const b = (await placeholder.boundingBox())!
        return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
      }
      await expect.poll(async () => (await viewBounds()).width).toBeGreaterThan(0)
      await expect.poll(viewBounds).toEqual(await placeholderBounds())

      const splitter = s.window.locator('.bt-splitter--row')
      const box = (await splitter.boundingBox())!
      const y = box.y + box.height / 2
      await s.window.mouse.move(box.x + box.width / 2, y)
      await s.window.mouse.down()
      await s.window.mouse.move(box.x + 200, y, { steps: 10 })
      // The page is swapped for its snapshot, so the guide line can be seen over it.
      await expect(s.window.locator('.bt-web-tile__snapshot')).toBeVisible()
      await expect.poll(async () => (await viewBounds()).width).toBe(0)
      await s.window.mouse.up()

      await expect(s.window.locator('.bt-web-tile__snapshot')).toHaveCount(0)
      const after = await placeholderBounds()
      expect(after.width).toBeGreaterThan(box.x)
      await expect.poll(viewBounds).toEqual(after)

      // A quick click on the splitter (released before the capture is done) leaves the page shown.
      await s.window.mouse.move(box.x + 200, y)
      await s.window.mouse.down()
      await s.window.mouse.up()
      await s.window.waitForTimeout(500)
      expect(await viewBounds()).toEqual(after)
      await expect(s.window.locator('.bt-web-tile__snapshot')).toHaveCount(0)
      expect(s.pageErrors).toEqual([])
    } finally {
      await s.app.close()
    }
  } finally {
    removeDir(dir)
    site.server.close()
  }
})
