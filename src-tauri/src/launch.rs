//! @file launch.rs
//! @purpose Resolves the files K-Doc was asked to open — both the initial command line (a double-clicked .md) and later launches forwarded by the single-instance plugin — records access where possible, buffers them for the running frontend, and brings an existing window to the front.
//! @inputs argv and cwd of a launch; paths forwarded from a second instance via handle_second_instance; webview focus events routed through LaunchState::focused; no input for the two Tauri commands.
//! @outputs A de-duplicated Vec<PathBuf> of existing files from launch_paths; buffered paths and last-focused window in LaunchState; the LAUNCH_EVENT emission that asks the frontend to open files; Vec<String> from take_launch_paths; an explorer launch from open_default_apps_settings.
//! @functions
//!   - launch_paths: Resolves argv entries into existing, normalised file paths, skipping the executable, flags, missing files and duplicates.
//!   - LaunchState::queue / take / focused / last_focused: Thread-safe buffering of forwarded paths and tracking of the last focused window.
//!   - grant_and_queue: Records access to each forwarded path (best effort) then buffers them for the frontend.
//!   - target_window: Chooses which webview window to surface, preferring the last focused one.
//!   - handle_second_instance: Orchestrates forwarding — resolve, record/buffer, focus a window, and emit the open event when files exist.
//!   - take_launch_paths: Tauri command draining buffered paths for the frontend.
//!   - open_default_apps_settings: Tauri command opening the Windows Default apps settings page.
//! @dataflow Launch argv -> launch_paths -> grant_and_queue (record + buffer) -> LaunchState; second-instance launch -> handle_second_instance -> target_window -> focus + emit LAUNCH_EVENT -> frontend opens files; frontend take_launch_paths drains the queue.
//! @controlflow Resolve and filter paths first; record/buffer them; pick a window via last-focused then "main" then any; focus it and, only when files exist, emit the event; commands return drained paths or an explorer launch result.
//! @version 1
//! @date 2026-10-13

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindow};
use crate::grants;

// Event name emitted to the frontend once a window is focused so it opens the forwarded files.
pub const LAUNCH_EVENT: &str = "kdoc://launch-paths";
// Default apps settings URI filtered to K-Doc; must match the RegisteredApplications value name the installer writes.
pub const DEFAULT_APPS_URI: &str = "ms-settings:defaultapps?registeredAppUser=K-Doc";

/// Resolves argv entries into a de-duplicated list of existing files K-Doc was asked to open.
/// @purpose Turns raw command-line arguments into absolute, normalised file paths shared by both startup and forwarded second-instance launches so flags, empties and missing paths never reach the file system.
/// @inputs args - The full argument vector (argv[0] is the executable); cwd - The working directory used to resolve relative paths.
/// @outputs Vec<PathBuf> - Normalised, existing file paths in first-seen order; flags, empties, missing files and folders are dropped.
/// @dataflow argv -> skip exe -> per-arg filter (empty/flag) -> join against cwd or use absolute -> normalise -> is_file + dedupe -> Vec<PathBuf>.
/// @controlflow Iterate args after index 0; for each keep only non-empty, non-flag entries, resolve to absolute, normalise, then accept files that are not duplicates.
pub fn launch_paths(args: &[String], cwd: &Path) -> Vec<PathBuf> {
    // Skip argv[0] (the executable itself); everything after it is a candidate path or flag.
    let candidates = args.iter().skip(1);

    // Accumulate accepted files in first-seen order, tracking seen paths to drop duplicates.
    let mut out: Vec<PathBuf> = Vec::new();
    for arg in candidates {
        // An empty argument names nothing; skip it rather than joining an empty segment against cwd.
        if arg.is_empty() {
            continue;
        }

        // A leading '-' marks a command-line flag, not a path; ignore flags so they never reach the file system.
        if arg.starts_with('-') {
            continue;
        }

        // Treat this argument as a filesystem path for joining and normalisation.
        let candidate = Path::new(arg);

        // Absolute paths are used verbatim; relative ones resolve against the process working directory so a double-clicked file lands correctly.
        let joined = if candidate.is_absolute() {
            candidate.to_path_buf()
        } else {
            cwd.join(candidate)
        };

        // Normalise to a canonical absolute path; a relative or escaping path cannot be opened, so skip it.
        let Some(normal) = grants::normalise(&joined.to_string_lossy()) else {
            // normalise rejected this path (relative or escaping above root): skip rather than opening anything unsafe.
            continue;
        };

        // Only real files can be opened by K-Doc; directories and missing paths are rejected here, not merely filtered lexically.
        if !normal.is_file() {
            continue;
        }

        // Drop duplicates while preserving first-seen order: an equal path already accepted is skipped.
        if out.iter().any(|seen| *seen == normal) {
            continue;
        }

        // This is a new, existing file: record it in arrival order.
        out.push(normal);
    }

    // The de-duplicated list of existing files K-Doc was asked to open, in first-seen order.
    out
}

