//! @file grants_tests.rs
//! @purpose Unit tests for grants.rs: path normalisation, keys, folder containment, grant/allow/require, persistence, caps and a corrupt store.
//! @functions temp_store helper plus one #[test] per behaviour.
//! @version 1
//! @date 2026-10-07

use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

/// Creates a unique temp store path under the OS temp directory for persistence tests.
fn temp_store(name: &str) -> PathBuf {
    // Combine the process id with nanoseconds since the epoch so each test gets an unambiguous file name without clashing across parallel runs.
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0); // Fallback to 0 if the clock is unset; uniqueness still holds via pid + name below.
    std::env::temp_dir().join(format!("kdoc-grants-{}-{}-{}.json", std::process::id(), nanos, name))
}

/// Picks an absolute example path appropriate for the current platform so tests behave identically on Windows and Unix.
fn abs() -> &'static str {
    // On Windows use a drive-lettered path; elsewhere mirror it with a leading slash as the root anchor.
    #[cfg(windows)]
    { "C:\\docs\\a.md" }
    #[cfg(not(windows))]
    { "/docs/a.md" }
}

#[test]
fn normalise_rejects_relative_and_escaping_paths() {
    // A relative path has no root anchor and must be rejected outright.
    assert_eq!(normalise("docs/a.md"), None);

    // An absolute path whose ".." climbs above the filesystem root escapes upward and is rejected.
    #[cfg(windows)]
    assert_eq!(normalise(r"C:\..\a.md"), None);
    #[cfg(not(windows))]
    assert_eq!(normalise("/../a.md"), None);

    // A mid-path ".." that cancels a sibling segment resolves cleanly to the path without that segment.
    #[cfg(windows)]
    assert_eq!(normalise(r"C:\docs\x\..\a.md"), Some(PathBuf::from(r"C:\docs\a.md")));
    #[cfg(not(windows))]
    assert_eq!(normalise("/docs/x/../a.md"), Some(PathBuf::from("/docs/a.md")));
}

#[test]
fn keys_ignore_case_and_separators_on_windows() {
    // On Windows the two spellings (mixed-case forward slashes vs. lower-case backslashes) must produce identical keys.
    #[cfg(windows)]
    assert_eq!(key(Path::new("C:/Docs/A.md")), key(Path::new(r"c:\docs\a.md")));

    // Off Windows, mixed case is significant and the two spellings differ only by separator direction.
    #[cfg(not(windows))]
    assert_ne!(key(Path::new("/Docs/A.md")), key(Path::new("/docs/a.md")));
}

#[test]
fn is_within_matches_children_not_lookalikes() {
    // A child path (separator after the folder prefix) counts as within; a lookalike sibling ("docs2") does not.
    #[cfg(windows)]
    {
        assert!(is_within("c:\\docs\\a.md", "c:\\docs"));
        assert!(!is_within("c:\\docs2\\a.md", "c:\\docs"));
    }
    #[cfg(not(windows))]
    {
        assert!(is_within("/docs/a.md", "/docs"));
        assert!(!is_within("/docs2/a.md", "/docs"));
    }

    // An exact match is trivially within itself.
    assert!(is_within("c:\\docs", "c:\\docs"));

    // A drive root folder matches anything that starts with it (its whole tree).
    #[cfg(windows)]
    {
        assert!(is_within("c:\\x", "c:\\"));
    }
    #[cfg(not(windows))]
    {
        assert!(is_within("/x", "/"));
    }
}

#[test]
fn a_granted_file_is_allowed_and_nothing_else() {
    // Start from an empty in-memory list with no persistence configured.
    let state = GrantState::default();

    // Grant the single example file path (resolved to its canonical key).
    assert!(state.grant_file(Path::new(abs())).is_ok());

    // The exact granted file is now allowed.
    assert!(state.allows(abs()));

    // A different file in the same folder was never granted, so it stays denied even though they share a directory.
    #[cfg(windows)]
    {
        let sibling = "C:\\docs\\b.md";
        assert!(!state.allows(sibling));
    }
    #[cfg(not(windows))]
    {
        let sibling = "/docs/b.md";
        assert!(!state.allows(sibling));
    }

    // A relative path can never be allowed, even if it happens to name the granted file.
    assert!(!state.allows("a.md"));
}

#[test]
fn a_granted_folder_allows_everything_inside() {
    // Start from an empty in-memory list with no persistence configured.
    let state = GrantState::default();

    // Grant the whole docs folder tree.
    #[cfg(windows)]
    assert!(state.grant_folder(Path::new("C:\\docs")).is_ok());
    #[cfg(not(windows))]
    assert!(state.grant_folder(Path::new("/docs")).is_ok());

    // A document nested several levels inside the granted folder is permitted.
    #[cfg(windows)]
    {
        let child = "C:\\docs\\sub\\n.md";
        assert!(state.allows(child));
        let outside = "C:\\docs2\\n.md";
        assert!(!state.allows(outside));
    }
    #[cfg(not(windows))]
    {
        let child = "/docs/sub/n.md";
        assert!(state.allows(child));
        let outside = "/docs2/n.md";
        assert!(!state.allows(outside));
    }
}

