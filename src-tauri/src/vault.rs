//! @file vault.rs
//! @purpose Directory scan that builds the vault index for K-Doc (FR-6.12, and the enabler for FR-8.12, FR-14.6 and FR-14.7). Walks a user-chosen vault folder recursively and reports every Markdown note it contains, without any general filesystem access — the only read path is this one validated command.
//!
//! Note: This module implements the vault directory scan described in FR-6.12:
//! a vault is simply a folder a person chose, and indexing it means walking that folder
//! recursively and collecting every Markdown note. There is deliberately no general filesystem access here —
//! every read goes through this one validated command, exactly like store.rs.
//!
//! @inputs Webview IPC invoke request (`vault_list_notes`) containing the vault folder path to scan.
//! @outputs Serialized `Vec<VaultNote>` over IPC: absolute paths, forward-slash relative paths, sizes in bytes, and modification times for every note in the vault.
//! @functions
//!   - is_note_extension: Checks whether a file's extension (case-insensitively) is one of the note extensions.
//!   - is_skipped_dir: Checks whether a directory name must never be descended into (dot-directory or known machine dir).
//!   - relative_path: Computes the forward-slash path of a note relative to the vault folder.
//!   - modified_since_epoch: Converts a file's modification time to milliseconds since the Unix epoch, or 0 when unavailable.
//!   - scan_vault: Recursively walks a validated vault folder collecting notes via an explicit stack.
//!   - vault_list_notes: Tauri command validating the folder argument and delegating to scan_vault.
//! @dataflow Webview IPC invoke -> command dispatch -> validate folder -> recursive read_dir walk (skipping dot-dirs, machine dirs, symlinks) -> collect note metadata -> sort by relative path -> serialized Vec<VaultNote> returned over IPC.
//! @controlflow Tauri invoke handler dispatches command -> reject empty/non-directory folder -> scan_vault with explicit stack -> for each entry skip unreadable/symlink/ignored-dir -> collect .md/.markdown/.mdown files until MAX_NOTES then return early -> sort by relative -> return Ok(vector). Returns Err on invalid input.
//! @version 1
//! @date 2026-09-12

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// The extensions K-Doc treats as notes. Compared case-insensitively, because Windows and macOS
/// both hand back whatever case the file was created with.
const NOTE_EXTENSIONS: [&str; 3] = ["md", "markdown", "mdown"];

/// Directories a vault scan never enters. `.k-doc` is K-Doc's own store and holds no notes; the rest
/// are large, machine-generated, and would bury a user's own files in a search.
const SKIPPED_DIRS: [&str; 6] = [".k-doc", ".git", "node_modules", ".obsidian", "target", ".venv"];

/// The most notes one scan will return. A vault is a folder a person chose, but a person can choose
/// their home directory by mistake, and an unbounded walk there would hang the window it was
/// started from. Stopping is better than never finishing; the count is reported either way.
const MAX_NOTES: usize = 20_000;

/// One Markdown file found in a vault.
///
/// @purpose A single indexed note: its location on disk plus lightweight metadata for display and search.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
// Serialized as camelCase so the webview reads one consistent spelling rather than accepting either.
// A contract that tolerates two names is a contract that has not been decided.
#[serde(rename_all = "camelCase")]
pub struct VaultNote {
    /// Absolute path on disk.
    pub path: String,
    /// Path relative to the vault folder, using forward slashes on every platform.
    pub relative: String,
    /// File size in bytes.
    pub size: u64,
    /// Last-modified time in milliseconds since the Unix epoch, or 0 when the platform will not say.
    pub modified_ms: u64,
}

/// Checks whether a file's extension is one of the note extensions, compared case-insensitively.
///
/// @purpose Decides whether a file should be treated as a Markdown note based on its extension.
/// @inputs path - The filesystem Path of the entry being classified.
/// @outputs bool - True if the (lower-cased) extension is "md", "markdown", or "mdown"; false otherwise, including when there is no extension.
/// @dataflow path -> extension() -> to_str -> ascii_lowercase -> membership test against NOTE_EXTENSIONS -> bool.
/// @controlflow Extract extension and convert to str -> if present compare the lower-cased value against the note extensions -> return match result; return false when there is no extension.
pub(crate) fn is_note_extension(path: &Path) -> bool {
    match path.extension().and_then(|ext| ext.to_str()) {
        // Branch: File has an extension; compare it case-insensitively so NOTES.MD counts as a note.
        Some(ext) => NOTE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()),
        // Branch: No extension (e.g. "README" or ".gitignore"); not a note.
        None => false,
    }
}

