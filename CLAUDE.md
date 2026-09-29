# Brighterm — notes for Claude

A personal "command HQ": one Electron window with a tiling layout of terminal,
browser, mail, calendar, files, system monitor, notes, and AI-generated plugin
tiles. User-facing docs are in `README.md` (Japanese); the original design plan is
`~/.claude/plans/terminal-browser-mail-calendar-slack-1-w-ticklish-hopcroft.md`.
Talk to the user in Japanese.

## Commands

| | |
|---|---|
| `npm run dev` | electron-vite dev (renderer hot-reloads; main/preload changes need a restart) |
| `npm run typecheck` | both TS projects (`tsconfig.node.json` = main/preload/shared/sdk, `tsconfig.web.json` = renderer) |
| `npm run test` | Vitest unit tests (pure logic, Node env) |
| `npm run test:e2e` | builds, then Playwright drives the real Electron app (`tests/e2e/`) |
| `npx electron-builder --dir --win` | quick packaging smoke test (output in `release/`, gitignored) |

Before calling a change done: typecheck + unit + e2e all green. For UI bugs, add an
e2e test that reproduces the *user's actual scenario* and look at a screenshot
(see "Verifying UI" below).

## Architecture in one screen

Code is organized **per tile/feature** in every layer (same folder names where possible):

| | renderer `src/renderer/tiles/` | main `src/main/` |
|---|---|---|
| Terminal | `terminal/` | `terminal/` (ptyManager) |
| Browser, Mail, web tiles | `browser/`, `mail/`, `web/` | `views/` (viewManager) |
| Files | `files/` (tree, settings panel, preview) | `files/` (fsService, fileSniff) |
| System Monitor | `sysmon/` | `sysmon/` (+ `views/memoryLoop.ts` for app memory) |
| Settings | `settings/` (prefs, OS shortcuts, /etc editor) | `settings/` (+ `etc/`) |
| AI Builder | `ai-builder/` (+ promptBuilder) | `builder/` |
| Calendar, HQ | `calendar/`, `hq/` | `google/` (events, HQ cards) |
| Plugins (Notes, Slack…) | `plugin/` (PluginFrame) | `plugins/` |

- Each main folder has an **`ipc.ts`** (`registerXxxIpc(deps)`) with that feature's
  handlers. `src/main/index.ts` only boots: the single-instance lock, what must run
  before `app.ready` (config — needed for the force-dark switch — and the plugin
  scheme), services, `register*Ipc`, the window (`window.ts`), loops.
  A second instance runs none of it (it used to reinstall plugins under the running one).
- The IPC contract is in `src/shared/`: **`ipc.ts`** (every channel, grouped by feature —
  no string literals in main/preload) and **`apiTypes.ts`** (what main returns, grouped
  by tile). The renderer never imports from `src/main` (`tsconfig.web.json` doesn't
  include it). `types.ts` = tiles/layout/config, `presets.ts` = mail/search presets.
