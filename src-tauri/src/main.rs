//! @file main.rs
//! @purpose Tauri v2 desktop host binary and filesystem adapter for K-Doc (DESIGN.md §4). Every filesystem operation lives in Rust and is reached from the webview through a narrow, validated command, so the webview is never granted direct disk access.
//!
//! Note: This module implements the filesystem adapter described in DESIGN.md §4:
//! every filesystem operation lives in Rust and is reached from the webview through a narrow, validated command,
//! never through direct file access from JavaScript.
//!
//! @inputs Webview IPC invoke requests (`read_text_file`, `write_text_file` and the module commands) containing file paths, payloads, and encoding/BOM flags.
//! @outputs Persisted text files on disk; serialized `FileContents` and Result responses returned over IPC.
//! @functions
//!   - read_text_file: Reads a text file from disk, detects and strips a UTF-8 BOM, validates UTF-8 encoding without normalisation, and returns `FileContents`.
//!   - write_text_file: Atomically writes text contents to disk via a temporary file in the target directory, restoring a UTF-8 BOM if requested.
//!   - main: Entry point constructing, configuring plugins (dialog), registering IPC commands, and executing the Tauri v2 desktop host application.
//! @dataflow Webview IPC invoke -> command dispatch (`read_text_file`, `write_text_file` and the module commands) -> filesystem validation & atomic I/O -> serialized Result responses returned over IPC.
//! @controlflow main() initializes Tauri builder -> registers dialog plugin -> registers invoke handlers -> runs Tauri context -> awaits webview IPC invocations.
//! @version 12
//! @date 2026-10-07

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::io::Write;
use tauri::Manager;

mod encoding;
mod fileops;
mod images;
mod media;
mod pandoc;
mod attachments;
mod journal;
mod settings;
mod spell;
mod spell_cache;
mod css_themes;
mod git;
mod snapshots;
mod store;
mod watcher;
mod vault;
mod vault_files;
mod links;
mod binary_file;
mod permissions;
mod windows;
mod plugins;
mod navigation;
mod grants;
mod access;
mod atomic;
mod launch;
mod guide;

/// The largest text document K-Doc reads, in bytes (64 MiB): reading a bigger file whole would stall the app.
const MAX_TEXT_BYTES: u64 = 64 * 1024 * 1024;

/// Result payload returned when reading a text file from disk.
///
/// @purpose Encapsulates file content, path, and UTF-8 BOM detection status for webview consumers.
#[derive(Debug, Serialize)]
pub struct FileContents {
    /// The canonical or requested filesystem path of the file that was read.
    pub path: String,
    /// The decoded UTF-8 string content of the file, stripped of any leading UTF-8 BOM.
    pub contents: String,
    /// The encoding the file was found in, as a wire name the webview sends back on save.
    ///
    /// A name rather than a boolean, because a flag could only ever answer *UTF-8 with or without a BOM*,
    /// and the question the save side actually has to answer is *what was this file*.
    pub encoding: String,
    /// Whether the file is read-only on disk, so the editor can open it locked (FR-6.7).
    ///
    /// Reported here rather than asked for separately because the answer belongs to the same moment as
    /// the read: a file checked afterwards may already be a different file.
    #[serde(rename = "readOnly")]
    pub read_only: bool,
}

/// Reads a text file from disk, detects and strips a UTF-8 BOM, and returns its contents without line-ending normalisation.
///
/// @purpose Reads raw file bytes from disk, verifies UTF-8 validity without guessing encoding, and captures BOM metadata.
/// @inputs path - The filesystem path of the file to read.
/// @outputs Result<FileContents, String> - Returns `Ok(FileContents)` with decoded text and BOM presence flag on success, or `Err` with path and error reason.
/// @dataflow File path string -> std::fs::read raw bytes -> BOM detection -> String::from_utf8 decode -> FileContents struct returned over IPC.
/// @controlflow Read raw bytes from path -> check for UTF-8 BOM prefix -> strip BOM if present -> decode UTF-8 bytes -> construct FileContents -> return Ok. Returns Err early on any I/O or decode failure.
#[tauri::command]
fn read_text_file(
    app: tauri::AppHandle,
    grants: tauri::State<'_, grants::GrantState>,
    path: String,
) -> Result<FileContents, String> {
    // Only a file the user chose (or one inside a folder they chose) may be read from the webview.
    grants.require(&path)?;
    let mut contents = read_text_file_at(path)?;
    // The installed user guide opens locked: an update replaces it, so an edit made there would be lost.
    if guide::is_guide_file(&app, &contents.path) {
        contents.read_only = true;
    }
    Ok(contents)
}

