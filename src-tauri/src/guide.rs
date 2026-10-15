//! @file guide.rs
//! @purpose Locates K-Doc's bundled user guide inside the app resource folder, grants webview access to its whole tree so cross-page links can open, and returns an absolute path to its index. It also answers whether an arbitrary webview-requested path is one of the guide's files, stripping any Windows verbatim-path prefix that would otherwise make the grant store treat it as a network share.
//! @inputs Absolute paths requested by code running in the webview; the Tauri application handle used to resolve the resource directory and shared GrantState.
//! @outputs An absolute path string to the guide index from user_guide_path; boolean containment verdicts from is_inside/is_guide_file; normalised PathBuf values from plain_path/guide_dir/guide_index.
//! @functions
//!   - plain_path: Strips a Windows `\\?\` or `\\?\UNC\` verbatim prefix so the grant store treats the path as local, keeping real network shares intact.
//!   - guide_dir: Resolves and normalises the absolute directory that holds the bundled guide.
//!   - guide_index: Returns the index file's path when installed, else an error naming what was looked for.
//!   - is_inside: Tests whether a webview-requested path falls inside the guide using the shared grant containment rules.
//!   - is_guide_file: Resolves the live guide directory and applies is_inside to it.
//!   - user_guide_path: Grants the whole guide folder, then returns an absolute path to its index for the frontend to render.
//! @dataflow Webview request (str) -> normalise + key + is_within verdict; resource_dir -> plain_path -> guide dir -> grant_folder + guide_index -> returned index string.
//! @controlflow Resolve the resource directory and strip any verbatim prefix, confirm the index exists, then grant the folder so every page link opens; a relative or escaping request never counts as inside the guide.
//! @version 1
//! @date 2026-10-15

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime, State};
use crate::grants;

// Folder name (relative to the app resource directory) that holds K-Doc's bundled user guide.
pub const GUIDE_FOLDER: &str = "guide";
// File name of the guide's entry point inside GUIDE_FOLDER; its presence marks an installed guide.
pub const GUIDE_INDEX: &str = "index.md";

/// Strips a Windows verbatim-path prefix from `path` so the grant store treats it as local rather than network.
/// @purpose Resource folders on Windows can be returned with a leading `\\?\` (or `\\?\UNC\`) verbatim prefix; without stripping it, grants::key would classify the guide path as a network share and refuse to grant it. On other platforms — or for any ordinary local path — the input is returned unchanged.
/// @inputs path - The absolute resource directory joined with GUIDE_FOLDER, possibly carrying a Windows verbatim prefix.
/// @outputs PathBuf - The same path without any `\\?\` or `\\?\UNC\` prefix; on non-Windows builds and un-prefixed paths this equals the input unchanged.
/// @dataflow Path -> to_string_lossy() -> strip_prefix(`\\?\UNC\`) then strip_prefix(`\\?\`) -> PathBuf::from(rest) / original path returned verbatim.
/// @controlflow Materialise the lossy string, try stripping a verbatim UNC prefix first (re-anchoring with `\\` so it stays a network share), else try stripping an ordinary verbatim drive prefix; fall through to returning the input unchanged when neither matches.
pub fn plain_path(path: PathBuf) -> PathBuf {
    // Materialise as lossy text because both verbatim prefixes are pure ASCII and string operations are simplest on str.
    let text = path.to_string_lossy();

    // A `\\?\UNC\` prefix marks a real network share written in verbatim form; strip only the leading marker, keeping server\share so it remains an unambiguous UNC path once re-anchored with `\\`.
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        // Re-insert the double backslash that a real network share needs; this keeps the grant store treating it as one rather than dropping the share.
        return PathBuf::from(format!(r"\\{rest}"));
    }

    // A `\\?\` prefix marks an ordinary local path written in verbatim form (e.g. `\\?\C:\...`); drop just that marker, leaving the drive-relative remainder intact.
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        // The remaining string already names a normal absolute path once the prefix is gone; return it as-is without further processing.
        return PathBuf::from(rest);
    }

    // No verbatim prefix was present (an ordinary local path, or any non-Windows path): hand the original back unchanged so callers get exactly what they passed in.
    path
}