#[test]
fn allows_folder_covers_the_folder_of_a_granted_file() {
    // Start from an empty in-memory list with no persistence configured.
    let state = GrantState::default();

    // Grant a single file inside docs; its containing folder is implicitly accessible for attachments.
    #[cfg(windows)]
    assert!(state.grant_file(Path::new(r"C:\docs\a.md")).is_ok());
    #[cfg(not(windows))]
    assert!(state.grant_file(Path::new("/docs/a.md")).is_ok());

    // The folder holding the granted file is allowed as a directory.
    #[cfg(windows)]
    {
        assert!(state.allows_folder("C:\\docs"));
        // A subfolder of the document's folder (its attachments) is allowed; an unrelated folder is not.
        assert!(state.allows_folder("C:\\docs\\attachments"));
        assert!(!state.allows_folder("C:\\other"));
    }
    #[cfg(not(windows))]
    {
        assert!(state.allows_folder("/docs"));
        assert!(state.allows_folder("/docs/attachments"));
        assert!(!state.allows_folder("/other"));
    }

    // An explicit folder grant authorises arbitrary depth inside that tree.
    #[cfg(windows)]
    assert!(state.grant_folder(Path::new("C:\\vault")).is_ok());
    #[cfg(not(windows))]
    assert!(state.grant_folder(Path::new("/vault")).is_ok());

    #[cfg(windows)]
    {
        let nested = "C:\\vault\\assets";
        assert!(state.allows_folder(nested));
    }
    #[cfg(not(windows))]
    {
        let nested = "/vault/assets";
        assert!(state.allows_folder(nested));
    }
}

#[test]
fn require_returns_the_access_denied_prefix() {
    // Start from an empty in-memory list with no persistence configured.
    let state = GrantState::default();

    // Requiring a never-granted path must fail, and the error must carry the recognised denial prefix plus the original request.
    match state.require(abs()) {
        Err(msg) => assert!(msg.starts_with(ACCESS_DENIED_PREFIX)),
        Ok(_) => panic!("require should have denied an ungranted file"),
    }

    // Requiring a never-granted folder must also fail with the same prefix.
    #[cfg(windows)]
    match state.require_folder("C:\\docs") {
        Err(msg) => assert!(msg.starts_with(ACCESS_DENIED_PREFIX)),
        Ok(_) => panic!("require_folder should have denied an ungranted folder"),
    }
    #[cfg(not(windows))]
    match state.require_folder("/docs") {
        Err(msg) => assert!(msg.starts_with(ACCESS_DENIED_PREFIX)),
        Ok(_) => panic!("require_folder should have denied an ungranted folder"),
    }

    // After granting, require succeeds and returns the resolved absolute path.
    assert!(state.grant_file(Path::new(abs())).is_ok());
    #[cfg(windows)]
    match state.require(r"C:\docs\a.md") {
        Ok(resolved) => assert_eq!(resolved, PathBuf::from(r"C:\docs\a.md")),
        Err(_) => panic!("require should allow a freshly granted file"),
    }
    #[cfg(not(windows))]
    match state.require("/docs/a.md") {
        Ok(resolved) => assert_eq!(resolved, PathBuf::from("/docs/a.md")),
        Err(_) => panic!("require should allow a freshly granted file"),
    }
}

#[test]
fn grants_persist_and_reload() {
    // Use an isolated temp store so this test never touches the real grant file.
    let store = temp_store("persist");

    // First state persists two distinct grants to the temp store.
    let first = GrantState::new(Some(store.clone()));
    #[cfg(windows)]
    {
        assert!(first.grant_file(Path::new(r"C:\docs\a.md")).is_ok());
        assert!(first.grant_folder(Path::new("C:\\vault")).is_ok());
    }
    #[cfg(not(windows))]
    {
        assert!(first.grant_file(Path::new("/docs/a.md")).is_ok());
        assert!(first.grant_folder(Path::new("/vault")).is_ok());
    }

    // A fresh state pointed at the same store reloads an equal allow-list.
    let second = GrantState::new(Some(store.clone()));
    assert_eq!(second.snapshot(), first.snapshot());

    // Clean up the temp file created by this test.
    let _ = fs::remove_file(&store);
}

