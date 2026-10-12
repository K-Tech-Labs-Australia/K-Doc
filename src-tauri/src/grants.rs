//! @file grants.rs
//! @purpose Records the files and folders a user has explicitly given K-Doc access to, and answers whether an arbitrary webview-requested path falls inside that allow-list. Webview file commands consult it so script running in the webview cannot reach anything else.
//! @inputs Absolute filesystem paths requested by code running in the webview; an optional on-disk store location (a `PathBuf`) used to persist grants across launches, or `None` for a transient in-memory list.
//! @outputs A normalised absolute path from `normalise`; canonical string keys via `key`; boolean containment verdicts (`is_within`, `allows`, `allows_folder`); resolved paths or access-denied errors from `require`/`require_folder`.
//! @functions
//!   - normalise: Resolves an absolute path, collapsing "." and "..", rejecting anything that escapes the root.
//!   - key: Produces a canonical OS-specific string for a granted/resolved path so equal paths compare equal.
//!   - is_within: Tests whether one path key lies inside another folder key (child containment).
//!   - GrantState::new: Loads an existing grant list from disk, or starts empty on any failure.
//!   - GrantState::snapshot: Returns a defensive clone of the current allow-list.
//!   - GrantState::grant_file / grant_folder: Adds a path to the allow-list and persists it.
//!   - GrantState::allows / allows_folder: Tests whether a single file or its containing folder is permitted.
//!   - GrantState::require / require_folder: Returns the resolved path, or an ACCESS_DENIED error when not granted.
//!   - persist: Atomically rewrites the grant store via a temp file and rename.
//! @dataflow Webview request (str) -> normalise -> key -> compare against stored files/folders -> allows/allows_folder verdict; on mutation grant_* updates in-memory list then persists to disk atomically.
//! @controlflow new() reads+parses the store once -> commands call allows()/allows_folder() and branch on the boolean -> mutations lock, trim to cap, clone, drop lock, then persist(); require/require_folder return Ok(path) or Err(ACCESS_DENIED: ...).
//! @version 1
//! @date 2026-10-07

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

// Most recent file grants kept before older ones drop off (bounded allow-list).
pub const MAX_FILE_GRANTS: usize = 2000;   // doc: most recent kept; older ones drop off
// Most recent folder grants kept before older ones drop off.
pub const MAX_FOLDER_GRANTS: usize = 200;
// File name of the on-disk grant store, written next to any configured store directory.
pub const GRANTS_FILE_NAME: &str = "grants.json";
/// Prefix of the error a command returns for a path the user never granted; the webview recognises it and may ask the user.
pub const ACCESS_DENIED_PREFIX: &str = "ACCESS_DENIED: ";

// The allow-list itself: ordered vectors so insertion order (recency) is preserved for trimming.
#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
pub struct GrantList { pub files: Vec<String>, pub folders: Vec<String> }

/// Resolves an absolute path into a canonical `PathBuf`, collapsing "." and ".." segments.
/// @purpose Normalises user-supplied paths so they can be compared against stored grants; rejects anything that is not absolute or escapes the filesystem root.
/// @inputs path - The raw requested path as a string slice.
/// @outputs Option<PathBuf> - Some(resolved) on success, None if the path is relative or would escape above the root.
/// @dataflow Raw str -> Path::components() -> per-component push/pop with "." skipped and ".." walking up -> accumulated PathBuf.
/// @controlflow Reject non-absolute paths first; then fold each component — prefix/root pushed verbatim, CurDir ignored, ParentDir pops (rejecting if it would escape the anchor), Normal appended.
pub fn normalise(path: &str) -> Option<PathBuf> {
    // Reject any path that is not absolute; only absolute paths can be safely matched against grants.
    let p = Path::new(path);
    if !p.is_absolute() {
        // Not an absolute path: cannot establish a stable key, so reject.
        return None;
    }

    // Build the normalised path component by component, resolving "." and "..".
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            // Prefix (Windows drive letter) or RootDir ("/"): push verbatim to anchor the absolute path.
            Component::Prefix(_) | Component::RootDir => out.push(c.as_os_str()),
            // Current directory marker ("."): has no effect on the resolved path, skip it.
            Component::CurDir => {}
            // Parent directory marker (".."): walk up one level unless already at the root anchor.
            Component::ParentDir => {
                // Never pop past the prefix/root: if there is nothing left to pop we have escaped upward and must reject.
                if out.parent().is_none() {
                    return None;
                }
                if !out.pop() {
                    // Could not walk up (already at root): treat as an escaping path and reject.
                    return None;
                }
            }
            // A normal path segment: append it to the accumulated result.
            Component::Normal(s) => out.push(s),
        }
    }

    // The fully resolved absolute path is returned on success.
    Some(out)
}

