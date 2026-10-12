//! @file watcher.rs
//! @purpose Filesystem watcher for K-Doc (FR-6.4). Monitors the open document's parent directory on disk to notify the webview when external changes occur out-of-band.
//!
//! Note: This module implements out-of-band external change detection described in FR-6.4:
//! when an external tool, Git checkout, or other editor modifies, creates, or removes
//! the open document, the watcher detects the event and emits a Tauri event to the webview
//! so K-Doc can reload clean buffers or present a conflict resolver for dirty buffers.
//!
//! @inputs Webview IPC invoke requests (`watch_file`, `unwatch_file`) containing destination file paths; OS filesystem events from `notify`.
//! @outputs Tauri IPC events (`kdoc://external-change`) carrying serialized `ExternalChange` payloads; Result responses returned over IPC.
//! @functions
//!   - describe_kind: Maps a `notify::EventKind` variant to a standardized short string ("modify", "create", "remove", "other").
//!   - WatcherState::new: Constructs a new empty watcher state container.
//!   - WatcherState::is_watching: Checks whether an active filesystem watch handle is currently stored.
//!   - watch_file: Registers an active filesystem watch on a target file's parent directory and emits change events to the webview.
//!   - unwatch_file: Stops monitoring by removing and dropping the active watch handle from application state.
//! @dataflow Webview IPC invoke (`watch_file`, `unwatch_file`) -> WatcherState map keyed by window label -> OS filesystem event via `notify` -> path filtering -> `app.emit_to(<window label>, "kdoc://external-change")` to the requesting webview.
//! @controlflow Tauri invoke handler dispatches command -> validate path existence -> resolve parent directory -> create recommended_watcher -> store WatchHandle in state mutex -> await OS events -> filter and emit to webview.
//! @version 2
//! @date 2026-10-07

use notify::Watcher;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Emitter;

/// Payload emitted to the webview when an out-of-band change is detected on the watched file.
///
/// @purpose Encapsulates the target path and event kind classification for frontend consumption (FR-6.4).
#[derive(Debug, Clone, Serialize)]
pub struct ExternalChange {
    /// Filesystem path of the file that was modified, created, or removed.
    pub path: String,
    /// Short classification string of the filesystem event: "modify", "create", "remove", or "other".
    pub kind: String,
}

/// Private handle holding an active filesystem watcher and its monitored target path.
///
/// Note: It must be stored, not dropped: a `notify` watcher stops the moment it is dropped,
/// so a `watch_file` that lets it fall out of scope compiles, runs, and silently never fires.
/// Storing `WatchHandle` inside `WatcherState`'s mutex guarantees that the underlying OS watcher
/// thread remains alive for as long as the document is open in K-Doc.
struct WatchHandle {
    /// Active recommended watcher instance from notify.
    _watcher: notify::RecommendedWatcher,
    /// The target file path being monitored.
    _watched_file: PathBuf,
}

/// Application state container managing the active filesystem watcher handle.
///
/// @purpose Holds a thread-safe mutex wrapping an optional active `WatchHandle` for K-Doc (FR-6.4).
pub struct WatcherState {
    /// One filesystem watch per open window, keyed by the window label — a change to any single document never replaces or removes another window's watcher.
    inner: Mutex<HashMap<String, WatchHandle>>,
}

impl WatcherState {
    /// Creates a new, uninitialised `WatcherState` holding no active watch handle.
    ///
    /// @purpose Initialises the state container with an empty inner slot.
    /// @outputs WatcherState - Returns a state instance with `inner` set to `Mutex::new(HashMap::new())`.
    /// @dataflow empty HashMap -> Mutex::new(HashMap::new()) -> WatcherState.
    /// @controlflow Wrap None in Mutex -> construct WatcherState.
    pub fn new() -> Self {
        WatcherState {
            inner: Mutex::new(HashMap::new()),
        }
    }