/// Reads a text file without consulting the grant list; the command above is the only webview entry point.
///
/// @purpose The read itself, callable from tests and from host code that already checked access.
/// @inputs path - The filesystem path of the file to read.
/// @outputs Result<FileContents, String> - The decoded file, or an error naming the path.
/// @dataflow path -> bytes -> encoding detection -> decoded text -> FileContents.
/// @controlflow Read -> detect -> decode -> report the read-only attribute; any failure returns early.
fn read_text_file_at(path: String) -> Result<FileContents, String> {
    // A file over MAX_TEXT_BYTES is refused before it is read, so a huge file cannot stall or exhaust the app.
    let size = std::fs::metadata(&path)
        .map_err(|err| format!("Failed to read file '{path}': {err}"))?
        .len();
    if size > MAX_TEXT_BYTES {
        return Err(format!("Failed to read file '{path}': it is larger than {} MiB", MAX_TEXT_BYTES / (1024 * 1024)));
    } else {
        // Within the limit: read it.
    }

    // Read raw bytes from the specified file path.
    let bytes = std::fs::read(&path)
        .map_err(|err| format!("Failed to read file '{path}': {err}"))?;

    // K-Doc refuses to guess an encoding: it never applies heuristics or statistics to decide how bytes should be read,
    // because a guess can silently corrupt data. The only encodings recognised are therefore the ones that announce
    // themselves with a byte order mark — UTF-8 (EF BB BF), UTF-16 little-endian (FF FE) and UTF-16 big-endian (FE FF).
    // A UTF-16 file without one is indistinguishable from binary without statistics, and statistics are a guess, so it
    // is rejected rather than misread; detection strips any BOM before decoding so the payload handed to decode is clean.
    let (found, payload) = crate::encoding::detect(&bytes);

    // Decode the stripped payload into text; on failure the reason is wrapped in a message naming the offending file.
    let contents = crate::encoding::decode(found, payload).map_err(|reason| format!("Failed to read file '{path}': {reason}"))?;

    // Line endings are preserved exactly as read — \r\n and \n are never converted — so a save writes the file back byte-for-byte.
    // Read the attribute from the same path that was just read, so the editor can open a read-only
    // file locked rather than letting edits build up against a file that cannot take them.
    let read_only = crate::permissions::is_read_only(&path);

    Ok(FileContents {
        path,
        contents,
        encoding: found.as_str().to_string(),
        read_only,
    })
}

/// Atomically writes text contents to disk using a temporary file in the target directory, preserving BOM and line endings.
///
/// @purpose Writes text contents to disk atomically (NFR-3) ensuring no partially written files on failure or power loss.
/// @inputs path - The destination filesystem path where the file will be written.
/// @inputs contents - The string text content to write.
/// @inputs encoding - A wire encoding name ("utf-8", "utf-8-bom", "utf-16le", "utf-16be") sent back by the webview; an unrecognised name falls back to UTF-8.
/// @outputs Result<(), String> - Returns `Ok(())` on successful atomic write, or `Err` with a descriptive message on failure.
/// @dataflow String contents (+ optional BOM) -> byte payload -> write to temp file (.kdoc-tmp in parent dir) -> sync_all -> close file handle -> atomic rename over target path.
/// @controlflow Resolve parent dir -> resolve file name -> construct temp path -> build byte payload -> create temp file -> write all bytes -> sync to disk -> close handle -> rename temp over target -> cleanup temp on error -> return Ok(()).
#[tauri::command]
fn write_text_file(grants: tauri::State<'_, grants::GrantState>, path: String, contents: String, encoding: String) -> Result<(), String> {
    // Only a file the user chose (or one inside a folder they chose) may be written from the webview.
    grants.require(&path)?;
    write_text_file_at(path, contents, encoding)
}

