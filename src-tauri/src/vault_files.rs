//! @file vault_files.rs
//! @purpose Host commands for the K-Doc vault file tree (FR-6.11): listing folders and templates,
//! creating notes and folders, moving or renaming items, and sending items to the platform Recycle Bin.
//!
//! The vault is a folder of Markdown files, and every command here treats that folder as an absolute
//! security boundary: each path is validated to lie strictly inside it before any filesystem mutation runs.
//! Containment is checked against the canonicalized root with `..` and `.` components rejected up front, and
//! symlinks are never followed into a listing or move, so a link cannot point outside the vault or loop back on itself.
//!
//! Creation refuses to overwrite (create_new / create_dir both fail on an existing leaf), matching the rename
//! contract in fileops.rs, and moves refuse overwrites, self-nesting, and escapes from the vault. The Recycle Bin
//! batch is size-capped and every path re-validated before a single item is handed to the shell API.
//!
//! @inputs Webview IPC invoke requests (`vault_list_folders`, `vault_create_note`, `vault_create_folder`,
//!   `vault_move`, `vault_trash`, `vault_list_templates`) containing vault folder and item path strings.
//! @outputs Result<Vec<String>, String> for the folder listing; Result<String, String> for create/move commands;
//!   Result<(), String> acknowledging a Recycle Bin move; Result<Vec<VaultTemplate>, String> for the template listing.
//! @functions
//!   - canonical_root: Validates root is an existing directory and returns its canonical form for containment checks.
//!   - inside_vault: Confirms a target path lies strictly inside the vault without touching it, returning its resolved parent plus name.
//!   - list_folders: Walks the vault collecting every folder's forward-slash relative path, never following symlinks.
//!   - vault_list_folders: Tauri command listing vault folders as relative paths.
//!   - vault_create_note: Creates a new Markdown note with contents, refusing to overwrite an existing leaf.
//!   - vault_create_folder: Creates a new empty folder in the vault, refusing to overwrite an existing leaf.
//!   - vault_move: Moves or renames an item within the vault, refusing overwrites, self-nesting, and escapes.
//!   - validate_trash: Validates every path a Recycle Bin request names before any is moved.
//!   - vault_trash: Tauri command moving validated items to the platform Recycle Bin (async).
//!   - list_templates: Lists Markdown templates in `<vault>/.k-doc/templates/`, not descending into subfolders.
//!   - vault_list_templates: Tauri command listing vault templates using the user's original path spelling.
//! @dataflow Webview IPC invoke -> root validation (canonical_root) -> per-command containment checks (inside_vault) -> host filesystem / shell execution -> IPC Result.
//! @controlflow Webview invokes command -> validate and canonicalize root -> guard each path against the vault boundary -> execute fs or trash operation -> return Ok result or Err naming the rejected path.
//! @version 1
//! @date 2026-09-14

use std::fs;
use std::path::{Component, Path, PathBuf};
use crate::vault::{is_note_extension, is_skipped_dir, relative_path};

/// Most folders one listing returns, for the same reason vault.rs caps notes.
const MAX_FOLDERS: usize = 5_000;
/// Most paths one Recycle Bin request takes.
const MAX_TRASH_PATHS: usize = 1_000;

/// One template a new note can start from: its file name without the extension, and its absolute path.
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct VaultTemplate { pub name: String, pub path: String }