/// Checks whether a directory name must never be descended into during a vault scan.
///
/// @purpose Filters out hidden directories and known machine-generated / tooling directories so the scan only surfaces the user's own notes.
/// @inputs name - The file name (base name) of the directory being considered.
/// @outputs bool - True if the directory is a dot-directory or one of SKIPPED_DIRS; false otherwise.
/// @dataflow directory name -> dot-prefix check -> then membership test against SKIPPED_DIRS -> bool.
/// @controlflow Check if name starts with '.' -> return true (hidden) -> else test membership in SKIPPED_DIRS -> return result.
pub(crate) fn is_skipped_dir(name: &str) -> bool {
    // A dot-directory is hidden by convention on every platform K-Doc runs on, and a vault's notes are not hidden.
    if name.starts_with('.') {
        // Branch: Name begins with '.'; it is a hidden directory; skip it entirely (never descend).
        return true;
    }

    // Non-dot-directory case: reject only the known large, machine-generated directories that would
    // bury the user's own files in search results.
    SKIPPED_DIRS.contains(&name)
}

/// Computes the path of a note relative to the vault folder, using forward slashes on every platform.
///
/// @purpose Produces a stable, cross-platform relative path so the same vault yields identical relative paths everywhere.
/// @inputs folder - The vault root Path that all scanned entries live under.
/// @inputs full - The absolute Path of a note found during the walk.
/// @outputs String - The note's path with the `folder` prefix removed and every backslash replaced by a forward slash.
/// @dataflow (folder, full) -> strip_prefix(folder) -> to_string_lossy -> replace('\\', "/") -> relative string.
/// @controlflow Strip the vault prefix from the absolute path -> fall back to the full path if stripping fails -> render as lossy string -> replace every backslash with a forward slash -> return.
pub(crate) fn relative_path(folder: &Path, full: &Path) -> String {
    // The entry always lives under folder during this walk, so stripping should succeed;
    // fall back to the full path only if it somehow does not (defensive — never panics).
    let relative = match full.strip_prefix(folder) {
        // Branch: Prefix stripped successfully; use the remaining relative path.
        Ok(rest) => rest.to_path_buf(),
        // Branch: Prefix could not be stripped (should not happen during a walk under folder); fall back to the full path.
        Err(_) => full.to_path_buf(),
    };

    // Render with forward slashes so Windows (`sub\note.md`) and POSIX (`sub/note.md`) agree,
    // giving the same vault the same relative paths on every platform K-Doc runs on.
    relative.to_string_lossy().replace('\\', "/")
}

/// Converts a file's modification time to milliseconds since the Unix epoch, or 0 when unavailable.
///
/// @purpose Normalizes per-platform modification times into a single millisecond timestamp for the index.
/// @inputs metadata - The filesystem Metadata of a note.
/// @outputs u64 - Modification time in milliseconds since the Unix epoch, or 0 if it cannot be determined.
/// @dataflow metadata -> modified() -> duration_since(UNIX_EPOCH) -> as_millis() as u64 (or 0 on any failure).
/// @controlflow Query modification time -> compute duration since epoch -> convert to milliseconds; return 0 when the platform reports no time or the clock is before the epoch.
fn modified_since_epoch(metadata: &std::fs::Metadata) -> u64 {
    match metadata.modified() {
        // Branch: Modification time available; resolve it against the Unix epoch.
        Ok(modified) => match modified.duration_since(UNIX_EPOCH) {
            // Branch: Duration since epoch computed; convert to milliseconds since the epoch.
            Ok(duration) => duration.as_millis() as u64,
            // Branch: Modification time is before the Unix epoch (system clock went backwards); report zero rather than failing.
            Err(_) => 0,
        },
        // Branch: The platform does not expose a modification time; report zero rather than failing.
        Err(_) => 0,
    }
}