/// Per-launch bookkeeping: the queue of paths awaiting open and the last window K-Doc focused.
/// @purpose Bridges forwarded second-instance launches (which run before the webview exists) with the running app, buffering paths until the frontend drains them and remembering which window to surface.
/// @inputs Paths queued by `queue`; a window label set by `focused`.
/// @outputs Buffered paths from `take`; the last focused label from `last_focused`.
/// @functions
///   - queue: Appends newly launched paths to the pending queue.
///   - take: Drains and returns all buffered paths, leaving an empty queue.
///   - focused: Records the window label K-Doc should next surface.
///   - last_focused: Returns the most recently recorded window label, if any.
/// @dataflow Second-instance launch -> queue() buffers into pending -> frontend take_launch_paths() drains via take(); focus events -> focused() records into last_focused.
/// @controlflow All access is guarded by two independent mutexes; queue extends, take replaces with empty, focused overwrites, last_focused clones the current value.
#[derive(Default)]
pub struct LaunchState {
    // Paths forwarded by a second-instance launch before the webview can drain them, in arrival order.
    pending: Mutex<Vec<PathBuf>>,
    // The label of the window K-Doc most recently focused, so a later launch surfaces the same one.
    last_focused: Mutex<Option<String>>,
}

impl LaunchState {
    /// Appends `paths` to the end of the pending queue.
    /// @purpose Buffers forwarded launch paths until the running frontend drains them via `take_launch_paths`.
    /// @inputs paths - The absolute file paths a second-instance launch asked K-Doc to open.
    /// @outputs () - Mutates the in-memory queue; no value returned.
    /// @dataflow Incoming paths -> lock -> extend pending vec -> drop lock.
    /// @controlflow Lock the pending mutex (recovering from poison), append, then release before returning.
    pub fn queue(&self, paths: Vec<PathBuf>) {
        // Recover from a poisoned lock so one failing writer never blocks every future launch from being buffered.
        let mut guard = self.pending.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        // Append the forwarded paths in arrival order behind anything already queued.
        guard.extend(paths);
    }

    /// Drains the pending queue, returning every buffered path and leaving it empty.
    /// @purpose Lets the frontend consume all forwarded launch paths in one shot; a second call returns nothing until new paths arrive.
    /// @inputs None (reads `self`).
    /// @outputs Vec<PathBuf> - The buffered paths in arrival order, or an empty vec when the queue was already drained.
    /// @dataflow Mutex<Vec<PathBuf>> -> std::mem::take replaces with default empty -> returned vec.
    /// @controlflow Lock (recovering from poison), mem::take swaps out the contents for a fresh empty vec, release lock, return taken contents.
    pub fn take(&self) -> Vec<PathBuf> {
        let mut guard = self.pending.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        // std::mem::take replaces the queue with its Default (empty) and returns the drained paths in one operation.
        std::mem::take(&mut *guard)
    }

    /// Records `label` as the window K-Doc should next surface for a forwarded launch.
    /// @purpose Remembers which webview window was last focused so subsequent launches bring the same one to the front.
    /// @inputs label - The webview window label (e.g. "main") that received focus.
    /// @outputs () - Overwrites the stored label; no value returned.
    /// @dataflow Incoming label -> lock -> store Some(label) -> drop lock.
    /// @controlflow Lock the last_focused mutex (recovering from poison), replace the Option with Some, then release.
    pub fn focused(&self, label: &str) {
        let mut guard = self.last_focused.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        // Overwrite any previous focus target with this window's label.
        *guard = Some(label.to_string());
    }

    /// Returns the most recently recorded window label, if any.
    /// @purpose Lets a forwarded launch target the same window K-Doc last focused instead of guessing which one to surface.
    /// @inputs None (reads `self`).
    /// @outputs Option<String> - The stored label, or None when no window has been focused yet.
    /// @dataflow Mutex<Option<String>> -> lock -> clone the inner Option -> drop lock.
    /// @controlflow Lock (recovering from poison), clone the current value so the guard can be released before returning, then return it.
    pub fn last_focused(&self) -> Option<String> {
        let guard = self.last_focused.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        // Clone out of the lock so we do not hold it across the return to the caller.
        guard.clone()
    }
}