    /// Checks whether an active filesystem watch handle is currently stored for a given window label.
    ///
    /// @purpose Inquires if the watcher state has an active watch registered under `label`.
    /// @inputs &self - Reference to the WatcherState instance.
    /// @inputs label - The Tauri window label whose watch presence is being queried.
    /// @outputs bool - Returns true if a watch handle exists for that window, false otherwise.
    /// @dataflow self.inner mutex lock -> HashMap::contains_key(label) -> boolean status.
    /// @controlflow Lock inner mutex -> evaluate contains_key(label) -> return bool.
    #[cfg(test)]
    pub fn is_watching(&self, label: &str) -> bool {
        let guard = match self.inner.lock() {
            Ok(g) => g,
            Err(poisoned) => {
                // Branch: Mutex was poisoned by a previous panic; recover guard to read state.
                poisoned.into_inner()
            }
        };
        // Check whether an active watch handle is present for the queried window label.
        if guard.contains_key(label) {
            // Branch: Watch handle is stored under this window label; actively watching.
            true
        } else {
            // Branch: No watch handle stored under this window label; not watching.
            false
        }
    }
}

impl WatcherState {
    /// Drops the watch a window held.
    /// @purpose Releases a closed window's file watch, which would otherwise live until the app exits.
    /// @inputs label - The closed window's label.
    /// @outputs None.
    /// @dataflow label -> map entry removed -> its notify watcher dropped.
    /// @controlflow Recover a poisoned lock, then remove the entry if present.
    pub fn forget_window(&self, label: &str) {
        let mut guard = self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.remove(label);
    }
}

impl Default for WatcherState {
    /// Returns the default empty `WatcherState`.
    ///
    /// @purpose Delegates to `WatcherState::new()` for default trait compatibility.
    /// @outputs WatcherState - Default empty watcher state.
    /// @dataflow WatcherState::new() -> WatcherState.
    /// @controlflow Call WatcherState::new() -> return instance.
    fn default() -> Self {
        Self::new()
    }
}

/// Maps a `notify::EventKind` to a standardized short string descriptor.
///
/// @purpose Translates OS-level filesystem event classifications into human-readable action tags.
/// @inputs kind - Reference to the notify::EventKind enum.
/// @outputs &'static str - One of "modify", "create", "remove", or "other".
/// @dataflow EventKind reference -> match expression -> static string slice.
/// @controlflow Match variant: Modify -> "modify", Create -> "create", Remove -> "remove", wildcard -> "other".
fn describe_kind(kind: &notify::EventKind) -> &'static str {
    match kind {
        notify::EventKind::Modify(_) => {
            // Branch: File content or metadata modification event.
            "modify"
        }
        notify::EventKind::Create(_) => {
            // Branch: File creation event.
            "create"
        }
        notify::EventKind::Remove(_) => {
            // Branch: File removal or deletion event.
            "remove"
        }
        _ => {
            // Branch: Other filesystem event (e.g., access, any, or vendor-specific).
            "other"
        }
    }
}

