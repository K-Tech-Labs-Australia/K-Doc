//! @file store.rs
//! @purpose Filesystem half of the annotation store for K-Doc (FR-6.18, FR-6.19, FR-6.20, FR-6.23). Manages discovery, reading, atomic writing, deletion, vault initialization, and migration of document annotations keyed by kdoc_id.
//!
//! Note: Commenting therefore works on a file double-clicked out of Downloads, with no vault and no setup — the fallback is not a degraded mode, it is the default one.
//! Annotations are keyed by the document's kdoc_id (a ULID in its front matter), never by path, so renaming or moving a file never orphans its annotations.
//!
//! @inputs Webview IPC invoke requests (`store_resolve`, `store_read`, `store_write`, `store_delete`) containing document paths, kind strings, kdoc_id ULIDs, and contents payloads.
//! @outputs Persisted annotation JSON files, generated vault layouts and .gitignore files, ResolvedStore metadata, and Result responses returned over IPC.
//! @functions
//!   - validate_kind: Validates that an annotation kind is exactly "comments" or "changes".
//!   - validate_kdoc_id: Validates that an identifier is a 26-character Crockford Base32 string to prevent path traversal.
//!   - find_vault_root: Discovers the nearest `.k-doc` vault store directory by walking up from the document directory.
//!   - global_store_dir: Resolves and ensures the existence of the global fallback store in the application data directory.
//!   - resolve_store_location: Resolves the store location (vault or global fallback) for a given document path.
//!   - read_store_file: Reads an annotation file from a store root, returning an empty string if absent (FR-6.23).
//!   - write_store_file: Atomically writes annotation contents via a temporary sibling file in a store root.
//!   - delete_store_file: Deletes an annotation file from a store root, succeeding if already absent.
//!   - store_resolve: Resolves whether a document uses a local vault or global fallback store and returns ResolvedStore over IPC.
//!   - store_read: Reads an annotation file from the resolved store, delegating to read_store_file.
//!   - store_write: Atomically writes annotation contents to the resolved store, delegating to write_store_file.
//!   - ensure_vault_layout: Creates `<folder>/.k-doc/` with its standard layout and a generated .gitignore, idempotently.
//!   - store_delete: Deletes an annotation file from the resolved store, delegating to delete_store_file.
//! @dataflow Webview IPC invoke -> command dispatch -> path/kind/id validation -> store walk-up/fallback resolution -> atomic filesystem I/O -> serialized Result response returned over IPC.
//! @controlflow Tauri invoke handler dispatches command -> validate kind & kdoc_id -> resolve vault root via walk-up or global fallback -> perform atomic write / read / delete / migration -> Result returned.
//! @version 2
//! @date 2026-09-06

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// Represents the resolved filesystem location of an annotation store.
///
/// @purpose Identifies the store root path on disk and indicates whether it belongs to a local vault or global fallback.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoreLocation {
    /// The store directory itself (e.g. `<vault>/.k-doc` or `<app_data>/store`).
    pub root: PathBuf,
    /// True when found by walk-up discovery from the document path, false for the global fallback store.
    pub is_vault: bool,
}

/// Webview IPC response indicating the resolved store location and vault status.
///
/// @purpose Serialized payload returned over IPC so the webview learns whether a vault or global store is active.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
// Serialized as camelCase so the webview reads one spelling rather than accepting either.
// A contract that tolerates two names is a contract that has not been decided.
#[serde(rename_all = "camelCase")]
pub struct ResolvedStore {
    /// The canonical or resolved filesystem path of the store directory.
    pub root: String,
    /// True when resolved to a vault store found in ancestry, false when using the global fallback.
    pub is_vault: bool,
}

/// Validates that an annotation kind is one of the two permitted directory names.
///
/// @purpose Enforces allowed store partition names ('comments' or 'changes') to prevent arbitrary directory creation.
/// @inputs kind - The string slice identifying the annotation type.
/// @outputs Result<(), String> - Ok(()) if valid, or an Err naming the two valid values.
/// @dataflow kind slice -> exact string comparison -> Ok(()) or Err(String).
/// @controlflow Check if kind == "comments" or "changes" -> return Ok if matched -> return Err naming allowed values if mismatched.
fn validate_kind(kind: &str) -> Result<(), String> {
    // kind must be exactly "comments" or "changes"; anything else is an error naming the two valid values.
    // kind is validated rather than trusted because it becomes a directory name on disk.
    if kind == "comments" || kind == "changes" {
        // Branch: Valid kind ('comments' or 'changes'); proceed.
        Ok(())
    } else {
        // Branch: Invalid kind; reject with descriptive error naming the two permitted values.
        Err(format!(
            "Rejected store kind '{kind}': kind must be exactly 'comments' or 'changes'"
        ))
    }
}

