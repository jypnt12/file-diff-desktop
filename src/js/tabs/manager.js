import { statusEl, tabBarEl, tabPanelsEl } from "../dom.js";
import { addRecent } from "../features/recentsUi.js";
import { getDisplayTextsForPrefs, loadDiffPrefs, saveDiffPrefs } from "../storage/diffPrefs.js";
import { state } from "../state.js";
import { isTauri, readFile } from "../tauri/api.js";
import { escHtml, guessLanguageId, joinPath, setStatus } from "../utils.js";
import {
    disposeTabDiffHighlights,
    ensureFddDiffTheme,
    setupDiffLineHighlights,
} from "../monaco/diff.js";
import { saveTabSide } from "./save.js";

export function activateTab(id) {
    if (!state.tabMap.has(id)) return;
    state.activeTabId = id;

    for (const btn of tabBarEl.querySelectorAll(".tab")) {
        btn.classList.toggle("is-active", btn.dataset.tabId === id);
    }

    for (const [tid, panelEl] of state.tabPanels) {
        panelEl.classList.toggle("is-active", tid === id);
    }

    const data = state.tabMap.get(id);
    if (data && (data.type === "file" || data.type === "dropped") && !data.editorInitialized) {
        data.editorInitialized = true;
        initTabEditor(id).catch((err) => setStatus(statusEl, String(err), true));
    } else if (data?.editor) {
        requestAnimationFrame(() => data.editor.layout());
    }
}

export function closeTab(id) {
    if (id === "folder") return;
    const data = state.tabMap.get(id);
    disposeTabDiffHighlights(data);
    if (data?.editor) {
        data.origModel?.dispose();
        data.modModel?.dispose();
        data.editor.dispose();
    }
    state.tabMap.delete(id);
    tabBarEl.querySelector(`[data-tab-id="${CSS.escape(id)}"]`)?.remove();
    state.tabPanels.get(id)?.remove();
    state.tabPanels.delete(id);
    if (state.activeTabId === id) activateTab("folder");
}

export function closeAllFileTabs() {
    for (const id of [...state.tabMap.keys()]) {
        if (id !== "folder") closeTab(id);
    }
}

/** @param {import("../state.js").DiffEntry} entry */
export function openFileTab(entry) {
    const tabId = "file:" + entry.relPath;
    if (state.tabMap.has(tabId)) { activateTab(tabId); return; }

    const fileName = entry.relPath.split("/").pop();
    const leftFullPath = joinPath(state.leftRoot, entry.relPath);
    const rightFullPath = joinPath(state.rightRoot, entry.relPath);

    _createDiffTab(tabId, fileName, entry.status, (panel) => {
        const hdr = _makeFileTabHeader(
            `<span class="side-label side-left" style="margin-right:.35rem">L</span>${escHtml(leftFullPath)}`,
            `<span class="side-label side-right" style="margin-right:.35rem">R</span>${escHtml(rightFullPath)}`,
            leftFullPath, rightFullPath,
            tabId,
        );
        panel.appendChild(hdr);
    });

    state.tabMap.set(tabId, { type: "file", title: fileName, entry, editorInitialized: false });
    activateTab(tabId);
}

/** Open a diff tab for two dropped files. Optional `path` on each file enables recents + disk re-open. */
export function openDroppedTab(leftFile, rightFile) {
    const tabId = `dropped:${leftFile.name}↔${rightFile.name}`;
    if (state.tabMap.has(tabId)) { activateTab(tabId); return; }

    const title = leftFile.name === rightFile.name
        ? leftFile.name
        : `${leftFile.name} ↔ ${rightFile.name}`;

    _createDiffTab(tabId, title, null, (panel) => {
        const hdr = _makeFileTabHeader(
            `<span class="side-label side-left" style="margin-right:.35rem">L</span>${escHtml(leftFile.name)}`,
            `<span class="side-label side-right" style="margin-right:.35rem">R</span>${escHtml(rightFile.name)}`,
            leftFile.path ?? null, rightFile.path ?? null, tabId,
        );
        panel.appendChild(hdr);
    });

    state.tabMap.set(tabId, {
        type: "dropped", title,
        leftText: leftFile.text, rightText: rightFile.text,
        leftName: leftFile.name, rightName: rightFile.name,
        leftPath: leftFile.path ?? null, rightPath: rightFile.path ?? null,
        editorInitialized: false,
    });

    if (isTauri() && leftFile.path && rightFile.path) {
        addRecent({
            kind: "filePair",
            left: leftFile.path,
            right: rightFile.path,
            leftName: leftFile.name,
            rightName: rightFile.name,
            label: title,
            ts: Date.now(),
        });
    }

    activateTab(tabId);
}

/**
 * @param {string} tabId
 * @param {string} displayTitle
 * @param {string|null} _status
 * @param {(panel: HTMLElement) => void} buildHeader
 */
