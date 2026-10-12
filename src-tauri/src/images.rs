//! @file images.rs
//! @purpose Host image serving for K-Doc (FR-8.14, FR-13.1). Reads a local image file from disk so that a Markdown image with a local path can be shown in the webview and embedded in HTML export.
//!
//! The webview cannot reach arbitrary files on the host filesystem, so the host reads the bytes and hands them over.
//! This is not an open door: only paths that are absolute and carry an image extension may be read, and a file
//! larger than MAX_IMAGE_BYTES is refused rather than loaded into memory.
//!
//! The checks run in a deliberate order. The absolute-path and extension tests use no filesystem access at all, so
//! they reject a relative or non-image path before the host ever touches disk. Only after those pass does the host
//! stat the file, re-check it against its real size, and finally read its bytes.
//!
//! @inputs Webview IPC invoke requests (`read_image_file`) containing an absolute filesystem path string to an image.
//! @outputs Result<tauri::ipc::Response, String> returning the raw image bytes on success, or Err naming the path and reason for refusal.
//! @functions
//!   - image_mime: Maps a file extension (case-insensitively) to its image MIME type, or None when it is not an image K-Doc shows.
//!   - check_image_request: Verifies that a path names a readable image K-Doc may show and returns its MIME type.
//!   - read_image_bytes: Reads the bytes of an image file after checking it.
//!   - read_image_file: Tauri IPC command reading an image file off the main thread and returning its raw bytes.
//! @dataflow Webview IPC invoke -> absolute + extension check (no disk) -> metadata stat -> size re-check -> fs::read -> binary Response.
//! @controlflow Webview invokes command -> refuse relative or non-image path before any access -> stat file -> reject oversized files -> read bytes (a directory fails the read) -> return Ok(bytes).
//! @version 1
//! @date 2026-09-14

use std::path::Path;

/// Largest image, in bytes, the host will hand to the webview (25 MiB); a larger file is refused rather than read.
pub const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;

/// Maps a file extension (compared case-insensitively) to its image MIME type, or None when it is not an image K-Doc shows.
///
/// The comparison ignores case so that `a.PNG` and `a.png` are treated the same, matching how browsers resolve image types.
///
/// @purpose Classifies a path by extension into one of the image formats K-Doc renders in the webview or HTML export.
/// @inputs path - Filesystem path whose extension is inspected (case-insensitively).
/// @outputs Option<&'static str> - The MIME type string for a recognised image extension, or None when the extension is absent or not an image K-Doc shows.
/// @dataflow path.extension() -> to_str() -> to_ascii_lowercase() -> match against known extensions -> Some(mime) or None.
/// @controlflow Extract extension -> lowercase it -> branch on each known image extension -> fall through to None for anything else.
pub fn image_mime(path: &Path) -> Option<&'static str> {
    // Extract the file extension as text, if one exists; a path with no extension cannot be an image.
    let ext = match path.extension().and_then(|e| e.to_str()) {
        Some(text) => text.to_ascii_lowercase(),
        None => {
            // No text extension available (or none at all): this path is not a recognised image.
            return None;
        }
    };

    // Classify the lowercased extension against each image format K-Doc renders, compared case-insensitively.
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        "avif" => Some("image/avif"),
        _ => {
            // Extension is present but not one of the image formats K-Doc shows: refuse to classify it.
            None
        }
    }
}

