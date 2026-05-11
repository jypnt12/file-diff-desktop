// ============================================================================
// File: src-tauri/src/main.rs
// Purpose:
//   Native binary entry point. Tauri builds this as the actual executable
//   that the user launches; all real logic lives in `lib.rs` so it can be
//   shared/tested as a library. This file just calls into `run()`.
// ============================================================================

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    file_diff_desktop_lib::run()
}
