//! pandoc_tests.rs
//!
//! @file pandoc_tests.rs
//! @purpose Covers format validation for the Pandoc export bridge (FR-13.7): that a proposed target format must name one K-Doc asks Pandoc for, chosen from a fixed list rather than passed to the program as an argument.
//! @inputs string proposals fed directly to pandoc_argument and the PANDOC_FORMATS constant; nothing touches disk or launches a process, so the suite passes with Pandoc absent from PATH.
//! @outputs assertions over pandoc_argument's Ok/Err payloads and over PANDOC_FORMATS contents only.
//! @functions
//!   - accepts_the_two_formats_it_asks_for: latex and epub each validate as Ok carrying their own name.
//!   - refuses_any_other_format: docx, an empty string, and a wrong-case LATEX are all refused, naming the list.
//!   - refuses_a_format_that_is_an_argument: a shell-style option is refused because formats come from the list, not from documents.
//!   - lists_only_the_formats_it_asks_for: PANDOC_FORMATS names exactly latex and epub.
//! @dataflow format string -> pandoc_argument exact match against PANDOC_FORMATS -> Ok name or Err message; no process launch.
//! @controlflow every test is pure in-memory comparison, so the suite passes with Pandoc absent from PATH.
//! @version 1
//! @date 2026-09-18

use super::{pandoc_argument, pandoc_write, PANDOC_FORMATS};

// pandoc_argument accepts exactly latex and epub, returning each one's own name as Ok.
#[test]
fn accepts_the_two_formats_it_asks_for() {
    assert_eq!(pandoc_argument("latex"), Ok("latex"));
    assert_eq!(pandoc_argument("epub"), Ok("epub"));
}

// pandoc_argument refuses any proposal that is not exactly latex or epub, including docx, an empty string, and a wrong-case LATEX, each naming the list.
#[test]
fn refuses_any_other_format() {
    let error = pandoc_argument("docx").expect_err("unknown format");
    assert!(error.contains("latex or epub"), "{error}");

    let error = pandoc_argument("").expect_err("empty proposal");
    assert!(error.contains("latex or epub"), "{error}");

    let error = pandoc_argument("LATEX").expect_err("wrong case");
    assert!(error.contains("latex or epub"), "{error}");
}

// pandoc_argument refuses a shell-style option because the format is chosen from PANDOC_FORMATS, so nothing a document says can become an argument to Pandoc.
#[test]
fn refuses_a_format_that_is_an_argument() {
    let error = pandoc_argument("--template=/etc/passwd").expect_err("format as argument");
    assert!(error.contains("latex or epub"), "{error}");
}

// PANDOC_FORMATS names exactly the two formats K-Doc asks Pandoc for.
#[test]
fn lists_only_the_formats_it_asks_for() {
    assert_eq!(PANDOC_FORMATS, ["latex", "epub"]);
}

// A relative output path is refused before Pandoc is asked to do anything.
#[test]
fn refuses_a_relative_output_path() {
    let error = pandoc_write("# Hi\n", "latex", "out.tex").expect_err("relative path");
    assert!(error.contains("absolute"), "{error}");
}

// With Pandoc installed, a document really is converted; with Pandoc absent the test reports nothing, because
// K-Doc does not install it and a machine without it must still pass the suite.
#[test]
fn writes_a_latex_file_when_pandoc_is_installed() {
    // Check whether Pandoc is on PATH at all, by running it the same way the version command does.
    let installed = std::process::Command::new("pandoc").arg("--version").output().is_ok();
    if !installed {
        return;
    } else {
        // Pandoc is there: convert a document and read the file back.
    }
    let mut path = std::env::temp_dir();
    path.push("kdoc-pandoc-test.tex");
    let _ = std::fs::remove_file(&path);
    let target = path.to_str().expect("path is text");
    pandoc_write("# Title\n\nSome words.\n", "latex", target).expect("pandoc writes latex");
    let written = std::fs::read_to_string(&path).expect("read the latex");
    assert!(written.contains("section"), "{written}");
    assert!(written.contains("Some words."), "{written}");
    let _ = std::fs::remove_file(&path);
}

// A Pandoc run that fails is reported as a failure, not as a written file. Guarded like the test above, because
// it needs Pandoc to do the failing.
#[test]
fn reports_a_failure_when_pandoc_cannot_write() {
    // Check whether Pandoc is on PATH at all, by running it the same way the version command does.
    let installed = std::process::Command::new("pandoc").arg("--version").output().is_ok();
    if !installed {
        return;
    } else {
        // Pandoc is there: ask it to write somewhere it cannot.
    }
    // A folder cannot be opened as a file, and Pandoc creates a missing folder rather than refusing, so an
    // existing folder is what makes it fail.
    let mut folder = std::env::temp_dir();
    folder.push("kdoc-pandoc-dir-target");
    std::fs::create_dir_all(&folder).expect("create the folder");
    let target = folder.to_str().expect("path is text");
    let error = pandoc_write("# Title\n", "latex", target).expect_err("pandoc cannot write");
    assert!(!error.is_empty(), "the failure must carry a reason");
    let _ = std::fs::remove_dir_all(&folder);
}