/// Validates root is an existing directory and returns its canonical form.
///
/// The canonical form (symlinks resolved, separators normalized) is what every later containment comparison
/// checks against, so a folder written with `..` or behind a symlinked parent cannot slip past the boundary.
///
/// @purpose Resolves the webview-supplied vault folder string to an existing, canonical directory for containment checks.
/// @inputs root - The vault folder path string supplied by the webview; may use the platform's native separators.
/// @outputs Result<PathBuf, String> - Ok containing the canonicalized directory on success, or Err naming the rejected path.
/// @dataflow root string -> empty check -> is_dir check -> fs::canonicalize -> PathBuf.
/// @controlflow Reject empty input -> reject non-directory -> canonicalize -> return Ok(PathBuf) or Err.
pub(crate) fn canonical_root(root: &str) -> Result<PathBuf, String> {
    // Check whether the vault folder string is only whitespace.
    if root.trim().is_empty() {
        // Empty path: refuse before touching the filesystem so the error names the empty input rather than an OS message.
        return Err(format!("Rejected vault folder '{root}': folder must not be empty"));
    } else {
        // Non-empty path: proceed to verify it is a directory on disk.
    }

    let path = Path::new(root);
    // Check whether the path names an existing directory rather than a file or something absent.
    if !path.is_dir() {
        // Not a directory (or not present): refuse, naming the rejected path so the user can correct it.
        return Err(format!("Rejected vault folder '{root}': no such directory"));
    } else {
        // Path is an existing directory: proceed to canonicalize it for stable containment checks.
    }

    // Resolve symlinks and normalize separators so every later comparison uses one stable form of the root.
    fs::canonicalize(path).map_err(|err| format!("Cannot resolve vault folder '{root}': {err}"))
}

/// Checks that target names a location inside the vault (never the vault itself) without touching the target.
///
/// Returns the canonical form of the target's parent joined with its file name, for comparisons only; callers operate on the original path.
///
/// @purpose Confirms a candidate path lies strictly inside the already-canonical vault root before any mutation.
/// @inputs root - The canonicalized vault directory to contain against (already produced by canonical_root).
/// @inputs target - The candidate absolute path string, which may carry symlinks in its parent chain.
/// @outputs Result<PathBuf, String> - Ok containing the canonical parent joined with the leaf name for containment comparison, or Err naming the rejected path.
/// @dataflow target string -> absolute check -> no dot components -> extract name and parent -> canonicalize parent -> join -> starts_with(root) -> PathBuf.
/// @controlflow Reject non-absolute -> reject dot components -> extract name and parent -> canonicalize parent -> compare containment -> return Ok(resolved) or Err.
pub(crate) fn inside_vault(root: &Path, target: &str) -> Result<PathBuf, String> {
    // Check whether the candidate path is absolute; a relative path would resolve against the host working directory and could point anywhere.
    if !Path::new(target).is_absolute() {
        // Relative path: refuse, naming the rejected path so the user supplies an absolute one.
        return Err(format!("Rejected '{target}': the path must be absolute"));
    } else {
        // Absolute path: proceed to reject dot components that could climb out of the vault.
    }

    // Reject any explicit current ('.') or parent ('..') directory component, which is how a path tries to escape the vault.
    if Path::new(target)
        .components()
        .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
    {
        // Contains '.' or '..': refuse outright rather than resolving it, since these components are the primary escape vector.
        return Err(format!("Rejected '{target}': the path must not contain '.' or '..'"));
    } else {
        // No dot components: proceed to extract the leaf name and parent folder.
    }

    // Extract the final path component as the item's name; a path with no leaf cannot be created, moved, or trashed.
    let name = match Path::new(target).file_name() {
        Some(n) => {
            // Leaf name present: use it for the containment comparison below.
            n
        }
        None => {
            // No file name (e.g. a bare root or trailing separator): refuse, naming the rejected path.
            return Err(format!("Rejected '{target}': the path has no name"));
        }
    };

    // Extract the parent folder; every real item sits inside exactly one folder, and that folder is what gets canonicalized.
    let parent = match Path::new(target).parent() {
        Some(p) => {
            // Parent folder present: proceed to resolve it on disk.
            p
        }
        None => {
            // No parent (only possible for a bare root, already excluded by the absolute check): refuse naming the path.
            return Err(format!("Rejected '{target}': the path has no parent folder"));
        }
    };

    // Resolve the parent directory so symlinks in its chain are expanded; containment is then checked against the canonical vault.
    let canonical_parent = fs::canonicalize(parent).map_err(|err| {
        format!(
            "Rejected '{target}': the folder '{}' cannot be found: {err}",
            parent.display()
        )
    })?;

    // Rejoin the original leaf name onto the resolved parent, giving one path that is either inside the vault or not.
    let resolved = canonical_parent.join(name);

    // Check whether the resolved path lies strictly inside the vault root (not equal to it).
    if !resolved.starts_with(root) || resolved == root {
        // Outside the vault or exactly the vault itself: refuse, since every operation must stay strictly within the vault.
        return Err(format!("Rejected '{target}': it is not inside the vault"));
    } else {
        // Strictly inside the vault: proceed to hand back the resolved path for comparison only.
    }

    // Return the canonical parent joined with the leaf name; callers operate on the original target path, this value is for containment checks.
    Ok(resolved)
}

