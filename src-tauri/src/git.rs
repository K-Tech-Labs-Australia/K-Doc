//! @file git.rs
//! @purpose Git awareness (FR-11.11): when a document sits in a git working tree, reports its branch and state, lists the commits that touched it, reads it as it was in one of them, and stages or commits just that file, by running the system git.
//! @inputs Document paths, a commit hash, a commit message.
//! @outputs GitFileInfo, GitCommit lists, file text, a short hash over IPC.
//! @functions
//!   - split_path: Split a document path into its folder and file name.
//!   - parse_porcelain: Parse one porcelain status line into (staged, modified).
//!   - parse_log: Parse git log output into GitCommit records.
//!   - is_commit_hash: Validate that a string names a commit hash.
//!   - file_info: Report the repository state of a document.
//!   - file_log: List commits that touched a document.
//!   - file_at: Read a document as it was in a given commit.
//!   - stage_file: Stage just the named file.
//!   - commit_file: Commit just the named file with a message.
//!   - git: Run git in a folder and capture its output.
//!   - stdout_text: Extract trimmed stdout text from an Output.
//!   - failure: Build an error message from a failed Output.
//!   - git_file_info: Tauri command exposing file_info over IPC.
//!   - git_file_log: Tauri command exposing file_log over IPC.
//!   - git_file_at: Tauri command exposing file_at over IPC.
//!   - git_stage_file: Tauri command exposing stage_file over IPC.
//!   - git_commit_file: Tauri command exposing commit_file over IPC.
//! @dataflow Document path -> folder + file name -> `git -C <folder> ...` with arguments passed directly (no shell) -> parsed output.
//! @controlflow A folder outside any repository, or no git installed, reads as "not in git" rather than an error; failures of git itself return its message.
//! @version 1
//! @date 2026-09-16

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000; // Windows process creation flag so git does not flash a console window.

const FIELD_SEPARATOR: char = '\u{1f}'; // ASCII unit separator between log fields, a character that cannot appear in names or subjects.

/// @purpose Repository state of a single document (FR-11.11).
/// @inputs None; built internally by file_info from git output.
/// @outputs root: the working tree's top folder; branch: the checked-out branch, empty before the first commit; tracked: git knows the file; staged: the index differs from HEAD for it; modified: the working file differs from the index, or is untracked.
/// @dataflow git rev-parse and status output -> GitFileInfo fields.
/// @controlflow None (plain data type carrying parsed git state).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitFileInfo {
    pub root: String,
    pub branch: String,
    pub tracked: bool,
    pub staged: bool,
    pub modified: bool,
}

/// @purpose One commit that touched a document (FR-11.11).
/// @inputs None; built internally by parse_log from git log output.
/// @outputs hash: full commit hash; short_hash: abbreviated hash; author: author name; at: milliseconds since the epoch (git reports seconds); subject: commit subject line.
/// @dataflow git log porcelain -> GitCommit fields.
/// @controlflow None (plain data type carrying parsed commit state).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub at: i64,
    pub subject: String,
}

/// @purpose Run git in a folder and capture its stdout/stderr/status.
/// @inputs dir: the working folder to run git in; args: positional arguments passed straight to git.
/// @outputs Ok(Output) with captured process output; Err(String) if git cannot be launched.
/// @dataflow dir + args -> Command::new("git") -C dir <args> -> Output.
/// @controlflow Build the command, apply the no-console flag on Windows, run it, and map launch errors to a message. Arguments go straight to the process, never through a shell, so a file name or message cannot inject commands; -C runs git in the document's folder.
fn git(dir: &Path, args: &[&str]) -> Result<Output, String> {
    let mut command = Command::new("git");
    // A repository's own core.fsmonitor names a command git would run on every status; reading a
    // downloaded repository's history must never execute it. No prompt either: nothing can answer one.
    command.arg("-C").arg(dir).args(["-c", "core.fsmonitor=false"]).args(args);
    command.env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command.output().map_err(|err| format!("Could not run git: {err}"))
}

/// @purpose Extract trimmed stdout text from captured process output.
/// @inputs output: the raw Output whose stdout is decoded.
/// @outputs The stdout as a String with trailing carriage returns and newlines removed.
/// @dataflow Output.stdout bytes -> UTF-8 lossy decode -> trim_end_matches(['\r', '\n']) -> String.
/// @controlflow None (linear decode and trim).
fn stdout_text(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).trim_end_matches(['\r', '\n']).to_string()
}

