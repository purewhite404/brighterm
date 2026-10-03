import { defineConfig } from '@playwright/test'

/**
 * Every test launches its own Electron app with its own --user-data-dir (and its window off screen,
 * see helpers.ts), so tests run side by side — also tests of the same file. The exception is the
 * OS clipboard, which all apps share: tests tagged @clipboard run one at a time (still alongside
 * the others). perf.spec.ts keeps its own tests in order (describe.configure) and is run alone.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  workers: 4,
  fullyParallel: true,
  reporter: 'list',
  projects: [
    { name: 'parallel', grepInvert: /@clipboard/ },
    { name: 'clipboard', grep: /@clipboard/, workers: 1 }
  ]
})