/// Walks the vault collecting every folder's forward-slash relative path.
///
/// Symlinks are never followed -- a symlink can point outside the vault or back into itself and cause an infinite loop,
/// so only real directories are descended. The walk is capped at MAX_FOLDERS, so a vault opened on a home directory by mistake still finishes.
///
/// @purpose Enumerates every subfolder of the vault as a relative path for the folder tree view (FR-6.11).
/// @inputs root - The canonicalized vault directory whose folders are listed.
/// @outputs Result<Vec<String>, String> - Ok containing one forward-slash relative path per subfolder, sorted case-insensitively, or Err if the vault itself is unreadable.
/// @dataflow Stack of dirs -> read_dir each -> filter real non-skipped directories -> relative_path(root, full) -> collect -> sort -> Vec<String>.
/// @controlflow Pop dir from stack -> read entries (fail fast only at root) -> push child folders onto stack until MAX_FOLDERS or empty -> sort and return.
fn list_folders(root: &Path) -> Result<Vec<String>, String> {
    let mut folders = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        // Read the current directory's entries; an unreadable subfolder is silently skipped, but a vault root that cannot be read is fatal.
        let entries = match fs::read_dir(&dir) {
            Ok(e) => {
                // Directory readable: iterate its entries below.
                e
            }
            Err(err) => {
                // Read failed: if this is the vault root, report it; otherwise skip the unreadable subfolder as the note scan does.
                if dir == root {
                    // Vault root unreadable: return an error naming the folder and OS cause.
                    return Err(format!(
                        "Cannot read vault folder '{}': {err}",
                        root.display()
                    ));
                } else {
                    // Unreadable subfolder: leave it out of the listing and continue with whatever remains on the stack.
                    continue;
                }
            }
        };

        for entry in entries.flatten() {
            // Resolve the entry's file type; an unreadable entry is skipped rather than aborting the whole walk.
            let file_type = match entry.file_type() {
                Ok(t) => {
                    // File type resolved: classify it below.
                    t
                }
                Err(_) => {
                    // File type could not be determined: skip this entry and continue.
                    continue;
                }
            };

            // A symlink is not followed: it can point outside the vault or back into itself, so only real directories are descended.
            if !file_type.is_dir() || file_type.is_symlink() {
                // Not a real directory (a file, symlink, or special file): skip it.
                continue;
            } else {
                // Real directory: proceed to name and containment checks.
            }

            let name = entry.file_name().to_string_lossy().to_string();

            // Skip platform/ignore directories that must never appear in the tree (e.g. .git, node_modules).
            if is_skipped_dir(&name) {
                // Skipped directory: leave it out of the listing and continue.
                continue;
            } else {
                // Not a skipped directory: record its relative path and descend into it.
            }

            let full = entry.path();

            // Record this folder's vault-relative, forward-slash path before descending so capped walks still report what was found.
            folders.push(relative_path(root, &full));

            // Bound the walk from a pathological or hostile vault: once the cap is hit, stop descending and finish collecting.
            if folders.len() >= MAX_FOLDERS {
                // Cap reached: clear the stack to stop descending and break out of this directory's entries.
                stack.clear();
                break;
            } else {
                // Under the cap: descend into this folder by pushing it onto the work stack.
                stack.push(full);
            }
        }
    }

    // Sort case-insensitively so the tree view presents folders in a stable, locale-independent order.
    folders.sort_by_key(|f| f.to_lowercase());

    Ok(folders)
}