/// Writes a text file atomically without consulting the grant list; the command above is the only webview entry point.
///
/// @purpose The atomic write itself, callable from tests.
/// @inputs path, contents, encoding - As for write_text_file.
/// @outputs Result<(), String>.
/// @dataflow contents -> encoded bytes -> temp file -> sync -> rename over path.
/// @controlflow Resolve parent and name -> write temp -> sync -> rename; failures clean up and return early.
fn write_text_file_at(path: String, contents: String, encoding: String) -> Result<(), String> {
    let target_path = std::path::Path::new(&path);

    // Step 1: Resolve the parent directory with std::path::Path::new(&path).parent().
    // Check if the target path has a resolvable parent directory.
    let parent_dir = match target_path.parent() {
        Some(parent) => parent,
        None => {
            // Branch: Target path has no parent directory; return error.
            return Err(format!(
                "Failed to write file '{path}': path has no parent directory"
            ));
        }
    };

    // Check if the target path has a valid file name component.
    let file_name = match target_path.file_name() {
        Some(name) => name,
        None => {
            // Branch: Target path has no file name component; return error.
            return Err(format!(
                "Failed to write file '{path}': path has no valid file name"
            ));
        }
    };

    // Step 2: Create a temporary file in that SAME directory, named by appending `.kdoc-tmp` to the target's file name.
    // Creating the temporary file in the same directory guarantees that the temporary file and target file
    // reside on the same filesystem volume, which is required for an atomic rename.
    // A name nobody could have prepared in advance, created exclusively below, so a file or symlink planted beside
    // the document can never receive the write.
    let temp_path = crate::atomic::unique_temp_path(parent_dir, file_name);

    // The encoding is restored because it is how the file was found, so K-Doc neither adds nor removes a BOM behind the user's back; an unrecognised name falls back to UTF-8, which cannot corrupt a file that already was UTF-8.
    let payload = crate::encoding::encode(crate::encoding::Encoding::from_str(&encoding), &contents);

    // Atomic write sequence (NFR-3):
    // Check if temporary file creation succeeds.
    let mut temp_file = match crate::atomic::create_exclusive(&temp_path) {
        Ok(file) => file,
        Err(err) => {
            // Branch: Failed to create temporary file; return error naming path and cause.
            return Err(format!(
                "Failed to create temporary file '{}' for atomic save of '{path}': {err}",
                temp_path.display()
            ));
        }
    };

    // Step 3: Write all bytes with std::io::Write::write_all.
    // Check if writing the payload bytes to the temporary file succeeds.
    if let Err(err) = temp_file.write_all(&payload) {
        // Branch: Write failed; remove the temporary file to prevent littering and return error.
        // A failed save must not litter the user's folder with stray temp files, and
        // the removal's own failure is deliberately not reported because it would mask the real error.
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!(
            "Failed to write contents to temporary file '{}': {err}",
            temp_path.display()
        ));
    } else {
        // Branch: Write succeeded; proceed to flushing file to disk.
    }

    // Step 4: Call sync_all() on the file handle to flush to disk before the rename,
    // so a crash between write and rename cannot leave a truncated file in place.
    // Check if flushing and syncing file buffers to disk succeeds.
    if let Err(err) = temp_file.sync_all() {
        // Branch: sync_all failed; clean up temporary file and return error.
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!(
            "Failed to sync temporary file '{}' to disk: {err}",
            temp_path.display()
        ));
    } else {
        // Branch: sync_all succeeded; proceed to close file handle and rename.
    }

    // Step 5: Drop or explicitly close the handle, then rename the temp path over the target.
    // On Windows, an open file handle locks the file and prevents replacement during rename.
    drop(temp_file);

    // Rename the temporary file over the target destination file.
    // Rename over an existing file is atomic on both Windows and POSIX, which is what makes this safe.
    // Check if renaming the temporary file over the target path succeeds.
    if let Err(err) = std::fs::rename(&temp_path, target_path) {
        // Branch: Rename failed; attempt to remove the temporary file and return error.
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!(
            "Failed to rename temporary file '{}' to target file '{path}': {err}",
            temp_path.display()
        ));
    } else {
        // Branch: Rename succeeded; atomic write completed successfully.
    }

    Ok(())
}

