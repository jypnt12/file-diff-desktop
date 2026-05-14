const tauri = window.__TAURI__;
const invoke = tauri?.core?.invoke;

export function isTauri() {
  return Boolean(tauri);
}

/** @param {string} path */
export function readFile(path) {
  return invoke("read_file", { path });
}

/** @param {string} path @param {string} contents */
export function writeFile(path, contents) {
  return invoke("write_file", { path, contents });
}

export function pickFolderRaw() {
  return invoke("pick_folder");
}

export function pickFileRaw() {
  return invoke("pick_file");
}

/** @param {string} left @param {string} right */
export function compareFolders(left, right) {
  return invoke("compare_folders", { left, right });
}

/** @param {string} root @param {"left"|"right"} side */
export function listFolder(root, side) {
  return invoke("list_folder", { root, side });
}

/** @param {string} path */
export function pathIsDirectory(path) {
  return invoke("path_is_directory", { path });
}