/// Records access to each forwarded path (best effort) and buffers the paths for the frontend.
/// @purpose Ensures a file K-Doc was asked to open is remembered by the grant allow-list when possible, then hands every path to LaunchState so the running window can open it.
/// @inputs app - The Tauri application handle carrying shared state; paths - The absolute files a launch asked K-Doc to open.
/// @outputs () - Mutates GrantState (if present) and LaunchState; no value returned.
/// @dataflow paths -> per-path grant_file (record access, ignore failures) -> LaunchState::queue buffers them for the frontend.
/// @controlflow Try to read GrantState; when present iterate paths recording each access (logging but not aborting on failure), then always queue the paths.
pub fn grant_and_queue<R: Runtime>(app: &AppHandle<R>, paths: Vec<PathBuf>) {
    // GrantState is only registered after setup; when present, record access to each forwarded file so later webview opens are authorised.
    if let Some(grant_state) = app.try_state::<grants::GrantState>() {
        for path in &paths {
            match grant_state.grant_file(path) {
                // Access recorded: the file is now on the allow-list for future webview access.
                Ok(()) => {}
                // Not recorded (e.g. a network path, which the store refuses): opening it will ask or refuse with a clear message.
                Err(e) => eprintln!("Could not record access to a file K-Doc was asked to open: {e}"),
            }
        }
    } else {
        // No grant store yet (cannot happen after setup): the frontend's open asks for access instead.
    }

    // Regardless of whether grants were recorded, buffer every path so the running window can open it once drained.
    app.state::<LaunchState>().queue(paths);
}

/// Chooses the webview window to surface for a forwarded launch.
/// @purpose Prefers the last focused window, falls back to the canonical "main" window, and finally any available window so a forwarded launch always has somewhere to open files.
/// @inputs app - The Tauri application handle; last - The label of the window K-Doc last focused, if known.
/// @outputs Option<WebviewWindow<R>> - The chosen window, or None when no window exists at all.
/// @dataflow last label -> get_webview_window(label) -> "main" -> first available window.
/// @controlflow Try the remembered label; on miss try "main"; finally return the first window in iteration order (or None).
pub fn target_window<R: Runtime>(app: &AppHandle<R>, last: Option<String>) -> Option<WebviewWindow<R>> {
    // Prefer the window K-Doc most recently focused so a forwarded launch returns to where the user was.
    if let Some(label) = last {
        // A remembered label that still resolves is used directly; an unknown or closed label falls through to the next candidate.
        if let Some(w) = app.get_webview_window(&label) {
            return Some(w);
        }
    }

    // The canonical primary window is the natural fallback when no focused window is remembered or it has since closed.
    if let Some(w) = app.get_webview_window("main") {
        return Some(w);
    }

    // As a last resort, surface whatever window exists first (or None if the app truly has none open).
    app.webview_windows().into_values().next()
}

/// Handles a second launch of K-Doc: resolves its paths, records access, and brings the running window to the front.
/// @purpose Implements single-instance forwarding — when the user launches K-Doc again (e.g. double-clicking another file), this surfaces the existing window and asks it to open any requested files.
/// @inputs app - The Tauri application handle; argv - The full argument vector of the second launch; cwd - Its working directory for resolving relative paths.
/// @outputs () - Brings a window forward and emits the launch event when applicable; no value returned.
/// @dataflow argv -> launch_paths -> grant_and_queue (record + buffer) -> last_focused -> target_window -> unminimize/show/focus (+ emit LAUNCH_EVENT when files exist).
/// @controlflow Resolve paths; if any, record/buffer them; pick a window and focus it; only emit the open event when there were files to open.
pub fn handle_second_instance<R: Runtime>(app: &AppHandle<R>, argv: Vec<String>, cwd: String) {
    // Resolve the second launch's arguments into existing files relative to its working directory.
    let paths = launch_paths(&argv, Path::new(&cwd));

    // Whether any real files were requested; a file-less launch still focuses the window but emits no open event.
    let has_paths = !paths.is_empty();

    // Record access where possible and buffer every resolved path for the running frontend to drain.
    grant_and_queue(app, paths);

    // Use the last focused window (if any) so a forwarded launch returns to the same one the user was on.
    let last = app.state::<LaunchState>().last_focused();

    match target_window(app, last) {
        // A window exists: bring it forward and, when files were requested, ask it to open them.
        Some(window) => {
            // Restore from minimise so the window is visible before showing and focusing it.
            if let Err(e) = window.unminimize() {
                eprintln!("Could not bring K-Doc to the front: {e}");
            }

            // Ensure the window is actually visible on screen after restoring from minimise.
            if let Err(e) = window.show() {
                eprintln!("Could not bring K-Doc to the front: {e}");
            }

            // Take keyboard focus so it sits above other open windows.
            if let Err(e) = window.set_focus() {
                eprintln!("Could not bring K-Doc to the front: {e}");
            }

            // Only ask the window to open files when there were any; a file-less launch has nothing to emit.
            if has_paths {
                // Notify the frontend of the buffered paths so it can open them; failure is logged but does not block focus.
                if let Err(e) = app.emit_to(window.label(), LAUNCH_EVENT, ()) {
                    eprintln!("Could not ask K-Doc to open the files: {e}");
                }
            }
        }
        // No window exists at all (app fully closed): there is nothing to surface the files in.
        None => {
            eprintln!("K-Doc has no open window to show the files in.");
        }
    }
}

