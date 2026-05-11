use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use serde::Serialize;
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;
use walkdir::WalkDir;

#[derive(Clone, Debug)]
enum NodeKind {
    Dir,
    File { size: u64, modified_ms: u64 },
}

fn join_rel(root: &Path, rel_key: &str) -> PathBuf {
    let mut p = root.to_path_buf();
    for part in rel_key.split('/') {
        if !part.is_empty() {
            p.push(part);
        }
    }
    p
}

fn should_skip_dir(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some(".git" | "node_modules" | "target" | "dist" | "dist-ssr" | ".next" | ".turbo")
    )
}

fn collect_entries(root: &Path) -> Result<HashMap<String, NodeKind>, String> {
    let mut map = HashMap::new();
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", root.display()));
    }
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| entry.depth() == 0 || !should_skip_dir(entry.path()))
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path == root {
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .map_err(|e| format!("strip_prefix: {e}"))?;
        let key = rel.to_string_lossy().replace('\\', "/");
        if key.is_empty() {
            continue;
        }
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        if metadata.is_dir() {
            map.insert(key, NodeKind::Dir);
        } else if metadata.is_file() {
            let size = metadata.len();
            let modified_ms = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            map.insert(key, NodeKind::File { size, modified_ms });
        }
    }
    Ok(map)
}

fn file_hash(path: &Path) -> Result<blake3::Hash, String> {
    let data = fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    Ok(blake3::hash(&data))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffEntry {
    pub rel_path: String,
    pub kind: String,
    pub status: String,
    pub left_exists: bool,
    pub right_exists: bool,
    pub left_size: Option<u64>,
    pub right_size: Option<u64>,
    pub left_modified_ms: Option<u64>,
    pub right_modified_ms: Option<u64>,
}

#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = oneshot::channel();
    app.dialog()
        .file()
        .set_title("Select folder")
        .pick_folder(move |picked| {
            let _ = tx.send(picked);
        });

    let picked = tokio::time::timeout(Duration::from_secs(120), rx)
        .await
        .map_err(|_| "Folder picker timed out".to_string())?;
    let picked = picked.map_err(|_| "Folder picker closed unexpectedly".to_string())?;
    match picked {
        None => Ok(None),
        Some(fp) => {
            let pb = fp.into_path().map_err(|e| e.to_string())?;
            Ok(Some(pb.to_string_lossy().into_owned()))
        }
    }
}

#[tauri::command]
fn compare_folders(left: String, right: String) -> Result<Vec<DiffEntry>, String> {
    let left_root = PathBuf::from(&left);
    let right_root = PathBuf::from(&right);
    let left_map = collect_entries(&left_root)?;
    let right_map = collect_entries(&right_root)?;

    let mut keys: Vec<String> = left_map
        .keys()
        .chain(right_map.keys())
        .cloned()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    keys.sort();

    let mut out = Vec::with_capacity(keys.len());
    for key in keys {
        let l = left_map.get(&key);
        let r = right_map.get(&key);
        let left_exists = l.is_some();
        let right_exists = r.is_some();

        let (left_size, left_modified_ms) = match l {
            Some(NodeKind::File { size, modified_ms }) => (Some(*size), Some(*modified_ms)),
            _ => (None, None),
        };
        let (right_size, right_modified_ms) = match r {
            Some(NodeKind::File { size, modified_ms }) => (Some(*size), Some(*modified_ms)),
            _ => (None, None),
        };

        let (kind_str, status) = match (l, r) {
            (Some(NodeKind::Dir), Some(NodeKind::Dir)) => ("dir", "identical"),
            (Some(NodeKind::File { size: ls, .. }), Some(NodeKind::File { size: rs, .. })) => {
                if ls != rs {
                    ("file", "modified")
                } else {
                    let lp = join_rel(&left_root, &key);
                    let rp = join_rel(&right_root, &key);
                    let hl = file_hash(&lp)?;
                    let hr = file_hash(&rp)?;
                    if hl == hr { ("file", "identical") } else { ("file", "modified") }
                }
            }
            (Some(NodeKind::Dir), Some(NodeKind::File { .. }))
            | (Some(NodeKind::File { .. }), Some(NodeKind::Dir)) => ("file", "modified"),
            (Some(NodeKind::Dir), None)         => ("dir",  "onlyLeft"),
            (Some(NodeKind::File { .. }), None) => ("file", "onlyLeft"),
            (None, Some(NodeKind::Dir))         => ("dir",  "onlyRight"),
            (None, Some(NodeKind::File { .. })) => ("file", "onlyRight"),
            (None, None) => unreachable!(),
        };

        out.push(DiffEntry {
            rel_path: key,
            kind: kind_str.to_string(),
            status: status.to_string(),
            left_exists,
            right_exists,
            left_size,
            right_size,
            left_modified_ms,
            right_modified_ms,
        });
    }
    Ok(out)
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !p.exists() { return Ok(String::new()); }
    if p.is_dir()  { return Ok(String::new()); }
    fs::read_to_string(&p).map_err(|e| format!("read {}: {e}", p.display()))
}

#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create_dir_all: {e}"))?;
    }
    fs::write(&p, contents.as_bytes()).map_err(|e| format!("write {}: {e}", p.display()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            compare_folders,
            read_file,
            write_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
