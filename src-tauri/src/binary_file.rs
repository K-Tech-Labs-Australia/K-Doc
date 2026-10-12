//! @file binary_file.rs
//! @purpose Writes a binary file the webview built — a Word document, for now (FR-13.4) — atomically, so a failed export never leaves a half-written file where a good one was; reads a document back for import with a hard size cap (FR-13.5).
//! @inputs a path and the bytes to put there.
//! @outputs the file on disk, or the reason it could not be written.
//! @functions write_bytes_atomically - persists raw bytes via a sibling temp file plus sync and rename; write_binary_file - Tauri command wrapper forwarding webview bytes to write_bytes_atomically; read_bytes_limited - reads up to a byte limit, refusing folders and oversized files before loading; read_binary_file - Tauri command wrapper reading a document for import under MAX_IMPORT_BYTES.
//! @dataflow bytes -> <name>.kdoc-tmp beside the target -> sync_all -> rename over the target.
//! @controlflow any failure removes the temporary file and names the path and the reason.
//! @version 2
//! @date 2026-09-18

use std::fs;
use std::io::Write;
use std::path::Path;

/// Writes raw bytes to `path` atomically, so a failure never leaves a half-written file where a good one was.
///
/// @purpose Persist the webview-built document (a Word file today, per FR-13.4) without clobbering an existing good file with a partial write.
/// @inputs path - target location as a string slice; bytes - the exact contents to store at that location.
/// @outputs Ok(()) when the bytes are durably on disk at `path`; Err(String) naming `path` and the failure reason if anything fails.
/// @dataflow bytes -> <name>.kdoc-tmp beside the target -> fs::sync_all -> fs::rename over the target.
/// @controlflow Resolve parent and file name, build a sibling temp path, run the four write steps in one closure, then either return Ok or clean up the temp file and report the error.
pub fn write_bytes_atomically(path: &str, bytes: &[u8]) -> Result<(), String> {
    let target = Path::new(path);
    // A bare file name (no directory component) yields an empty parent; writing beside "nothing" would drop the file wherever the process happens to run. Reject that case explicitly instead of guessing a location.
    let parent = target
        .parent()
        .filter(|folder| !folder.as_os_str().is_empty())
        .ok_or_else(|| format!("Could not write {path}: it names no folder"))?;
    // The file name is required to build the sibling temp path, so it must be present.
    let name = target
        .file_name()
        .ok_or_else(|| format!("Could not write {path}: it names no file"))?;
    // Rename is only atomic within one volume, so the temporary goes in the same folder as the target, under a
    // name nobody could have prepared in advance.
    let temp = crate::atomic::unique_temp_path(parent, name);

    // The closure gathers the four steps — create, write, sync, rename — so a failure at any of them is handled once by the match below.
    let written = (|| -> std::io::Result<()> {
        // Create the sibling temp file exclusively: anything already at that path (a planted file or symlink) is refused.
        let mut file = crate::atomic::create_exclusive(&temp)?;
        // Write every byte; a short write surfaces as this error rather than a silent partial file.
        file.write_all(bytes)?;
        // sync_all before rename — without it a power cut can leave the renamed file empty.
        file.sync_all()?;
        // drop before rename — Windows will not rename a file that is still open, so release the handle first.
        drop(file);
        // The atomic step: on success the temp replaces the target with no window where a reader sees a partial file.
        fs::rename(&temp, target)
    })();

    match written {
        Ok(()) => Ok(()),
        Err(error) => {
            // The Err arm removes the temporary file; its own failure is ignored because the write has already failed and that is the error worth reporting.
            let _ = fs::remove_file(&temp);
            Err(format!("Could not write {path}: {error}"))
        }
    }
}