/// Checks that a path names a readable image K-Doc may show, returning its MIME type.
///
/// The absolute-path and extension guards use no filesystem access, so they reject a relative or non-image path
/// before the host ever touches disk; only those two checks are performed here — existence and readability are
/// verified separately by read_image_bytes once the real file size is known.
///
/// @purpose Enforces the two pre-read invariants (absolute path, image extension) that make serving a local file safe against arbitrary-file disclosure.
/// @inputs path - Filesystem path to validate; must be absolute and carry an image extension.
/// @inputs size - The candidate file's size in bytes, checked against MAX_IMAGE_BYTES.
/// @outputs Result<&'static str, String> - Ok containing the MIME type when all checks pass, or Err naming the path and the reason for refusal.
/// @dataflow (path, size) -> absolute check -> extension/MIME check -> size cap check -> Ok(mime) or Err(message).
/// @controlflow Reject relative path -> resolve MIME via image_mime and fail if not an image -> reject oversized file -> return Ok(mime).
pub fn check_image_request(path: &Path, size: u64) -> Result<&'static str, String> {
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
        return Err(format!("'{}' is not an absolute path", path.display()));
    } else {
        // Absolute path: proceed to validate the extension against the image allow-list.
    }

    // Resolve the MIME type from the extension; a non-image extension means K-Doc cannot show this file.
    let mime = image_mime(path).ok_or_else(|| {
        format!("'{}' is not an image K-Doc can show", path.display())
    })?;

    // Check whether the candidate size exceeds the host's read limit.
    // Reading an unbounded file would exhaust memory, so a single over-size check here refuses it outright.
    if size > MAX_IMAGE_BYTES {
        // Oversized file: return an error naming the path, its size, and the byte cap that was exceeded.
        return Err(format!(
            "'{}' is {size} bytes; images over {MAX_IMAGE_BYTES} bytes are not shown",
            path.display()
        ));
    } else {
        // Within the size cap: every guard has passed, so the MIME type may be served.
    }

    // All guards have passed: return the resolved image MIME type.
    Ok(mime)
}

/// Reads an image file after checking it.
///
/// Runs the absolute-path and extension guards with a size of zero first, so a relative or non-image path is refused
/// before any filesystem access; only then does the host stat the real file, re-check it
/// against its true size, and finally read its bytes.
///
/// @purpose Serves the raw bytes of an image to the webview after enforcing that the path is absolute, carries an image extension, and is within the size cap — all before reading.
/// @inputs path - Absolute filesystem path string of the image file to read.
/// @outputs Result<Vec<u8>, String> - Ok containing the file's raw bytes on success, or Err naming the path and reason for refusal.
/// @dataflow path string -> Path::new -> pre-check (size 0) -> fs::metadata -> size re-check -> fs::read -> Vec<u8>.
/// @controlflow Pre-check with zero size -> stat file -> re-check against real size -> read bytes -> return Ok(bytes) or Err.
pub fn read_image_bytes(path: &str) -> Result<Vec<u8>, String> {
    // Rebind the &str path to a Path so the rest of the function works with typed filesystem paths.
    let path = Path::new(&path);

    // Pre-check the absolute-path and extension guards before any filesystem access, using size 0.
    // This rejects a relative or non-image path without ever touching disk, which is the security-critical ordering.
    check_image_request(path, 0)?;

    // Stat the file to learn its real size and type.
    let metadata = std::fs::metadata(path)
        .map_err(|err| format!("Cannot read '{}': {err}", path.display()))?;

    // A directory named like an image needs no check of its own: reading it below fails with an error.

    // Re-run the guards now that the real size is known, so an oversized image is refused here too.
    check_image_request(path, metadata.len())?;

    // Read the bytes of the now-validated image file.
    std::fs::read(path).map_err(|err| format!("Cannot read '{}': {err}", path.display()))
}

