//! @file pandoc.rs
//! @purpose Pandoc export (FR-13.7): when the system pandoc is on PATH, convert a Markdown document to LaTeX or EPUB by running it as an argument-taking process fed its document over stdin (never through a shell).
//! @inputs Document text, a target format ("latex" or "epub"), and an absolute output path; nothing for version.
//! @outputs The first line of `pandoc --version` when Pandoc is installed; exported files on disk from pandoc_export.
//! @functions
//!   - pandoc_argument: Validate that a proposed format names one K-Doc asks Pandoc for.
//!   - pandoc_command: Build the pandoc command with the no-console flag applied on Windows.
//!   - pandoc_version: Report whether Pandoc is installed and which version, empty when absent.
//!   - pandoc_export: Convert Markdown to LaTeX or EPUB through Pandoc over stdin/stdout.
//! @dataflow Document text -> `pandoc -f markdown -t <format> -o <path>` with arguments passed directly (no shell) and the document on stdin -> exported file; `pandoc --version` stdout first line for version.
//! @controlflow A missing Pandoc reads as "not installed" rather than an error; a rejected format or relative output path is refused before pandoc runs, so a document cannot ask Pandoc to read another format or write outside the chosen absolute location.
//! @version 1
//! @date 2026-09-18

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000; // Windows process creation flag so pandoc does not flash a console window.

/// The formats K-Doc asks Pandoc for. The webview names one of these and nothing else: a format is an argument to another program, so it is chosen from this list rather than passed through.
pub const PANDOC_FORMATS: [&str; 2] = ["latex", "epub"];

/// @purpose Validate that an export format names one K-Doc asks Pandoc for (FR-13.7).
/// @inputs format: the webview-proposed target format string.
/// @outputs Ok("latex") or Ok("epub") on an exact match; Err naming the rejected proposal otherwise.
/// @dataflow format -> compare against PANDOC_FORMATS entries in order -> matching name or error message.
/// @controlflow Match "latex" then "epub"; any other value is refused because a document cannot ask Pandoc for a format K-Doc does not request, and the same list guards both reading (input) and writing (output).
pub fn pandoc_argument(format: &str) -> Result<&'static str, String> {
    if format == PANDOC_FORMATS[0] {
        // The webview asked for LaTeX.
        Ok(PANDOC_FORMATS[0])
    } else if format == PANDOC_FORMATS[1] {
        // The webview asked for EPUB.
        Ok(PANDOC_FORMATS[1])
    } else {
        // Not a format K-Doc requests: refuse it before pandoc runs so the document cannot ask Pandoc to read or write another format.
        Err(format!("Rejected export format '{format}': K-Doc asks Pandoc only for latex or epub"))
    }
}

