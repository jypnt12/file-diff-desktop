export const RECENTS_KEY = "fdd.recents";
export const RECENTS_MAX = 15;

/** @typedef {{ id: string, kind: string, ts: number, label?: string, left?: string, right?: string, side?: string, path?: string, leftName?: string, rightName?: string }} RecentItem */

/** @param {RecentItem} item */
export function recentSignature(item) {
  if (item.kind === "folderPair") return `fp:${item.left}|${item.right}`;
  if (item.kind === "folder") return `f:${item.side}|${item.path}`;
  if (item.kind === "filePair") return `ff:${item.left ?? ""}|${item.right ?? ""}|${item.leftName ?? ""}|${item.rightName ?? ""}`;
  return `o:${item.kind}`;
}

/** @returns {RecentItem[]} */
export function loadRecents() {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.kind === "string" && typeof x.ts === "number")
      .map((x) => ({
        ...x,
        id: x.id || `r-${recentSignature(x)}-${x.ts}`,
      }));
  } catch {
    return [];
  }
}

/** @param {RecentItem[]} list */
export function saveRecents(list) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, RECENTS_MAX)));
  } catch { /* ignore */ }
}
