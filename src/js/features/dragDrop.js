import {
    dropLeftEl,
    dropRightEl,
    fcEmptyEl,
    halfDropLeftEl,
    halfDropRightEl,
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

const DRAG_DROP_DEBUG_PREFIX = "[dragDrop]";
let lastNativeDropSide = null;

function debugDragDrop(message, details) {
    if (details === undefined) {
        console.log(DRAG_DROP_DEBUG_PREFIX, message);
        return;
    }
    console.log(DRAG_DROP_DEBUG_PREFIX, message, details);
}

function handleDragDropError(context, err) {
    console.error(DRAG_DROP_DEBUG_PREFIX, context, err);
    const message = err instanceof Error ? err.message : String(err);
    setStatus(statusEl, `${context}: ${message}`, true);
}

function getTauriNativeDragDropApis() {
    const tauri = window.__TAURI__;
    const webview = tauri?.webview?.getCurrentWebview?.();
    const win = tauri?.window?.getCurrentWindow?.();

    if (!webview?.onDragDropEvent) {
        throw new Error("Tauri webview drag/drop API is unavailable.");
    }
    if (!win?.scaleFactor) {
        throw new Error("Tauri window API is unavailable.");
    }

    return { webview, win };
}

export async function handleDocumentSelection(side, file) {
    if (!file) return;
    debugDragDrop("handleDocumentSelection", {
        side,
        name: file.name,
        size: file.size,
        type: file.type,
    });
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
        handleDragDropError("Unable to read dropped file", err);
    }
}

/** Set left/right compare root or staged dropped file from an absolute filesystem path (Tauri). */
export async function applyCompareSideFromFsPath(side, fsPath) {
    debugDragDrop("applyCompareSideFromFsPath", { side, fsPath });
    try {
        const isDir = await pathIsDirectory(fsPath);
        if (isDir) {
            state.droppedFiles[side] = null;
            if (side === "left") state.leftRoot = fsPath;
            else state.rightRoot = fsPath;
            updatePathLabels();
            await refreshCompare();
            setStatus(statusEl, `${side === "left" ? "Left" : "Right"} folder set.`, false);
        } else {
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
        }
    } catch (err) {
        handleDragDropError("Unable to apply dropped path", err);
    } finally {
        debugDragDrop("state after apply", {
            side,
            leftRoot: state.leftRoot,
            rightRoot: state.rightRoot,
            droppedLeft: Boolean(state.droppedFiles.left),
            droppedRight: Boolean(state.droppedFiles.right),
        });
    }
}

/** @returns {Promise<{ lx: number, ly: number }>} */
export async function dragPositionToLogical(win, position) {
    const rawX =
        typeof position?.x === "number"
            ? position.x
            : position?.Physical?.x ?? 0;
    const rawY =
        typeof position?.y === "number"
            ? position.y
            : position?.Physical?.y ?? 0;

    // wry/macOS WKWebView passes Cocoa points in the same space as elementFromPoint /
    // getBoundingClientRect. Tauri types them as PhysicalPosition; dividing by scaleFactor
    // again shrinks coordinates toward the top-left and makes almost every drop resolve as "left".
    // Windows WebView2 uses ScreenToClient physical pixels — convert to logical CSS pixels.
    const isWindows =
        typeof navigator !== "undefined" &&
        /\bWindows\b/i.test(navigator.userAgent || "");
    if (isWindows) {
        const sf = await win.scaleFactor();
        return { lx: rawX / sf, ly: rawY / sf };
    }
    return { lx: rawX, ly: rawY };
}

/** @param {number} lx @param {number} ly @returns {"left" | "right" | null} */
export function resolveDropSide(lx, ly) {
    const hit = document.elementFromPoint(lx, ly);
    if (hit) {
        const half = hit.closest?.(".fc-half-drop");
        if (half?.dataset.side === "left" || half?.dataset.side === "right") {
            return /** @type {"left" | "right"} */ (half.dataset.side);
        }
        const zone = hit.closest?.(".drop-zone");
        if (zone?.dataset.side === "left" || zone?.dataset.side === "right") {
            return /** @type {"left" | "right"} */ (zone.dataset.side);
        }
        const pathSideEl = hit.closest?.(".fc-pathbar-side");
        const ps = pathSideEl?.dataset.side;
        if (ps === "left" || ps === "right") return ps;

        if (!panelFolderEl?.contains(hit)) {
            return resolveDropSideByHorizontalPosition(lx, ly);
        }
    }

    return resolveDropSideByHorizontalPosition(lx, ly);
}

