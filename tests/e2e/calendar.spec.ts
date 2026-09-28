import { test, expect } from '@playwright/test'
import { dock, launch } from './helpers'

test('Calendar shows this month with today marked', async () => {
  const s = await launch()
  try {
    await dock(s.window, 'Calendar').click()
    // This month — or the next one during this month's last week (its first row still has today).
    const now = new Date()
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const inLastWeek = now.getDate() >= last.getDate() - last.getDay()
    const shown = new Date(now.getFullYear(), now.getMonth() + (inLastWeek ? 1 : 0), 1)
    await expect(s.window.locator('.bt-calendar__title')).toHaveText(`${shown.getFullYear()}年 ${shown.getMonth() + 1}月`)
    await expect(s.window.locator('.bt-calendar__day.is-today')).toHaveCount(1)
    expect(s.pageErrors).toEqual([])
  } finally {
    await s.cleanup()
  }
})
