//! @file navigation_tests.rs
//! @purpose: unit tests for the navigation guard's URL classification
//! @functions
//!   - app_scheme_and_host_are_allowed: tauri:// and tauri.localhost app origins are accepted.
//!   - about_frames_are_allowed: about:blank and about:srcdoc frames are accepted.
//!   - remote_pages_are_refused: remote and look-alike hosts are refused regardless of the dev flag.
//!   - dev_server_only_in_debug: localhost/127.0.0.1 dev servers are accepted only when allow_dev is true.
//!   - other_schemes_are_refused: file, javascript, data and OS-handler schemes are refused.
//! @version 1
//! @date 2026-10-07

use super::*;

/// Parses a URL literal for use in tests, panicking with a clear message if it is malformed.
fn url(s: &str) -> Url {
    Url::parse(s).expect("valid url")
}

/// The app's own tauri:// scheme and tauri.localhost host are allowed regardless of the dev flag.
#[test]
fn app_scheme_and_host_are_allowed() {
    // Custom tauri scheme served from localhost is the app origin.
    assert!(is_app_url(&url("tauri://localhost/index.html"), false));
    // Windows WebView2 serves the app over http://tauri.localhost.
    assert!(is_app_url(&url("http://tauri.localhost/index.html"), false));
    // The https variant of the tauri.localhost host is also the app origin.
    assert!(is_app_url(&url("https://tauri.localhost/"), false));
}

/// Internal about: frames (blank and srcdoc) are allowed.
#[test]
fn about_frames_are_allowed() {
    // about:blank is used for empty initial frames.
    assert!(is_app_url(&url("about:blank"), false));
    // about:srcdoc is used for inline iframe documents.
    assert!(is_app_url(&url("about:srcdoc"), false));
}

/// Remote pages, including look-alike hosts, are refused with the dev flag off or on.
#[test]
fn remote_pages_are_refused() {
    let remote_urls: [&str; 3] = [
        "https://example.com/",
        "http://evil.example/x",
        // Look-alike host that merely starts with the allowed host name.
        "https://tauri.localhost.evil.example/",
    ];
    for raw in remote_urls {
        let parsed: Url = url(raw);
        // Remote pages must be refused when the dev server is not allowed.
        assert!(!is_app_url(&parsed, false), "{raw} must be refused (allow_dev=false)");
        // Remote pages must also be refused when the dev server is allowed.
        assert!(!is_app_url(&parsed, true), "{raw} must be refused (allow_dev=true)");
    }
}

/// The local dev server is allowed only when allow_dev is true (debug builds).
#[test]
fn dev_server_only_in_debug() {
    let dev_urls: [&str; 2] = ["http://localhost:5173/", "http://127.0.0.1:5173/"];
    for raw in dev_urls {
        let parsed: Url = url(raw);
        // Release behaviour: dev server origins are refused.
        assert!(!is_app_url(&parsed, false), "{raw} must be refused (allow_dev=false)");
        // Debug behaviour: dev server origins are accepted.
        assert!(is_app_url(&parsed, true), "{raw} must be allowed (allow_dev=true)");
    }
}

/// Non-web schemes (file, javascript, data, OS handlers) are refused even with allow_dev true.
#[test]
fn other_schemes_are_refused() {
    let other_urls: [&str; 4] = [
        "file:///C:/x.html",
        "javascript:alert(1)",
        "data:text/html,x",
        "ms-settings:",
    ];
    for raw in other_urls {
        // Even the permissive dev setting must not allow these schemes.
        assert!(!is_app_url(&url(raw), true), "{raw} must be refused");
    }
}
