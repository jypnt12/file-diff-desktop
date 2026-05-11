const { invoke } = window.__TAURI__.core;

/** @typedef {{ relPath: string, kind: string, status: string, leftExists: boolean, rightExists: boolean }} DiffEntry */

function joinPath(root, relPath) {
  if (!root) return "";
  const r = root.replace(/\\/g, "/").replace(/\/$/, "");
  const p = (relPath || "").replace(/^\//, "");
  return p ? `${r}/${p}` : r;
}

function guessLanguageId(relPath) {
  const lower = relPath.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot) : "";
  const map = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".jsx": "javascript",
    ".json": "json",
    ".css": "css",
    ".scss": "scss",
    ".less": "less",
    ".html": "html",
    ".htm": "html",
    ".md": "markdown",
    ".rs": "rust",
    ".toml": "ini",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".xml": "xml",
    ".sql": "sql",
    ".py": "python",
    ".go": "go",
    ".java": "java",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".rb": "ruby",
    ".php": "php",
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
  };
  return map[ext] || "plaintext";
}

async function waitForMonaco() {
  while (!window.monaco) {
    await new Promise((r) => setTimeout(r, 30));
  }
}

function createTrieRoot() {
  return { children: new Map() };
}

/**
 * @param {ReturnType<typeof createTrieRoot>} root
 * @param {DiffEntry} entry
 */
function insertTrie(root, entry) {
  const parts = entry.relPath.split("/").filter(Boolean);
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (!cur.children.has(seg)) {
      cur.children.set(seg, { name: seg, children: new Map(), entry: null });
    }
    cur = cur.children.get(seg);
    if (i === parts.length - 1) {
      cur.entry = entry;
    }
  }
}

/** @param {HTMLElement} el */
function setStatus(el, text, isError) {
  el.textContent = text || "";
  el.classList.toggle("is-error", Boolean(isError && text));
}

/**
 * @param {ReturnType<typeof createTrieRoot>} trieRoot
 * @param {HTMLElement} container
 */
function renderTree(trieRoot, container) {
  container.replaceChildren();
  const ul = document.createElement("ul");
  ul.className = "tree-list";
  renderTrieLevel(trieRoot, ul);
  container.appendChild(ul);
}

/**
 * @param {{ children: Map<string, any> }} node
 * @param {HTMLUListElement} parentUl
 */
function renderTrieLevel(node, parentUl) {
  const names = [...node.children.keys()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
  for (const name of names) {
    const child = node.children.get(name);
    const li = document.createElement("li");
    li.className = "tree-item";

    if (child.entry) {
      const row = document.createElement("div");
      row.className = "tree-row";
      row.dataset.status = child.entry.status;
      row.dataset.relPath = child.entry.relPath;

      const label = document.createElement("span");
      label.className = "tree-label";
      label.textContent =
        child.name + (child.entry.kind === "dir" ? "/" : "");

      const badge = document.createElement("span");
      badge.className = "tree-badge";
      badge.textContent = child.entry.status;

      row.appendChild(label);
      row.appendChild(badge);

      if (child.entry.kind === "file") {
        row.classList.add("is-file");
        row.setAttribute("role", "button");
        row.tabIndex = 0;
      } else {
        row.classList.add("is-dir");
      }

      li.appendChild(row);
    }

    if (child.children.size > 0) {
      const nested = document.createElement("ul");
      nested.className = "tree-nested";
      renderTrieLevel(child, nested);
      li.appendChild(nested);
    }

    parentUl.appendChild(li);
  }
}

await waitForMonaco();

// ── DOM refs ──────────────────────────────────────────────────────────────

const statusEl = document.getElementById("status-msg");
const treeRootEl = document.getElementById("tree-root");
const pathLeftEl = document.getElementById("path-left");
const pathRightEl = document.getElementById("path-right");
const fileTitleEl = document.getElementById("file-title");
const btnPickLeft = document.getElementById("btn-pick-left");
const btnPickRight = document.getElementById("btn-pick-right");
const btnRefresh = document.getElementById("btn-refresh");
const btnSaveLeft = document.getElementById("btn-save-left");
const btnSaveRight = document.getElementById("btn-save-right");
const diffContainer = document.getElementById("diff-container");
const dropLeftEl = document.getElementById("drop-left");
const dropRightEl = document.getElementById("drop-right");
const inputLeftFileEl = document.getElementById("input-left-file");
const inputRightFileEl = document.getElementById("input-right-file");

// ── State ─────────────────────────────────────────────────────────────────

/** @type {string | null} */
let leftRoot = null;
/** @type {string | null} */
let rightRoot = null;
/** @type {DiffEntry[]} */
let entries = [];
/** @type {DiffEntry | null} */
let selectedEntry = null;
/** Tracks files dropped directly for single-file diff mode */
const droppedFiles = { left: null, right: null };

// ── Monaco diff editor ────────────────────────────────────────────────────

const diffEditor = monaco.editor.createDiffEditor(diffContainer, {
  originalEditable: true,
  readOnly: false,
  renderSideBySide: true,
  enableSplitViewResizing: true,
  automaticLayout: true,
  theme: "vs-dark",
  minimap: { enabled: true },
  scrollBeyondLastLine: false,
});

let originalModel = monaco.editor.createModel("", "plaintext");
let modifiedModel = monaco.editor.createModel("", "plaintext");
diffEditor.setModel({ original: originalModel, modified: modifiedModel });

// ── Helpers ───────────────────────────────────────────────────────────────

function shortPath(p) {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/");
  const tail = parts.slice(-2).join("/");
  return tail.length > 50 ? "…/" + tail.slice(-48) : p;
}

function updatePathLabels() {
  pathLeftEl.textContent = leftRoot ? shortPath(leftRoot) : "";
  pathRightEl.textContent = rightRoot ? shortPath(rightRoot) : "";
  dropLeftEl.classList.toggle("has-file", Boolean(leftRoot || droppedFiles.left));
  dropRightEl.classList.toggle("has-file", Boolean(rightRoot || droppedFiles.right));
}

function setBusy(isBusy) {
  btnPickLeft.disabled = isBusy;
  btnPickRight.disabled = isBusy;
  btnRefresh.disabled = isBusy;
}

function setDiffText(leftText, rightText, lang) {
  originalModel.dispose();
  modifiedModel.dispose();
  originalModel = monaco.editor.createModel(leftText, lang);
  modifiedModel = monaco.editor.createModel(rightText, lang);
  diffEditor.setModel({ original: originalModel, modified: modifiedModel });
}

function clearDroppedFiles() {
  droppedFiles.left = null;
  droppedFiles.right = null;
}

// ── Folder picking ────────────────────────────────────────────────────────

async function pickFolder(sideName) {
  setBusy(true);
  setStatus(statusEl, `Opening ${sideName} folder picker…`, false);
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Folder picker timed out.")), 120_000),
    );
    const picked = await Promise.race([invoke("pick_folder"), timeout]);
    setStatus(statusEl, "", false);
    return picked;
  } finally {
    setBusy(false);
  }
}

