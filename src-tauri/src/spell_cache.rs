//! @file spell_cache.rs
//! @purpose Keeps downloaded Hunspell dictionaries on disk under <app data>/dictionaries/<language>/index.aff|index.dic and loads them into the spell engine (FR-12.3).
//! @inputs a language tag plus its .aff/.dic contents, or an application handle used to locate the cache directory.
//! @outputs dictionary files on disk, the word count loaded, or the reason a dictionary could not be read, written, or installed.
//! @functions is_valid_language_tag - validates a BCP-47-style tag before it becomes a path; dictionary_folder - builds and validates the dictionaries/<language> folder under root; read_dictionary - returns the cached .aff/.dic pair when both files are present, else Ok(None); write_dictionary - atomically persists an .aff/.dic pair to disk; data_root - resolves the application data directory; spell_load_cached - Tauri command loading a cached dictionary into the spell engine; spell_install_dictionary - Tauri command parsing then persisting a downloaded dictionary.
//! @dataflow webview tag+bytes -> is_valid_language_tag -> dictionary_folder -> load_language (in memory) and write_bytes_atomically (on disk).
//! @controlflow validate the tag, parse before storing so an invalid download is never cached, read both halves or treat as absent, and write .dic then .aff so a reader never sees an orphaned affix file.
//! @version 1
//! @date 2026-09-18

use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;
use crate::binary_file::write_bytes_atomically;
use crate::spell::{load_language, SpellState};

/// A language tag names a folder on disk, so it is validated before it becomes part of a path: 2-3 lowercase letters, then optionally a hyphen followed by 2-8 ASCII letters or digits ("en", "en-GB", "sr-Latn", "ca-valencia").
///
/// @purpose Reject anything that is not a well-formed primary tag with an optional subtag, so a bad tag can never become part of a filesystem path (FR-12.3).
/// @inputs tag - the language tag to validate, e.g. "en", "en-GB", "sr-Latn", or "ca-valencia".
/// @outputs true when the tag matches the required shape; false otherwise.
/// @dataflow raw tag string -> split on the first hyphen into at most two parts -> primary and optional subtag length/character checks -> boolean result.
/// @controlflow Split into a mandatory primary part and an optional subtag, validate the primary, then either accept an absent subtag or validate its presence; no early return is needed because both outcomes feed the single boolean result.
pub fn is_valid_language_tag(tag: &str) -> bool {
    // Split on the first hyphen only, so a subtag like "Latn" in "sr-Latn" stays intact instead of being truncated by a broad split.
    let mut parts = tag.splitn(2, '-');
    // The primary part always exists because splitn yields at least one item even for an empty string; unwrap_or supplies that empty string rather than panicking, and is not an unwrap.
    let primary = parts.next().unwrap_or("");
    // A valid primary is 2-3 lowercase ASCII letters; when it fails this shape the whole tag is invalid, so reject immediately.
    if !(2..=3).contains(&primary.len()) || !primary.bytes().all(|b| b.is_ascii_lowercase()) {
        // Primary part does not match: the tag is rejected outright.
        return false;
    } else {
        // Primary part is well-formed: fall through to validate the optional subtag, if any.
        // The subtag, when present, must be 2-8 ASCII letters or digits; its absence (None) is itself valid.
        match parts.next() {
            // No subtag: a bare primary tag such as "en" satisfies the rules.
            None => true,
            // A subtag is present: it must satisfy both the length and character constraints.
            Some(sub) => (2..=8).contains(&sub.len()) && sub.bytes().all(|b| b.is_ascii_alphanumeric()),
        }
    }
}

