//! @file access.rs
//! @purpose Tauri plugin exposing the only ways the webview can gain access to a file or folder — native pickers run by the host and an explicit allow prompt — each recording a grant in crate::grants::GrantState so later programmatic reads are permitted.
//! @inputs Webview-originated command calls (open/save/folder/access) carrying a kind, suggested name, or target path; the GrantState tracking which folders have been authorised.
//! @outputs Tauri commands returning either a chosen absolute path as text, an optional None on cancellation, or a boolean access verdict — always after recording a grant for the resolved folder.
//! @functions
//!   - save_filter: Chooses the export file-type filter from a suggested name's extension so HTML exports offer HTML rather than Markdown.
//!   - path_text: Renders a filesystem path to its lossy string form for display and command return values.
//!   - pick_open_file: Runs the native open-file picker for a kind, records a grant, returns the chosen path or None on cancel.
//!   - pick_save_path: Runs the native save-file picker seeded from a suggested name, records a grant, returns the chosen path or None on cancel.
//!   - pick_folder: Runs the native folder picker and records a folder grant for the selection.
//!   - request_file_access: Prompts to open an arbitrary link target, recording a grant only when the user allows it.
//! @dataflow Command argument (kind/suggested/path) -> dialog builder seeded with filter/directory/filename -> host-native blocking picker -> resolved PathBuf -> GrantState mutation -> absolute path text or boolean returned to webview.
//! @controlflow Each command builds and parents a dialog, optionally narrows it by filter or pre-fills directory/name, blocks on the native chooser, then records an access grant for the chosen folder before returning; cancellation yields None rather than erroring.
//! @version 1
//! @date 2026-10-07

use crate::grants::GrantState;
use std::path::{Path, PathBuf};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// One file-type filter: display name and extensions.
struct Filter {
    /// Human-readable label shown in the picker's type menu.
    name: &'static str,
    /// Lowercase extension tokens accepted by this filter (without leading dots).
    extensions: &'static [&'static str],
}

/// Markdown-family export filter (.md / .markdown / .mdx).
const MARKDOWN: Filter = Filter {
    name: "Markdown",
    extensions: &["md", "markdown", "mdx"],
};

/// Broad document-import filter covering common editable formats.
const IMPORT: Filter = Filter {
    name: "Documents",
    extensions: &["docx", "html", "htm", "rtf", "txt"],
};

/// Chooses the save filter from the suggested name's extension, so exporting HTML offers HTML, not Markdown.
/// @purpose Maps a suggested filename to an export file-type filter matching its extension.
/// @inputs suggested - The candidate output path or filename whose extension selects the filter.
/// @outputs Option<(&'static str, &'static [&'static str])> Some((label, extensions)) for a recognised type, None when no filter applies so the dialog picks a default name.
/// @dataflow Suggested string -> Path::extension() lowercased -> match on extension token -> matching Filter tuple or None.
/// @controlflow Extract and lowercase the extension; match against known types with an early None fall-through for anything unrecognised.
pub fn save_filter(suggested: &str) -> Option<(&'static str, &'static [&'static str])> {
    // Lowercase the suggested name's extension (if any) so matching is case-insensitive; a missing extension yields None.
    let ext = Path::new(suggested)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());

    // Match the lowercased extension to choose an export filter that matches it.
    match ext.as_deref() {
        // Markdown-family extensions are exported as Markdown documents.
        Some("md" | "markdown" | "mdx") => Some(("Markdown", &["md", "markdown", "mdx"])),
        // HTML-family extensions (case-insensitive) are exported as HTML, not Markdown.
        Some("html" | "htm") => Some(("HTML", &["html", "htm"])),
        // Word documents keep their .docx extension on export.
        Some("docx") => Some(("Word document", &["docx"])),
        // LaTeX source is exported with a .tex filter.
        Some("tex") => Some(("LaTeX", &["tex"])),
        // EPUB e-books are exported with an .epub filter.
        Some("epub") => Some(("EPUB", &["epub"])),
        // Stylesheets keep their .css extension on export.
        Some("css") => Some(("CSS", &["css"])),
        // Any other or missing extension: no matching filter, let the dialog pick a default name.
        _ => None,
    }
}

/// Renders a filesystem path to its lossy string form for display and command return values.
/// @purpose Converts a Path into an owned String tolerating non-UTF8 input.
/// @inputs path - The filesystem path to render.
/// @outputs String - A lossy UTF-8 representation of the path suitable for dialogs and webview communication.
/// @dataflow Path -> to_string_lossy() -> into_owned().
/// @controlflow Single transformation with no branching; always succeeds.
fn path_text(path: &Path) -> String {
    // Lossy conversion keeps the command contract total even on exotic filesystem encodings.
    path.to_string_lossy().into_owned()
}

