//! @file permissions_tests.rs
//! @purpose Covers the read-only attribute helpers behind the locked-document state (FR-6.7).
//! @inputs temporary files created per test.
//! @outputs assertions over is_read_only and set_read_only.
//! @functions the tests below.
//! @dataflow temp file -> set_read_only -> is_read_only.
//! @controlflow one test per behaviour; each cleans up by clearing the attribute before removing the file.
//! @version 1
//! @date 2026-09-16

use super::{is_read_only, set_read_only};
use std::fs;
use std::path::PathBuf;

fn temp_file(name: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("kdoc-permissions-{name}.txt"));
    // Each test owns its own file, named after itself, and clears any attribute left by an earlier run before removing it, so a failed run cannot lock the next one out.
    let _ = set_read_only(&path.display().to_string(), false);
    let _ = fs::remove_file(&path);
    fs::write(&path, b"contents").expect("write temp file");
    path
}

fn clean_up(path: &PathBuf) {
    // The attribute is cleared before the file is removed, because a read-only file cannot be deleted on Windows.
    let _ = set_read_only(&path.display().to_string(), false);
    let _ = fs::remove_file(path);
}

#[test]
fn a_new_file_is_writable() {
    // Guards: a file created without any attribute set must report as writable, not locked.
    let path = temp_file("writable");
    assert!(!is_read_only(&path.display().to_string()));
    clean_up(&path);
}

#[test]
fn a_missing_file_is_reported_writable() {
    // Guards: the caller has already read the file, so a path that cannot be inspected must not stop it opening.
    let mut path = std::env::temp_dir();
    path.push("kdoc-permissions-missing-file.txt");
    let _ = fs::remove_file(&path);
    assert!(!is_read_only(&path.display().to_string()));
}

#[test]
fn setting_and_clearing_the_attribute_round_trips() {
    // Guards: toggling the attribute on then off returns the file to its original writable state.
    let path = temp_file("round-trip");
    let name = path.display().to_string();
    set_read_only(&name, true).expect("lock");
    assert!(is_read_only(&name));
    set_read_only(&name, false).expect("unlock");
    assert!(!is_read_only(&name));
    clean_up(&path);
}

#[test]
fn setting_the_state_it_already_has_succeeds() {
    // Guards: re-applying an already-active (or inactive) attribute is a no-op success, not an error.
    let path = temp_file("already");
    let name = path.display().to_string();
    assert!(set_read_only(&name, false).is_ok());
    set_read_only(&name, true).expect("lock");
    assert!(set_read_only(&name, true).is_ok());
    assert!(is_read_only(&name));
    clean_up(&path);
}

#[test]
fn a_read_only_file_cannot_be_written_until_it_is_unlocked() {
    // Guards: this is the behaviour the locked state exists for — the guard proves the attribute really does stop a write, not just that the flag reads back.
    let path = temp_file("write-guard");
    let name = path.display().to_string();
    set_read_only(&name, true).expect("lock");
    assert!(fs::write(&path, b"changed").is_err());
    set_read_only(&name, false).expect("unlock");
    assert!(fs::write(&path, b"changed").is_ok());
    clean_up(&path);
}

#[test]
fn changing_a_missing_file_reports_the_path_and_the_reason() {
    // Guards: an error naming neither the path nor the reason is not actionable.
    let mut path = std::env::temp_dir();
    path.push("kdoc-permissions-missing-change.txt");
    let _ = fs::remove_file(&path);
    let name = path.display().to_string();
    let error = set_read_only(&name, true).expect_err("a missing file cannot be changed");
    assert!(error.contains(&name));
    assert!(error.len() > name.len());
}