- `src/preload/index.ts` — the whole `window.api`; events via its `subscribe()` helper.
- `src/main/views/viewManager.ts` — every web page (Browser/Mail/web plugins/AI Builder
  chat/Files preview) is a `WebContentsView` drawn *over* the DOM at the placeholder
  div's rect. `create` is idempotent; unmounting a tile calls `hide` (not close); only
  hidden views are suspended; sub-views are `"<tileId>::<name>"` and are closed with
  their tile (renderer side: `tiles/shared/subViews.ts`; side panes are
  `sidePaneId()` so their page title doesn't retitle the tile).
- `src/renderer/tiling/` — `layout.ts` is a pure, heavily tested binary split tree
  (`autoGrid` ≈16:9 cells, `moveTile`, `computeRects/computeSplitters`).
  `TilingView` renders tiles as a **flat absolutely-positioned list keyed by tile id**
  so layout changes never remount tiles. Don't go back to nested split divs — that
  remounts everything (lost terminal sessions, collapsed file tree, reloaded iframes).
- `src/renderer/tiles/shared/` — `EmbeddedWebView` (+ `useEmbeddedWebView`) is the only
  way tiles should show a web view; `useTileConfig` reads/writes a tile's persisted config.
- `src/renderer/tiles/catalog.ts` — built-in tiles' titles/icons and `builtinTile` /
  `webTile` / `pluginTile` (what `addTile` takes); `registry.tsx` maps them to components.
- `src/renderer/store/appStore.ts` — zustand; `updateConfig` changes memory *and* disk.
  Writing only `window.api.config.set` leaves the UI stale (that was a real bug).
- CSS: `src/renderer/styles/app.css` = shell + rules shared by several tiles
  (`bt-section-title`, `bt-message`, `bt-card`, `bt-btn-primary`, `bt-web-tile`);
  each tile imports its own `tiles/<tile>/<tile>.css`. Don't borrow another tile's classes.
- Plugins: `src/main/plugins/` (bundle parser, static analysis, `PluginHost` with
  versioned install/rollback, `plugin-app://` protocol, `hostApiBridge` permission
  checks). Spec for plugin authors/AI: `packages/sdk/AGENTS.md` **plus**
  `packages/sdk/host-api.d.ts` — both go into the AI Builder's request text and the
  agent's system prompt (`?raw` imports); without the types ChatGPT guessed signatures.
  Bundled plugins in `plugins-builtin/` are (re)installed at every startup (the list
  IPC marks them `bundled`: the UI offers disable, not delete).
- Plugin files the user picked: `fs.readFile` is text only (rejects binary with a hint);
  images/video/PDF go through `fs.fileUrl()` → `plugin-app://<id>/__brighterm_file__/
  <handle>/<path>`, served by `protocol.ts` after `hostApiBridge.resolveFile` checks
  (`pluginFileUrl.ts`). Host API / validation errors are Japanese and say how to fix
  the call — the tile shows them and the fix request passes them to the AI.
- AI Builder (web-bridge): steps 1-3, step 2 is checked automatically (debounced);
  `ValidationResult` lists the manifest's permissions as plain-words "features", not
  warnings. `PluginFrame` shows failed host calls + uncaught plugin errors (reported by
  `bridgeScript.ts`) in an error bar with a runtime fix request, and reloads when the
  plugin's `installedAt` changes (reinstall of the same id).
- Pure logic lives in small modules with `*.test.ts` next to them; Electron-dependent
  glue (pkexec, augtool, OAuth, OpenAI) is reviewed but not executable here.

### Adding a built-in tile

1. `src/renderer/tiles/<tile>/` — component, its `<tile>.css`, pure helpers + tests.
2. Its type id in `BuiltinTileType` (`shared/types.ts`), an entry in `tiles/catalog.ts`
   and in `tiles/registry.tsx`.
3. If it needs the main process: `src/main/<tile>/` with the service and `ipc.ts`,
   channels in `shared/ipc.ts`, returned types in `shared/apiTypes.ts`, calls in
   `src/preload/index.ts`, and one `register<Tile>Ipc(...)` line in `main/index.ts`.
4. `tests/e2e/<tile>.spec.ts` using `tests/e2e/helpers.ts`.

## Gotchas already paid for (don't rediscover them)

- **node-pty**: pinned `1.2.0-beta.15` because it ships N-API prebuilds for all OSes.
  Never run `electron-builder install-app-deps` / electron-rebuild; `npmRebuild: false`
  is set in `electron-builder.yml`. (This machine's Python lacks `distutils`, so any
  node-gyp build fails anyway.)
- **Module format**: root `package.json` is `"type": "module"`, so main and preload are
  emitted as **`.cjs`** (`electron.vite.config.ts`). A `.js` preload fails with
  `ERR_REQUIRE_ESM` and `window.api` is undefined.
- **Paths at runtime** resolve from `__dirname` (`out/main`), e.g.
  `../../plugins-builtin`, `../../packages/sdk` — same layout in dev and in `app.asar`.
  `app.getAppPath()` was wrong when launching `electron out/main/index.cjs`.
- **Shell CSP** (`src/renderer/index.html`) must keep `frame-src plugin-app:` or plugin
  iframes are blocked.
- **React StrictMode** mounts effects twice in dev: no "create once" ref guards;
  make main-side operations idempotent instead.
- **xterm** needs a real font stack, not `var(--bt-font-mono)` (canvas can't resolve
  CSS vars → `dimensions` errors). Only `fit()` when the container has a size.
- **Windows PowerShell 5.1** launched from a PS7 session inherits PS7's `PSModulePath`
  and can't load PSReadLine — `shellEnv()` in `ptyManager.ts` strips it.
- **PowerShell 7 from the Store/winget** is only an app execution alias
  (`%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe`); `existsSync` says false for it,
  `lstat` works, and node-pty spawns it fine — see `findPwsh7()`.
- **si.mem() on Windows spawns PowerShell** — too slow for the 0.5 s SysMon poll;
  `sysMonitor.ts` uses `os.totalmem/freemem` there. `si.processes()` is polled every 3 s only.
- **Windows file attributes** (hidden/system/readonly) come from one `cmd /u /c dir /a:X /b`
  call per folder (`fsService.ts`); `attrib` mangles non-ASCII names in its output.
- **Files → Notes**: file type is sniffed from content (`fileSniff.ts`, not the extension).
  Plain text is handed to Notes via the tile config `openRequest` → `PluginFrame` grants
  the folder and posts an `openFile` event (`brighterm.onOpenFile`).
- **xterm FitAddon** sizes rows from the *parent's* CSS height (border-box includes
  padding) — keep padding on an outer wrapper, not on the element xterm opens in.
- **Playwright screenshots show only the shell page**, not the WebContentsViews on top
  (browser, PDF preview…). To check those, `capturePage()` the view via `app.evaluate`.
- **Tile state that must survive restarts** (Browser URL, Files expanded folders) goes in
  the tile's `config` via `updateTileConfig`.
- **Plugin HTML/CSS**: an author `display:` rule overrides the `hidden` attribute; the
  Notes plugin has `[hidden]{display:none!important}` for that reason.