/// Produces a canonical string key for `path` so that equal paths compare equal regardless of how their separators or case were written.
/// @purpose Normalises a path to the single textual form used as both grant keys and lookup keys, applying OS-specific separator/case rules.
/// @inputs path - The filesystem path whose canonical key is required.
/// @outputs String - A normalised key; backslashes on Windows (lower-cased), forward slashes elsewhere, with trailing separators stripped except drive roots.
/// @dataflow Path -> to_string_lossy() -> separator conversion + case folding (Windows) -> trailing-separator trimming -> final String.
/// @controlflow Materialise the string, apply cfg-gated normalisation on Windows, then loop-trim trailing separators while preserving a drive root or empty result.
pub fn key(path: &Path) -> String {
    // Build the textual key from the path; on Windows convert every forward slash to a backslash so both separator forms collapse together.
    #[cfg(windows)]
    let mut s = path.to_string_lossy().replace('/', "\\");

    // On non-Windows platforms no separator conversion is required, but into_owned still materialises an owned String from the borrowed Cow.
    #[cfg(not(windows))]
    let mut s = path.to_string_lossy().into_owned();

    // Windows paths are case-insensitive (drive letters and names), so fold every key to lower case there for consistent matching.
    #[cfg(windows)]
    {
        s = s.to_lowercase();
    }

    // Strip trailing separators ("docs/" -> "docs") but never reduce a drive root ("c:\\", which would become "c:") or an empty string to nothing.
    while s.len() > 1 {
        let Some(&last) = s.as_bytes().last() else { break }; // len >= 2 guarantees at least one byte exists here.
        #[cfg(windows)]
        let is_sep = last == b'\\';
        #[cfg(not(windows))]
        let is_sep = last == b'/';

        // Not a trailing separator: the key is already in its trimmed form, stop trimming.
        if !is_sep { break; }

        // Removing this separator would leave a drive root ("c:") or an empty string, so keep the current (shorter) form as-is.
        let trimmed_len = s.len() - 1;
        let trimmed = &s[..trimmed_len];
        if trimmed.is_empty() || trimmed.ends_with(':') { break; }

        // Safe to drop one trailing separator byte and continue trimming any further ones.
        s.truncate(trimmed_len);
    }

    // The canonical key is returned for use as a grant or lookup key.
    s
}

/// Whether a path names a network location (`\\server\share`, a verbatim UNC path, a device path)
/// rather than a local file.
///
/// @purpose Lets the host refuse paths whose mere opening makes Windows authenticate to another machine.
/// @inputs path - Any path.
/// @outputs bool - True for UNC, verbatim-UNC and device paths, and for anything spelled with a leading double slash.
/// @dataflow path -> first component's prefix kind, or its leading characters -> bool.
/// @controlflow A Windows prefix decides directly; otherwise the spelling is checked, so the rule holds on every platform.
pub fn is_network_path(path: &Path) -> bool {
    use std::path::Prefix;
    match path.components().next() {
        // A Windows prefix says exactly what kind of path this is.
        Some(Component::Prefix(prefix)) => matches!(prefix.kind(), Prefix::UNC(..) | Prefix::VerbatimUNC(..) | Prefix::DeviceNS(..)),
        // No prefix (another platform, or a relative path): judge by the spelling.
        _ => {
            let text = path.to_string_lossy();
            text.starts_with("\\\\") || text.starts_with("//")
        }
    }
}

