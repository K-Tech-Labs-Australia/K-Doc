//! @file fileops.rs
//! @purpose Host filesystem and shell operations for K-Doc (FR-6.1). Provides Tauri IPC commands to safely rename files without overwriting and to reveal files in the platform file manager.
//!
//! Both operations are the host's to do because both are about the filesystem and the shell,
//! neither of which the webview can reach.
//!
//! Rename is not "save under a new name". Save As leaves the original where it was; rename moves the
//! document and leaves nothing behind, so the two are different promises and a user who picked one would be
//! surprised to get the other.
//!
//! A rename refuses to overwrite. `std::fs::rename` silently replaces an existing target on both Windows
//! and POSIX, and a rename that destroys a file the user did not name is the kind of data loss that is noticed
//! a week later.
//!
//! @inputs Webview IPC invoke requests (`rename_file`, `reveal_in_file_manager`) containing filesystem path strings.
//! @outputs Result<String, String> returning the new path on successful rename; Result<(), String> acknowledging file manager launch.
//! @functions
//!   - rename_file: Renames a file from a source path to a destination path, strictly refusing to overwrite existing files.
//!   - reveal_in_file_manager: Opens the host system file manager with the specified file selected.
//!   - paths_exist: Reports whether each of up to MAX_PROBE_PATHS absolute paths is an existing file, without reading any.
//! @dataflow Webview IPC invoke -> path validation (existence, collision, parent checks) -> host filesystem / process execution -> IPC Result.
//! @controlflow Webview invokes command -> guards check path identity, source existence, destination collision, and folder existence -> host executes rename or spawns file manager -> Result returned over IPC.
//! @version 2
//! @date 2026-09-14

use std::path::Path;

/// Renames a file from an existing path to a new path, refusing to overwrite an existing file.
///
/// Returns the new path on success, so the caller does not have to reconstruct it.
///
/// @purpose Moves/renames a document on the filesystem while strictly preventing accidental data loss from overwriting.
/// @inputs from - The current filesystem path string of the file to rename.
/// @inputs to - The new desired filesystem path string.
/// @outputs Result<String, String> - Returns Ok containing the new path string on success, or Err with a descriptive message on validation/rename failure.
/// @dataflow (from, to) -> equality check -> source existence check -> target existence guard -> parent directory validation -> std::fs::rename -> Ok(to).
/// @controlflow Check from == to -> validate source exists -> validate target does not exist -> validate target parent exists -> execute fs::rename -> return Ok(to) or Err.
#[tauri::command]
pub fn rename_file(grants: tauri::State<'_, crate::grants::GrantState>, from: String, to: String) -> Result<String, String> {
    // The file being renamed must be one the user chose.
    grants.require(&from)?;
    let same_folder = match (crate::grants::normalise(&from), crate::grants::normalise(&to)) {
        (Some(a), Some(b)) => a.parent().map(crate::grants::key) == b.parent().map(crate::grants::key),
        _ => false,
    };
    // A rename keeps the file where it is: moving it to another folder is not something the webview may do.
    if !same_folder {
        return Err(format!("{}{to}", crate::grants::ACCESS_DENIED_PREFIX));
    } else {
        // Same folder: carry on.
    }
    let renamed = rename_file_at(from, to)?;
    // The file under its new name is the same document the user chose, so access follows it.
    grants.grant_file(std::path::Path::new(&renamed))?;
    Ok(renamed)
}

