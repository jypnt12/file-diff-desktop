import { getDisplayTextsForPrefs, loadDiffPrefs } from "../storage/diffPrefs.js";
import { state } from "../state.js";
import { sliceLinesText } from "../utils.js";

export function ensureFddDiffTheme() {
    monaco.editor.defineTheme("fdd-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [],
        colors: {
            "diffEditor.insertedLineBackground": "#00000000",
            "diffEditor.removedLineBackground": "#00000000",
            "diffEditor.insertedTextBackground": "#00000000",
            "diffEditor.removedTextBackground": "#00000000",
            "editorGlyphMargin.foreground": "#d4b830",
        },
    });
}

/**
 * @param {import("monaco-editor").editor.ITextModel} model
 * @param {number} startLine
 * @param {number} endLine
 */
function replaceRangeForLineChange(model, startLine, endLine) {
    const lc = model.getLineCount();
    if (endLine >= startLine && startLine >= 1) {
        const end = Math.min(endLine, lc);
        const start = Math.min(startLine, end);
        return new monaco.Range(start, 1, end, model.getLineMaxColumn(end));
    }
    const ins = Math.min(Math.max(1, startLine), lc + 1);
    if (ins > lc) {
        const last = Math.max(1, lc);
        const col = model.getLineMaxColumn(last);
        return new monaco.Range(last, col, last, col);
    }
    return new monaco.Range(ins, 1, ins, 1);
}

/**
 * @param {import("monaco-editor").editor.ITextModel} model
 * @param {import("monaco-editor").editor.ILineChange} c
 * @param {"original"|"modified"} which
 */
function textForChangeSide(model, c, which) {
    const start = which === "original" ? c.originalStartLineNumber : c.modifiedStartLineNumber;
    const end = which === "original" ? c.originalEndLineNumber : c.modifiedEndLineNumber;
    if (end < start || start < 1) return "";
    const lc = model.getLineCount();
    if (start > lc) return "";
    const endClamped = Math.min(end, lc);
    return model.getValueInRange(
        new monaco.Range(start, 1, endClamped, model.getLineMaxColumn(endClamped)),
    );
}

/**
 * @param {import("monaco-editor").editor.IStandaloneDiffEditor} diffEditor
 * @param {import("monaco-editor").editor.ILineChange} change
 */
function copyChangeFromOriginalToModified(diffEditor, change) {
    const mod = diffEditor.getModifiedEditor();
    if (mod.getOption(monaco.editor.EditorOption.readOnly)) return;
    const origModel = diffEditor.getOriginalEditor().getModel();
    const modModel = mod.getModel();
    if (!origModel || !modModel) return;

    const origText = textForChangeSide(origModel, change, "original");
    const range = replaceRangeForLineChange(modModel, change.modifiedStartLineNumber, change.modifiedEndLineNumber);
    mod.executeEdits("fdd-copy-left-to-right", [{ range, text: origText, forceMoveMarkers: true }]);
}

/**
 * @param {import("monaco-editor").editor.IStandaloneDiffEditor} diffEditor
 * @param {import("monaco-editor").editor.ILineChange} change
 */
function copyChangeFromModifiedToOriginal(diffEditor, change) {
    const orig = diffEditor.getOriginalEditor();
    if (orig.getOption(monaco.editor.EditorOption.readOnly)) return;
    const origModel = orig.getModel();
    const modModel = diffEditor.getModifiedEditor().getModel();
    if (!origModel || !modModel) return;

    const modText = textForChangeSide(modModel, change, "modified");
    const range = replaceRangeForLineChange(origModel, change.originalStartLineNumber, change.originalEndLineNumber);
    orig.executeEdits("fdd-copy-right-to-left", [{ range, text: modText, forceMoveMarkers: true }]);
}

/**
 * @param {import("monaco-editor").editor.ILineChange[]|null} changes
 * @param {number} lineNumber
 */
function findChangeCoveringOriginalLine(changes, lineNumber) {
    if (!changes) return null;
    for (const c of changes) {
        if (c.originalEndLineNumber >= c.originalStartLineNumber && c.originalStartLineNumber >= 1) {
            if (lineNumber >= c.originalStartLineNumber && lineNumber <= c.originalEndLineNumber) return c;
        }
    }
    return null;
}

/**
 * @param {import("monaco-editor").editor.ILineChange[]|null} changes
 * @param {number} lineNumber
 */
function findChangeCoveringModifiedLine(changes, lineNumber) {
    if (!changes) return null;
    for (const c of changes) {
        if (c.modifiedEndLineNumber >= c.modifiedStartLineNumber && c.modifiedStartLineNumber >= 1) {
            if (lineNumber >= c.modifiedStartLineNumber && lineNumber <= c.modifiedEndLineNumber) return c;
        }
    }
    return null;
}

