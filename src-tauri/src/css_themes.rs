//! @file export_themes.rs
//! @purpose Keeps the reader's own export stylesheets as .css files under <app data>/export-themes and lists, reads, and seeds them (FR-13.8).
//! @inputs an application handle used to locate the export-themes folder, a theme name, or starter stylesheet contents.
//! @outputs theme names in order, one theme's CSS text on disk, or the reason a name is invalid or a file cannot be read or written.
//! @functions is_valid_theme_name - validates a theme name before it becomes a path; themes_dir - builds and validates the export-themes folder under root; theme_names_in - lists .css theme names in order; export_theme_names - Tauri command returning the theme names; export_theme_css - Tauri command reading one theme's CSS; export_theme_folder - Tauri command seeding a starter theme and returning the folder.
//! @dataflow webview name+bytes -> is_valid_theme_name (validate) -> themes_dir (locate) -> fs operations (list/read/write).
//! @controlflow validate every name before it becomes a path, list only .css files, read one theme's CSS on demand, and seed a starter only when the folder is empty.
//! @version 2
//! @date 2026-09-18

use notify::Watcher;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use crate::binary_file::write_bytes_atomically;

/// Which set of stylesheets a call is about: the ones an export is written with, or the ones the app itself wears.
///
/// @purpose Keeps the folder name out of the webview's hands: it names a kind, and this decides the folder (FR-13.8, FR-14.10).
/// @inputs kind - "export" or "app".
/// @outputs Ok with the folder name under the application data directory, or Err naming what was asked for.
/// @dataflow kind -> folder name.
/// @controlflow Anything that is not one of the two known kinds is refused.
pub fn kind_folder(kind: &str) -> Result<&'static str, String> {
    // Check which set of themes was asked for.
    if kind == "export" {
        Ok("export-themes")
    } else if kind == "app" {
        Ok("themes")
    } else {
        Err(format!("\"{kind}\" is not a kind of theme"))
    }
}

/// The folder watch that makes a theme edit show up without a restart (FR-14.10).
pub struct ThemeWatchState {
    inner: Mutex<Option<notify::RecommendedWatcher>>,
}

impl ThemeWatchState {
    /// Creates the state with no watch in place.
    ///
    /// @purpose Gives Tauri something to manage before any theme folder is watched.
    /// @inputs None.
    /// @outputs An empty ThemeWatchState.
    /// @dataflow None.
    /// @controlflow No branches.
    pub fn new() -> Self {
        ThemeWatchState { inner: Mutex::new(None) }
    }
}

impl Default for ThemeWatchState {
    fn default() -> Self {
        Self::new()
    }
}

/// A theme name becomes a file name, so it is checked first: 1-64 characters, each a letter, digit, space, hyphen or underscore.
///
/// @purpose Reject any name that cannot safely become a file name before it is joined onto the export-themes folder (FR-13.8).
/// @inputs name - the candidate theme name to validate.
/// @outputs true when the name is 1-64 characters long and every character is an ASCII letter, digit, space, hyphen or underscore; false otherwise.
/// @dataflow raw name string -> a mandatory non-empty length bound then a per-character class check -> boolean result.
/// @controlflow Combine the length bound and the per-character allowance in one expression; no branching is needed because both outcomes feed the single boolean result.
pub fn is_valid_theme_name(name: &str) -> bool {
    // The name must be present, at most 64 characters long, and composed only of allowed characters.
    !name.is_empty() && name.chars().count() <= 64 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == ' ' || c == '-' || c == '_')
}

/// Builds the export-themes folder beneath the application data directory, creating it when absent.
///
/// @purpose Turn the application handle into a safe on-disk location for exported themes (FR-13.8).
/// @inputs app - the Tauri handle used to query platform-specific data locations.
/// @outputs Ok(PathBuf) with <app data>/export-themes when it can be located and created; Err(String) naming the reason otherwise.
/// @dataflow AppHandle -> tauri Manager path API -> app_data_dir -> join("export-themes") -> create_dir_all.
/// @controlflow Resolve the application data directory, join the export-themes folder, ensure it exists, then return its path.
fn themes_dir(app: &tauri::AppHandle, kind: &str) -> Result<PathBuf, String> {
    let folder = kind_folder(kind)?;
    // Locate the per-user application data directory that will contain the export-themes folder.
    let root = app.path().app_data_dir().map_err(|error| format!("Could not find the application data folder: {error}"))?;
    // The themes live in a dedicated subfolder, kept separate from any other application state.
    let dir = root.join(folder);
    // Create the folder if it does not yet exist so later reads and writes have a home.
    fs::create_dir_all(&dir).map_err(|error| format!("Could not create {}: {error}", dir.display()))?;
    Ok(dir)
}

