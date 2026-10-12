//! attachments_tests.rs
//!
//! @file attachments_tests.rs
//! @purpose Covers attachment name validation, free-name resolution, byte writes, copies, and folder listing for FR-6.14.
//! @inputs temporary folders created per test; raw bytes and source paths written or copied into them.
//! @outputs assertions over split_name, check_name, free_name, attachment_write, attachment_copy, attachment_names, MAX_ATTACHMENT_BYTES.
//! @functions
//!   - folder: create and clear a per-test temporary folder.
//!   - splits_a_name_into_stem_and_extension: a name splits into stem and extension at its final dot.
//!   - refuses_a_name_that_is_not_a_file_name: empty, whitespace, separator, and dot-dot names are refused.
//!   - leaves_a_free_name_alone: an unused name in an empty folder is returned unchanged.
//!   - numbers_a_name_that_is_taken: a taken name is numbered upward, with or without an extension.
//!   - writes_bytes_under_the_name_it_reports: bytes are stored under the exact reported name.
//!   - never_overwrites_an_attachment: a second write of the same name takes a numbered variant.
//!   - creates_the_folder_it_writes_into: missing parent folders are created before writing.
//!   - refuses_a_relative_folder: a relative folder path is refused, naming the absolute-path rule.
//!   - refuses_a_name_with_a_separator: a name with a separator is refused, naming the separator rule.
//!   - copies_a_file_into_the_folder: an existing source file is copied under the reported name.
//!   - refuses_a_source_that_is_not_there: a missing source is refused, naming the missing-file condition.
//!   - lists_only_the_files_in_the_folder_sorted: only files are listed and they come back sorted.
//!   - reports_no_attachments_for_a_folder_that_is_not_there: a missing folder yields an empty list.
//!   - has_a_limit_a_reader_would_not_reach: the attachment limit is twenty-five mebibytes.
//! @dataflow command args -> validation -> filesystem write/copy/read -> chosen name or sorted list.
//! @controlflow each test owns its own folder and removes it on completion.
//! @version 2
//! @date 2026-09-18

use super::{attachment_copy_at, attachment_names_at, attachment_write_at, check_name, free_name, split_name, MAX_ATTACHMENT_BYTES};
use std::fs;
use std::path::PathBuf;

fn folder(name: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("kdoc-attach-{name}"));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("create test folder");
    path
}

// A name splits into stem and extension at its final dot, with edge cases handled.
#[test]
fn splits_a_name_into_stem_and_extension() {
    assert_eq!(split_name("a.png"), ("a".into(), ".png".into()));
    assert_eq!(split_name("a"), ("a".into(), String::new()));
    assert_eq!(split_name(".hidden"), (".hidden".into(), String::new()));
    assert_eq!(split_name("a.tar.gz"), ("a.tar".into(), ".gz".into()));
}

// A name that is not a plain file name — empty, whitespace, separator, or dot-dot — is refused.
#[test]
fn refuses_a_name_that_is_not_a_file_name() {
    assert!(check_name("").is_err());
    assert!(check_name("   ").is_err());
    assert!(check_name("a/b.png").is_err());
    assert!(check_name("a\\b.png").is_err());
    assert!(check_name("..").is_err());
    assert!(check_name("a.png").is_ok());
}

// A name that is already free in an empty folder is returned unchanged.
#[test]
fn leaves_a_free_name_alone() {
    let dir = folder("free");
    assert_eq!(free_name(&dir, "a.png"), "a.png".to_string());
    let _ = fs::remove_dir_all(&dir);
}

// A taken name is numbered upward; a name without an extension is numbered too.
#[test]
fn numbers_a_name_that_is_taken() {
    let dir = folder("taken");
    fs::write(dir.join("a.png"), "").expect("write");
    fs::write(dir.join("a-2.png"), "").expect("write");
    assert_eq!(free_name(&dir, "a.png"), "a-3.png".to_string());

    fs::write(dir.join("notes"), "").expect("write");
    assert_eq!(free_name(&dir, "notes"), "notes-2".to_string());
    let _ = fs::remove_dir_all(&dir);
}

// Bytes are written under the exact name that is reported back.
#[test]
fn writes_bytes_under_the_name_it_reports() {
    let dir = folder("write");
    let text = dir.to_str().expect("path is text").to_string();
    let chosen = attachment_write_at(text, "a.png".into(), vec![1, 2, 3]).expect("write");
    assert_eq!(chosen, "a.png".to_string());
    assert_eq!(fs::read(dir.join(&chosen)).expect("read"), vec![1, 2, 3]);
    let _ = fs::remove_dir_all(&dir);
}