/**
 * @param {string} current
 * @param {string} baseline
 * @returns {number[]}
 */
function dirtyLineNumbers1Based(current, baseline) {
    const vLines = current.split(/\r?\n/);
    const bLines = baseline.split(/\r?\n/);
    const max = Math.max(vLines.length, bLines.length);
    /** @type {number[]} */
    const dirty = [];
    for (let i = 0; i < max; i++) {
        if (vLines[i] !== bLines[i]) dirty.push(i + 1);
    }
    return dirty;
}

/**
 * @param {string} tabId
 * @param {"left"|"right"|undefined} _side unused; refreshes both editors
 */
export function refreshSideDirtyDecorations(tabId, _side) {
    void _side;
    refreshDirtyDecorations(tabId);
}

/**
 * @param {string} tabId
 */
function refreshDirtyDecorations(tabId) {
    const data = state.tabMap.get(tabId);
    if (!data?.editor || data.rawLeftText === undefined || data.rawRightText === undefined) return;
    if (!data.origDirtyDecorCollection || !data.modDirtyDecorCollection) return;

    const prefs = loadDiffPrefs();
    const { left: baseL, right: baseR } = getDisplayTextsForPrefs(data.rawLeftText, data.rawRightText, prefs);

    const orig = data.editor.getOriginalEditor();
    const mod = data.editor.getModifiedEditor();
    const curL = orig.getModel()?.getValue() ?? "";
    const curR = mod.getModel()?.getValue() ?? "";

    const dirtyL = dirtyLineNumbers1Based(curL, baseL);
    const dirtyR = dirtyLineNumbers1Based(curR, baseR);

    /** @type {import("monaco-editor").editor.IModelDeltaDecoration[]} */
    const origDecs = dirtyL.map((ln) => ({
        range: new monaco.Range(ln, 1, ln, 1),
        options: { linesDecorationsClassName: "line-dirty" },
    }));
    /** @type {import("monaco-editor").editor.IModelDeltaDecoration[]} */
    const modDecs = dirtyR.map((ln) => ({
        range: new monaco.Range(ln, 1, ln, 1),
        options: { linesDecorationsClassName: "line-dirty" },
    }));

    data.origDirtyDecorCollection.set(origDecs);
    data.modDirtyDecorCollection.set(modDecs);
}

/**
 * @param {import("monaco-editor").editor.IStandaloneDiffEditor} diffEditor
 * @param {import("monaco-editor").editor.IEditorDecorationsCollection} origColl
 * @param {import("monaco-editor").editor.IEditorDecorationsCollection} modColl
 */
export function applyDiffLineHighlights(diffEditor, origColl, modColl) {
    const orig = diffEditor.getOriginalEditor();
    const mod = diffEditor.getModifiedEditor();
    const origModel = orig.getModel();
    const modModel = mod.getModel();
    const changes = diffEditor.getLineChanges();
    if (changes === null) return;

    /** @type {import("monaco-editor").editor.IModelDeltaDecoration[]} */
    const origDecs = [];
    /** @type {import("monaco-editor").editor.IModelDeltaDecoration[]} */
    const modDecs = [];

    for (const c of changes) {
        const oText = sliceLinesText(origModel, c.originalStartLineNumber, c.originalEndLineNumber);
        const mText = sliceLinesText(modModel, c.modifiedStartLineNumber, c.modifiedEndLineNumber);
        const hasO = oText.length > 0;
        const hasM = mText.length > 0;
        const wsOnly = hasO && hasM && oText.replace(/\s+/g, "") === mText.replace(/\s+/g, "");
        const cls = wsOnly ? "diff-line-ws" : "diff-line-changed";

        if (c.originalEndLineNumber >= c.originalStartLineNumber && c.originalStartLineNumber >= 1) {
            for (let ln = c.originalStartLineNumber; ln <= c.originalEndLineNumber; ln++) {
                origDecs.push({
                    range: new monaco.Range(ln, 1, ln, 1),
                    options: { isWholeLine: true, className: cls, glyphMarginClassName: "diff-copy-right" },
                });
            }
        }
        if (c.modifiedEndLineNumber >= c.modifiedStartLineNumber && c.modifiedStartLineNumber >= 1) {
            for (let ln = c.modifiedStartLineNumber; ln <= c.modifiedEndLineNumber; ln++) {
                modDecs.push({
                    range: new monaco.Range(ln, 1, ln, 1),
                    options: { isWholeLine: true, className: cls, glyphMarginClassName: "diff-copy-left" },
                });
            }
        }

        if (!wsOnly && c.charChanges?.length) {
            for (const ch of c.charChanges) {
                if (
                    ch.originalStartLineNumber >= 1 &&
                    (ch.originalStartLineNumber !== ch.originalEndLineNumber ||
                        ch.originalStartColumn !== ch.originalEndColumn)
                ) {
                    origDecs.push({
                        range: new monaco.Range(
                            ch.originalStartLineNumber,
                            ch.originalStartColumn,
                            ch.originalEndLineNumber,
                            ch.originalEndColumn,
                        ),
                        options: { inlineClassName: "diff-ch-inline-important" },
                    });
                }
                if (
                    ch.modifiedStartLineNumber >= 1 &&
                    (ch.modifiedStartLineNumber !== ch.modifiedEndLineNumber ||
                        ch.modifiedStartColumn !== ch.modifiedEndColumn)
                ) {
                    modDecs.push({
                        range: new monaco.Range(
                            ch.modifiedStartLineNumber,
                            ch.modifiedStartColumn,
                            ch.modifiedEndLineNumber,
                            ch.modifiedEndColumn,
                        ),
                        options: { inlineClassName: "diff-ch-inline-important" },
                    });
                }
            }
        }
    }
    origColl.set(origDecs);
    modColl.set(modDecs);
}

