//! @file settings.rs
//! @purpose Persistence storage for K-Doc user configuration settings (FR-14.15). Provides dedicated Tauri IPC commands to read and atomically write settings.json in the application data directory.
//!
//! Note: This module implements user settings persistence described in FR-14.15:
//! preferences are stored in the user's application data directory via dedicated Tauri IPC
//! commands (`read_settings_file`, `write_settings_file`) rather than generic text file I/O,
//! so the webview does not need to know or construct the application data path.
//!
//! @inputs Webview IPC invoke requests (`read_settings_file`, `write_settings_file`) containing serialized settings JSON contents.
//! @outputs Persisted `settings.json` file in application data directory; settings JSON string and Result responses returned over IPC.
//! @functions
//!   - settings_path: Resolves and ensures the existence of the application data directory and returns the path to `settings.json`.
//!   - read_settings_file: Reads `settings.json` from the application data directory, returning an empty string if the file does not yet exist.
//!   - write_settings_file: Atomically writes settings JSON contents to disk via a temporary sibling file, syncing before rename.
//! @dataflow Webview IPC invoke -> command dispatch (`read_settings_file`, `write_settings_file`) -> app data path resolution -> atomic filesystem I/O -> serialized Result response returned over IPC.
//! @controlflow Tauri invoke handler dispatches command -> application data directory resolved and created -> read file (missing file returns Ok("")) or atomic write (.tmp -> sync_all -> drop -> rename) -> Result returned.
//! @version 1
//! @date 2026-09-05

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::Manager;

/// Canonical filename for the user configuration file in the application data directory.
const SETTINGS_FILE: &str = "settings.json";

/// Resolves the application data directory, ensures it exists, and returns the path to the settings file.
///
/// @purpose Resolves `<app_data_dir>/settings.json` and creates the parent directory if it does not exist.
/// @inputs app - Reference to the Tauri application handle.
/// @outputs Result<PathBuf, String> - Returns the resolved settings PathBuf on success, or a descriptive error message on failure.
/// @dataflow Tauri app handle -> Manager::path().app_data_dir() -> fs::create_dir_all -> join SETTINGS_FILE -> Ok(PathBuf).
/// @controlflow Query app data directory -> map error -> create directory if missing -> map error -> join "settings.json" -> return Ok(path). Returns Err on any resolution or directory creation failure.
fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Resolve the application data directory via Tauri's PathResolver.
    let app_data = match app.path().app_data_dir() {
        Ok(path) => path,
        Err(err) => {
            // Branch: Failed to resolve application data directory from Tauri host.
            return Err(format!(
                "Failed to resolve application data directory for user settings: {err}"
            ));
        }
    };

    // Ensure the application data directory exists, creating all parent directories if missing.
    // Failure here must be surfaced immediately naming the path and cause.
    if let Err(err) = fs::create_dir_all(&app_data) {
        // Branch: Directory creation failed; return descriptive error naming path.
        return Err(format!(
            "Failed to create application data directory '{}': {err}",
            app_data.display()
        ));
    } else {
        // Branch: Application data directory created or already exists; proceed.
    }

    // Note: There is no identifier to validate here.
    // Unlike journal_file, which receives an untrusted buffer identifier from the webview and must validate
    // against path traversal sequences (such as '..'), the settings filename is a hardcoded constant ("settings.json").
    // There is no untrusted path segment, so the absence of a validation check is deliberate rather than forgotten.
    Ok(app_data.join(SETTINGS_FILE))
}

/// Reads the user configuration settings file from the application data directory.
///
/// @purpose Reads `<app_data_dir>/settings.json` (FR-14.15), returning an empty string on first run when the file does not exist.
/// @inputs app - The Tauri application handle.
/// @outputs Result<String, String> - Returns Ok(String) containing the settings JSON content (or empty string if missing), or Err on read failure.
/// @dataflow app handle -> settings_path -> fs::read_to_string -> handle NotFound as Ok(empty) -> Ok(String).
/// @controlflow Resolve settings path -> attempt read_to_string -> if successful return Ok(contents) -> if NotFound return Ok(empty string) -> if other error return Err naming path and cause.
#[tauri::command]
pub fn read_settings_file(app: tauri::AppHandle) -> Result<String, String> {
    // Resolve the destination settings file path in the application data directory.
    let path = settings_path(&app)?;

    // Attempt to read the settings file content as a string.
    match fs::read_to_string(&path) {
        Ok(contents) => {
            // Branch: File read succeeded; return the persisted settings JSON string.
            Ok(contents)
        }
        Err(err) => {
            // Check if the error is NotFound.
            // A missing file returns Ok(String::new()), not an error.
            // First run is the normal case and reporting it as a failure would make
            // every fresh install log an error about a file that is not supposed to exist yet.
            if err.kind() == std::io::ErrorKind::NotFound {
                // Branch: File does not exist yet; return an empty string rather than an error.
                Ok(String::new())
            } else {
                // Branch: Filesystem error other than NotFound (e.g., permission denied); return descriptive error naming path and cause.
                Err(format!(
                    "Failed to read settings file '{}': {err}",
                    path.display()
                ))
            }
        }
    }
}

