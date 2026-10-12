//! @file git_tests.rs
//! @purpose Unit tests for git awareness: porcelain/log parsing, commit-hash validation, and staged/committed file operations exercised against a throwaway repository created on disk.
//! @inputs Nothing external; each test constructs its own temporary directory or feeds literal strings to pure parsers.
//! @outputs Test assertions that pass/fail the suite; no values are returned.
//! @functions
//!   - temp_dir: Allocates a unique, empty temporary directory keyed by pid/nanos/suffix.
//!   - run: Invokes `git` with args in a directory and panics on non-zero exit.
//!   - repo: Bootstraps a throwaway git repository (init + identity config) for integration tests.
//!   - parses_porcelain_status_columns: Verifies staged/modified column decoding from porcelain status lines.
//!   - parses_log_lines: Verifies parsing of `git log --format` output into GitCommit records.
//!   - accepts_only_hex_commit_hashes: Verifies hexadecimal commit-hash validation rules.
//!   - splits_a_document_path: Verifies drive/path/filename splitting on Windows-style paths.
//!   - reads_nothing_outside_a_repository: Verifies empty results when querying files outside any repo.
//!   - stages_commits_lists_and_reads_a_file: Exercises the full stage → commit → log → read-at workflow against a real repo.
//! @dataflow Test body → git subprocess / pure parser → assertion result (no persistent data leaves the process).
//! @controlflow Each #[test] fn is independent: set up temp state → perform operation(s) → assert → clean up.
//! @version 1
//! @date 2026-09-16

use super::*;
use std::fs;

/// Allocates a unique, empty temporary directory keyed by pid/nanos/suffix.
fn temp_dir(suffix: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("kdoc-git-test-{}-{}-{}", std::process::id(), nanos, suffix));
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// Runs `git` with the given args inside `dir` and panics if it exits non-zero.
fn run(dir: &Path, args: &[&str]) {
    let output = git(dir, args).unwrap();
    assert!(output.status.success(), "git {:?} failed: {}", args, failure(&output));
}

/// Bootstraps a throwaway git repository (init + identity config) for integration tests.
fn repo(suffix: &str) -> PathBuf {
    let dir = temp_dir(suffix);
    run(&dir, &["init", "-q", "-b", "main"]);
    run(&dir, &["config", "user.name", "Test"]);
    run(&dir, &["config", "user.email", "test@example.invalid"]);
    run(&dir, &["config", "commit.gpgsign", "false"]);
    dir
}

/// Verifies decoding of staged/modified columns from porcelain status lines.
#[test]
fn parses_porcelain_status_columns() {
    assert_eq!(parse_porcelain("?? note.md"), (false, true));
    assert_eq!(parse_porcelain("M  note.md"), (true, false));
    assert_eq!(parse_porcelain(" M note.md"), (false, true));
    assert_eq!(parse_porcelain("MM note.md"), (true, true));
    assert_eq!(parse_porcelain(""), (false, false));
}

/// Verifies parsing of `git log --format` output into GitCommit records.
#[test]
fn parses_log_lines() {
    let text = "aaaaaaa1\u{1f}aaaaaaa\u{1f}Ada\u{1f}1700000000\u{1f}First: with colons\nbad line\nbbbbbbb2\u{1f}bbbbbbb\u{1f}Bo\u{1f}1700000100\u{1f}\n";
    assert_eq!(
        parse_log(text),
        vec![
            GitCommit { hash: "aaaaaaa1".into(), short_hash: "aaaaaaa".into(), author: "Ada".into(), at: 1_700_000_000_000, subject: "First: with colons".into() },
            GitCommit { hash: "bbbbbbb2".into(), short_hash: "bbbbbbb".into(), author: "Bo".into(), at: 1_700_000_100_000, subject: String::new() },
        ]
    );
}

/// Verifies hexadecimal commit-hash validation rules.
#[test]
fn accepts_only_hex_commit_hashes() {
    assert!(is_commit_hash("abc1234"));
    assert!(is_commit_hash(&"f".repeat(40)));
    assert!(!is_commit_hash("abc123"));
    assert!(!is_commit_hash(&"f".repeat(41)));
    assert!(!is_commit_hash("ABC1234"));
    assert!(!is_commit_hash("abc123g"));
    assert!(!is_commit_hash("HEAD~1a"));
}

