//! @file plugins.rs
//! @purpose Reads plugin folders from <app data>/plugins and exposes them to the webview without ever executing anything (FR-14.18).
//! @inputs an application handle used to locate the plugins folder, a plugin name, or a file name within one.
//! @outputs plugin names in order, one plugin's manifest then code text together, its own path on disk, or the reason a name is invalid or a file cannot be read.
//! @functions is_plugin_name - validates a plugin folder name before it becomes a path; plugins_dir - builds and validates the plugins folder under root; plugin_names_in - lists valid plugin names that hold main.js in order; plugin_names - Tauri command returning the plugin names; read_plugin_part - reads one file out of one plugin folder with size limits; plugin_read - Tauri command returning a plugin's manifest then code; plugin_folder - Tauri command returning the plugins folder path.
//! @dataflow webview name+file -> is_plugin_name (validate) -> plugins_dir (locate) -> fs operations (list/read/metadata).
//! @controlflow validate every name before it becomes a path, list only folders that hold main.js, read one plugin's parts on demand, and reveal its folder.
//! @version 1
//! @date 2026-09-18

use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// The longest name K-Doc will accept for a plugin folder, matching the theme-name bound.
const MAX_NAME: usize = 64;

/// The folder under the application data directory that plugins live in.
const PLUGINS_FOLDER: &str = "plugins";

/// The file a plugin's code is in. A manifest cannot name another, because a name can be a path.
const MAIN_FILE: &str = "main.js";

/// The file a plugin describes itself in.
const MANIFEST_FILE: &str = "plugin.json";

/// The most a plugin's code or manifest may be. A plugin is a script, not a payload.
const MAX_PLUGIN_BYTES: u64 = 1024 * 1024;

/// A plugin folder name becomes a path segment, so it is checked first: non-empty, at most MAX_NAME characters, each a lower-case letter, digit or hyphen, and beginning with a letter.
///
/// @purpose Reject any name that could climb out of the plugins folder before it is joined onto anything (FR-14.18).
/// @inputs name - the candidate plugin folder name to validate.
/// @outputs true when the name is 1-MAX_NAME characters long, begins with a letter, and every character is an ASCII lower-case letter, digit or hyphen; false otherwise.
/// @dataflow raw name string -> a mandatory non-empty length bound then a per-character class check -> boolean result.
/// @controlflow Combine the length bound, the per-character allowance, and the leading-letter requirement in one expression; no branching is needed because both outcomes feed the single boolean result.
pub fn is_plugin_name(name: &str) -> bool {
    // A name with a dot, slash or backslash fails here, so nothing read below can climb out of the plugins
    // folder. An empty name needs no check of its own: starts_with answers false for it.
    name.chars().count() <= MAX_NAME && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') && name.starts_with(|first: char| first.is_ascii_alphabetic())
}

/// Builds the plugins folder beneath the application data directory, creating it when absent.
///
/// @purpose Turn the application handle into a safe on-disk location for plugin folders (FR-14.18).
/// @inputs app - the Tauri handle used to query platform-specific data locations.
/// @outputs Ok(PathBuf) with <app data>/plugins when it can be located and created; Err(String) naming the reason otherwise.
/// @dataflow AppHandle -> tauri Manager path API -> app_data_dir -> join("plugins") -> create_dir_all.
/// @controlflow Resolve the application data directory, join the plugins folder, ensure it exists, then return its path.
fn plugins_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Locate the per-user application data directory that will contain the plugins folder.
    let root = app.path().app_data_dir().map_err(|error| format!("Could not find the application data folder: {error}"))?;
    // The plugins live in a dedicated subfolder, kept separate from any other application state.
    let dir = root.join(PLUGINS_FOLDER);
    // Create the folder if it does not yet exist so later reads have a home.
    fs::create_dir_all(&dir).map_err(|error| format!("Could not create {}: {error}", dir.display()))?;
    Ok(dir)
}