/// @purpose Build an error message from a failed git output.
/// @inputs output: the raw Output whose stderr/status is inspected.
/// @outputs The trimmed stderr text, or "git exited with <status>" when stderr was empty.
/// @dataflow Output.stderr -> decode/trim -> message; falls back to the exit status.
/// @controlflow If stderr is non-empty return it; otherwise report git's exit status.
fn failure(output: &Output) -> String {
    let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if message.is_empty() {
        // No stderr text: fall back to the process exit status.
        format!("git exited with {}", output.status)
    } else {
        // git printed its own diagnostic: report it verbatim.
        message
    }
}

/// @purpose Split a document path into its folder and file name (FR-11.11).
/// @inputs document_path: the full path to the document.
/// @outputs Ok((folder, name)) with the parent directory and base file name; Err when either is missing.
/// @dataflow Path -> parent + file_name -> (PathBuf, String).
/// @controlflow Reject a path with no folder or no file name with an error; otherwise return both parts so commands run in the folder and name the file relative to it.
pub fn split_path(document_path: &str) -> Result<(PathBuf, String), String> {
    let path = Path::new(document_path);
    let dir = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| "The document has no folder.".to_string())?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "The document has no file name.".to_string())?;
    Ok((dir.to_path_buf(), name.to_string()))
}

/// @purpose Parse one porcelain status line into (staged, modified) flags (FR-11.11).
/// @inputs line: a single porcelain status line whose first two columns are status codes.
/// @outputs (staged, modified): untracked maps to (false, true); otherwise the index column and working-tree column.
/// @dataflow "XY name" -> X is the index column, Y is the working tree column -> (bool, bool).
/// @controlflow "??" means untracked (not staged, but a change); otherwise X is the index column and Y the working tree column.
pub fn parse_porcelain(line: &str) -> (bool, bool) {
    let mut chars = line.chars();
    let index = chars.next().unwrap_or(' ');
    let worktree = chars.next().unwrap_or(' ');
    if index == '?' {
        // Untracked file: not staged, but present as a change.
        (false, true)
    } else {
        // Tracked file: X is the index column and Y the working tree column.
        (index != ' ', worktree != ' ')
    }
}

/// @purpose Parse git log output into GitCommit records (FR-11.11).
/// @inputs text: multi-line git log output with fields separated by FIELD_SEPARATOR.
/// @outputs A Vec<GitCommit> for each well-formed line; the commit time is converted to milliseconds.
/// @dataflow Each line -> splitn(5, FIELD_SEPARATOR) -> GitCommit fields -> Vec.
/// @controlflow Skip lines that do not have all five fields (none are expected).
pub fn parse_log(text: &str) -> Vec<GitCommit> {
    text.lines()
        .filter_map(|line| {
            let mut fields = line.splitn(5, FIELD_SEPARATOR);
            let hash = fields.next()?.to_string();
            let short_hash = fields.next()?.to_string();
            let author = fields.next()?.to_string();
            let seconds = fields.next()?.parse::<i64>().ok()?;
            let subject = fields.next()?.to_string(); // git always writes the separator before the subject, even an empty one.
            Some(GitCommit { hash, short_hash, author, at: seconds * 1000, subject })
        })
        .collect()
}