// ── Folder compare ────────────────────────────────────────────────────────

async function refreshCompare() {
  setStatus(statusEl, "", false);
  clearDroppedFiles();
  updatePathLabels();
  if (!leftRoot || !rightRoot) {
    entries = [];
    renderTree(createTrieRoot(), treeRootEl);
    return;
  }
  try {
    setBusy(true);
    setStatus(statusEl, "Comparing folders…", false);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const timeout = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Compare timed out — try a smaller folder.")),
        90_000,
      ),
    );
    entries = await Promise.race([
      invoke("compare_folders", { left: leftRoot, right: rightRoot }),
      timeout,
    ]);
    const trie = createTrieRoot();
    for (const e of entries) {
      insertTrie(trie, e);
    }
    renderTree(trie, treeRootEl);
    setStatus(statusEl, `Compared ${entries.length} paths.`, false);
    if (selectedEntry && selectedEntry.kind === "file") {
      const still = entries.find((x) => x.relPath === selectedEntry.relPath);
      if (still) {
        await openFileInDiff(still);
        highlightSelectedRow(still.relPath);
      } else {
        selectedEntry = null;
        fileTitleEl.textContent = "Select a file from the tree";
        btnSaveLeft.disabled = true;
        btnSaveRight.disabled = true;
      }
    }
  } catch (err) {
    setStatus(statusEl, String(err), true);
  } finally {
    setBusy(false);
  }
}

// ── File diff ─────────────────────────────────────────────────────────────

function highlightSelectedRow(relPath) {
  for (const row of treeRootEl.querySelectorAll(".tree-row.is-file")) {
    row.classList.toggle("is-selected", row.dataset.relPath === relPath);
  }
}

/** @param {DiffEntry} entry */
async function openFileInDiff(entry) {
  if (entry.kind !== "file") return;
  selectedEntry = entry;
  fileTitleEl.textContent = entry.relPath;
  btnSaveLeft.disabled = false;
  btnSaveRight.disabled = false;

  const leftPath = joinPath(leftRoot, entry.relPath);
  const rightPath = joinPath(rightRoot, entry.relPath);
  let leftText = "";
  let rightText = "";
  try {
    leftText = entry.leftExists
      ? await invoke("read_file", { path: leftPath })
      : "";
    rightText = entry.rightExists
      ? await invoke("read_file", { path: rightPath })
      : "";
  } catch (err) {
    setStatus(statusEl, String(err), true);
    return;
  }

  setDiffText(leftText, rightText, guessLanguageId(entry.relPath));
  highlightSelectedRow(entry.relPath);
}

// ── Drag & drop / file browse ─────────────────────────────────────────────

