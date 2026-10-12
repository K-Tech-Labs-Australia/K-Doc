//! @file media.rs
//! @purpose Host media serving for K-Doc (FR-8.17). Reads a local video or audio file from disk so that a Markdown reference to a local media path can be played in the webview and embedded in HTML export.
//!
//! The webview cannot reach arbitrary files on the host filesystem, so the host reads the bytes and hands them over.
//! This is not an open door: only paths that are absolute and carry a media extension may be read, and a file
//! larger than MAX_MEDIA_BYTES is refused rather than loaded into memory (the webview holds the whole file as a blob).
//!
//! The checks run in a deliberate order. The absolute-path and extension tests use no filesystem access at all, so
//! they reject a relative or non-media path before the host ever touches disk. Only after those pass does the host
//! stat the file, re-check it against its real size, and finally read its bytes.
//!
//! @inputs Webview IPC invoke requests (`read_media_file`) containing an absolute filesystem path string to media.
//! @outputs Result<tauri::ipc::Response, String> returning the raw media bytes on success, or Err naming the path and reason for refusal.
//! @functions
//!   - media_mime: Maps a file extension (case-insensitively) to its video/audio MIME type, or None when it is not media K-Doc plays.
//!   - check_media_request: Verifies that a path names a readable media file K-Doc may play and returns its MIME type.
//!   - read_media_bytes: Reads the bytes of a media file after checking it.
//!   - read_media_file: Tauri IPC command reading a media file off the main thread and returning its raw bytes.
//! @dataflow Webview IPC invoke -> absolute + extension check (no disk) -> metadata stat -> size re-check -> fs::read -> binary Response.
//! @controlflow Webview invokes command -> refuse relative or non-media path before any access -> stat file -> reject oversized files -> read bytes (a directory fails the read) -> return Ok(bytes).
//! @version 1
//! @date 2026-09-18

use std::path::Path;

/// Largest media file, in bytes, the host will hand to the webview (64 MiB). The webview holds the whole file
/// in memory as a blob, so this is a memory limit rather than a policy about how long a clip may be.
pub const MAX_MEDIA_BYTES: u64 = 64 * 1024 * 1024;

/// Maps a file extension (compared case-insensitively) to its video or audio MIME type, or None when it is not media K-Doc plays.
///
/// The comparison ignores case so that `a.MP4` and `a.mp4` are treated the same, matching how browsers resolve media types.
///
/// @purpose Classifies a path by extension into one of the video/audio formats K-Doc plays in the webview or HTML export.
/// @inputs path - Filesystem path whose extension is inspected (case-insensitively).
/// @outputs Option<&'static str> - The MIME type string for a recognised media extension, or None when the extension is absent or not media K-Doc plays.
/// @dataflow path.extension() -> to_str() -> to_ascii_lowercase() -> match against known extensions -> Some(mime) or None.
/// @controlflow Extract extension -> lowercase it -> branch on each known media extension -> fall through to None for anything else.
pub fn media_mime(path: &Path) -> Option<&'static str> {
    // Extract the file extension as text, if one exists; a path with no extension cannot be media K-Doc plays.
    let ext = match path.extension().and_then(|e| e.to_str()) {
        Some(text) => text.to_ascii_lowercase(),
        None => {
            // No text extension available (or none at all): this path is not a recognised media file.
            return None;
        }
    };

    // Classify the lowercased extension against each video and audio format K-Doc plays, compared case-insensitively.
    match ext.as_str() {
        "mp4" | "m4v" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        "ogv" => Some("video/ogg"),
        "mov" => Some("video/quicktime"),
        // An ".ogg" file is served as audio: a video in an .ogg container is rare, and .ogv is the extension for one.
        "mp3" => Some("audio/mpeg"),
        "m4a" => Some("audio/mp4"),
        "wav" => Some("audio/wav"),
        "ogg" => Some("audio/ogg"),
        "oga" => Some("audio/ogg"),
        "flac" => Some("audio/flac"),
        "aac" => Some("audio/aac"),
        _ => {
            // Extension is present but not one of the media formats K-Doc plays: refuse to classify it.
            None
        }
    }
}