/// Validates whether a document identifier is a valid 26-character Crockford Base32 string.
///
/// @purpose Enforces character set and length constraints on kdoc_id to prevent path-traversal attacks.
/// @inputs id - The string slice identifier to validate.
/// @outputs Result<(), String> - Ok(()) if valid, or an Err with a descriptive error message.
/// @dataflow id slice -> length verification -> character set validation against Crockford Base32 alphabet -> Ok(()) or Err(String).
/// @controlflow Check length == 26 -> verify all chars in [0-9A-HJKMNP-TV-Z] -> return Ok(()) if valid -> return Err if invalid length or character.
fn validate_kdoc_id(id: &str) -> Result<(), String> {
    // kdoc_id must be 26 characters of the Crockford base32 alphabet (0123456789ABCDEFGHJKMNPQRSTVWXYZ).
    // The id becomes a file name (<kdoc_id>.json), so an unvalidated one is a path-traversal hole —
    // '../../' or path separators in an id would write or read outside the store entirely.
    // This is the same class of check save_probe_report and journal_file already make.

    // Check if the identifier is exactly 26 characters in length.
    if id.len() != 26 {
        // Branch: Length is not 26; reject to prevent invalid filenames and malformed ULIDs.
        return Err(format!(
            "Rejected kdoc_id '{id}': identifier must be exactly 26 characters (got {})",
            id.len()
        ));
    } else {
        // Branch: Length is 26; proceed to character set verification.
    }

    // Check if all characters belong to the Crockford Base32 alphabet (digits 0-9 and uppercase letters omitting I, L, O, U).
    let is_crockford = id.chars().all(|c| {
        matches!(
            c,
            '0'..='9' | 'A'..='H' | 'J'..='K' | 'M'..='N' | 'P'..='T' | 'V'..='Z'
        )
    });

    if !is_crockford {
        // Branch: Identifier contains forbidden characters (lowercase, symbols, path separators, or excluded letters I, L, O, U).
        return Err(format!(
            "Rejected kdoc_id '{id}': identifier must contain only uppercase Crockford Base32 characters (0123456789ABCDEFGHJKMNPQRSTVWXYZ)"
        ));
    } else {
        // Branch: All characters are valid Crockford Base32 symbols; validation succeeded.
        Ok(())
    }
}

/// Discovers the nearest `.k-doc/` vault store directory by walking up from the document's directory.
///
/// @purpose Discovers the nearest `.k-doc/` vault store directory by walking up from the document directory, exactly like git discovers `.git` (FR-6.18).
/// @inputs start - Reference to the filesystem Path to begin search from.
/// @outputs Option<PathBuf> - Returns Some(PathBuf) pointing to the discovered `.k-doc` folder, or None if none exists in ancestry.
/// @dataflow start Path -> resolve directory -> iterate parent directories -> check candidate `.k-doc` existence -> Option<PathBuf>.
/// @controlflow Check if start is file/directory -> set current directory -> loop while current dir exists -> test candidate `.k-doc` -> return Some if directory found -> move to parent -> return None when filesystem root reached.
fn find_vault_root(start: &Path) -> Option<PathBuf> {
    // Determine the directory to start walking up from:
    // - If start is an existing regular file, start from its parent directory.
    // - If start does not exist on disk but has a file extension, start from its parent directory.
    // - If start is a directory (or bare root), start from it directly.
    let mut current: Option<&Path> = if start.is_file() {
        // Branch: start path points to an existing file; walk up starting from its parent directory.
        start.parent()
    } else if !start.exists() && start.extension().is_some() {
        // Branch: start path does not exist on disk but has a file extension; assume parent is target directory.
        start.parent()
    } else {
        // Branch: start path is a directory; check candidate starting directly in this directory.
        Some(start)
    };

    // Walk up the directory tree towards the filesystem root.
    while let Some(dir) = current {
        let candidate = dir.join(".k-doc");
        // Check if `.k-doc` exists and is a directory.
        if candidate.is_dir() {
            // Branch: Found enclosing `.k-doc` store directory; return it immediately (nearest vault in ancestry).
            return Some(candidate);
        } else {
            // Branch: Candidate is not a `.k-doc` directory; continue walking up to parent.
        }
        current = dir.parent();
    }

    // Branch: Reached filesystem root without finding any `.k-doc` directory; return None.
    None
}

/// Resolves and ensures the existence of the global fallback store directory in application data.
///
/// @purpose Resolves `<app_data_dir>/store` and creates it if it does not exist (FR-6.18).
/// @inputs app - Reference to the Tauri application handle.
/// @outputs Result<PathBuf, String> - Returns the resolved store directory PathBuf on success, or a descriptive error message on failure.
/// @dataflow app handle -> Manager::path().app_data_dir() -> join "store" -> fs::create_dir_all -> Ok(PathBuf).
/// @controlflow Query app data directory -> map error -> append "store" -> create directory if missing -> map error -> return Ok(dir). Returns Err on any failure.
fn global_store_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Resolve the application data directory via Tauri's PathResolver.
    let app_data = match app.path().app_data_dir() {
        Ok(path) => path,
        Err(err) => {
            // Branch: Failed to resolve app data directory from Tauri host.
            return Err(format!(
                "Failed to resolve application data directory for global annotation store: {err}"
            ));
        }
    };

    let store_dir = app_data.join("store");

    // Ensure the global store directory exists, creating all parent directories if missing.
    if let Err(err) = fs::create_dir_all(&store_dir) {
        // Branch: Directory creation failed; return descriptive error naming path and cause.
        return Err(format!(
            "Failed to create global annotation store directory '{}': {err}",
            store_dir.display()
        ));
    } else {
        // Branch: Global store directory created or already exists; proceed.
    }

    Ok(store_dir)
}