/// The webview entry point for `vault_list_folders_at`: Only a vault the user chose is browsed.
///
/// @purpose Refuses anything outside the user's grants, then delegates.
/// @inputs The grant list, then the same arguments as `vault_list_folders_at`.
/// @outputs The result of `vault_list_folders_at`, or an ACCESS_DENIED error.
/// @dataflow arguments -> grant check -> vault_list_folders_at.
/// @controlflow Return the refusal early; otherwise forward every argument unchanged.
#[tauri::command]
pub fn vault_list_folders(grants: tauri::State<'_, crate::grants::GrantState>, root: String) -> Result<Vec<String>, String> {
    // Only a vault the user chose is browsed.
    grants.require_vault(&root)?;
    vault_list_folders_at(root)
}

/// Lists every subfolder of the vault as a forward-slash relative path (FR-6.11).
///
/// @purpose Tauri command exposing the vault folder tree to the webview, validating the root first.
/// @inputs root - The vault folder path string supplied by the webview.
/// @outputs Result<Vec<String>, String> - Ok containing one relative path per subfolder in display order, or Err naming the rejected root.
/// @dataflow root string -> canonical_root -> list_folders(canonical) -> Vec<String>.
/// @controlflow Validate and canonicalize root -> walk vault collecting folders -> return sorted relative paths or error.
pub fn vault_list_folders_at(root: String) -> Result<Vec<String>, String> {
    // Validate the supplied root before walking, so a bad folder is reported without any traversal.
    let canonical = canonical_root(&root)?;

    // Walk the canonical vault; list_folders returns only relative paths, so using the canonical root here is correct.
    list_folders(&canonical)
}

/// The webview entry point for `vault_create_note_at`: Notes are created only inside a vault the user chose.
///
/// @purpose Refuses anything outside the user's grants, then delegates.
/// @inputs The grant list, then the same arguments as `vault_create_note_at`.
/// @outputs The result of `vault_create_note_at`, or an ACCESS_DENIED error.
/// @dataflow arguments -> grant check -> vault_create_note_at.
/// @controlflow Return the refusal early; otherwise forward every argument unchanged.
#[tauri::command]
pub fn vault_create_note(grants: tauri::State<'_, crate::grants::GrantState>, root: String,
    path: String,
    contents: String,) -> Result<String, String> {
    // Notes are created only inside a vault the user chose.
    grants.require_vault(&root)?;
    vault_create_note_at(root, path, contents)
}

/// Creates a new Markdown note at an absolute path inside the vault (FR-6.11).
///
/// Uses create_new so an existing file is never silently overwritten; the contents are written only if the leaf did not already exist.
///
/// @purpose Creates a new note file with initial contents, refusing to overwrite anything already present in the vault.
/// @inputs root - The vault folder path string supplied by the webview.
/// @inputs path - Absolute path of the note to create; must end in .md, .markdown, or .mdown and lie inside the vault.
/// @inputs contents - Initial byte content written into the new note on success.
/// @outputs Result<String, String> - Ok containing the created note's path string, or Err naming the rejected path or write failure.
/// @dataflow (root, path, contents) -> canonical_root -> inside_vault -> extension check -> create_new open -> write bytes -> Ok(path).
/// @controlflow Validate root and containment -> reject non-note extension -> atomically create-or-fail -> write contents -> return Ok(path) or Err.
pub fn vault_create_note_at(
    root: String,
    path: String,
    contents: String,
) -> Result<String, String> {
    // Validate the vault root and confirm the target lies strictly inside it before touching anything on disk.
    let canonical = canonical_root(&root)?;
    inside_vault(&canonical, &path)?;

    let target = Path::new(&path);

    // A note must be Markdown: refuse any other extension so the tree never shows a non-note file created here.
    if !is_note_extension(target) {
        // Non-Markdown extension (or none): refuse, naming the path and the accepted extensions.
        return Err(format!(
            "Cannot create '{path}': a note must end in .md, .markdown or .mdown"
        ));
    } else {
        // Valid Markdown extension: proceed to create the file without overwriting an existing one.
    }

    // Open with create_new so an existing leaf fails rather than being truncated; this is the overwrite guard for notes.
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
    {
        Ok(mut file) => {
            // New note opened for writing: flush the supplied contents and return the path on success.
            use std::io::Write;
            file.write_all(contents.as_bytes())
                .map_err(|err| format!("Failed to write '{path}': {err}"))?;
            Ok(path)
        }
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
            // A leaf with that name already exists: refuse rather than overwrite, naming the path.
            Err(format!(
                "Cannot create '{path}': something with that name is already there"
            ))
        }
        Err(err) => {
            // Any other open failure (permissions, missing parent folder, and so on): report it naming the path and cause.
            Err(format!("Failed to create '{path}': {err}"))
        }
    }
}

