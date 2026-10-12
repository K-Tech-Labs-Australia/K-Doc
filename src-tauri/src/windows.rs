//! @file windows.rs
//! @purpose Second-window handoff for K-Doc (FR-6.8). Lets the webview ask for a second window showing a specific document,
//! parking the requested document under a generated label *before* that window is built so a window which boots and runs its
//! script faster than the park call still finds something to show.
//!
//! The handoff exists because there is an unavoidable ordering gap: `open_document_window` must create the window, but the new
//! window can only ask for its document once its own script has run. Parking the document first closes that gap — by the time
//! the window exists it already knows what to render. The entry is removed (not merely read) when claimed so a reloaded window
//! cannot be handed the same document twice, and an unclaimed park is cleaned up if the window build fails so nothing leaks.
//!
//! @inputs Webview IPC invoke requests (`open_document_window`) carrying the document text and optional path; for `take_handoff_document`
//!   the calling window's own label, obtained from `window.label()` which the webview cannot spoof rather than passed as an argument.
//! @outputs Result<String, String> returning the new window label on success (or Err naming a lock/build failure);
//!   Result<Option<HandoffDocument>, String> returning the parked document or Ok(None) when nothing is parked for the caller.
//! @functions
//!   - HandoffDocument: Carries the text, optional on-disk path, saved-text baseline and encoding of a document handed to a second K-Doc window.
//!   - HandoffState: Mutex-guarded store of documents parked for windows that have not booted yet, keyed by window label.
//!   - open_document_window: Generates a process-unique window label, parks the document under it, then builds the window; removes the park again if build fails so nothing is leaked.
//!   - take_handoff_document: Removes and returns the parked document bound to the calling window's own label, or Ok(None) when none is parked.
//! @dataflow Webview `open_document_window` invoke -> generate label -> park HandoffDocument in state.pending -> WebviewWindowBuilder::new().build() -> Ok(label); on build failure remove-park then Err. Webview `take_handoff_document` invoke -> window.label() -> remove(label) from state.pending -> Ok(Some)/Ok(None).
//! @controlflow open_document_window: fetch-add label counter -> lock mutex -> insert parked document -> unlock -> build window -> Ok(label) on success; re-lock, remove the parked document, return Err naming the cause on failure. take_handoff_document: read caller's own label -> lock mutex -> remove entry by label -> Ok(Some(document)) if present, Ok(None) if absent (consumed once), or Err on a poisoned lock.
//! @version 2
//! @date 2026-09-14

use std::sync::atomic::{AtomicU64, Ordering};

/// A document waiting for the window that was opened to show it.
///
/// @purpose Carries the text (and optional on-disk path) of a document handed from `open_document_window` to a second K-Doc
/// window via the parked handoff, so the webview can render it immediately after the window boots.
/// @dataflow Constructed inside open_document_window -> stored under a label in HandoffState.pending -> removed and returned by take_handoff_document.
/// @controlflow Built from command inputs -> inserted into the park map -> later removed by the claiming window; never mutated once parked.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffDocument {
    /// The document text to render in the second window.
    pub text: String,
    /// Optional on-disk path of the document, forwarded unchanged when present and None otherwise.
    pub path: Option<String>,
    /// The text as of the document's last save, when it differs from `text`; None means the text is saved.
    pub saved_text: Option<String>,
    /// The encoding the file was found in, such as "utf-16le"; None means UTF-8.
    pub encoding: Option<String>,
}

/// Documents parked for windows that have not booted yet, keyed by window label.
///
/// @purpose Stores documents handed off to second K-Doc windows (FR-6.8) until those windows call take_handoff_document,
/// decoupling document creation from the moment the target window actually exists.
/// @dataflow open_document_window inserts a HandoffDocument under a generated label -> take_handoff_document removes it by the caller's own label.
/// @controlflow Every access locks the inner mutex; a poisoned lock is mapped to an error string rather than allowed to panic.
#[derive(Default)]
pub struct HandoffState {
    /// Parked documents keyed by window label (e.g. "doc-3"). Visible within the crate so tests can exercise the handoff directly against this map.
    pub(crate) pending: std::sync::Mutex<std::collections::HashMap<String, HandoffDocument>>,
}

