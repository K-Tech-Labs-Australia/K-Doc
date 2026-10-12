//! @file navigation.rs
//! @purpose Tauri plugin that stops any webview from navigating away from the app's own pages, so the frameless window can never display a remote page.
//! @inputs Webview navigation requests, each carrying the target `Url`; the build profile (`debug_assertions`) deciding whether dev-server hosts are allowed.
//! @outputs A `TauriPlugin` that allows or refuses each navigation; a boolean verdict from `is_app_url`.
//! @functions
//!   - is_app_url: Decides whether a URL points at the app's own bundled or dev-server pages.
//!   - guard: Builds the `navigation-guard` plugin that applies `is_app_url` to every webview navigation.
//! @dataflow Webview navigation request (Url) -> on_navigation hook -> is_app_url scheme/host check -> allow (true) or refuse (false) verdict returned to the webview.
//! @controlflow guard() builds the plugin once at startup -> on each navigation the hook calls is_app_url -> scheme match -> host match for http(s) -> boolean result.
//! @version 1
//! @date 2026-10-07

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Runtime, Url};

/// Hosts the bundled frontend is served from (Windows/Android use http(s)://tauri.localhost; macOS/Linux use the tauri:// scheme).
const APP_HOST: &str = "tauri.localhost";

/// Development servers the debug build loads the frontend from (tauri.conf.json devUrl).
const DEV_HOSTS: [&str; 2] = ["localhost", "127.0.0.1"];

/// Decides whether a URL points at the app's own pages.
/// @purpose Classifies a navigation target as an app-owned page (allowed) or anything else (refused).
/// @inputs url - The navigation target; allow_dev - true in debug builds so the dev server host is accepted.
/// @outputs bool - true when the URL belongs to the app, false otherwise.
/// @dataflow Url -> scheme() -> (for http/https) host_str() -> comparison against APP_HOST / DEV_HOSTS -> bool.
/// @controlflow Match on scheme; http(s) arms additionally match on host; every unrecognised scheme or host falls through to false.
pub fn is_app_url(url: &Url, allow_dev: bool) -> bool {
    match url.scheme() {
        // Check for the tauri:// scheme: the bundled frontend on macOS and Linux, always allowed.
        "tauri" => true,
        // Check for about: (about:blank / about:srcdoc): the app's own scratch frames (print), never remote content, allowed.
        "about" => true,
        // Check for http(s): allowed only for the bundled-app host, or the dev server in a debug build.
        "http" | "https" => match url.host_str() {
            // Check for the bundled-app host (tauri.localhost): allowed.
            Some(host) if host == APP_HOST => true,
            // Check for a dev-server host while allow_dev is set (debug build): allowed.
            Some(host) if allow_dev && DEV_HOSTS.contains(&host) => true,
            // Check for any other or missing host: refused.
            _ => false,
        },
        // Check for every other scheme (file, javascript, data, custom protocols): refused.
        _ => false,
    }
}

/// Builds the navigation guard plugin.
/// @purpose Registers an on_navigation hook that refuses navigations leaving the app's own pages.
/// @inputs None; the runtime type is chosen by the caller, and debug/release is read from `cfg!(debug_assertions)`.
/// @outputs TauriPlugin<R> - the `navigation-guard` plugin, to be registered on the Tauri builder.
/// @dataflow Navigation Url -> closure -> is_app_url(url, cfg!(debug_assertions)) -> bool verdict to the webview.
/// @controlflow Constructs the plugin once; the closure runs per navigation and returns the verdict without branching of its own.
pub fn guard<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("navigation-guard")
        // External links are opened by the frontend through open_external_url after its own checks; a navigation that reaches the webview itself (a link in rendered HTML, a meta refresh, a script) is refused so the frameless window can never show a remote page.
        .on_navigation(|_webview, url| is_app_url(url, cfg!(debug_assertions)))
        .build()
}

#[cfg(test)]
#[path = "navigation_tests.rs"]
mod tests;