/// @purpose Build the pandoc command for a conversion (FR-13.7).
/// @inputs None; the input format and output path are attached by callers as arguments, not here.
/// @outputs A Command ready to run `pandoc`, with the no-console flag applied on Windows.
/// @dataflow () -> Command::new("pandoc") -> creation_flags(CREATE_NO_WINDOW) under cfg(windows) -> Command.
/// @controlflow Build pandoc and apply CREATE_NO_WINDOW exactly as git.rs does so it never flashes a console window; the command is returned without being run, since callers attach arguments per request.
fn pandoc_command() -> Command {
    let mut command = Command::new("pandoc");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// @purpose Report whether Pandoc is installed and which one (FR-13.7).
/// @inputs None.
/// @outputs The first line of `pandoc --version` when it runs successfully; an empty string when Pandoc cannot be launched or exits non-zero, which reads as "not installed" rather than an error.
/// @dataflow pandoc --version -> stdout bytes -> lossy UTF-8 decode -> first trimmed line -> String (empty when absent).
/// @controlflow A launch failure and a non-success exit both yield Ok("") so the reader treats Pandoc as simply not present; only a successful run returns its version banner's first line.
#[tauri::command]
pub async fn pandoc_version() -> Result<String, String> {
    match Command::new("pandoc").arg("--version").output() {
        // Pandoc could not be launched (e.g. not on PATH): report it as absent rather than an error.
        Err(_) => Ok(String::new()),
        Ok(output) => {
            if output.status.success() {
                // A successful run: take the first line of its version banner, trimmed.
                let banner = String::from_utf8_lossy(&output.stdout);
                match banner.lines().next() {
                    Some(first_line) => Ok(first_line.trim().to_string()),
                    None => Ok(String::new()),
                }
            } else {
                // Pandoc ran but exited non-zero: treat it as absent.
                Ok(String::new())
            }
        }
    }
}

/// @purpose Convert a Markdown document to LaTeX or EPUB through Pandoc (FR-13.7).
/// @inputs markdown: the source document text; format: the target format ("latex" or "epub"); path: an absolute output file path.
/// @outputs Ok(()) when Pandoc writes the file; Err on a rejected format, relative path, launch failure, unreadable answer, or non-zero exit carrying Pandoc's stderr.
/// @dataflow Document text -> stdin of `pandoc -f markdown -t <format> -o <path>` (arguments passed directly, no shell) -> exported file; stdout/status for success and stderr for the error message.
/// @controlflow Reject an unknown format and a relative output path before pandoc runs; feed the document via stdin so it is never written to a temp file; wait for Pandoc's answer and return its stderr on failure, or "Pandoc could not write the file." when that stderr was empty.
pub fn pandoc_write(markdown: &str, format: &str, path: &str) -> Result<(), String> {
    // Validate the requested format against K-Doc's fixed list before building anything else.
    let argument = pandoc_argument(format)?;
    // The output must be an absolute path so a relative proposal cannot write somewhere unexpected.
    if !Path::new(path).is_absolute() {
        return Err(format!("Rejected export path '{path}': path must be absolute"));
    } else {
        // Absolute path confirmed: proceed to build and run pandoc.
    }
    let mut command = pandoc_command();
    // The input format is fixed too, so a document cannot ask to be read as something other than Markdown.
    // --sandbox stops pandoc reading any file other than its input: an EPUB export would otherwise embed whatever
    // local files a document's images or metadata named, such as a private key.
    command.args(["--sandbox", "-f", "markdown", "-t", argument, "-o", path]);
    // Pipe all three streams: stdin carries the document, stdout/stderr carry its answer and diagnostics.
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|err| format!("Could not run pandoc: {err}"))?;
    // The stdin was piped, so it is Some; without writing the document and dropping that handle pandoc waits for input that never comes.
    let mut stdin = match child.stdin.take() {
        Some(handle) => handle,
        None => {
            // Pandoc gave no writable stdin: abort rather than hang waiting to feed it a document.
            let _ = child.kill();
            return Err("Pandoc did not accept the document.".to_string());
        }
    };
    // Write the whole document so pandoc sees complete input; ignore write errors, which wait_with_output surfaces via status/stderr below.
    let _write_result = stdin.write_all(markdown.as_bytes());
    // Dropping the handle closes stdin so pandoc reaches end of input and proceeds instead of blocking for more bytes.
    drop(stdin);
    let output = child.wait_with_output().map_err(|err| format!("Could not read pandoc's answer: {err}"))?;
    if !output.status.success() {
        // Pandoc failed to write the file: report its diagnostic, or a default when it printed nothing.
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if message.is_empty() {
            Err("Pandoc could not write the file.".to_string())
        } else {
            Err(message)
        }
    } else {
        // Pandoc exited successfully: the file was written.
        Ok(())
    }
}

/// @purpose Tauri IPC entry point for an export through Pandoc (FR-13.7).
/// @inputs markdown - the document's text; format - "latex" or "epub"; path - the absolute file to write.
/// @outputs Result<(), String> - Ok when Pandoc wrote the file, or the reason it did not.
/// @dataflow The three arguments are handed straight to pandoc_write, which does the work.
/// @controlflow None of its own: the command exists so the webview has something to invoke, and the work is in a
///   function a test can call.
#[tauri::command]
pub async fn pandoc_export(grants: tauri::State<'_, crate::grants::GrantState>, markdown: String, format: String, path: String) -> Result<(), String> {
    // Pandoc writes only where the user chose to save the export.
    grants.require(&path)?;
    pandoc_write(&markdown, &format, &path)
}

/// Unit tests, kept in a sibling file.
#[cfg(test)]
#[path = "pandoc_tests.rs"]
mod pandoc_tests;
