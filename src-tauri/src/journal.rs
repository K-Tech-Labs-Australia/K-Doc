//! @file journal.rs
//! @purpose Crash-recovery journal storage for K-Doc (FR-6.3). Unsaved editor buffers are journalled to the app data directory so that after an unclean exit K-Doc can offer to restore them.
//!
//! Note: This module implements crash-recovery journal storage described in FR-6.3:
//! unsaved buffers are periodically persisted to the app data directory so that after
//! an unclean shutdown or crash K-Doc can detect surviving journals and offer to restore them.
//!
//! @inputs Webview IPC invoke requests (`journal_write`, `journal_list`, `journal_clear`) containing buffer IDs, file paths, and document contents.
//! @outputs Persisted journal entry files on disk; serialized `JournalEntry` vectors and Result responses returned over IPC.
//! @functions
//!   - is_valid_id: Validates that a journal identifier is non-empty and contains only characters in `[A-Za-z0-9_-]`.
//!   - journal_dir: Resolves and ensures the existence of the crash-recovery journal directory in the application data directory.
//!   - journal_file: Validates a journal identifier and constructs its full `.json` file path within the journal directory.
//!   - journal_write: Atomically writes an unsaved buffer journal entry to disk via a temporary sibling file.
//!   - journal_list: Enumerates and parses all valid `.json` journal files in the journal directory, skipping corrupt entries.
//!   - journal_clear: Removes a specified journal entry file from disk, treating missing files as success.
//! @dataflow Webview IPC invoke -> command dispatch (`journal_write`, `journal_list`, `journal_clear`) -> path validation & atomic I/O -> serialized Result responses returned over IPC.
//! @controlflow Tauri invoke handler dispatches command -> id validated -> journal directory resolved -> atomic write / directory scan / file removal -> Result returned.
//! @version 1
//! @date 2026-09-05

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// Represents an unsaved editor buffer state stored in the crash-recovery journal.
///
/// @purpose Captures document state and metadata for restoring unsaved work after an unclean exit (FR-6.3).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct JournalEntry {
    /// Unique identifier for the editor buffer session.
    pub id: String,
    /// Destination filesystem path if the buffer was bound to an existing file on disk.
    pub path: Option<String>,
    /// Unsaved text contents of the document buffer.
    pub contents: String,
    /// Unix timestamp in milliseconds when this journal entry was created.
    pub saved_at_ms: u64,
}

/// Validates whether a journal identifier is safe to use as a filename.
///
/// @purpose Enforces character set restrictions to prevent directory traversal and invalid filename characters.
/// @inputs id - The string slice identifier to validate.
/// @outputs bool - Returns true if id is non-empty and contains only characters in `[A-Za-z0-9_-]`, false otherwise.
/// @dataflow Untrusted id slice -> length check -> character set predicate -> boolean validation result.
/// @controlflow Check non-empty -> iterate characters -> verify [A-Za-z0-9_-] membership -> return bool.
fn is_valid_id(id: &str) -> bool {
    // Check if the identifier is empty.
    if id.is_empty() {
        // Branch: Identifier is empty; reject because an empty filename cannot identify a file.
        return false;
    } else {
        // Branch: Identifier is non-empty; proceed to character set validation.
    }

    // Check if all characters in the identifier are ASCII alphanumeric, underscore, or hyphen.
    // Restricting the id strictly to [A-Za-z0-9_-] prevents path traversal sequences (such as '..'),
    // directory separators ('/' or '\\'), dots, and whitespace from escaping the journal directory.
    id.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Resolves and ensures the existence of the application crash-recovery journal directory.
///
/// @purpose Resolves the path to `<app_data_dir>/journal` and creates it if it does not exist.
/// @inputs app - Reference to the Tauri application handle.
/// @outputs Result<PathBuf, String> - Returns the resolved PathBuf on success, or a descriptive error message on failure.
/// @dataflow Tauri app handle -> Manager::path().app_data_dir() -> join "journal" -> fs::create_dir_all -> Ok(PathBuf).
/// @controlflow Query app data directory -> map error -> append "journal" -> create directory if missing -> map error -> return Ok(dir). Returns Err on any failure.
fn journal_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Resolve the application data directory via Tauri's PathResolver.
    // A recovery feature that fails silently is worse than one that is absent,
    // because the user believes their work is protected.
    let app_data = match app.path().app_data_dir() {
        Ok(path) => path,
        Err(err) => {
            // Branch: Failed to resolve app data directory from Tauri host.
            return Err(format!(
                "Failed to resolve application data directory for journal storage: {err}"
            ));
        }
    };

    let dir = app_data.join("journal");

    // Ensure the journal directory exists, creating all parent directories if missing.
    // Failure here must be surfaced immediately with the full path and cause.
    if let Err(err) = fs::create_dir_all(&dir) {
        // Branch: Directory creation failed; return descriptive error naming path.
        return Err(format!(
            "Failed to create crash-recovery journal directory '{}': {err}",
            dir.display()
        ));
    } else {
        // Branch: Journal directory created or already exists; proceed.
    }

    Ok(dir)
}

