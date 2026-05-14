import { panelFolderEl } from "./dom.js";

/**
 * @typedef {{
 *   relPath: string, kind: string, status: string,
 *   leftExists: boolean, rightExists: boolean,
 *   leftSize?: number, rightSize?: number,
 *   leftModifiedMs?: number, rightModifiedMs?: number
 * }} DiffEntry
 */

/**
 * @type {Map<string, {
 *   type: string, title: string,
 *   entry?: DiffEntry,
 *   editorInitialized?: boolean,
 *   editorEl?: HTMLElement,
 *   editor?: import("monaco-editor").editor.IStandaloneDiffEditor,
 *   origModel?: import("monaco-editor").editor.ITextModel,
 *   modModel?: import("monaco-editor").editor.ITextModel,
 *   leftText?: string, rightText?: string,
 *   leftName?: string, rightName?: string,
 *   leftPath?: string|null, rightPath?: string|null,
 *   rawLeftText?: string, rawRightText?: string,
 *   diffLang?: string,
 *   diffHighlightDisposables?: { dispose: () => void }[],
 *   origDecorCollection?: { set: (d: unknown[]) => void, clear: () => void },
 *   modDecorCollection?: { set: (d: unknown[]) => void, clear: () => void },
 * }>}
 */
export const state = {
  /** @type {string|null} */
  leftRoot: null,
  /** @type {string|null} */
  rightRoot: null,
  /** @type {DiffEntry[]} */
  entries: [],
  droppedFiles: { left: null, right: null },
  collapsedDirs: /** @type {Set<string>} */ (new Set()),
  tabMap: new Map(),
  tabPanels: new Map(),
  activeTabId: "folder",
};

state.tabMap.set("folder", { type: "folder", title: "Folder Compare" });
state.tabPanels.set("folder", panelFolderEl);