/// Resolves the store location for a document, using walk-up discovery or falling back to the global store.
///
/// @purpose Implements store resolution (FR-6.18): discovers nearest `.k-doc` vault or falls back to global store.
/// @inputs app - Reference to the Tauri application handle.
/// @inputs document_path - Optional string slice specifying the document filesystem path.
/// @outputs Result<StoreLocation, String> - Returns StoreLocation with root PathBuf and is_vault flag.
/// @dataflow document_path -> find_vault_root -> StoreLocation or fallback to global_store_dir -> StoreLocation.
/// @controlflow Check document_path presence and non-empty -> walk up via find_vault_root -> if found return StoreLocation { root, is_vault: true } -> otherwise resolve global_store_dir -> return StoreLocation { root, is_vault: false }.
pub fn resolve_store_location(
    app: &tauri::AppHandle,
    document_path: Option<&str>,
) -> Result<StoreLocation, String> {
    // Check if a document path was provided.
    if let Some(doc_path_str) = document_path {
        // Check if document path string is non-empty.
        if !doc_path_str.trim().is_empty() {
            let path = Path::new(doc_path_str);
            // Walk up directory tree from document location looking for a .k-doc/ folder.
            if let Some(vault_root) = find_vault_root(path) {
                // Branch: Discovered enclosing `.k-doc` vault store directory in document ancestry.
                return Ok(StoreLocation {
                    root: vault_root,
                    is_vault: true,
                });
            } else {
                // Branch: No `.k-doc` directory found in ancestry; fall through to global store.
            }
        } else {
            // Branch: Document path string is empty; fall through to global fallback store.
        }
    } else {
        // Branch: No document path provided (None); fall through to global fallback store.
    }

    // If none exists anywhere up the tree, annotations go to a global fallback store in app data.
    // Commenting therefore works on a file double-clicked out of Downloads, with no vault and no setup —
    // the fallback is not a degraded mode, it is the default one.
    let global_root = global_store_dir(app)?;
    Ok(StoreLocation {
        root: global_root,
        is_vault: false,
    })
}

/// Resolves the store location for a document and returns whether it is a vault or global fallback.
///
/// @purpose Resolves store root and vault status for webview consumption (FR-6.18).
/// @inputs app - The Tauri application handle.
/// @inputs document_path - Optional string path of the document.
/// @outputs Result<ResolvedStore, String> - Returns ResolvedStore with root String and is_vault bool, or Err on failure.
/// @dataflow document_path -> resolve_store_location -> format root to string -> ResolvedStore returned over IPC.
/// @controlflow Resolve store location -> map root PathBuf to String -> construct ResolvedStore -> return Ok.
#[tauri::command]
pub fn store_resolve(
    grants: tauri::State<'_, crate::grants::GrantState>,
    app: tauri::AppHandle,
    document_path: Option<String>,
) -> Result<ResolvedStore, String> {
    // A document's annotation store is found only for a document the user chose.
    if let Some(document) = &document_path {{
        grants.require(document)?;
    }} else {{
        // An untitled document's annotations live in app data, which is K-Doc's own.
    }}
    let location = resolve_store_location(&app, document_path.as_deref())?;
    Ok(ResolvedStore {
        root: location.root.display().to_string(),
        is_vault: location.is_vault,
    })
}

// WHY THIS EXTRACTION WAS DONE:
// The commands are thin because everything worth testing is below them, and a function
// that needs an AppHandle to run is a function that never runs in a test.
// Extracting the filesystem work into private free functions taking a `&Path` store root
// allows integration tests to exercise the real read/write/delete/create/migrate disk operations
// against isolated temporary directories without an active Tauri runtime.

/// Reads an annotation file from the specified store root directory.
///
/// @purpose Reads `<root>/<kind>/<kdoc_id>.json` (FR-6.20, FR-6.23), returning an empty string if the file does not exist.
/// @inputs root - The root directory of the store.
/// @inputs kind - Store partition kind ('comments' or 'changes').
/// @inputs kdoc_id - 26-character Crockford Base32 document identifier.
/// @outputs Result<String, String> - Returns Ok(String) with JSON file content (or empty string if absent), or Err on unreadable file.
/// @dataflow (root, kind, kdoc_id) -> validate kind & id -> target file path -> fs::read_to_string -> handle NotFound -> Ok(String).
/// @controlflow Validate kind -> validate kdoc_id -> construct target path -> read_to_string -> return contents if Ok, empty string if NotFound, Err on other I/O errors.
fn read_store_file(root: &Path, kind: &str, kdoc_id: &str) -> Result<String, String> {
    // Each extracted free function performs its own validation of kind and kdoc_id so a caller cannot skip it.
    validate_kind(kind)?;
    validate_kdoc_id(kdoc_id)?;

    let target_file = root.join(kind).join(format!("{kdoc_id}.json"));

    // Attempt to read the annotation JSON file content as a string.
    match fs::read_to_string(&target_file) {
        Ok(contents) => {
            // Branch: File read succeeded; return the persisted JSON string.
            Ok(contents)
        }
        Err(err) => {
            // Check if the error is NotFound.
            // FR-6.23 requires a missing store to degrade to a plain, correct document:
            // absence is the normal state for a document nobody has annotated, and
            // reporting it as an error would make every first open look like a failure.
            if err.kind() == std::io::ErrorKind::NotFound {
                // Branch: File does not exist yet; return an empty string rather than an error.
                Ok(String::new())
            } else {
                // Branch: Filesystem error other than NotFound (e.g., permission denied).
                // An existing but unreadable file IS an error, and the message must name the path.
                // Absent is a normal state, whereas unreadable is an unexpected fault.
                Err(format!(
                    "Failed to read annotation store file '{}': {err}",
                    target_file.display()
                ))
            }
        }
    }
}