/// Resolves the on-disk directory that holds K-Doc's bundled user guide and normalises any Windows verbatim prefix off it.
/// @purpose The guide ships inside the app resource folder; resolving it lets commands hand the frontend an absolute path to read, while plain_path keeps a `\\?\`-prefixed result from being misread as a network share by the grant store.
/// @inputs app - The Tauri application handle used to locate the resource directory.
/// @outputs Option<PathBuf> - Some(normalised guide dir) when the resource folder resolves, None if it could not be located.
/// @dataflow AppHandle -> path().resource_dir() -> join(GUIDE_FOLDER) -> plain_path -> PathBuf (or None on resolution failure).
/// @controlflow Ask Tauri for the resource directory; only when it succeeds do we append GUIDE_FOLDER and strip any verbatim prefix, else propagate None.
pub fn guide_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    // Resolve the app's resource folder (where bundled resources live); a failure here means no installed files exist at all.
    let dir = app.path().resource_dir().ok()?;

    // Append GUIDE_FOLDER to reach the guide directory, then strip any Windows verbatim prefix so later grant keys treat it as local.
    Some(plain_path(dir.join(GUIDE_FOLDER)))
}

/// Returns the path of the guide's index file when the guide is installed on disk.
/// @purpose The presence of GUIDE_INDEX inside the resolved folder proves a complete, updatable copy was shipped; its absence means K-Doc should tell the user there is nothing to read rather than open a non-existent file.
/// @inputs dir - The absolute directory that may contain the guide (typically the result of guide_dir).
/// @outputs Result<PathBuf, String> - Ok(index path) when index.md exists as a regular file; Err naming what was looked for otherwise.
/// @dataflow dir -> join(GUIDE_INDEX) -> is_file() -> Ok(path) / Err("not installed ...").
/// @controlflow Build the candidate index path and test it with is_file (a real on-disk check, not a lexical one); return an informative error when that file is absent.
pub fn guide_index(dir: &Path) -> Result<PathBuf, String> {
    // The expected entry point sits directly inside the resolved guide folder under its fixed name.
    let index = dir.join(GUIDE_INDEX);

    // A regular-file test confirms a real, readable markdown file rather than an empty directory or missing path at that location.
    if index.is_file() {
        // The installed copy is present: hand back its absolute path for the frontend to render and open links against.
        Ok(index)
    } else {
        // No index.md on disk means K-Doc was not shipped with a guide; report exactly what we looked for so the failure is diagnosable.
        Err(format!("The user guide is not installed (looked for {}).", index.display()))
    }
}

/// Tests whether `path` falls inside the guide directory, using the shared grant containment rules.
/// @purpose Lets webview file commands treat any path within GUIDE_FOLDER as part of K-Doc's own documentation — and only that tree — so a page can safely open sibling pages or attachments without reaching into unrelated user files.
/// @inputs dir - The absolute guide directory to test against; path - An arbitrary filesystem path requested by code running in the webview.
/// @outputs bool - true when `path` normalises to something contained within `dir`; false for relative, escaping, or wholly external paths (including a None from grants::normalise).
/// @dataflow str -> grants::normalise() -> grants::key(path) + grants::key(dir) -> grants::is_within().
/// @controlflow Reject any path that cannot be normalised to an absolute location first; then delegate the containment verdict to the shared grant logic so guide and vault rules stay identical.
pub fn is_inside(dir: &Path, path: &str) -> bool {
    // A relative or escaping request can never belong to the guide, so refuse it before touching any comparison (grants::normalise returns None for such inputs).
    let Some(normal) = grants::normalise(path) else {
        // Not a normalisable absolute path: nothing inside the guide could have produced it, so reject outright.
        return false;
    };

    // Delegate to the shared grant containment test so an exact match or any nested child counts as "inside" while lookalike siblings do not.
    grants::is_within(&grants::key(&normal), &grants::key(dir))
}