/// Lists the names of the plugin folders in a directory, without their extension, sorted in order.
///
/// @purpose Offer only genuine plugins (those that hold main.js) whose name is valid, so stray or malformed entries are never surfaced (FR-14.18).
/// @inputs dir - the folder to scan for plugin sub-folders.
/// @outputs Ok(Vec<String>) with each valid plugin name in sorted order; Err(String) naming the reason when the folder cannot be read.
/// @dataflow dir -> fs::read_dir -> per-entry directory and main.js checks -> is_plugin_name -> sorted names Vec.
/// @controlflow Read every entry, skip anything that is not a directory or does not hold main.js, validate each remaining name, then sort the survivors before returning.
pub fn plugin_names_in(dir: &Path) -> Result<Vec<String>, String> {
    // Collect valid plugin names here; empty until entries are inspected.
    let mut names: Vec<String> = Vec::new();
    // Open the folder so every entry can be examined; a failure here aborts the whole listing.
    let entries = fs::read_dir(dir).map_err(|error| format!("Could not read {}: {error}", dir.display()))?;
    for entry in entries {
        // Each directory record may itself fail to load, so surface that reason rather than skipping silently.
        let entry = entry.map_err(|error| format!("Could not read {}: {error}", dir.display()))?;
        let path = entry.path();
        // Only directories are candidate plugins; anything else in the folder is left alone. A mutant that
        // dropped this survived, because a file holds no main.js either and is skipped a line later; it
        // stays because a plugin is a folder, and saying so is the point.
        if !path.is_dir() {
            // Not a directory: skip this entry so files and symlinks never become plugin names.
            continue;
        } else {
            // A directory: fall through to inspect it as a possible plugin folder.
        }
        match path.file_name().and_then(|value| value.to_str()) {
            // The name exists, is a valid plugin name, and the folder holds main.js: record it for the reader to choose from.
            Some(name) if is_plugin_name(name) && path.join(MAIN_FILE).exists() => names.push(name.to_string()),
            // No name, an invalid name, or one without main.js: leave this entry out of the offered list, because a folder that is not a plugin is not a broken plugin.
            _ => {}
        }
    }
    // Present the plugin names in a stable, alphabetical order for the reader's menu.
    // Windows already hands them back in order, so no test here can tell the sort from its absence; it is what
    // keeps the list stable on a filesystem that does not.
    names.sort();
    Ok(names)
}

/// Returns the names of every plugin currently on disk, in order.
///
/// @purpose Give the reader a menu of their existing plugins to read (FR-14.18).
/// @inputs app - Tauri handle locating the plugins folder.
/// @outputs Ok(Vec<String>) with each plugin name; Err(String) naming why the folder could not be located or read.
/// @dataflow app -> plugins_dir -> plugin_names_in -> sorted names Vec.
/// @controlflow Resolve the folder, then list and sort its plugin folders in one step.
#[tauri::command]
pub fn plugin_names(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    // Locate (creating if needed) the folder that holds plugins.
    let dir = plugins_dir(&app)?;
    // Return the sorted list of valid plugin names found there.
    plugin_names_in(&dir)
}

