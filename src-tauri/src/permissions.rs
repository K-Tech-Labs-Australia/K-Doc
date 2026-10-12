//! @file permissions.rs
//! @purpose Reports and clears a file's read-only attribute so a read-only file can be opened locked and unlocked on request (FR-6.7).
//! @inputs A file path (`&str`/`String`) and, to change it, the wanted state (`read_only: bool`).
//! @outputs Whether the file is read-only (`is_read_only`), or the result of changing it (`set_read_only`, `set_file_read_only`).
//! @functions
//!   - is_read_only: Report whether a path currently has its read-only attribute set.
//!   - set_read_only: Change a file's read-only attribute to a wanted state, returning an error with reason on failure.
//!   - set_file_read_only: Tauri command wrapper around `set_read_only` for the front end.
//! @dataflow path -> fs metadata -> permissions -> readonly flag; path + wanted -> permissions -> fs::set_permissions.
//! @controlflow A path that cannot be inspected is reported as not read-only, because the caller has already read the file; changing the attribute reports the reason it failed.
//! @version 1
//! @date 2026-09-16

use std::fs;
use std::path::Path;

/// Reports whether a file currently has its read-only attribute set.
///
/// @purpose Returns true when the path's permissions mark it read-only, so callers can report locked state without failing to open the file.
/// @inputs path - Filesystem path to inspect (`&str`).
/// @outputs bool - True if the file is read-only; false if writable or if its metadata cannot be read.
/// @dataflow path -> fs::metadata -> Permissions -> readonly() flag.
/// @controlflow Inspect the path's metadata; on success return whether it is readonly, on failure return false so the caller still sees the file as openable.
pub fn is_read_only(path: &str) -> bool {
    // Inspect the path's filesystem metadata to read its permission attributes.
    match fs::metadata(Path::new(path)) {
        Ok(metadata) => {
            // Metadata readable: report the actual readonly flag from the permissions.
            metadata.permissions().readonly()
        }
        Err(_) => {
            // Metadata unreadable: report not read-only, because the caller has already read the file and it simply opens unlocked rather than failing the open.
            false
        }
    }
}

/// Changes a file's read-only attribute to a wanted state without touching anything else about its permissions.
///
/// @purpose Set or clear the read-only flag so a locked file can be opened, returning an error naming path and reason on failure.
/// @inputs path - Filesystem path to modify (`&str`); read_only - The desired readonly state (true = lock, false = unlock).
/// @outputs Result<(), String> - Ok once the attribute holds the wanted state; Err with a message naming path and reason otherwise.
/// @dataflow path -> fs::metadata -> permissions -> permissions.set_readonly(read_only) -> fs::set_permissions.
/// @controlflow No branching beyond the two failures: reading the permissions and writing them back each
///   return a message naming the path and the reason. Writing a file the state it already has is not
///   guarded against, because that write succeeds and costs nothing, so the guard changed no behaviour.
pub fn set_read_only(path: &str, read_only: bool) -> Result<(), String> {
    // Resolve the path so metadata lookups use the typed Path type.
    let target = Path::new(path);
    // Read current permissions; fail fast with a message naming the path and reason if it cannot be inspected.
    let metadata = fs::metadata(target).map_err(|error| format!("Could not read {path}: {error}"))?;
    // Take the file's own permissions so only the read-only flag is changed, leaving everything else intact.
    let mut permissions = metadata.permissions();
    // Set only the read-only flag to the target value, then persist it back to disk.
    permissions.set_readonly(read_only);
    fs::set_permissions(target, permissions)
        .map_err(|error| format!("Could not change {path}: {error}"))
}

/// Tauri command entry point that changes a file's read-only attribute on behalf of the front end.
///
/// @purpose Forward the front end's request to `set_read_only`, returning the operation result as a JSON-serializable error string.
/// @inputs path - Filesystem path to modify (`String`); read_only - The desired readonly state (true = lock, false = unlock).
/// @outputs Result<(), String> - Ok on success; Err with a message naming path and reason on failure.
/// @dataflow front end -> command args (path, read_only) -> set_read_only(&path, read_only) -> fs::set_permissions result.
/// @controlflow Delegate directly to `set_read_only`; the command layer adds no branching of its own.
#[tauri::command]
pub fn set_file_read_only(grants: tauri::State<'_, crate::grants::GrantState>, path: String, read_only: bool) -> Result<(), String> {
    // Only a document the user chose can be locked or unlocked.
    grants.require(&path)?;
    // Forward the request; changing a file's attributes is deliberate, so the front end asks before calling this.
    set_read_only(&path, read_only)
}

#[cfg(test)]
#[path = "permissions_tests.rs"]
mod permissions_tests;
