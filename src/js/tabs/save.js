import { dropLeftEl, dropRightEl, statusEl } from "../dom.js";
import { getDisplayTextsForPrefs, loadDiffPrefs } from "../storage/diffPrefs.js";
import { state } from "../state.js";
import { writeFile } from "../tauri/api.js";
import { joinPath, setBusy, setStatus } from "../utils.js";

export function getTabSidePath(tabId, data, side) {
  if (!data) return null;
  if (data.type === "file" && data.entry) {
    const root = side === "left" ? state.leftRoot : state.rightRoot;
    return root ? joinPath(root, data.entry.relPath) : null;
  }
  if (data.type === "dropped") {
    return side === "left" ? data.leftPath ?? null : data.rightPath ?? null;
  }
  return null;
}

export function getTabSideValue(data, side) {
  if (!data?.editor) return "";
  const editor = side === "left" ? data.editor.getOriginalEditor() : data.editor.getModifiedEditor();
  return editor.getValue();
}

export function getTabSideBaseline(data, side) {
  if (data?.rawLeftText === undefined || data?.rawRightText === undefined) return "";
  const prefs = loadDiffPrefs();
  const displayTexts = getDisplayTextsForPrefs(data.rawLeftText, data.rawRightText, prefs);
  return side === "left" ? displayTexts.left : displayTexts.right;
}

export function isTabSideDirty(data, side) {
  if (!data?.editor) return false;
  return getTabSideValue(data, side) !== getTabSideBaseline(data, side);
}

export function getDirtySides(tabId) {
  const data = state.tabMap.get(tabId);
  if (!data?.editor || (data.type !== "file" && data.type !== "dropped")) return [];
  return /** @type {("left"|"right")[]} */ (["left", "right"].filter((side) => isTabSideDirty(data, side)));
}

export async function saveTabSide(tabId, side) {
  const data = state.tabMap.get(tabId);
  if (!data?.editor) throw new Error("Nothing to save on this tab.");
  if (loadDiffPrefs().ignoreCase) throw new Error("Turn off “Ignore case” to save.");

  const path = getTabSidePath(tabId, data, side);
  if (!path) throw new Error(`No ${side} file path is available for "${data.title}".`);

  const contents = getTabSideValue(data, side);
  await writeFile(path, contents);
  if (side === "left") data.rawLeftText = contents;
  else data.rawRightText = contents;
}

export async function saveTabSides(tabId, sides) {
  for (const side of sides) {
    await saveTabSide(tabId, side);
  }
}

export function getDirtyTabs() {
  const dirty = [];
  for (const [tabId, data] of state.tabMap) {
    const sides = getDirtySides(tabId);
    if (sides.length) dirty.push({ tabId, title: data.title, sides });
  }
  return dirty;
}

export async function saveDirtyTabsBeforeReset(dirtyTabs) {
  const unsavable = dirtyTabs.filter(({ tabId, sides }) => {
    const data = state.tabMap.get(tabId);
    return sides.some((side) => !getTabSidePath(tabId, data, side));
  });
  if (unsavable.length) {
    window.alert(
      "Some tabs have unsaved changes but no file path to save to:\n\n" +
        unsavable.map(({ title }) => `- ${title}`).join("\n") +
        "\n\nSave or close those changes manually before resetting.",
    );
    return false;
  }

  const okToSave = window.confirm(
    "There are unsaved changes. Save them before resetting?",
  );
  if (!okToSave) return false;

  try {
    setBusy(true);
    setStatus(statusEl, "Saving open tabs…", false);
    for (const { tabId, sides } of dirtyTabs) {
      await saveTabSides(tabId, sides);
    }
    return true;
  } catch (err) {
    setStatus(statusEl, String(err), true);
    window.alert(`Could not save changes:\n\n${String(err)}`);
    return false;
  } finally {
    setBusy(false);
  }
}

export async function resetApplicationToStart() {
  const { closeAllFileTabs, activateTab } = await import("./manager.js");
  const { updatePathLabels, renderFolderCompare } = await import("../features/folderCompare.js");

  const hasOpenTabs = [...state.tabMap.keys()].some((id) => id !== "folder");
  const hasFoldersOrFiles = Boolean(
    state.leftRoot || state.rightRoot || state.droppedFiles.left || state.droppedFiles.right || state.entries.length,
  );
  if (!hasOpenTabs && !hasFoldersOrFiles) {
    activateTab("folder");
    setStatus(statusEl, "", false);
    return;
  }

  const confirmed = window.confirm("Close all open tabs and reset the app to the starting screen?");
  if (!confirmed) return;

  const dirtyTabs = getDirtyTabs();
  if (dirtyTabs.length && !(await saveDirtyTabsBeforeReset(dirtyTabs))) return;

  closeAllFileTabs();
  state.leftRoot = null;
  state.rightRoot = null;
  state.entries = [];
  state.collapsedDirs.clear();
  state.droppedFiles.left = null;
  state.droppedFiles.right = null;
  dropLeftEl.classList.remove("has-file", "has-folder", "is-dropping");
  dropRightEl.classList.remove("has-file", "has-folder", "is-dropping");
  updatePathLabels();
  renderFolderCompare();
  activateTab("folder");
  setStatus(statusEl, "Reset to starting screen.", false);
}

export async function saveActiveTabEditor(which) {
  const data = state.tabMap.get(state.activeTabId);
  if (!data?.editor) {
    setStatus(statusEl, "Nothing to save on this tab.", true);
    return;
  }
  if (loadDiffPrefs().ignoreCase) {
    setStatus(statusEl, "Turn off “Ignore case” to save.", true);
    return;
  }
  if (data.type !== "file" || !data.entry) {
    setStatus(statusEl, "Toolbar save applies to files opened from folder compare (with paths on disk).", true);
    return;
  }
  try {
    const sides = which === "all" ? ["left", "right"] : [which];
    await saveTabSides(state.activeTabId, sides);
    const msg =
      which === "left" ? "Saved left." : which === "right" ? "Saved right." : "Saved both sides.";
    setStatus(statusEl, msg, false);
  } catch (err) {
    setStatus(statusEl, String(err), true);
  }
}