/// A process-unique counter for generating second-window labels.
///
/// @purpose Supplies monotonically increasing, collision-free window labels so Tauri never refuses a duplicate.
/// @outputs u64 - The next label index via fetch_add; the sequence never resets, preserving uniqueness for the process lifetime.
/// @dataflow Atomic read-modify-write -> incremented counter value returned to the caller.
/// @controlflow Relaxed fetch-add returns the pre-increment value and reserves the next one atomically.
static NEXT_WINDOW_ID: std::sync::atomic::AtomicU64 = AtomicU64::new(1);

/// Opens a second K-Doc window for a specific document, parking the document before the window is built so a fast-booting window still finds it (FR-6.8).
///
/// @purpose Creates a new WebviewWindow and hands it the requested document via a parked handoff keyed by the generated label.
/// @inputs app - The Tauri application handle used to build the new window.
/// @inputs state - Tauri application state container holding the HandoffState park map.
/// @inputs text - The document text payload to show in the new window.
/// @inputs path - Optional on-disk path of the document, forwarded unchanged when present.
/// @inputs saved_text - The document's text as of its last save, when it has unsaved work; None when it is clean.
/// @inputs encoding - The encoding its file was found in; None for UTF-8 or an untitled document.
/// @outputs Result<String, String> - Returns Ok containing the new window label (e.g. "doc-3"), or Err with a descriptive message on lock/build failure.
///
/// The command is async so Tauri runs it off the main thread. A synchronous command runs on the main thread,
/// and building a webview there on Windows waits for the event loop that thread is blocking: the new window
/// stayed at about:blank and the calling window hung.
/// @dataflow text + path -> HandoffDocument -> park under generated label in state.pending -> WebviewWindowBuilder::new().build() -> Ok(label) or remove-park-and-Err.
/// @controlflow Generate unique label -> acquire lock -> insert parked document -> release lock -> build window -> Ok(label) on success; on build failure re-acquire lock, remove the parked document, return Err naming the cause.
#[tauri::command]
pub async fn open_document_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, HandoffState>,
    grants: tauri::State<'_, crate::grants::GrantState>,
    text: String,
    path: Option<String>,
    saved_text: Option<String>,
    encoding: Option<String>,
) -> Result<String, String> {
    // A document handed to a new window keeps its path only if that path is one the user chose.
    if let Some(handed) = &path {
        grants.require(handed)?;
    } else {
        // An untitled document has no path to check.
    }
    // Generate a fresh, process-unique window label.
    //
    // WHY a static atomic counter and not the webview-supplied name?
    // Tauri requires every window label to be unique for the lifetime of the process and refuses to build a duplicate,
    // so the label must be generated here rather than trusted from the webview. An AtomicU64 with relaxed ordering gives a
    // monotonic sequence that is collision-free without any locking; it never resets, which is exactly what uniqueness needs.
    let n = NEXT_WINDOW_ID.fetch_add(1, Ordering::Relaxed);
    let label = format!("doc-{n}");

    // Park the document BEFORE building the window.
    //
    // WHY before build? The new window can call take_handoff_document as soon as its own script runs, and a window that boots
    // faster than this insert would otherwise find nothing to show. Parking first guarantees the entry exists by the time the
    // window can possibly ask for it; there is no later gap because the window cannot exist before build() returns Ok.
    let document = HandoffDocument { text, path, saved_text, encoding };
    {
        // A poisoned lock is an error string here (mirroring watcher.rs), never a panic on webview input.
        let mut guard = state.pending.lock().map_err(|err| {
            format!("Failed to acquire handoff state lock: {err}")
        })?;
        guard.insert(label.clone(), document);
    }

    // Build the window now that its document is guaranteed to be parked.
    match tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
        .title("K-Doc")
        .inner_size(1200.0, 900.0)
        // Frameless like the main window: the page draws its own title bar, drag region and window buttons.
        .decorations(false)
        .build()
    {
        Ok(_) => {
            // Window built successfully: the parked document will be claimed by take_handoff_document when this window's script runs.
            Ok(label)
        }
        Err(err) => {
            // build() failed: remove the parked document again, because a document nobody will ever claim is a leak in the park map.
            let mut guard = state.pending.lock().map_err(|lock_err| {
                format!("Failed to acquire handoff state lock while cleaning up: {lock_err}")
            })?;
            guard.remove(&label);
            Err(format!("Failed to open document window '{label}': {err}"))
        }
    }
}