/// Tests whether `path_key` lies inside the folder identified by `folder_key`.
/// @purpose Implements child-containment semantics: an exact match, or a path that begins with the folder key followed immediately by one directory separator.
/// @inputs path_key - The canonical key of the candidate path; folder_key - The canonical key of the granted folder.
/// @outputs bool - true when `path_key` equals or is contained within `folder_key`, false otherwise (lookalike siblings like "docs2" do not match "docs").
/// @dataflow Two keys -> equality check -> strip_prefix(folder_key) -> inspect first remainder byte for a separator -> boolean verdict.
/// @controlflow Exact-match short-circuit; then attempt prefix removal and require a leading separator to confirm containment, else fall through to false.
pub fn is_within(path_key: &str, folder_key: &str) -> bool {
    // An exact match means the path key equals the granted folder exactly (e.g. granting "docs" allows opening "docs").
    if path_key == folder_key {
        return true;
    }

    // The directory separator byte differs by platform; keys already use backslashes on Windows after normalisation, so only compare against that there.
    #[cfg(windows)]
    let sep = b'\\';
    #[cfg(not(windows))]
    let sep = b'/';

    // A path lies inside a folder when it starts with the folder key followed by exactly one separator byte; "docs" matches "docs/x" but not "docs2".
    // A folder key that already ends in the separator (a drive root) contains everything under it.
    if folder_key.as_bytes().last() == Some(&sep) && path_key.starts_with(folder_key) {
        return true;
    }
    if let Some(prefix) = path_key.strip_prefix(folder_key) {
        // The remainder after the folder prefix must begin with a directory separator to count as being inside.
        match prefix.as_bytes().first() {
            // A leading separator confirms containment (e.g. "docs" -> "/x").
            Some(&b) if b == sep => return true,
            // No separator immediately after the folder key means it is a lookalike sibling ("docs2"), not a child; fall through to false.
            _ => {}
        }
    }

    // Not contained within the granted folder (neither exact nor a direct/indirect child).
    false
}

/// In-memory, thread-safe grant allow-list optionally backed by an on-disk JSON store.
pub struct GrantState { inner: Mutex<GrantList>, store: Option<PathBuf> }

impl GrantState {
    /// Constructs a `GrantState`, loading any existing grants from `store`.
    /// @purpose Recovers previously persisted grants so the user does not have to re-grant on every launch; never fails hard.
    /// @inputs store - Optional path to the JSON grant file, or None for a transient in-memory-only list.
    /// @outputs GrantState - A state whose allow-list is either the loaded contents or empty.
    /// @dataflow Option<PathBuf> -> read_to_string + from_str (Some) / default (None) -> Mutex<GrantList>.
    /// @controlflow If a store path exists, attempt to parse it; any failure leaves an empty list rather than panicking.
    pub fn new(store: Option<PathBuf>) -> Self {
        // A None store means no persistence is configured: start from the default (empty) allow-list.
        let mut list = GrantList::default();

        // Only attempt a load when a store path was actually provided; otherwise keep the empty defaults.
        if let Some(path) = &store {
            match fs::read_to_string(path).and_then(|contents| serde_json::from_str(&contents).map_err(std::io::Error::other)) {
                // Parsed successfully: adopt the stored allow-list as-is.
                Ok(found) => list = found,
                // Missing file or malformed JSON: deliberately start empty — a lost grant list only means the user re-opens files, never wider access.
                Err(_) => {}
            }
        }

        // Wrap the (possibly loaded) allow-list in a mutex and remember where to persist future mutations.
        Self { inner: Mutex::new(list), store }
    }

    /// Returns a defensive clone of the current allow-list, recovering from a poisoned mutex rather than propagating it.
    /// @purpose Lets callers read the full list without holding the lock across I/O or formatting.
    /// @inputs None (reads `self`).
    /// @outputs GrantList - A snapshot copy of the files and folders currently granted.
    /// @dataflow Mutex<GrantList> -> try_lock().into_inner() -> cloned GrantList.
    /// @controlflow Lock; on poison or panic use into_inner to salvage the data instead of returning an error.
    #[cfg(test)]
    pub fn snapshot(&self) -> GrantList {
        // Take a lock so concurrent mutations cannot be observed mid-write by this reader.
        let guard = self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        // Clone out of the locked data and release the lock immediately to avoid holding it during formatting/persistence elsewhere.
        guard.clone()
    }