/// Validates a journal identifier and resolves its destination JSON file path.
///
/// @purpose Validates the id against path traversal and joins it with the journal directory as `<id>.json`.
/// @inputs app - Reference to the Tauri application handle.
/// @inputs id - The journal identifier string slice.
/// @outputs Result<PathBuf, String> - Returns the resolved file PathBuf on success, or an error if invalid.
/// @dataflow id slice -> is_valid_id validation -> journal_dir(app) -> join format!("{id}.json") -> Ok(PathBuf).
/// @controlflow Validate id characters -> resolve journal directory -> join filename -> return Ok(path). Returns Err if validation fails.
fn journal_file(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    // The id becomes a filename, so it must be validated before it touches the filesystem.
    // Rejecting empty ids and characters outside [A-Za-z0-9_-] stops traversal attempts like
    // '../../config' from escaping the journal directory — mirroring the reasoning in save_probe_report.
    if !is_valid_id(id) {
        // Branch: Identifier contains invalid characters or is empty; reject.
        return Err(format!(
            "Rejected journal id '{id}': identifier must be non-empty and contain only ASCII alphanumeric characters, hyphens, or underscores"
        ));
    } else {
        // Branch: Identifier is valid; proceed to resolve target path.
    }

    Ok(journal_dir(app)?.join(format!("{id}.json")))
}

/// Atomically writes an unsaved buffer journal entry to disk.
///
/// @purpose Persists an unsaved buffer's state to disk atomically (FR-6.3) to allow recovery after a crash.
/// @inputs app - The Tauri application handle.
/// @inputs id - The unique identifier of the buffer being journalled.
/// @inputs path - Optional destination filesystem path if the buffer was bound to an existing file.
/// @inputs contents - Unsaved text contents of the buffer.
/// @outputs Result<(), String> - Returns Ok(()) on successful atomic write, or Err with a descriptive message.
/// @dataflow Buffer inputs -> timestamp -> JournalEntry -> serde_json::to_string -> write to .tmp sibling -> sync_all -> rename over target -> Ok(()).
/// @controlflow Resolve target path -> compute timestamp -> build JournalEntry -> serialize to JSON -> create temp file -> write payload -> sync to disk -> close handle -> rename temp to target -> cleanup temp on error -> return Ok(()).
#[tauri::command]
pub fn journal_write(
    app: tauri::AppHandle,
    id: String,
    path: Option<String>,
    contents: String,
) -> Result<(), String> {
    // Resolve destination journal file path, validating the identifier.
    let target_path = journal_file(&app, &id)?;

    // Construct a temporary sibling file in the same directory.
    // Creating the temporary file in the same directory guarantees that the temporary file and target file
    // reside on the same filesystem volume, which is required for an atomic rename.
    let temp_path = target_path.with_extension("tmp");

    // Capture the current timestamp in milliseconds since the UNIX epoch.
    // Map the error rather than unwrapping: a clock before the epoch is absurd,
    // but unwrap in a recovery path is worse because it would panic the host.
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("System clock is before UNIX epoch: {err}"))?;
    let saved_at_ms = duration.as_millis() as u64;

    let entry = JournalEntry {
        id: id.clone(),
        path,
        contents,
        saved_at_ms,
    };

    // Serialize the journal entry to JSON.
    let payload = serde_json::to_string(&entry)
        .map_err(|err| format!("Failed to serialize journal entry for '{id}': {err}"))?;

    // Create the temporary sibling file.
    let mut temp_file = match fs::File::create(&temp_path) {
        Ok(file) => file,
        Err(err) => {
            // Branch: Failed to create temporary file; return error naming path and cause.
            return Err(format!(
                "Failed to create temporary journal file '{}': {err}",
                temp_path.display()
            ));
        }
    };

    // Write all payload bytes to the temporary file.
    if let Err(err) = temp_file.write_all(payload.as_bytes()) {
        // Branch: Write failed; remove the temporary file to prevent littering and return error.
        let _ = fs::remove_file(&temp_path);
        return Err(format!(
            "Failed to write payload to temporary journal file '{}': {err}",
            temp_path.display()
        ));
    } else {
        // Branch: Write succeeded; proceed to flushing file to disk.
    }

    // Flush and sync all file buffers to disk before rename.
    // A journal half-written during a crash is exactly the file recovery would try to read,
    // so writing to a temp file, syncing to disk, and atomically renaming is the point of the whole feature.
    if let Err(err) = temp_file.sync_all() {
        // Branch: sync_all failed; clean up temporary file and return error.
        let _ = fs::remove_file(&temp_path);
        return Err(format!(
            "Failed to sync temporary journal file '{}' to disk: {err}",
            temp_path.display()
        ));
    } else {
        // Branch: sync_all succeeded; proceed to close file handle and rename.
    }

    // Drop file handle before renaming. On Windows, an open handle locks the file and prevents replacement.
    drop(temp_file);

    // Atomically rename the temporary file over the target journal file.
    if let Err(err) = fs::rename(&temp_path, &target_path) {
        // Branch: Rename failed; clean up temporary file and return error.
        let _ = fs::remove_file(&temp_path);
        return Err(format!(
            "Failed to rename temporary file '{}' to journal target '{}': {err}",
            temp_path.display(),
            target_path.display()
        ));
    } else {
        // Branch: Rename succeeded; atomic journal write completed successfully.
    }

    Ok(())
}

