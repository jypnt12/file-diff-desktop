import {
    dropLeftEl,
    dropRightEl,
    fcBodyEl,
    fcEmptyEl,
    fcTableEl,
    halfDropLeftEl,
    halfDropRightEl,
    pathLeftEl,
    pathRightEl,
    statusEl,
} from "../dom.js";
import { addRecent, renderFcRecents } from "./recentsUi.js";
import { openDroppedTab, openFileTab } from "../tabs/manager.js";
import { state } from "../state.js";
import {
    compareFolders,
    isTauri,
    listFolder,
    pickFolderRaw,
    pickFileRaw,
    readFile,
} from "../tauri/api.js";
import {
    createTrieRoot,
    formatDate,
    formatSize,
    insertTrie,
    setBusy,
    setStatus,
    shortPath,
} from "../utils.js";

/** @param {"left" | "right"} side @returns {"empty" | "folder" | "file"} */
export function getSideState(side) {
    const root = side === "left" ? state.leftRoot : state.rightRoot;
    if (root) return "folder";
    if (state.droppedFiles[side]) return "file";
    return "empty";
}

export function pathBarTextForSide(side) {
    if (side === "left") {
        if (state.leftRoot) return shortPath(state.leftRoot);
        if (state.droppedFiles.left?.path) return shortPath(state.droppedFiles.left.path);
        if (state.droppedFiles.left?.name) return state.droppedFiles.left.name;
        return "";
    }
    if (state.rightRoot) return shortPath(state.rightRoot);
    if (state.droppedFiles.right?.path) return shortPath(state.droppedFiles.right.path);
    if (state.droppedFiles.right?.name) return state.droppedFiles.right.name;
    return "";
}

export function pathBarTitleForSide(side) {
    if (side === "left") return state.leftRoot ?? state.droppedFiles.left?.path ?? "";
    return state.rightRoot ?? state.droppedFiles.right?.path ?? "";
}

/** @param {HTMLElement} zoneEl @param {"left" | "right"} side */
export function syncDropZoneForSide(zoneEl, side) {
    const sideState = getSideState(side);
    const pri = zoneEl.querySelector(".drop-zone-primary");
    const sec = zoneEl.querySelector(".drop-zone-secondary");
    
    zoneEl.classList.remove("has-file", "has-folder");
    if (sideState === "folder") {
        zoneEl.classList.add("has-folder");
        const root = side === "left" ? state.leftRoot : state.rightRoot;
        if (pri) pri.textContent = root ? shortPath(root) : "";
        if (sec) sec.textContent = "Folder — drop to replace";
    } else if (sideState === "file") {
        zoneEl.classList.add("has-file");
        const df = state.droppedFiles[side];
        if (pri) pri.textContent = df?.name ?? "";
        if (sec) sec.textContent = "File — drop to replace";
    } else {
        if (pri) pri.textContent = "Drag & drop a file or folder";
        if (sec) sec.textContent = "or click to browse";
    }
}

export function updateFcFileDiffHintVisibility() {
    const hint = document.getElementById("fc-file-diff-hint");
    if (!hint) return;
    const tableOn = fcTableEl && !fcTableEl.classList.contains("hidden");
    hint.classList.toggle("hidden", !(tableOn && state.leftRoot && state.rightRoot));
}

export function updatePathLabels() {
    pathLeftEl.textContent = pathBarTextForSide("left");
    pathRightEl.textContent = pathBarTextForSide("right");
    pathLeftEl.title = pathBarTitleForSide("left");
    pathRightEl.title = pathBarTitleForSide("right");

    const showFolderTable =
        getSideState("left") !== "file" &&
        getSideState("right") !== "file" &&
        Boolean(state.leftRoot || state.rightRoot);
    fcEmptyEl.classList.toggle("hidden", showFolderTable);
    fcTableEl.classList.toggle("hidden", !showFolderTable);

    const showLeftHalf = showFolderTable && getSideState("left") === "empty";
    const showRightHalf = showFolderTable && getSideState("right") === "empty";
    halfDropLeftEl?.classList.toggle("hidden", !showLeftHalf);
    halfDropRightEl?.classList.toggle("hidden", !showRightHalf);
    if (halfDropLeftEl) syncDropZoneForSide(halfDropLeftEl, "left");
    if (halfDropRightEl) syncDropZoneForSide(halfDropRightEl, "right");

    syncDropZoneForSide(dropLeftEl, "left");
    syncDropZoneForSide(dropRightEl, "right");

    renderFcRecents();
    updateFcFileDiffHintVisibility();
}