/// Returns every buffered launch path forwarded by a second-instance launch, then empties the queue.
/// @purpose The frontend command that drains paths queued before the webview existed (startup or forwarded launches) so they can be opened.
/// @inputs state - The LaunchState shared with the running app.
/// @outputs Vec<String> - Buffered file paths as strings in arrival order, or an empty vec when nothing is pending.
/// @dataflow Mutex<Vec<PathBuf>> -> take() drains -> each path to_string_lossy().into_owned() -> Vec<String>.
/// @controlflow LaunchState::take drains the queue under its lock; map remaining paths to owned strings and collect.
#[tauri::command]
pub fn take_launch_paths(state: State<'_, LaunchState>) -> Vec<String> {
    // Drain all buffered paths at once, leaving an empty queue for any future forwarded launches.
    state.take().into_iter().map(|p| p.to_string_lossy().into_owned()).collect()
}

/// Opens the Windows "Default apps" settings page that lets the user pick K-Doc as the .md handler.
/// @purpose Gives the user a one-click path to associate Markdown files with K-Doc from within the app; platform-gated to Windows where this settings URI exists.
/// @inputs None (reads no shared state).
/// @outputs Result<(), String> - Ok when explorer launched successfully, or an error string on failure / non-Windows platforms.
/// @dataflow No input -> spawn explorer.exe with the default-apps URI -> Ok(()) or formatted error.
/// @controlflow On Windows launch explorer with DEFAULT_APPS_URI and map any spawn error to a string; elsewhere return a not-available error.
#[tauri::command]
pub fn open_default_apps_settings() -> Result<(), String> {
    // This settings URI only exists on Windows, so the launcher runs there and returns its result directly.
    #[cfg(windows)]
    {
        // Launch explorer.exe pointed at the Default apps page filtered to K-Doc's registered-app name; a spawn failure becomes an error string.
        std::process::Command::new("explorer.exe")
            .arg(DEFAULT_APPS_URI)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Could not open Windows Default apps settings: {e}"))
    }

    // On non-Windows platforms the registered-apps URI does not exist, so report that choosing the default app is unavailable there.
    #[cfg(not(windows))]
    Err("Choosing the default app is only available on Windows.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Creates a unique scratch directory under the system temp dir for a test, clearing any leftover from a previous run.
    /// @purpose Gives each test an isolated workspace so file-resolution assertions do not collide across runs or tests.
    /// @inputs name - A short test identifier used to namespace the temporary directory.
    /// @outputs PathBuf - The path to the freshly created scratch directory.
    /// @dataflow temp_dir -> kdoc-launch-<name>-<pid> -> remove leftover -> create_dir_all -> returned dir.
    /// @controlflow Remove any pre-existing directory (ignore failure), then create a clean one; panics only on genuine creation failure via unwrap in tests.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kdoc-launch-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Builds an argv vector with a fake executable as index 0 so `launch_paths` skips it exactly as it would skip the real binary.
    /// @purpose Mirrors the on-disk argv shape (executable first) that launch_paths expects to skip.
    /// @inputs list - The candidate path/flag strings that follow the executable.
    /// @outputs Vec<String> - ["k-doc.exe", ...list].
    /// @dataflow "k-doc.exe" -> prepended to each input -> Vec<String>.
    /// @controlflow Collect the executable then every input in order into a single vector.
    fn args(list: &[&str]) -> Vec<String> {
        let mut v = Vec::new();
        v.push("k-doc.exe".to_string());
        for s in list {
            v.push(s.to_string());
        }
        v
    }

    #[test]
    fn skips_the_executable_and_flags() {
        // A real file exists in the scratch dir; launch_paths must accept it and drop the executable plus a flag.
        let dir = scratch("skip_exe_flags");
        let md = dir.join("a.md");
        fs::write(&md, b"# hi").unwrap();

        // argv carries the executable and a "--flag" between them; only the absolute path to a.md should survive.
        let got = launch_paths(
            &args(&["--flag", md.to_string_lossy().as_ref()]),
            &dir,
        );
        let want = grants::normalise(&md.to_string_lossy()).unwrap();

        // The result must be exactly the normalised file, nothing else.
        assert_eq!(got, vec![want]);
    }

    #[test]
    fn resolves_relative_paths_against_the_working_directory() {
        // With cwd set to the scratch dir, a bare filename should resolve inside it.
        let dir = scratch("resolve_rel");
        let md = dir.join("a.md");
        fs::write(&md, b"# hi").unwrap();

        // Only "a.md" (relative) is passed after the executable; cwd supplies the directory.
        let got = launch_paths(&args(&["a.md"]), &dir);
        let want = grants::normalise(&md.to_string_lossy()).unwrap();

        // The relative path must resolve against cwd to the same normalised file.
        assert_eq!(got, vec![want]);
    }

    #[test]
    fn ignores_missing_files_and_folders() {
        // A missing file and an existing directory must both be rejected by the is_file gate.
        let dir = scratch("ignore_missing");
        let missing = dir.join("missing.md");
        assert!(!missing.exists());

        // Pass a non-existent path and the directory itself; neither should survive resolution.
        let got = launch_paths(
            &args(&[
                missing.to_string_lossy().as_ref(),
                dir.to_string_lossy().as_ref(),
            ]),
            &dir,
        );

        // No existing files were requested, so the result is empty.
        assert!(got.is_empty());
    }

    #[test]
    fn drops_duplicates_keeping_order() {
        // Two distinct files where one repeats; only first-seen order of unique files should remain.
        let dir = scratch("dedupe");
        let a = dir.join("a.md");
        let b = dir.join("b.md");
        fs::write(&a, b"# a").unwrap();
        fs::write(&b, b"# b").unwrap();

        // argv lists a, b, then a again; the duplicate a must be dropped keeping first-seen order.
        let got = launch_paths(
            &args(&[
                a.to_string_lossy().as_ref(),
                b.to_string_lossy().as_ref(),
                a.to_string_lossy().as_ref(),
            ]),
            &dir,
        );

        // Expect exactly [a, b] in that order with no duplicate.
        let want = vec![
            grants::normalise(&a.to_string_lossy()).unwrap(),
            grants::normalise(&b.to_string_lossy()).unwrap(),
        ];
        assert_eq!(got, want);
    }

    #[test]
    fn collapses_parent_segments() {
        // A ".." segment in the path must be resolved by normalise before the is_file check.
        let dir = scratch("collapse_parent");
        fs::create_dir_all(dir.join("sub")).unwrap();
        let md = dir.join("a.md");
        fs::write(&md, b"# hi").unwrap();

        // Pass "sub/../a.md" relative to cwd; normalise must collapse it to dir/a.md.
        let got = launch_paths(&args(&["sub/../a.md"]), &dir);
        let want = grants::normalise(&md.to_string_lossy()).unwrap();

        // The collapsed parent segment resolves to the same normalised file.
        assert_eq!(got, vec![want]);
    }

    #[test]
    fn state_take_drains_the_queue() {
        // queue then take must return exactly what was queued and leave the queue empty on a second drain.
        let s = LaunchState::default();

        // Queue a single path; the first take should surface it.
        s.queue(vec![PathBuf::from("x")]);
        assert_eq!(s.take(), vec![PathBuf::from("x")]);

        // A second take must find nothing left in the drained queue.
        assert!(s.take().is_empty());
    }

    #[test]
    fn state_remembers_the_last_focused_window() {
        // focused overwrites last_focused; the most recent call wins.
        let s = LaunchState::default();

        // No window has been focused yet, so this is None.
        assert!(s.last_focused().is_none());

        // Focus two windows in turn; only the latest must be remembered.
        s.focused("doc-1");
        s.focused("main");

        // The last focused label ("main") should now be returned.
        assert_eq!(s.last_focused(), Some("main".to_string()));
    }

    #[test]
    fn default_apps_uri_names_the_registered_application() {
        // The settings URI must carry the exact registered-app name the installer writes.
        // It ends with the query parameter identifying K-Doc as the target application.
        assert!(DEFAULT_APPS_URI.ends_with("registeredAppUser=K-Doc"));
    }
}
