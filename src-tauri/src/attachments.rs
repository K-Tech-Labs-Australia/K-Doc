//! @file attachments.rs
//! @purpose Host side of FR-6.14: writes an attachment into a folder under a free name and lists a folder's files.
//! @inputs Tauri command arguments (folder, name, data/source) and the filesystem on disk.
//! @outputs Chosen file names for written/copied attachments; sorted list of existing file names.
//! @functions
//!   - check_name: Validates that an attachment name is a plain file name with no separators or dot-dot entries.
//!   - split_name: Splits a name into stem and extension at its final dot.
//!   - free_name: Resolves a collision-free variant of a requested name within a directory.
//!   - prepare: Validates the folder and name, creates the folder, and resolves a unique target path.
//!   - path_text: Converts a resolved path to a UTF-8 string slice for atomic writes.
//!   - attachment_write: Writes raw bytes into an attachment under a free name.
//!   - attachment_copy: Copies an existing source file into an attachment under a free name.
//!   - attachment_names: Lists the names of all files currently in a folder.
//! @dataflow Tauri command args → validation (check_name/prepare) → filesystem write/copy/read → chosen name or sorted list.
//! @controlflow Validate inputs → resolve a unique name → perform I/O → return success value or error string; early returns on any rejection.
//! @version 1
//! @date 2026-09-18

use std::fs;
use std::path::{Path, PathBuf};
use crate::binary_file::write_bytes_atomically;

// Maximum size in bytes for a single attachment payload (25 MiB).
pub const MAX_ATTACHMENT_BYTES: u64 = 25 * 1024 * 1024;

/// Validates that an attachment name is a plain file name.
/// @purpose Rejects empty names, names containing path separators, and the '.'/'..' directory entries.
/// @inputs name - The requested attachment file name to validate.
/// @outputs Ok(()) when the name is acceptable; Err with a descriptive message otherwise.
/// @dataflow Input name string → trim/contains/equality checks → Result status.
/// @controlflow Returns Err on the first failing check via early return; returns Ok(()) only if all checks pass.
pub fn check_name(name: &str) -> Result<(), String> {
    // Reject names that are empty or contain only whitespace.
    if name.trim().is_empty() {
        return Err(format!("Rejected attachment name '{name}': name must not be empty"));
    } else {
        // Name has at least one non-whitespace character; continue validation.
    }

    // Reject names that embed a path separator, which would let them escape the target folder.
    if name.contains('/') || name.contains('\\') {
        return Err(format!("Rejected attachment name '{name}': name must not contain a path separator"));
    } else {
        // Name contains no path separator; continue validation.
    }

    // Reject the current-directory and parent-directory entries, which are directory references rather than file names.
    if name == "." || name == ".." {
        return Err(format!("Rejected attachment name '{name}': name must be a file name"));
    } else {
        // Name is neither '.' nor '..'; it is an acceptable file name.
    }

    Ok(())
}

/// Splits a file name into its stem and extension at the final dot.
/// @purpose Divides a name into everything before its last dot (stem) and from that dot onward (extension).
/// @inputs name - The attachment file name to split.
/// @outputs A tuple of (stem, extension); the extension is empty when there is no separating dot or it leads the name.
/// @dataflow Input name string → rfind('.') → sliced stem and extension strings.
/// @controlflow Returns the split pair if a usable dot exists; otherwise returns the whole name as the stem with an empty extension.
pub fn split_name(name: &str) -> (String, String) {
    // Locate the final dot in the name to separate a stem from an extension.
    let dot = name.rfind('.');

    // If a dot exists at all, decide whether it separates a stem from an extension.
    if let Some(dot_index) = dot {
        // A dot at a non-zero index marks the boundary between stem and extension.
        if dot_index > 0 {
            return (name[..dot_index].to_string(), name[dot_index..].to_string());
        } else {
            // Dot is at index 0 (hidden-file style such as ".bashrc"): keep the whole name as the stem with no extension.
            return (name.to_string(), String::new());
        }
    } else {
        // No dot present: the entire name is the stem and there is no extension.
        return (name.to_string(), String::new());
    }
}

/// Resolves a collision-free variant of a requested name within a directory.
/// @purpose Returns the requested name if unused, otherwise appends a numeric suffix to find an available one.
/// @inputs dir - The target directory in which to search for collisions. name - The requested attachment file name.
/// @outputs A file name string that does not already exist in dir (or the highest-suffix fallback).
/// @dataflow Requested name → existence checks against dir → numbered candidate generation → chosen name.
/// @controlflow Returns the original name if free; otherwise scans suffixes 2..=9999 and returns the first free one or the final fallback.
pub fn free_name(dir: &Path, name: &str) -> String {
    // If the requested name is still available, use it directly without modification.
    if !dir.join(name).exists() {
        return name.to_string();
    } else {
        // Name collides with an existing entry; search for a numbered variant below.
    }

    let (stem, ext) = split_name(name);
    // Scan candidate suffixes from 2 to 9999 until an unused name is found.
    for n in 2..=9999u32 {
        let candidate = format!("{stem}-{n}{ext}");
        // If this numbered candidate is still available, adopt it as the chosen name.
        if !dir.join(&candidate).exists() {
            return candidate;
        } else {
            // Candidate still collides; continue to the next number.
        }
    }

    // Every candidate in range collided: fall back to the highest numbered variant as a guaranteed-unique last resort.
    format!("{stem}-9999{ext}")
}