/// Registers an active filesystem watcher on a target file to notify the webview of external changes.
///
/// @purpose Watches the target file's parent directory for modifications, renames, and deletions (FR-6.4).
/// @inputs app - The Tauri application handle used to emit IPC events.
/// @inputs window - The calling window whose label keys its per-window watch in WatcherState.
/// @inputs state - Tauri application state container managing the WatcherState.
/// @inputs path - Destination filesystem path of the file to watch.
/// @outputs Result<(), String> - Returns Ok(()) on successful watch registration, or Err with descriptive message.
/// @dataflow path -> PathBuf -> existence check -> resolve parent directory -> notify::recommended_watcher -> watcher.watch() -> store WatchHandle in state mutex -> Ok(()).
/// @controlflow Resolve path -> verify existence -> resolve parent dir -> build watcher closure -> register watcher on parent -> acquire state lock -> replace previous handle -> return Ok(()). Returns Err on any validation or notify failure.
#[tauri::command]
pub fn watch_file(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, WatcherState>,
    grants: tauri::State<'_, crate::grants::GrantState>,
    path: String,
) -> Result<(), String> {
    // Only a document the user chose is watched.
    grants.require(&path)?;
    let target_path = PathBuf::from(&path);

    // Check if the target file exists on disk.
    if !target_path.exists() {
        // Branch: File does not exist; reject with a descriptive message naming the missing path.
        return Err(format!("Cannot watch non-existent file '{}'", path));
    } else {
        // Branch: File exists on disk; proceed to determine parent directory.
    }

    // Resolve the parent directory of the target file.
    //
    // WHY watch the parent directory instead of the file?
    // Editors and many tools (including K-Doc's own write_text_file and journal_write)
    // save by writing a temporary file and renaming it over the target, which on most platforms
    // replaces the inode. A watch placed directly on the file itself follows the old inode
    // and goes silent after the first external save — exactly the case this feature exists to catch.
    // Watching the parent directory and filtering events by filename survives atomic renames
    // and inode replacement because directory contents are monitored continuously.
    let parent_dir = match target_path.parent() {
        Some(parent) => {
            // Check if the parent path component is empty (e.g., a plain relative filename like "doc.md").
            if parent.as_os_str().is_empty() {
                // Branch: Empty parent path component; default to current working directory ".".
                PathBuf::from(".")
            } else {
                // Branch: Non-empty parent directory path present; use it directly.
                parent.to_path_buf()
            }
        }
        None => {
            // Branch: Target path has no resolvable parent directory (e.g., filesystem root); reject.
            return Err(format!(
                "Failed to watch file '{}': path has no parent directory",
                path
            ));
        }
    };

    let watched_file = target_path.clone();
    let target_file_name = target_path.file_name().map(|n| n.to_os_string());
    let emit_path = path.clone();
    let app_handle = app.clone();

    // Capture the calling window's label so change events can be routed only to this window.
    let label = window.label().to_string();
    let emit_label = label.clone();

    // Construct the notify event handler closure.
    // On Ok(event), filters to events whose paths contain the watched file,
    // maps event.kind to a short string ("modify", "create", "remove", "other"),
    // and emits a Tauri event named "kdoc://external-change" carrying ExternalChange.
    let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
        match res {
            Ok(event) => {
                // Branch: OS filesystem event successfully received; inspect affected paths.
                let has_target_file = event.paths.iter().any(|event_path| {
                    // Check if the event path matches the watched file directly.
                    if event_path == &watched_file {
                        // Branch: Direct path equality matches watched file.
                        true
                    } else {
                        // Branch: Direct path does not match; check if filename matches in the watched parent directory.
                        match (&target_file_name, event_path.file_name()) {
                            (Some(expected), Some(actual)) if expected == actual => {
                                // Branch: Filename matches target file within watched directory.
                                true
                            }
                            _ => {
                                // Branch: Filename does not match or is missing; ignore event.
                                false
                            }
                        }
                    }
                });

                // Check if any path in the event corresponds to the monitored file.
                if has_target_file {
                    // Branch: Event affects the monitored file; prepare and emit external change event.
                    let change = ExternalChange {
                        path: emit_path.clone(),
                        kind: describe_kind(&event.kind).to_string(),
                    };

                    // Emit event to this window only via tauri::Emitter trait.
                    // The change is delivered only to the window that asked for the watch, so a concurrent document in another window never receives stale external-change events.
                    // Ignore a failed emit rather than panicking:
                    // the webview may simply have gone away, refreshed, or closed,
                    // and panicking on the watcher thread would take the entire desktop host down.
                    let _ = app_handle.emit_to(
                        tauri::EventTarget::labeled(emit_label.clone()),
                        "kdoc://external-change",
                        change,
                    );
                } else {
                    // Branch: Event affects a different file in the parent directory; ignore.
                }
            }
            Err(_) => {
                // Branch: Filesystem event delivery failed from OS; ignore to keep watcher thread alive.
            }
        }
    })
    .map_err(|err| format!("Failed to initialize filesystem watcher for '{path}': {err}"))?;

    // Watch the parent directory with RecursiveMode::NonRecursive.
    watcher
        .watch(&parent_dir, notify::RecursiveMode::NonRecursive)
        .map_err(|err| {
            format!(
                "Failed to watch parent directory '{}' for file '{path}': {err}",
                parent_dir.display()
            )
        })?;

    let handle = WatchHandle {
        _watcher: watcher,
        _watched_file: target_path,
    };

    // Acquire the mutex lock guarding WatcherState.
    let mut guard = state.inner.lock().map_err(|err| {
        format!("Failed to acquire watcher state lock: {err}")
    })?;

    // Look up and drop only this window's previous watch before inserting the new handle, so other windows' watches are never disturbed.
    if let Some(previous) = guard.remove(&label) {
        // Branch: A prior watch exists for this window label; dropping it stops that watcher immediately.
        drop(previous);
    } else {
        // Branch: No prior watch registered under this window label; nothing to remove before inserting the new handle.
    }

    // Replace only this window's previous watch by storing the new handle under its label, dropping the old one while leaving every other window's watch untouched in the map.
    //
    // WHY replace the existing watch?
    // K-Doc watches exactly one open file at a time per window, so failing to replace an existing handle
    // would leave the previous file active, firing change events attributed to the current document.
    // Storing the new WatchHandle under this label drops that window's previous WatchHandle, which drops its notify::RecommendedWatcher
    // and immediately stops the previous watch without requiring an explicit unwatch call — while leaving every other window's watch intact in the map.
    guard.insert(label, handle);

    Ok(())
}

