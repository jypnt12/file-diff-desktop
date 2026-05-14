import { fcRecentsEl, recentPopoverEl, statusEl } from "../dom.js";
import { loadRecents, recentSignature, RECENTS_MAX, saveRecents } from "../storage/recents.js";
import { state } from "../state.js";
import { isTauri, pathIsDirectory, readFile } from "../tauri/api.js";
import { setStatus } from "../utils.js";

export function closeRecentPopover() {
  recentPopoverEl?.classList.add("hidden");
}

/** @param {import("../storage/recents.js").RecentItem} item */
export function addRecent(item) {
  const list = loadRecents().filter((x) => recentSignature(x) !== recentSignature(item));
  list.unshift({ ...item, id: item.id || `r-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` });
  saveRecents(list.slice(0, RECENTS_MAX));
  renderFcRecents();
  renderRecentToolbarList();
}

/** @param {string} id */
export function removeRecent(id) {
  saveRecents(loadRecents().filter((x) => x.id !== id));
  renderFcRecents();
  renderRecentToolbarList();
}

export function clearRecents() {
  saveRecents([]);
  renderFcRecents();
  renderRecentToolbarList();
}

export function renderFcRecents() {
  if (!fcRecentsEl) return;
  const list = loadRecents().slice(0, 8);
  fcRecentsEl.replaceChildren();
  if (!list.length) {
    fcRecentsEl.classList.add("hidden");
    return;
  }
  fcRecentsEl.classList.remove("hidden");

  const title = document.createElement("h3");
  title.className = "fc-recents-title";
  title.textContent = "Recent";
  fcRecentsEl.appendChild(title);

  const ul = document.createElement("ul");
  ul.className = "fc-recents-list";
  for (const item of list) {
    const li = document.createElement("li");
    li.className = "fc-recents-item";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fc-recents-open";
    btn.textContent = item.label || item.kind;
    btn.title = item.kind === "filePair" ? `${item.left}\n${item.right}` : `${item.left ?? ""} ${item.right ?? ""}`;
    btn.addEventListener("click", () => { rehydrateRecentItem(item); });

    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "fc-recents-remove";
    rm.textContent = "×";
    rm.title = "Remove from recents";
    rm.addEventListener("click", (e) => {
      e.stopPropagation();
      removeRecent(item.id);
    });

    li.appendChild(btn);
    li.appendChild(rm);
    ul.appendChild(li);
  }
  fcRecentsEl.appendChild(ul);
}

export function renderRecentToolbarList() {
  if (!recentPopoverEl) return;
  recentPopoverEl.replaceChildren();
  const list = loadRecents();
  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "recent-popover-empty";
    empty.textContent = "No recent compares yet.";
    recentPopoverEl.appendChild(empty);
  } else {
    const ul = document.createElement("ul");
    ul.className = "recent-toolbar-list";
    for (const item of list) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "recent-toolbar-item";
      btn.textContent = item.label || item.kind;
      btn.addEventListener("click", () => { rehydrateRecentItem(item); });
      li.appendChild(btn);
      ul.appendChild(li);
    }
    recentPopoverEl.appendChild(ul);
  }

  const footer = document.createElement("div");
  footer.className = "recent-popover-footer";
  const clr = document.createElement("button");
  clr.type = "button";
  clr.textContent = "Clear recent";
  clr.addEventListener("click", () => {
    clearRecents();
    closeRecentPopover();
  });
  footer.appendChild(clr);
  recentPopoverEl.appendChild(footer);
}

/** @param {import("../storage/recents.js").RecentItem} item */
export async function rehydrateRecentItem(item) {
  if (!isTauri()) {
    setStatus(statusEl, "Recents re-open requires the desktop app (Tauri).", true);
    return;
  }
  try {
    const [{ activateTab, openDroppedTab }, { refreshCompare, updatePathLabels }] = await Promise.all([
      import("../tabs/manager.js"),
      import("./folderCompare.js"),
    ]);

    if (item.kind === "folderPair") {
      await pathIsDirectory(item.left);
      await pathIsDirectory(item.right);
      state.leftRoot = item.left;
      state.rightRoot = item.right;
      state.droppedFiles.left = state.droppedFiles.right = null;
      updatePathLabels();
      await refreshCompare();
      activateTab("folder");
      closeRecentPopover();
      setStatus(statusEl, "Opened recent folder pair.", false);
      return;
    }
    if (item.kind === "folder") {
      await pathIsDirectory(item.path);
      if (item.side === "left") state.leftRoot = item.path;
      else state.rightRoot = item.path;
      state.droppedFiles.left = state.droppedFiles.right = null;
      updatePathLabels();
      await refreshCompare();
      activateTab("folder");
      closeRecentPopover();
      setStatus(statusEl, "Opened recent folder.", false);
      return;
    }
    if (item.kind === "filePair") {
      if (!item.left || !item.right) {
        setStatus(statusEl, "This recent entry has no file paths.", true);
        return;
      }
      const [lt, rt] = await Promise.all([
        readFile(item.left),
        readFile(item.right),
      ]);
      const ln = item.leftName || String(item.left).split(/[/\\]/).pop();
      const rn = item.rightName || String(item.right).split(/[/\\]/).pop();
      openDroppedTab(
        { name: ln, text: lt, path: item.left },
        { name: rn, text: rt, path: item.right },
      );
      closeRecentPopover();
      return;
    }
    setStatus(statusEl, "Unknown recent entry type.", true);
  } catch (err) {
    setStatus(statusEl, `Recent item is missing or unreadable: ${String(err)}`, true);
  }
}
