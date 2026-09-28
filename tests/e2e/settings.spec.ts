import { test, expect } from '@playwright/test'
import { dock, launch } from './helpers'

test('Settings shortcuts use distinct icons, and mail/search preferences are there', async () => {
  const s = await launch()
  try {
    await dock(s.window, 'Settings').click()
    const shortcuts = s.window.locator('.bt-settings__shortcut')
    await expect(shortcuts.first()).toBeVisible()
    const paths = await shortcuts.evaluateAll((els) => els.map((el) => el.querySelector('path')?.getAttribute('d')))
    expect(new Set(paths).size).toBeGreaterThan(paths.length / 2)

    const mailSelect = s.window.locator('.bt-settings__field', { hasText: 'メール' }).locator('select')
    await expect(mailSelect).toHaveValue('gmail')
    await mailSelect.selectOption('outlook')
    await expect(mailSelect).toHaveValue('outlook')

    const searchSelect = s.window.locator('.bt-settings__field', { hasText: '検索エンジン' }).locator('select')
    await expect(searchSelect).toHaveValue('duckduckgo')
  } finally {
    await s.cleanup()
  }
})