/// Atomically writes an annotation file into the specified store root directory.
///
/// @purpose Persists `<root>/<kind>/<kdoc_id>.json` atomically (FR-6.20) via a temporary sibling file.
/// @inputs root - The root directory of the store.
/// @inputs kind - Store partition kind ('comments' or 'changes').
/// @inputs kdoc_id - 26-character Crockford Base32 document identifier.
/// @inputs contents - Serialized JSON string payload to write.
/// @outputs Result<(), String> - Returns Ok(()) on successful atomic write, or Err on filesystem failure.
/// @dataflow (root, kind, kdoc_id, contents) -> validate inputs -> create parent dir -> write temp file -> sync_all -> rename -> Ok(()).
/// @controlflow Validate kind & kdoc_id -> ensure parent dir exists -> create temp file -> write payload -> sync to disk -> close handle -> rename temp over target -> cleanup temp on error -> return Ok(()).
fn write_store_file(
    root: &Path,
    kind: &str,
    kdoc_id: &str,
    contents: &str,
) -> Result<(), String> {
    // Each extracted free function performs its own validation of kind and kdoc_id so a caller cannot skip it.
    validate_kind(kind)?;
    validate_kdoc_id(kdoc_id)?;

    let parent_dir = root.join(kind);

    // Ensure the kind directory exists (e.g. `<store>/comments` or `<store>/changes`).
    if let Err(err) = fs::create_dir_all(&parent_dir) {
        // Branch: Failed to create kind directory; return error naming path and cause.
        return Err(format!(
            "Failed to create annotation store directory '{}': {err}",
            parent_dir.display()
        ));
    } else {
        // Branch: Directory created or already exists; proceed.
    }

    let target_file = parent_dir.join(format!("{kdoc_id}.json"));

    // Construct a temporary sibling file in the same directory.
    // Creating the temporary file in the same directory guarantees that the temporary file and target file
    // reside on the same filesystem volume, which is required for an atomic rename.
    // A partial write of an annotation file loses annotations, and rename is the only cheap way
    // to make the replacement all-or-nothing.
    // A name nobody could have prepared in advance, created exclusively below, so nothing planted in a vault's
    // .k-doc folder can receive the write.
    let temp_file_path = crate::atomic::unique_temp_path(&parent_dir, std::ffi::OsStr::new(&format!("{kdoc_id}.json")));

    // Create the temporary sibling file.
    let mut temp_file = match crate::atomic::create_exclusive(&temp_file_path) {
        Ok(file) => file,
        Err(err) => {
            // Branch: Failed to create temporary file; return error naming path and cause.
            return Err(format!(
                "Failed to create temporary annotation file '{}': {err}",
                temp_file_path.display()
            ));
        }
    };

    // Write all payload bytes to the temporary file.
    if let Err(err) = temp_file.write_all(contents.as_bytes()) {
        // Branch: Write failed; remove temporary file to prevent littering and return error.
        let _ = fs::remove_file(&temp_file_path);
        return Err(format!(
            "Failed to write contents to temporary annotation file '{}': {err}",
            temp_file_path.display()
        ));
    } else {
        // Branch: Write succeeded; proceed to flushing file buffers to disk.
    }

    // Flush and sync all file buffers to disk before rename.
    // A partial write of an annotation file loses annotations, and syncing to disk ensures
    // the replacement is committed before renaming.
    if let Err(err) = temp_file.sync_all() {
        // Branch: sync_all failed; clean up temporary file and return error.
        let _ = fs::remove_file(&temp_file_path);
        return Err(format!(
            "Failed to sync temporary annotation file '{}' to disk: {err}",
            temp_file_path.display()
        ));
    } else {
        // Branch: sync_all succeeded; proceed to close file handle and rename.
    }

    // Drop file handle before renaming.
    // Explicitly dropping the file handle before fs::rename is mandatory on Windows,
    // where an open handle locks the file and prevents replacement.
    drop(temp_file);

    // Atomically rename the temporary file over the target annotation file.
    if let Err(err) = fs::rename(&temp_file_path, &target_file) {
        // Branch: Rename failed; clean up temporary file and return error.
        let _ = fs::remove_file(&temp_file_path);
        return Err(format!(
            "Failed to rename temporary file '{}' to target annotation file '{}': {err}",
            temp_file_path.display(),
            target_file.display()
        ));
    } else {
        // Branch: Rename succeeded; atomic annotation write completed successfully.
    }

    Ok(())
}

/// Deletes an annotation file from the specified store root directory.
///
/// @purpose Removes `<root>/<kind>/<kdoc_id>.json` (FR-6.20), treating a missing file as success.
/// @inputs root - The root directory of the store.
/// @inputs kind - Store partition kind ('comments' or 'changes').
/// @inputs kdoc_id - 26-character Crockford Base32 document identifier.
/// @outputs Result<(), String> - Returns Ok(()) on successful removal or if already absent, or Err on filesystem failure.
/// @dataflow (root, kind, kdoc_id) -> validate kind & id -> target file path -> fs::remove_file -> handle NotFound as Ok -> Ok(()).
/// @controlflow Validate kind -> validate kdoc_id -> construct target path -> attempt remove_file -> if NotFound return Ok(()) -> if other error return Err -> return Ok(()).
fn delete_store_file(root: &Path, kind: &str, kdoc_id: &str) -> Result<(), String> {
    // Each extracted free function performs its own validation of kind and kdoc_id so a caller cannot skip it.
    validate_kind(kind)?;
    validate_kdoc_id(kdoc_id)?;

    let target_file = root.join(kind).join(format!("{kdoc_id}.json"));

    // Attempt to remove the file from disk.
    if let Err(err) = fs::remove_file(&target_file) {
        // Check if the error is NotFound.
        // Deleting the last annotation should not depend on whether the file happened to exist;
        // if it was already absent, the desired end state (absence) is already satisfied.
        if err.kind() == std::io::ErrorKind::NotFound {
            // Branch: File does not exist; treat as successful deletion.
            Ok(())
        } else {
            // Branch: Filesystem error other than NotFound (e.g. permission denied); return error.
            Err(format!(
                "Failed to delete annotation store file '{}': {err}",
                target_file.display()
            ))
        }
    } else {
        // Branch: File was successfully removed from disk.
        Ok(())
    }
}