/// Lists all surviving crash-recovery journal entries stored on disk.
///
/// @purpose Reads and deserializes all valid journal files (FR-6.3) to present recoverable documents after an unclean exit.
/// @inputs app - The Tauri application handle.
/// @outputs Result<Vec<JournalEntry>, String> - Returns a vector of valid JournalEntry structs, or Err on unreadable directory.
/// @dataflow app handle -> journal_dir -> fs::read_dir -> iterate entries -> filter .json files -> read_to_string -> serde_json::from_str -> Vec<JournalEntry>.
/// @controlflow Resolve journal directory -> read directory entries -> iterate each entry -> skip non-files -> skip non-.json files -> read file string -> parse JSON -> skip unparseable entries -> return Ok(entries).
#[tauri::command]
pub fn journal_list(app: tauri::AppHandle) -> Result<Vec<JournalEntry>, String> {
    let dir = journal_dir(&app)?;

    let read_dir_entries = fs::read_dir(&dir).map_err(|err| {
        format!(
            "Failed to read crash-recovery journal directory '{}': {err}",
            dir.display()
        )
    })?;

    let mut surviving_entries = Vec::new();

    for entry_res in read_dir_entries {
        // Check if directory entry reading succeeded.
        let entry = match entry_res {
            Ok(e) => e,
            Err(_) => {
                // Branch: Failed to read directory entry; skip to avoid failing the whole list.
                continue;
            }
        };

        let path = entry.path();

        // Check if the entry is a regular file.
        let is_file = match entry.file_type() {
            Ok(ft) => ft.is_file(),
            Err(_) => {
                // Branch: Failed to query file type; skip entry.
                false
            }
        };

        if !is_file {
            // Branch: Not a regular file (directory or symlink); skip.
            continue;
        } else {
            // Branch: Regular file; proceed to extension validation.
        }

        // Check if the file has a '.json' extension. Sibling temp files (.tmp) and other files are skipped.
        let has_json_ext = path.extension().and_then(|ext| ext.to_str()) == Some("json");
        if !has_json_ext {
            // Branch: File does not end in '.json'; skip.
            continue;
        } else {
            // Branch: File ends in '.json'; proceed to read file content.
        }

        // Read the journal file content as a string.
        let file_contents = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => {
                // Branch: Could not read file contents (e.g. concurrent deletion); skip.
                continue;
            }
        };

        // Parse JSON into a JournalEntry.
        // Skip unparseable entries rather than failing the whole call:
        // one corrupt journal must not hide every other recoverable document.
        match serde_json::from_str::<JournalEntry>(&file_contents) {
            Ok(journal_entry) => {
                // Branch: Successfully deserialized; retain journal entry.
                surviving_entries.push(journal_entry);
            }
            Err(_) => {
                // Branch: Deserialization failed; skip corrupt entry.
                continue;
            }
        }
    }

    Ok(surviving_entries)
}