/// Stops monitoring the currently watched file, if any.
///
/// @purpose Stops monitoring for a single window by removing its watch handle from state, leaving other windows' watches intact.
/// @inputs window - The calling window whose label identifies which per-window watch to drop.
/// @inputs state - Tauri application state container managing the WatcherState.
/// @outputs Result<(), String> - Returns Ok(()) on successful clearance, or Err on mutex lock failure.
/// @dataflow state.inner mutex lock -> take() Option<WatchHandle> -> drop old handle -> Ok(()).
/// @controlflow Acquire state lock -> take handle out of mutex slot -> drop handle -> return Ok(()).
#[tauri::command]
pub fn unwatch_file(
    window: tauri::Window,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|err| {
        format!("Failed to acquire watcher state lock: {err}")
    })?;

    // Remove only this window's handle from the map and drop it; other windows' watches remain untouched.
    //
    // Note: Dropping the WatchHandle is what stops the watch — there is no explicit stop call in notify.
    // When the RecommendedWatcher inside WatchHandle is dropped, its internal thread and OS-level
    // directory watch resources are cleaned up immediately. Only this window's watch is dropped; other windows keep theirs.
    let old_handle = guard.remove(window.label());
    drop(old_handle);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // WHY these tests exist:
    // The filesystem watcher is responsible for detecting out-of-band changes to the open document (FR-6.4).
    // Event kind mapping must reliably classify OS events into frontend action strings ("modify", "create",
    // "remove", "other") so the conflict resolution UI triggers properly, and state initialization must ensure
    // no dangling or unexpected watch handles exist on startup.

    #[test]
    fn describes_modify_event_kind() {
        // Pins: describe_kind returns "modify" for notify::EventKind::Modify variants.
        use notify::event::ModifyKind;
        let event_kind = notify::EventKind::Modify(ModifyKind::Any);
        assert_eq!(describe_kind(&event_kind), "modify");
    }

    #[test]
    fn describes_create_event_kind() {
        // Pins: describe_kind returns "create" for notify::EventKind::Create variants.
        use notify::event::CreateKind;
        let event_kind = notify::EventKind::Create(CreateKind::Any);
        assert_eq!(describe_kind(&event_kind), "create");
    }

    #[test]
    fn describes_remove_event_kind() {
        // Pins: describe_kind returns "remove" for notify::EventKind::Remove variants.
        use notify::event::RemoveKind;
        let event_kind = notify::EventKind::Remove(RemoveKind::Any);
        assert_eq!(describe_kind(&event_kind), "remove");
    }

    #[test]
    fn describes_catch_all_event_kind() {
        // Pins: describe_kind returns "other" for non-modify/create/remove variants (e.g. Other or Access).
        use notify::event::AccessKind;
        let other_kind = notify::EventKind::Other;
        assert_eq!(describe_kind(&other_kind), "other");

        let access_kind = notify::EventKind::Access(AccessKind::Any);
        assert_eq!(describe_kind(&access_kind), "other");
    }

    #[test]
    fn watcher_state_starts_empty() {
        // Pins: WatcherState::new() starts without an active watch handle,
        // and is_watching() reports false initially.
        let state = WatcherState::new();
        assert!(!state.is_watching("main"));
    }

    #[test]
    fn watcher_state_default_starts_empty() {
        // Pins: Default implementation creates an empty WatcherState.
        let state = WatcherState::default();
        assert!(!state.is_watching("main"));
    }

    /// Forgetting a window that holds no watch is harmless, and leaves no watch behind.
    #[test]
    fn forgetting_a_window_without_a_watch_is_harmless() {
        let state = WatcherState::new();
        state.forget_window("doc-7");
        assert!(!state.is_watching("doc-7"));
    }
}
