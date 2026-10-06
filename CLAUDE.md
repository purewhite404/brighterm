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

What to run depends on the change (the user's choice, 2026-10-03 — the whole e2e suite
launches Electron ~70 times: 64 tests in ~55 s with 4 workers, ~2.3 min one at a time; a launch +
quit is ≤0.8 s per test, so keeping one app running wouldn't buy much):

| change | run |
|---|---|
| comments / docs only | nothing |
| logic (main, shared, pure helpers) | typecheck + unit |
| UI / a tile | typecheck + unit + **that tile's** e2e spec(s) |
| before a commit, at the end of a batch of work, or when asked | typecheck + unit + **whole** e2e |

For UI bugs, add an e2e test that reproduces the *user's actual scenario* and look at a
screenshot (see "Verifying UI" below).

### Working from WSL (e.g. Pi Coding Agent) instead of PowerShell

The project was built from PowerShell (Claude Code); `node_modules` holds **Windows**
binaries. From a WSL shell:

- Run npm / npx / Playwright through Windows: `cmd.exe /c "npm run typecheck"`,
  `cmd.exe /c "npx playwright test tests/e2e/notes.spec.ts --reporter=line"`. WSL's own
  Node fails (`Cannot find module @rollup/rollup-linux-x64-gnu`). **Never `npm i` from
  WSL** — it would replace the Windows binaries (node-pty, electron, rollup).
  In `cmd.exe /c "…"`, `-g` patterns with spaces don't survive the quoting — use `.`
  for spaces (`-g subfolder.is.offered`).
- Use **Windows git** (`cmd.exe /c "git status --short"`, same for add/commit). WSL's
  git reports files as modified that aren't (line endings / file mode). For
  `git commit -F`, write the message under `/mnt/c/Users/satoshi/AppData/Local/Temp/`
  and pass `%TEMP%\msg.txt`.
- Windows paths for tests: temp dirs are `C:\Users\satoshi\AppData\Local\Temp\…`
  (`/mnt/c/Users/satoshi/AppData/Local/Temp/` from WSL) — screenshots go there too.
- The user runs `npm run dev` themselves, from PowerShell.

### Working on the Mac (arm64)

The user also has a Mac (`/Users/sat/brighterm`, 2026-10-06). Its `node_modules` is the
macOS one (Electron.app, `@rollup/rollup-darwin-arm64`, node-pty's darwin prebuild): run
`npm run typecheck` / `npm run test` / `npm run test:e2e` / `npx playwright test …` and git
directly from zsh — no `cmd.exe`. Temp dirs are `$TMPDIR` (`/var/folders/…/T/`). The whole
e2e suite: 69 passed, 3 skipped (PowerShell, perf ×2) in ~40 s with 4 workers. The Terminal
runs `$SHELL` / zsh (`ptyManager.ts`).

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
  (`computeRects/computeSplitters`), edited **bspwm-style** so a user's layout is never
  rebuilt behind their back: `insertTile` splits the largest tile along its longer side
  (first in reading order on a tie), closing = `removeTile` (the sibling takes the space),
  drops = `applyDrop` (`moveTile` on a tile, `moveTileToEdge` on a strip along the whole
  area's edge, one band thick). `autoGrid` (≈16:9 cells, in `visualOrder`) runs **only**
  for "タイルを整列" (Dock) — it used to run on every add/close and threw away
  resizes and moves. The drag hint is `dropPreview`, computed from the real result.
  A Dock icon can be dragged in too (`insertTileAt`: a tile's centre halves it along its
  longer side instead of swapping; an empty workspace takes it whole); a click still uses
  `insertTile`. The drag in progress is the store's `tileDrag` (moved tile or new one) and
  ends on the window's `dragend`.
- `src/renderer/dock/Dock.tsx` — the bar on the left; its menu button / Ctrl+K opens it
  wide **over** the tiles with every icon's name (it replaced the command palette).
  Open/closed is CSS only on the same elements, so a drag started in the open Dock
  survives it closing (closed in a timeout after dragstart).
- **Overlay (web views → snapshots) is decided in one place**: `App.tsx` shows it while
  `dockOpen || tileDrag || resizing`. `overlay.show/hide` is a plain on/off in main —
  don't call it from features directly, or one feature's hide undoes another's show.
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
- Folder bar: a plugin calling `fs.showFolderBar(handle|null)` gets an address bar on top
  of its tile (`tiles/plugin/FolderBar.tsx`), drawn by the shell — `PluginFrame` answers
  that call itself (never forwarded to `hostCall`), asks main for the path
  (`folderBarPath`), and on Enter calls `grantFolder` (which normalizes quotes/`~`/trailing
  separators and checks it's a readable folder — `folderInput.ts`) and posts a
  `folderBarChange` event with the handle. The path never reaches the plugin.
  Completions come from `folderSuggest.ts` (names only — the Files `listDir` is too slow
  per keystroke). Notes uses it instead of a "フォルダ変更" button.
- AI Builder (web-bridge): steps 1-3, step 2 is checked automatically (debounced);
  `ValidationResult` lists the manifest's permissions as plain-words "features", not
  warnings. `PluginFrame` shows failed host calls + uncaught plugin errors (reported by
  `bridgeScript.ts`) in an error bar with a runtime fix request, and reloads when the
  plugin's `installedAt` changes (reinstall of the same id).
- **Security** (see README「セキュリティ」): `src/main/security.ts` — the shell never navigates
  (`will-frame-navigate`) and is `sandbox: true`; IPC is accepted only from the shell's main
  frame (`guardIpcSenders` wraps `ipcMain.handle/on`, installed before every `register*Ipc`);
  permissions: shell/plugin session gets only clipboard-write + fullscreen, tile sessions ask
  through a dialog (remembered until quit); no `<webview>`; no subframe may load http/file in
  the shell's session. URLs that leave the app go through `shared/urlSafety.ts`
  (`isSafeExternalUrl` = http/https/mailto). Paths a plugin passes go through
  `utils/pathGuard.ts` `isInside` (on Windows `path.relative` returns *absolute* paths for
  another drive / UNC — a `..` check alone let plugins out). Plugin responses carry a CSP built
  from the manifest's network domains (`plugins/pluginCsp.ts`). `net.fetch` is https-only,
  re-checks every redirect, 30 s / 10 MB. Secrets are never written without `safeStorage`.
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

- **Toolchain (2026-10-05)**: Electron 44, electron-builder 26, electron-vite 5 with **vite 7**
  (electron-vite 5's peer range stops at vite 7; vite 8 needs electron-vite 6, beta then),
  vitest 5. `npm audit` was 0 after the upgrade. node-pty's N-API prebuilds work unchanged.
- **Electron 44 `capturePage()`** can throw `UnknownVizError` right after a window is shown
  while other apps start (parallel e2e workers); 0.2 s later it works — e2e captures retry, and so
  does the overlay snapshot (`captureWithRetry` in viewManager.ts: on the Mac 2 of 8 splitter drags
  got no snapshot without it).
- **Two `loadURL`s ~5 ms apart**: Chromium can drop the second one — it never starts, and its
  promise still resolves with the first page's `did-finish-load`. The Files preview blanks its view
  (about:blank) on leaving a file and loads the next right after; the preview stayed blank in 2-3 of
  12 runs on the Mac. `ViewManager.load()` loads once more when its navigation never started (or
  was aborted) and nobody asked for another page since (`requestedUrl`, cleared by in-page
  navigations and back/forward/reload).
- **`navigator.clipboard.writeText` fails without window focus** (Electron 44; e2e windows never
  have it). Copy goes through main: `window.api.clipboard.writeText`.
- **A plugin `<iframe>` navigating itself to a web site** is stopped by the shell's own CSP
  (`frame-src plugin-app:` → `ERR_BLOCKED_BY_CSP`, the frame shows an error page under that
  URL — so don't assert on the frame URL, assert the site got no request). `will-frame-navigate`
  isn't emitted for it.
- **Playwright and a cancelled shell navigation**: after `location.href = …` is blocked, locators
  on the shell page keep "waiting for navigation to finish"; check with `evaluate` instead.

- **node-pty**: pinned `1.2.0-beta.15` because it ships N-API prebuilds for all OSes.
  Never run `electron-builder install-app-deps` / electron-rebuild; `npmRebuild: false`
  is set in `electron-builder.yml`. (This machine's Python lacks `distutils`, so any
  node-gyp build fails anyway.)
- **electron-builder on Windows: "Cannot create symbolic link"** while extracting
  `winCodeSign-2.6.0.7z` — its two macOS `.dylib` symlinks need admin / Developer Mode.
  Fix once per machine: extract it without `darwin/` into the cache dir it looks for,
  `node_modules\7zip-bin\win\x64\7za.exe x -y <cache>\winCodeSign\<n>.7z
  -o%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0 -xr!darwin`
  (done 2026-10-03; failed attempts leave `<n>/` + `<n>.7z` there, safe to delete).
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
- **Heavy main-process deps load on first use** (`import()`): `googleapis` alone cost +80 MB
  and +0.8 s at startup (measured 2026-10-01: whole app ~405 → ~340 MB, launch 1.3 → 0.56 s),
  `openai` +12 MB, `systeminformation` +5 MB. Don't import them statically again. (The shell
  page's JS heap is only ~5 MB, so splitting the renderer bundle wouldn't buy much; turning
  spellcheck off saved only ~3 MB per web view, so it stays on; idle CPU is ~0 %.)
- **si.mem() on Windows spawns PowerShell** — too slow for the 0.5 s SysMon poll;
  `sysMonitor.ts` uses `os.totalmem/freemem` there. **`si.processes()` is never polled**: on
  Windows it runs PowerShell (`Get-CimInstance`, ~0.3 s CPU per call — every 3 s was ~10 % of
  a core); the list loads when the tile opens and on its 更新 button (user's choice, 2026-10-03;
  a resident PowerShell was ~16 ms per call but 80-100+ MB and growing).
- **systeminformation runs in a worker thread** (`sysmon/sysmonWorker.ts` via electron-vite's
  `?nodeWorker`, `SysmonClient`), never in the main process: loading it compiles a big module
  and runs `chcp` with **execSync** — that blocked main ~100 ms at startup, right when the
  terminal's `pty.create` was waiting. Works from `app.asar` (packaged app checked).
- **Splitters move a guide line; the layout changes once, on release** (Escape cancels;
  web views are swapped for snapshots meanwhile, like a tile drag). Live resizing sent
  config + bounds + pty-resize IPC and re-rendered every tile per pointer move (360 moves:
  ~1,440 IPC, 2.3 s main CPU → now 6 IPC). Don't put store updates back in `pointermove`.
- **Splitters at a T junction**: the inner handle starts right at the outer line and overlapped
  its middle; splitters are rendered reversed so the outer (long) one is on top.
- **Playwright's emulated tile drag** fires only `dragenter` on the first move into an element;
  `dragover` (which sets the drop preview) comes with the next move inside it — tests move twice.
  The preview then animates (CSS transition): read it after `settledPreview()` (helpers.ts),
  or you get where it was a moment ago.
- **Overlay snapshots** (`hideAllForOverlay`) are async: a generation counter stops a capture
  that finishes after `overlay.hide` from hiding its view again (a quick click on a splitter
  left a page stuck as a snapshot); `setBounds` under the overlay only records `lastBounds`.
- **Re-renders**: `TileChrome` is memoized and its body element too; select numbers, not
  objects, from `memorySnapshot` (a new snapshot arrives every 0.5 s). `App` selects only the
  layout. Web view bounds are reported at most once a frame and only when changed; terminals
  fit once a frame and send `pty.resize` only when cols/rows change (after 80 ms).
- **Terminals start before the window**: main spawns the active workspace's Terminal tiles
  right after creating the window (`terminal/prewarm.ts`, 100×30); the tile attaches like a
  remount (backlog + resize). PowerShell needs ~0.7 s to its prompt, so this is most of the
  startup gain (prompt 1.36 → 0.90 s).
- **Terminal output is batched** (`terminal/ptyOutput.ts`): sent 5 ms after its first chunk,
  backlog kept as chunks. 30,000 lines were ~18,000 IPC messages and a 200 KB string
  re-sliced per chunk; now ~700 messages, half the renderer CPU. The main process still
  burns ~1 core during such a burst — node-pty's own ConPTY reading (the JS thread is ~90 %
  idle in a profile), not ours.
- **Plugin registry / storage / folder grants are cached in memory** (`PluginHost.list()`,
  `hostApiBridge` storage + folders, written through). Every Host API call and every
  `plugin-app://` request (each image of a photo viewer) used to re-read and parse
  installed.json, every manifest.json and folders.json on the main process.
- **Hidden is hidden**: a WebContentsView at 0×0 bounds (another workspace, overlay) is
  `visibilityState: hidden` with no rAF and ~1 Hz timers — checked with a bare Electron
  script. Under Playwright every page reports "visible" (its focus/visibility emulation),
  so tests fake `document.hidden` + `visibilitychange` instead. SysMon stops polling while
  hidden; the memory loop doesn't send while the window is minimized.
- **Per-tile memory / CPU** (tile headers, SysMon's breakdown) come from `app.getAppMetrics()`
  in the 0.5 s memory loop (~0.1 ms a call). Plugin `<iframe>`s run in processes of their own;
  they're found by their `name` (`pluginFrameName(tileId)`, `shared/pluginFrame.ts`) through
  `framesInSubtree`. A header adds up the tile's sub-views (`tileUsage.ts`). Built-in tiles share
  the UI process and can't be told apart, so they show nothing. **`percentCPUUsage` is a share of
  the whole machine** (one busy core read ~3 % on this 32-thread PC) — the loop multiplies by
  `availableParallelism()` so 100 % = one core. CPU shows only while busy (2 s average ≥ 5 %,
  hidden below 3 %: `cpuBadges.ts`); idle tiles measured quiet. Under Playwright, a tile that
  burns a core reads ~100 % (sysmon.spec's CPU Burner plugin).
- **Files tile** only re-renders on a resize when the set of columns that fit changes, and
  reads the workspace at click time (it re-rendered whenever any tile saved its config).
- **Startup floor**: process start → shell page committed ≈ 0.2 s, then ~0.19 s in which the
  shell renderer does nothing traceable before the preload runs — Electron/Chromium's own
  renderer start (`sandbox: true` didn't change it; measured with a trace). The shell's JS is
  ~40 ms compile+evaluate. Measure with `tests/e2e/perf.spec.ts` (skipped unless
  `BRIGHTERM_PERF_SPEC=1`; see `src/main/perf.ts` for the marks, CPU profile and trace).
- **Windows file attributes** (hidden/system/readonly) come from one `cmd /u /c dir /a:X /b`
  call per folder (`fsService.ts`); `attrib` mangles non-ASCII names in its output. On macOS
  the `hidden` file flag (`chflags hidden`, e.g. `~/Library`) counts as hidden too: one
  `/usr/bin/find <dir> -mindepth 1 -maxdepth 1 -flags +hidden -print0` per folder (~5 ms).
- **Folder bar: Tab, then Enter at once** — Tab's completion is an IPC round trip; Enter used to
  submit the text from before it (seen under the full parallel e2e load). Enter now waits for
  a pending completion (`pendingCompletion` in FolderBar.tsx).
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
- E2E windows never take the focus **or cover the user's windows**: `helpers.ts` sets
  `BRIGHTERM_BACKGROUND=1`, so `window.ts` opens the window past the right edge of every display
  with `showInactive()` (and `focusMainWindow` does nothing). The user works while tests run —
  before this their typing landed in tests ("最初のメモuru"), and `showInactive()` alone still
  put each new window in front. Off screen needs `--disable-features=CalculateNativeWinOcclusion`
  (`index.ts`, test mode only): without it Chromium on Windows marks an off-screen or fully covered
  window's pages `hidden` — 0 rAF, and `capturePage()` never resolves (checked with a bare Electron
  script, 2026-10-03; under Playwright the page still *reports* visible, so a spec can't show it).
  **macOS** pulls a framed window back on screen when it's shown (and `setPosition` keeps 40 px on
  screen), so in test mode the window is **frameless + `enableLargerThanScreen`** there; and an
  off-screen page goes `hidden` after one frame with `capturePage()` failing ("Current display
  surface not available") unless `--disable-backgrounding-occluded-windows` is set
  (`MacWebContentsOcclusion` off didn't help) — both checked with a bare Electron script, 2026-10-06.
  Playwright's input and screenshots go through CDP, not the screen. In tests, un-minimize with
  `showInactive()`, never `restore()` — that activates the window and takes the focus.
  While iterating run only the affected specs; the whole suite once at the end.
- **E2E runs in parallel** (`playwright.config.ts`: 4 workers, `fullyParallel`): every test launches
  its own app with its own user-data dir, off screen. A test that uses the **OS clipboard** (shared
  by all apps) must be tagged `{ tag: '@clipboard' }` — that project runs them one at a time.
  Anything else machine-wide (a fixed path, a fixed port) needs the same treatment. 6 or 8 workers
  were no faster (~51-53 s; launches compete for CPU). `perf.spec.ts` keeps its tests in order
  (`describe.configure`) and should be run alone. Seen twice on 2026-10-03, then not in 160 runs:
  `files.spec` "PDF / audio previews" with the PDF view's capture all black for 10 s (also with
  1 worker) — cause unknown; if it comes back, log the view's `capturePage` size/visibility.
- E2E launches with `--user-data-dir=<tmp>` and **`colorScheme: null`** — Playwright
  otherwise emulates `prefers-color-scheme: light` on every page.
- Replace native dialogs in tests via `app.evaluate(({dialog}) => …)`.
- Plugin iframes: `window.frameLocator('iframe.bt-plugin-frame')`.
- Assert what the user sees (`toBeHidden`, `toBeInViewport`, files on disk), not just
  that an element exists — an earlier Notes test passed while the editor was off-screen.
- For screenshots, write a throwaway `tests/e2e/zz-*.spec.ts` that saves PNGs to the
  scratchpad, `Read` the image, then delete the spec.
- Every temp dir a test makes must be removed even when the test fails (`afterEach`,
  or `tempDir`/`removeDir` from `tests/e2e/helpers.ts` in a `finally`). A leak in
  `agentTools.test.ts` once left 276 folders in `%TEMP%`. Don't leave `npm run dev`
  or Electron running either.
- For refactors, a throwaway `zz-*` spec with `toHaveScreenshot` (`maxDiffPixels: 0`,
  live numbers masked) taken before the change proves "pixel-identical" after it. The
  `style` option of `toHaveScreenshot` had no effect on the shell page; hide things via
  `element.style` in `evaluate` instead. `--update-snapshots` against the old build.
- The packaged app can be driven too: `_electron.launch({ executablePath:
  'release/win-unpacked/Brighterm.exe' })`. Playwright launches Electron through
  `cmd.exe` on Windows (`app.process().spawnfile`), so spawn a second instance with the
  path from `import electronPath from 'electron'`.

## Status (as of 2026-09-30)

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
shrink to its content). The user then rebuilt their Photo Viewer through the tile's fix
request and it works; they have made other plugins with it too.

Then (2026-10-01) Notes' folder is changed in a path bar on top of the tile (typed/pasted
path, subfolder completion, the native picker as a side button) instead of a button that
opened Explorer — as the generic `fs.showFolderBar` Host API (see "Folder bar" above).
Notes' list sorts by name (A→Z / Z→A, numeric-aware) or modified date (新しい順 / 古い順),
remembered in storage; for that `fs.listFiles` entries now carry `modifiedAt` (ms).

Then (2026-10-03) a performance pass from "still feels heavy" (splitters not following the
mouse, slow start), measured before/after with `tests/e2e/perf.spec.ts` — see the gotchas
above (guide-line splitters, sysmon worker, prewarmed terminals, fewer re-renders).
Built app, 6 tiles: terminal prompt 1.36 → 0.90 s, Notes/Browser ~0.81 → ~0.75 s; a
360-move splitter drag 1,440 → 6 IPC, shell script 652 → 62 ms. `npm run dev` is slower
than these (React dev build, StrictMode double effects, DevTools opened at every start).

Then (2026-10-03, later) a resource audit of every tile and the app: terminal output batched,
plugin registry/storage/folders cached, Files re-renders cut, SysMon's process list on demand
(更新 button), nothing polled while minimized (see the gotchas). AGENTS.md got
"軽く動かすためのルール" (debounced saves, no polling, pause on `document.hidden`, lazy images,
small storage) — the plugin's own code is written by the AI each time, so this is the main
guard; static checks / runtime call-rate warnings were proposed and deferred by the user.
The spec goes into the chat prompt inside a fence longer than its own ```js examples
(`fenceFor` in promptBuilder.ts).

Then (2026-10-03, later) tiling from the user's report (closing a tile reset their resizes,
moved tiles snapped back, drops landed elsewhere than hinted): bspwm-style insert/close,
drops on the whole area's edges, a hint showing the real result, "タイルを整列" on request,
T-junction splitter fix. The user chose: split the largest tile on add; an edge drop on a
tile still halves that tile (not insert-into-row).

Then (2026-10-03, later) Dock icons can be dragged onto the tiles (same real-result preview);
the command palette was removed — the Dock opens wide over the tiles with names instead
(menu button / Ctrl+K; Escape or a click outside closes). The user chose: a new tile dropped
on a tile's centre halves it along its longer side; a click still splits the largest tile.

Then (2026-10-05) a security pass before publishing on GitHub (public): Electron 33 → 44 and
the toolchain (`npm audit` 25 → 0), external opens limited to http/https/mailto (plugin
`window.open`, HQ card URLs, IPC), plugin paths can't leave the folder on Windows (other drive /
UNC), shell locked to its page + sandboxed + IPC sender check, permission dialogs for web tiles,
plugin CSP from the manifest's network domains, web views open only web pages, `net.fetch`
https + redirect checks, API-agent installs ask first, OAuth PKCE + state, no plain-text
secrets, CI token read-only. All in `tests/e2e/security.spec.ts` + unit tests. Versions are
major 0 (app 0.1.0, Notes 0.3.0, Slack 0.1.0, SDK templates/examples 0.1.0). MIT `LICENSE` added.

Known gaps / possible next steps:
- Folder bar: no breadcrumb (clickable segments to go up) yet.
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
