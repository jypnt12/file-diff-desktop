import {
  btnCompareFiles,
  btnHome,
  btnPickLeft,
  btnPickRight,
  btnRefresh,
} from "./dom.js";

export function joinPath(root, relPath) {
  if (!root) return "";
  const r = root.replace(/\\/g, "/").replace(/\/$/, "");
  const p = (relPath || "").replace(/^\//, "");
  return p ? `${r}/${p}` : r;
}

export function guessLanguageId(relPath) {
  const ext = relPath.toLowerCase().match(/\.[^./\\]+$/)?.[0] ?? "";
  return ({
    ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
    ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "javascript",
    ".json": "json", ".css": "css", ".scss": "scss", ".less": "less",
    ".html": "html", ".htm": "html", ".md": "markdown",
    ".rs": "rust", ".toml": "ini", ".yaml": "yaml", ".yml": "yaml",
    ".xml": "xml", ".sql": "sql", ".py": "python", ".go": "go",
    ".java": "java", ".c": "c", ".h": "c", ".cpp": "cpp", ".hpp": "cpp",
    ".cs": "csharp", ".rb": "ruby", ".php": "php", ".sh": "shell", ".bash": "shell", ".zsh": "shell",
  })[ext] ?? "plaintext";
}

export function formatSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function formatDate(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const mo = d.getMonth() + 1;
  const dy = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${mo}/${dy} ${hh}:${mm}`;
}

export function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function shortPath(p) {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/");
  const tail = parts.slice(-3).join("/");
  return tail.length < p.length ? "…/" + tail : p;
}

/**
 * @param {import("monaco-editor").editor.ITextModel | null} model @param {number} start @param {number} end */
export function sliceLinesText(model, start, end) {
  if (!model || start < 1 || end < start) return "";
  const out = [];
  for (let ln = start; ln <= end; ln++) {
    if (ln > model.getLineCount()) break;
    out.push(model.getLineContent(ln));
  }
  return out.join("\n");
}

export function createTrieRoot() {
  return { children: new Map() };
}

/** @param {ReturnType<typeof createTrieRoot>} root @param {{ relPath: string }} entry */
export function insertTrie(root, entry) {
  const parts = entry.relPath.split("/").filter(Boolean);
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (!cur.children.has(seg)) {
      cur.children.set(seg, { name: seg, children: new Map(), entry: null });
    }
    cur = cur.children.get(seg);
    if (i === parts.length - 1) cur.entry = entry;
  }
}

export async function waitForMonaco() {
  while (!window.monaco) {
    await new Promise((r) => setTimeout(r, 30));
  }
}

/** @param {HTMLElement} el @param {string} text @param {boolean} [isError] */
export function setStatus(el, text, isError) {
  el.textContent = text || "";
  el.classList.toggle("is-error", Boolean(isError && text));
}

/** @param {boolean} busy */
export function setBusy(busy) {
  btnPickLeft.disabled = busy;
  btnPickRight.disabled = busy;
  btnRefresh.disabled = busy;
  if (btnHome) btnHome.disabled = busy;
  if (btnCompareFiles) btnCompareFiles.disabled = busy;
}
