import {
  btnCompareFiles,
  btnHome,
  btnPickLeft,
  btnPickRight,
  btnRecentEl,
  btnRefresh,
  btnSaveAllTb,
  btnSaveLeftTb,
  btnSaveRightTb,
  fcBodyEl,
  recentPopoverEl,
  statusEl,
  tabBarEl,
} from "./dom.js";
import {
  compareTwoFilesFromToolbar,
  pickFolder,
  refreshCompare,
  renderFolderCompare,
  updatePathLabels,
} from "./features/folderCompare.js";
import { closeRecentPopover, renderRecentToolbarList } from "./features/recentsUi.js";
import { activateTab, openFileTab } from "./tabs/manager.js";
import { resetApplicationToStart, saveActiveTabEditor } from "./tabs/save.js";
import { state } from "./state.js";
import { setStatus } from "./utils.js";

export function wireEvents() {
  tabBarEl.addEventListener("click", (e) => {
    if (e.target.closest(".tab-close")) return;
    const tab = e.target.closest("[data-tab-id]");
    if (tab) activateTab(tab.dataset.tabId);
  });

  fcBodyEl.addEventListener("click", (e) => {
    const row = e.target.closest(".fc-row");
    if (!row) return;

    const relPath = row.dataset.relPath;
    const kind = row.dataset.kind;

    if (kind === "dir") {
      if (state.collapsedDirs.has(relPath)) state.collapsedDirs.delete(relPath);
      else state.collapsedDirs.add(relPath);
      renderFolderCompare();
    } else if (kind === "file") {
      const entry = state.entries.find((ent) => ent.relPath === relPath);
      if (entry) openFileTab(entry);
    }
  });

  btnPickLeft.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      const picked = await pickFolder("left");
      if (picked) {
        state.leftRoot = picked;
        state.droppedFiles.left = null;
        updatePathLabels();
        await refreshCompare();
      }
    } catch (err) { setStatus(statusEl, String(err), true); }
  });

  btnPickRight.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      const picked = await pickFolder("right");
      if (picked) {
        state.rightRoot = picked;
        state.droppedFiles.right = null;
        updatePathLabels();
        await refreshCompare();
      }
    } catch (err) { setStatus(statusEl, String(err), true); }
  });

  btnRefresh.addEventListener("click", () => refreshCompare());

  btnHome?.addEventListener("click", () => {
    resetApplicationToStart().catch((err) => setStatus(statusEl, String(err), true));
  });

  btnSaveLeftTb?.addEventListener("click", () => saveActiveTabEditor("left"));
  btnSaveRightTb?.addEventListener("click", () => saveActiveTabEditor("right"));
  btnSaveAllTb?.addEventListener("click", () => saveActiveTabEditor("all"));

  btnCompareFiles?.addEventListener("click", () => {
    compareTwoFilesFromToolbar().catch((err) => setStatus(statusEl, String(err), true));
  });

  btnRecentEl?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!recentPopoverEl) return;
    if (recentPopoverEl.classList.contains("hidden")) {
      renderRecentToolbarList();
      recentPopoverEl.classList.remove("hidden");
    } else {
      recentPopoverEl.classList.add("hidden");
    }
  });

  recentPopoverEl?.addEventListener("click", (e) => e.stopPropagation());

  document.addEventListener("click", () => {
    closeRecentPopover();
  });
}