/// Returns and consumes the document parked for the calling window (FR-6.8).
///
/// The label is taken from the calling window itself (`window.label()`), which the webview cannot spoof, so it is deliberately
/// not a parameter — a buggy or malicious script cannot ask for another window's handoff by guessing a label.
///
/// @purpose Removes and returns the parked document bound to the caller's own window label, or Ok(None) when nothing is parked.
/// @inputs window - The Tauri window invoking the command; its own label identifies which handoff to return.
/// @inputs state - Tauri application state container holding the HandoffState park map.
/// @outputs Result<Option<HandoffDocument>, String> - Returns Ok(Some(document)) with the parked document, or Ok(None) when nothing is parked for this window (an ordinary launch, not an error), or Err on lock failure.
/// @dataflow window.label() -> remove(label) from state.pending -> Some(document) -> Ok(Some); absent label -> Ok(None).
/// @controlflow Read caller's own label -> acquire lock -> remove entry by label -> Ok(Some(document)) if present, Ok(None) if absent (consumed once), or Err on a poisoned lock.
#[tauri::command]
pub fn take_handoff_document(
    window: tauri::Window,
    state: tauri::State<'_, HandoffState>,
) -> Result<Option<HandoffDocument>, String> {
    // The calling window's own label; the webview cannot spoof it, so it is not a parameter.
    let label = window.label().to_string();

    // Remove rather than read: the handoff is consumed once. A window that reloads would otherwise be handed a second copy of a
    // document it already has, which is why remove (not get) is used — an absent entry after removal simply means nothing to show.
    let mut guard = state.pending.lock().map_err(|err| {
        format!("Failed to acquire handoff state lock: {err}")
    })?;

    match guard.remove(&label) {
        Some(document) => {
            // A document was parked for this window: return it, having removed it from the park map so it cannot be claimed twice.
            Ok(Some(document))
        }
        None => {
            // Nothing is parked for this label (ordinary launch): report Ok(None), which is not an error.
            Ok(None)
        }
    }
}

