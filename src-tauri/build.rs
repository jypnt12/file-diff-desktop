// =============================================================================
// File: src-tauri/build.rs
// Purpose:
//   Cargo build script. Tauri requires this to embed app metadata (icons,
//   resources, capability/permission schemas) into the compiled binary.
//   It just delegates to `tauri_build::build()`.
// =============================================================================

fn main() {
    tauri_build::build()
}
