# Architecture & File Map

A reference for `file-diff-desktop` — a Tauri 2 desktop app that compares two
folders or two files and renders a side-by-side Monaco diff editor (with
in-place editing and Save Left / Save Right to disk).

The runtime is split into two halves:

- **Frontend** — vanilla ES modules under `src/`, served by Tauri's webview.
  Monaco is vendored (not bundled) so it loads from `src/vendor/monaco/`.
- **Backend** — a Rust crate under `src-tauri/` exposing `#[tauri::command]`
  functions for the OS work (folder pickers, file IO, recursive folder
  comparison with BLAKE3 content hashing).

The two halves talk only via `window.__TAURI__.core.invoke(...)`, wrapped in
`src/js/tauri/api.js`.

---

## Top-level layout

```
file-diff-desktop/
├── README.md
├── ARCHITECTURE.md          ← this file
├── package.json             # npm scripts + JS deps (Tauri CLI, Monaco)
├── package-lock.json
├── .nvmrc                   # pin Node 24 so @tauri-apps/cli native binding matches
├── .gitignore               # ignores node_modules, src/vendor/monaco, build artifacts
├── .vscode/
│   └── extensions.json      # recommends Tauri + rust-analyzer extensions
├── scripts/
│   └── copy-monaco.mjs      # postinstall: vendors monaco-editor/min/vs → src/vendor/monaco/vs
├── src/                     # frontend (HTML / CSS / ES modules)
└── src-tauri/               # native Rust app shell
```

### Root files

- `README.md` — quick-start: `nvm use && npm install && npm run tauri dev`.
- `package.json` — `type: "module"`, declares `@tauri-apps/api` (runtime) and
  `@tauri-apps/cli` + `monaco-editor` (dev). The `postinstall` hook runs
  `scripts/copy-monaco.mjs` so Monaco is vendored after every install.
- `.nvmrc` — pins Node `24` so the platform-specific `@tauri-apps/cli` native
  binding installed by npm matches the developer's machine.
- `.gitignore` — keeps `node_modules/`, `src/vendor/monaco/` (vendored on
  install), Cargo build output, and editor cruft out of the repo.
- `.vscode/extensions.json` — recommends the Tauri and rust-analyzer
  extensions for contributors.

### `scripts/copy-monaco.mjs`

Postinstall vendoring step. Recursively copies
`node_modules/monaco-editor/min/vs/` to `src/vendor/monaco/vs/` so
`src/index.html` can `<script src="vendor/monaco/vs/loader.js">` directly. It
wipes the destination first so re-installs always reflect the current Monaco
version. Runs in pure Node (`fs`, `path`, `url`) — no extra deps.

---

## Frontend — `src/`

```
src/
├── index.html               # shell HTML: toolbar, tab bar, drop zones, Monaco loader
├── main.js                  # entry: waits for Monaco, wires events, sets up drops
├── styles.css               # all styling for toolbar, tabs, fc-table, diff editor, recents
├── assets/                  # static SVGs (currently unused decorative icons)
│   ├── javascript.svg
│   └── tauri.svg
├── vendor/
│   └── monaco/              # populated by scripts/copy-monaco.mjs (gitignored)
└── js/                      # all app logic, split into focused modules
```

### `src/index.html`

The single HTML page Tauri loads. It:

- Sets up Monaco via the AMD `loader.js` from `vendor/monaco/vs/`, configures
  `MonacoEnvironment.getWorkerUrl` so workers (json/css/html/ts + the base
  editor worker) load from the same vendored path, then sets
  `window.__monacoLoaded = true` once `vs/editor/editor.main` finishes
  loading.
- Defines the toolbar (`Reset`, `Refresh`, `Recent ▾`, `Save Left/Right/All`,
  `Compare files…`), the tab bar (initialized with the always-present
  `Folder Compare` tab), the path bar with `Pick Folder` buttons, the empty
  state's `LEFT` / `RIGHT` drop zones, the `fc-table` body for diff rows, a
  status bar, and two hidden `<input type="file">` elements used as the
  browser-mode picker fallback.
- Loads `main.js` as a module after Monaco is queued.

### `src/main.js`

Entry point. Awaits `waitForMonaco()` (polls until `window.monaco` exists),
then calls `wireEvents()`, `updatePathLabels()`, `initTauriNativeDragDrop()`,
and registers DOM-level drop zones for both sides.

### `src/styles.css`