/// Reads an annotation file from the resolved document store.
///
/// @purpose Reads `<store>/<kind>/<kdoc_id>.json` (FR-6.20, FR-6.23), returning an empty string if the file does not exist.
/// @inputs app - The Tauri application handle.
/// @inputs document_path - Optional string path of the document.
/// @inputs kind - Store partition kind ('comments' or 'changes').
/// @inputs kdoc_id - 26-character Crockford Base32 document identifier.
/// @outputs Result<String, String> - Returns Ok(String) with JSON file content (or empty string if absent), or Err on unreadable file.
/// @dataflow (document_path, kind, kdoc_id) -> validate kind & id -> resolve store -> read_store_file -> Ok(String).
/// @controlflow Resolve store -> validate kind -> validate kdoc_id -> delegate to read_store_file.
#[tauri::command]
pub fn store_read(
    grants: tauri::State<'_, crate::grants::GrantState>,
    app: tauri::AppHandle,
    document_path: Option<String>,
    kind: String,
    kdoc_id: String,
) -> Result<String, String> {
    // Annotations are read only for a document the user chose.
    if let Some(document) = &document_path {{
        grants.require(document)?;
    }} else {{
        // An untitled document's annotations live in app data, which is K-Doc's own.
    }}
    // Resolve destination store root (vault or global fallback).
    let location = resolve_store_location(&app, document_path.as_deref())?;

    // Validate kind parameter ('comments' or 'changes').
    // kind is validated rather than trusted because it becomes a directory name on disk.
    validate_kind(&kind)?;

    // Validate kdoc_id parameter (26-character Crockford Base32).
    // The id becomes a file name (<kdoc_id>.json), so an unvalidated one is a path-traversal hole —
    // '../../' in an id would write or read outside the store entirely.
    // This is the same class of check save_probe_report already makes.
    validate_kdoc_id(&kdoc_id)?;

    // Delegate to testable free function.
    read_store_file(&location.root, &kind, &kdoc_id)
}

/// Atomically writes an annotation file to the resolved document store.
///
/// @purpose Persists `<store>/<kind>/<kdoc_id>.json` atomically (FR-6.20) via a temporary sibling file.
/// @inputs app - The Tauri application handle.
/// @inputs document_path - Optional string path of the document.
/// @inputs kind - Store partition kind ('comments' or 'changes').
/// @inputs kdoc_id - 26-character Crockford Base32 document identifier.
/// @inputs contents - Serialized JSON string payload to write.
/// @outputs Result<(), String> - Returns Ok(()) on successful atomic write, or Err on filesystem failure.
/// @dataflow (document_path, kind, kdoc_id, contents) -> validate inputs -> resolve store -> write_store_file -> Ok(()).
/// @controlflow Resolve store -> validate kind -> validate kdoc_id -> delegate to write_store_file.
#[tauri::command]
pub fn store_write(
    grants: tauri::State<'_, crate::grants::GrantState>,
    app: tauri::AppHandle,
    document_path: Option<String>,
    kind: String,
    kdoc_id: String,
    contents: String,
) -> Result<(), String> {
    // Annotations are written only for a document the user chose.
    if let Some(document) = &document_path {{
        grants.require(document)?;
    }} else {{
        // An untitled document's annotations live in app data, which is K-Doc's own.
    }}
    // Resolve destination store root (vault or global fallback).
    let location = resolve_store_location(&app, document_path.as_deref())?;

    // Validate kind parameter ('comments' or 'changes').
    // kind is validated rather than trusted because it becomes a directory name on disk.
    validate_kind(&kind)?;

    // Validate kdoc_id parameter (26-character Crockford Base32).
    // The id becomes a file name (<kdoc_id>.json), so an unvalidated one is a path-traversal hole.
    validate_kdoc_id(&kdoc_id)?;

    // Delegate to testable free function.
    write_store_file(&location.root, &kind, &kdoc_id, &contents)
}

/// Deletes an annotation file from the resolved document store.
///
/// @purpose Removes `<store>/<kind>/<kdoc_id>.json` (FR-6.20), treating a missing file as success.
/// @inputs app - The Tauri application handle.
/// @inputs document_path - Optional string path of the document.
/// @inputs kind - Store partition kind ('comments' or 'changes').
/// @inputs kdoc_id - 26-character Crockford Base32 document identifier.
/// @outputs Result<(), String> - Returns Ok(()) on successful removal or if already absent, or Err on filesystem failure.
/// @dataflow (document_path, kind, kdoc_id) -> validate kind & id -> resolve store -> delete_store_file -> Ok(()).
/// @controlflow Resolve store -> validate kind -> validate kdoc_id -> delegate to delete_store_file.
#[tauri::command]
pub fn store_delete(
    grants: tauri::State<'_, crate::grants::GrantState>,
    app: tauri::AppHandle,
    document_path: Option<String>,
    kind: String,
    kdoc_id: String,
) -> Result<(), String> {
    // Annotations are deleted only for a document the user chose.
    if let Some(document) = &document_path {{
        grants.require(document)?;
    }} else {{
        // An untitled document's annotations live in app data, which is K-Doc's own.
    }}
    // Resolve destination store root (vault or global fallback).
    let location = resolve_store_location(&app, document_path.as_deref())?;

    // Validate kind parameter ('comments' or 'changes').
    validate_kind(&kind)?;

    // Validate kdoc_id parameter (26-character Crockford Base32).
    validate_kdoc_id(&kdoc_id)?;

    // Delegate to testable free function.
    delete_store_file(&location.root, &kind, &kdoc_id)
}