/// @purpose Validate that a string names a commit hash (FR-11.11).
/// @inputs hash: the candidate hash string.
/// @outputs true when it is 7 to 40 lowercase hex digits, false otherwise.
/// @dataflow hash length and characters -> boolean predicate.
/// @controlflow Require 7 to 40 lowercase hex digits so the argument can only ever name a commit.
pub fn is_commit_hash(hash: &str) -> bool {
    (7..=40).contains(&hash.len()) && hash.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

/// @purpose Report the repository state of a document (FR-11.11).
/// @inputs document_path: the full path to the document.
/// @outputs Ok(Some(GitFileInfo)) when in a repository; Ok(None) when not in git; Err(git's message) on git failure.
/// @dataflow Document path -> folder + name -> `git -C <folder> ...` with arguments passed directly (no shell) -> parsed output.
/// @controlflow A missing folder, git not installed, or a folder outside a repository all mean "not in git"; rev-parse of HEAD fails before the first commit.
pub fn file_info(document_path: &str) -> Result<Option<GitFileInfo>, String> {
    let (dir, name) = split_path(document_path)?;
    // A missing folder needs no check of its own: git -C fails for it, which reads as "not in git" below.
    let top = match git(&dir, &["rev-parse", "--show-toplevel"]) {
        // git launched successfully: capture the output to inspect its status.
        Ok(output) => output,
        // git could not be run (e.g. not installed): treat as "not in git".
        Err(_) => return Ok(None),
    };
    // A non-zero exit means this folder is outside any repository.
    if !top.status.success() {
        return Ok(None);
    } else {
        // Inside a repository: read the working-tree top level and current branch.
    }
    let branch_output = git(&dir, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let branch = if branch_output.status.success() {
        // Branch resolved normally.
        stdout_text(&branch_output)
    } else {
        // No commit yet (no HEAD): report an empty branch name.
        String::new()
    };
    let tracked = git(&dir, &["ls-files", "--error-unmatch", "--", &name])?.status.success();
    let status = git(&dir, &["status", "--porcelain=v1", "--", &name])?;
    // A porcelain status failure is a real git error, not "not in git".
    if !status.status.success() {
        return Err(failure(&status));
    } else {
        // Status succeeded: decode the porcelain line into staged/modified flags.
    }
    let (staged, modified) = parse_porcelain(&stdout_text(&status));
    Ok(Some(GitFileInfo { root: stdout_text(&top), branch, tracked, staged, modified }))
}

/// @purpose List commits that touched a document (FR-11.11).
/// @inputs document_path: the full path to the document; limit: maximum number of commits to return.
/// @outputs Ok(Vec<GitCommit>) of recent commits; an empty list when not in git or with no history; Err(git's message) on failure.
/// @dataflow Document path -> folder + name -> `git log --follow` with arguments passed directly (no shell) -> parsed output. --follow keeps the history across renames.
/// @controlflow A repository with no commits yet has none to list; a document not in git yields an empty list.
pub fn file_log(document_path: &str, limit: u32) -> Result<Vec<GitCommit>, String> {
    let (dir, name) = split_path(document_path)?;
    // Not inside a repository: there is nothing to log.
    if file_info(document_path)?.is_none() {
        return Ok(Vec::new());
    } else {
        // Inside a repository: run git log for this document.
    }
    let count = format!("-n{limit}");
    let format = format!("--format=%H{FIELD_SEPARATOR}%h{FIELD_SEPARATOR}%an{FIELD_SEPARATOR}%at{FIELD_SEPARATOR}%s");
    let output = git(&dir, &["log", "--follow", &count, &format, "--", &name])?;
    if output.status.success() {
        // Log succeeded: parse the commits.
        Ok(parse_log(&String::from_utf8_lossy(&output.stdout)))
    } else if failure(&output).contains("does not have any commits") {
        // The document exists but has no history yet.
        Ok(Vec::new())
    } else {
        // Any other git failure is reported to the caller.
        Err(failure(&output))
    }
}

/// @purpose Read a document as it was in a given commit (FR-11.11).
/// @inputs document_path: the full path to the document; hash: the target commit hash.
/// @outputs Ok(file text) when readable; Err on an invalid hash or git failure.
/// @dataflow Document path -> folder + name; "<hash>:./<name>" names the file relative to the folder git runs in -> `git show <spec>` with arguments passed directly (no shell) -> decoded text.
/// @controlflow An invalid hash is rejected before running git; a file renamed since that commit is not found under its current name and git's message says so.
pub fn file_at(document_path: &str, hash: &str) -> Result<String, String> {
    // Reject anything that cannot name a commit before touching git.
    if !is_commit_hash(hash) {
        return Err(format!("Invalid commit '{hash}'."));
    } else {
        // Valid hash: proceed to read the file from that commit.
    }
    let (dir, name) = split_path(document_path)?;
    let spec = format!("{hash}:./{name}");
    let output = git(&dir, &["show", &spec])?;
    if output.status.success() {
        // The file exists in that commit: decode it as UTF-8 text.
        String::from_utf8(output.stdout).map_err(|_| format!("The file in commit {hash} is not UTF-8 text."))
    } else {
        // git could not read the path (e.g. renamed): report its message.
        Err(failure(&output))
    }
}

/// @purpose Stage just the named file (FR-11.11).
/// @inputs document_path: the full path to the document.
/// @outputs Ok(()) on success; Err(git's message) on failure.
/// @dataflow Document path -> folder + name -> `git add -- <name>` with arguments passed directly (no shell) -> status.
/// @controlflow A successful exit stages the file; any other git failure is reported to the caller.
pub fn stage_file(document_path: &str) -> Result<(), String> {
    let (dir, name) = split_path(document_path)?;
    let output = git(&dir, &["add", "--", &name])?;
    if output.status.success() {
        // Staging succeeded.
        Ok(())
    } else {
        // git rejected the add: report its message.
        Err(failure(&output))
    }
}

/// @purpose Commit just the named file with a message (FR-11.11).
/// @inputs document_path: the full path to the document; message: the commit message.
/// @outputs Ok(short hash) of the new commit; Err on an empty message or git failure.
/// @dataflow Document path -> folder + name -> `git commit -m <message> -- <name>` with arguments passed directly (no shell) -> HEAD short hash.
/// @controlflow An empty message is rejected up front; the file is staged first so a new file can be committed; "-- name" commits only this file, whatever else is staged.
pub fn commit_file(document_path: &str, message: &str) -> Result<String, String> {
    // A commit requires a non-empty message.
    if message.trim().is_empty() {
        return Err("A commit needs a message.".to_string());
    } else {
        // Message present: stage the file before committing.
    }
    stage_file(document_path)?;
    let (dir, name) = split_path(document_path)?;
    let output = git(&dir, &["commit", "-m", message, "--", &name])?;
    if !output.status.success() {
        // Commit failed: report git's message.
        return Err(failure(&output));
    } else {
        // Commit succeeded: read back the new HEAD short hash.
    }
    let head = git(&dir, &["rev-parse", "--short", "HEAD"])?;
    if head.status.success() {
        // HEAD resolved: return its abbreviated form.
        Ok(stdout_text(&head))
    } else {
        // HEAD could not be read: report git's message.
        Err(failure(&head))
    }
}

/// @purpose Expose file_info over IPC (FR-11.11).
/// @inputs document_path: the full path to the document passed from the frontend.
/// @outputs Ok(Some(GitFileInfo)) or Ok(None) when not in git; Err(git's message) on failure.
/// @dataflow IPC string -> file_info -> serialized GitFileInfo over IPC.
/// @controlflow Delegates directly to file_info and returns its result unchanged.
#[tauri::command]
pub fn git_file_info(grants: tauri::State<'_, crate::grants::GrantState>, document_path: String) -> Result<Option<GitFileInfo>, String> {
    // Git runs only for a document the user chose.
    grants.require(&document_path)?;
    file_info(&document_path)
}

/// @purpose Expose file_log over IPC (FR-11.11).
/// @inputs document_path: the full path to the document passed from the frontend; limit: maximum number of commits to return.
/// @outputs Ok(Vec<GitCommit>) of recent commits; an empty list when not in git or with no history; Err(git's message) on failure.
/// @dataflow IPC strings -> file_log -> serialized GitCommit list over IPC.
/// @controlflow Delegates directly to file_log and returns its result unchanged.
#[tauri::command]
pub fn git_file_log(grants: tauri::State<'_, crate::grants::GrantState>, document_path: String, limit: u32) -> Result<Vec<GitCommit>, String> {
    // Git runs only for a document the user chose.
    grants.require(&document_path)?;
    file_log(&document_path, limit)
}

/// @purpose Expose file_at over IPC (FR-11.11).
/// @inputs document_path: the full path to the document passed from the frontend; hash: the target commit hash.
/// @outputs Ok(file text) when readable; Err on an invalid hash or git failure.
/// @dataflow IPC strings -> file_at -> decoded file text over IPC.
/// @controlflow Delegates directly to file_at and returns its result unchanged.
#[tauri::command]
pub fn git_file_at(grants: tauri::State<'_, crate::grants::GrantState>, document_path: String, hash: String) -> Result<String, String> {
    // Git runs only for a document the user chose.
    grants.require(&document_path)?;
    file_at(&document_path, &hash)
}

/// @purpose Expose stage_file over IPC (FR-11.11).
/// @inputs document_path: the full path to the document passed from the frontend.
/// @outputs Ok(()) on success; Err(git's message) on failure.
/// @dataflow IPC string -> stage_file -> status over IPC.
/// @controlflow Delegates directly to stage_file and returns its result unchanged.
#[tauri::command]
pub fn git_stage_file(grants: tauri::State<'_, crate::grants::GrantState>, document_path: String) -> Result<(), String> {
    // Git runs only for a document the user chose.
    grants.require(&document_path)?;
    stage_file(&document_path)
}

/// @purpose Expose commit_file over IPC (FR-11.11).
/// @inputs document_path: the full path to the document passed from the frontend; message: the commit message.
/// @outputs Ok(short hash) of the new commit; Err on an empty message or git failure.
/// @dataflow IPC strings -> commit_file -> short HEAD hash over IPC.
/// @controlflow Delegates directly to commit_file and returns its result unchanged.
#[tauri::command]
pub fn git_commit_file(grants: tauri::State<'_, crate::grants::GrantState>, document_path: String, message: String) -> Result<String, String> {
    // Git runs only for a document the user chose.
    grants.require(&document_path)?;
    commit_file(&document_path, &message)
}

#[cfg(test)]
#[path = "git_tests.rs"]
mod tests;
