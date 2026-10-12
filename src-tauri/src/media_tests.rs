//! media_tests.rs
//!
//! @file media_tests.rs
//! @purpose Covers MIME classification, pre-read guards, and byte reads for host media serving (FR-8.17).
//! @inputs temporary folders created per test; absolute paths built from them to files written into them or left absent.
//! @outputs assertions over media_mime, check_media_request, read_media_bytes, and MAX_MEDIA_BYTES.
//! @functions
//!   - folder: create and clear a per-test temporary folder.
//!   - names_the_type_of_every_file_it_plays: every played extension maps to its MIME type.
//!   - ignores_the_case_the_extension_is_written_in: the extension is matched case-insensitively.
//!   - names_nothing_for_a_file_it_does_not_play: non-media extensions classify as nothing.
//!   - refuses_a_relative_path: a relative path is refused, naming the absolute-path rule.
//!   - refuses_a_file_it_does_not_play: an absolute non-media path is refused, naming the media rule.
//!   - refuses_a_file_over_the_limit: an oversized file is refused, naming the byte cap.
//!   - accepts_a_file_within_the_limit: a within-limit media path returns its MIME type.
//!   - reads_the_bytes_of_a_clip: a valid clip's raw bytes are returned.
//!   - refuses_a_clip_that_is_not_there: a missing file is refused, naming the read failure.
//!   - refuses_a_folder_named_like_a_clip: a directory named like a clip is refused on read.
//!   - has_a_limit_of_sixty_four_mebibytes: the media limit is sixty-four mebibytes.
//! @dataflow command args -> absolute + extension check (no disk) -> stat -> size re-check -> fs::read -> bytes or error.
//! @controlflow each test owns its own folder and removes it on completion.
//! @version 1
//! @date 2026-09-18

use super::{check_media_request, media_mime, read_media_bytes, MAX_MEDIA_BYTES};
use std::fs;
use std::path::{Path, PathBuf};

fn folder(name: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("kdoc-media-{name}"));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("create test folder");
    path
}

// media_mime maps every extension K-Doc plays to its video or audio MIME type.
#[test]
fn names_the_type_of_every_file_it_plays() {
    assert_eq!(media_mime(Path::new("a.mp4")), Some("video/mp4"));
    assert_eq!(media_mime(Path::new("a.m4v")), Some("video/mp4"));
    assert_eq!(media_mime(Path::new("a.webm")), Some("video/webm"));
    assert_eq!(media_mime(Path::new("a.ogv")), Some("video/ogg"));
    assert_eq!(media_mime(Path::new("a.mov")), Some("video/quicktime"));
    assert_eq!(media_mime(Path::new("a.mp3")), Some("audio/mpeg"));
    assert_eq!(media_mime(Path::new("a.m4a")), Some("audio/mp4"));
    assert_eq!(media_mime(Path::new("a.wav")), Some("audio/wav"));
    assert_eq!(media_mime(Path::new("a.ogg")), Some("audio/ogg"));
    assert_eq!(media_mime(Path::new("a.oga")), Some("audio/ogg"));
    assert_eq!(media_mime(Path::new("a.flac")), Some("audio/flac"));
    assert_eq!(media_mime(Path::new("a.aac")), Some("audio/aac"));
}

// media_mime ignores the case of the extension, so A.MP4 maps like a.mp4.
#[test]
fn ignores_the_case_the_extension_is_written_in() {
    assert_eq!(media_mime(Path::new("A.MP4")), Some("video/mp4"));
}

// media_mime returns nothing for extensions K-Doc does not play, including none at all.
#[test]
fn names_nothing_for_a_file_it_does_not_play() {
    assert_eq!(media_mime(Path::new("a.txt")), None);
    assert_eq!(media_mime(Path::new("a.png")), None);
    assert_eq!(media_mime(Path::new("noextension")), None);
}

// check_media_request refuses a relative path, naming the absolute-path rule.
#[test]
fn refuses_a_relative_path() {
    let error = check_media_request(Path::new("clip.mp4"), 0).expect_err("relative path");
    assert!(error.contains("absolute"), "{error}");
}

// check_media_request refuses an absolute path whose extension is not media, naming the media rule.
#[test]
fn refuses_a_file_it_does_not_play() {
    let dir = folder("check");
    // The file need not exist: the extension guard runs before any filesystem access.
    let path = dir.join("a.txt");
    let error = check_media_request(&path, 0).expect_err("non-media file");
    assert!(error.contains("not a media file"), "{error}");
    let _ = fs::remove_dir_all(&dir);
}

// check_media_request refuses an absolute path whose declared size exceeds the cap, naming the byte limit.
#[test]
fn refuses_a_file_over_the_limit() {
    let dir = folder("size");
    // The file need not exist: the extension guard passes and only the size guard rejects it here.
    let path = dir.join("a.mp4");
    let error = check_media_request(&path, MAX_MEDIA_BYTES + 1).expect_err("oversized file");
    assert!(error.contains("limit"), "{error}");
    let _ = fs::remove_dir_all(&dir);
}

// check_media_request accepts an absolute media path within the limit, returning its MIME type.
#[test]
fn accepts_a_file_within_the_limit() {
    let dir = folder("ok");
    // The file need not exist: every guard passes without touching disk at this size boundary.
    let path = dir.join("a.mp4");
    assert_eq!(check_media_request(&path, MAX_MEDIA_BYTES), Ok("video/mp4"));
    let _ = fs::remove_dir_all(&dir);
}

// read_media_bytes returns the raw bytes of a media file that passes every guard.
#[test]
fn reads_the_bytes_of_a_clip() {
    let dir = folder("read");
    let file = dir.join("a.mp4");
    let path = file.to_str().expect("path is text");
    fs::write(path, vec![1, 2, 3]).expect("write clip");
    assert_eq!(read_media_bytes(path), Ok(vec![1, 2, 3]));
    let _ = fs::remove_dir_all(&dir);
}

// read_media_bytes refuses a relative path before it touches the disk, so the refusal names the rule and not a read failure.
#[test]
fn refuses_a_relative_path_before_reading() {
    let error = read_media_bytes("clip.mp4").expect_err("relative path");
    assert!(error.contains("absolute"), "{error}");
}

// read_media_bytes refuses a media path that does not exist on disk, naming the read failure.
#[test]
fn refuses_a_clip_that_is_not_there() {
    let dir = folder("missing");
    let file = dir.join("gone.mp4");
    let path = file.to_str().expect("path is text");
    let error = read_media_bytes(path).expect_err("missing clip");
    assert!(error.contains("Cannot read"), "{error}");
    let _ = fs::remove_dir_all(&dir);
}

// read_media_bytes refuses a directory named like a media file, since reading it fails.
#[test]
fn refuses_a_folder_named_like_a_clip() {
    let dir = folder("dir");
    let file = dir.join("a.mp4");
    fs::create_dir_all(&file).expect("mkdir fake clip");
    let path = file.to_str().expect("path is text");
    // The absolute-path and extension guards pass, but the read of a directory fails.
    let error = read_media_bytes(path).expect_err("directory as clip");
    assert!(error.contains("Cannot read"), "{error}");
    let _ = fs::remove_dir_all(&dir);
}

// The media size limit is sixty-four mebibytes.
#[test]
fn has_a_limit_of_sixty_four_mebibytes() {
    assert_eq!(MAX_MEDIA_BYTES, 64 * 1024 * 1024);
}