    /// Adds a file path to the allow-list, trimming to `MAX_FILE_GRANTS` (most recent kept last) and persisting.
    /// @purpose Records that the user granted access to one specific document; duplicates are collapsed so recency ordering stays meaningful.
    /// @inputs path - The absolute resolved file path to grant.
    /// @outputs Result<(), String> - Ok on success, or a formatted error string if persistence fails.
    /// @dataflow Path -> key() -> dedupe existing entry -> push new key -> trim oldest beyond cap -> clone -> persist(copy).
    /// @controlflow Lock; remove any equal existing file key (if present); append the new key; while over cap, drop index 0; unlock before writing to disk.
    pub fn grant_file(&self, path: &Path) -> Result<(), String> {
        // Compute the canonical key once so we can both dedupe and store a single consistent value.
        let k = key(path);

        // Lock for the in-memory mutation only; persistence happens after release to avoid holding it during disk I/O.
        let mut guard = self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

        // If this exact file was already granted, remove its old entry so re-granting moves it to the most-recent position without duplicating.
        if let Some(pos) = guard.files.iter().position(|f| f == &k) {
            guard.files.remove(pos);
        }

        // Append the freshly computed key as the newest grant (kept last for recency trimming).
        guard.files.push(k.clone());

        // Enforce the cap by dropping oldest entries from the front while still over MAX_FILE_GRANTS.
        while guard.files.len() > MAX_FILE_GRANTS {
            guard.files.remove(0);
        }

        // Snapshot the trimmed list and release the lock before touching disk so writers are never blocked during persistence.
        let copy = guard.clone();
        drop(guard);

        // Persist the updated allow-list atomically; surface any I/O error to the caller.
        self.persist(&copy)
    }

    /// Adds a folder path to the allow-list, trimming to `MAX_FOLDER_GRANTS` (most recent kept last) and persisting.
    /// @purpose Records that the user granted access to an entire directory tree; duplicates are collapsed so recency ordering stays meaningful.
    /// @inputs path - The absolute resolved folder path to grant.
    /// @outputs Result<(), String> - Ok on success, or a formatted error string if persistence fails.
    /// @dataflow Path -> key() -> dedupe existing entry -> push new key -> trim oldest beyond cap -> clone -> persist(copy).
    /// @controlflow Lock; remove any equal existing folder key (if present); append the new key; while over cap, drop index 0; unlock before writing to disk.
    pub fn grant_folder(&self, path: &Path) -> Result<(), String> {
        // Compute the canonical key once so we can both dedupe and store a single consistent value.
        let k = key(path);

        // Lock for the in-memory mutation only; persistence happens after release to avoid holding it during disk I/O.
        let mut guard = self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

        // If this exact folder was already granted, remove its old entry so re-granting moves it to the most-recent position without duplicating.
        if let Some(pos) = guard.folders.iter().position(|f| f == &k) {
            guard.folders.remove(pos);
        }

        // Append the freshly computed key as the newest folder grant (kept last for recency trimming).
        guard.folders.push(k.clone());

        // Enforce the cap by dropping oldest entries from the front while still over MAX_FOLDER_GRANTS.
        while guard.folders.len() > MAX_FOLDER_GRANTS {
            guard.folders.remove(0);
        }

        // Snapshot the trimmed list and release the lock before touching disk so writers are never blocked during persistence.
        let copy = guard.clone();
        drop(guard);

        // Persist the updated allow-list atomically; surface any I/O error to the caller.
        self.persist(&copy)
    }

    /// Tests whether a single file path is permitted, either by an exact file grant or by falling inside a granted folder.
    /// @purpose Authorises opening/reading one specific document against the allow-list.
    /// @inputs path - The absolute requested file path as a string slice.
    /// @outputs bool - true when `path` matches a granted file exactly, or lies within any granted folder; false otherwise (including relative paths).
    /// @dataflow str -> normalise() -> key() -> compare against stored files (==) and folders (is_within).
    /// @controlflow Reject un-normalisable paths first; then check exact file match OR containment in any granted folder.
    pub fn allows(&self, path: &str) -> bool {
        // Resolve the requested path; a relative or escaping path can never be allowed.
        let Some(p) = normalise(path) else { return false; };

        // Lock only for the duration of the comparisons against stored keys.
        let guard = self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

        // Exact file grant: an entry equal to this path's key authorises it directly.
        if guard.files.iter().any(|f| f == &key(&p)) { return true; }

        // Containment grant: the path lies inside a granted folder, so any document under that tree is permitted.
        if guard.folders.iter().any(|d| is_within(&key(&p), d)) { return true; }

        // Neither an exact file grant nor contained in a granted folder: not allowed.
        false
    }