function _createDiffTab(tabId, displayTitle, _status, buildHeader) {
    const btn = document.createElement("button");
    btn.className = "tab";
    btn.dataset.tabId = tabId;

    const titleSpan = document.createElement("span");
    titleSpan.className = "tab-title";
    titleSpan.textContent = displayTitle;

    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close";
    closeBtn.textContent = "×";
    closeBtn.title = "Close tab";
    closeBtn.addEventListener("click", (e) => { e.stopPropagation(); closeTab(tabId); });

    btn.appendChild(titleSpan);
    btn.appendChild(closeBtn);
    tabBarEl.appendChild(btn);

    const panel = document.createElement("div");
    panel.className = "tab-panel";
    buildHeader(panel);

    const editorContainer = document.createElement("div");
    editorContainer.className = "file-editor-container";
    panel.appendChild(editorContainer);

    tabPanelsEl.appendChild(panel);
    state.tabPanels.set(tabId, panel);

    panel._editorContainer = editorContainer;
}

function _makeFileTabHeader(leftHtml, rightHtml, leftPath, rightPath, tabId) {
    const wrap = document.createElement("div");
    wrap.className = "file-tab-hdr-wrap";

    const hdr = document.createElement("div");
    hdr.className = "file-tab-hdr";

    const paths = document.createElement("div");
    paths.className = "file-tab-paths";
    paths.innerHTML =
        `<span class="file-tab-path" title="${escHtml(leftPath ?? "")}">${leftHtml}</span>` +
        `<span class="file-tab-path" title="${escHtml(rightPath ?? "")}">${rightHtml}</span>`;

    const actions = document.createElement("div");
    actions.className = "file-tab-actions";

    if (leftPath && rightPath) {
        const saveL = document.createElement("button");
        saveL.type = "button";
        saveL.className = "file-tab-save-l";
        saveL.textContent = "Save Left";
        saveL.addEventListener("click", async () => {
            const data = state.tabMap.get(tabId);
            if (!data?.editor) return;
            if (loadDiffPrefs().ignoreCase) {
                setStatus(statusEl, "Turn off “Ignore case” to save.", true);
                return;
            }
            try {
                await saveTabSide(tabId, "left");
                setStatus(statusEl, "Saved left.", false);
            } catch (err) { setStatus(statusEl, String(err), true); }
        });

        const saveR = document.createElement("button");
        saveR.type = "button";
        saveR.className = "file-tab-save-r";
        saveR.textContent = "Save Right";
        saveR.addEventListener("click", async () => {
            const data = state.tabMap.get(tabId);
            if (!data?.editor) return;
            if (loadDiffPrefs().ignoreCase) {
                setStatus(statusEl, "Turn off “Ignore case” to save.", true);
                return;
            }
            try {
                await saveTabSide(tabId, "right");
                setStatus(statusEl, "Saved right.", false);
            } catch (err) { setStatus(statusEl, String(err), true); }
        });

        actions.appendChild(saveL);
        actions.appendChild(saveR);
    }

    hdr.appendChild(paths);
    hdr.appendChild(actions);

    const sub = document.createElement("div");
    sub.className = "file-tab-sub";

    const opts = document.createElement("div");
    opts.className = "file-tab-diffopts";

    /** @param {"ignoreWhitespace"|"ignoreCase"|"ignoreLineEndings"} key @param {string} label */
    function mkCheck(key, label) {
        const lab = document.createElement("label");
        lab.className = "file-tab-check";
        const inp = document.createElement("input");
        inp.type = "checkbox";
        inp.dataset.diffPref = key;
        inp.addEventListener("change", () => {
            const p = loadDiffPrefs();
            p[key] = inp.checked;
            saveDiffPrefs(p);
            syncDiffPrefInputsFromStorage();
            for (const [tid, d] of state.tabMap) {
                if ((d.type === "file" || d.type === "dropped") && d.editor) rebuildTabDiffModels(tid);
            }
        });
        const span = document.createElement("span");
        span.textContent = label;
        lab.appendChild(inp);
        lab.appendChild(span);
        opts.appendChild(lab);
    }

    mkCheck("ignoreWhitespace", "Ignore whitespace");
    mkCheck("ignoreCase", "Ignore case");
    mkCheck("ignoreLineEndings", "Ignore line endings");

    const caseHint = document.createElement("span");
    caseHint.className = "file-tab-case-hint hidden";
    caseHint.textContent = "Case-insensitive diff — saving disabled while on.";

    const searchHint = document.createElement("span");
    searchHint.className = "file-tab-search-hint";
    const isMac = typeof navigator !== "undefined" &&
        (navigator.platform?.toLowerCase().includes("mac") || /Mac/i.test(navigator.userAgent || ""));
    searchHint.textContent = isMac ? "Tip: ⌘F to search" : "Tip: Ctrl+F to search";

    sub.appendChild(opts);
    sub.appendChild(caseHint);
    sub.appendChild(searchHint);

    wrap.appendChild(hdr);
    wrap.appendChild(sub);

    const prefs = loadDiffPrefs();
    for (const inp of wrap.querySelectorAll("input[data-diff-pref]")) {
        const k = /** @type {keyof ReturnType<typeof loadDiffPrefs>} */ (inp.dataset.diffPref);
        if (k in prefs) inp.checked = Boolean(prefs[k]);
    }

    return wrap;
}

