//! @file links.rs
//! @purpose Host link-opening operations for K-Doc (FR-8.13). Provides a single Tauri IPC command,
//! open_external_url, that hands a validated web or mail URL to the operating system's default handler.
//!
//! Opening a link is the host's to do because neither the filesystem nor the network can be launched
//! from inside the webview without first going through something that interprets the string — and that
//! interpreter is exactly where a `javascript:` or `file:` scheme becomes an execution path rather than
//! a navigation. This command exists to keep that interpreter behind a strict allow-list: only http, https
//! and mailto are ever handed to it, and every rejection names the offending URL so the failure is debuggable.
//!
//! @inputs Webview IPC invoke requests (`open_external_url`) containing a single URL string.
//! @outputs Result<(), String> — Ok(()) when the OS handler was launched, or Err naming the (truncated) URL and reason.
//! @functions
//!   - validate_external_url: Rejects empty, over-long, control-character-laden, or non-web/mail URLs before any OS handler is contacted.
//!   - open_external_url: Tauri command that validates a URL then launches it with the platform's default handler.
//!   - truncate_url: Shortens a URL for display in an error message so IPC payloads stay bounded.
//! @dataflow Webview IPC invoke -> validate_external_url (six guards) -> platform-specific Command spawn -> Result over IPC.
//! @controlflow Validate first and early-return on any failing guard -> branch on target OS to pick the launcher -> spawn -> return Ok(()) or map launch failure to Err.
//! @version 1
//! @date 2026-09-13

/// Validates that a URL string is safe to hand to the operating system's default handler.
///
/// This is the first line of defence behind the webview's own link handling: this command runs with the
/// user's full permissions, so a `javascript:` or `file:` scheme handed straight to the OS would be an
/// execution path rather than a navigation. Every rejection names the offending URL so the message is
/// useful, but truncates it so a very long input cannot bloat the IPC payload.
///
/// @purpose Rejects empty, over-long, control-character-laden, or non-web/mail URLs before any OS handler is contacted.
/// @inputs url - The candidate URL string as received from the webview via open_external_url.
/// @outputs Result<(), String> - Ok(()) when the URL passes every guard, or Err naming the (truncated) URL and reason.
/// @dataflow url -> empty check -> byte-length check -> control/whitespace scan -> scheme allow-list -> per-scheme content checks -> Result.
/// @controlflow Early-return on each failing guard in order; only a URL passing all six guards reaches Ok(()).
pub fn validate_external_url(url: &str) -> Result<(), String> {
    // Guard 1: an empty string names nothing and must never reach the OS handler.
    if url.is_empty() {
        // Branch: empty — there is no link to open, refuse immediately without further checks.
        return Err(format!("Cannot open '{}': URL is empty", truncate_url(url)));
    } else {
        // Branch: non-empty — proceed to the byte-length guard.
    }

    // Guard 2: cap the input so a malformed or hostile payload cannot exhaust memory downstream.
    if url.len() > 8192 {
        // Branch: over long — refuse before doing anything else with it.
        return Err(format!("Cannot open '{}': URL exceeds 8192 bytes", truncate_url(url)));
    } else {
        // Branch: within the byte limit — proceed to the control/whitespace scan.
    }

    // Guard 3: a control or whitespace character means the string is either malformed or an attempt to
    // smuggle a second argument past the handler; the OS handler is the wrong place to find out which.
    if url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        // Branch: contains a control or whitespace character — refuse (covers spaces, newlines, bell codes).
        return Err(format!(
            "Cannot open '{}': URL contains a control or whitespace character", truncate_url(url)
        ));
    } else {
        // Branch: clean of control and whitespace characters — proceed to the scheme allow-list.
    }

    // Guard 4: only web and mail schemes are permitted; every other scheme is refused here as a second
    // line of defence behind the webview's own check, because this command runs with the user's full permissions.
    let lower = url.to_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") && !lower.starts_with("mailto:") {
        // Branch: scheme is not http, https or mailto — refuse (covers javascript:, file:, data:, bare paths).
        return Err(format!(
            "Cannot open '{}': only http, https and mailto links may be opened", truncate_url(url)
        ));
    } else {
        // Branch: scheme is one of the three permitted ones — proceed to per-scheme content checks.
    }

    // Guards 5 and 6: a permitted scheme with nothing after it (https:// or mailto:) is not a real link.
    if lower.starts_with("http://") || lower.starts_with("https://") {
        // Branch: web URL — verify that a host follows the //.
        let scheme_len = if lower.starts_with("https://") {
            // Branch: https — eight bytes for the "https://" prefix.
            "https://".len()
        } else {
            // Branch: http — seven bytes for the "http://" prefix.
            "http://".len()
        };
        if url.len() <= scheme_len {
            // Branch: nothing follows the scheme prefix — refuse a bare scheme with no host.
            return Err(format!("Cannot open '{}': no host after the scheme", truncate_url(url)));
        } else {
            // Branch: a host follows the scheme prefix — the web URL is well-formed enough to open.
        }
    } else {
        // Branch: mailto URL — verify that a recipient follows the colon.
        if url.len() <= "mailto:".len() {
            // Branch: nothing follows the colon — refuse an empty mailto with no recipient.
            return Err(format!("Cannot open '{}': mailto has no recipient", truncate_url(url)));
        } else {
            // Branch: a recipient follows the colon — the mailto is well-formed enough to open.
        }
        // Some mail clients attach a local file named in the query (attach=, attachment=, file=); a link must never be
        // able to make the user's mail client send one of their files.
        let query = lower.split_once('?').map(|(_, q)| q).unwrap_or("");
        if query.split('&').any(|pair| matches!(pair.split('=').next(), Some("attach" | "attachment" | "file"))) {
            return Err(format!("Cannot open '{}': mailto links may not attach files", truncate_url(url)));
        } else {
            // No attachment parameter: safe to hand to the mail client.
        }
    }

    Ok(())
}