All UI styling: dark theme, toolbar/tab/path-bar layout, `.fc-row` styling
per-status (`onlyLeft`, `onlyRight`, `modified`), Monaco diff highlight
classes (`diff-line-changed`, `diff-line-ws`, `diff-ch-inline-important`),
drop-zone hover/`is-drop-target` states, the recents popover, etc.

### `src/assets/`

Decorative SVGs (`javascript.svg`, `tauri.svg`) — not referenced by the
current UI; legacy from the `create-tauri-app` template, safe to remove if
unused.

### `src/vendor/monaco/`

Generated, gitignored. Filled by `scripts/copy-monaco.mjs` so `index.html`
can load Monaco straight from disk without a JS bundler.

---

## Frontend modules — `src/js/`

```
src/js/
├── dom.js                   # cached document.getElementById refs (no logic)
├── state.js                 # in-memory app state (roots, entries, tabs, JSDoc types)
├── utils.js                 # pure helpers (path/format/escape/trie/Monaco-ready/status)
├── events.js                # central wireEvents(): toolbar + fc-row + recents listeners
├── tauri/
│   └── api.js               # thin invoke() wrappers for every Rust command
├── storage/
│   ├── recents.js           # localStorage CRUD for "fdd.recents"
│   └── diffPrefs.js         # localStorage CRUD for "fdd.diffPrefs" + transforms
├── features/
│   ├── folderCompare.js     # path-bar, pick/refresh, fc-table renderer (trie-based)
│   ├── dragDrop.js          # native (Tauri) and DOM drag-drop, drop-zone setup
│   └── recentsUi.js         # renders the toolbar popover + empty-state recents list
├── tabs/
│   ├── manager.js           # opens/closes tabs, builds Monaco diff editor per tab
│   └── save.js              # dirty-tracking, Save Left/Right/All, reset-to-start flow
└── monaco/
    └── diff.js              # custom diff theme + post-diff line/inline decorations
```

### `js/dom.js`

Centralized `document.getElementById(...)` references for every interactive
element in `index.html` (toolbar buttons, path/status spans, fc-table body,
drop zones, file inputs, recent popover, panels). No behavior — every other
module imports from here so DOM lookups happen once.

### `js/state.js`

The single source of truth for runtime state and the JSDoc type definitions
(`DiffEntry`, the per-tab data shape with Monaco editor/model handles).
Exposes `state` with: `leftRoot`, `rightRoot`, `entries[]`,
`droppedFiles{left,right}`, `collapsedDirs:Set`, `tabMap`, `tabPanels`, and
`activeTabId`. Seeds the always-present `"folder"` tab in `tabMap` /
`tabPanels` at module load.

### `js/utils.js`

Stateless helpers used everywhere:

- `joinPath(root, rel)`, `shortPath(p)` — path normalization for display.
- `guessLanguageId(relPath)` — extension → Monaco language id table.
- `formatSize(bytes)`, `formatDate(ms)`, `escHtml(s)` — display formatters.
- `sliceLinesText(model, start, end)` — reads a line range out of a Monaco
  text model (used by diff highlighting to detect whitespace-only changes).
- `createTrieRoot()` / `insertTrie(root, entry)` — builds a path trie from
  flat `DiffEntry` rows so the fc-table can render a hierarchical tree.
- `waitForMonaco()` — polls `window.monaco` so callers can `await` it.
- `setStatus(el, text, isError)` and `setBusy(busy)` — toggle the status bar
  and disable toolbar buttons during long ops.

### `js/events.js`

`wireEvents()` is called once from `main.js` and centralizes all global
listeners: tab activation on `.tab` clicks, fc-row clicks (toggle collapse
for dirs, open `openFileTab(entry)` for files), `Pick Folder L/R`, `Refresh`,
`Reset` (`resetApplicationToStart`), `Save Left/Right/All`,
`Compare files…`, the `Recent ▾` toolbar popover toggle, and a document-wide
click that closes the recents popover.

### `js/tauri/api.js`

Thin `invoke()` wrappers around every Rust command, plus an `isTauri()`
guard so browser-mode code paths can short-circuit. The full surface:
`readFile`, `writeFile`, `pickFolderRaw`, `pickFileRaw`, `compareFolders`,
`listFolder`, `pathIsDirectory`. This is the only file that knows about
`window.__TAURI__`.

### `js/storage/recents.js`