/// Creates the standard vault layout and generated `.gitignore` inside `<folder>/.k-doc/`, idempotently.
///
/// Called whenever K-Doc writes a vault's search index, which is the moment opening a vault first writes into
/// `.k-doc/`, so every vault gets the layout and a `.gitignore` that keeps machine-local state out of Git.
///
/// @purpose Creates `<folder>/.k-doc/` (FR-6.19, FR-6.20) idempotently with layout and gitignore.
/// @inputs folder - Filesystem Path of the folder to turn into a vault.
/// @outputs Result<PathBuf, String> - Returns Ok(PathBuf) containing the vault root path (`<folder>/.k-doc`) on success, or Err on failure.
/// @dataflow folder Path -> resolve `<folder>/.k-doc` -> create layout directories -> generate .gitignore if absent -> Ok(vault_root).
/// @controlflow Validate folder non-empty -> construct vault root -> create subdirectories (comments, changes, local/snapshots, local/journal) -> check .gitignore -> write .gitignore if missing -> return Ok(vault_root).
pub fn ensure_vault_layout(folder: &Path) -> Result<PathBuf, String> {
    // Validate folder parameter.
    if folder.as_os_str().is_empty() || folder.to_string_lossy().trim().is_empty() {
        // Branch: Folder path is empty; return descriptive error.
        return Err("Cannot create vault: folder path must not be empty".to_string());
    } else {
        // Branch: Folder path is non-empty; proceed.
    }

    let vault_root = folder.join(".k-doc");

    // Layout (FR-6.20):
    // <store>/
    //   comments/<kdoc_id>.json      shared - commit to git
    //   changes/<kdoc_id>.json       shared - commit to git
    //   .gitignore                  generated; ignores local/
    //   local/
    //     index.db
    //     snapshots/<kdoc_id>/
    //     journal/
    //     state.json
    let comments_dir = vault_root.join("comments");
    let changes_dir = vault_root.join("changes");
    let local_dir = vault_root.join("local");
    let snapshots_dir = local_dir.join("snapshots");
    let journal_dir = local_dir.join("journal");

    // Create the full directory layout.
    // Creating directories where they already exist is idempotent and succeeds.
    for dir in &[&comments_dir, &changes_dir, &snapshots_dir, &journal_dir] {
        if let Err(err) = fs::create_dir_all(dir) {
            // Branch: Failed to create layout directory; return error naming path and cause.
            return Err(format!(
                "Failed to create vault directory '{}': {err}",
                dir.display()
            ));
        } else {
            // Branch: Directory created or already exists; proceed.
        }
    }

    // Generate .gitignore inside .k-doc/ if not already present.
    // Generating .gitignore containing 'local/' and an explanatory comment is what makes
    // "commit the shared half, ignore the rest" the default rather than something each user
    // has to know to configure. Creating a vault where one exists must not fail or overwrite (idempotent).
    let gitignore_path = vault_root.join(".gitignore");
    if !gitignore_path.exists() {
        // Branch: .gitignore does not exist; generate default configuration.
        let gitignore_content = "# Machine-local state and cache: do not commit to version control.\nlocal/\n";
        if let Err(err) = fs::write(&gitignore_path, gitignore_content) {
            // Branch: Failed to write generated .gitignore; return error naming path and cause.
            return Err(format!(
                "Failed to write generated .gitignore in vault '{}': {err}",
                gitignore_path.display()
            ));
        } else {
            // Branch: .gitignore generated successfully.
        }
    } else {
        // Branch: .gitignore already exists; do not overwrite to preserve existing user customizations.
    }

    Ok(vault_root)
}

#[cfg(test)]
mod tests {
    use super::*;

    // WHY these tests exist:
    // The annotation store is the persistence engine for comments and tracked changes.
    // Factoring validation and walk-up into private free functions allows deterministic,
    // isolated testing without needing an active Tauri runtime or AppHandle.
    // Rigorous testing of kdoc_id stops path traversal (e.g. '..'), kind validation prevents
    // arbitrary directory escape, and walk-up tests verify upward .k-doc discovery like git.