/// Recursively walks a validated vault folder and collects every Markdown note it contains.
///
/// @purpose Builds the vault index: an explicit-stack recursive directory walk that skips hidden, machine-generated, and symlinked entries and stops at MAX_NOTES.
/// @inputs folder - The vault root Path to scan; must be an existing directory (caller validated).
/// @outputs Result<Vec<VaultNote>, String> - Ok(vector of notes sorted by relative path), or Err only if the initial read fails (which the caller prevents).
/// @dataflow folder -> explicit stack of PathBuf -> fs::read_dir per directory -> classify each entry -> collect note metadata via helper functions -> sort by relative -> Vec<VaultNote>.
/// @controlflow Push vault root onto stack -> pop a directory -> read its entries, skipping unreadable ones -> for each entry skip symlinks and ignored directories, push real subdirectories, collect matching notes until MAX_NOTES is reached then return early -> after the stack empties sort by relative path -> return Ok(vector).
fn scan_vault(folder: &Path) -> Result<Vec<VaultNote>, String> {
    // Explicit stack of directories still to visit. Using an explicit Vec<PathBuf> rather than a
    // recursive function avoids unbounded call-stack growth on deep vaults, and using std::fs::read_dir
    // (instead of the walkdir crate) adds no new dependency — there is deliberately no general filesystem access in this app.
    let mut stack: Vec<PathBuf> = vec![folder.to_path_buf()];

    // Notes collected so far; capped at MAX_NOTES by an early return below.
    let mut notes: Vec<VaultNote> = Vec::new();

    while let Some(dir) = stack.pop() {
        // Read the directory entries. An entry that cannot be read — a permissions error, or a file deleted mid-walk — is skipped, not fatal:
        // a folder the user cannot read is not a reason to refuse them the rest of their vault.
        let read_dir = match fs::read_dir(&dir) {
            // Branch: Directory opened successfully; iterate its entries.
            Ok(entries) => entries,
            // Branch: Directory could not be opened (permissions, deleted mid-walk); skip it and continue with the rest of the vault.
            Err(_) => continue,
        };

        for entry_res in read_dir {
            // Skip an unreadable directory entry rather than failing the whole scan.
            let entry = match entry_res {
                // Branch: Entry read successfully; classify it.
                Ok(entry) => entry,
                // Branch: Entry could not be read (e.g. deleted mid-walk); skip it rather than failing the scan.
                Err(_) => continue,
            };

            // Determine the entry's type; an unknown type is skipped rather than guessed.
            let file_type = match entry.file_type() {
                // Branch: File type determined; proceed to classification.
                Ok(file_type) => file_type,
                // Branch: File type could not be determined; skip this entry.
                Err(_) => continue,
            };

            // Never follow symlinks: a symlink loop would make the walk never finish, and a symlink pointing outside the vault
            // would index files the user did not put there. This is checked before the dir/file classification so we never descend or read through one.
            if file_type.is_symlink() {
                // Branch: Entry is a symlink; skip it entirely (do not follow).
                continue;
            } else {
                // Branch: Not a symlink; classify as directory, regular file, or something to ignore.
            }

            if file_type.is_dir() {
                // Classify subdirectories by name before deciding whether to descend.
                //
                // The OsString has to be bound to a local first: entry.file_name() returns a temporary,
                // and borrowing a &str out of it inline would leave the borrow outliving the value.
                let dir_name_os = entry.file_name();
                let dir_name = match dir_name_os.to_str() {
                    // Branch: Valid UTF-8 directory name; test it against the skip rules.
                    Some(name) => name,
                    // Branch: Non-UTF-8 directory name; cannot apply the dot rule, so skip descending (never panics).
                    None => continue,
                };

                // Skip hidden directories and known machine-generated / tooling directories entirely.
                if is_skipped_dir(dir_name) {
                    // Branch: Directory is a dot-directory or one of SKIPPED_DIRS; never descend into it.
                    continue;
                } else {
                    // Branch: A normal subdirectory; add it to the stack to visit later.
                }

                stack.push(entry.path());
            } else if file_type.is_file() {
                let path = entry.path();

                // Only Markdown notes are indexed; everything else is ignored.
                if !is_note_extension(&path) {
                    // Branch: File extension is not a note extension; skip it.
                    continue;
                } else {
                    // Branch: File is a note; gather its metadata.
                }

                // Read file metadata for size and modification time; an unreadable file is skipped, not fatal.
                let metadata = match fs::metadata(&path) {
                    // Branch: Metadata read successfully; build the note.
                    Ok(metadata) => metadata,
                    // Branch: Metadata could not be read (permissions, race); skip this note rather than failing the scan.
                    Err(_) => continue,
                };

                // Build the VaultNote with absolute path, normalized relative path, size in bytes, and modification time.
                notes.push(VaultNote {
                    path: path.display().to_string(),
                    relative: relative_path(folder, &path),
                    size: metadata.len(),
                    modified_ms: modified_since_epoch(&metadata),
                });

                // Cap the result: once MAX_NOTES notes are collected, stop scanning cleanly and return what we have.
                // A person can choose their home directory by mistake, so an unbounded walk must never hang the window that started it.
                if notes.len() >= MAX_NOTES {
                    // Branch: Reached the maximum number of notes; return immediately without visiting further directories.
                    return Ok(notes);
                } else {
                    // Branch: Under the cap; keep scanning.
                }
            } else {
                // Branch: Not a directory, regular file, or symlink (e.g. FIFO, socket, device); skip it.
                continue;
            }
        }
    }

    // Sort by relative path so the order is stable between runs rather than whatever the filesystem happened to hand back.
    notes.sort_by(|a, b| a.relative.cmp(&b.relative));

    Ok(notes)
}