/// The webview entry point for `vault_create_folder_at`: Folders are created only inside a vault the user chose.
///
/// @purpose Refuses anything outside the user's grants, then delegates.
/// @inputs The grant list, then the same arguments as `vault_create_folder_at`.
/// @outputs The result of `vault_create_folder_at`, or an ACCESS_DENIED error.
/// @dataflow arguments -> grant check -> vault_create_folder_at.
/// @controlflow Return the refusal early; otherwise forward every argument unchanged.
#[tauri::command]
pub fn vault_create_folder(grants: tauri::State<'_, crate::grants::GrantState>, root: String, path: String) -> Result<String, String> {
    // Folders are created only inside a vault the user chose.
    grants.require_vault(&root)?;
    vault_create_folder_at(root, path)
}

/// Creates a new empty folder at an absolute path inside the vault (FR-6.11).
///
/// @purpose Creates a new subfolder in the vault, refusing to overwrite anything already present.
/// @inputs root - The vault folder path string supplied by the webview.
/// @inputs path - Absolute path of the folder to create; must lie strictly inside the vault.
/// @outputs Result<String, String> - Ok containing the created folder's path string, or Err naming the rejected path or creation failure.
/// @dataflow (root, path) -> canonical_root -> inside_vault -> create_dir -> Ok(path).
/// @controlflow Validate root and containment -> create directory or fail on collision/other error -> return Ok(path) or Err.
pub fn vault_create_folder_at(root: String, path: String) -> Result<String, String> {
    // Validate the vault root and confirm the target lies strictly inside it before creating anything.
    let canonical = canonical_root(&root)?;
    inside_vault(&canonical, &path)?;

    // Create the directory; refuse to overwrite an existing leaf and report any other failure naming the path.
    match fs::create_dir(&path) {
        Ok(()) => {
            // Folder created: return its path string.
            Ok(path)
        }
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
            // A leaf with that name already exists: refuse rather than overwrite, naming the path.
            Err(format!(
                "Cannot create '{path}': something with that name is already there"
            ))
        }
        Err(err) => {
            // Any other creation failure (permissions, missing parent folder, and so on): report it naming the path and cause.
            Err(format!("Failed to create folder '{path}': {err}"))
        }
    }
}

/// The webview entry point for `vault_move_at`: Moves happen only inside a vault the user chose.
///
/// @purpose Refuses anything outside the user's grants, then delegates.
/// @inputs The grant list, then the same arguments as `vault_move_at`.
/// @outputs The result of `vault_move_at`, or an ACCESS_DENIED error.
/// @dataflow arguments -> grant check -> vault_move_at.
/// @controlflow Return the refusal early; otherwise forward every argument unchanged.
#[tauri::command]
pub fn vault_move(grants: tauri::State<'_, crate::grants::GrantState>, root: String, from: String, to: String) -> Result<String, String> {
    // Moves happen only inside a vault the user chose.
    grants.require_vault(&root)?;
    vault_move_at(root, from, to)
}