export async function pickFolder(side) {
    setBusy(true);
    setStatus(statusEl, `Opening ${side} folder picker…`, false);
    try {
        const timeout = new Promise((_, rej) =>
            setTimeout(() => rej(new Error("Folder picker timed out.")), 120_000),
        );
        const picked = await Promise.race([pickFolderRaw(), timeout]);
        setStatus(statusEl, "", false);
        return picked;
    } finally {
        setBusy(false);
    }
}

/** @returns {Promise<string|null|undefined>} */
export async function pickFilePath(statusMsg) {
    setBusy(true);
    setStatus(statusEl, statusMsg, false);
    try {
        const timeout = new Promise((_, rej) =>
            setTimeout(() => rej(new Error("File picker timed out.")), 120_000),
        );
        const picked = await Promise.race([pickFileRaw(), timeout]);
        setStatus(statusEl, "", false);
        return picked;
    } finally {
        setBusy(false);
    }
}

export async function compareTwoFilesFromToolbar() {
    if (!isTauri()) {
        setStatus(statusEl, "Compare two files requires the desktop app (Tauri).", true);
        return;
    }
    try {
        const leftPath = await pickFilePath("Select left file…");
        if (!leftPath) return;
        const rightPath = await pickFilePath("Select right file…");
        if (!rightPath) return;
        setBusy(true);
        setStatus(statusEl, "Loading files…", false);
        const [lt, rt] = await Promise.all([
            readFile(leftPath),
            readFile(rightPath),
        ]);
        const ln = String(leftPath).replace(/\\/g, "/").split("/").pop() || leftPath;
        const rn = String(rightPath).replace(/\\/g, "/").split("/").pop() || rightPath;
        openDroppedTab(
            { name: ln, text: lt, path: leftPath },
            { name: rn, text: rt, path: rightPath },
        );
        setStatus(statusEl, "Opened file compare.", false);
    } catch (err) {
        setStatus(statusEl, String(err), true);
    } finally {
        setBusy(false);
    }
}

export function recordRecentAfterCompare() {
    const ts = Date.now();
    if (state.leftRoot && state.rightRoot) {
        addRecent({
            kind: "folderPair",
            left: state.leftRoot,
            right: state.rightRoot,
            label: `${shortPath(state.leftRoot)} ↔ ${shortPath(state.rightRoot)}`,
            ts,
        });
    } else if (state.leftRoot) {
        addRecent({
            kind: "folder",
            side: "left",
            path: state.leftRoot,
            label: `Folder: ${shortPath(state.leftRoot)}`,
            ts,
        });
    } else if (state.rightRoot) {
        addRecent({
            kind: "folder",
            side: "right",
            path: state.rightRoot,
            label: `Folder: ${shortPath(state.rightRoot)}`,
            ts,
        });
    }
}

export async function refreshCompare() {
    setStatus(statusEl, "", false);
    if (state.leftRoot) state.droppedFiles.left = null;
    if (state.rightRoot) state.droppedFiles.right = null;
    if (state.leftRoot || state.rightRoot) updatePathLabels();
    if (!state.leftRoot && !state.rightRoot) {
        state.entries = [];
        renderFolderCompare();
        updateFcFileDiffHintVisibility();
        return;
    }
    try {
        setBusy(true);
        setStatus(statusEl, state.leftRoot && state.rightRoot ? "Comparing folders…" : "Loading folder…", false);
        await new Promise((r) => requestAnimationFrame(r));
        const timeout = new Promise((_, rej) =>
            setTimeout(() => rej(new Error("Compare timed out — try a smaller folder.")), 90_000),
        );
        const loadEntries = state.leftRoot && state.rightRoot
            ? compareFolders(state.leftRoot, state.rightRoot)
            : listFolder(state.leftRoot ?? state.rightRoot, state.leftRoot ? "left" : "right");
        state.entries = await Promise.race([loadEntries, timeout]);
        renderFolderCompare();
        setStatus(statusEl, state.leftRoot && state.rightRoot
            ? `${state.entries.length} items compared.`
            : `${state.entries.length} items loaded.`, false);
        recordRecentAfterCompare();
        updateFcFileDiffHintVisibility();
    } catch (err) {
        setStatus(statusEl, String(err), true);
    } finally {
        setBusy(false);
        updateFcFileDiffHintVisibility();
    }
}

