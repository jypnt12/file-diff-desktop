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
 * @param {import("monaco-editor").editor.IStandaloneDiffEditor} diffEditor
 * @param {import("monaco-editor").editor.IEditorDecorationsCollection} origColl
 * @param {import("monaco-editor").editor.IEditorDecorationsCollection} modColl
 */
export function applyDiffLineHighlights(diffEditor, origColl, modColl) {
  const orig = diffEditor.getOriginalEditor();
  const mod = diffEditor.getModifiedEditor();
  const origModel = orig.getModel();
  const modModel = mod.getModel();
  // Monaco 0.52+: diff is async; `null` means computation not ready yet — skip so we don't
  // wipe decorations before `onDidUpdateDiff` / deferred runs (avoids missing red/blue).
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
      origDecs.push({
        range: new monaco.Range(c.originalStartLineNumber, 1, c.originalEndLineNumber, 1),
        options: { isWholeLine: true, className: cls },
      });
    }
    if (c.modifiedEndLineNumber >= c.modifiedStartLineNumber && c.modifiedStartLineNumber >= 1) {
      modDecs.push({
        range: new monaco.Range(c.modifiedStartLineNumber, 1, c.modifiedEndLineNumber, 1),
        options: { isWholeLine: true, className: cls },
      });
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
  console.log("setupDiffLineHighlights called", tabId);
  const data = state.tabMap.get(tabId);
  if (!data) return;
  console.log("with data", data);
  disposeTabDiffHighlights(data);

  const orig = editor.getOriginalEditor();
  const mod = editor.getModifiedEditor();
  data.origDecorCollection = orig.createDecorationsCollection();
  data.modDecorCollection = mod.createDecorationsCollection();

  const run = () => {
    if (data.origDecorCollection && data.modDecorCollection) {
      applyDiffLineHighlights(editor, data.origDecorCollection, data.modDecorCollection);
    }
  };

  /** Run after layout/diff pipeline so `getLineChanges()` is non-null (missed if only sync `run()`). */
  const scheduleDeferredRun = () => {
    queueMicrotask(() => {
      requestAnimationFrame(run);
    });
  };

  /** @type {{ dispose: () => void }[]} */
  const disposables = [];
  disposables.push(editor.onDidUpdateDiff(() => run()));
  disposables.push(editor.onDidChangeModel(() => scheduleDeferredRun()));

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
  if (data) {
    data.origDecorCollection = undefined;
    data.modDecorCollection = undefined;
  }
}