/**
 * @param {string} tabId
 * @param {import("monaco-editor").editor.IStandaloneDiffEditor} editor
 */
export function setupDiffLineHighlights(tabId, editor) {
    const data = state.tabMap.get(tabId);
    if (!data) return;
    disposeTabDiffHighlights(data);

    editor.updateOptions({
        glyphMargin: true,
        renderMarginRevertIcon: false,
        renderGutterMenu: false,
    });

    const orig = editor.getOriginalEditor();
    const mod = editor.getModifiedEditor();
    data.origDecorCollection = orig.createDecorationsCollection();
    data.modDecorCollection = mod.createDecorationsCollection();
    data.origDirtyDecorCollection = orig.createDecorationsCollection();
    data.modDirtyDecorCollection = mod.createDecorationsCollection();

    const run = () => {
        if (data.origDecorCollection && data.modDecorCollection) {
            applyDiffLineHighlights(editor, data.origDecorCollection, data.modDecorCollection);
        }
        refreshDirtyDecorations(tabId);
    };

    const scheduleDeferredRun = () => {
        queueMicrotask(() => {
            requestAnimationFrame(run);
        });
    };

    /** @type {{ dispose: () => void }[]} */
    const disposables = [];
    disposables.push(editor.onDidUpdateDiff(() => run()));
    disposables.push(editor.onDidChangeModel(() => scheduleDeferredRun()));

    const glyphType = monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN;

    disposables.push(
        orig.onMouseDown((e) => {
            if (e.event.middleButton || e.event.rightButton) return;
            if (e.target.type !== glyphType || !e.target.position) return;
            const changes = editor.getLineChanges();
            const ch = findChangeCoveringOriginalLine(changes, e.target.position.lineNumber);
            if (ch) copyChangeFromOriginalToModified(editor, ch);
        }),
    );
    disposables.push(
        mod.onMouseDown((e) => {
            if (e.event.middleButton || e.event.rightButton) return;
            if (e.target.type !== glyphType || !e.target.position) return;
            const changes = editor.getLineChanges();
            const ch = findChangeCoveringModifiedLine(changes, e.target.position.lineNumber);
            if (ch) copyChangeFromModifiedToOriginal(editor, ch);
        }),
    );

    const origModel = orig.getModel();
    const modModel = mod.getModel();
    if (origModel && modModel) {
        let debTimer = null;
        const debouncedRun = () => {
            if (debTimer != null) clearTimeout(debTimer);
            debTimer = setTimeout(() => {
                debTimer = null;
                run();
            }, 80);
        };
        disposables.push(origModel.onDidChangeContent(debouncedRun));
        disposables.push(modModel.onDidChangeContent(debouncedRun));
        disposables.push({
            dispose: () => {
                if (debTimer != null) clearTimeout(debTimer);
            },
        });
    }

    data.diffHighlightDisposables = disposables;
    run();
    scheduleDeferredRun();
}

/** @param {any} data */
export function disposeTabDiffHighlights(data) {
    if (data?.diffHighlightDisposables?.length) {
        for (const d of data.diffHighlightDisposables) {
            try { d.dispose(); } catch { /* ignore */ }
        }
        data.diffHighlightDisposables = undefined;
    }
    data?.origDecorCollection?.clear();
    data?.modDecorCollection?.clear();
    data?.origDirtyDecorCollection?.clear();
    data?.modDirtyDecorCollection?.clear();
    if (data) {
        data.origDecorCollection = undefined;
        data.modDecorCollection = undefined;
        data.origDirtyDecorCollection = undefined;
        data.modDirtyDecorCollection = undefined;
    }
}