/** @param {number} lx @param {number} ly @returns {"left" | "right" | null} */
function resolveDropSideByHorizontalPosition(lx, ly) {
    /** @param {HTMLElement | null} el */
    const matchHalf = (el) => {
        if (!el || el.classList.contains("hidden")) return false;
        const r = el.getBoundingClientRect();
        if (lx < r.left || lx > r.right) return false;
        if (ly >= r.top && ly <= r.bottom) return true;
        // Native drag sometimes reports Y above the webview; trust X over the overlay.
        if (!Number.isFinite(ly) || ly < r.top) return true;
        return false;
    };
    if (matchHalf(halfDropLeftEl)) return "left";
    if (matchHalf(halfDropRightEl)) return "right";

    const leftRect = dropLeftEl?.getBoundingClientRect();
    const rightRect = dropRightEl?.getBoundingClientRect();

    if (leftRect && lx >= leftRect.left && lx <= leftRect.right) return "left";
    if (rightRect && lx >= rightRect.left && lx <= rightRect.right) return "right";

    if (!panelFolderEl) return null;
    const rect = panelFolderEl.getBoundingClientRect();
    if (lx < rect.left || lx > rect.right) return null;

    const midX = rect.left + rect.width / 2;
    return lx < midX ? "left" : "right";
}

export function clearNativeDragHighlight() {
    panelFolderEl?.classList.remove("is-drop-target-left", "is-drop-target-right");
    panelFolderEl?.querySelector('.fc-pathbar-side[data-side="left"]')?.classList.remove("is-drop-target");
    panelFolderEl?.querySelector('.fc-pathbar-side[data-side="right"]')?.classList.remove("is-drop-target");
    dropLeftEl?.classList.remove("is-drop-target");
    dropRightEl?.classList.remove("is-drop-target");
    halfDropLeftEl?.classList.remove("is-drop-target");
    halfDropRightEl?.classList.remove("is-drop-target");
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
    const half = side === "left" ? halfDropLeftEl : halfDropRightEl;
    if (half && !half.classList.contains("hidden")) {
        half.classList.add("is-drop-target");
    }
}

export async function initTauriNativeDragDrop() {
    if (!isTauri()) return;
    try {
        const { webview, win } = getTauriNativeDragDropApis();
        debugDragDrop("Native drag/drop listener registered");
        await webview.onDragDropEvent(async (event) => {
            try {
                const { type } = event.payload;
                debugDragDrop("Native drag/drop event", event.payload);

                if (type === "leave") {
                    lastNativeDropSide = null;
                    clearNativeDragHighlight();
                    return;
                }

                if (type === "enter" || type === "over") {
                    const position = event.payload.position;
                    if (!position) return;
                    const { lx, ly } = await dragPositionToLogical(win, position);
                    const dropSide = resolveDropSide(lx, ly);
                    lastNativeDropSide = dropSide;
                    setNativeDragHighlight(dropSide);
                    return;
                }

                if (type !== "drop") return;

                const { paths, position } = event.payload;
                if (!paths?.length) {
                    clearNativeDragHighlight();
                    return;
                }

                let dropSide = lastNativeDropSide;
                if (position) {
                    const { lx, ly } = await dragPositionToLogical(win, position);
                    dropSide = resolveDropSide(lx, ly) ?? dropSide;
                }

                if (!dropSide) {
                    debugDragDrop("Drop ignored because no side was resolved", { paths, position });
                    clearNativeDragHighlight();
                    return;
                }

                const fsPath = paths[0];
                if (!fsPath) {
                    clearNativeDragHighlight();
                    return;
                }

                clearNativeDragHighlight();
                lastNativeDropSide = null;
                await applyCompareSideFromFsPath(dropSide, fsPath);
            } catch (err) {
                clearNativeDragHighlight();
                lastNativeDropSide = null;
                handleDragDropError("Native drag/drop failed", err);
            }
        });
    } catch (err) {
        handleDragDropError("Native drag/drop unavailable", err);
    }
}

export function setupDropZone(zoneEl, side, inputEl) {
    debugDragDrop("setupDropZone called", { zoneEl, side, inputEl });
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
            handleDragDropError("Folder picker failed", err);
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
        debugDragDrop("Browser drop event", { side, fileCount: e.dataTransfer?.files?.length ?? 0 });
        if (file) await handleDocumentSelection(side, file);
    });
    inputEl.addEventListener("change", async () => {
        const file = inputEl.files?.[0];
        inputEl.value = "";
        if (file) await handleDocumentSelection(side, file);
    });
}