/// The webview entry point for `vault_list_notes_at`: Only a vault folder the user chose is listed.
///
/// @purpose Refuses anything outside the user's grants, then delegates.
/// @inputs The grant list, then the same arguments as `vault_list_notes_at`.
/// @outputs The result of `vault_list_notes_at`, or an ACCESS_DENIED error.
/// @dataflow arguments -> grant check -> vault_list_notes_at.
/// @controlflow Return the refusal early; otherwise forward every argument unchanged.
#[tauri::command]
pub fn vault_list_notes(grants: tauri::State<'_, crate::grants::GrantState>, folder: String) -> Result<Vec<VaultNote>, String> {
    // Only a vault folder the user chose is listed.
    grants.require_vault(&folder)?;
    vault_list_notes_at(folder)
}

/// Lists every Markdown note in a vault folder, returning absolute paths, relative paths, sizes, and modification times.
///
/// @purpose The single validated entry point for indexing a vault's notes (FR-6.12); the webview never touches the filesystem directly.
/// @inputs folder - The vault folder path to scan, supplied by the webview over IPC.
/// @outputs Result<Vec<VaultNote>, String> - Ok(vector of VaultNote sorted by relative path), or Err if the folder is empty/whitespace or not an existing directory.
/// @dataflow folder string -> trim check -> Path::new -> is_dir check -> scan_vault -> Vec<VaultNote> returned over IPC.
/// @controlflow Reject empty/whitespace folder -> convert to Path -> reject non-directory (naming it) -> delegate the walk to scan_vault -> return its result.
pub fn vault_list_notes_at(folder: String) -> Result<Vec<VaultNote>, String> {
    // Reject an empty or whitespace-only folder before any filesystem access; a blank path cannot identify a directory.
    if folder.trim().is_empty() {
        // Branch: Folder string is empty or only whitespace; reject with a clear error.
        return Err(format!(
            "Rejected vault folder '{folder}': folder must not be empty"
        ));
    } else {
        // Branch: Folder string is non-empty; proceed to the directory check.
    }

    let path = Path::new(&folder);

    // Reject a path that does not exist or is not a directory, naming it so the user can correct it.
    if !path.is_dir() {
        // Branch: Folder is missing or is a file rather than a directory; reject and name the offending path.
        return Err(format!(
            "Rejected vault folder '{folder}': no such directory"
        ));
    } else {
        // Branch: Folder exists and is a directory; proceed to scan it.
    }

    // Delegate the recursive walk to the testable free function, passing the validated path.
    scan_vault(path)
}

/// Builds the path of a vault's saved index.
///
/// The index lives under `local/` because it is derived data: it is rebuilt from the notes
/// themselves, so committing it would put a large, constantly-churning file into everyone's
/// history to say something the vault already says. The generated `.gitignore` ignores `local/`
/// for exactly that reason.
///
/// @purpose Resolves the standard on-disk path for a vault's persisted index database.
/// @inputs folder - The root Path of the vault.
/// @outputs PathBuf - PathBuf pointing to `<folder>/.k-doc/local/index.db`.
/// @dataflow folder -> join(".k-doc") -> join("local") -> join("index.db") -> PathBuf.
/// @controlflow Construct path by joining vault root with ".k-doc", "local", and "index.db" components -> return PathBuf.
fn index_path(folder: &Path) -> PathBuf {
    folder.join(".k-doc").join("local").join("index.db")
}