// Writing twice with the same name never overwrites; a numbered variant is used instead.
#[test]
fn never_overwrites_an_attachment() {
    let dir = folder("overwrite");
    let text = dir.to_str().expect("path is text").to_string();
    attachment_write_at(text.clone(), "a.png".into(), vec![1]).expect("write");
    let chosen = attachment_write_at(text, "a.png".into(), vec![2]).expect("write");
    assert_eq!(chosen, "a-2.png".to_string());
    assert_eq!(fs::read(dir.join("a.png")).expect("read"), vec![1]);
    let _ = fs::remove_dir_all(&dir);
}

// A write creates any missing parent folders before writing the file.
#[test]
fn creates_the_folder_it_writes_into() {
    let dir = folder("nested");
    let target = dir.join("deep").join("er");
    let chosen = attachment_write_at(target.to_str().expect("path is text").to_string(), "a.png".into(), vec![1]).expect("write");
    assert!(dir.join("deep").join("er").join(&chosen).exists());
    let _ = fs::remove_dir_all(&dir);
}

// A relative folder path is refused, naming the absolute-path requirement.
#[test]
fn refuses_a_relative_folder() {
    let error = attachment_write_at("attachments".into(), "a.png".into(), vec![1]).expect_err("relative folder");
    assert!(error.contains("absolute"), "{error}");
}

// A name containing a path separator is refused, naming the separator rule.
#[test]
fn refuses_a_name_with_a_separator() {
    let dir = folder("separator");
    let text = dir.to_str().expect("path is text").to_string();
    let error = attachment_write_at(text, "../escape.png".into(), vec![1]).expect_err("separator name");
    assert!(error.contains("path separator"), "{error}");
    let _ = fs::remove_dir_all(&dir);
}

// An existing source file is copied into the folder under the reported name.
#[test]
fn copies_a_file_into_the_folder() {
    let dir = folder("copy");
    let text = dir.to_str().expect("path is text").to_string();
    let source_dir = folder("source");
    let source = source_dir.join("source.png");
    fs::write(&source, vec![9, 9]).expect("write source");
    let chosen = attachment_copy_at(text, "shot.png".into(), source.to_str().expect("path is text").to_string()).expect("copy");
    assert_eq!(chosen, "shot.png".to_string());
    assert_eq!(fs::read(dir.join(&chosen)).expect("read"), vec![9, 9]);
    assert!(source.exists());
    let _ = fs::remove_dir_all(&dir);
    let _ = fs::remove_dir_all(&source_dir);
}

// A source that does not exist is refused, naming the missing-file condition.
#[test]
fn refuses_a_source_that_is_not_there() {
    let dir = folder("missing-source");
    let text = dir.to_str().expect("path is text").to_string();
    let error = attachment_copy_at(text, "shot.png".into(), dir.join("missing.png").to_str().expect("path is text").to_string()).expect_err("no source");
    assert!(error.contains("no such file"), "{error}");
    let _ = fs::remove_dir_all(&dir);
}

// Only files in the folder are listed, and they come back sorted.
#[test]
fn lists_only_the_files_in_the_folder_sorted() {
    let dir = folder("list");
    fs::write(dir.join("b.png"), "").expect("write");
    fs::write(dir.join("a.png"), "").expect("write");
    fs::create_dir_all(dir.join("sub")).expect("mkdir sub");
    assert_eq!(attachment_names_at(dir.to_str().expect("path is text").to_string()).expect("list"), vec!["a.png".to_string(), "b.png".to_string()]);
    let _ = fs::remove_dir_all(&dir);
}

// A folder that does not exist yields an empty list rather than an error.
#[test]
fn reports_no_attachments_for_a_folder_that_is_not_there() {
    let dir = folder("gone");
    assert!(attachment_names_at(dir.join("missing").to_str().expect("path is text").to_string()).expect("list").is_empty());
    let _ = fs::remove_dir_all(&dir);
}

// The attachment size limit is twenty-five mebibytes.
#[test]
fn has_a_limit_a_reader_would_not_reach() {
    assert_eq!(MAX_ATTACHMENT_BYTES, 25 * 1024 * 1024);
}