/// Tests whether `path` is one of K-Doc's own guide files by resolving the live guide directory and applying containment against it.
/// @purpose Bridges a raw webview-requested path to the currently installed copy of the guide, so links between pages resolve correctly even after an update replaces the on-disk folder.
/// @inputs app - The Tauri application handle used to locate the resource directory; path - An arbitrary filesystem path requested by code running in the webview.
/// @outputs bool - true when a guide exists and `path` lies inside it; false when no guide is installed or the path falls outside that tree (including relative paths).
/// @dataflow AppHandle -> guide_dir() -> Some(dir) => is_inside(dir, path); None => false.
/// @controlflow Resolve the live guide directory once; branch on its presence so an absent guide never panics but simply denies every request.
pub fn is_guide_file<R: Runtime>(app: &AppHandle<R>, path: &str) -> bool {
    // Locate the currently installed guide folder, if any resource files are present at all.
    match guide_dir(app) {
        // A guide directory exists: apply containment to decide whether this request targets one of its pages.
        Some(dir) => is_inside(&dir, path),
        // No guide is installed (resource dir unresolved): deny every request rather than guessing a location.
        None => false,
    }
}

/// Grants webview access to the whole guide folder and returns an absolute path to its index for the frontend to render.
/// @purpose Opening K-Doc's documentation must also let links between pages open; granting the entire folder (not just the index) achieves that in one step, while returning the resolved index gives the frontend a concrete file to display first.
/// @inputs app - The Tauri application handle carrying shared GrantState and resource metadata.
/// @outputs Result<String, String> - Ok(absolute index path string) once granted; Err("Could not find K-Doc's installed files.") when no guide dir resolves, or the standard grant error if persisting fails.
/// @dataflow AppHandle -> guide_dir() -> grants.grant_folder(dir) + guide_index(dir) -> index.to_string_lossy().into_owned().
/// @controlflow Resolve then grant the folder first (so links open), confirm the index exists, and finally return its absolute path; any failure short-circuits with a descriptive string.
#[tauri::command]
pub fn user_guide_path<R: Runtime>(app: AppHandle<R>, grants: State<'_, grants::GrantState>) -> Result<String, String> {
    // Resolve the installed guide directory; without it there is nothing to grant or open, so fail fast with a clear message.
    let dir = guide_dir(&app).ok_or_else(|| "Could not find K-Doc's installed files.".to_string())?;

    // Granting the folder (not just the index) lets links between guide pages open from within the webview without re-asking each time.
    grants.grant_folder(&dir)?;

    // Confirm a complete, updatable copy is present before returning its path so the frontend never opens a non-existent file.
    let index = guide_index(&dir)?;

    // Hand back an owned absolute string for the webview to render as the entry point of K-Doc's documentation.
    Ok(index.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Creates a unique scratch directory under the system temp dir for a test, clearing any leftover from a previous run.
    /// @purpose Gives each test an isolated workspace so guide-resolution assertions do not collide across runs or between parallel tests.
    /// @inputs name - A short test identifier used to namespace the temporary directory.
    /// @outputs PathBuf - The path to the freshly created scratch directory.
    /// @dataflow temp_dir -> kdoc-guide-<name>-<pid> -> remove leftover -> create_dir_all -> returned dir.
    /// @controlflow Remove any pre-existing directory (ignore failure), then create a clean one; panics only on genuine creation failure via unwrap in tests.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kdoc-guide-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Strips a Windows verbatim drive prefix (`\\?\C:\...`) while leaving the remainder intact.
    /// @purpose Verifies plain_path collapses an ordinary local path written in verbatim form to its normal absolute spelling so the grant store treats it as local.
    /// @inputs None (uses a fixed sample path).
    /// @outputs () - Asserts equality between the transformed and expected paths.
    /// @dataflow r"\\?\C:\Program Files\K-Doc\guide" -> strip_prefix(`\\?\`) -> PathBuf::from(rest).
    /// @controlflow Call plain_path on a verbatim path and compare to its un-prefixed form; fail the test if they differ.
    #[test]
    fn strips_the_verbatim_prefix() {
        // A drive-letter path written with the leading `\\?\` marker must collapse to its ordinary absolute spelling.
        let got = plain_path(PathBuf::from(r"\\?\C:\Program Files\K-Doc\guide"));
        let want = PathBuf::from(r"C:\Program Files\K-Doc\guide");

        // The verbatim prefix is removed and the remainder is unchanged, so both are exactly equal.
        assert_eq!(got, want);
    }

    /// Keeps a real network share written in verbatim UNC form as an actual network path rather than dropping it to a local one.
    /// @purpose Ensures plain_path re-anchors `\\?\UNC\server\share` back to `\\server\share` so the grant store still recognises it as a share and refuses it, instead of mangling it into something local-looking.
    /// @inputs None (uses a fixed sample path).
    /// @outputs () - Asserts equality between the transformed and expected paths.
    /// @dataflow r"\\?\UNC\server\share\guide" -> strip_prefix(`\\?\UNC\`) -> PathBuf::from(format!(r"\\{rest}")).
    /// @controlflow Call plain_path on a verbatim UNC path and compare to the re-anchored `\\server\share` form; fail if they differ.
    #[test]
    fn keeps_a_verbatim_network_share_a_network_path() {
        // A network share in verbatim UNC form must be rewritten with its leading marker dropped but the share preserved as a real UNC path.
        let got = plain_path(PathBuf::from(r"\\?\UNC\server\share\guide"));
        let want = PathBuf::from(r"\\server\share\guide");

        // The `\\?\UNC` prefix is stripped and re-anchored with `\\`, leaving the server/share intact as a network path.
        assert_eq!(got, want);
    }

    /// Leaves an ordinary local path untouched when it carries no verbatim prefix at all.
    /// @purpose Guards against plain_path over-stripping: any path without a leading marker must come back exactly as given so normal resolution is unaffected.
    /// @inputs None (uses a fixed sample path).
    /// @outputs () - Asserts equality between the input and output paths.
    /// @dataflow r"C:\Users\me\guide" -> no prefix matches -> returned unchanged.
    /// @controlflow Call plain_path on an ordinary path and compare to itself; fail if anything was altered.
    #[test]
    fn leaves_an_ordinary_path_alone() {
        // A normal local path with no verbatim marker must be returned exactly as passed in, untouched.
        let got = plain_path(PathBuf::from(r"C:\Users\me\guide"));
        let want = PathBuf::from(r"C:\Users\me\guide");

        // No prefix was present so the input is handed back unchanged and byte-for-byte equal to the expectation.
        assert_eq!(got, want);
    }

    /// Returns the index path when a guide folder actually contains its index file on disk.
    /// @purpose Confirms guide_index detects an installed copy by checking for GUIDE_INDEX as a real regular file rather than assuming presence from the directory alone.
    /// @inputs None (builds a scratch dir with an index.md inside).
    /// @outputs () - Asserts equality between the returned path and the expected join.
    /// @dataflow scratch("index") + write(index.md) -> guide_index(dir) -> Ok(join(index.md)).
    /// @controlflow Create a directory, drop an index.md into it, then assert guide_index resolves to exactly that file; fail if absent or mismatched.
    #[test]
    fn finds_the_index_when_installed() {
        // A scratch folder containing the expected index file must be reported as installed at that exact location.
        let dir = scratch("index");
        fs::write(dir.join(GUIDE_INDEX), "# Guide").unwrap();

        // guide_index should resolve to the freshly written index.md inside this directory.
        assert_eq!(guide_index(&dir).unwrap(), dir.join(GUIDE_INDEX));
    }

    /// Reports a clear "not installed" error when the guide folder lacks its index file.
    /// @purpose Ensures commands surface an actionable failure (naming what was looked for) instead of panicking or returning a bogus path when K-Doc ships without documentation.
    /// @inputs None (builds an empty scratch dir).
    /// @outputs () - Asserts the error message mentions that the guide is not installed.
    /// @dataflow scratch("missing") -> guide_index(dir) -> Err(message containing "not installed").
    /// @controlflow Create a directory with no index.md, unwrap_err on guide_index, and check the message contains the expected phrase; fail otherwise.
    #[test]
    fn reports_a_missing_guide() {
        // A scratch folder without an index file must be reported as not-installed rather than resolved to a path.
        let dir = scratch("missing");

        // guide_index should reject this empty directory with an error naming the missing entry point.
        let err = guide_index(&dir).unwrap_err();

        // The message must tell the user the guide is absent so they can reinstall or locate it.
        assert!(err.contains("not installed"));
    }

    /// Recognises files that live directly inside, and nested within, the guide directory as part of the guide.
    /// @purpose Verifies containment accepts both immediate children (a page) and deeper descendants (inside a subfolder), matching how links between pages must resolve.
    /// @inputs None (builds an empty scratch dir used purely as the anchor).
    /// @outputs () - Asserts is_inside returns true for in-tree paths of varying depth.
    /// @dataflow scratch("inside") -> join(vaults.md) / join(sub/x.md) -> is_inside(dir, path) == true.
    /// @controlflow Build an absolute child and a nested descendant under the anchor dir, then assert both are recognised as inside; fail if either is rejected.
    #[test]
    fn recognises_files_inside_the_guide() {
        // The scratch directory acts as the guide root; files placed directly in it or beneath a subfolder must count as part of it.
        let dir = scratch("inside");

        // A page sitting directly inside the guide folder is unambiguously within its tree.
        assert!(is_inside(&dir, &dir.join("vaults.md").to_string_lossy()));

        // A file nested one level deeper still lies inside the same guide directory and must be recognised too.
        assert!(is_inside(&dir, &dir.join("sub").join("x.md").to_string_lossy()));
    }

    /// Does not claim files that live outside the guide — neither a sibling elsewhere on disk nor a relative path — as part of it.
    /// @purpose Guards containment against false positives: an unrelated file next to the guide and any non-absolute request must both be rejected so webview commands cannot reach into other locations via the guide check.
    /// @inputs None (builds a scratch dir whose parent hosts a sibling file).
    /// @outputs () - Asserts is_inside returns false for out-of-tree paths.
    /// @dataflow scratch("outside") + parent/other.md -> is_inside(dir, sibling) == false; is_inside(dir, "relative.md") == false.
    /// @controlflow Build a path in the parent directory and pass a bare relative string, then assert both are rejected as not-inside; fail if either slips through.
    #[test]
    fn does_not_claim_files_outside_it() {
        // The scratch directory is the guide root; its parent holds an unrelated file that must never be mistaken for part of the guide.
        let dir = scratch("outside");
        let sibling = dir.parent().unwrap().join("other.md");

        // A real file living beside (not inside) the guide folder lies outside its tree and must be denied.
        assert!(!is_inside(&dir, &sibling.to_string_lossy()));

        // A bare relative string cannot be normalised to an absolute location, so it is likewise rejected as not part of the guide.
        assert!(!is_inside(&dir, "relative.md"));
    }

    /// Recognises a page whose name differs only in case from the index, since Windows path matching is case-insensitive.
    /// @purpose Confirms containment honours OS-specific casing rules: on Windows an upper-cased guide file must still be treated as inside the (lower-cased) directory key produced by grants::key.
    /// @inputs None (builds a scratch dir and upper-cases its path).
    /// @outputs () - Asserts is_inside returns true for the case-folded path on Windows only.
    /// @dataflow scratch("case") -> join(Index.MD) to_uppercase() -> is_inside(dir, upper) == true (Windows).
    /// @controlflow Build an all-upper-case absolute guide file and assert it counts as inside; gated so non-Windows runners skip the case-insensitive expectation.
    #[cfg(windows)]
    #[test]
    fn matches_regardless_of_case() {
        // On Windows a guide page written in upper case must still resolve to the same files as its lower-cased form.
        let dir = scratch("case");
        let upper = dir.join("Index.MD").to_string_lossy().to_uppercase();

        // Case-insensitive matching means the fully-upper-case path is recognised as inside the guide directory.
        assert!(is_inside(&dir, &upper));
    }
}
