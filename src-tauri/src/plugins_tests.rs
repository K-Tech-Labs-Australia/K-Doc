//! @file plugins_tests.rs
//! @purpose Covers the three plugin readers that need no Tauri handle (FR-14.18): is_plugin_name, plugin_names_in and read_plugin_part, each exercised against a folder this file makes itself under std::env::temp_dir().
//! @inputs nothing external; every test builds its own temporary plugins folder so the suite runs without an application handle or any pre-existing data on disk.
//! @outputs assertions over is_plugin_name's boolean result and over plugin_names_in and read_plugin_part's Ok/Err payloads only.
//! @functions
//!   - fresh: build a clean per-test plugins folder under temp_dir, removing anything left behind first.
//!   - accepts_a_plain_name: prove that plain lower-case names are accepted as plugin names.
//!   - refuses_a_name_that_could_be_a_path: prove that empty, dotted, slashed, upper-case and over-long names are all rejected.
//!   - lists_only_folders_that_hold_a_plugin: prove that only valid folders holding main.js are listed in order.
//!   - lists_nothing_in_an_empty_folder: prove that an empty folder yields no plugin names.
//!   - reads_a_plugin_file: prove that read_plugin_part returns a file's exact text when its name and path are valid.
//!   - refuses_to_read_through_a_name: prove that any name which is not a plugin name is refused before it becomes a path.
//!   - reports_a_file_that_is_not_there: prove that reading a missing file names the path in its error message.
//! @dataflow fresh folder -> fs writes of folders and main.js files -> is_plugin_name / plugin_names_in / read_plugin_part -> assertions, then remove_dir_all cleans up.
//! @controlflow each test makes its own folder, writes what it needs, calls one function under test, asserts the result, and removes the folder so no leavings remain for another test.
//! @version 1
//! @date 2026-09-18

use super::{is_plugin_name, plugin_names_in, read_plugin_pair, read_plugin_part};