/// Lists the names of the .css files in a folder, without their extension, sorted in order.
///
/// @purpose Offer only genuine theme files (those ending in .css) whose stem is a valid theme name, so stray or malformed entries are never surfaced (FR-13.8).
/// @inputs dir - the export-themes folder to scan for theme files.
/// @outputs Ok(Vec<String>) with each valid theme name in sorted order; Err(String) naming the reason when the folder cannot be read.
/// @dataflow dir -> fs::read_dir -> per-entry extension and stem checks -> is_valid_theme_name -> sorted names Vec.
/// @controlflow Read every entry, skip anything that is not a .css file, validate each remaining stem, then sort the survivors before returning.
pub fn theme_names_in(dir: &Path) -> Result<Vec<String>, String> {
    // Collect valid theme names here; empty until entries are inspected.
    let mut names: Vec<String> = Vec::new();
    // Open the folder so every entry can be examined; a failure here aborts the whole listing.
    let entries = fs::read_dir(dir).map_err(|error| format!("Could not read {}: {error}", dir.display()))?;
    for entry in entries {
        // Each directory record may itself fail to load, so surface that reason rather than skipping silently.
        let entry = entry.map_err(|error| format!("Could not read {}: {error}", dir.display()))?;
        let path = entry.path();
        // Only .css files are themes; anything else in the folder is left alone.
        if path.extension().and_then(|value| value.to_str()) != Some("css") {
            // Not a .css file: skip this entry so non-theme files never become theme names.
            continue;
        } else {
            // A .css file: fall through to inspect its stem as a candidate theme name.
        }
        // A name that could not be a file name K-Doc wrote is skipped rather than offered.
        match path.file_stem().and_then(|value| value.to_str()) {
            // The stem exists and is a valid theme name: record it for the reader to choose from.
            Some(stem) if is_valid_theme_name(stem) => names.push(stem.to_string()),
            // No stem, or a stem that fails validation: leave this file out of the offered list.
            _ => {}
        }
    }
    // Present the theme names in a stable, alphabetical order for the reader's menu.
    // Windows already hands them back in order, so no test here can tell the sort from its absence; it is what
    // keeps the list stable on a filesystem that does not.
    names.sort();
    Ok(names)
}

/// Returns the names of every exported theme currently on disk, in order.
///
/// @purpose Give the reader a menu of their existing themes to edit or preview (FR-13.8).
/// @inputs app - Tauri handle locating the export-themes folder.
/// @outputs Ok(Vec<String>) with each theme name; Err(String) naming why the folder could not be located or read.
/// @dataflow app -> themes_dir -> theme_names_in -> sorted names Vec.
/// @controlflow Resolve the folder, then list and sort its theme files in one step.
#[tauri::command]
pub fn theme_names(app: tauri::AppHandle, kind: String) -> Result<Vec<String>, String> {
    // Locate (creating if needed) the folder that holds this kind of theme.
    let dir = themes_dir(&app, &kind)?;
    // Return the sorted list of valid theme names found there.
    theme_names_in(&dir)
}

/// Reads the CSS text of one exported theme by name.
///
/// @purpose Hand a reader's stylesheet back to them for editing, refusing any name that is not a valid theme first (FR-13.8).
/// @inputs app - Tauri handle locating the export-themes folder; name - the requested theme name.
/// @outputs Ok(String) with the theme's CSS contents; Err(String) naming an invalid name or a read failure otherwise.
/// @dataflow app+name -> is_valid_theme_name (validate) -> themes_dir -> fs::read_to_string on <theme>.css.
/// @controlflow Validate the name before touching disk, resolve the folder, then read that one theme's file and return its text.
#[tauri::command]
pub fn theme_css(app: tauri::AppHandle, kind: String, name: String) -> Result<String, String> {
    // Refuse a name that could name something outside the folder before building a path from it.
    if !is_valid_theme_name(&name) {
        // The name is not a valid theme name: refuse to read anything rather than guessing at a path.
        return Err(format!("\"{name}\" is not a theme name"));
    } else {
        // The name is well-formed: proceed to locate the folder and build its file path.
    }
    let dir = themes_dir(&app, &kind)?;
    let path = dir.join(format!("{name}.css"));
    fs::read_to_string(&path).map_err(|error| format!("Could not read {}: {error}", path.display()))
}

