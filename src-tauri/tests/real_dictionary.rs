//! @file real_dictionary.rs
//! @purpose Integration tests that exercise spellbook against the real en-GB Hunspell dictionary that
//!   `npm run fetch-dictionary` downloads to packages/app/public/dictionaries/en-GB/. The unit tests in
//!   spell.rs prove the wiring — a user word is accepted, duplicates collapse, a capitalised word falls
//!   back to lowercase — but they cannot prove the thing most likely to be wrong: that the 552 KB
//!   affix-and-wordlist pair K-Doc actually ships parses at all and gives the answers a person would
//!   expect. This suite loads that shipped asset directly and asserts on its real behaviour.
//!
//!   The tests skip themselves when the dictionary is absent because the asset is deliberately not
//!   committed; a developer who has not run the fetch script must see a passing suite rather than a
//!   failure that tells them nothing about their change.
//!
//! @inputs The downloaded en-GB index.aff and index.dic files located relative to CARGO_MANIFEST_DIR.
//! @outputs Nothing — this is an integration test crate; assertions either pass or panic the test runner.
//! @functions
//!   - load_real_dictionary: Locates, reads, and parses the shipped en-GB dictionary, returning None when it is absent.
//! @dataflow CARGO_MANIFEST_DIR -> repository root -> packages/app/public/dictionaries/en-GB/index.{aff,dic}
//!   -> fs::read_to_string -> spellbook::Dictionary::new -> Dictionary consumed by four behavioural tests.
//! @controlflow For each test: load the dictionary (skip on absence) -> assert parsing/acceptance/suggestion behaviour.
//! @version 1
//! @date 2026-09-06

use std::fs;
use std::path::PathBuf;

/// Locates, reads, and parses the shipped en-GB Hunspell dictionary that `npm run fetch-dictionary` downloads.
///
/// @purpose Gives the integration tests the real asset so they can assert on actual parsing and spelling
///   behaviour rather than a hand-built in-memory fixture. Returns None when either index file is missing,
///   letting every test skip itself instead of failing spuriously on an un-fetched checkout.
/// @inputs None. Reads from disk only; the location is derived from CARGO_MANIFEST_DIR at compile time.
/// @outputs Option<spellbook::Dictionary> - Some(parsed dictionary) when both index files exist and parse,
///   or None when either index file is absent so callers can skip the test.
/// @dataflow manifest dir -> repository root -> packages/app/public/dictionaries/en-GB/index.{aff,dic}
///   -> fs::read_to_string -> spellbook::Dictionary::new -> Option<Dictionary>.
/// @controlflow Build path from manifest dir -> if either index file missing return None -> read both files
///   with expect (a failure here means the asset is the problem) -> parse -> return Some(dictionary).
fn load_real_dictionary() -> Option<spellbook::Dictionary> {
    // Derive the dictionary directory from CARGO_MANIFEST_DIR rather than assuming a working directory.
    // CARGO_MANIFEST_DIR points at src-tauri regardless of where `cargo test` is invoked from, so this
    // keeps the path correct whether the suite runs from the repo root or from inside src-tauri.
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    // The parent of src-tauri is the repository root; join it with the public dictionary location.
    let repo_root = manifest_dir.parent().unwrap();
    let dict_dir = repo_root.join("packages/app/public/dictionaries/en-GB");

    let aff_path = dict_dir.join("index.aff");
    let dic_path = dict_dir.join("index.dic");

    // Skip when either half of the pair is missing: the asset is deliberately not committed, so a
    // developer who has not run `npm run fetch-dictionary` must see a passing suite rather than a failure.
    if !aff_path.exists() || !dic_path.exists() {
        // Branch: At least one index file is absent — dictionary was never fetched; skip the test.
        return None;
    } else {
        // Branch: Both index files are present; proceed to read and parse them.
    }

    // Read both halves as UTF-8 text. A failure here means the downloaded asset is corrupt or truncated,
    // which is a real problem with the shipped dictionary rather than a bug in this test.
    let aff = fs::read_to_string(&aff_path)
        .expect("failed to read index.aff — the fetched asset is missing or unreadable");
    let dic = fs::read_to_string(&dic_path)
        .expect("failed to read index.dic — the fetched asset is missing or unreadable");

    // Parse the affix-and-wordlist pair into a compiled dictionary. A failure here means the shipped 552 KB
    // asset does not parse, which is exactly the thing most likely to be wrong and worth failing loudly on.
    let dict = spellbook::Dictionary::new(&aff, &dic)
        .expect("dictionary failed to parse — the shipped en-GB asset is the problem");

    Some(dict)
}

