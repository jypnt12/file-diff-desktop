const DIFF_PREFS_KEY = "fdd.diffPrefs";

/** @returns {{ ignoreWhitespace: boolean, ignoreCase: boolean, ignoreLineEndings: boolean }} */
export function loadDiffPrefs() {
  try {
    const raw = localStorage.getItem(DIFF_PREFS_KEY);
    if (!raw) return { ignoreWhitespace: false, ignoreCase: false, ignoreLineEndings: false };
    const o = JSON.parse(raw);
    return {
      ignoreWhitespace: Boolean(o.ignoreWhitespace),
      ignoreCase: Boolean(o.ignoreCase),
      ignoreLineEndings: Boolean(o.ignoreLineEndings),
    };
  } catch {
    return { ignoreWhitespace: false, ignoreCase: false, ignoreLineEndings: false };
  }
}

/** @param {{ ignoreWhitespace: boolean, ignoreCase: boolean, ignoreLineEndings: boolean }} p */
export function saveDiffPrefs(p) {
  try {
    localStorage.setItem(DIFF_PREFS_KEY, JSON.stringify(p));
  } catch { /* ignore */ }
}

/** @param {string} rawL @param {string} rawR @param {ReturnType<typeof loadDiffPrefs>} prefs */
export function getDisplayTextsForPrefs(rawL, rawR, prefs) {
  let left = rawL ?? "";
  let right = rawR ?? "";
  if (prefs.ignoreLineEndings) {
    left = left.replace(/\r\n?/g, "\n");
    right = right.replace(/\r\n?/g, "\n");
  }
  if (prefs.ignoreCase) {
    left = left.toLowerCase();
    right = right.toLowerCase();
  }
  return { left, right };
}