/// Truncates a URL for display in an error message, keeping messages bounded regardless of input length.
///
/// @purpose Bounds the size of IPC error strings by shortening any URL longer than 80 characters.
/// @inputs url - The candidate URL string to shorten for an error message.
/// @outputs String - The full URL when it is 80 characters or fewer, otherwise its first 80 characters followed by "...".
/// @dataflow url -> character count -> either the original string or a sliced-and-appended form.
/// @controlflow Compare char count to 80 -> return as-is within the limit or truncated-with-ellipsis beyond it.
fn truncate_url(url: &str) -> String {
    if url.chars().count() > 80 {
        // Branch: longer than 80 characters — keep the first 80 and mark the cut with an ellipsis.
        format!("{}...", url.chars().take(80).collect::<String>())
    } else {
        // Branch: within the limit — return the URL unchanged so short URLs are named exactly.
        url.to_string()
    }
}

/// Opens a web or mail link in the operating system's default handler, after strict validation.
///
/// The URL is validated with validate_external_url before any process is launched; only http, https and
/// mailto schemes can ever reach the platform launcher. The exit status of the launcher is not checked,
/// because only the failure to launch it is an error — a handler that exits non-zero for reasons unrelated
/// to this URL (for example a browser already running) should not be reported as a command failure.
///
/// @purpose Hands a validated web or mail URL to the OS default handler with no shell in between.
/// @inputs url - The candidate URL string, owned by value from the Tauri IPC invoke.
/// @outputs Result<(), String> - Ok(()) when the launcher process was spawned, or Err naming the (truncated) URL and launch cause.
/// @dataflow url -> validate_external_url -> platform-specific Command spawn -> Result over IPC.
/// @controlflow Validate and early-return on failure -> branch on target OS to select the launcher -> spawn -> return Ok(()) or map spawn error to Err.
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    // Validate before handing anything to the OS handler; a rejected URL returns its reason immediately.
    validate_external_url(&url)?;

    #[cfg(target_os = "windows")]
    {
        // Branch (Windows): rundll32 url.dll,FileProtocolHandler hands the URL directly to the registered
        // protocol handler with no shell in between — cmd /c start would parse & and ^ in a query string as
        // shell syntax, which is both a bug and an injection route.
        match std::process::Command::new("rundll32")
            .arg("url.dll,FileProtocolHandler")
            .arg(&url)
            .spawn()
        {
            Ok(_) => {
                // Branch: process launched — the exit status is intentionally not checked.
            }
            Err(err) => {
                // Branch: launch failed — return an error naming the (truncated) URL and the OS cause.
                return Err(format!(
                    "Failed to open '{}': {}",
                    truncate_url(&url),
                    err
                ));
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // Branch (macOS): the open command launches the URL in the registered default handler.
        match std::process::Command::new("open")
            .arg(&url)
            .spawn()
        {
            Ok(_) => {
                // Branch: process launched — the exit status is intentionally not checked.
            }
            Err(err) => {
                // Branch: launch failed — return an error naming the (truncated) URL and the OS cause.
                return Err(format!(
                    "Failed to open '{}': {}",
                    truncate_url(&url),
                    err
                ));
            }
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        // Branch (other/POSIX): xdg-open is the freedesktop standard launcher for web and mail URLs.
        match std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
        {
            Ok(_) => {
                // Branch: process launched — the exit status is intentionally not checked.
            }
            Err(err) => {
                // Branch: launch failed — return an error naming the (truncated) URL and the OS cause.
                return Err(format!(
                    "Failed to open '{}': {}",
                    truncate_url(&url),
                    err
                ));
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Only validate_external_url is exercised here. Calling open_external_url would spawn a browser,
    // mail client or file manager on the developer's machine, so process launch is never tested.

    /// A mailto link may not ask the mail client to attach a local file.
    #[test]
    fn refuses_mailto_links_that_attach_files() {
        for url in ["mailto:a@b.example?attach=C:/Users/me/.ssh/id_rsa", "mailto:a@b.example?subject=x&Attachment=/etc/passwd", "MAILTO:a@b.example?file=x"] {
            assert!(validate_external_url(url).is_err(), "{url} must be refused");
        }
        // An ordinary mailto with a subject and body is still fine.
        assert!(validate_external_url("mailto:a@b.example?subject=Hello&body=Hi").is_ok());
    }

    #[test]
    fn accepts_a_plain_https_url() {
        assert!(validate_external_url("https://example.com").is_ok());
    }

    #[test]
    fn accepts_an_http_url_with_query_and_fragment() {
        assert!(
            validate_external_url("http://example.com/a?b=1&c=2#frag").is_ok(),
            "a full http URL with query and fragment must be accepted"
        );
    }

    #[test]
    fn accepts_upper_case_scheme() {
        // Scheme matching is case-insensitive per RFC 3986 section 3.1, so HTTPS:// is valid.
        assert!(validate_external_url("HTTPS://Example.com").is_ok());
    }

    #[test]
    fn accepts_a_mailto_with_recipient() {
        assert!(validate_external_url("mailto:someone@example.com").is_ok());
    }

    #[test]
    fn accepts_a_mailto_with_parameters() {
        assert!(
            validate_external_url("mailto:a@b.c?subject=Hi").is_ok(),
            "a mailto with a subject parameter must be accepted"
        );
    }

    #[test]
    fn rejects_an_empty_string() {
        let result = validate_external_url("");
        assert!(result.is_err(), "an empty URL must be rejected");
        let err = result.expect_err("should return an error for an empty URL");
        assert!(err.contains("empty"), "error should explain the URL was empty");
    }

    #[test]
    fn rejects_a_javascript_scheme() {
        // javascript: would execute script in the webview context if handed to any interpreter.
        let result = validate_external_url("javascript:alert(1)");
        assert!(result.is_err(), "a javascript: URL must be rejected");
    }

    #[test]
    fn rejects_a_file_scheme() {
        // file: would read local files with the user's privileges, so it is refused here.
        let result = validate_external_url("file:///C:/Windows/System32/calc.exe");
        assert!(result.is_err(), "a file: URL must be rejected");
    }

    #[test]
    fn rejects_a_data_scheme() {
        let result = validate_external_url("data:text/html,<b>x</b>");
        assert!(result.is_err(), "a data: URL must be rejected");
    }

    #[test]
    fn rejects_a_windows_drive_path() {
        // A bare Windows path is not a scheme at all and must never reach the OS handler.
        let result = validate_external_url("C:\\Windows\\notepad.exe");
        assert!(result.is_err(), "a bare Windows path must be rejected");
    }

    #[test]
    fn rejects_a_relative_path() {
        let result = validate_external_url("notes/setup.md");
        assert!(result.is_err(), "a relative path must be rejected");
    }

    #[test]
    fn rejects_an_http_url_with_no_host() {
        let result = validate_external_url("https://");
        assert!(result.is_err(), "an http URL with no host must be rejected");
    }

    #[test]
    fn rejects_a_mailto_with_no_recipient() {
        let result = validate_external_url("mailto:");
        assert!(result.is_err(), "a mailto with no recipient must be rejected");
    }

    #[test]
    fn rejects_a_url_with_a_space() {
        // A space in a URL is either malformed or an attempt to smuggle a second argument.
        let result = validate_external_url("https://example.com/a b");
        assert!(result.is_err(), "a URL containing a space must be rejected");
    }

    #[test]
    fn rejects_a_url_with_a_leading_space() {
        let result = validate_external_url(" https://example.com");
        assert!(result.is_err(), "a leading space must be rejected");
    }

    #[test]
    fn rejects_a_url_with_a_newline() {
        let result = validate_external_url("https://example.com\n");
        assert!(result.is_err(), "a newline in the URL must be rejected");
    }

    #[test]
    fn rejects_a_url_with_a_control_character() {
        // \u{0007} is the bell character, a control code that must never reach the OS handler.
        let result = validate_external_url("https://example.com/\u{0007}");
        assert!(result.is_err(), "a URL containing a control character must be rejected");
    }

    #[test]
    fn rejects_a_url_longer_than_8192_bytes() {
        let url = "https://example.com/".to_string() + &"a".repeat(9000);
        assert!(url.len() > 8192, "test precondition: URL must exceed the limit");
        let result = validate_external_url(&url);
        assert!(result.is_err(), "a URL longer than 8192 bytes must be rejected");
    }

    #[test]
    fn truncates_a_long_rejected_url_in_the_error_message() {
        // A 300-character javascript: URL is rejected by the scheme guard; its error message must name a
        // truncated form so a very long input cannot bloat the IPC payload.
        let url = "javascript:".to_string() + &"a".repeat(289);
        assert_eq!(url.len(), 300, "test precondition: URL must be 300 characters");

        let result = validate_external_url(&url);
        assert!(result.is_err(), "the javascript: URL must be rejected");

        let err = result.expect_err("should return an error for the javascript: URL");
        assert!(
            err.len() < 200,
            "error message should stay short even for a long URL (got {} chars)",
            err.len()
        );
        assert!(err.contains("..."), "truncated error must contain the ellipsis marker");
    }
}