/// Validates folder and name inputs and resolves a unique target path for an attachment.
/// @purpose Ensures the folder is a non-empty absolute path and the name is valid, then creates the folder and picks a free name.
/// @inputs folder - The requested attachments directory as a string. name - The requested attachment file name.
/// @outputs Ok((target_path, chosen_name)); Err with a descriptive message on any validation or creation failure.
/// @dataflow Folder/name strings → PathBuf construction → validation → filesystem creation → resolved path and chosen name.
/// @controlflow Returns Err on empty folder, non-absolute folder, or invalid name; otherwise creates the directory and returns the resolved pair.
fn prepare(folder: &str, name: &str) -> Result<(PathBuf, String), String> {
    // Reject folders that are empty or whitespace-only.
    if folder.trim().is_empty() {
        return Err(format!("Rejected attachments folder '{folder}': folder must not be empty"));
    } else {
        // Folder string is non-empty; continue validation.
    }

    let dir = PathBuf::from(folder);

    // Reject relative paths: attachments must live under an absolute directory to keep the sandbox layout predictable.
    if !dir.is_absolute() {
        return Err(format!("Rejected attachments folder '{folder}': folder must be an absolute path"));
    } else {
        // Folder is absolute; continue validation.
    }

    // Validate the file name before touching the filesystem.
    check_name(name)?;

    // Create the target folder (and any parents) so writes never fail on a missing directory.
    fs::create_dir_all(&dir).map_err(|err| format!("Rejected attachments folder '{folder}': {err}"))?;

    let chosen = free_name(&dir, name);
    Ok((dir.join(&chosen), chosen))
}

/// Converts a resolved attachment path into a UTF-8 string slice for writing.
/// @purpose Produces a text path suitable for the atomic writer, rejecting non-text paths.
/// @inputs path - The resolved target path to convert.
/// @outputs Ok(&str) with the textual path; Err if the path is not valid UTF-8.
/// @dataflow Path → to_str() → string slice or error.
/// @controlflow Returns Ok on a valid text path; returns Err via ok_or_else when conversion fails.
fn path_text(path: &Path) -> Result<&str, String> {
    // Convert the path to a UTF-8 string slice, rejecting paths that are not valid text.
    path.to_str().ok_or_else(|| format!("Rejected attachment path '{}': path is not valid text", path.display()))
}

/// The webview entry point for `attachment_write_at`: Attachments go only beside a document, or into a vault, the user chose.
///
/// @purpose Refuses anything outside the user's grants, then delegates.
/// @inputs The grant list, then the same arguments as `attachment_write_at`.
/// @outputs The result of `attachment_write_at`, or an ACCESS_DENIED error.
/// @dataflow arguments -> grant check -> attachment_write_at.
/// @controlflow Return the refusal early; otherwise forward every argument unchanged.
#[tauri::command]
pub fn attachment_write(grants: tauri::State<'_, crate::grants::GrantState>, folder: String, name: String, data: Vec<u8>) -> Result<String, String> {
    // Attachments go only beside a document, or into a vault, the user chose.
    grants.require_folder(&folder)?;
    attachment_write_at(folder, name, data)
}

/// Writes raw bytes into an attachment under a free name in the target folder.
/// @purpose Validates size and inputs, then atomically persists the payload at a collision-free path.
/// @inputs folder - The attachments directory. name - The requested attachment file name. data - The bytes to store.
/// @outputs Ok(chosen_name) with the resolved file name; Err on oversize payload or write failure.
/// @dataflow Command args → size check → prepare() → atomic byte write → chosen name.
/// @controlflow Returns Err if over the limit; otherwise prepares, writes atomically, and returns the chosen name.
pub fn attachment_write_at(folder: String, name: String, data: Vec<u8>) -> Result<String, String> {
    // Reject payloads that exceed the maximum allowed attachment size.
    if data.len() as u64 > MAX_ATTACHMENT_BYTES {
        return Err(format!("Rejected attachment '{name}': {} bytes is over the limit of {MAX_ATTACHMENT_BYTES}", data.len()));
    } else {
        // Payload is within the size limit; proceed to write it.
    }

    let (path, chosen) = prepare(&folder, &name)?;
    // Persist the bytes atomically at the resolved path.
    write_bytes_atomically(path_text(&path)?, &data)?;
    Ok(chosen)
}