#[test]
fn file_grants_are_capped_most_recent_last() {
    // Start from an empty in-memory list with no persistence configured so trimming is purely memory-driven.
    let state = GrantState::default();

    // Grant MAX_FILE_GRANTS + 5 distinct files; the five oldest must be dropped, leaving exactly the cap count.
    #[cfg(windows)]
    {
        for i in 0..(MAX_FILE_GRANTS as u64 + 5) {
            let p = format!(r"C:\docs\file_{}.md", i);
            assert!(state.grant_file(Path::new(&p)).is_ok());
        }

        // Exactly the cap remains after trimming.
        assert_eq!(state.snapshot().files.len(), MAX_FILE_GRANTS);

        // The very first granted file was dropped and is no longer allowed...
        let oldest = format!(r"C:\docs\file_0.md");
        assert!(!state.allows(&oldest));

        // ...while the most recently granted one survives.
        let newest = format!(r"C:\docs\file_{}.md", MAX_FILE_GRANTS as u64 + 4);
        assert!(state.allows(&newest));

        // Re-granting an old (still-present) file moves it to the end without duplicating it.
        let mid = format!(r"C:\docs\file_10.md");
        state.grant_file(Path::new(&mid)).unwrap();
        // Stored keys are normalised (lower-cased on Windows), so compare against the key, not the raw string.
        let mid_key = key(Path::new(&mid));
        assert_eq!(state.snapshot().files.iter().filter(|f| **f == mid_key).count(), 1);
        assert_eq!(state.snapshot().files.last(), Some(&mid_key));
    }

    #[cfg(not(windows))]
    {
        for i in 0..(MAX_FILE_GRANTS as u64 + 5) {
            let p = format!("/docs/file_{}.md", i);
            assert!(state.grant_file(Path::new(&p)).is_ok());
        }

        // Exactly the cap remains after trimming.
        assert_eq!(state.snapshot().files.len(), MAX_FILE_GRANTS);

        // The very first granted file was dropped and is no longer allowed...
        let oldest = format!("/docs/file_0.md");
        assert!(!state.allows(&oldest));

        // ...while the most recently granted one survives.
        let newest = format!("/docs/file_{}.md", MAX_FILE_GRANTS as u64 + 4);
        assert!(state.allows(&newest));

        // Re-granting an old (still-present) file moves it to the end without duplicating it.
        let mid = format!("/docs/file_10.md");
        state.grant_file(Path::new(&mid)).unwrap();
        // Stored keys are normalised (lower-cased on Windows), so compare against the key, not the raw string.
        let mid_key = key(Path::new(&mid));
        assert_eq!(state.snapshot().files.iter().filter(|f| **f == mid_key).count(), 1);
        assert_eq!(state.snapshot().files.last(), Some(&mid_key));
    }
}

#[test]
fn a_corrupt_store_starts_empty() {
    // Write invalid JSON to the store so parsing must fail.
    let store = temp_store("corrupt");
    fs::write(&store, "not json").expect("failed to seed corrupt store");

    // Loading a corrupt file yields an empty allow-list rather than panicking or erroring.
    let state = GrantState::new(Some(store.clone()));
    assert_eq!(state.snapshot(), GrantList::default());

    // Clean up the temp file created by this test.
    let _ = fs::remove_file(&store);
}

/// A vault needs a folder the user picked: the folder that merely holds a granted file is not one.
#[test]
fn vaults_need_a_picked_folder() {
    let state = GrantState::default();
    let (file, folder, inside) = if cfg!(windows) {
        ("C:/docs/a.md", "C:/docs", "C:/vault/notes")
    } else {
        ("/docs/a.md", "/docs", "/vault/notes")
    };
    assert!(state.grant_file(Path::new(file)).is_ok());
    // The document's own folder is fine for its attachments, but it is not a vault.
    assert!(state.allows_folder(folder));
    assert!(!state.allows_vault(folder));
    assert!(state.require_vault(folder).is_err());
    let vault = if cfg!(windows) { "C:/vault" } else { "/vault" };
    assert!(state.grant_folder(Path::new(vault)).is_ok());
    assert!(state.allows_vault(vault));
    assert!(state.allows_vault(inside));
}

/// Network locations are recognised however they are spelled; local paths are not mistaken for them.
#[test]
fn recognises_network_paths() {
    assert!(is_network_path(Path::new(r"\\attacker\share\x.png")));
    assert!(is_network_path(Path::new("//attacker/share/x.png")));
    #[cfg(windows)]
    assert!(is_network_path(Path::new(r"\\?\UNC\attacker\share\x.png")));
    #[cfg(windows)]
    assert!(!is_network_path(Path::new(r"C:\pics\x.png")));
    #[cfg(windows)]
    assert!(!is_network_path(Path::new(r"\\?\C:\pics\x.png")));
    assert!(!is_network_path(Path::new("/home/me/x.png")));
}