/// The webview entry point for `vault_index_read_at`: Only a vault folder the user chose has its index read.
///
/// @purpose Refuses anything outside the user's grants, then delegates.
/// @inputs The grant list, then the same arguments as `vault_index_read_at`.
/// @outputs The result of `vault_index_read_at`, or an ACCESS_DENIED error.
/// @dataflow arguments -> grant check -> vault_index_read_at.
/// @controlflow Return the refusal early; otherwise forward every argument unchanged.
#[tauri::command]
pub fn vault_index_read(grants: tauri::State<'_, crate::grants::GrantState>, folder: String) -> Result<Option<String>, String> {
    // Only a vault folder the user chose has its index read.
    grants.require_vault(&folder)?;
    vault_index_read_at(folder)
}

/// Reads the persisted vault index database file from `<folder>/.k-doc/local/index.db`.
///
/// @purpose Reads the saved index database for a vault (FR-6.12), returning Ok(None) if the index does not exist yet.
/// @inputs folder - The vault root folder path, supplied by the webview over IPC.
/// @outputs Result<Option<String>, String> - Ok(Some(contents)) if present, Ok(None) if absent, or Err on validation or I/O failure.
/// @dataflow folder string -> trim validation -> Path::new -> index_path -> fs::read_to_string -> handle NotFound as Ok(None) -> Ok(Some(contents)).
/// @controlflow Reject empty/whitespace folder -> construct index path -> attempt read_to_string -> return Ok(Some) on success, Ok(None) if NotFound, Err on any other error.
pub fn vault_index_read_at(folder: String) -> Result<Option<String>, String> {
    // Reject an empty or whitespace-only folder before any filesystem access; a blank path cannot identify a directory.
    if folder.trim().is_empty() {
        // Branch: Folder string is empty or only whitespace; reject with a clear error.
        return Err(format!(
            "Rejected vault folder '{folder}': folder must not be empty"
        ));
    } else {
        // Branch: Folder string is non-empty; proceed to read the index.
    }

    let folder_path = Path::new(&folder);
    let target_path = index_path(folder_path);

    // Read the index path as a String.
    match fs::read_to_string(&target_path) {
        Ok(contents) => {
            // Branch: Index file read successfully; return the persisted database string.
            Ok(Some(contents))
        }
        Err(err) => {
            // When the file does not exist, return Ok(None) - a vault that has never been indexed
            // is the ordinary first case, not a failure, and returning an error for it would make
            // every first open look broken.
            if err.kind() == std::io::ErrorKind::NotFound {
                // Branch: Index file does not exist yet; return Ok(None).
                Ok(None)
            } else {
                // Branch: Filesystem error reading index file; return error naming path and cause.
                Err(format!(
                    "Failed to read vault index file '{}': {err}",
                    target_path.display()
                ))
            }
        }
    }
}

/// The webview entry point for `vault_index_write_at`: Only a vault folder the user chose has its index written.
///
/// @purpose Refuses anything outside the user's grants, then delegates.
/// @inputs The grant list, then the same arguments as `vault_index_write_at`.
/// @outputs The result of `vault_index_write_at`, or an ACCESS_DENIED error.
/// @dataflow arguments -> grant check -> vault_index_write_at.
/// @controlflow Return the refusal early; otherwise forward every argument unchanged.
#[tauri::command]
pub fn vault_index_write(grants: tauri::State<'_, crate::grants::GrantState>, folder: String, contents: String) -> Result<(), String> {
    // Only a vault folder the user chose has its index written.
    grants.require_vault(&folder)?;
    vault_index_write_at(folder, contents)
}

