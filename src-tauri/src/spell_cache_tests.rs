//! spell_cache_tests.rs
//!
//! @file spell_cache_tests.rs
//! @purpose Covers language-tag validation and the dictionary read/write cache behind spell checking.
//! @inputs temporary folders created per test; a few tags checked without any folder present.
//! @outputs assertions over is_valid_language_tag, dictionary_folder, read_dictionary, write_dictionary.
//! @functions
//!   - folder: create and clear a per-test temporary folder.
//!   - accepts_the_tags_dictionaries_are_named_by: every tag the dictionaries use validates.
//!   - refuses_tags_that_could_leave_the_folder_or_are_malformed: unsafe or malformed tags are rejected.
//!   - places_a_dictionary_in_a_folder_named_by_its_tag: a valid tag maps to its folder, an invalid one errors with the tag named.
//!   - reads_back_what_it_wrote: a written affix/word-list pair round-trips unchanged.
//!   - replaces_a_dictionary_already_stored: a second write overwrites the first on read.
//!   - finds_nothing_for_a_language_never_stored: an unstored language yields None.
//!   - treats_a_word_list_without_its_affix_file_as_nothing_stored: index.dic alone is not a dictionary.
//!   - treats_an_affix_file_without_its_word_list_as_nothing_stored: index.aff alone is not a dictionary.
//!   - refuses_to_read_or_write_under_a_bad_tag: an invalid tag errors on both read and write and stores nothing.
//! @dataflow tag -> validation -> folder path -> file round-trip.
//! @controlflow each test owns its own folder and removes it.
//! @version 1
//! @date 2026-09-18

use super::{dictionary_folder, is_valid_language_tag, read_dictionary, write_dictionary};
use std::fs;
use std::path::PathBuf;

fn folder(name: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("kdoc-dictionaries-{name}"));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("create test folder");
    path
}

// Every tag the dictionaries are actually named with must validate.
#[test]
fn accepts_the_tags_dictionaries_are_named_by() {
    for tag in ["en", "fr", "fur", "en-GB", "sr-Latn", "ca-valencia", "de-AT"] {
        assert!(is_valid_language_tag(tag), "{tag}");
    }
}

// Tags that could escape the dictionary folder or are malformed must all be rejected.
#[test]
fn refuses_tags_that_could_leave_the_folder_or_are_malformed() {
    for tag in ["", "e", "english", "EN", "../en", "en/..", "en-", "en-G", "en-GBGBGBGBG", "en-GB-x", "en_GB", "..", "en-G.B"] {
        assert!(!is_valid_language_tag(tag), "{tag}");
    }
}

// A valid tag resolves to its subfolder; an invalid one errors naming the offending tag.
#[test]
fn places_a_dictionary_in_a_folder_named_by_its_tag() {
    let root = PathBuf::from("data");
    assert_eq!(dictionary_folder(&root, "en-GB").expect("valid"), root.join("dictionaries").join("en-GB"));
    let error = dictionary_folder(&root, "../x").expect_err("invalid");
    assert!(error.contains("\"../x\" is not a language tag"), "{error}");
}

// What write_dictionary stores comes back unchanged through read_dictionary.
#[test]
fn reads_back_what_it_wrote() {
    let root = folder("round-trip");
    write_dictionary(&root, "fr", "SET UTF-8\n", "1\npomme\n").expect("write");
    assert_eq!(read_dictionary(&root, "fr").expect("read"), Some(("SET UTF-8\n".to_string(), "1\npomme\n".to_string())));
    let _ = fs::remove_dir_all(&root);
}

// A second write replaces the dictionary stored under the same tag.
#[test]
fn replaces_a_dictionary_already_stored() {
    let root = folder("replace");
    write_dictionary(&root, "fr", "SET UTF-8\n", "1\npomme\n").expect("first");
    write_dictionary(&root, "fr", "SET UTF-8\n", "1\npoire\n").expect("second");
    assert_eq!(read_dictionary(&root, "fr").expect("read").map(|pair| pair.1), Some("1\npoire\n".to_string()));
    let _ = fs::remove_dir_all(&root);
}

// A language that was never written yields None rather than an error.
#[test]
fn finds_nothing_for_a_language_never_stored() {
    let root = folder("absent");
    assert_eq!(read_dictionary(&root, "de").expect("read"), None);
    let _ = fs::remove_dir_all(&root);
}

// An index.dic with no matching index.aff is treated as nothing stored.
#[test]
fn treats_a_word_list_without_its_affix_file_as_nothing_stored() {
    let root = folder("half");
    let place = root.join("dictionaries").join("de");
    fs::create_dir_all(&place).expect("folder");
    fs::write(place.join("index.dic"), "1\nHaus\n").expect("dic only");
    assert_eq!(read_dictionary(&root, "de").expect("read"), None);
    let _ = fs::remove_dir_all(&root);
}

// An index.aff with no matching index.dic is treated as nothing stored.
#[test]
fn treats_an_affix_file_without_its_word_list_as_nothing_stored() {
    let root = folder("half-aff");
    let place = root.join("dictionaries").join("de");
    fs::create_dir_all(&place).expect("folder");
    fs::write(place.join("index.aff"), "SET UTF-8\n").expect("aff only");
    assert_eq!(read_dictionary(&root, "de").expect("read"), None);
    let _ = fs::remove_dir_all(&root);
}

// A bad tag errors on both read and write and leaves the dictionary folder untouched.
#[test]
fn refuses_to_read_or_write_under_a_bad_tag() {
    let root = folder("bad-tag");
    assert!(read_dictionary(&root, "..").is_err());
    assert!(write_dictionary(&root, "..", "SET UTF-8\n", "1\na\n").is_err());
    assert!(!root.join("dictionaries").exists());
    let _ = fs::remove_dir_all(&root);
}