- **Host API** `fs.*` receives a whole handle object `{id,label}`; unwrap with
  `handleId()` (passing it through as a string produced `"[object Object]"`).
- **Dark mode**: `nativeTheme.themeSource` drives `prefers-color-scheme` for all pages.
  Forced dark uses `--blink-settings=forceDarkModeEnabled=true` (the
  `WebContentsForceDark` feature flag did nothing in this Electron).
- **This sandbox's network**: chatgpt.com is Cloudflare-blocked (403 challenge), so the
  AI Builder chat pane and some sites can't be verified here; google.com works.

## Verifying UI

- E2E specs are one per tile (`tests/e2e/<tile>.spec.ts`) over `tests/e2e/helpers.ts`
  (`launch`, `launchIn` for restart tests, `seedWorkspace`, `dock`, `mockFolderPicker`,
  `webViewUrls`, `startSite`).
- E2E launches with `--user-data-dir=<tmp>` and **`colorScheme: null`** — Playwright
  otherwise emulates `prefers-color-scheme: light` on every page.
- Replace native dialogs in tests via `app.evaluate(({dialog}) => …)`.
- Plugin iframes: `window.frameLocator('iframe.bt-plugin-frame')`.
- Assert what the user sees (`toBeHidden`, `toBeInViewport`, files on disk), not just
  that an element exists — an earlier Notes test passed while the editor was off-screen.
- For screenshots, write a throwaway `tests/e2e/zz-*.spec.ts` that saves PNGs to the
  scratchpad, `Read` the image, then delete the spec.
- For refactors, a throwaway `zz-*` spec with `toHaveScreenshot` (`maxDiffPixels: 0`,
  live numbers masked) taken before the change proves "pixel-identical" after it. The
  `style` option of `toHaveScreenshot` had no effect on the shell page; hide things via
  `element.style` in `evaluate` instead. `--update-snapshots` against the old build.
- The packaged app can be driven too: `_electron.launch({ executablePath:
  'release/win-unpacked/Brighterm.exe' })`. Playwright launches Electron through
  `cmd.exe` on Windows (`app.process().spawnfile`), so spawn a second instance with the
  path from `import electronPath from 'electron'`.

## Status (as of 2026-09-28)

Working and covered by tests: tiling (auto grid, drag & drop, splitters), Terminal,
Files, System Monitor (CPU chart, memory meter), Mail (provider choice), Browser
(DuckDuckGo default), Calendar (built-in, optional Google events), Settings (OS
shortcuts with icons, mail/search/web-theme prefs, Linux /etc editor), HQ, Notes,
Slack (web embed, disabled by default), AI Builder (web-bridge + OpenAI API agent),
plugin install/validate/rollback, web dark mode.

Added in the second hands-on round:
Terminal starts PowerShell 7; Browser starts as a bare address bar and restores its
URL; Files restores its tree, hides dot/Windows-hidden files, shows ls-style columns
(auto-dropped when narrow), has a settings panel (hidden toggle, sort, columns, new
folder/file) and a content-sniffed preview (text → Notes, code/HTML/image/PDF/media
previewed, no autoplay) that adapts to small tiles; Notes folds its list on small
tiles; empty workspaces removable; SysMon 0.5 s / 60 s axis, whole-app memory (no
"budget"); Calendar shows next month in the last week; unified 8px scrollbars.

Then (2026-09-28) a behaviour-preserving refactor into per-tile folders in renderer,
main, CSS and e2e (see "Architecture"), plus one fix: a second launch no longer runs
startup before quitting.

Then (2026-09-29) AI Builder usability, from the user's hands-on report (their
AI-made Photo Viewer failed: `readFile` couldn't read images and ChatGPT guessed the
call signature; the "folders" permission notice looked like a warning): `fs.fileUrl`,
Japanese errors, the 3-step flow, the plugin list (disable/delete), the error bar with
fix request, reload on reinstall, "AI キット" under "上級者向け" and fixed in the package
(`fs.cpSync` can't read inside `app.asar`; `*.d.ts` isn't packaged, so `host-api.d.ts`
is written from the bundle). The user's first try is `tests/e2e/fixtures/
photo-viewer-first-try.btbundle.txt`; the AI Builder now fills its tile (it used to
shrink to its content).

Known gaps / possible next steps:
- No UI for plugin rollback (the IPC exists) or for the AI Builder's provider/model.
- The AI Builder ChatGPT pane overflowing on paste is believed to be ChatGPT's own
  layout (our view bounds don't change); unverifiable here (Cloudflare).
- Terminal shells' own memory isn't in SysMon's app total.
- Scrollbars inside Chromium's PDF viewer can't be styled.
- Not verified with real credentials: Google OAuth/Calendar/Gmail, OpenAI agent mode.
- Linux-only paths (etc editor, desktop settings detection) unverified — no Linux box.
- Anthropic/Gemini agent providers are stubs (return a "not implemented" error).
- No app icons in `resources/`; macOS signing not set up.
- Background `connector.js` for plugins was deliberately descoped (sandboxing risk).
- Renderer bundle is one ~1 MB chunk (no code splitting).