/// Renames a file without consulting the grant list; the command above is the only webview entry point.
///
/// @purpose The rename itself, callable from tests.
/// @inputs from, to - Current and new paths.
/// @outputs Result<String, String> - The new path, or an error.
/// @dataflow (from, to) -> validation -> fs::rename -> to.
/// @controlflow Refuse identical paths, a missing source, an existing target or a missing parent; otherwise rename.
pub fn rename_file_at(from: String, to: String) -> Result<String, String> {
    // Check if the source and target paths are identical strings.
    // Renaming a file to its own name is not an error and not a move either,
    // so return Ok with the target path before anything else.
    if from == to {
        // Both paths are identical: return Ok immediately without performing filesystem operations.
        return Ok(to);
    } else {
        // Paths differ: proceed to validate source and target on the filesystem.
    }

    let source = Path::new(&from);
    // Check if the source file exists on disk.
    if !source.exists() {
        // Source file missing: return descriptive error naming the source path.
        return Err(format!("Cannot rename '{from}': the file no longer exists"));
    } else {
        // Source file exists: proceed to target collision check.
    }

    let target = Path::new(&to);
    // Check if a file already exists at the target path.
    // std::fs::rename silently replaces an existing target on both Windows and POSIX,
    // and a rename that destroys a file the user did not name is the kind of data loss
    // that is noticed a week later. This guard prevents silent overwriting and is the
    // reason this command exists rather than the webview calling rename directly.
    if target.exists() {
        // Target already exists: refuse to overwrite and return descriptive error naming the target path.
        return Err(format!(
            "Cannot rename to '{to}': a file with that name is already there"
        ));
    } else {
        // Target does not exist: proceed to validate target parent folder.
    }

    // Check if the target path has a resolvable parent directory.
    let parent = match target.parent() {
        Some(dir) => {
            // Parent directory found: proceed to verify that the folder exists.
            dir
        }
        None => {
            // Target path has no parent directory: return descriptive error naming the target path.
            return Err(format!(
                "Cannot rename to '{to}': the target path has no parent directory"
            ));
        }
    };

    // Check if the target parent folder exists on disk.
    // Renaming into a missing folder fails with an OS error whose text says nothing useful to a user.
    if !parent.exists() {
        // Parent folder is missing: return descriptive error naming the target and folder.
        return Err(format!(
            "Cannot rename to '{to}': the folder '{}' does not exist",
            parent.display()
        ));
    } else {
        // Parent folder exists: proceed to execute filesystem rename.
    }

    // Execute the filesystem rename operation from source to target.
    match std::fs::rename(source, target)
        .map_err(|err| format!("Failed to rename '{from}' to '{to}': {err}"))
    {
        Ok(()) => {
            // Rename succeeded: return the new target path.
            Ok(to)
        }
        Err(err) => {
            // Rename failed: return descriptive error naming paths and OS cause.
            Err(err)
        }
    }
}

/// Reveals a file in the host operating system's native file manager with the file selected.
///
/// Opens the system file manager with the file selected, not merely the folder opened —
/// the point is to show the user which file, and an opened folder of two hundred files does not.
///
/// @purpose Opens the system file manager with the target file highlighted/selected rather than merely opening the folder.
/// @inputs path - The absolute filesystem path string of the file to reveal.
/// @outputs Result<(), String> - Ok(()) if the file manager was launched successfully, or Err naming the path and cause.
/// @dataflow Path string -> existence check -> platform-specific shell Command execution -> Result.
/// @controlflow Validate path exists -> branch on target OS (Windows: explorer /select, macOS: open -R, Linux: xdg-open parent) -> spawn process -> return Ok(()) or map launch error to Err.
#[tauri::command]
pub fn reveal_in_file_manager(
    app: tauri::AppHandle,
    grants: tauri::State<'_, crate::grants::GrantState>,
    path: String,
) -> Result<(), String> {
    use tauri::Manager;
    // K-Doc's own folders (themes, plugins) live in app data and may always be shown.
    let own = app
        .path()
        .app_data_dir()
        .ok()
        .zip(crate::grants::normalise(&path))
        .map(|(data, target)| crate::grants::is_within(&crate::grants::key(&target), &crate::grants::key(&data)))
        .unwrap_or(false);
    // Anything else must be a file or folder the user chose.
    if !own && !grants.allows(&path) && !grants.allows_folder(&path) {
        return Err(format!("{}{path}", crate::grants::ACCESS_DENIED_PREFIX));
    } else {
        // Allowed: show it.
    }
    reveal_in_file_manager_at(path)
}