/// Runs the native open-file picker for a kind, records a grant, and returns the chosen path or None on cancel.
/// @purpose Lets the webview choose an existing file through the host OS chooser while recording access consent.
/// @inputs window - The parent WebviewWindow anchoring the dialog; state - GrantState capturing the resulting permission; kind - "markdown" or "import", any other value is rejected.
/// @outputs Result<Option<String>, String> Ok(Some(path)) on selection, Ok(None) if cancelled, Err when the kind is unknown or the path cannot be resolved.
/// @dataflow Kind -> filter lookup -> dialog seeded with that filter -> blocking_pick_file() -> PathBuf -> grant_file(folder) -> absolute path text.
/// @controlflow Select a filter from kind (early error on unknown kinds); block on the picker; None is treated as cancellation rather than failure; Some records a grant before returning.
#[tauri::command]
pub async fn pick_open_file(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, GrantState>,
    kind: String,
) -> Result<Option<String>, String> {
    // Select the file-type filter from the requested kind, rejecting any unknown kind rather than guessing.
    let filter = match kind.as_str() {
        // Markdown export uses the markdown extension filter.
        "markdown" => MARKDOWN,
        // Importing external documents uses the broader document filter.
        "import" => IMPORT,
        // Any other kind is a programming error: report it instead of opening an unfiltered picker.
        _ => return Err(format!("Unknown file kind: {kind}")),
    };

    // Build and parent the native open-file dialog narrowed to the chosen filter type.
    let picked = window
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter(filter.name, filter.extensions)
        .blocking_pick_file();

    // Interpret the picker result: cancellation is not an error and records no grant.
    match picked {
        // The user cancelled: report no path without recording a grant or raising an error.
        None => Ok(None),
        // A file was chosen: record the access grant for its folder before returning the path text.
        Some(fp) => {
            let path: PathBuf = fp.into_path().map_err(|e| e.to_string())?;

            // Recording a grant on the containing folder authorises subsequent programmatic reads of this file.
            state.grant_file(&path)?;
            Ok(Some(path_text(&path)))
        }
    }
}

/// Runs the native save-file picker seeded from a suggested name, records a grant, and returns the chosen path or None on cancel.
/// @purpose Lets the webview choose an output location through the host OS chooser while recording access consent.
/// @inputs window - The parent WebviewWindow anchoring the dialog; state - GrantState capturing the resulting permission; suggested - A candidate filename or full path used to seed the filter, directory, and file-name field.
/// @outputs Result<Option<String>, String> Ok(Some(path)) on selection, Ok(None) if cancelled, Err only when the chosen path cannot be resolved (the dialog itself never fails).
/// @dataflow Suggested name -> save_filter() + parent/file_name seeding -> blocking_save_file() -> PathBuf -> grant_file(folder) -> absolute path text.
/// @controlflow Seed the builder conditionally by extension and absoluteness; block on the picker; None is cancellation rather than failure; Some records a grant before returning.
#[tauri::command]
pub async fn pick_save_path(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, GrantState>,
    suggested: String,
) -> Result<Option<String>, String> {
    // Start the native save-file dialog parented to the main window.
    let mut builder = window.dialog().file().set_parent(&window);

    // When the suggested name has a recognised extension, constrain the picker to that file type so exports keep their format.
    if let Some((name, exts)) = save_filter(&suggested) {
        // A matching filter exists: apply it to narrow the choices shown in the dialog.
        builder = builder.add_filter(name, exts);
    }

    // Inspect the suggested path so we can seed the dialog with its directory and filename when possible.
    let suggested_path = Path::new(&suggested);

    // Only a fully-qualified suggestion carries a real parent directory to pre-fill; relative names have no meaningful folder.
    if suggested_path.is_absolute() {
        // The suggestion is absolute: use its containing directory as the dialog's starting location.
        if let Some(dir) = suggested_path.parent() {
            // A parent exists for an absolute path (except root): set it as the initial directory.
            builder = builder.set_directory(dir);
        }
    }

    // If the suggestion names a file, pre-fill that filename so the user edits rather than retypes it.
    if let Some(file_name) = suggested_path.file_name() {
        // A file name is present: seed the dialog's text field with it (lossy to tolerate non-UTF8 input).
        builder = builder.set_file_name(file_name.to_string_lossy());
    }

    // Run the native save-file picker; cancellation returns None and is not an error.
    match builder.blocking_save_file() {
        // The user cancelled: report no path without recording a grant or raising an error.
        None => Ok(None),
        // A target was chosen: record the access grant for its folder before returning the path text.
        Some(fp) => {
            let path = fp.into_path().map_err(|e| e.to_string())?;

            // Recording a grant on the containing folder authorises subsequent programmatic writes to this file.
            state.grant_file(&path)?;
            Ok(Some(path_text(&path)))
        }
    }
}