/// Verifies splitting a document path into directory and filename.
#[test]
fn splits_a_document_path() {
    let (dir, name) = split_path("C:/notes/plan.md").unwrap();
    assert_eq!(dir, PathBuf::from("C:/notes"));
    assert_eq!(name, "plan.md");
    assert!(split_path("plan.md").is_err());
}

/// Verifies empty results when querying files outside any repository.
#[test]
fn reads_nothing_outside_a_repository() {
    let dir = temp_dir("plain");
    let file = dir.join("note.md");
    fs::write(&file, "text").unwrap();
    let path = file.to_string_lossy().to_string();
    assert_eq!(file_info(&path).unwrap(), None);
    assert_eq!(file_log(&path, 10).unwrap(), Vec::new());
    assert_eq!(file_info(&dir.join("missing").join("x.md").to_string_lossy()).unwrap(), None);
    let _ = fs::remove_dir_all(&dir);
}

/// A repository's own core.fsmonitor command must never run: reading status of a downloaded repo is not consent to execute it.
#[test]
fn never_runs_a_repository_fsmonitor_command() {
    let dir = repo("fsmonitor");
    let marker = dir.join("fsmonitor-ran.txt");
    let hook = dir.join("fsmon.sh");
    fs::write(&hook, format!("#!/bin/sh\necho ran > '{}'\n", marker.to_string_lossy().replace('\\', "/"))).unwrap();
    let hook_path = hook.to_string_lossy().replace('\\', "/");
    // Written with plain `git config` rather than through git(): the setting is the repository's, not K-Doc's.
    let set = std::process::Command::new("git")
        .arg("-C")
        .arg(&dir)
        .args(["config", "core.fsmonitor", &hook_path])
        .output()
        .unwrap();
    assert!(set.status.success());
    let file = dir.join("note.md");
    fs::write(&file, "one\n").unwrap();

    let _ = file_info(&file.to_string_lossy()).unwrap();

    assert!(!marker.exists(), "the repository's fsmonitor command ran");
    let _ = fs::remove_dir_all(&dir);
}

/// Exercises the full stage → commit → log → read-at workflow against a real repository.
#[test]
fn stages_commits_lists_and_reads_a_file() {
    let dir = repo("flow");
    let file = dir.join("note.md");
    let other = dir.join("other.md");
    let path = file.to_string_lossy().to_string();
    fs::write(&file, "one\n").unwrap();
    fs::write(&other, "other\n").unwrap();

    let untracked = file_info(&path).unwrap().unwrap();
    assert_eq!((untracked.tracked, untracked.staged, untracked.modified), (false, false, true));
    assert_eq!(untracked.branch, "");
    assert_eq!(file_log(&path, 10).unwrap(), Vec::new());

    stage_file(&path).unwrap();
    let staged = file_info(&path).unwrap().unwrap();
    assert_eq!((staged.tracked, staged.staged, staged.modified), (true, true, false));

    run(&dir, &["add", "--", "other.md"]);
    let first = commit_file(&path, "Add note").unwrap();
    assert!(is_commit_hash(&first));
    let after = file_info(&path).unwrap().unwrap();
    assert_eq!((after.branch.as_str(), after.tracked, after.staged, after.modified), ("main", true, false, false));
    let still_staged = git(&dir, &["diff", "--cached", "--name-only"]).unwrap();
    assert_eq!(stdout_text(&still_staged), "other.md");

    fs::write(&file, "two\n").unwrap();
    assert!(file_info(&path).unwrap().unwrap().modified);
    commit_file(&path, "Change note").unwrap();

    let log = file_log(&path, 10).unwrap();
    assert_eq!(log.iter().map(|c| c.subject.as_str()).collect::<Vec<_>>(), vec!["Change note", "Add note"]);
    assert_eq!(log[1].short_hash, first);
    assert_eq!(file_log(&path, 1).unwrap().len(), 1);
    assert_eq!(file_at(&path, &log[1].hash).unwrap().replace("\r\n", "\n"), "one\n");
    assert!(file_at(&path, "HEAD").is_err());
    assert!(file_at(&path, "0000000").is_err());
    assert_eq!(commit_file(&path, "  "), Err("A commit needs a message.".to_string()));
    let fresh = dir.join("fresh.md");
    fs::write(&fresh, "new\n").unwrap();
    let fresh_hash = commit_file(&fresh.to_string_lossy(), "Add fresh").unwrap();
    assert!(is_commit_hash(&fresh_hash));
    assert!(file_info(&fresh.to_string_lossy()).unwrap().unwrap().tracked);
    let _ = fs::remove_dir_all(&dir);
}