/// Sets the calling window full screen, or back, for Zen mode (FR-5.8).
///
/// @purpose Lets the webview take its own window full screen without granting it the general window permissions.
/// @inputs window - The window whose webview called; fullscreen - true to fill the screen, false to restore.
/// @outputs Result<(), String> - Ok on success, or the windowing system's error.
/// @dataflow webview invoke -> calling window -> set_fullscreen.
/// @controlflow Single call; any error is returned as a message.
#[tauri::command]
pub fn set_window_fullscreen(window: tauri::Window, fullscreen: bool) -> Result<(), String> {
    // Only the calling window is ever changed: the webview cannot name another window's label here.
    window
        .set_fullscreen(fullscreen)
        .map_err(|err| format!("Could not change full screen: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a HandoffDocument fixture from simple inputs for exercising the parked-document map directly.
    ///
    /// @purpose Constructs a minimal HandoffDocument so tests can park and inspect documents without a running Tauri app or a fake AppHandle.
    /// @inputs text - The document text payload to store.
    /// @inputs path - Optional on-disk path string to attach, or None.
    /// @outputs HandoffDocument - A document carrying the supplied text and path.
    /// @dataflow (text: &str, path: Option<&str>) -> String + Option<String> -> HandoffDocument struct literal.
    /// @controlflow Clone text into String -> map path slice to Option<String> -> assemble fields -> return.
    fn doc(text: &str, path: Option<&str>) -> HandoffDocument {
        HandoffDocument {
            text: text.to_string(),
            path: path.map(|p| p.to_string()),
            // Test fixtures carry no unsaved baseline and no non-UTF-8 encoding.
            saved_text: None,
            encoding: None,
        }
    }

    #[test]
    fn state_starts_empty() {
        // Pins: a default HandoffState holds no parked documents.
        let state = HandoffState::default();
        let guard = state.pending.lock().expect("lock should not be poisoned");
        assert!(guard.is_empty(), "a fresh state must park nothing");
    }

    #[test]
    fn handoff_is_consumed_once() {
        // Pins: inserting a document under a label and removing it returns that document,
        // and removing the same label again yields None — the handoff is consumed once.
        let state = HandoffState::default();
        let target = "doc-1".to_string();

        {
            let mut guard = state.pending.lock().expect("lock should not be poisoned");
            guard.insert(target.clone(), doc("Hello", None));
        }

        // First removal returns the parked document; verify its fields rather than the whole struct.
        {
            let mut guard = state.pending.lock().expect("lock should not be poisoned");
            match guard.remove(&target) {
                Some(document) => {
                    assert_eq!(document.text, "Hello", "removed text must match what was parked");
                    assert_eq!(document.path, None, "no path was parked for this document");
                }
                None => panic!("first removal must return the parked document"),
            }
        }

        // Second removal finds nothing: the handoff was consumed by the first.
        {
            let mut guard = state.pending.lock().expect("lock should not be poisoned");
            assert!(
                guard.remove(&target).is_none(),
                "a consumed handoff must not return twice"
            );
        }
    }

    #[test]
    fn two_labels_do_not_collide() {
        // Pins: documents parked under different labels are independent and do not overwrite each other.
        let state = HandoffState::default();

        {
            let mut guard = state.pending.lock().expect("lock should not be poisoned");
            guard.insert("doc-1".to_string(), doc("first", None));
            guard.insert("doc-2".to_string(), doc("second", Some("/tmp/second.md")));
        }

        {
            let guard = state.pending.lock().expect("lock should not be poisoned");
            match guard.get("doc-1") {
                Some(document) => {
                    assert_eq!(document.text, "first", "doc-1 must keep its own text");
                    assert_eq!(document.path, None, "doc-1 was parked with no path");
                }
                None => panic!("doc-1 must still be parked"),
            }
            match guard.get("doc-2") {
                Some(document) => {
                    assert_eq!(document.text, "second", "doc-2 must keep its own text");
                    assert_eq!(
                        document.path,
                        Some("/tmp/second.md".to_string()),
                        "doc-2 must keep its own path"
                    );
                }
                None => panic!("doc-2 must still be parked"),
            }
        }
    }

    /// Serializes with camelCase keys so the webview reads savedText rather than saved_text (FR-6.8).
    #[test]
    fn handoff_document_serializes_in_camel_case() {
        let document = HandoffDocument {
            text: "edited".to_string(),
            path: Some("C:/notes/a.md".to_string()),
            saved_text: Some("saved".to_string()),
            encoding: Some("utf-16le".to_string()),
        };
        let json = serde_json::to_value(&document).expect("a handoff document should serialize");
        assert_eq!(
            json,
            serde_json::json!({ "text": "edited", "path": "C:/notes/a.md", "savedText": "saved", "encoding": "utf-16le" })
        );
    }

    /// Absent baseline text and encoding serialize as JSON null, not omitted fields.
    #[test]
    fn absent_baseline_and_encoding_serialize_as_null() {
        let json = serde_json::to_value(&doc("clean", None)).expect("a handoff document should serialize");
        assert_eq!(
            json,
            serde_json::json!({ "text": "clean", "path": null, "savedText": null, "encoding": null })
        );
    }
}