export function renderFolderCompare() {
    const header = fcBodyEl.querySelector(".fc-col-header");
    fcBodyEl.replaceChildren();
    if (header) fcBodyEl.appendChild(header);
    if (!state.entries.length) return;

    const trie = createTrieRoot();
    for (const e of state.entries) insertTrie(trie, e);
    renderFcLevel(trie, fcBodyEl, 0);
}

/** @param {{ children: Map<string,any> }} node */
function renderFcLevel(node, parentEl, depth) {
    const sorted = [...node.children.entries()].sort(([an, ac], [bn, bc]) => {
        const aIsDir = ac.entry?.kind === "dir";
        const bIsDir = bc.entry?.kind === "dir";
        if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
        return an.localeCompare(bn, undefined, { sensitivity: "base" });
    });

    for (const [name, child] of sorted) {
        if (!child.entry) { renderFcLevel(child, parentEl, depth); continue; }
        const isDir = child.entry.kind === "dir";
        const collapsed = isDir && state.collapsedDirs.has(child.entry.relPath);
        parentEl.appendChild(createFcRow(child.entry, name, depth, collapsed));
        if (child.children.size > 0 && !collapsed) {
            renderFcLevel(child, parentEl, depth + 1);
        }
    }
}

/**
 * @param {import("../state.js").DiffEntry} entry
 * @param {string} displayName
 * @param {number} depth
 * @param {boolean} collapsed
 */
function createFcRow(entry, displayName, depth, collapsed) {
    const isDir = entry.kind === "dir";
    const indent = depth * 16;

    const row = document.createElement("div");
    row.className = `fc-row fc-row--${entry.status} fc-row--${entry.kind}`;
    row.dataset.relPath = entry.relPath;
    row.dataset.kind = entry.kind;

    function makeSide(exists, size, modMs) {
        const side = document.createElement("div");
        side.className = "fc-side";

        const nameCell = document.createElement("div");
        nameCell.className = "fc-cell-name";

        if (indent > 0) {
            const sp = document.createElement("span");
            sp.className = "fc-indent";
            sp.style.width = `${indent}px`;
            nameCell.appendChild(sp);
        }

        if (isDir) {
            const tog = document.createElement("span");
            tog.className = "fc-dir-toggle";
            tog.textContent = collapsed ? "▸ " : "▾ ";
            nameCell.appendChild(tog);
        }

        if (exists) {
            const txt = document.createElement("span");
            txt.className = "fc-name-text";
            txt.textContent = displayName + (isDir ? "/" : "");
            nameCell.appendChild(txt);
        }

        side.appendChild(nameCell);

        const sizeCell = document.createElement("div");
        sizeCell.className = "fc-cell-size";
        sizeCell.textContent = (exists && !isDir && size != null) ? formatSize(size) : "";
        side.appendChild(sizeCell);

        const dateCell = document.createElement("div");
        dateCell.className = "fc-cell-date";
        dateCell.textContent = (exists && modMs) ? formatDate(modMs) : "";
        side.appendChild(dateCell);

        return side;
    }

    row.appendChild(makeSide(entry.leftExists, entry.leftSize, entry.leftModifiedMs));

    const gutter = document.createElement("div");
    gutter.className = "fc-gutter";
    const sym = { modified: "≠", onlyLeft: "◁", onlyRight: "▷" }[entry.status];
    if (sym) {
        const s = document.createElement("span");
        s.className = "fc-status-sym";
        s.textContent = sym;
        gutter.appendChild(s);
    }
    row.appendChild(gutter);

    row.appendChild(makeSide(entry.rightExists, entry.rightSize, entry.rightModifiedMs));

    return row;
}