/// Persists the vault index database to `<folder>/.k-doc/local/index.db` atomically.
///
/// @purpose Writes the index database for a vault (FR-6.12) via a temporary sibling file and atomic rename.
/// @inputs folder - The vault root folder path, supplied by the webview over IPC.
/// @inputs contents - The serialized index database contents to write.
/// @outputs Result<(), String> - Ok(()) on success, or Err on validation, directory creation, write, or rename failure.
/// @dataflow (folder, contents) -> trim validation -> index_path -> create_dir_all parent -> write to sibling tmp file -> rename over target -> Ok(()).
/// @controlflow Reject empty/whitespace folder -> resolve index_path & parent_dir -> create parent dir -> write contents to index.db.tmp -> rename temp file to index.db -> cleanup temp on error -> return Result.
pub fn vault_index_write_at(folder: String, contents: String) -> Result<(), String> {
    // Reject an empty or whitespace-only folder before any filesystem access; a blank path cannot identify a directory.
    if folder.trim().is_empty() {
        // Branch: Folder string is empty or only whitespace; reject with a clear error.
        return Err(format!(
            "Rejected vault folder '{folder}': folder must not be empty"
        ));
    } else {
        // Branch: Folder string is non-empty; proceed to write the index.
    }

    let folder_path = Path::new(&folder);
    let target_path = index_path(folder_path);

    let parent_dir = match target_path.parent() {
        Some(dir) => dir,
        None => {
            // Branch: Target path has no parent directory; return error.
            return Err(format!(
                "Failed to write vault index '{}': path has no parent directory",
                target_path.display()
            ));
        }
    };

    // Writing the index is the first time opening a vault writes into `.k-doc/`, so this is where the vault gets its
    // layout and the `.gitignore` that keeps machine-local state (this index, snapshots, journals) out of Git.
    crate::store::ensure_vault_layout(folder_path)?;

    // Create the parent directory with fs::create_dir_all, so writing an index works
    // in a folder the user opened as a vault without ever creating annotations in it.
    if let Err(err) = fs::create_dir_all(parent_dir) {
        // Branch: Directory creation failed; return error naming directory and cause.
        return Err(format!(
            "Failed to create vault index directory '{}': {err}",
            parent_dir.display()
        ));
    } else {
        // Branch: Parent directory created or already exists; proceed to write.
    }

    // Write atomically: write to a sibling temporary file index.db.tmp first,
    // then fs::rename it over the real path. A write interrupted partway through would
    // otherwise leave a truncated file that still parses as far as it goes.
    // A name nobody could have prepared in advance, created exclusively, so nothing planted in the vault receives the write.
    let temp_path = crate::atomic::unique_temp_path(parent_dir, std::ffi::OsStr::new("index.db"));

    let written = crate::atomic::create_exclusive(&temp_path).and_then(|mut file| {
        use std::io::Write;
        file.write_all(contents.as_bytes())?;
        file.sync_all()
    });
    if let Err(err) = written {
        // Branch: Write failed; attempt to remove temporary file to avoid leaving litter and return error.
        let _ = fs::remove_file(&temp_path);
        return Err(format!(
            "Failed to write temporary vault index file '{}': {err}",
            temp_path.display()
        ));
    } else {
        // Branch: Temporary file written successfully; proceed to rename.
    }

    // Atomically rename the temporary file over the target path.
    if let Err(err) = fs::rename(&temp_path, &target_path) {
        // Branch: Rename failed; attempt to remove temporary file before returning error.
        let _ = fs::remove_file(&temp_path);
        return Err(format!(
            "Failed to rename temporary file '{}' to vault index file '{}': {err}",
            temp_path.display(),
            target_path.display()
        ));
    } else {
        // Branch: Rename succeeded; atomic index write completed.
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // WHY these tests exist:
    // The vault index is what every search and navigation feature builds on (FR-8.12, FR-14.6, FR-14.7),
    // so the scan that produces it must be correct in isolation before anything else depends on it.
    // Factoring the walk into a private free function plus a thin validated command lets these tests drive
    // the real directory traversal against isolated temporary directories without an active Tauri runtime,
    // pinning the behaviours that are easy to regress: extension matching, directory skipping, symlink safety,
    // cross-platform relative paths, and clean handling of empty or invalid input.

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
            "kdoc-vault-test-{}-{}-{}",
            std::process::id(),
            unique_id,
            suffix
        ));
        let _ = fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn flat_folder_returns_only_notes_sorted_by_relative() {
        // Pins: A flat folder of two .md files and one .txt yields only the two notes, sorted by relative path.
        let root = temp_test_dir("flat");
        fs::write(root.join("alpha.md"), "# Alpha").expect("write alpha.md");
        fs::write(root.join("beta.md"), "# Beta").expect("write beta.md");
        // A non-note file must be ignored entirely.
        fs::write(root.join("notes.txt"), "plain text").expect("write notes.txt");

        let notes = vault_list_notes_at(root.to_str().expect("valid path").to_string())
            .expect("scan should succeed");

        assert_eq!(notes.len(), 2, "Only the two Markdown files should be indexed");

        // Sorted by relative ascending: alpha before beta.
        assert_eq!(notes[0].relative, "alpha.md");
        assert_eq!(notes[1].relative, "beta.md");

        // The absolute path points at the file on disk and metadata is populated.
        assert_eq!(notes[0].path, root.join("alpha.md").display().to_string());
        assert!(notes[0].size > 0, "Size should be the byte length of the file");
        assert!(notes[0].modified_ms > 0, "Modification time should be reported");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn nested_note_has_forward_slash_relative() {
        // Pins: A note in a subdirectory comes back with a forward-slash relative path like `sub/note.md`.
        let root = temp_test_dir("nested");
        let sub = root.join("sub");
        fs::create_dir_all(&sub).expect("create sub directory");
        fs::write(sub.join("note.md"), "# Nested").expect("write nested note");

        let notes = vault_list_notes_at(root.to_str().expect("valid path").to_string())
            .expect("scan should succeed");

        assert_eq!(notes.len(), 1);
        // relative must use forward slashes even on Windows, where the native separator is backslash.
        assert_eq!(notes[0].relative, "sub/note.md");
        assert!(
            !notes[0].relative.contains('\\'),
            "Relative path must not contain a backslash: {}",
            notes[0].relative
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn skips_known_machine_directories() {
        // Pins: `.k-doc` and `.git` subdirectories are never descended into, even when they contain .md files.
        let root = temp_test_dir("skip_machines");
        fs::create_dir_all(root.join(".k-doc")).expect("create .k-doc");
        fs::write(root.join(".k-doc").join("internal.md"), "# store note").expect("write store note");
        fs::create_dir_all(root.join(".git")).expect("create .git");
        fs::write(root.join(".git").join("config.md"), "# git note").expect("write git note");

        let notes = vault_list_notes_at(root.to_str().expect("valid path").to_string())
            .expect("scan should succeed");

        assert_eq!(
            notes.len(),
            0,
            "Machine directories must never be scanned for notes"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn skips_dot_directories() {
        // Pins: A hidden (dot) directory is skipped, while a normal sibling note is still found.
        let root = temp_test_dir("skip_dotdir");
        fs::create_dir_all(root.join(".hidden")).expect("create .hidden");
        fs::write(root.join(".hidden").join("secret.md"), "# hidden").expect("write hidden note");
        // A normal sibling note must still be indexed.
        fs::write(root.join("visible.md"), "# visible").expect("write visible note");

        let notes = vault_list_notes_at(root.to_str().expect("valid path").to_string())
            .expect("scan should succeed");

        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].relative, "visible.md");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn finds_upper_case_note_extensions() {
        // Pins: A file saved as NOTES.MD (and DATA.MARKDOWN) is found because extension matching is case-insensitive.
        let root = temp_test_dir("uppercase");
        fs::write(root.join("NOTES.MD"), "# Upper").expect("write NOTES.MD");
        fs::write(root.join("DATA.MARKDOWN"), "# Markdown upper").expect("write DATA.MARKDOWN");
        // A different extension must still be ignored.
        fs::write(root.join("README.mdown.bak"), "not a note").expect("write .bak file");

        let notes = vault_list_notes_at(root.to_str().expect("valid path").to_string())
            .expect("scan should succeed");

        assert_eq!(notes.len(), 2, "Both upper-case note extensions should be found");
        // Sorted by relative ascending: DATA.MARKDOWN before NOTES.MD.
        assert_eq!(notes[0].relative, "DATA.MARKDOWN");
        assert_eq!(notes[1].relative, "NOTES.MD");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn empty_and_missing_folders_are_errors() {
        // Pins: An empty (or whitespace-only) folder string is an error, and a folder that does not exist is an error naming the path.
        // Empty or whitespace-only input is rejected before any filesystem access.
        assert!(vault_list_notes_at(String::new()).is_err(), "Empty folder must be an error");
        assert!(
            vault_list_notes_at("   ".to_string()).is_err(),
            "Whitespace-only folder must be an error"
        );

        // A path that does not exist on disk is rejected, and the message names it.
        let base = temp_test_dir("missing_check");
        let missing = base.join("nope");
        let result = vault_list_notes_at(missing.to_str().expect("valid path").to_string());
        assert!(result.is_err(), "A non-existent folder must be an error");
        let err = result.unwrap_err();
        assert!(
            err.contains(&missing.display().to_string()),
            "Error should name the missing path, got: {err}"
        );

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn empty_directory_returns_empty_vector() {
        // Pins: An existing but empty folder is valid and yields an empty vector rather than an error.
        let root = temp_test_dir("empty_vault");

        let notes = vault_list_notes_at(root.to_str().expect("valid path").to_string())
            .expect("An existing empty directory must not be an error");

        assert!(notes.is_empty(), "An empty directory yields no notes");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn index_read_returns_none_when_no_index_exists() {
        // Pins: vault_index_read on a folder with no index returns Ok(None).
        let root = temp_test_dir("read_none");
        let folder = root.to_str().expect("valid path").to_string();

        let result = vault_index_read_at(folder).expect("read should succeed");
        assert_eq!(result, None, "Expected None when no index exists");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn index_write_and_read_roundtrips_newlines_and_non_ascii() {
        // Pins: vault_index_write then vault_index_read returns exactly the written string,
        // including when it contains newlines and non-ASCII characters.
        let root = temp_test_dir("roundtrip");
        let folder = root.to_str().expect("valid path").to_string();
        let payload = "line 1\nline 2\r\nnon-ascii: \u{1F980} \u{00E9}\u{00E8}\u{00EA} \u{4E2D}\u{6587}\n".to_string();

        vault_index_write_at(folder.clone(), payload.clone()).expect("write should succeed");

        let result = vault_index_read_at(folder).expect("read should succeed");
        assert_eq!(result, Some(payload), "Read contents must match written payload exactly");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn index_write_creates_local_dir_and_places_file() {
        // Pins: vault_index_write creates .k-doc/local/ when it does not exist,
        // and the file lands at exactly .k-doc/local/index.db.
        let root = temp_test_dir("create_dir");
        let folder = root.to_str().expect("valid path").to_string();
        let expected_file = root.join(".k-doc").join("local").join("index.db");

        assert!(!expected_file.exists(), "Target file must not exist initially");
        assert!(!root.join(".k-doc").exists(), ".k-doc directory must not exist initially");

        vault_index_write_at(folder, "sample index".to_string()).expect("write should succeed");

        assert!(expected_file.is_file(), "index.db must exist as a regular file");
        // Opening a vault also lays out `.k-doc/` and ignores its machine-local half.
        let gitignore = fs::read_to_string(root.join(".k-doc").join(".gitignore")).expect("a generated .gitignore");
        assert!(gitignore.lines().any(|line| line == "local/"), ".gitignore must ignore local/");
        assert_eq!(
            fs::read_to_string(&expected_file).expect("read file"),
            "sample index"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn index_write_replaces_contents_rather_than_appending() {
        // Pins: Writing twice replaces the contents rather than appending.
        let root = temp_test_dir("replace");
        let folder = root.to_str().expect("valid path").to_string();

        vault_index_write_at(folder.clone(), "first version".to_string()).expect("first write should succeed");
        vault_index_write_at(folder.clone(), "second version".to_string()).expect("second write should succeed");

        let result = vault_index_read_at(folder).expect("read should succeed");
        assert_eq!(
            result,
            Some("second version".to_string()),
            "Second write must overwrite the first version without appending"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn index_write_leaves_no_temporary_file() {
        // Pins: After a successful write, no index.db.tmp remains beside it.
        let root = temp_test_dir("no_tmp");
        let folder = root.to_str().expect("valid path").to_string();
        let tmp_file = root.join(".k-doc").join("local").join("index.db.tmp");

        vault_index_write_at(folder.clone(), "data".to_string()).expect("write should succeed");

        assert!(!tmp_file.exists(), "Temporary file index.db.tmp must not exist after write");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn index_commands_reject_empty_and_whitespace_folder() {
        // Pins: Both commands reject an empty folder with an Err, and an all-whitespace folder likewise.
        assert!(
            vault_index_read_at(String::new()).is_err(),
            "vault_index_read must reject empty folder"
        );
        assert!(
            vault_index_read_at("   \t  \n ".to_string()).is_err(),
            "vault_index_read must reject whitespace folder"
        );

        assert!(
            vault_index_write_at(String::new(), "test".to_string()).is_err(),
            "vault_index_write must reject empty folder"
        );
        assert!(
            vault_index_write_at("   \t  \n ".to_string(), "test".to_string()).is_err(),
            "vault_index_write must reject whitespace folder"
        );
    }
}