/// Atomically writes user configuration settings contents to the application data directory.
///
/// @purpose Atomically persists serialized settings JSON (FR-14.15) via a temporary sibling file to prevent configuration corruption.
/// @inputs app - The Tauri application handle.
/// @inputs contents - The serialized JSON string payload to write.
/// @outputs Result<(), String> - Returns Ok(()) on successful atomic write, or Err with a descriptive message on failure.
/// @dataflow contents string -> settings_path -> write to .tmp sibling -> sync_all -> drop handle -> rename over settings.json -> Ok(()).
/// @controlflow Resolve settings path -> construct temp path -> create temp file -> write payload -> sync to disk -> close handle -> rename temp to target -> cleanup temp on error -> return Ok(()).
#[tauri::command]
pub fn write_settings_file(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    // Resolve destination settings file path in the application data directory.
    let target_path = settings_path(&app)?;

    // Construct a temporary sibling file in the same directory.
    // Creating the temporary file in the same directory guarantees that the temporary file and target file
    // reside on the same filesystem volume, which is required for an atomic rename.
    let temp_path = target_path.with_extension("tmp");

    // Atomic write rationale:
    // The reason is the same as the journal's — a settings file half-written when the process dies
    // is read on the next launch — but with a sharper edge: a corrupt settings file is read at startup,
    // so a torn write turns into an editor that starts with the wrong preferences every time until someone deletes the file by hand.

    // Create the temporary sibling file.
    let mut temp_file = match fs::File::create(&temp_path) {
        Ok(file) => file,
        Err(err) => {
            // Branch: Failed to create temporary file; return error naming path and cause.
            return Err(format!(
                "Failed to create temporary settings file '{}': {err}",
                temp_path.display()
            ));
        }
    };

    // Write all payload bytes to the temporary file.
    if let Err(err) = temp_file.write_all(contents.as_bytes()) {
        // Branch: Write failed; clean up temporary file to prevent littering and return error.
        let _ = fs::remove_file(&temp_path);
        return Err(format!(
            "Failed to write contents to temporary settings file '{}': {err}",
            temp_path.display()
        ));
    } else {
        // Branch: Write succeeded; proceed to flushing file buffers to disk.
    }

    // Flush and sync all file buffers to disk before rename.
    // A settings file half-written when the process dies is read on the next launch,
    // so syncing to disk ensures the complete payload is physically committed before replacing the target.
    if let Err(err) = temp_file.sync_all() {
        // Branch: sync_all failed; clean up temporary file and return error.
        let _ = fs::remove_file(&temp_path);
        return Err(format!(
            "Failed to sync temporary settings file '{}' to disk: {err}",
            temp_path.display()
        ));
    } else {
        // Branch: sync_all succeeded; proceed to close file handle and rename.
    }

    // Drop file handle before renaming.
    // Explicitly dropping the file handle before fs::rename matters on Windows,
    // where an open handle locks the file and the rename fails.
    drop(temp_file);

    // Atomically rename the temporary file over the target settings file.
    if let Err(err) = fs::rename(&temp_path, &target_path) {
        // Branch: Rename failed; clean up temporary file and return error.
        let _ = fs::remove_file(&temp_path);
        return Err(format!(
            "Failed to rename temporary file '{}' to settings target '{}': {err}",
            temp_path.display(),
            target_path.display()
        ));
    } else {
        // Branch: Rename succeeded; atomic settings write completed successfully.
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // WHY these tests exist:
    // User configuration settings persistence protects editor preferences across launches (FR-14.15).
    // The filename constant must strictly match the TypeScript frontend's SETTINGS_FILE_NAME,
    // and verifying serde_json round-trip proves that JSON serialization and deserialization
    // dependencies are wired up and operational without needing an AppHandle runtime context.

    #[test]
    fn settings_filename_matches_contract() {
        // Pins: The settings filename constant is "settings.json".
        // This ensures a rename in Rust cannot silently diverge from the TypeScript side's SETTINGS_FILE_NAME.
        assert_eq!(
            SETTINGS_FILE, "settings.json",
            "Expected SETTINGS_FILE constant to be 'settings.json'"
        );
    }

    #[test]
    fn serde_json_round_trips_value() {
        // Pins: serde_json is properly configured and wired up to serialize and deserialize JSON documents.
        let json_input = r#"{"theme":"dark","fontSize":14,"vimMode":false}"#;

        // Parse the JSON string into a generic serde_json::Value.
        let parsed: serde_json::Value =
            serde_json::from_str(json_input).expect("deserialization into Value should succeed");

        // Verify parsed values.
        assert_eq!(parsed["theme"], "dark");
        assert_eq!(parsed["fontSize"], 14);
        assert_eq!(parsed["vimMode"], false);

        // Serialize the Value back to a JSON string.
        let serialized =
            serde_json::to_string(&parsed).expect("serialization from Value should succeed");

        // Deserialize again to verify value equivalence.
        let round_tripped: serde_json::Value =
            serde_json::from_str(&serialized).expect("second deserialization should succeed");

        assert_eq!(
            parsed, round_tripped,
            "Deserialized JSON value must match original parsed value"
        );
    }
}