/// Tauri command entry point the webview calls to persist a built document.
///
/// @purpose Expose write_bytes_atomically across the Tauri boundary so the frontend can trigger an export.
/// @inputs path - target location as an owned string received from the webview; data - the file contents, arriving as a JSON array of numbers (roughly four times their size on the wire, acceptable for a document).
/// @outputs Ok(()) when the bytes are durably on disk; Err(String) naming the path and failure reason otherwise.
/// @dataflow webview JSON number array -> Vec<u8> -> write_bytes_atomically -> file on disk.
/// @controlflow Forwards both arguments straight to write_bytes_atomically, delegating all atomic-write logic there.
#[tauri::command]
pub fn write_binary_file(grants: tauri::State<'_, crate::grants::GrantState>, path: String, data: Vec<u8>) -> Result<(), String> {
    // Exports go only where the user chose to save them.
    grants.require(&path)?;
    // Forward the owned path and byte buffer; borrow them for the atomic writer.
    write_bytes_atomically(&path, &data)
}

/// Largest file K-Doc will read for import: 64 MB. A Word document with many pictures can reach tens of megabytes; past this the webview would be asked to hold far more than a document.
///
/// @purpose Upper bound on how many bytes an import may load, so the webview is never asked to hold far more than a document (FR-13.5).
/// @dataflow import request -> MAX_IMPORT_BYTES compared against file size in read_bytes_limited -> refused when exceeded.
pub const MAX_IMPORT_BYTES: u64 = 64 * 1024 * 1024;

/// Reads up to `limit` bytes from `path`, refusing folders and files larger than the limit before loading them.
///
/// @purpose Bound import size so a malicious or accidental enormous file cannot exhaust the webview's memory during document import (FR-13.5).
/// @inputs path - target location as a string slice; limit - maximum number of bytes to allow, in bytes.
/// @outputs Ok(Vec<u8>) with the file contents when it is a regular file no larger than `limit`; Err(String) naming `path` and the reason otherwise.
/// @dataflow path -> fs::metadata -> size check against limit -> fs::read into Vec<u8>.
/// @controlflow Stat the path, reject non-files, reject oversized files before reading, then read; each refusal returns early with a helpful message.
pub fn read_bytes_limited(path: &str, limit: u64) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path).map_err(|error| format!("Could not read {path}: {error}"))?;
    // A folder has metadata too; reading it would fail with a less helpful message.
    if !metadata.is_file() {
        return Err(format!("Could not read {path}: it is not a file"));
    } else {
        // A file: go on to check its size.
    }
    // Checked before reading so an enormous file is refused without loading it.
    if metadata.len() > limit {
        return Err(format!("Could not read {path}: it is larger than {} MB", limit / (1024 * 1024)));
    } else {
        // Within the limit: read it.
    }
    fs::read(path).map_err(|error| format!("Could not read {path}: {error}"))
}

/// Tauri command entry point the webview calls to load a document for import.
///
/// @purpose Expose read_bytes_limited across the Tauri boundary so the frontend can trigger an import with a hard size cap (FR-13.5).
/// @inputs path - target location as an owned string received from the webview.
/// @outputs Ok(tauri::ipc::Response) carrying the raw bytes, which the webview receives as an ArrayBuffer; Err(String) naming the path and failure reason otherwise.
/// @dataflow webview request -> read_bytes_limited -> Vec<u8> wrapped in a raw Tauri Response.
/// @controlflow Forwards the owned path to read_bytes_limited with MAX_IMPORT_BYTES, then wraps the result as a raw response.
#[tauri::command]
pub fn read_binary_file(grants: tauri::State<'_, crate::grants::GrantState>, path: String) -> Result<tauri::ipc::Response, String> {
    // Imports read only the file the user picked.
    grants.require(&path)?;
    // The bytes go back as a raw response, which the webview receives as an ArrayBuffer rather than a JSON number array four times the size.
    read_bytes_limited(&path, MAX_IMPORT_BYTES).map(tauri::ipc::Response::new)
}

/// Unit tests for this module, kept in a sibling file so they do not bloat it.
#[cfg(test)]
#[path = "binary_file_tests.rs"]
mod binary_file_tests;