/// Builds the dictionaries/<language> folder beneath root, but only after the tag is known to be valid.
///
/// @purpose Turn a language tag into a safe on-disk location, refusing malformed tags before joining anything onto root (FR-12.3).
/// @inputs root - the application data directory that contains the dictionaries/ folder; language - the candidate language tag.
/// @outputs Ok(PathBuf) with <root>/dictionaries/<language> when the tag is valid; Err(String) naming the reason when it is not.
/// @dataflow language tag -> is_valid_language_tag -> root.join("dictionaries").join(language).
/// @controlflow Validate the tag first, returning an error on failure, else construct and return the joined path.
pub fn dictionary_folder(root: &Path, language: &str) -> Result<PathBuf, String> {
    // A malformed tag cannot be turned into a safe path, so refuse it before joining anything onto root.
    if !is_valid_language_tag(language) {
        // Tag is invalid: report the reason instead of building an unsafe path.
        return Err(format!("\"{language}\" is not a language tag K-Doc can store a dictionary under"));
    } else {
        // Tag is valid: build the dictionaries/<language> folder beneath root.
        Ok(root.join("dictionaries").join(language))
    }
}

/// Returns the cached .aff/.dic pair for a language, treating a half-written cache as no cache at all.
///
/// @purpose Load a previously stored dictionary from disk, so spell checking can resume without re-downloading (FR-12.3).
/// @inputs root - application data directory that contains the dictionaries/ folder; language - the validated language tag selecting the subfolder.
/// @outputs Ok(Some((aff, dic))) with both files' contents when both are present; Ok(None) when either file is missing; Err(String) naming the failing path if a present file cannot be read.
/// @dataflow root+language -> dictionary_folder -> index.aff and index.dic paths -> fs::read_to_string on each -> (String, String).
/// @controlflow Resolve the folder, check both files exist, return None early when either is absent, else read both and pair them.
pub fn read_dictionary(root: &Path, language: &str) -> Result<Option<(String, String)>, String> {
    // Resolve the folder first so a bad tag fails here rather than deep inside the file reads.
    let folder = dictionary_folder(root, language)?;
    // The two files that together make up one dictionary, named by convention.
    let aff_path = folder.join("index.aff");
    let dic_path = folder.join("index.dic");
    // If either half is missing the cache is incomplete and must be treated as absent rather than a read error.
    if !aff_path.is_file() || !dic_path.is_file() {
        // One or both halves are absent: report "no cache" instead of failing.
        return Ok(None);
    } else {
        // Both halves are present: load each, naming any failure with its path.
        let aff = fs::read_to_string(&aff_path).map_err(|error| format!("Could not read {}: {error}", aff_path.display()))?;
        let dic = fs::read_to_string(&dic_path).map_err(|error| format!("Could not read {}: {error}", dic_path.display()))?;
        Ok(Some((aff, dic)))
    }
}

/// Atomically persists a dictionary's .aff/.dic pair to <root>/dictionaries/<language> for the next launch.
///
/// @purpose Keep a validated dictionary on disk so spell checking survives application restarts (FR-12.3).
/// @inputs root - application data directory; language - the validated language tag selecting the subfolder; aff - the affix file contents; dic - the word-list contents.
/// @outputs Ok(()) when both files are durably written; Err(String) naming the reason if the folder cannot be created or a file cannot be written.
/// @dataflow root+language -> dictionary_folder -> write_bytes_atomically for index.dic then index.aff.
/// @controlflow Resolve the folder, create it if needed, then write .dic first and .aff last so a reader never sees an affix without its word list.
pub fn write_dictionary(root: &Path, language: &str, aff: &str, dic: &str) -> Result<(), String> {
    // Refuse a bad tag before creating any folders on disk.
    let folder = dictionary_folder(root, language)?;
    // Ensure the dictionaries/<language> directory exists before writing into it.
    fs::create_dir_all(&folder).map_err(|error| format!("Could not create {}: {error}", folder.display()))?;
    // The .dic is written first and the .aff last, so a read never finds an .aff without its word list.
    write_bytes_atomically(&folder.join("index.dic").display().to_string(), dic.as_bytes())?;
    write_bytes_atomically(&folder.join("index.aff").display().to_string(), aff.as_bytes())?;
    Ok(())
}