/// Runs the native folder picker and records an access grant for the selection.
/// @purpose Lets the webview choose a whole directory through the host OS chooser, recording consent for that folder's subtree.
/// @inputs window - The parent WebviewWindow anchoring the dialog; state - GrantState capturing the resulting permission.
/// @outputs Result<Option<String>, String> Ok(Some(path)) on selection, Ok(None) if cancelled, Err only when the chosen path cannot be resolved (the dialog itself never fails).
/// @dataflow Native folder chooser -> PathBuf -> grant_folder(folder) -> absolute path text returned to webview.
/// @controlflow Block on the picker; None is cancellation rather than failure; Some records a folder grant before returning so later reads within it are permitted.
#[tauri::command]
pub async fn pick_folder(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, GrantState>,
) -> Result<Option<String>, String> {
    // Run the native folder chooser parented to the main window.
    let picked = window.dialog().file().set_parent(&window).blocking_pick_folder();

    // Interpret the picker result: cancellation is not an error and records no grant.
    match picked {
        // The user cancelled: report no path without recording a grant or raising an error.
        None => Ok(None),
        // A folder was chosen: record its access grant before returning the path text so reads within it are permitted.
        Some(fp) => {
            let path = fp.into_path().map_err(|e| e.to_string())?;

            // Recording a folder grant authorises subsequent programmatic traversal of this directory subtree.
            state.grant_folder(&path)?;
            Ok(Some(path_text(&path)))
        }
    }
}

/// Prompts to open an arbitrary link target, recording a grant only when the user allows it.
/// @purpose Provides an explicit consent path for files reached via links rather than through a picker, so nothing opens without host authorisation.
/// @inputs window - The parent WebviewWindow anchoring the prompt; state - GrantState capturing the resulting permission if allowed; path - The link target's raw filesystem path string.
/// @outputs Result<bool, String> true when access is granted (and a grant recorded), false on refusal, Err only when the path is not absolute or granting fails.
/// @dataflow Raw path -> normalise() -> allows() check -> optional consent prompt -> grant_file(folder) -> boolean verdict returned to webview.
/// @controlflow Reject non-absolute paths first; short-circuit with Ok(true) for already-granted targets; otherwise show a warning prompt and record the grant only on allow so refusal stays silent.
#[tauri::command]
pub async fn request_file_access(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, GrantState>,
    path: String,
) -> Result<bool, String> {
    // Reject anything that is not an absolute filesystem path before it can influence the dialog or grant store.
    let normalised = crate::grants::normalise(&path)
        .ok_or_else(|| format!("Not an absolute path: {path}"))?;

    // If this folder was already authorised, skip prompting and report success directly.
    if state.allows(&path) {
        // Access is already granted for the target's folder: confirm without another prompt.
        return Ok(true);
    }

    // Explain to the user that a link requested access and that only files they choose are opened, then ask for consent.
    let message = format!(
        "A link asks K-Doc to open this file:\n\n{}\n\nK-Doc only opens files you have chosen. Open this one?",
        path_text(&normalised)
    );

    // Show a warning prompt with custom labels; the parent window keeps modal focus on the app rather than the browser chrome.
    let allowed = window
        .dialog()
        .message(message)
        .title("Allow access?")
        .kind(MessageDialogKind::Warning)
        .buttons(
            MessageDialogButtons::OkCancelCustom("Open".to_string(), "Cancel".to_string()),
        )
        // Prefer the standard parent setter; fall back to omitting it only if a builder variant lacks one.
        .parent(&window)
        .blocking_show();

    // Record the grant for the chosen folder only when the user allows, so refusal leaves no lasting permission behind.
    if allowed {
        // Consent given: persist access for the target's folder before reporting success.
        state.grant_file(&normalised)?;
    }

    // Return the verdict regardless of whether a grant was recorded on allow or nothing on refuse.
    Ok(allowed)
}

#[cfg(test)]
mod tests {
    use super::save_filter;

    /// A .md suggestion selects the Markdown filter with its three accepted extensions.
    #[test]
    fn markdown_extension_selects_markdown_filter() {
        assert_eq!(save_filter("x.md").map(|(name, _)| name), Some("Markdown"));
    }

    /// An uppercase .HTML extension still selects the HTML filter, proving case-insensitive matching.
    #[test]
    fn html_extension_selects_html_filter() {
        assert_eq!(save_filter("C:/out/Report.HTML").map(|(name, _)| name), Some("HTML"));
    }

    /// A .docx suggestion selects the Word document filter.
    #[test]
    fn docx_extension_selects_word_document_filter() {
        assert_eq!(save_filter("a.docx").map(|(name, _)| name), Some("Word document"));
    }

    /// A .tex suggestion selects the LaTeX filter.
    #[test]
    fn tex_extension_selects_latex_filter() {
        assert_eq!(save_filter("a.tex").map(|(name, _)| name), Some("LaTeX"));
    }

    /// An .epub suggestion selects the EPUB filter.
    #[test]
    fn epub_extension_selects_epub_filter() {
        assert_eq!(save_filter("a.epub").map(|(name, _)| name), Some("EPUB"));
    }

    /// A .css suggestion selects the CSS filter.
    #[test]
    fn css_extension_selects_css_filter() {
        assert_eq!(save_filter("theme.css").map(|(name, _)| name), Some("CSS"));
    }

    /// A name with no extension matches no filter and returns None so the dialog picks a default name.
    #[test]
    fn missing_extension_returns_none() {
        assert_eq!(save_filter("notes"), None);
    }

    /// An unrecognised executable extension matches no filter and returns None.
    #[test]
    fn unknown_extension_returns_none() {
        assert_eq!(save_filter("a.exe"), None);
    }
}