/// Returns the folder the reader edits their themes in, writing a starter theme the first time so the folder is not empty.
///
/// @purpose Reveal the export-themes folder to the reader and seed it with one example stylesheet only when it is still empty (FR-13.8).
/// @inputs app - Tauri handle locating the export-themes folder; starter - CSS text written as the first theme so the folder is not blank.
/// @outputs Ok(String) with the folder's path; Err(String) naming why the folder could not be located, read, or seeded.
/// @dataflow app+starter -> themes_dir -> theme_names_in (check) -> write_bytes_atomically (seed when empty) -> folder path string.
/// @controlflow Resolve the folder, check whether any theme already exists, and write the starter only when none is present.
#[tauri::command]
pub fn theme_folder(app: tauri::AppHandle, kind: String, starter: String) -> Result<String, String> {
    // Locate (creating if needed) the folder that holds this kind of theme.
    let dir = themes_dir(&app, &kind)?;
    // See what is already there so a starter is only written to an empty folder.
    let existing = theme_names_in(&dir)?;
    // Check whether the folder already holds a theme; a starter is only for a folder with none.
    if existing.is_empty() {
        // No theme yet: write the provided starter as custom.css so the reader has something to edit.
        let path = dir.join("custom.css");
        write_bytes_atomically(&path.display().to_string(), starter.as_bytes())?;
    } else {
        // A theme already exists: leave it untouched and do not overwrite the reader's work.
    }
    Ok(dir.display().to_string())
}

/// Watches a theme folder so an edit to a theme shows up without a restart (FR-14.10).
///
/// @purpose Tells the webview that a theme file changed, so it can read it again and put it back on the window.
/// @inputs app - the handle used to emit the event; state - the one watch this holds; kind - which themes to watch.
/// @outputs Ok(()) once the folder is watched; Err naming the folder and the reason otherwise.
/// @dataflow folder -> notify watcher -> app.emit("kdoc://theme-changed", kind).
/// @controlflow One watch at a time: starting another replaces it, as only the chosen kind is worth watching. The
///   whole folder is watched rather than one file, because an editor saving a theme replaces the file.
#[tauri::command]
pub fn theme_watch(
    app: tauri::AppHandle,
    state: tauri::State<'_, ThemeWatchState>,
    kind: String,
) -> Result<(), String> {
    let dir = themes_dir(&app, &kind)?;
    let app_handle = app.clone();
    let emitted_kind = kind.clone();

    let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
        // Check whether the event arrived or the watch itself failed.
        if let Ok(event) = res {
            // A theme is only its own file, so any .css file changing in the folder is worth reporting.
            let touched_css = event.paths.iter().any(|path| {
                path.extension().and_then(|value| value.to_str()) == Some("css")
            });
            // Check whether a stylesheet was involved.
            if touched_css {
                let _ = app_handle.emit("kdoc://theme-changed", emitted_kind.clone());
            } else {
                // Something else in the folder: nothing to reload.
            }
        } else {
            // A failed watch cannot be acted on from here; the reader's theme simply stops reloading itself.
        }
    })
    .map_err(|error| format!("Could not watch {}: {error}", dir.display()))?;

    watcher
        .watch(&dir, notify::RecursiveMode::NonRecursive)
        .map_err(|error| format!("Could not watch {}: {error}", dir.display()))?;

    let mut guard = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(watcher);
    Ok(())
}

/// Stops watching a theme folder (FR-14.10).
///
/// @purpose Lets the webview give up the watch when no theme of the reader's is in use.
/// @inputs state - the one watch this holds.
/// @outputs Ok(()) always: having no watch is the state this asks for.
/// @dataflow state -> dropped watcher.
/// @controlflow Dropping the watcher is what stops the OS watch.
#[tauri::command]
pub fn theme_unwatch(state: tauri::State<'_, ThemeWatchState>) -> Result<(), String> {
    let mut guard = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    *guard = None;
    Ok(())
}

/// Unit tests, kept in a sibling file.
#[cfg(test)]
#[path = "css_themes_tests.rs"]
mod css_themes_tests;