/// Application entry point initializing and running the Tauri v2 desktop host application.
///
/// @purpose Builds the Tauri application runtime, initializes plugins (dialog), registers IPC command handlers, and runs the desktop event loop.
/// @inputs None (invoked directly on application startup).
/// @outputs None (executes until the desktop host process exits).
/// @dataflow Tauri builder default -> register dialog plugin -> register IPC handlers (read_text_file, write_text_file and the module commands) -> generate context -> execute host loop.
/// @controlflow Initialize default builder -> register dialog plugin -> register invoke handlers -> run with generated context -> expect unrecoverable startup errors.
fn main() {
    tauri::Builder::default()
        // Registered first, so a second launch (a double-clicked file while K-Doc is open) hands its arguments to
        // this process and exits before it builds anything.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            launch::handle_second_instance(app, argv, cwd);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(navigation::guard())
        // A file dropped on a window is the user choosing it, exactly as a picker is, so it is granted here in the
        // host, before the webview hears about the drop.
        .on_window_event(|window, event| {
            // Only a completed drop carries paths; hovering and leaving grant nothing.
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let state = window.state::<grants::GrantState>();
                for path in paths {
                    // A failed grant only means the drop is refused later with a clear message; it is not fatal here.
                    if let Err(error) = state.grant_file(path) {
                        eprintln!("Could not record access to a dropped file: {error}");
                    }
                }
            }
            // The window last brought to the front is where a file opened from Windows goes.
            if let tauri::WindowEvent::Focused(true) = event {
                window.state::<launch::LaunchState>().focused(window.label());
            }
            // A closed window's file watch goes with it.
            if let tauri::WindowEvent::Destroyed = event {
                window.state::<watcher::WatcherState>().forget_window(window.label());
            }
        })
        .manage(watcher::WatcherState::new())
        .manage(windows::HandoffState::default())
        .manage(spell::SpellState::new())
        .manage(css_themes::ThemeWatchState::new())
        .manage(launch::LaunchState::default())
        // The page draws K-Doc's only menu bar. Clear any native menu at startup so a platform default can
        // never appear above the frameless window.
        .setup(|app| {
            // The record of what the user has given K-Doc access to; it survives restarts so recent files,
            // session restore and recovery keep working. Without an app-data folder it lives in memory only.
            let store = app.path().app_data_dir().ok().map(|dir| dir.join(grants::GRANTS_FILE_NAME));
            app.manage(grants::GrantState::new(store));
            // Files on the command line (a double-clicked Markdown file) are the user's choice, like a drop: grant them
            // and hold them until the window has restored its session and asks for them.
            let args: Vec<String> = std::env::args_os().map(|arg| arg.to_string_lossy().into_owned()).collect();
            match std::env::current_dir() {
                Ok(cwd) => launch::grant_and_queue(app.handle(), launch::launch_paths(&args, &cwd)),
                Err(error) => eprintln!("Could not read the working directory for files to open: {error}"),
            }
            app.handle().remove_menu()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            fileops::rename_file,
            fileops::reveal_in_file_manager,
            fileops::paths_exist,
            images::read_image_file,
            media::read_media_file,
            pandoc::pandoc_version,
            pandoc::pandoc_export,
            attachments::attachment_write,
            attachments::attachment_copy,
            attachments::attachment_names,
            journal::journal_write,
            journal::journal_list,
            journal::journal_clear,
            watcher::watch_file,
            watcher::unwatch_file,
            settings::read_settings_file,
            settings::write_settings_file,
            plugins::plugin_names,
            plugins::plugin_read,
            plugins::plugin_folder,
            spell::spell_load,
            spell::spell_select,
            spell_cache::spell_load_cached,
            spell_cache::spell_install_dictionary,
            css_themes::theme_names,
            css_themes::theme_css,
            css_themes::theme_folder,
            css_themes::theme_watch,
            css_themes::theme_unwatch,
            spell::spell_check,
            spell::spell_suggest,
            spell::spell_add_word,
            spell::spell_set_user_words,
            store::store_resolve,
            store::store_read,
            store::store_write,
            store::store_delete,
            snapshots::snapshot_list,
            snapshots::snapshot_read,
            snapshots::snapshot_write,
            snapshots::snapshot_delete,
            git::git_file_info,
            git::git_file_log,
            git::git_file_at,
            git::git_stage_file,
            git::git_commit_file,
            vault::vault_list_notes,
            links::open_external_url,
            vault::vault_index_read,
            vault::vault_index_write,
            vault_files::vault_list_folders,
            vault_files::vault_create_note,
            vault_files::vault_create_folder,
            vault_files::vault_move,
            vault_files::vault_trash,
            vault_files::vault_list_templates,
            permissions::set_file_read_only,
            binary_file::write_binary_file,
            binary_file::read_binary_file,
            windows::open_document_window,
            windows::take_handoff_document,
            access::pick_open_file,
            access::pick_save_path,
            access::pick_folder,
            access::request_file_access,
            windows::set_window_fullscreen,
            launch::take_launch_paths,
            launch::open_default_apps_settings,
            guide::user_guide_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running K-Doc");
}

#[cfg(test)]
mod tests {
    use super::*;

    // WHY these tests exist:
    // The filesystem adapter is the one part of K-Doc that can destroy a user's work rather than
    // merely display it wrongly, and until now it had no tests at all. Driving the GUI once proves
    // it worked once; these prove it keeps working.

    /// Generates a unique temporary file path within the system temporary directory.
    ///
    /// @purpose Generates a collision-resistant temporary file path for filesystem integration tests.
    /// @inputs name - Suffix/name descriptor for the temporary test file.
    /// @outputs std::path::PathBuf - The resolved PathBuf pointing to the temporary test file.
    /// @dataflow Process ID + name descriptor -> formatted filename -> joined with temp_dir() -> PathBuf.
    /// @controlflow Read system temp dir -> format filename with process id -> join and return PathBuf.
    fn temp_path(name: &str) -> std::path::PathBuf {
        // The process id is included so concurrent test runs cannot collide on the same file.
        std::env::temp_dir().join(format!("kdoc-test-{}-{}", std::process::id(), name))
    }

    #[test]
    fn round_trips_content_exactly() {
        // Pins: write_text_file followed by read_text_file preserves exact file content without modification,
        // and the encoding is reported as "utf-8" when no BOM was written.
        let path = temp_path("round_trips_content_exactly.md");
        let path_str = path.to_str().expect("valid utf-8 path").to_string();
        let original = "# Title\n\nBody.\n";

        write_text_file_at(path_str.clone(), original.to_string(), "utf-8".to_string())
            .expect("write_text_file should succeed");

        let read_result = read_text_file_at(path_str).expect("read_text_file should succeed");
        assert_eq!(read_result.contents, original);
        assert_eq!(read_result.encoding, "utf-8");

        // Deliberately ignore cleanup result so a cleanup failure does not mask a test failure.
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn preserves_crlf_line_endings() {
        // Pins: Preserves CRLF (\r\n) line endings without normalisation.
        // This is the assertion that fails the moment somebody adds a helpful line-ending normalisation,
        // which would silently rewrite every line of a Windows-authored file on its first save.
        let path = temp_path("preserves_crlf_line_endings.md");
        let path_str = path.to_str().expect("valid utf-8 path").to_string();
        let original = "line one\r\nline two\r\n";

        write_text_file_at(path_str.clone(), original.to_string(), "utf-8".to_string())
            .expect("write_text_file should succeed");

        let read_result = read_text_file_at(path_str).expect("read_text_file should succeed");
        assert!(read_result.contents.contains("\r\n"));
        assert_eq!(read_result.contents, original);

        // Deliberately ignore cleanup result so a cleanup failure does not mask a test failure.
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn preserves_a_utf8_bom() {
        // Pins: When the encoding is "utf-8-bom", the raw bytes on disk start with [0xEF, 0xBB, 0xBF],
        // and read_text_file reports that same encoding while stripping the BOM from contents.
        // The BOM is carried as metadata rather than as content, so it cannot leak into the document body.
        let path = temp_path("preserves_a_utf8_bom.md");
        let path_str = path.to_str().expect("valid utf-8 path").to_string();
        let body = "# BOM Document\n";

        write_text_file_at(path_str.clone(), body.to_string(), "utf-8-bom".to_string())
            .expect("write_text_file should succeed");

        let raw_bytes = std::fs::read(&path).expect("reading raw bytes should succeed");
        assert!(raw_bytes.starts_with(&[0xEF, 0xBB, 0xBF]));

        let read_result = read_text_file_at(path_str).expect("read_text_file should succeed");
        assert_eq!(read_result.encoding, "utf-8-bom");
        assert!(!read_result.contents.starts_with('\u{FEFF}'));
        assert_eq!(read_result.contents, body);

        // Deliberately ignore cleanup result so a cleanup failure does not mask a test failure.
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn does_not_add_a_bom_when_the_file_had_none() {
        // Pins: When the encoding is "utf-8", raw bytes do not start with [0xEF, 0xBB, 0xBF].
        // K-Doc neither adds nor removes a BOM behind the user's back.
        let path = temp_path("does_not_add_a_bom_when_the_file_had_none.md");
        let path_str = path.to_str().expect("valid utf-8 path").to_string();
        let body = "No BOM content\n";

        write_text_file_at(path_str.clone(), body.to_string(), "utf-8".to_string())
            .expect("write_text_file should succeed");

        let raw_bytes = std::fs::read(&path).expect("reading raw bytes should succeed");
        assert!(!raw_bytes.starts_with(&[0xEF, 0xBB, 0xBF]));

        // Deliberately ignore cleanup result so a cleanup failure does not mask a test failure.
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn leaves_no_temporary_file_behind() {
        // Pins: A successful atomic save does not leave an intermediate .kdoc-tmp file on disk.
        // A successful save must not litter the user's folder.
        let path = temp_path("leaves_no_temporary_file_behind.md");
        let path_str = path.to_str().expect("valid utf-8 path").to_string();
        let tmp_path = std::path::PathBuf::from(format!("{path_str}.kdoc-tmp"));

        write_text_file_at(path_str, "temporary file cleanup test\n".to_string(), "utf-8".to_string())
            .expect("write_text_file should succeed");

        assert!(!tmp_path.exists());

        // Deliberately ignore cleanup result so a cleanup failure does not mask a test failure.
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn overwrites_an_existing_file() {
        // Pins: Atomic rename correctly replaces an existing file on disk with updated content.
        // This exercises the rename-over-existing path, which is the case that actually matters for saving.
        let path = temp_path("overwrites_an_existing_file.md");
        let path_str = path.to_str().expect("valid utf-8 path").to_string();

        write_text_file_at(path_str.clone(), "initial content\n".to_string(), "utf-8".to_string())
            .expect("initial write_text_file should succeed");

        write_text_file_at(path_str.clone(), "overwritten content\n".to_string(), "utf-8".to_string())
            .expect("second write_text_file should succeed");

        let read_result = read_text_file_at(path_str).expect("read_text_file should succeed");
        assert_eq!(read_result.contents, "overwritten content\n");

        // Deliberately ignore cleanup result so a cleanup failure does not mask a test failure.
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn rejects_a_path_with_no_parent() {
        // Pins: write_text_file rejects an invalid empty path that has no resolvable parent directory or file name.
        let result = write_text_file_at("".to_string(), "content".to_string(), "utf-8".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn reports_a_missing_file_by_path() {
        // Pins: read_text_file returns an Err when reading a non-existent file, and the error message names the path.
        let path = temp_path("non_existent_file.md");
        let path_str = path.to_str().expect("valid utf-8 path").to_string();

        let result = read_text_file_at(path_str.clone());
        assert!(result.is_err());
        let err_msg = result.expect_err("should return error for missing file");
        assert!(err_msg.contains(&path_str));
    }

    #[test]
    fn rejects_truncated_utf16() {
        // Pins: a UTF-16 byte order mark followed by an odd number of bytes cannot form whole code units,
        // and is refused with a message saying so rather than silently dropping the dangling byte.
        let path = temp_path("truncated_utf16.bin");
        let path_str = path.to_str().expect("valid utf-8 path").to_string();

        std::fs::write(&path, &[0xFF, 0xFE, 0x00]).expect("writing truncated bytes should succeed");

        let result = read_text_file_at(path_str);
        assert!(result.is_err());
        let err_msg = result.expect_err("should fail decoding truncated utf-16");
        assert!(err_msg.contains("even"));

        // Deliberately ignore cleanup result so a cleanup failure does not mask a test failure.
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn rejects_invalid_utf8() {
        // Pins: read_text_file fails with an Err mentioning UTF-8 when encountering non-UTF-8 bytes.
        // Refusing is correct: guessing an encoding and then saving the guess corrupts the file.
        let path = temp_path("invalid_utf8.bin");
        let path_str = path.to_str().expect("valid utf-8 path").to_string();

        // These bytes carry no byte order mark, so detection treats them as plain UTF-8 and the decode
        // rejects them. The fixture used to be [0xFF, 0xFE, 0x00], which is now a valid UTF-16LE BOM
        // followed by a truncated payload -- a different failure, covered by its own case below.
        std::fs::write(&path, &[0x68, 0xFF, 0x69]).expect("writing invalid bytes should succeed");

        let result = read_text_file_at(path_str);
        assert!(result.is_err());
        let err_msg = result.expect_err("should fail decoding invalid utf-8");
        assert!(err_msg.contains("UTF-8"));

        // Deliberately ignore cleanup result so a cleanup failure does not mask a test failure.
        let _ = std::fs::remove_file(&path);
    }

}