/// Reads an image file and returns its raw bytes to the webview over Tauri IPC.
///
/// The command is async so a large image is read off the main thread, and it returns a raw binary Response rather
/// than a JSON array of numbers so the bytes cross the boundary intact; it reveals nothing but the bytes of a file
/// that passed the absolute-path, extension, and size checks.
///
/// @purpose Tauri IPC entry point serving an image's raw bytes to the webview for display in Markdown or HTML export.
/// @inputs path - Absolute filesystem path string of the image file to read, supplied by the webview via invoke.
/// @outputs Result<tauri::ipc::Response, String> - Ok wrapping a binary Response of the image bytes on success, or Err naming the path and reason for refusal.
/// @dataflow (String path) -> read_image_bytes -> Vec<u8> -> tauri::ipc::Response::new(bytes) -> Ok(Response).
/// @controlflow Read + validate the image off-thread -> wrap raw bytes in a binary Response -> return Ok or Err over IPC.
#[tauri::command]
pub async fn read_image_file(path: String) -> Result<tauri::ipc::Response, String> {
    // Read and validate the image file; any failure here surfaces as an Err naming the path and reason.
    let bytes = read_image_bytes(&path)?;

    // Wrap the raw image bytes in a binary Response so they cross the IPC boundary intact rather than as JSON numbers.
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TEST_COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// Generates a per-test unique temporary directory path and creates it with create_dir_all.
    ///
    /// @purpose Creates an isolated temporary directory for test filesystem operations.
    /// @inputs name - Descriptor for the test to include in the folder name.
    /// @outputs std::path::PathBuf - Path to the created directory.
    /// @dataflow Process ID + Atomic counter + test name -> unique folder path -> create_dir_all -> PathBuf.
    /// @controlflow Fetch-add counter -> construct path under temp_dir() -> create directory -> return PathBuf.
    fn unique_temp_dir(name: &str) -> std::path::PathBuf {
        let count = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "kdoc-images-{}-{}-{name}",
            std::process::id(),
            count
        ));
        std::fs::create_dir_all(&dir).expect("creating unique test directory should succeed");
        dir
    }

    /// Confirms that each recognised image extension maps to its MIME type regardless of case, and that a text file or no extension is not an image.
    #[test]
    fn image_mime_recognises_image_extensions_in_any_case() {
        assert_eq!(image_mime(Path::new("a.PNG")), Some("image/png"));
        assert_eq!(image_mime(Path::new("b.jpeg")), Some("image/jpeg"));
        assert_eq!(image_mime(Path::new("c.svg")), Some("image/svg+xml"));
        assert_eq!(image_mime(Path::new("d.txt")), None);
        assert_eq!(image_mime(Path::new("noext")), None);
    }

    /// Confirms that a relative path is refused regardless of its extension, before any filesystem access.
    #[test]
    fn check_refuses_a_relative_path() {
        assert!(check_image_request(Path::new("a.png"), 1).is_err());
    }

    /// Confirms that an absolute path with a non-image extension is refused even though no file needs to exist for this check.
    #[test]
    fn check_refuses_a_non_image() {
        let dir = unique_temp_dir("nonimage");

        // A .md extension is not one of the image formats K-Doc shows, so the request is refused.
        assert!(check_image_request(&dir.join("notes.md"), 1).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Confirms that a size one byte over the cap is refused while exactly the cap is accepted and returns the image MIME type.
    #[test]
    fn check_refuses_an_oversized_image_and_accepts_the_limit() {
        let dir = unique_temp_dir("oversized");
        let big = dir.join("big.png");

        // One byte over the limit must be refused outright.
        assert!(check_image_request(&big, MAX_IMAGE_BYTES + 1).is_err());

        // Exactly at the limit must be accepted and return the image MIME type.
        assert_eq!(check_image_request(&big, MAX_IMAGE_BYTES), Ok("image/png"));

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Confirms that a real image file returns exactly the bytes written to it.
    #[test]
    fn read_returns_the_bytes_of_an_image() {
        let dir = unique_temp_dir("read_image");
        let file = dir.join("a.png");
        std::fs::write(&file, b"\x89PNG").expect("writing test image should succeed");

        // The returned bytes must be exactly the bytes written, no more and no less.
        assert_eq!(
            read_image_bytes(file.to_str().expect("valid utf-8 path")),
            Ok(b"\x89PNG".to_vec())
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Confirms that a real, readable file with a non-image extension is still refused.
    #[test]
    fn read_refuses_a_text_file_even_when_it_exists() {
        let dir = unique_temp_dir("text_file");
        let file = dir.join("secret.txt");
        std::fs::write(&file, b"top secret").expect("writing test text file should succeed");

        assert!(read_image_bytes(file.to_str().expect("valid utf-8 path")).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Confirms that a directory whose name ends in an image extension is refused because it is not a regular file.
    #[test]
    fn read_refuses_a_directory_named_like_an_image() {
        let dir = unique_temp_dir("directory");
        // The directory exists on disk, but it is not a regular file and must be rejected, which the read itself does.
        let folder = dir.join("folder.png");
        std::fs::create_dir_all(&folder).expect("creating test directory should succeed");

        assert!(read_image_bytes(folder.to_str().expect("valid utf-8 path")).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Confirms that a valid image extension with no file on disk is reported as an error.
    #[test]
    fn read_reports_a_missing_image() {
        let dir = unique_temp_dir("missing");
        let missing = dir.join("gone.png");

        assert!(read_image_bytes(missing.to_str().expect("valid utf-8 path")).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }
}
