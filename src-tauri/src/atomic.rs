//! @file atomic.rs
//! @purpose Helpers for writing a temp file of an atomic save so that a file planted beside the target — or a symlink pointing at it — can never be followed or reused by the write.
//! @inputs dir - the target's folder; file_name - the target's file name (copied verbatim into the temp name); path - a candidate sibling location to create exclusively.
//! @outputs PathBuf for a hidden sibling temp path carrying the recognised .kdoc-tmp suffix; std::io::Result<File> opened with O_EXCL semantics.
//! @functions
//!   - unique_temp_path: Builds `<dir>/.<file_name>.<pid>-<nanos>-<counter>.kdoc-tmp`, a sibling no one could have prepared in advance.
//!   - create_exclusive: Opens the exact temp path with O_EXCL semantics, refusing any pre-existing file or symlink at that location.
//! @dataflow unique_temp_path(dir, file_name) -> process id + nanosecond clock + monotonic counter -> hidden sibling PathBuf; create_exclusive(path) -> OpenOptions { write, create_new } open -> File handle owned by the caller.
//! @controlflow Build a uniquely named sibling first (so no attacker can pre-plant it), then create_new() that exact path so the write lands only in a file this call made.
//! @version 1
//! @date 2026-10-08

use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// Distinguishes temp files created within the same nanosecond by one process.
static COUNTER: AtomicU64 = AtomicU64::new(0);

/// Builds a sibling temp path no one could have prepared in advance.
/// @purpose Returns `<dir>/.<file_name>.<pid>-<nanos>-<counter>.kdoc-tmp`, so the atomic write can never land on or follow a file an attacker pre-planted beside the target.
/// @inputs dir - the target's folder; file_name - the target's file name (copied verbatim into the temp name).
/// @outputs PathBuf - `<dir>/.<file_name>.<pid>-<nanos>-<counter>.kdoc-tmp`; the leading dot keeps it out of casual listings and the .kdoc-tmp suffix is what the file watcher recognises.
/// @dataflow SystemTime nanos + process id + monotonic counter -> OsString name -> dir.join(name).
/// @controlflow Read the clock (falling back to 0 on error) then bump a relaxed atomic; compose the hidden, suffixed name and join it onto dir.
pub fn unique_temp_path(dir: &Path, file_name: &std::ffi::OsStr) -> PathBuf {
    // Capture the current wall-clock nanos since the Unix epoch, defaulting to 0 if the clock is unset or before it.
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    // Bump a per-process counter so two paths requested in the same nanosecond still differ.
    let count = COUNTER.fetch_add(1, Ordering::Relaxed);
    // Start the name with a leading dot to hide it from casual directory listings.
    let mut name = std::ffi::OsString::from(".");
    name.push(file_name);
    name.push(format!(".{}-{}-{}.kdoc-tmp", std::process::id(), nanos, count));
    dir.join(name)
}

/// Creates the temp file, refusing anything already at that path.
/// @purpose Opens the exact sibling returned by unique_temp_path with O_EXCL semantics so a pre-existing file — or a symlink to one — is rejected rather than followed, guaranteeing the write lands only in a file this call made.
/// @inputs path - the candidate temp location (a hidden .kdoc-tmp sibling).
/// @outputs std::io::Result<File> - Ok(handle) on success; an error if anything already occupies the path.
/// @dataflow OpenOptions { write, create_new } -> open(path) -> File handle or io::Error.
/// @controlflow Configure a single create-new open and execute it once; any pre-existing entry fails without truncation or symlink traversal.
pub fn create_exclusive(path: &Path) -> std::io::Result<File> {
    OpenOptions::new().write(true).create_new(true).open(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two temp paths for the same target differ, sit beside it, are hidden and keep the recognised suffix.
    #[test]
    fn temp_paths_are_unique_hidden_siblings() {
        let dir = std::env::temp_dir();
        // Generate two sibling temp paths for the same target and confirm they never collide.
        let a = unique_temp_path(&dir, std::ffi::OsStr::new("note.md"));
        let b = unique_temp_path(&dir, std::ffi::OsStr::new("note.md"));
        assert_ne!(a, b);
        // Both paths sit directly inside the target's folder.
        assert_eq!(a.parent(), Some(dir.as_path()));
        // The name is hidden (leading dot) and carries the recognised suffix.
        let name = a.file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.starts_with(".note.md."));
        assert!(name.ends_with(".kdoc-tmp"));
    }

    /// A file already at the temp path is refused and left untouched.
    #[test]
    fn create_exclusive_refuses_an_existing_file() {
        let p = unique_temp_path(&std::env::temp_dir(), std::ffi::OsStr::new("x.md"));
        // Plant a real file where the temp would go, then attempt an exclusive open.
        std::fs::write(&p, "planted").unwrap();
        assert!(create_exclusive(&p).is_err());
        // The planted content is preserved — it was never truncated or followed through a symlink.
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "planted");
        let _ = std::fs::remove_file(&p);
    }

    /// A fresh path is created.
    #[test]
    fn create_exclusive_makes_a_new_file() {
        let p = unique_temp_path(&std::env::temp_dir(), std::ffi::OsStr::new("y.md"));
        // No file exists yet, so the exclusive open succeeds and leaves a real file behind.
        let f = create_exclusive(&p);
        assert!(f.is_ok());
        drop(f);
        assert!(p.exists());
        let _ = std::fs::remove_file(&p);
    }
}
