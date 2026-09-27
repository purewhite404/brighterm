import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  workers: 1, // Electron _electron tests each launch a whole app instance — keep them serial.
  reporter: 'list'
})