`localStorage`-backed recents under key `fdd.recents`. Provides
`loadRecents()`, `saveRecents()`, the `RECENTS_MAX = 15` cap, and
`recentSignature(item)` for dedup (folder pair vs. single folder vs. file
pair). Each item carries `{ id, kind, ts, label, left?, right?, side?,
path?, leftName?, rightName? }`.

### `js/storage/diffPrefs.js`

`localStorage`-backed diff prefs under key `fdd.diffPrefs`:
`{ ignoreWhitespace, ignoreCase, ignoreLineEndings }`. Also exports
`getDisplayTextsForPrefs(rawL, rawR, prefs)` which applies the
case-folding / line-ending normalization that the Monaco models actually
display.

### `js/features/folderCompare.js`

The folder-compare feature.

- Side-state helpers: `getSideState(side)`, `pathBarTextForSide`,
  `pathBarTitleForSide`, `syncDropZoneForSide`,
  `updateFcFileDiffHintVisibility`.
- `updatePathLabels()` — keeps the path bar text/tooltips, the
  empty-vs-table visibility, the drop-zone "has-folder/has-file" labels, and
  the recents list in sync with `state`.
- `pickFolder(side)` / `pickFilePath(msg)` — wraps `pickFolderRaw` /
  `pickFileRaw` with a busy state and a 120s timeout.
- `compareTwoFilesFromToolbar()` — `Compare files…` flow: picks two files,
  reads both, opens a `dropped` tab.
- `recordRecentAfterCompare()` — pushes a folderPair / single-folder
  recents entry after a successful refresh.
- `refreshCompare()` — calls `compare_folders` (both sides) or `list_folder`
  (one side only) with a 90s timeout; populates `state.entries`; renders.
- `renderFolderCompare()` + `renderFcLevel` + `createFcRow` — builds a path
  trie from entries, sorts dirs first then alphabetical, and emits the
  hierarchical `.fc-row` tree with indentation, dir collapse arrows, name /
  size / date columns, and a center gutter showing `≠ / ◁ / ▷`.

### `js/features/dragDrop.js`

Drag-and-drop ingestion for both runtime modes.

- `handleDocumentSelection(side, file)` — browser path: reads the dropped
  `File` via `file.text()` and stages it on `state.droppedFiles[side]`. Once
  both sides are present, opens a dropped tab.
- `applyCompareSideFromFsPath(side, fsPath)` — Tauri path: uses
  `path_is_directory` to decide if the drop is a folder (set as root + run
  `refreshCompare`) or a file (read it, stage it, open a dropped tab once
  the other side is also a file).
- `dragPositionToLogical(win, position)` + `resolveDropSide(lx, ly)` +
  `setNativeDragHighlight(side)` / `clearNativeDragHighlight()` — converts
  Tauri's physical drag coordinates to logical (DPI-aware) coordinates,
  hit-tests under the cursor, and toggles the left/right drop highlights on
  the path bar / drop zones.
- `initTauriNativeDragDrop()` — subscribes to `webview.onDragDropEvent` and
  wires `enter`/`over`/`leave`/`drop` events through the helpers above.
- `setupDropZone(zoneEl, side, inputEl)` — for each drop zone: click opens
  the native folder picker (Tauri) or the hidden `<input type="file">`
  (browser); `Enter`/`Space` re-trigger the click; in browser mode also
  registers `dragover` / `dragleave` / `drop` and the `change` listener on
  the file input.

### `js/features/recentsUi.js`

Renders the recents UI in two places:

- The `Recent ▾` toolbar popover (`renderRecentToolbarList()`,
  `closeRecentPopover()`).
- The empty-state list shown under the drop zones (`renderFcRecents()`).

Provides `addRecent`, `removeRecent`, `clearRecents` on top of
`storage/recents.js`, and `rehydrateRecentItem(item)` which re-opens a
recent entry: validates folders with `pathIsDirectory`, sets state and
runs `refreshCompare` for folder-pair / single-folder recents, or
`readFile`s both sides and opens a dropped tab for filePair recents.

### `js/tabs/manager.js`

Tab lifecycle and Monaco diff editor construction.

- `activateTab(id)` — switches `is-active` classes on tabs/panels; lazily
  initializes the Monaco diff editor on first activation, otherwise calls
  `editor.layout()` on the next frame.
- `closeTab(id)` / `closeAllFileTabs()` — disposes diff highlights, models,
  and the Monaco editor; removes the tab button and panel.
- `openFileTab(entry)` — opens a `file`-type tab for a folder-compare row;
  builds a header with both full paths and Save Left / Save Right buttons.
