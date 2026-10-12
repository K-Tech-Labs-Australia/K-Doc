//! css_themes_tests.rs
//!
//! @file css_themes_tests.rs
//! @purpose Covers theme-name validation and listing of theme folders for theme export.
//! @inputs temporary folders created per test; a set of names checked without any folder present.
//! @outputs assertions over is_valid_theme_name, theme_names_in.
//! @functions
//!   - folder: create and clear a per-test temporary folder.
//!   - accepts_names_a_reader_would_write: every name a reader would write validates.
//!   - refuses_names_that_could_leave_the_folder: names that could escape the folder or are unsafe are rejected.
//!   - refuses_a_name_longer_than_sixty_four_characters: exactly sixty-four characters is allowed, one longer is refused.
//!   - lists_the_css_files_in_order: only .css files are listed and they come back sorted by theme name.
//!   - leaves_out_a_file_whose_name_is_not_a_theme_name: a css file whose stem is not a valid theme name is dropped.
//!   - finds_no_themes_in_an_empty_folder: an empty folder yields no themes rather than an error.
//!   - reports_a_folder_that_is_not_there: a missing folder errors naming the path that was not found.
//! @dataflow css filenames -> validation -> sorted theme-name list.
//! @controlflow each test owns its own folder and removes it.
//! @version 2
//! @date 2026-09-18

use super::{is_valid_theme_name, kind_folder, theme_names_in};
use std::fs;
use std::path::PathBuf;

fn folder(name: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("kdoc-themes-{name}"));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("create test folder");
    path
}

// Every name a reader would write must validate.
#[test]
fn accepts_names_a_reader_would_write() {
    for name in ["custom", "My Theme", "house-style", "report_2026", "a"] {
        assert!(is_valid_theme_name(name), "{name}");
    }
}

// Names that could escape the theme folder or are otherwise unsafe must all be rejected.
#[test]
fn refuses_names_that_could_leave_the_folder() {
    for name in ["", "..", "../x", "a/b", "a\\b", "theme.css", "a:b", "a*b"] {
        assert!(!is_valid_theme_name(name), "{name}");
    }
}

// A name of exactly sixty-four characters is allowed; one character longer is refused.
#[test]
fn refuses_a_name_longer_than_sixty_four_characters() {
    assert!(is_valid_theme_name(&"a".repeat(64)));
    assert!(!is_valid_theme_name(&"a".repeat(65)));
}

// Only .css files are listed, and they come back sorted by theme name.
#[test]
fn lists_the_css_files_in_order() {
    let dir = folder("list");
    fs::write(dir.join("zebra.css"), "body{}").expect("write");
    fs::write(dir.join("Alpha.css"), "body{}").expect("write");
    fs::write(dir.join("notes.md"), "not a theme").expect("write");
    fs::write(dir.join("styles.txt"), "not a theme").expect("write");
    assert_eq!(theme_names_in(&dir).expect("list"), vec!["Alpha".to_string(), "zebra".to_string()]);
    let _ = fs::remove_dir_all(&dir);
}

// A css file whose stem is not a valid theme name is left out.
#[test]
fn leaves_out_a_file_whose_name_is_not_a_theme_name() {
    let dir = folder("odd-name");
    fs::write(dir.join("good.css"), "body{}").expect("write");
    fs::write(dir.join("a.b.css"), "body{}").expect("write");
    assert_eq!(theme_names_in(&dir).expect("list"), vec!["good".to_string()]);
    let _ = fs::remove_dir_all(&dir);
}

// An empty folder yields no themes rather than an error.
#[test]
fn finds_no_themes_in_an_empty_folder() {
    let dir = folder("empty");
    assert!(theme_names_in(&dir).expect("list").is_empty());
    let _ = fs::remove_dir_all(&dir);
}

// Each kind of theme has its own folder, and nothing else is a kind.
#[test]
fn knows_the_two_kinds_of_theme() {
    assert_eq!(kind_folder("export").expect("export"), "export-themes");
    assert_eq!(kind_folder("app").expect("app"), "themes");
    let error = kind_folder("../elsewhere").expect_err("not a kind");
    assert!(error.contains("is not a kind of theme"), "{error}");
    assert!(kind_folder("").is_err());
    assert!(kind_folder("themes").is_err());
}

// A missing folder errors, naming the path that was not found.
#[test]
fn reports_a_folder_that_is_not_there() {
    let dir = folder("missing");
    let inner = dir.join("gone");
    let error = theme_names_in(&inner).expect_err("no folder");
    assert!(error.contains(&inner.display().to_string()), "{error}");
    let _ = fs::remove_dir_all(&dir);
}