/// Reveals a path without consulting the grant list; the command above is the only webview entry point.
///
/// @purpose The reveal itself, callable from tests.
/// @inputs path - The absolute path to show.
/// @outputs Result<(), String>.
/// @dataflow path -> existence check -> platform file manager.
/// @controlflow Refuse a missing path; otherwise launch the file manager.
pub fn reveal_in_file_manager_at(path: String) -> Result<(), String> {
    // Check if the target file exists on disk.
    // The point is to show the user which file, and revealing a missing file is meaningless.
    if !Path::new(&path).exists() {
        // File does not exist: return descriptive error naming the path.
        return Err(format!("Cannot reveal '{path}': the file no longer exists"));
    } else {
        // File exists: proceed to launch the platform-specific file manager.
    }

    #[cfg(target_os = "windows")]
    {
        // On Windows, explorer.exe accepts "/select,<path>" to open File Explorer with the item selected.
        // Explorer returns a non-zero exit status even when it succeeds, so the status is deliberately
        // not checked — only the failure to launch it is an error.
        match std::process::Command::new("explorer")
            .arg(format!("/select,{path}"))
            .spawn()
        {
            Ok(_) => {
                // Explorer process launched successfully.
            }
            Err(err) => {
                // Failed to launch explorer: return descriptive error naming the path and cause.
                return Err(format!("Failed to reveal '{path}' in Explorer: {err}"));
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // On macOS, the open command with the -R flag reveals the target file selected in Finder.
        match std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
        {
            Ok(_) => {
                // Finder open process launched successfully.
            }
            Err(err) => {
                // Failed to launch Finder open command: return descriptive error naming path and cause.
                return Err(format!("Failed to reveal '{path}' in Finder: {err}"));
            }
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        // On Linux and other platforms, there is no portable select-the-file command.
        // Opening the containing parent folder is the honest approximation.
        let parent = match Path::new(&path).parent() {
            Some(dir) => {
                // Parent directory found: use it as the target for xdg-open.
                dir
            }
            None => {
                // No parent directory resolvable: return error naming the path.
                return Err(format!(
                    "Cannot reveal '{path}': path has no parent directory"
                ));
            }
        };

        // Launch xdg-open targeting the file's parent directory.
        match std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
        {
            Ok(_) => {
                // xdg-open launched successfully.
            }
            Err(err) => {
                // Failed to launch xdg-open: return descriptive error naming path and cause.
                return Err(format!(
                    "Failed to reveal parent folder for '{path}' via xdg-open: {err}"
                ));
            }
        }
    }

    Ok(())
}

/// Largest number of paths one call may ask about, so a hostile or broken document cannot make the host stat without limit.
pub const MAX_PROBE_PATHS: usize = 1024;

/// Reports whether each requested path is an existing file on the host filesystem.
///
/// Only ever reveals existence — never reads contents — so a document can ask whether its referenced images
/// are present without exposing any bytes of them to the webview.
///
/// @purpose Answers, for the document linter (FR-12.7), whether each image path a document references exists on disk, without reading anything.
/// @inputs paths - Absolute filesystem path strings of files to probe; empty or NUL-containing entries are always reported as absent.
/// @outputs Result<Vec<bool>, String> - Ok containing one boolean per input path (true only for an existing regular file), or Err if the caller asked about more than MAX_PROBE_PATHS paths.
/// @dataflow Vec<String> -> count guard -> per-path absolute + is_file check -> Vec<bool> -> Ok.
/// @controlflow Reject over-limit request -> map each path to a bool (empty/NUL false, relative false, else is_file) -> collect results -> return Ok.
#[tauri::command]
pub fn paths_exist(paths: Vec<String>) -> Result<Vec<bool>, String> {
    // Check whether the caller asked about more paths than one call may handle.
    // An unbounded stat list would let a hostile or broken document hammer the host filesystem,
    // so reject before probing anything rather than silently truncating.
    if paths.len() > MAX_PROBE_PATHS {
        // Too many paths: return an error naming how many were requested and what the limit is.
        return Err(format!(
            "Asked about {} paths; the limit is {MAX_PROBE_PATHS}",
            paths.len()
        ));
    } else {
        // Within the limit: proceed to probe each path individually.
    }

    // Probe every requested path, producing one boolean result per input in order.
    let results = paths.iter().map(|path| {
        // An empty or NUL-containing string needs no case of its own: it is not absolute, and is_file reports false for it.
        // A network path is never probed: even a stat makes Windows authenticate to that machine.
        if !Path::new(&path).is_absolute() || crate::grants::is_network_path(Path::new(&path)) {
            // Relative path: would resolve against the host's working directory and mean nothing to the document, so report false.
            false
        } else {
            // Absolute path: a directory is not an image, so only a regular file counts as present.
            Path::new(&path).is_file()
        }
    }).collect();

    // Return the collected booleans in input order.
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TEST_COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// Generates a per-test unique temporary directory path and creates it with create_dir_all.
    ///
    /// @purpose Creates an isolated temporary directory for test filesystem operations.
    /// @inputs name - Descriptor for the test to include in the folder name.
    /// @outputs std::path::PathBuf - Path to the created directory.
    /// @dataflow Process ID + Atomic counter + test name -> unique folder path -> create_dir_all -> PathBuf.
    /// @controlflow Fetch-add counter -> construct path under temp_dir() -> create directory -> return PathBuf.
    fn unique_temp_dir(name: &str) -> std::path::PathBuf {
        let count = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "kdoc-fileops-{}-{}-{name}",
            std::process::id(),
            count
        ));
        std::fs::create_dir_all(&dir).expect("creating unique test directory should succeed");
        dir
    }

    #[test]
    fn renames_a_file() {
        let temp_dir = unique_temp_dir("renames_a_file");
        let source_path = temp_dir.join("original.txt");
        let target_path = temp_dir.join("renamed.txt");
        let contents = b"Hello, fileops!";

        std::fs::write(&source_path, contents).expect("writing source file should succeed");

        let source_str = source_path.to_str().expect("valid utf-8 path").to_string();
        let target_str = target_path.to_str().expect("valid utf-8 path").to_string();

        let result = rename_file_at(source_str, target_str.clone());
        assert_eq!(result, Ok(target_str));
        assert!(!source_path.exists(), "original file should no longer exist");
        assert!(target_path.exists(), "renamed file should exist");
        assert_eq!(
            std::fs::read(&target_path).expect("reading renamed file should succeed"),
            contents,
            "renamed file must preserve original content"
        );

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn refuses_to_overwrite_an_existing_file() {
        let temp_dir = unique_temp_dir("refuses_to_overwrite_an_existing_file");
        let source_path = temp_dir.join("source.txt");
        let target_path = temp_dir.join("target.txt");
        let source_contents = b"Source payload";
        let target_contents = b"Target payload";

        std::fs::write(&source_path, source_contents).expect("writing source file should succeed");
        std::fs::write(&target_path, target_contents).expect("writing target file should succeed");

        let source_str = source_path.to_str().expect("valid utf-8 path").to_string();
        let target_str = target_path.to_str().expect("valid utf-8 path").to_string();

        let result = rename_file_at(source_str, target_str);
        assert!(result.is_err(), "rename must fail when target already exists");

        // The second half is the assertion that matters: an error that still destroyed the file
        // would pass a test that only checked is_err().
        assert!(source_path.exists(), "source file must still exist");
        assert!(target_path.exists(), "target file must still exist");
        assert_eq!(
            std::fs::read(&source_path).expect("reading source file should succeed"),
            source_contents,
            "source file contents must not be altered"
        );
        assert_eq!(
            std::fs::read(&target_path).expect("reading target file should succeed"),
            target_contents,
            "target file contents must not be overwritten"
        );

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn refuses_a_missing_source() {
        let temp_dir = unique_temp_dir("refuses_a_missing_source");
        let source_path = temp_dir.join("nonexistent_source.txt");
        let target_path = temp_dir.join("destination.txt");

        let source_str = source_path.to_str().expect("valid utf-8 path").to_string();
        let target_str = target_path.to_str().expect("valid utf-8 path").to_string();

        let result = rename_file_at(source_str.clone(), target_str);
        assert!(result.is_err(), "rename must fail when source does not exist");
        let err = result.expect_err("should return error");
        assert!(
            err.contains(&source_str),
            "error message must name the missing source path"
        );
        assert!(
            err.contains("no longer exists"),
            "error message must explain that file no longer exists"
        );

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn refuses_a_missing_target_folder() {
        let temp_dir = unique_temp_dir("refuses_a_missing_target_folder");
        let source_path = temp_dir.join("source.txt");
        std::fs::write(&source_path, b"content").expect("writing source file should succeed");

        let missing_dir = temp_dir.join("missing_subdir");
        let target_path = missing_dir.join("target.txt");

        let source_str = source_path.to_str().expect("valid utf-8 path").to_string();
        let target_str = target_path.to_str().expect("valid utf-8 path").to_string();

        let result = rename_file_at(source_str, target_str.clone());
        assert!(
            result.is_err(),
            "rename must fail when target folder does not exist"
        );
        let err = result.expect_err("should return error");
        assert!(
            err.contains(&target_str),
            "error message must name target path"
        );
        assert!(
            err.contains("does not exist"),
            "error message must explain that folder does not exist"
        );

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn renaming_to_the_same_name_succeeds_and_changes_nothing() {
        let temp_dir = unique_temp_dir("renaming_to_the_same_name_succeeds_and_changes_nothing");
        let file_path = temp_dir.join("file.txt");
        let contents = b"Unchanged content";
        std::fs::write(&file_path, contents).expect("writing file should succeed");

        let file_str = file_path.to_str().expect("valid utf-8 path").to_string();

        let result = rename_file_at(file_str.clone(), file_str.clone());
        assert_eq!(result, Ok(file_str));
        assert!(file_path.exists(), "file must still exist");
        assert_eq!(
            std::fs::read(&file_path).expect("reading file should succeed"),
            contents,
            "file contents must remain unchanged"
        );

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn reveal_refuses_a_missing_path() {
        let temp_dir = unique_temp_dir("reveal_refuses_a_missing_path");
        let missing_path = temp_dir.join("nonexistent_reveal.txt");
        let missing_str = missing_path.to_str().expect("valid utf-8 path").to_string();

        // Spawning a file manager in a test on a valid path would open a GUI window
        // on the developer's machine, so testing is restricted to asserting that
        // a missing path is refused before any process launch is attempted.
        let result = reveal_in_file_manager_at(missing_str.clone());
        assert!(result.is_err(), "reveal must fail when path does not exist");
        let err = result.expect_err("should return error");
        assert!(
            err.contains(&missing_str),
            "error message must name the missing path"
        );
        assert!(
            err.contains("no longer exists"),
            "error message must explain that file no longer exists"
        );

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    /// Confirms that a path pointing at an existing regular file is reported as present.
    #[test]
    fn paths_exist_reports_an_existing_file() {
        let dir = unique_temp_dir("paths_exist_reports_an_existing_file");
        let file = dir.join("a.png");
        std::fs::write(&file, b"x").expect("writing test image should succeed");

        let result = paths_exist(vec![file.to_string_lossy().into_owned()]);
        assert_eq!(result, Ok(vec![true]));

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Confirms that a path pointing at no file is reported as absent.
    #[test]
    fn paths_exist_reports_a_missing_file() {
        let dir = unique_temp_dir("paths_exist_reports_a_missing_file");
        let missing = dir.join("missing.png");

        let result = paths_exist(vec![missing.to_string_lossy().into_owned()]);
        assert_eq!(result, Ok(vec![false]));

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Confirms that a directory is not counted as an existing image file.
    #[test]
    fn paths_exist_does_not_count_a_directory() {
        let dir = unique_temp_dir("paths_exist_does_not_count_a_directory");

        // The directory itself exists on disk, but it is not a regular file.
        let result = paths_exist(vec![dir.to_string_lossy().into_owned()]);
        assert_eq!(result, Ok(vec![false]));

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Confirms that relative paths, the empty string, and NUL-containing paths are all reported as absent.
    #[test]
    fn paths_exist_refuses_relative_and_empty_paths() {
        // None of these can name a real file on disk: one is relative, one is empty, one contains a NUL byte.
        let result = paths_exist(vec![
            "a.png".to_string(),
            String::new(),
            "C:\\x\0y".to_string(),
        ]);
        assert_eq!(result, Ok(vec![false, false, false]));
    }

    /// Confirms that a relative path is refused even when it names a real file in the working directory.
    #[test]
    fn paths_exist_refuses_a_relative_path_to_a_real_file() {
        // Cargo runs tests from the crate root, where Cargo.toml exists, so only the absolute-path rule can say false.
        assert!(Path::new("Cargo.toml").is_file(), "the crate root should hold Cargo.toml");
        assert_eq!(paths_exist(vec!["Cargo.toml".to_string()]), Ok(vec![false]));
    }

    /// Confirms that asking about more than MAX_PROBE_PATHS paths is refused while exactly the limit is accepted.
    #[test]
    fn paths_exist_refuses_too_many_paths() {
        // One over the limit must be rejected outright with an error.
        let too_many = vec![String::from("x"); MAX_PROBE_PATHS + 1];
        assert!(paths_exist(too_many).is_err(), "over-limit request must be refused");

        // Exactly at the limit must be accepted without error.
        let at_limit = vec![String::from("x"); MAX_PROBE_PATHS];
        assert!(
            paths_exist(at_limit).is_ok(),
            "request at the limit must be accepted"
        );
    }
}