/// Moves or renames a file or folder within the vault (FR-6.11).
///
/// The source and target must both lie inside the vault; moving outside it is refused, and a move into an existing leaf
/// is refused unless it is only a case change of the same item on Windows/macOS.
///
/// @purpose Moves or renames an item within the vault, refusing overwrites, self-nesting, and escapes from the vault.
/// @inputs root - The vault folder path string supplied by the webview.
/// @inputs from - Absolute source path inside the vault to move or rename.
/// @inputs to - Absolute destination path inside the vault.
/// @outputs Result<String, String> - Ok containing the destination path on success, or Err naming the rejected paths or operation failure.
/// @dataflow (root, from, to) -> identity check -> canonical_root -> inside_vault(source) -> inside_vault(target) -> metadata + collision checks -> fs::rename -> Ok(to).
/// @controlflow Return early if from == to -> validate both endpoints are in the vault -> reject collisions and self-nesting -> execute rename -> return Ok(to) or Err.
pub fn vault_move_at(root: String, from: String, to: String) -> Result<String, String> {
    // Renaming an item to its own path is neither a move nor an error, so answer before any validation runs.
    if from == to {
        // Source and target are identical strings: return Ok without touching the filesystem.
        return Ok(to);
    } else {
        // Paths differ: proceed to validate both endpoints on the vault.
    }

    // Validate the vault root, then confirm both source and target lie strictly inside it before any move is attempted.
    let canonical = canonical_root(&root)?;
    let source = inside_vault(&canonical, &from)?;
    let target = inside_vault(&canonical, &to)?;

    // Read symlink metadata (not following links) so a moved item that has already vanished is reported clearly rather than as an opaque OS error.
    let metadata = fs::symlink_metadata(&from)
        .map_err(|_| format!("Cannot move '{from}': it no longer exists"))?;

    // On Windows and macOS a name differing only in case is the same file, so renaming between cases is allowed and must not be treated as an overwrite.
    let same_file = match (fs::canonicalize(&from), fs::canonicalize(&to)) {
        (Ok(a), Ok(b)) => {
            // Both endpoints canonicalized: they are the same item only if their canonical forms compare equal.
            a == b
        }
        _ => {
            // Either endpoint failed to canonicalize: assume they differ so the collision guard still applies.
            false
        }
    };

    // Check whether something already occupies the destination, treating a same-case rename of the item itself as not an overwrite.
    if Path::new(&to).symlink_metadata().is_ok() && !same_file {
        // Destination exists and is a different item: refuse to overwrite it, naming the target path.
        return Err(format!(
            "Cannot move to '{to}': something with that name is already there"
        ));
    } else {
        // Destination is free (or this is only a case change of the same item): proceed to the self-nesting check.
    }

    // A folder cannot be moved into itself or any descendant, which fs::rename would otherwise report as an opaque error.
    if metadata.is_dir() && target.starts_with(&source) && !same_file {
        // Source is a directory that contains (or equals) the destination: refuse the self-move, naming the source folder.
        return Err(format!(
            "Cannot move the folder '{from}' into itself"
        ));
    } else {
        // Not a self-nesting move: proceed to execute the rename/move.
    }

    // Execute the move; report any failure naming both paths and the OS cause.
    fs::rename(&from, &to)
        .map_err(|err| format!("Failed to move '{from}' to '{to}': {err}"))?;

    // Move succeeded: return the destination path string.
    Ok(to)
}