/// Clears a crash-recovery journal entry from disk.
///
/// @purpose Removes the specified journal entry file (FR-6.3) upon document save or explicit discard.
/// @inputs app - The Tauri application handle.
/// @inputs id - The identifier of the journal entry to delete.
/// @outputs Result<(), String> - Returns Ok(()) on successful deletion or if the file was already absent, or Err on filesystem failure.
/// @dataflow id -> journal_file -> fs::remove_file -> handle NotFound as Ok -> Ok(()).
/// @controlflow Validate id -> resolve journal file path -> attempt remove_file -> if NotFound return Ok(()) -> if other error return Err -> return Ok(()).
#[tauri::command]
pub fn journal_clear(app: tauri::AppHandle, id: String) -> Result<(), String> {
    // Resolve the journal file path, validating the identifier.
    let path = journal_file(&app, &id)?;

    // Attempt to remove the journal file from disk.
    if let Err(err) = fs::remove_file(&path) {
        // Check if the error is NotFound.
        // Clearing an already-cleared journal is the normal path after a successful save
        // (or when multiple save events occur in quick succession), so a missing file is not an error.
        if err.kind() == std::io::ErrorKind::NotFound {
            // Branch: File does not exist; treat as successful clearance.
            Ok(())
        } else {
            // Branch: Filesystem error other than NotFound (e.g., permission denied); return error.
            Err(format!(
                "Failed to remove journal file '{}': {err}",
                path.display()
            ))
        }
    } else {
        // Branch: File successfully removed.
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // WHY these tests exist:
    // Crash-recovery journal storage is the safety net protecting unsaved user data from being lost.
    // The identifier validation is the security boundary preventing path traversal attacks from escaping
    // the journal directory, and deserialization ensures intact recovery files parse reliably.

    #[test]
    fn accepts_valid_ids() {
        // Pins: is_valid_id accepts identifiers consisting strictly of characters in [A-Za-z0-9_-].
        let valid_ids = ["abc", "a-b_c", "A1"];
        for id in valid_ids {
            assert!(
                is_valid_id(id),
                "Expected is_valid_id to accept '{id}', but it was rejected"
            );
        }
    }

    #[test]
    fn rejects_invalid_ids() {
        // Pins: is_valid_id rejects empty strings, path traversal sequences ('..'),
        // path separators ('/' or '\\'), dots, and whitespace to prevent directory escape.
        let invalid_ids = ["", "../x", "a/b", "a.b", "a b"];
        for id in invalid_ids {
            assert!(
                !is_valid_id(id),
                "Expected is_valid_id to reject '{id}', but it was accepted"
            );
        }
    }

    #[test]
    fn journal_entry_serialization_round_trips() {
        // Pins: JournalEntry serializes and deserializes accurately with serde_json,
        // preserving buffer id, optional path, contents, and timestamp.
        let entry = JournalEntry {
            id: "doc-123_abc".to_string(),
            path: Some("C:\\Users\\test\\document.md".to_string()),
            contents: "# Unsaved document\n\nDraft text.".to_string(),
            saved_at_ms: 1725500000000,
        };

        let json = serde_json::to_string(&entry).expect("serialization should succeed");
        let deserialized: JournalEntry =
            serde_json::from_str(&json).expect("deserialization should succeed");

        assert_eq!(deserialized, entry);
    }

    #[test]
    fn skips_corrupt_entry_during_deserialization() {
        // Pins: Corrupted JSON cannot deserialize into a JournalEntry,
        // verifying the behavior that journal_list relies on to skip unparseable entries.
        let corrupt_json = "{ id: invalid json }";
        let parse_result = serde_json::from_str::<JournalEntry>(corrupt_json);
        assert!(parse_result.is_err());
    }
}