/// Builds a clean plugins folder for one test and returns its path under temp_dir.
///
/// @purpose Give every test an isolated temporary folder so no two tests share or see each other's files (FR-14.18).
/// @inputs name - the suffix that makes this test's folder unique within std::env::temp_dir().
/// @outputs PathBuf with a freshly created, empty plugins folder ready to be written into.
/// @dataflow temp_dir -> join(kdoc-plugins-name) -> remove_dir_all clears leftovers -> create_dir_all builds it fresh.
/// @controlflow Remove any leftover folder from a previous run so the test starts clean, then create and return that same path.
fn fresh(name: &str) -> std::path::PathBuf {
    // Each test gets its own folder under temp_dir so one cannot see another's leavings; remove first to start clean.
    let dir = std::env::temp_dir().join(format!("kdoc-plugins-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("make the fresh plugin folder");
    dir
}

// is_plugin_name accepts plain names that are lower-case letters, digits or hyphens and begin with a letter.
#[test]
fn accepts_a_plain_name() {
    assert!(is_plugin_name("hello"));
    assert!(is_plugin_name("a"));
    assert!(is_plugin_name("word-count"));
    assert!(is_plugin_name("p2"));
}

// is_plugin_name rejects every name that could climb out of the plugins folder or break its rules, including an over-long one.
#[test]
fn refuses_a_name_that_could_be_a_path() {
    // Empty and dot names fail both the length bound and the leading-letter rule.
    assert!(!is_plugin_name(""));
    assert!(!is_plugin_name("."));
    assert!(!is_plugin_name(".."));
    // Slash and backslash let a name become a path, so they are refused by the per-character check.
    assert!(!is_plugin_name("a/b"));
    assert!(!is_plugin_name("a\\b"));
    // A dot is not allowed inside a plugin name at all.
    assert!(!is_plugin_name("a.b"));
    // An upper-case letter fails the lower-only per-character check even though it starts with a letter.
    assert!(!is_plugin_name("Hello"));
    // Starting with a digit fails the leading-letter rule.
    assert!(!is_plugin_name("2fast"));
    // Sixty-five characters exceed MAX_NAME of sixty-four, so this over-long name is refused too.
    assert!(!is_plugin_name(&"a".repeat(65)));
}

// plugin_names_in returns only the folders that are valid plugins: they hold main.js and have a valid lower-case name.
#[test]
fn lists_only_folders_that_hold_a_plugin() {
    let dir = fresh("listing");
    // alpha and beta both hold main.js, so each is a genuine plugin.
    std::fs::create_dir_all(&dir.join("alpha")).expect("make alpha folder");
    std::fs::write(dir.join("alpha").join("main.js"), "code").expect("write alpha main.js");
    std::fs::create_dir_all(&dir.join("beta")).expect("make beta folder");
    std::fs::write(dir.join("beta").join("main.js"), "code").expect("write beta main.js");
    // gamma is a directory but has no main.js, so it is not a plugin and must be skipped.
    std::fs::create_dir_all(&dir.join("gamma")).expect("make gamma folder");
    // Delta holds main.js but starts with an upper-case letter, which K-Doc will never read as a name.
    std::fs::create_dir_all(&dir.join("Delta")).expect("make Delta folder");
    std::fs::write(dir.join("Delta").join("main.js"), "code").expect("write Delta main.js");
    // A loose file in the plugins folder is never a plugin, because only directories are considered.
    std::fs::write(&dir.join("stray.js"), "code").expect("write stray.js");

    let names = plugin_names_in(&dir).expect("list the plugins");
    assert_eq!(names, vec!["alpha".to_string(), "beta".to_string()]);

    let _ = std::fs::remove_dir_all(&dir);
}

// plugin_names_in on an empty folder yields no plugin names at all.
#[test]
fn lists_nothing_in_an_empty_folder() {
    let dir = fresh("empty");
    let names = plugin_names_in(&dir).expect("list plugins in the empty folder");
    assert!(names.is_empty());

    let _ = std::fs::remove_dir_all(&dir);
}

// read_plugin_part returns the exact text of a plugin file when its name and path are valid.
#[test]
fn reads_a_plugin_file() {
    let dir = fresh("reader");
    // Write one main.js holding exactly the script K-Doc would later hand to the reader.
    std::fs::create_dir_all(&dir.join("one")).expect("make one folder");
    let content = "kdoc.command(\"x\", \"X\", function () {});";
    std::fs::write(dir.join("one").join("main.js"), content).expect("write main.js");

    let text = read_plugin_part(&dir, "one", "main.js").expect("read the file");
    assert_eq!(text, content);

    let _ = std::fs::remove_dir_all(&dir);
}

// read_plugin_part refuses any name that is not a valid plugin name before it ever becomes a path.
#[test]
fn refuses_to_read_through_a_name() {
    let dir = fresh("refuse");

    // A parent-directory climb must be refused, naming the reason in its error message.
    let error = read_plugin_part(&dir, "../secret", "main.js").expect_err("climb out of plugins folder");
    assert!(error.contains("not a plugin name"), "{error}");

    // The bare '..' is also refused for the same reason as any other climb attempt.
    let error = read_plugin_part(&dir, "..", "main.js").expect_err("'..' climb");
    assert!(error.contains("not a plugin name"), "{error}");

    // A slash inside the name makes it a path rather than a single folder, so it is refused too.
    let error = read_plugin_part(&dir, "a/b", "main.js").expect_err("slash in name");
    assert!(error.contains("not a plugin name"), "{error}");

    let _ = std::fs::remove_dir_all(&dir);
}

// read_plugin_part names the path when it cannot find the requested file inside its plugin folder.
#[test]
fn reports_a_file_that_is_not_there() {
    let dir = fresh("missing");
    // 'one' is a valid name but its folder was never created, so main.js does not exist on disk.
    std::fs::create_dir_all(&dir).expect("make the plugins folder");
    let missing = dir.join("one").join("main.js");

    let error = read_plugin_part(&dir, "one", "main.js").expect_err("file that is not there");
    assert!(error.contains(missing.to_str().unwrap()), "{error}");

    let _ = std::fs::remove_dir_all(&dir);
}

// read_plugin_pair answers with the manifest first and the code second, which is the order the webview reads.
#[test]
fn reads_the_manifest_before_the_code() {
    let dir = fresh("pair");
    std::fs::create_dir_all(&dir.join("one")).expect("make one folder");
    std::fs::write(dir.join("one").join("plugin.json"), "{ \"name\": \"One\" }").expect("write plugin.json");
    std::fs::write(dir.join("one").join("main.js"), "kdoc.command();").expect("write main.js");

    let parts = read_plugin_pair(&dir, "one").expect("read both parts");
    assert_eq!(parts.len(), 2);
    assert!(parts[0].contains("name"), "the manifest comes first: {}", parts[0]);
    assert!(parts[1].contains("kdoc.command"), "the code comes second: {}", parts[1]);

    let _ = std::fs::remove_dir_all(&dir);
}

// read_plugin_pair refuses a name that is not a plugin name, before either file becomes a path.
#[test]
fn refuses_a_pair_read_through_a_name() {
    let dir = fresh("pair-refuse");
    let error = read_plugin_pair(&dir, "../secret").expect_err("climb out of plugins folder");
    assert!(error.contains("not a plugin name"), "{error}");

    let _ = std::fs::remove_dir_all(&dir);
}