/// The real shipped en-GB dictionary must parse into a usable form.
#[test]
fn parses_the_shipped_dictionary() {
    // Skip when the dictionary was never fetched (asset deliberately not committed).
    let dict = match load_real_dictionary() {
        Some(d) => d,
        None => {
            // Branch: index files absent — nothing to test against; skip quietly with guidance.
            eprintln!("skipping: en-GB dictionary not found at packages/app/public/dictionaries/en-GB (run `npm run fetch-dictionary`)");
            return;
        }
    };

    // The real asset parses into a usable dictionary. This is the assertion the in-memory unit tests
    // cannot make — they only prove the wiring around spellbook, never that the shipped pair itself loads.
    assert!(
        dict.check("the"),
        "shipped dictionary should accept the common word 'the'"
    );
}

/// Ordinary words are accepted and nonsense words are rejected by the real asset.
#[test]
fn accepts_ordinary_words_and_rejects_nonsense() {
    // Skip when the dictionary was never fetched (asset deliberately not committed).
    let dict = match load_real_dictionary() {
        Some(d) => d,
        None => {
            // Branch: index files absent — nothing to test against; skip quietly with guidance.
            eprintln!("skipping: en-GB dictionary not found at packages/app/public/dictionaries/en-GB (run `npm run fetch-dictionary`)");
            return;
        }
    };

    // Ordinary words a document would actually contain must all be accepted by the real asset.
    for word in ["hello", "document", "editor", "paragraph", "the"] {
        assert!(
            dict.check(word),
            "expected '{word}' to be accepted by the en-GB dictionary"
        );
    }

    // Nonsense words with no legitimate spelling must all be flagged as misspelled by the real asset.
    for word in ["wrold", "docment", "paragrpah", "zzzqqx"] {
        assert!(
            !dict.check(word),
            "expected '{word}' to be rejected by the en-GB dictionary"
        );
    }

    // This is what makes the squiggles trustworthy rather than merely present: a checker that accepts
    // nonsense or rejects real words produces red underlines nobody can rely on.
}

/// British spellings are accepted by the en-GB asset.
#[test]
fn accepts_british_spellings() {
    // Skip when the dictionary was never fetched (asset deliberately not committed).
    let dict = match load_real_dictionary() {
        Some(d) => d,
        None => {
            // Branch: index files absent — nothing to test against; skip quietly with guidance.
            eprintln!("skipping: en-GB dictionary not found at packages/app/public/dictionaries/en-GB (run `npm run fetch-dictionary`)");
            return;
        }
    };

    // British spellings must all be accepted by the en-GB asset rather than flagged as errors.
    for word in ["colour", "organise", "centre", "travelled"] {
        assert!(
            dict.check(word),
            "expected British spelling '{word}' to be accepted by the en-GB dictionary"
        );
    }

    // A silently-wrong locale would flag half a British user's document and look like the feature failing
    // rather than the wrong asset being loaded — this test catches that mismatch.
}

/// An obvious typo yields the correction the user actually meant.
#[test]
fn suggests_the_obvious_correction() {
    // Skip when the dictionary was never fetched (asset deliberately not committed).
    let dict = match load_real_dictionary() {
        Some(d) => d,
        None => {
            // Branch: index files absent — nothing to test against; skip quietly with guidance.
            eprintln!("skipping: en-GB dictionary not found at packages/app/public/dictionaries/en-GB (run `npm run fetch-dictionary`)");
            return;
        }
    };

    // Query a suggestion list for an obvious typo, collecting candidates into a fresh vector.
    let mut out = Vec::new();
    dict.suggest("wrold", &mut out);

    // The correction the user actually meant must appear in the candidate list.
    assert!(
        out.contains(&"world".to_string()),
        "expected 'world' to be suggested for 'wrold', got {out:?}"
    );

    // A suggestion list without the word the user meant is worse than no context menu: it tells the user
    // their spelling is fine when it is not, and erodes trust in every subsequent underline.
}