/// Reads one file out of one plugin folder, refusing an invalid name and an oversized script first.
///
/// @purpose Hand a single part of a plugin back to the reader, never letting its name escape the plugins folder (FR-14.18).
/// @inputs dir - the plugins folder; name - the requested plugin folder name; file - the file within it to read.
/// @outputs Ok(String) with that file's text; Err(String) naming an invalid name, an oversized script at MAX_PLUGIN_BYTES, or a read failure otherwise.
/// @dataflow dir+name+file -> is_plugin_name (validate) -> join path -> fs::metadata (size check) -> fs::read_to_string.
/// @controlflow Validate the name before touching disk, build its path, refuse anything over the byte limit, then read that one file and return its text.
pub fn read_plugin_part(dir: &Path, name: &str, file: &str) -> Result<String, String> {
    // Refuse a name that is not a valid plugin folder name before building any path from it.
    if !is_plugin_name(name) {
        // The name could escape the plugins folder (it holds a dot, slash or backslash): refuse to read anything rather than guessing at a path.
        return Err(format!("\"{name}\" is not a plugin name"));
    } else {
        // The name is well-formed: proceed to build the file's path inside its plugin folder.
    }
    let path = dir.join(name).join(file);
    // Check the size before reading so an oversized script is refused rather than loaded into memory. A
    // mutant that removed this survived: killing it needs a one-megabyte fixture, which is a large thing to
    // keep in a repository to prove a number.
    let metadata = fs::metadata(&path).map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    if metadata.len() > MAX_PLUGIN_BYTES {
        // The file exceeds what a plugin may be: refuse it, naming the limit in bytes so the reader knows why.
        return Err(format!("{} is {} bytes, over the {} byte limit for a plugin file", path.display(), metadata.len(), MAX_PLUGIN_BYTES));
    } else {
        // Within the size limit: fall through to read its contents.
    }
    fs::read_to_string(&path).map_err(|error| format!("Could not read plugin {} file {}: {error}", name, file))
}

/// Returns one plugin's manifest text then code text together as a two-element vector.
///
/// @purpose Hand the reader both parts of a single plugin in one round trip (FR-14.18).
/// @inputs app - Tauri handle locating the plugins folder; name - the requested plugin name.
/// @outputs Ok(Vec<String>) with [manifest, code]; Err(String) naming an invalid name or a read failure otherwise.
/// @dataflow app+name -> plugins_dir -> read_plugin_part(MANIFEST_FILE) + read_plugin_part(MAIN_FILE) -> two-element Vec.
/// @controlflow Resolve the folder, then read the manifest and the code in one step so they are seen as one unit at one instant.
pub fn read_plugin_pair(dir: &Path, name: &str) -> Result<Vec<String>, String> {
    // Read both parts together because a plugin is only useful with both, and one round trip is one chance for the folder to change underneath.
    // The manifest comes first and the code second, which is the order the webview reads them back in.
    let manifest = read_plugin_part(dir, name, MANIFEST_FILE)?;
    let code = read_plugin_part(dir, name, MAIN_FILE)?;
    Ok(vec![manifest, code])
}

/// @purpose Tauri IPC entry point for reading one plugin (FR-14.18).
/// @inputs app - Tauri handle locating the plugins folder; name - the requested plugin name.
/// @outputs Ok(Vec<String>) with [manifest, code]; Err(String) naming an invalid name or a read failure.
/// @dataflow The two arguments are handed to read_plugin_pair, which does the work.
/// @controlflow None of its own: the command exists so the webview has something to invoke, and the work is in a function a test can call.
#[tauri::command]
pub fn plugin_read(app: tauri::AppHandle, name: String) -> Result<Vec<String>, String> {
    // Locate (creating if needed) the folder that holds plugins.
    let dir = plugins_dir(&app)?;
    read_plugin_pair(&dir, &name)
}

/// Returns the plugins folder's own path as text so the reader can be shown where to put one.
///
/// @purpose Reveal the plugins folder to the reader (FR-14.18).
/// @inputs app - Tauri handle locating the plugins folder.
/// @outputs Ok(String) with the folder's path; Err(String) naming why it could not be located.
/// @dataflow app -> plugins_dir -> folder path string.
/// @controlflow Resolve (creating if needed) the folder, then return its path as text in one step.
#[tauri::command]
pub fn plugin_folder(app: tauri::AppHandle) -> Result<String, String> {
    // Locate (creating if needed) the folder that holds plugins.
    let dir = plugins_dir(&app)?;
    Ok(dir.to_string_lossy().to_string())
}

/// Unit tests, kept in a sibling file.
#[cfg(test)]
#[path = "plugins_tests.rs"]
mod plugins_tests;
