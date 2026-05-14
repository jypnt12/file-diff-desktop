import {
    dropLeftEl,
    dropRightEl,
    fcEmptyEl,
    panelFolderEl,
    statusEl,
} from "../dom.js";
import {
    getSideState,
    pickFolder,
    refreshCompare,
    updatePathLabels,
} from "./folderCompare.js";
import { openDroppedTab } from "../tabs/manager.js";
import { state } from "../state.js";
import { isTauri, pathIsDirectory, readFile } from "../tauri/api.js";
import { setStatus } from "../utils.js";

export async function handleDocumentSelection(side, file) {
    if (!file) return;
    try {
        const text = await file.text();
        state.droppedFiles[side] = { name: file.name, text };
        if (side === "left") state.leftRoot = null;
        else state.rightRoot = null;

        setStatus(statusEl, `Loaded ${side}: ${file.name}`, false);

        if (state.droppedFiles.left && state.droppedFiles.right) {
            openDroppedTab(state.droppedFiles.left, state.droppedFiles.right);
            state.droppedFiles.left = null;
            state.droppedFiles.right = null;
        }
        updatePathLabels();
    } catch (err) {
        setStatus(statusEl, `Unable to read file: ${String(err)}`, true);
    }
}

/** Set left/right compare root or staged dropped file from an absolute filesystem path (Tauri). */
export async function applyCompareSideFromFsPath(side, fsPath) {
    const isDir = await pathIsDirectory(fsPath);
    if (isDir) {
        state.droppedFiles[side] = null;
        if (side === "left") state.leftRoot = fsPath;
        else state.rightRoot = fsPath;
        updatePathLabels();
        await refreshCompare();
        setStatus(statusEl, `${side === "left" ? "Left" : "Right"} folder set.`, false);
        return;
    }

    try {
        const text = await readFile(fsPath);
        const name = fsPath.replace(/\\/g, "/").split("/").pop() || fsPath;
        state.droppedFiles[side] = { name, text, path: fsPath };
        if (side === "left") state.leftRoot = null;
        else state.rightRoot = null;

        setStatus(statusEl, `Loaded ${side}: ${name}`, false);
        updatePathLabels();

        if (getSideState("left") === "file" && getSideState("right") === "file") {
            openDroppedTab(state.droppedFiles.left, state.droppedFiles.right);
            state.droppedFiles.left = null;
            state.droppedFiles.right = null;
            updatePathLabels();
        }
    } catch (err) {
        setStatus(statusEl, String(err), true);
    }
}

/** @returns {Promise<{ lx: number, ly: number }>} */
export async function dragPositionToLogical(win, position) {
    const sf = await win.scaleFactor();
    if (position && typeof position.toLogical === "function") {
        const logical = position.toLogical(sf);
        return { lx: logical.x, ly: logical.y };
    }
    const px =
        typeof position?.x === "number"
            ? position.x
            : position?.Physical?.x ?? 0;
    const py =
        typeof position?.y === "number"
            ? position.y
            : position?.Physical?.y ?? 0;
    return { lx: px / sf, ly: py / sf };
}

/** @param {number} lx @param {number} ly @returns {"left" | "right" | null} */
export function resolveDropSide(lx, ly) {
    const hit = document.elementFromPoint(lx, ly);
    if (!hit) return null;
    const zone = hit.closest?.(".drop-zone");
    if (zone?.dataset.side === "left" || zone?.dataset.side === "right") {
        return /** @type {"left" | "right"} */ (zone.dataset.side);
    }
    const pathSideEl = hit.closest?.(".fc-pathbar-side");
    const ps = pathSideEl?.dataset.side;
    if (ps === "left" || ps === "right") return ps;

    if (!panelFolderEl?.contains(hit)) return null;
    const rect = panelFolderEl.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    return lx < midX ? "left" : "right";
}

export function clearNativeDragHighlight() {
    panelFolderEl?.classList.remove("is-drop-target-left", "is-drop-target-right");
    panelFolderEl?.querySelector('.fc-pathbar-side[data-side="left"]')?.classList.remove("is-drop-target");
    panelFolderEl?.querySelector('.fc-pathbar-side[data-side="right"]')?.classList.remove("is-drop-target");
    dropLeftEl?.classList.remove("is-drop-target");
    dropRightEl?.classList.remove("is-drop-target");
}

/** @param {"left" | "right" | null} side */
export function setNativeDragHighlight(side) {
    clearNativeDragHighlight();
    if (!side || !panelFolderEl) return;
    panelFolderEl.classList.add(side === "left" ? "is-drop-target-left" : "is-drop-target-right");
    panelFolderEl.querySelector(`.fc-pathbar-side[data-side="${side}"]`)?.classList.add("is-drop-target");
    if (fcEmptyEl && !fcEmptyEl.classList.contains("hidden")) {
        (side === "left" ? dropLeftEl : dropRightEl)?.classList.add("is-drop-target");
    }
}

export async function initTauriNativeDragDrop() {
    if (!isTauri()) return;
    try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const webview = getCurrentWebview();
        const win = getCurrentWindow();
        await webview.onDragDropEvent(async (event) => {
            const { type } = event.payload;

            if (type === "leave") {
                clearNativeDragHighlight();
                return;
            }

            if (type === "enter" || type === "over") {
                const position = event.payload.position;
                if (!position) return;
                const { lx, ly } = await dragPositionToLogical(win, position);
                const dropSide = resolveDropSide(lx, ly);
                setNativeDragHighlight(dropSide);
                return;
            }

            if (type !== "drop") return;

            const { paths, position } = event.payload;
            if (!paths?.length) return;

            const { lx, ly } = await dragPositionToLogical(win, position);

            const dropSide = resolveDropSide(lx, ly);
            if (!dropSide) {
                clearNativeDragHighlight();
                return;
            }

            const fsPath = paths[0];
            if (!fsPath) {
                clearNativeDragHighlight();
                return;
            }

            clearNativeDragHighlight();
            try {
                await applyCompareSideFromFsPath(dropSide, fsPath);
            } catch (err) {
                setStatus(statusEl, String(err), true);
            }
        });
    } catch {
        /* Native drag-drop unavailable */
    }
}

export function setupDropZone(zoneEl, side, inputEl) {
    zoneEl.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isTauri()) {
            inputEl.click();
            return;
        }
        try {
            const picked = await pickFolder(side === "left" ? "left" : "right");
            if (picked) await applyCompareSideFromFsPath(side, picked);
        } catch (err) {
            setStatus(statusEl, String(err), true);
        }
    });

    zoneEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            zoneEl.click();
        }
    });

    if (isTauri()) return;

    zoneEl.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        zoneEl.classList.add("is-dropping");
    });
    zoneEl.addEventListener("dragleave", (e) => {
        if (!zoneEl.contains(e.relatedTarget)) zoneEl.classList.remove("is-dropping");
    });
    zoneEl.addEventListener("drop", async (e) => {
        e.preventDefault();
        zoneEl.classList.remove("is-dropping");
        const file = e.dataTransfer?.files?.[0];
        if (file) await handleDocumentSelection(side, file);
    });
    inputEl.addEventListener("change", async () => {
        const file = inputEl.files?.[0];
        inputEl.value = "";
        if (file) await handleDocumentSelection(side, file);
    });
}