export function syncDiffPrefInputsFromStorage() {
    const prefs = loadDiffPrefs();
    for (const inp of document.querySelectorAll("input[data-diff-pref]")) {
        const k = inp.dataset.diffPref;
        if (k && k in prefs) inp.checked = Boolean(prefs[/** @type {keyof typeof prefs} */ (k)]);
    }
}

export function updateCaseHintForTab(tabId) {
    const panel = state.tabPanels.get(tabId);
    const hint = panel?.querySelector(".file-tab-case-hint");
    if (hint) hint.classList.toggle("hidden", !loadDiffPrefs().ignoreCase);
}

/** Rebuild Monaco models from raw text + current diff prefs. */
export function rebuildTabDiffModels(tabId) {
    const data = state.tabMap.get(tabId);
    if (!data?.editor || data.rawLeftText === undefined || data.rawRightText === undefined) return;

    const prefs = loadDiffPrefs();
    const { left, right } = getDisplayTextsForPrefs(data.rawLeftText, data.rawRightText, prefs);
    const lang = data.diffLang || "plaintext";

    disposeTabDiffHighlights(data);

    const editor = data.editor;
    editor.setModel({ original: null, modified: null });
    data.origModel?.dispose();
    data.modModel?.dispose();

    const origModel = monaco.editor.createModel(left, lang);
    const modModel = monaco.editor.createModel(right, lang);
    if (prefs.ignoreLineEndings) {
        origModel.setEOL(monaco.editor.EndOfLineSequence.LF);
        modModel.setEOL(monaco.editor.EndOfLineSequence.LF);
    }

    data.origModel = origModel;
    data.modModel = modModel;
    editor.setModel({ original: origModel, modified: modModel });

    const readOnly = prefs.ignoreCase;
    editor.updateOptions({
        ignoreTrimWhitespace: prefs.ignoreWhitespace,
        readOnly,
        originalEditable: !readOnly,
        glyphMargin: true,
        renderMarginRevertIcon: true,
        renderGutterMenu: true,
        diffAlgorithm: "advanced",
    });

    setupDiffLineHighlights(tabId, editor);
    updateCaseHintForTab(tabId);
}

/** Lazily create a Monaco diff editor for a file or dropped tab. */
export async function initTabEditor(tabId) {
    const data = state.tabMap.get(tabId);
    if (!data) return;

    const panel = state.tabPanels.get(tabId);
    const editorEl = panel?._editorContainer ?? panel?.querySelector(".file-editor-container");
    if (!editorEl) return;

    let leftText = "", rightText = "", lang = "plaintext";

    if (data.type === "dropped") {
        leftText = data.leftText ?? "";
        rightText = data.rightText ?? "";
        lang = guessLanguageId(data.leftName || data.rightName || "");
    } else if (data.type === "file") {
        const { entry } = data;
        const leftPath = joinPath(state.leftRoot, entry.relPath);
        const rightPath = joinPath(state.rightRoot, entry.relPath);
        setStatus(statusEl, `Loading ${entry.relPath}…`, false);
        try {
            [leftText, rightText] = await Promise.all([
                entry.leftExists ? readFile(leftPath) : Promise.resolve(""),
                entry.rightExists ? readFile(rightPath) : Promise.resolve(""),
            ]);
        } catch (err) {
            setStatus(statusEl, String(err), true);
            return;
        }
        lang = guessLanguageId(entry.relPath);
    }

    ensureFddDiffTheme();

    data.rawLeftText = leftText;
    data.rawRightText = rightText;
    data.diffLang = lang;

    const prefs = loadDiffPrefs();
    const { left, right } = getDisplayTextsForPrefs(leftText, rightText, prefs);

    const editor = monaco.editor.createDiffEditor(editorEl, {
        originalEditable: !prefs.ignoreCase,
        readOnly: prefs.ignoreCase,
        renderSideBySide: true,
        automaticLayout: true,
        theme: "fdd-dark",
        ignoreTrimWhitespace: prefs.ignoreWhitespace,
        glyphMargin: true,
        renderMarginRevertIcon: true,
        renderGutterMenu: true,
        diffAlgorithm: "advanced",
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
    });

    const origModel = monaco.editor.createModel(left, lang);
    const modModel = monaco.editor.createModel(right, lang);
    if (prefs.ignoreLineEndings) {
        origModel.setEOL(monaco.editor.EndOfLineSequence.LF);
        modModel.setEOL(monaco.editor.EndOfLineSequence.LF);
    }
    editor.setModel({ original: origModel, modified: modModel });

    data.editor = editor;
    data.origModel = origModel;
    data.modModel = modModel;

    setupDiffLineHighlights(tabId, editor);
    updateCaseHintForTab(tabId);
    setStatus(statusEl, "", false);
}
