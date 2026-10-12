//! binary_file_tests.rs
//!
//! @file binary_file_tests.rs
//! @purpose Covers the atomic binary write behind exporting to Word (FR-13.4).
//! @inputs temporary folders created per test.
//! @outputs assertions over write_bytes_atomically.
//! @functions
//!   - folder: create and clear a per-test temporary folder.
//!   - writes_the_bytes_exactly: every byte value round-trips unchanged.
//!   - replaces_a_file_that_is_already_there: a shorter write truncates the old file.
//!   - leaves_no_temporary_file_behind: success leaves only the export.
//!   - reports_a_folder_that_does_not_exist: missing folder yields an error naming the path.
//!   - refuses_a_path_that_names_no_folder: a bare name is rejected.
//!   - keeps_the_old_file_when_the_write_fails: a failed write leaves the good export intact.
//!   - reads_the_bytes_exactly: a file read for import comes back unchanged.
//!   - reads_a_file_exactly_at_the_limit: the limit itself is allowed.
//!   - refuses_a_file_over_the_limit: one byte over is refused, naming the limit in megabytes.
//!   - refuses_a_folder: a folder is not read as a file.
//!   - reports_a_missing_file: the error names the path.
//!   - allows_a_large_document: the import limit is 64 MB.
//! @dataflow bytes -> write -> read back.
//! @controlflow each test owns its own folder and removes it.
//! @version 2
//! @date 2026-09-18

use super::{read_bytes_limited, write_bytes_atomically, MAX_IMPORT_BYTES};
use std::fs;
use std::path::PathBuf;

fn folder(name: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("kdoc-binary-{name}"));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("create test folder");
    path
}

#[test]
fn writes_the_bytes_exactly() {
    let dir = folder("exact");
    let target = dir.join("out.docx");
    let bytes: Vec<u8> = (0u16..=600).map(|n| (n % 256) as u8).collect();
    write_bytes_atomically(&target.display().to_string(), &bytes).expect("write");
    assert_eq!(fs::read(&target).expect("read back"), bytes);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn replaces_a_file_that_is_already_there() {
    let dir = folder("replace");
    let target = dir.join("out.docx");
    fs::write(&target, b"an older and much longer export").expect("seed");
    write_bytes_atomically(&target.display().to_string(), b"new").expect("write");
    assert_eq!(fs::read(&target).expect("read back"), b"new");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn leaves_no_temporary_file_behind() {
    let dir = folder("tidy");
    let target = dir.join("out.docx");
    write_bytes_atomically(&target.display().to_string(), b"bytes").expect("write");
    assert!(!dir.join("out.docx.kdoc-tmp").exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn reports_a_folder_that_does_not_exist() {
    let dir = folder("missing");
    let target = dir.join("no-such-folder").join("out.docx");
    let name = target.display().to_string();
    let error = write_bytes_atomically(&name, b"bytes").expect_err("the folder is missing");
    assert!(error.contains(&name));
    assert!(error.len() > name.len() + "Could not write : ".len());
    assert!(!dir.join("no-such-folder").exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn refuses_a_path_that_names_no_folder() {
    let error = write_bytes_atomically("out.docx", b"bytes").expect_err("a bare name has no folder");
    assert!(error.contains("names no folder"));
    assert!(!PathBuf::from("out.docx.kdoc-tmp").exists());
}

// Guards cleanup: when the final rename fails (the target is a folder, which a file cannot replace), the
// temporary file already written must not be left lying beside it.
#[test]
fn removes_the_temporary_file_when_the_rename_fails() {
    let dir = folder("cleanup");
    let target = dir.join("out.docx");
    fs::create_dir_all(target.join("occupied")).expect("make the target a non-empty folder");
    let result = write_bytes_atomically(&target.display().to_string(), b"bytes");
    assert!(result.is_err());
    // No temporary file of any name is left behind beside the target.
    let leftovers = fs::read_dir(&dir)
        .expect("list the folder")
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".kdoc-tmp"))
        .count();
    assert_eq!(leftovers, 0);
    let _ = fs::remove_dir_all(&dir);
}

/// A file planted at a predictable temporary name is neither followed nor overwritten: the save still lands.
#[test]
fn ignores_a_file_planted_where_a_temporary_used_to_go() {
    let dir = folder("planted");
    let target = dir.join("out.docx");
    fs::write(&target, b"the old export").expect("seed");
    let planted = dir.join("out.docx.kdoc-tmp");
    fs::write(&planted, b"planted").expect("plant a file at the old temporary name");
    let result = write_bytes_atomically(&target.display().to_string(), b"new");
    // The save succeeds, and the planted file is untouched.
    assert!(result.is_ok());
    assert_eq!(fs::read(&target).expect("read back"), b"new");
    assert_eq!(fs::read(&planted).expect("read planted"), b"planted");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn reads_the_bytes_exactly() {
    let dir = folder("read-exact");
    let target = dir.join("in.docx");
    let bytes: Vec<u8> = (0u16..=600).map(|n| (n % 256) as u8).collect();
    fs::write(&target, &bytes).expect("seed");
    assert_eq!(read_bytes_limited(&target.display().to_string(), 1024).expect("read"), bytes);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn reads_a_file_exactly_at_the_limit() {
    let dir = folder("read-at-limit");
    let target = dir.join("in.docx");
    fs::write(&target, [7u8; 10]).expect("seed");
    assert_eq!(read_bytes_limited(&target.display().to_string(), 10).expect("read").len(), 10);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn refuses_a_file_over_the_limit() {
    let dir = folder("read-over-limit");
    let target = dir.join("in.docx");
    fs::write(&target, vec![0u8; 2 * 1024 * 1024 + 1]).expect("seed");
    let error = read_bytes_limited(&target.display().to_string(), 2 * 1024 * 1024).expect_err("too large");
    assert!(error.contains("larger than 2 MB"), "{error}");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn refuses_a_folder() {
    let dir = folder("read-folder");
    let error = read_bytes_limited(&dir.display().to_string(), 1024).expect_err("a folder");
    assert!(error.contains("it is not a file"), "{error}");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn reports_a_missing_file() {
    let dir = folder("read-missing");
    let target = dir.join("gone.docx").display().to_string();
    let error = read_bytes_limited(&target, 1024).expect_err("missing");
    assert!(error.contains(&target), "{error}");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn allows_a_large_document() {
    assert_eq!(MAX_IMPORT_BYTES, 64 * 1024 * 1024);
}