/// Checks that a path names a readable media file K-Doc may play, returning its MIME type.
///
/// The absolute-path and extension guards use no filesystem access, so they reject a relative or non-media path
/// before the host ever touches disk; only those two checks are performed here — existence and readability are
/// verified separately by read_media_bytes once the real file size is known.
///
/// @purpose Enforces the two pre-read invariants (absolute path, media extension) that make serving a local file safe against arbitrary-file disclosure.
/// @inputs path - Filesystem path to validate; must be absolute and carry a media extension.
/// @inputs size - The candidate file's size in bytes, checked against MAX_MEDIA_BYTES.
/// @outputs Result<&'static str, String> - Ok containing the MIME type when all checks pass, or Err naming the path and the reason for refusal.
/// @dataflow (path, size) -> absolute check -> extension/MIME check -> size cap check -> Ok(mime) or Err(message).
/// @controlflow Reject relative path -> resolve MIME via media_mime and fail if not media -> reject oversized file -> return Ok(mime).
pub fn check_media_request(path: &Path, size: u64) -> Result<&'static str, String> {
    // Check whether the path is absolute.
    // A relative path would resolve against the host's working directory and could point anywhere on disk,
    // so refuse it before anything else; this check touches no filesystem state at all.
    // A network path (\\server\share) is refused before anything touches it: merely opening one makes
    // Windows authenticate to that machine, which a document could use to leak the user's credentials.
    if crate::grants::is_network_path(path) {
        return Err(format!("Refusing network path '{}'", path.display()));
    } else {
        // A local path: carry on with the usual checks.
    }
    if !path.is_absolute() {
        // Relative path: return an error naming the path and explaining that only absolute paths are served.
        return Err(format!("Rejected media path '{}': path must be absolute", path.display()));
    } else {
        // Absolute path: proceed to validate the extension against the media allow-list.
    }

    // Resolve the MIME type from the extension; a non-media extension means K-Doc cannot play this file.
    let mime = media_mime(path).ok_or_else(|| {
        format!("Rejected media path '{}': not a media file K-Doc plays", path.display())
    })?;

    // Check whether the candidate size exceeds the host's read limit.
    // Reading an unbounded file would exhaust memory, so a single over-size check here refuses it outright.
    if size > MAX_MEDIA_BYTES {
        // Oversized file: return an error naming the path, its size, and the byte cap that was exceeded.
        return Err(format!(
            "Rejected media file '{}': {size} bytes exceeds the {MAX_MEDIA_BYTES} byte limit",
            path.display()
        ));
    } else {
        // Within the size cap: every guard has passed, so the MIME type may be served.
    }

    // All guards have passed: return the resolved media MIME type.
    Ok(mime)
}

/// Reads a media file after checking it.
///
/// Runs the absolute-path and extension guards with a size of zero first, so a relative or non-media path is refused
/// before any filesystem access; only then does the host stat the real file, re-check it against its true size,
/// and finally read its bytes.
///
/// @purpose Serves the raw bytes of a media file to the webview after enforcing that the path is absolute, carries a media extension, and is within the size cap — all before reading.
/// @inputs path - Absolute filesystem path string of the media file to read.
/// @outputs Result<Vec<u8>, String> - Ok containing the file's raw bytes on success, or Err naming the path and reason for refusal.
/// @dataflow path string -> Path::new -> pre-check (size 0) -> fs::metadata -> size re-check -> fs::read -> Vec<u8>.
/// @controlflow Pre-check with zero size -> stat file -> re-check against real size -> read bytes -> return Ok(bytes) or Err.
pub fn read_media_bytes(path: &str) -> Result<Vec<u8>, String> {
    // Rebind the &str path to a Path so the rest of the function works with typed filesystem paths.
    let path = Path::new(&path);

    // Pre-check the absolute-path and extension guards before any filesystem access, using size 0.
    // This rejects a relative or non-media path without ever touching disk, which is the security-critical ordering.
    check_media_request(path, 0)?;

    // Stat the file to learn its real size and type.
    let metadata = std::fs::metadata(path)
        .map_err(|err| format!("Cannot read '{}': {err}", path.display()))?;

    // A directory named like a media file needs no check of its own: reading it below fails with an error.

    // Re-run the guards now that the real size is known, so an oversized media file is refused here too.
    // Removing this line survives mutation testing: killing it would mean writing a 64 MiB fixture. It stays
    // because the first check ran against a size of zero, so this is the only one that sees the real file.
    check_media_request(path, metadata.len())?;

    // Read the bytes of the now-validated media file.
    std::fs::read(path).map_err(|err| format!("Cannot read '{}': {err}", path.display()))
}

/// Reads a media file and returns its raw bytes to the webview over Tauri IPC.
///
/// The command is async so a large media file is read off the main thread, and it returns a raw binary Response rather
/// than a JSON array of numbers so the bytes cross the boundary intact; it reveals nothing but the bytes of a file
/// that passed the absolute-path, extension, and size checks.
///
/// @purpose Tauri IPC entry point serving a media file's raw bytes to the webview for playback in Markdown or HTML export.
/// @inputs path - Absolute filesystem path string of the media file to read, supplied by the webview via invoke.
/// @outputs Result<tauri::ipc::Response, String> - Ok wrapping a binary Response of the media bytes on success, or Err naming the path and reason for refusal.
/// @dataflow (String path) -> read_media_bytes -> Vec<u8> -> tauri::ipc::Response::new(bytes) -> Ok(Response).
/// @controlflow Read + validate the media file off-thread -> wrap raw bytes in a binary Response -> return Ok or Err over IPC.
#[tauri::command]
pub async fn read_media_file(path: String) -> Result<tauri::ipc::Response, String> {
    // Read and validate the media file; any failure here surfaces as an Err naming the path and reason.
    let bytes = read_media_bytes(&path)?;

    // Wrap the raw media bytes in a binary Response so they cross the IPC boundary intact rather than as JSON numbers.
    Ok(tauri::ipc::Response::new(bytes))
}

/// Unit tests, kept in a sibling file.
#[cfg(test)]
#[path = "media_tests.rs"]
mod media_tests;