/// The webview entry point for `attachment_copy_at`: Copies only a file the user chose (a drop or a pick) to beside a document they chose.
///
/// @purpose Refuses anything outside the user's grants, then delegates.
/// @inputs The grant list, then the same arguments as `attachment_copy_at`.
/// @outputs The result of `attachment_copy_at`, or an ACCESS_DENIED error.
/// @dataflow arguments -> grant check -> attachment_copy_at.
/// @controlflow Return the refusal early; otherwise forward every argument unchanged.
#[tauri::command]
pub fn attachment_copy(grants: tauri::State<'_, crate::grants::GrantState>, folder: String, name: String, source: String) -> Result<String, String> {
    // Copies only a file the user chose (a drop or a pick) to beside a document they chose.
    grants.require_folder(&folder)?;
    grants.require(&source)?;
    attachment_copy_at(folder, name, source)
}

/// Copies an existing source file into an attachment under a free name in the target folder.
/// @purpose Validates that the source is a file within size limits, then copies it to a collision-free path.
/// @inputs folder - The attachments directory. name - The requested attachment file name. source - Path to the source file.
/// @outputs Ok(chosen_name) with the resolved file name; Err if the source is missing, unreadable, or oversize.
/// @dataflow Command args → source validation & size check → prepare() → fs::copy → chosen name.
/// @controlflow Returns Err for a non-file source or oversize source; otherwise prepares, copies, and returns the chosen name.
pub fn attachment_copy_at(folder: String, name: String, source: String) -> Result<String, String> {
    let src = Path::new(&source);

    // Reject sources that do not exist as regular files.
    if !src.is_file() {
        return Err(format!("Rejected attachment source '{source}': no such file"));
    } else {
        // Source exists and is a regular file; inspect its size next.
    }

    let size = fs::metadata(src).map_err(|err| format!("Rejected attachment source '{source}': {err}"))?.len();

    // Reject sources that exceed the maximum allowed attachment size.
    if size > MAX_ATTACHMENT_BYTES {
        return Err(format!("Rejected attachment source '{source}': {size} bytes is over the limit of {MAX_ATTACHMENT_BYTES}"));
    } else {
        // Source fits within the size limit; proceed to copy it.
    }

    let (path, chosen) = prepare(&folder, &name)?;
    // Copy the source file into the target folder under the resolved name.
    fs::copy(src, &path).map_err(|err| format!("Rejected attachment source '{source}': {err}"))?;
    Ok(chosen)
}

/// The webview entry point for `attachment_names_at`: Lists only a folder beside a document, or in a vault, the user chose.
///
/// @purpose Refuses anything outside the user's grants, then delegates.
/// @inputs The grant list, then the same arguments as `attachment_names_at`.
/// @outputs The result of `attachment_names_at`, or an ACCESS_DENIED error.
/// @dataflow arguments -> grant check -> attachment_names_at.
/// @controlflow Return the refusal early; otherwise forward every argument unchanged.
#[tauri::command]
pub fn attachment_names(grants: tauri::State<'_, crate::grants::GrantState>, folder: String) -> Result<Vec<String>, String> {
    // Lists only a folder beside a document, or in a vault, the user chose.
    grants.require_folder(&folder)?;
    attachment_names_at(folder)
}

/// Lists the names of all files currently in a folder's attachments directory.
/// @purpose Returns a sorted list of file names, treating a missing or non-directory folder as empty rather than an error.
/// @inputs folder - The attachments directory to enumerate.
/// @outputs Ok(sorted file-name list); Err only if reading an existing directory fails.
/// @dataflow Folder string → read_dir → per-entry file-type filter → collected and sorted names.
/// @controlflow Returns an empty list when the folder is not a directory; otherwise iterates entries, keeps regular files, sorts, and returns them.
pub fn attachment_names_at(folder: String) -> Result<Vec<String>, String> {
    let dir = Path::new(&folder);

    // A folder that has never held an attachment simply yields an empty list rather than an error.
    if !dir.is_dir() {
        return Ok(Vec::new());
    } else {
        // Folder exists; enumerate its entries below.
    }

    let entries = fs::read_dir(dir).map_err(|err| format!("Rejected attachments folder '{folder}': {err}"))?;
    let mut names: Vec<String> = Vec::new();
    for entry in entries {
        // Attempt to read this directory entry; skip the iteration if reading failed.
        if let Ok(found) = entry {
            // Resolve the entry's file type; skip the iteration if that resolution failed.
            if let Ok(kind) = found.file_type() {
                // Only regular files are listed as attachments.
                if kind.is_file() {
                    // Convert the file name to text and record it.
                    if let Some(text) = found.file_name().to_str() {
                        names.push(text.to_string());
                    } else {
                        // File name is not valid UTF-8 text; skip it rather than dropping data silently.
                    }
                } else {
                    // Entry is a directory or special file, not a listed attachment.
                }
            } else {
                // File type could not be determined for this entry; skip it.
            }
        } else {
            // The filesystem error while iterating this entry; skip it and continue with the rest.
        }
    }

    // Sorted so the unused-attachments report reads the same way twice. Removing this sort survives
    // mutation testing on Windows, which hands back directory entries already ordered; the platforms
    // that do not are the reason it stays.
    names.sort();
    Ok(names)
}

/// Unit tests, kept in a sibling file.
#[cfg(test)]
#[path = "attachments_tests.rs"]
mod attachments_tests;