/// Resolves the per-user application data directory where cached dictionaries live.
///
/// @purpose Locate the base directory that contains the dictionaries/ folder (FR-12.3).
/// @inputs app - the Tauri handle used to query platform-specific data locations.
/// @outputs Ok(PathBuf) with the application data directory; Err(String) when it cannot be determined.
/// @dataflow AppHandle -> tauri Manager path API -> app_data_dir -> PathBuf.
/// @controlflow Delegate to Tauri's path manager and surface any resolution failure as an error.
fn data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Ask Tauri for the per-user application data directory; a failure here means there is nowhere safe to cache dictionaries.
    app.path().app_data_dir().map_err(|error| format!("Could not find the application data folder: {error}"))
}

/// Loads a cached dictionary into the spell engine when one exists for the language.
///
/// @purpose Populate the in-memory spell state from disk on demand, reporting whether anything was loaded (FR-12.3).
/// @inputs app - Tauri handle locating the cache directory; state - shared mutable spell engine state; language - the requested language tag.
/// @outputs Ok(true) when a cached dictionary was found and loaded; Ok(false) when nothing was cached; Err(String) naming any failure to locate or read the cache.
/// @dataflow app -> data_root -> read_dictionary -> load_language into SpellState.
/// @controlflow Resolve the root, match on the cached pair, load it when present and report true, otherwise report false.
#[tauri::command]
pub fn spell_load_cached(app: tauri::AppHandle, state: tauri::State<'_, SpellState>, language: String) -> Result<bool, String> {
    // Locate the application data directory that holds cached dictionaries.
    let root = data_root(&app)?;
    // Look up whatever is on disk for this language.
    match read_dictionary(&root, &language)? {
        // Nothing cached: report "not loaded" rather than an error.
        None => Ok(false),
        // A complete dictionary was found: load it into the spell engine and report success.
        Some((aff, dic)) => {
            load_language(&state, &language, &aff, &dic)?;
            Ok(true)
        }
    }
}

/// Parses a downloaded dictionary and, only if it is valid, stores it for next launch.
///
/// @purpose Refuse non-dictionary downloads before caching them and persist validated ones (FR-12.3).
/// @inputs app - Tauri handle locating the cache directory; state - shared mutable spell engine state; language - the requested language tag; aff - the affix file contents; dic - the word-list contents.
/// @outputs Ok(word count) when the dictionary was parsed and stored; Err(String) naming a bad tag, an invalid dictionary, or a write failure otherwise.
/// @dataflow webview bytes -> dictionary_folder (validate) -> load_language (parse) -> write_dictionary (persist).
/// @controlflow Validate the tag, parse before storing so an invalid download is never cached, then persist and return the word count.
/// Parsed BEFORE it is stored, so a download that is not a dictionary is refused and never cached.
#[tauri::command]
pub fn spell_install_dictionary(app: tauri::AppHandle, state: tauri::State<'_, SpellState>, language: String, aff: String, dic: String) -> Result<usize, String> {
    // Locate the application data directory that holds cached dictionaries.
    let root = data_root(&app)?;
    // Refuse a malformed tag before parsing megabytes of dictionary content.
    dictionary_folder(&root, &language)?;
    // Parse and load first so an invalid dictionary is rejected before anything is written to disk.
    let count = load_language(&state, &language, &aff, &dic)?;
    // Persist the freshly validated dictionary for next time; a failure here does not undo the in-memory load but must be reported.
    write_dictionary(&root, &language, &aff, &dic).map_err(|error| format!("The dictionary is in use, but could not be kept for next time: {error}"))?;
    Ok(count)
}

/// Unit tests for this module, kept in a sibling file so they do not bloat it.
#[cfg(test)]
#[path = "spell_cache_tests.rs"]
mod spell_cache_tests;