- `openDroppedTab(left, right)` — opens a `dropped`-type tab for two
  ad-hoc files. If both files have on-disk paths (Tauri `Compare files…` or
  Tauri drag-drop), records a `filePair` recent.
- `_createDiffTab(...)` / `_makeFileTabHeader(...)` — DOM construction for
  the tab button (with close `×`), the panel, the header (paths + Save
  buttons), and the sub-row of diff option checkboxes (`Ignore whitespace`,
  `Ignore case`, `Ignore line endings`) wired to `diffPrefs` storage.
- `syncDiffPrefInputsFromStorage()`, `updateCaseHintForTab(tabId)`,
  `rebuildTabDiffModels(tabId)` — when prefs change, rebuilds Monaco models
  using `getDisplayTextsForPrefs` and toggles read-only when `ignoreCase`
  is on (saving is disabled in that mode to avoid clobbering casing).
- `initTabEditor(tabId)` — for `file` tabs, reads both files via Tauri; for
  `dropped` tabs, uses the staged text. Then ensures the `fdd-dark` theme,
  builds two Monaco models, creates a `monaco.editor.createDiffEditor` with
  side-by-side rendering, gutter revert icons, the advanced diff algorithm,
  and a minimap, and wires `setupDiffLineHighlights`.

### `js/tabs/save.js`

Saving and reset.

- `getTabSidePath`, `getTabSideValue`, `getTabSideBaseline`,
  `isTabSideDirty`, `getDirtySides`, `getDirtyTabs` — dirty tracking by
  comparing the editor's current text against the baseline derived from
  the raw text + current diff prefs.
- `saveTabSide(tabId, side)` / `saveTabSides(tabId, sides[])` — writes via
  `writeFile` and updates the in-memory baseline so the side becomes
  clean.
- `saveDirtyTabsBeforeReset(dirtyTabs)` — pre-reset dialog: alerts on
  unsaved tabs without paths, otherwise confirms and saves.
- `resetApplicationToStart()` — the `Reset` toolbar button; closes all file
  tabs (offering to save dirty ones first), clears roots / entries /
  dropped-file state, and returns to the empty Folder Compare tab.
- `saveActiveTabEditor(which)` — toolbar `Save Left`/`Right`/`All`. Limited
  to `file`-type tabs (folder-compare originated) so `which === "all"` has
  a known L+R path on disk.

### `js/monaco/diff.js`

Custom diff visualization on top of Monaco's diff editor.

- `ensureFddDiffTheme()` — defines `fdd-dark` (extends `vs-dark`) with
  transparent default insert/remove backgrounds so the custom CSS classes
  in `styles.css` provide the highlighting instead.
- `applyDiffLineHighlights(editor, origColl, modColl)` — reads
  `diffEditor.getLineChanges()`; for each change, marks whole lines
  `.diff-line-changed` (or `.diff-line-ws` if the change is whitespace-only)
  and uses `charChanges` to mark intra-line ranges with
  `.diff-ch-inline-important`. Skips when `getLineChanges()` is `null`
  (Monaco 0.52+ computes diffs async) so decorations aren't wiped before
  the diff is ready.
- `setupDiffLineHighlights(tabId, editor)` — wires
  `onDidUpdateDiff`, `onDidChangeModel`, and debounced
  `onDidChangeContent` listeners, plus a microtask + rAF deferred run so
  decorations land after Monaco's async diff pipeline completes.
- `disposeTabDiffHighlights(data)` — clears collections and disposes
  listeners on tab close / model rebuild.

---

## Backend — `src-tauri/`

```
src-tauri/
├── Cargo.toml               # Rust deps: tauri, dialog/opener plugins, walkdir, blake3, serde, tokio
├── Cargo.lock
├── build.rs                 # delegates to tauri_build::build()
├── tauri.conf.json          # Tauri app config (window, bundle, frontendDist=../src)
├── capabilities/
│   └── default.json         # window permission set (core/opener/dialog defaults)
├── icons/                   # platform icons embedded into the bundle (png/icns/ico)
├── gen/                     # generated by tauri (capability schemas etc.)
├── target/                  # cargo build output (gitignored)
└── src/
    ├── main.rs              # binary entrypoint → file_diff_desktop_lib::run()
    └── lib.rs               # all #[tauri::command] implementations
```

### `src-tauri/Cargo.toml`