    /// Tests whether the containing folder of `folder` is permitted, either by a direct folder grant or because it holds a granted file (e.g. attachments).
    /// @purpose Authorises directory-level access such as reading/writing an attachment next to a granted document.
    /// @inputs folder - The absolute requested folder path as a string slice.
    /// @outputs bool - true when `folder` is inside a granted folder, or equals the parent of any granted file; false otherwise (including relative paths).
    /// @dataflow str -> normalise() -> key() -> containment in stored folders OR parent-equality against stored files.
    /// @controlflow Reject un-normalisable paths first; then check direct/indirect folder grant, else derive the parent and compare it to each granted file's directory.
    pub fn allows_folder(&self, folder: &str) -> bool {
        // Resolve the requested folder path; a relative or escaping path can never be allowed.
        let Some(p) = normalise(folder) else { return false; };

        // Lock only for the duration of the comparisons against stored keys.
        let guard = self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

        // Direct or indirect folder grant: the requested folder lies inside a granted folder tree.
        if guard.folders.iter().any(|d| is_within(&key(&p), d)) { return true; }

        // The folder that holds a granted file, and folders inside it (its attachments folder), are allowed as well.
        let k = key(&p);
        guard.files.iter().any(|f| Path::new(f).parent().map(|par| is_within(&k, &key(par))).unwrap_or(false))
    }

    /// Whether `folder` is, or lies inside, a folder the user picked as a vault.
    ///
    /// @purpose Gate vault-wide operations, which reach every note under a folder.
    /// @inputs folder - The requested vault root.
    /// @outputs bool - True only inside a folder grant; the folder holding a single granted file does not count.
    /// @dataflow folder -> normalise -> key -> folder grants containment.
    /// @controlflow A relative or escaping path is refused before any comparison.
    pub fn allows_vault(&self, folder: &str) -> bool {
        // A path that cannot be normalised can never be a vault the user chose.
        let Some(p) = normalise(folder) else { return false; };
        let k = key(&p);
        let guard = self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.folders.iter().any(|d| is_within(&k, d))
    }

    /// Returns the normalised vault root when `allows_vault` holds, else the ACCESS_DENIED error.
    ///
    /// @purpose The checked form of allows_vault for commands.
    /// @inputs folder - The requested vault root.
    /// @outputs Result<PathBuf, String>.
    /// @dataflow folder -> allows_vault -> normalised path or error.
    /// @controlflow Refuse early when not a picked folder.
    pub fn require_vault(&self, folder: &str) -> Result<PathBuf, String> {
        // Only a folder the user picked (or one inside it) is a vault.
        if self.allows_vault(folder) {
            normalise(folder).ok_or_else(|| format!("{ACCESS_DENIED_PREFIX}{folder}"))
        } else {
            Err(format!("{ACCESS_DENIED_PREFIX}{folder}"))
        }
    }

    /// Returns the resolved path if permitted, or an ACCESS_DENIED error otherwise.
    /// @purpose The command-facing gate: hands webview file commands a concrete `PathBuf` to operate on, or a recognisable denial string.
    /// @inputs path - The absolute requested file path as a string slice.
    /// @outputs Result<PathBuf, String> - Ok(resolved) when allowed; Err("ACCESS_DENIED: <path>") when not granted.
    /// @dataflow str -> allows() -> (true) normalise().ok_or(ACCESS_DENIED) / (false) Err(ACCESS_DENIED).
    /// @controlflow Delegate to allows(); on success return the normalised path or a denial error carrying the original request, never leaking extra detail.
    pub fn require(&self, path: &str) -> Result<PathBuf, String> {
        // If the file is permitted, resolve and hand back its canonical absolute form; otherwise fall through to the shared denial error.
        if self.allows(path) {
            normalise(path).ok_or_else(|| format!("{ACCESS_DENIED_PREFIX}{path}"))
        } else {
            // Not granted: return the standard access-denied error carrying the original request for the webview to surface.
            Err(format!("{ACCESS_DENIED_PREFIX}{path}"))
        }
    }