/// Checks every path a Recycle Bin request names, before any is moved.
///
/// @purpose Validates a batch of trash paths for count limits and in-vault containment before any shell move runs.
/// @inputs root - The canonicalized vault directory to contain against (already produced by canonical_root).
/// @inputs paths - Absolute path strings the webview asks to send to the Recycle Bin.
/// @outputs Result<Vec<PathBuf>, String> - Ok containing one PathBuf per validated input in order, or Err on empty request, over-limit request, out-of-vault path, or missing item.
/// @dataflow (root, paths) -> empty check -> count guard -> per-path inside_vault + existence check -> Vec<PathBuf>.
/// @controlflow Reject empty batch -> reject over-limit batch -> validate each path in order -> return collected paths or error.
pub(crate) fn validate_trash(
    root: &Path,
    paths: &[String],
) -> Result<Vec<PathBuf>, String> {
    // A request with nothing to trash is a caller error worth stating explicitly rather than returning an empty Ok.
    if paths.is_empty() {
        // No paths supplied: refuse, so the webview knows it asked for nothing.
        return Err("Nothing to move to the Recycle Bin".to_string());
    } else {
        // At least one path: proceed to the batch-size guard.
    }

    // Bound how many items one call may move at once, so a runaway selection cannot hand the shell an unbounded sweep.
    if paths.len() > MAX_TRASH_PATHS {
        // Too many paths for one call: refuse, naming how many were requested and what the limit is.
        return Err(format!(
            "Refusing to move {} items to the Recycle Bin at once; the limit is {MAX_TRASH_PATHS}",
            paths.len()
        ));
    } else {
        // Within the batch limit: proceed to validate each path individually.
    }

    let mut checked = Vec::with_capacity(paths.len());

    for path in paths {
        // Confirm each path lies strictly inside the vault before considering it movable; containment is the security boundary.
        inside_vault(root, path)?;

        // Reject a path that names something which has already vanished, so the batch fails loudly instead of silently skipping an item.
        if fs::symlink_metadata(path).is_err() {
            // Item no longer exists: refuse the whole request, naming the missing path.
            return Err(format!(
                "Cannot move '{path}' to the Recycle Bin: it no longer exists"
            ));
        } else {
            // Item still present and inside the vault: accept it for trashing.
        }

        checked.push(PathBuf::from(path));
    }

    Ok(checked)
}

/// The webview entry point for `vault_trash_at`: Only notes inside a vault the user chose can be trashed.
///
/// @purpose Refuses anything outside the user's grants, then delegates.
/// @inputs The grant list, then the same arguments as `vault_trash_at`.
/// @outputs The result of `vault_trash_at`, or an ACCESS_DENIED error.
/// @dataflow arguments -> grant check -> vault_trash_at.
/// @controlflow Return the refusal early; otherwise forward every argument unchanged.
#[tauri::command]
pub async fn vault_trash(grants: tauri::State<'_, crate::grants::GrantState>, root: String, paths: Vec<String>) -> Result<(), String> {
    // Only notes inside a vault the user chose can be trashed.
    grants.require_vault(&root)?;
    vault_trash_at(root, paths).await
}

/// Moves files and folders to the platform's Recycle Bin (FR-6.11). Async so the shell call does not run on the main thread.
///
/// @purpose Sends one or more in-vault items to the OS Recycle Bin, validating them before invoking the platform trash API.
/// @inputs root - The vault folder path string supplied by the webview.
/// @inputs paths - Absolute path strings of the items to send to the Recycle Bin.
/// @outputs Result<(), String> - Ok(()) once all items are handed to the Recycle Bin, or Err naming the rejected paths or trash failure.
/// @dataflow (root, paths) -> canonical_root -> validate_trash -> trash::delete_all -> Result.
/// @controlflow Validate and canonicalize root -> validate each path in batch -> invoke platform trash API -> return Ok(()) or mapped error.
pub async fn vault_trash_at(root: String, paths: Vec<String>) -> Result<(), String> {
    // Validate the vault root, then validate every requested path before any shell move is attempted.
    let canonical = canonical_root(&root)?;
    let checked = validate_trash(&canonical, &paths)?;

    // Hand all validated items to the platform trash API in one call; report failure naming the cause.
    trash::delete_all(&checked)
        .map_err(|err| format!("Failed to move to the Recycle Bin: {err}"))
}