    /// Helper to create a collision-resistant unique directory in the system temporary directory.
    ///
    /// @purpose Generates an isolated temporary workspace directory for test execution.
    /// @inputs suffix - Name/label descriptor for the test case.
    /// @outputs PathBuf - PathBuf pointing to the created temporary directory.
    /// @dataflow Process ID + timestamp nanos + suffix -> formatted directory path -> fs::create_dir_all -> PathBuf.
    /// @controlflow Resolve system temp dir -> format unique directory name -> create directory -> return PathBuf.
    fn temp_test_dir(suffix: &str) -> PathBuf {
        let unique_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "kdoc-store-test-{}-{}-{}",
            std::process::id(),
            unique_id,
            suffix
        ));
        let _ = fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn accepts_valid_kdoc_id() {
        // Pins: validate_kdoc_id accepts a canonical 26-character Crockford Base32 ULID.
        let valid_id = "01AN4Z07BY79KA1307SR9X4MV3";
        assert!(
            validate_kdoc_id(valid_id).is_ok(),
            "Expected valid Crockford Base32 ULID to be accepted"
        );
    }

    #[test]
    fn rejects_invalid_kdoc_ids() {
        // Pins: validate_kdoc_id rejects invalid lengths, traversal characters ('..'),
        // path separators ('/' and '\\'), lowercase characters, and forbidden Crockford letters (I, L, O, U).
        let invalid_ids = [
            "",                              // empty
            "01AN4Z07BY79KA1307SR9X4MV",     // 25 characters (too short)
            "01AN4Z07BY79KA1307SR9X4MV33",   // 27 characters (too long)
            "../../escaped/id/path12345",    // traversal with '..' and '/'
            "01AN4Z07BY79KA1307SR9X..34",    // contains '..'
            "01AN4Z07BY79KA1307SR9X/MV3",    // contains '/'
            "01AN4Z07BY79KA1307SR9X\\MV3",   // contains '\\'
            "01an4z07by79ka1307sr9x4mv3",    // lowercase Crockford
            "01AN4Z07BY79KA1307SR9X4MVI",    // contains forbidden 'I'
            "01AN4Z07BY79KA1307SR9X4MVL",    // contains forbidden 'L'
            "01AN4Z07BY79KA1307SR9X4MVO",    // contains forbidden 'O'
            "01AN4Z07BY79KA1307SR9X4MVU",    // contains forbidden 'U'
        ];

        for invalid in invalid_ids {
            let res = validate_kdoc_id(invalid);
            assert!(
                res.is_err(),
                "Expected validate_kdoc_id to reject '{invalid}', but got Ok"
            );
        }
    }

    #[test]
    fn validates_kind_values() {
        // Pins: validate_kind accepts strictly 'comments' and 'changes', rejecting all others.
        assert!(
            validate_kind("comments").is_ok(),
            "Expected 'comments' kind to be valid"
        );
        assert!(
            validate_kind("changes").is_ok(),
            "Expected 'changes' kind to be valid"
        );

        let invalid_kinds = ["snapshots", "journal", "../comments", "", "other"];
        for invalid in invalid_kinds {
            assert!(
                validate_kind(invalid).is_err(),
                "Expected validate_kind to reject '{invalid}'"
            );
        }
    }

    #[test]
    fn walk_up_finds_vault_in_parent_directory() {
        // Pins: find_vault_root discovers a `.k-doc/` directory in a parent directory,
        // exactly matching how git discovers `.git`.
        let root = temp_test_dir("walk_up_parent");
        let repo_dir = root.join("my_repo");
        let vault_dir = repo_dir.join(".k-doc");
        let sub_doc = repo_dir.join("docs").join("guides").join("chapter1.md");

        fs::create_dir_all(&vault_dir).expect("should create vault dir");
        fs::create_dir_all(sub_doc.parent().unwrap()).expect("should create doc parent dir");
        fs::write(&sub_doc, "# Chapter 1").expect("should create doc file");

        let discovered = find_vault_root(&sub_doc);
        assert_eq!(
            discovered,
            Some(vault_dir),
            "Expected find_vault_root to discover enclosing .k-doc in parent directory"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn walk_up_finds_nearest_vault_in_ancestry() {
        // Pins: When two `.k-doc` vaults exist in the same ancestry, find_vault_root
        // discovers the nearest one rather than the top-level one.
        let root = temp_test_dir("walk_up_nearest");
        let outer_vault = root.join("outer_vault");
        let outer_kdoc = outer_vault.join(".k-doc");

        let inner_vault = outer_vault.join("nested").join("inner_vault");
        let inner_kdoc = inner_vault.join(".k-doc");

        let target_doc = inner_vault.join("notes").join("meeting.md");

        fs::create_dir_all(&outer_kdoc).expect("should create outer .k-doc");
        fs::create_dir_all(&inner_kdoc).expect("should create inner .k-doc");
        fs::create_dir_all(target_doc.parent().unwrap()).expect("should create target parent");
        fs::write(&target_doc, "# Notes").expect("should create target file");

        let discovered = find_vault_root(&target_doc);
        assert_eq!(
            discovered,
            Some(inner_kdoc),
            "Expected find_vault_root to discover the nearest .k-doc in ancestry"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn walk_up_returns_none_when_no_vault() {
        // Pins: find_vault_root returns None when no `.k-doc` folder exists anywhere up to root.
        let root = temp_test_dir("walk_up_none");
        let standalone_doc = root.join("downloads").join("untitled.md");

        fs::create_dir_all(standalone_doc.parent().unwrap()).expect("should create parent dir");
        fs::write(&standalone_doc, "# Untracked").expect("should create file");

        let discovered = find_vault_root(&standalone_doc);
        assert_eq!(
            discovered, None,
            "Expected find_vault_root to return None when no .k-doc folder exists"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn resolved_store_serialization_round_trips() {
        // Pins: ResolvedStore serializes and deserializes cleanly with serde_json.
        let store = ResolvedStore {
            root: "C:\\Users\\test\\.k-doc".to_string(),
            is_vault: true,
        };

        let json = serde_json::to_string(&store).expect("serialization should succeed");
        let deserialized: ResolvedStore =
            serde_json::from_str(&json).expect("deserialization should succeed");

        assert_eq!(deserialized, store);
    }

    #[test]
    fn write_then_read_round_trips_exactly() {
        // Pins: write_store_file followed by read_store_file round-trips payload with newlines and non-ASCII.
        let root = temp_test_dir("round_trip");
        let kdoc_id = "01AN4Z07BY79KA1307SR9X4MV3";
        let payload = "{\n  \"text\": \"Hello, world! 🌍 — non-ASCII and newlines\\nLine 2\"\n}\n";

        let write_res = write_store_file(&root, "comments", kdoc_id, payload);
        assert!(write_res.is_ok(), "Expected write_store_file to succeed");

        let read_res = read_store_file(&root, "comments", kdoc_id);
        assert_eq!(
            read_res,
            Ok(payload.to_string()),
            "Expected read_store_file to return exact written contents"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn read_nonexistent_file_returns_empty_string() {
        // Pins FR-6.23: absence is the normal state for a document nobody has annotated.
        let root = temp_test_dir("read_nonexistent");
        let kdoc_id = "01AN4Z07BY79KA1307SR9X4MV3";

        let read_res = read_store_file(&root, "comments", kdoc_id);
        assert_eq!(
            read_res,
            Ok(String::new()),
            "Expected read of non-existent file to return empty string per FR-6.23"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn write_creates_kind_directory_when_missing() {
        // Pins: write_store_file creates the kind directory when it does not exist.
        let root = temp_test_dir("create_kind_dir");
        let kind_dir = root.join("changes");
        assert!(!kind_dir.exists(), "Precondition: changes directory must not exist yet");

        let kdoc_id = "01AN4Z07BY79KA1307SR9X4MV3";
        let write_res = write_store_file(&root, "changes", kdoc_id, "{\"test\": true}");
        assert!(write_res.is_ok(), "write_store_file should succeed");
        assert!(kind_dir.is_dir(), "Expected write_store_file to create kind directory");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn write_is_atomic_and_leaves_no_temp_file() {
        // Pins: write_store_file is atomic and cleans up temporary sibling file after rename.
        let root = temp_test_dir("write_atomic");
        let kdoc_id = "01AN4Z07BY79KA1307SR9X4MV3";
        let payload = "{\"atomic\": true}";

        let write_res = write_store_file(&root, "comments", kdoc_id, payload);
        assert!(write_res.is_ok(), "write_store_file should succeed");

        let target_file = root.join("comments").join(format!("{kdoc_id}.json"));
        let temp_file = root.join("comments").join(format!("{kdoc_id}.tmp"));

        assert!(target_file.exists(), "Target file must exist after write");
        // A leftover temporary file means the rename did not happen and the write was not atomic after all.
        assert!(!temp_file.exists(), "Expected no .tmp file remaining beside target after atomic write");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn overwriting_replaces_contents() {
        // Pins: write_store_file replaces existing contents rather than appending.
        let root = temp_test_dir("overwrite");
        let kdoc_id = "01AN4Z07BY79KA1307SR9X4MV3";

        write_store_file(&root, "comments", kdoc_id, "first content")
            .expect("initial write should succeed");
        write_store_file(&root, "comments", kdoc_id, "second content")
            .expect("overwrite should succeed");

        let read_res = read_store_file(&root, "comments", kdoc_id);
        assert_eq!(
            read_res,
            Ok("second content".to_string()),
            "Expected overwriting to replace content, not append"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_removes_file_and_succeeds_when_absent() {
        // Pins: delete_store_file removes existing file and succeeds gracefully when file is already absent.
        let root = temp_test_dir("delete_file");
        let kdoc_id = "01AN4Z07BY79KA1307SR9X4MV3";

        // Deleting when absent succeeds.
        let del_absent = delete_store_file(&root, "comments", kdoc_id);
        assert!(del_absent.is_ok(), "Deleting absent file must succeed");

        // Write file, then delete.
        write_store_file(&root, "comments", kdoc_id, "to be deleted")
            .expect("write should succeed");
        let target = root.join("comments").join(format!("{kdoc_id}.json"));
        assert!(target.exists(), "Precondition: file must exist before delete");

        let del_existing = delete_store_file(&root, "comments", kdoc_id);
        assert!(del_existing.is_ok(), "Deleting existing file must succeed");
        assert!(!target.exists(), "File must no longer exist after delete");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn path_traversal_refused_at_file_layer() {
        // Pins: write_store_file refuses kdoc_id with traversal characters and creates nothing.
        let root = temp_test_dir("traversal_guard");
        let traversal_id = "01AN4Z07BY79KA1307SR9X..34";

        // Validating in the free function rather than only in the command is what makes the guard hold no matter who calls it.
        let write_res = write_store_file(&root, "comments", traversal_id, "malicious payload");
        assert!(
            write_res.is_err(),
            "write_store_file must reject kdoc_id containing '..'"
        );

        // Assert that nothing was created inside root.
        let comments_dir = root.join("comments");
        assert!(
            !comments_dir.exists(),
            "write_store_file must create nothing when validation fails"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn ensure_vault_layout_creates_full_layout_and_gitignore() {
        // Pins: ensure_vault_layout creates comments, changes, local/snapshots, local/journal, and .gitignore.
        let root = temp_test_dir("vault_layout");
        let folder = root.join("vault_root");

        let layout_res = ensure_vault_layout(&folder);
        assert!(layout_res.is_ok(), "ensure_vault_layout should succeed");
        let vault_root = layout_res.unwrap();

        assert_eq!(vault_root, folder.join(".k-doc"));
        assert!(vault_root.join("comments").is_dir(), "comments/ directory must exist");
        assert!(vault_root.join("changes").is_dir(), "changes/ directory must exist");
        assert!(vault_root.join("local").join("snapshots").is_dir(), "local/snapshots/ directory must exist");
        assert!(vault_root.join("local").join("journal").is_dir(), "local/journal/ directory must exist");

        let gitignore_path = vault_root.join(".gitignore");
        assert!(gitignore_path.is_file(), ".gitignore must exist");
        let gitignore_content = fs::read_to_string(&gitignore_path).expect("read gitignore");
        assert!(
            gitignore_content.contains("local/"),
            "Expected .gitignore to contain 'local/'"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn ensure_vault_layout_is_idempotent_and_preserves_custom_gitignore() {
        // Pins: ensure_vault_layout is idempotent and does not overwrite user's customized .gitignore.
        let root = temp_test_dir("vault_idempotent");
        let folder = root.join("vault_root");

        ensure_vault_layout(&folder).expect("first layout creation should succeed");

        let gitignore_path = folder.join(".k-doc").join(".gitignore");
        let custom_content = "# User custom gitignore rule\n*.log\nlocal/\n";
        fs::write(&gitignore_path, custom_content).expect("write custom gitignore");

        // Second run must be idempotent and not clobber custom content.
        // A vault command that clobbers a user's own gitignore is worse than one that does nothing.
        let second_res = ensure_vault_layout(&folder);
        assert!(second_res.is_ok(), "second ensure_vault_layout call must succeed");

        let final_content = fs::read_to_string(&gitignore_path).expect("read gitignore after second run");
        assert_eq!(
            final_content,
            custom_content,
            "Expected custom .gitignore to be preserved across repeated ensure_vault_layout calls"
        );

        let _ = fs::remove_dir_all(&root);
    }
}