    /// Returns the resolved folder if permitted, or an ACCESS_DENIED error otherwise.
    /// @purpose The command-facing gate for directory-level operations: returns a concrete `PathBuf` or a recognisable denial string.
    /// @inputs folder - The absolute requested folder path as a string slice.
    /// @outputs Result<PathBuf, String> - Ok(resolved) when allowed; Err("ACCESS_DENIED: <folder>") when not granted.
    /// @dataflow str -> allows_folder() -> (true) normalise().ok_or(ACCESS_DENIED) / (false) Err(ACCESS_DENIED).
    /// @controlflow Delegate to allows_folder(); on success return the normalised path or a denial error carrying the original request, never leaking extra detail.
    pub fn require_folder(&self, folder: &str) -> Result<PathBuf, String> {
        // If the folder is permitted, resolve and hand back its canonical absolute form; otherwise fall through to the shared denial error.
        if self.allows_folder(folder) {
            normalise(folder).ok_or_else(|| format!("{ACCESS_DENIED_PREFIX}{folder}"))
        } else {
            // Not granted: return the standard access-denied error carrying the original request for the webview to surface.
            Err(format!("{ACCESS_DENIED_PREFIX}{folder}"))
        }
    }

    /// Atomically rewrites the on-disk grant store, or no-ops when no store is configured.
    /// @purpose Durably persists allow-list mutations using a temp file + rename so a crash mid-write can never corrupt an existing list.
    /// @inputs list - The full allow-list to serialise; `self.store` supplies the destination directory (None => skip).
    /// @outputs Result<(), String> - Ok on success, or a formatted error string from any failed I/O step.
    /// @dataflow GrantList -> serde_json::to_string_pretty() -> temp file write + sync_all -> rename over store.
    /// @controlflow No-op when no store; else create parent dirs, write a uniquely named temp file (create_new), fsync it, then atomically rename — removing the temp on rename failure.
    fn persist(&self, list: &GrantList) -> Result<(), String> {
        // Without a configured store there is nothing to durably persist; keep mutations in memory only.
        let Some(store) = &self.store else { return Ok(()); };

        // Serialise the allow-list for storage; a serialisation failure aborts before any disk write.
        let json = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;

        // Ensure the destination directory exists so create_dir_all never fails on first use after install.
        if let Some(dir) = store.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("failed to create grant dir: {e}"))?;
        }

        // Build a unique temp file name from the process id and current nanoseconds so concurrent writers never collide.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0); // Fallback to 0 if the clock is unset; uniqueness still holds via the pid below.
        let temp_path = store.with_file_name(format!("{GRANTS_FILE_NAME}.{}-{}.tmp", std::process::id(), nanos));

        // Open with create_new so an existing file at this path can never be followed or silently overwritten by a stale name.
        let mut tmp = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|e| format!("failed to create grant temp file: {e}"))?;

        // Write the full payload and force it to stable storage before renaming, so a crash cannot leave a half-written destination.
        tmp.write_all(json.as_bytes()).and_then(|_| tmp.sync_all()).map_err(|e| format!("failed to write grant data: {e}"))?;

        // Drop the handle first so the rename is not blocked by an open file on some platforms, then atomically move it into place.
        drop(tmp);
        match fs::rename(&temp_path, store) {
            // Rename succeeded: the temp name has moved out of the way and the new list is live.
            Ok(()) => Ok(()),
            // Rename failed: clean up the orphaned temp file so it cannot accumulate on disk across future mutations.
            Err(e) => {
                let _ = fs::remove_file(&temp_path);
                Err(format!("failed to persist grants: {e}"))
            }
        }
    }
}

impl Default for GrantState {
    /// A `GrantState` with no store is the simplest transient allow-list.
    fn default() -> Self { Self::new(None) }
}

#[cfg(test)]
#[path = "grants_tests.rs"]
mod tests;