/// Lists the Markdown templates in `<vault>/.k-doc/templates/`, not descending into subfolders.
///
/// @purpose Enumerates the vault's top-level Markdown templates for the "new note from template" UI (FR-6.11).
/// @inputs root - The canonicalized vault directory whose `.k-doc/templates` folder is scanned.
/// @outputs Result<Vec<VaultTemplate>, String> - Ok containing one template per matching file, sorted by name case-insensitively, or an empty list when the templates folder is absent.
/// @dataflow root -> join .k-doc/templates -> is_dir check -> read_dir -> filter Markdown files -> VaultTemplate {name, path} -> sort -> Vec<VaultTemplate>.
/// @controlflow Reject missing templates folder with empty Ok -> read folder -> keep regular Markdown files only -> build and sort templates -> return.
pub(crate) fn list_templates(
    root: &Path,
) -> Result<Vec<VaultTemplate>, String> {
    // The templates live in a conventional subfolder of the vault, one level deep under `.k-doc`.
    let dir = root.join(".k-doc").join("templates");

    // A vault without the folder simply has no templates yet; that is a normal empty result, not an error.
    if !dir.is_dir() {
        // Templates folder absent: return an empty list rather than failing, since absence means "no templates created yet".
        return Ok(Vec::new());
    } else {
        // Templates folder present: proceed to read its entries.
    }

    // Read the templates folder; a present-but-unreadable folder is reported naming it so the user can fix permissions.
    let entries = fs::read_dir(&dir).map_err(|err| {
        format!(
            "Cannot read templates folder '{}': {err}",
            dir.display()
        )
    })?;

    let mut templates = Vec::new();

    for entry in entries.flatten() {
        // Resolve each entry to a full path and confirm it is a regular file (not a subfolder or symlink) before treating it as a template.
        let full = entry.path();
        let is_file = entry
            .file_type()
            .map(|t| t.is_file())
            .unwrap_or(false);

        // Skip anything that is not a Markdown file: non-files and non-note extensions are not templates.
        if !is_file || !is_note_extension(&full) {
            // Not a regular Markdown file: skip it and continue to the next entry.
            continue;
        } else {
            // Regular Markdown file: build its template record from stem name and full path.
        }

        let name = full
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        templates.push(VaultTemplate {
            name,
            path: full.to_string_lossy().to_string(),
        });
    }

    // Sort case-insensitively so the template picker presents names in a stable order.
    templates.sort_by_key(|t| t.name.to_lowercase());

    Ok(templates)
}

/// The webview entry point for `vault_list_templates_at`: Only a vault the user chose has its templates listed.
///
/// @purpose Refuses anything outside the user's grants, then delegates.
/// @inputs The grant list, then the same arguments as `vault_list_templates_at`.
/// @outputs The result of `vault_list_templates_at`, or an ACCESS_DENIED error.
/// @dataflow arguments -> grant check -> vault_list_templates_at.
/// @controlflow Return the refusal early; otherwise forward every argument unchanged.
#[tauri::command]
pub fn vault_list_templates(grants: tauri::State<'_, crate::grants::GrantState>, root: String,) -> Result<Vec<VaultTemplate>, String> {
    // Only a vault the user chose has its templates listed.
    grants.require_vault(&root)?;
    vault_list_templates_at(root)
}

/// Lists the Markdown templates in `<vault>/.k-doc/templates/` (FR-6.11).
///
/// The returned paths use the user's original spelling of the vault rather than the canonical `\\?\` form, so they read naturally in the webview.
///
/// @purpose Tauri command exposing the vault's templates to the webview, validating the root without altering the reported path spelling.
/// @inputs root - The vault folder path string supplied by the webview (used verbatim for returned template paths).
/// @outputs Result<Vec<VaultTemplate>, String> - Ok containing one template per matching file in display order, or Err naming the rejected root.
/// @dataflow root string -> canonical_root (validation only) -> list_templates(Path::new(&root)) -> Vec<VaultTemplate>.
/// @controlflow Validate and canonicalize root for containment -> scan templates using the user's original path spelling -> return sorted templates or error.
pub fn vault_list_templates_at(
    root: String,
) -> Result<Vec<VaultTemplate>, String> {
    // Validate that the root is an existing directory; the canonical form rejects a bad folder but is not used for returned paths.
    canonical_root(&root)?;

    // Scan templates using the user's original spelling so returned paths are readable rather than in the canonical `\\?\` form.
    list_templates(Path::new(&root))
}

#[cfg(test)]
#[path = "vault_files_tests.rs"]
mod tests;