async function handleDocumentSelection(side, file) {
  if (!file) return;
  try {
    const text = await file.text();
    droppedFiles[side] = { name: file.name, text };

    if (side === "left") {
      pathLeftEl.textContent = file.name;
      dropLeftEl.classList.add("has-file");
    } else {
      pathRightEl.textContent = file.name;
      dropRightEl.classList.add("has-file");
    }

    setStatus(statusEl, `Loaded ${side}: ${file.name}`, false);

    if (droppedFiles.left && droppedFiles.right) {
      selectedEntry = null;
      fileTitleEl.textContent = `${droppedFiles.left.name}  ↔  ${droppedFiles.right.name}`;
      btnSaveLeft.disabled = true;
      btnSaveRight.disabled = true;
      for (const row of treeRootEl.querySelectorAll(".tree-row.is-file")) {
        row.classList.remove("is-selected");
      }
      const lang = guessLanguageId(droppedFiles.left.name || droppedFiles.right.name);
      setDiffText(droppedFiles.left.text, droppedFiles.right.text, lang);
      setStatus(statusEl, "Comparing dropped files.", false);
    }
  } catch (err) {
    setStatus(statusEl, `Unable to read file: ${String(err)}`, true);
  }
}

/**
 * @param {HTMLElement} zoneEl   The .drop-zone element
 * @param {"left"|"right"} side
 * @param {HTMLInputElement} inputEl  The hidden file input
 */
function setupDropTarget(zoneEl, side, inputEl) {
  zoneEl.addEventListener("click", () => inputEl.click());
  zoneEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inputEl.click();
    }
  });
  zoneEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    zoneEl.classList.add("is-dropping");
  });
  zoneEl.addEventListener("dragleave", (e) => {
    if (!zoneEl.contains(e.relatedTarget)) {
      zoneEl.classList.remove("is-dropping");
    }
  });
  zoneEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    zoneEl.classList.remove("is-dropping");
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    await handleDocumentSelection(side, file);
  });
  inputEl.addEventListener("change", async () => {
    const file = inputEl.files?.[0];
    inputEl.value = "";
    if (!file) return;
    await handleDocumentSelection(side, file);
  });
}

// ── Tree event listeners ──────────────────────────────────────────────────

treeRootEl.addEventListener("click", async (e) => {
  const row = e.target.closest(".tree-row.is-file");
  if (!row || !treeRootEl.contains(row)) return;
  const rel = row.dataset.relPath;
  const entry = entries.find((x) => x.relPath === rel && x.kind === "file");
  if (!entry) return;
  setStatus(statusEl, "", false);
  await openFileInDiff(entry);
});

treeRootEl.addEventListener("keydown", async (e) => {
  const row = e.target.closest(".tree-row.is-file");
  if (!row || !treeRootEl.contains(row)) return;
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  const rel = row.dataset.relPath;
  const entry = entries.find((x) => x.relPath === rel && x.kind === "file");
  if (!entry) return;
  setStatus(statusEl, "", false);
  await openFileInDiff(entry);
});

// ── Toolbar button listeners ──────────────────────────────────────────────

btnPickLeft.addEventListener("click", async (e) => {
  e.stopPropagation(); // prevent drop-zone click from also firing
  try {
    const picked = await pickFolder("left");
    if (picked) {
      clearDroppedFiles();
      leftRoot = picked;
      updatePathLabels();
      await refreshCompare();
    }
  } catch (err) {
    setStatus(statusEl, String(err), true);
  }
});

btnPickRight.addEventListener("click", async (e) => {
  e.stopPropagation();
  try {
    const picked = await pickFolder("right");
    if (picked) {
      clearDroppedFiles();
      rightRoot = picked;
      updatePathLabels();
      await refreshCompare();
    }
  } catch (err) {
    setStatus(statusEl, String(err), true);
  }
});

btnRefresh.addEventListener("click", () => refreshCompare());

btnSaveLeft.addEventListener("click", async () => {
  if (!selectedEntry || !leftRoot) return;
  const path = joinPath(leftRoot, selectedEntry.relPath);
  const contents = diffEditor.getOriginalEditor().getValue();
  try {
    await invoke("write_file", { path, contents });
    setStatus(statusEl, "Saved left.", false);
    await refreshCompare();
  } catch (err) {
    setStatus(statusEl, String(err), true);
  }
});

btnSaveRight.addEventListener("click", async () => {
  if (!selectedEntry || !rightRoot) return;
  const path = joinPath(rightRoot, selectedEntry.relPath);
  const contents = diffEditor.getModifiedEditor().getValue();
  try {
    await invoke("write_file", { path, contents });
    setStatus(statusEl, "Saved right.", false);
    await refreshCompare();
  } catch (err) {
    setStatus(statusEl, String(err), true);
  }
});

// ── Init ──────────────────────────────────────────────────────────────────

updatePathLabels();
setupDropTarget(dropLeftEl, "left", inputLeftFileEl);
setupDropTarget(dropRightEl, "right", inputRightFileEl);
