import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MAIN_ENTRY = resolve(__dirname, '../../out/main/index.cjs')

test.describe('Brighterm launch', () => {
  test('opens the window, shows the dock, and can add a Terminal tile', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'brighterm-e2e-'))

    const app = await electron.launch({
      args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`]
    })

    try {
      const window = await app.firstWindow()
      await expect(window).toHaveTitle('Brighterm')

      // The dock (left rail of launchable tiles/workspaces) should render once config loads.
      const dock = window.locator('.bt-dock')
      await expect(dock).toBeVisible({ timeout: 15_000 })

      // Before adding anything, the tiling area shows its empty-state hint.
      await expect(window.locator('.bt-tiling-empty')).toBeVisible()

      // Clicking the Terminal dock button should add a tile to the (until now empty) workspace.
      await window.locator('.bt-dock__button[title="Terminal"]').click()
      await expect(window.locator('.bt-tile').first()).toBeVisible({ timeout: 15_000 })
      await expect(window.locator('.bt-tiling-empty')).toHaveCount(0)

      // Notes (a bundled plugin) should also be launchable from the dock.
      await expect(window.locator('.bt-dock__button[title="Notes"]')).toBeVisible()
    } finally {
      await app.close()
      rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})