Declares the crate (`name = "file_diff_desktop_lib"`, exposed as `staticlib`
+ `cdylib` + `rlib` so Tauri can both link and run it). Depends on:
`tauri` 2, `tauri-plugin-opener` 2, `tauri-plugin-dialog` 2, `walkdir`
(recursive folder walking), `blake3` (content hashing for "modified" check),
`serde` + `serde_json` (camelCase-serialize the `DiffEntry` payload), and
`tokio` `sync` + `time` (oneshot channel + dialog timeout).

### `src-tauri/build.rs`

Cargo build script — calls `tauri_build::build()` so Tauri can embed icons,
capability schemas, and resources into the compiled binary.

### `src-tauri/tauri.conf.json`

App config. Points `frontendDist` at `../src` (no bundler — the HTML/CSS/JS
under `src/` is served directly). Declares the bundle identifier
(`com.jaypante.file-diff-desktop`), the 1280×800 main window, and bundle
icon paths. `withGlobalTauri: true` makes `window.__TAURI__` available to
the frontend (used by `js/tauri/api.js`).

### `src-tauri/capabilities/default.json`

Tauri capability for the `main` window. Grants the `core:default`,
`opener:default`, and `dialog:default` permission sets — enough for our
custom commands plus the file/folder pickers.

### `src-tauri/icons/`

App icons in every required size/format (PNG sizes for Linux/Windows,
`icon.icns` for macOS, `icon.ico` for Windows, plus the Microsoft Store
square logos).

### `src-tauri/gen/`

Auto-generated by `tauri-build` (capability JSON schemas, etc.). Touch only
through the build system.

### `src-tauri/target/`

Cargo build output — gitignored.

### `src-tauri/src/main.rs`

Native binary entry point. The `windows_subsystem = "windows"` attribute
suppresses the extra console window on Windows release builds. Just calls
`file_diff_desktop_lib::run()`.

### `src-tauri/src/lib.rs`

All real backend logic.

- `NodeKind` enum + `collect_entries(root)` — walks a folder via `WalkDir`,
  skipping `.git`, `node_modules`, `target`, `dist`, `dist-ssr`, `.next`,
  `.turbo`. Builds a map of `relPath → Dir | File { size, modified_ms }`,
  normalizing path separators to `/`.
- `file_hash(path)` — BLAKE3 hash of file contents (used as a tie-breaker
  when two files have equal sizes).
- `DiffEntry` (camelCase serialized) — the row payload sent to JS, mirrored
  in `state.js`'s JSDoc.
- `pick_folder` / `pick_file` — async commands that open a native dialog
  via `tauri-plugin-dialog`, bridge the callback through a `tokio::oneshot`
  channel, and time out after 120s.
- `compare_folders(left, right)` — collects both sides, unions the keys,
  and classifies each as `identical` / `modified` / `onlyLeft` / `onlyRight`
  with kind `dir` / `file`. Files with matching sizes are hashed before
  being declared identical.
- `list_folder(root, side)` — single-side listing used when only one root
  is set; every entry comes back as `onlyLeft` / `onlyRight`.
- `path_is_directory(path)` — used by drag-drop to decide between
  "folder root" and "file diff" handling.
- `read_file(path)` / `write_file(path, contents)` — UTF-8 text IO; writes
  also `create_dir_all(parent)` so saving a path under a missing directory
  succeeds.
- `run()` — registers both Tauri plugins, the seven commands above, and
  starts the app (called from `main.rs`).

---

## Data flow at a glance

1. `main.js` waits for Monaco, wires events, and registers drop zones.
2. The user picks or drops two folders → `pickFolder` (frontend) → Tauri
   `pick_folder` → `refreshCompare()` → Tauri `compare_folders` returns
   `DiffEntry[]` → `renderFolderCompare()` builds a trie and emits
   `.fc-row`s.
3. Clicking a file row → `openFileTab(entry)` → `_createDiffTab` makes the
   tab + panel → `activateTab` lazily calls `initTabEditor` → reads both
   files via Tauri `read_file` → builds Monaco models → `setupDiffLineHighlights`
   paints custom decorations.
4. Editing in Monaco marks the side dirty (via `getTabSideValue` vs.
   `getTabSideBaseline`); `Save Left` / `Save Right` → `writeFile` → updates
   the baseline so the side is clean again.
5. Successful folder/file compares are appended to the recents list
   (`addRecent` → `localStorage`), shown in the toolbar popover and the
   empty-state list, and re-openable via `rehydrateRecentItem`.
