//! @file spell.rs
//! @purpose Spell-check engine for K-Doc (FR-12.1). Provides Hunspell-compatible dictionary parsing, word checking, suggestion generation, and user dictionary word management.
//!
//! Note: This module implements the desktop spell-checking engine described in FR-12.1:
//! dictionary data is loaded into memory via `spellbook` (a pure-Rust Hunspell parser/checker),
//! and IPC commands allow the frontend editor to check words, query suggested corrections,
//! and manage a personal user word list.
//!
//! @inputs Webview IPC invoke requests (`spell_load`, `spell_check`, `spell_suggest`, `spell_add_word`, `spell_set_user_words`) containing affix/dictionary strings and word lists.
//! @outputs Misspelled word lists, suggestion candidates, word counts, and Result responses returned over IPC.
//! @functions
//!   - SpellState::new: Constructs a new uninitialised spell-check state container.
//!   - SpellState::is_loaded: Checks whether an active dictionary is currently loaded in state.
//!   - spell_load: Parses Hunspell .aff/.dic contents and updates state dictionary, returning user word count.
//!   - spell_check: Checks a list of words against user words and loaded dictionary, returning de-duplicated misspelled words.
//!   - spell_suggest: Generates spelling suggestions for a misspelled word, capped at 8 candidates.
//!   - spell_add_word: Inserts a trimmed non-empty custom word into the persistent user words set.
//!   - spell_set_user_words: Replaces the entire user words set with a new list of custom words.
//! @dataflow Webview IPC invoke -> command dispatch -> SpellState mutex lock -> SpellInner operation (dictionary check/suggest or user_words set) -> serialized Result returned over IPC.
//! @controlflow Tauri invoke handler dispatches command -> acquire mutex (recovering poisoning) -> invoke internal business logic -> return Result.
//! @version 2
//! @date 2026-09-18

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

/// Maximum number of suggestion candidates returned for a misspelled word.
const MAX_SUGGESTIONS: usize = 8;

/// Private inner state holding the loaded dictionary and user-defined words.
///
/// @purpose Stores the optional compiled Hunspell dictionary and custom user dictionary set.
struct SpellInner {
    /// Active in-memory Hunspell dictionary, if loaded.
    dictionary: Option<spellbook::Dictionary>,
    /// Language tag of the active dictionary (FR-12.3), when one is loaded.
    language: Option<String>,
    /// Dictionaries loaded earlier for other languages, kept so switching between documents does not parse again.
    parked: HashMap<String, spellbook::Dictionary>,
    /// Set of user-accepted custom words that override dictionary rejections.
    user_words: HashSet<String>,
}

impl SpellInner {
    /// Creates a new, empty `SpellInner` instance.
    ///
    /// @purpose Initialises inner state with no dictionary and an empty user word set.
    /// @inputs None.
    /// @outputs SpellInner - Empty inner state container.
    /// @dataflow None + empty HashSet -> SpellInner.
    /// @controlflow Construct SpellInner struct with None and empty HashSet.
    fn new() -> Self {
        SpellInner {
            dictionary: None,
            language: None,
            parked: HashMap::new(),
            user_words: HashSet::new(),
        }
    }
}

/// Application state container managing the active spell-check engine.
///
/// @purpose Holds a thread-safe mutex wrapping `SpellInner` for K-Doc (FR-12.1).
pub struct SpellState {
    /// Thread-safe mutex wrapping the inner spell-checking state.
    inner: Mutex<SpellInner>,
}

impl SpellState {
    /// Creates a new, uninitialised `SpellState` holding no active dictionary.
    ///
    /// @purpose Initialises the state container with default inner state.
    /// @inputs None.
    /// @outputs SpellState - Returns a state instance with `inner` set to `Mutex::new(SpellInner::new())`.
    /// @dataflow SpellInner::new() -> Mutex::new -> SpellState.
    /// @controlflow Construct default SpellInner -> wrap in Mutex -> construct SpellState.
    pub fn new() -> Self {
        SpellState {
            inner: Mutex::new(SpellInner::new()),
        }
    }

    /// Checks whether an active dictionary is currently loaded in state.
    ///
    /// @purpose Inquires if the spell checker has a valid dictionary loaded.
    /// @inputs &self - Reference to the SpellState instance.
    /// @outputs bool - Returns true if a dictionary is loaded, false otherwise.
    /// @dataflow self.inner mutex lock -> Option::is_some -> boolean status.
    /// @controlflow Lock inner mutex (recovering poisoning) -> evaluate if dictionary is Some -> return bool.
    #[cfg(test)]
    pub fn is_loaded(&self) -> bool {
        // Recover a poisoned mutex with unwrap_or_else rather than propagating:
        // a poisoned lock means some earlier call panicked, and refusing to spell-check
        // for the rest of the session compounds one failure into a permanent one.
        let guard = self.inner.lock().unwrap_or_else(|e| {
            // Branch: Mutex was poisoned by a previous panic; recover guard to read state.
            e.into_inner()
        });

        // Check if an active dictionary is loaded in inner state.
        if guard.dictionary.is_some() {
            // Branch: Dictionary is present; engine is loaded.
            true
        } else {
            // Branch: Dictionary is None; engine is not loaded.
            false
        }
    }
}

impl Default for SpellState {
    /// Returns the default empty `SpellState`.
    ///
    /// @purpose Delegates to `SpellState::new()` for default trait compatibility.
    /// @inputs None.
    /// @outputs SpellState - Default empty spell state.
    /// @dataflow SpellState::new() -> SpellState.
    /// @controlflow Call SpellState::new() -> return instance.
    fn default() -> Self {
        Self::new()
    }
}

/// Parses affix and dictionary text and replaces the active dictionary in state.
///
/// @purpose Internal implementation of dictionary loading decoupled from Tauri state for testability.
/// @inputs inner - Mutable reference to the SpellInner container.
/// @inputs aff - String slice containing Hunspell affix (.aff) rules.
/// @inputs dic - String slice containing Hunspell wordlist (.dic) entries.
/// @outputs Result<usize, String> - Number of retained user words on success, or descriptive parse error.
/// @dataflow aff and dic text -> spellbook::Dictionary::new -> inner.dictionary -> return user_words.len().
/// @controlflow Parse aff/dic with spellbook -> if error return Err naming parse failure -> if ok store dictionary in inner -> return Ok(user_words count).
fn inner_load(inner: &mut SpellInner, language: &str, aff: &str, dic: &str) -> Result<usize, String> {
    // Attempt to parse the Hunspell affix and dictionary definitions into a compiled dictionary.
    let dict = match spellbook::Dictionary::new(aff, dic) {
        Ok(d) => {
            // Branch: Dictionary parsed successfully; retain compiled dictionary.
            d
        }
        Err(err) => {
            // Branch: Dictionary parsing failed; reject with descriptive error.
            // The aff/dic pair is user-supplied data, and a corrupt one must report clearly
            // rather than leaving the feature silently dead.
            return Err(format!("Dictionary parse error: {err}"));
        }
    };

    // The dictionary in use steps aside rather than being dropped; a parked copy of this language is replaced.
    park_active(inner);
    inner.parked.remove(language);
    inner.dictionary = Some(dict);
    inner.language = Some(language.to_string());
    Ok(inner.user_words.len())
}

/// Moves the active dictionary into the parked map under its language.
///
/// @purpose Keeps a parsed dictionary for later instead of dropping it when another language becomes active (FR-12.3).
/// @inputs inner - The spell state.
/// @outputs None; the active dictionary and language are cleared.
/// @dataflow inner.dictionary + inner.language -> inner.parked[language].
/// @controlflow Only a dictionary with a known language is parked; one without is dropped.
fn park_active(inner: &mut SpellInner) {
    let dictionary = inner.dictionary.take();
    let language = inner.language.take();
    // Check that there is both a dictionary and a language to file it under.
    if let (Some(dictionary), Some(language)) = (dictionary, language) {
        inner.parked.insert(language, dictionary);
    } else {
        // Nothing active, or nothing to name it by: nothing to keep.
    }
}

/// Makes an already-loaded dictionary the active one.
///
/// @purpose Switches language without reading or parsing a dictionary again (FR-12.3).
/// @inputs inner - The spell state. language - The language tag wanted.
/// @outputs bool - true when that language is now active; false when it has not been loaded.
/// @dataflow inner.parked[language] -> inner.dictionary; the previous active dictionary -> inner.parked.
/// @controlflow Already active -> true; parked -> swap in -> true; otherwise false with nothing changed.
fn inner_select(inner: &mut SpellInner, language: &str) -> bool {
    // Check whether the language is already the active one.
    if inner.language.as_deref() == Some(language) && inner.dictionary.is_some() {
        return true;
    } else {
        // Not active: look for it among the parked dictionaries.
    }
    // Check whether it was loaded before.
    if !inner.parked.contains_key(language) {
        return false;
    } else {
        // Loaded before: swap it in.
    }
    park_active(inner);
    inner.dictionary = inner.parked.remove(language);
    inner.language = Some(language.to_string());
    true
}

/// Loads a dictionary for a language into shared state; the entry point for the dictionary cache (FR-12.3).
///
/// @purpose Lets spell_cache.rs load a dictionary it read from disk or was sent without reaching into SpellInner.
/// @inputs state - The spell state. language, aff, dic - The language tag and the Hunspell file contents.
/// @outputs Result<usize, String> - The number of user words, or the parse error.
/// @dataflow lock -> inner_load.
/// @controlflow Recovers a poisoned lock, as every command here does.
pub(crate) fn load_language(state: &SpellState, language: &str, aff: &str, dic: &str) -> Result<usize, String> {
    let mut guard = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    inner_load(&mut guard, language, aff, dic)
}

/// Evaluates a list of words and returns the de-duplicated subset of misspelled words.
///
/// @purpose Internal implementation of spell-checking decoupled from Tauri state for testability.
/// @inputs inner - Reference to the SpellInner container.
/// @inputs words - Vector of word strings to validate.
/// @outputs Vec<String> - List of unique misspelled words in first-seen order.
/// @dataflow words -> check against user_words -> check against dictionary -> check lowercase against dictionary -> de-duplicate -> Vec<String>.
/// @controlflow Check if dictionary is loaded (None returns empty Vec) -> iterate words -> if in user_words skip -> if dict.check() true skip -> if lowercase dict.check() true skip -> if first time seen push to misspelled -> return misspelled.
fn inner_check(inner: &SpellInner, words: Vec<String>) -> Vec<String> {
    // Check if a dictionary is currently loaded.
    let dict = match &inner.dictionary {
        Some(d) => {
            // Branch: Dictionary is loaded; proceed to check words.
            d
        }
        None => {
            // Branch: No dictionary is loaded; return an empty list of misspelled words.
            // Reporting nothing wrong is the right failure mode for a missing dictionary:
            // the alternative, treating every word as misspelled, would fill the document with
            // red wavy underlines and be blamed on the user's text rather than the missing dictionary.
            return Vec::new();
        }
    };

    let mut seen = HashSet::new();
    let mut misspelled = Vec::new();

    for word in words {
        // Check if the word is in the user's personal word list.
        if inner.user_words.contains(&word) {
            // Branch: Word found in personal user dictionary; treat as correct.
            continue;
        } else {
            // Branch: Word not found in user dictionary; test against the active dictionary.
        }

        // Check if the dictionary accepts the word in its original casing.
        if dict.check(&word) {
            // Branch: Dictionary accepts the original casing; treat as correct.
            continue;
        } else {
            // Branch: Dictionary rejected original casing; attempt lowercase retry.
        }

        // Retry checking the lowercase form of the word.
        // The lowercase retry is what stops a sentence-initial "The" being flagged
        // when the dictionary stores "the".
        let lower = word.to_lowercase();
        if dict.check(&lower) {
            // Branch: Dictionary accepts lowercase form; treat as correct.
            continue;
        } else {
            // Branch: Word rejected in both original and lowercase casing; word is misspelled.
        }

        // De-duplicate the misspelled result while preserving first-seen order:
        // the caller decorates every occurrence, so returning the same word twenty times
        // is twenty times the IPC payload for no extra information.
        if seen.insert(word.clone()) {
            // Branch: First time this misspelled word has been encountered; record it.
            misspelled.push(word);
        } else {
            // Branch: Duplicate occurrence of previously seen misspelled word; skip.
        }
    }

    misspelled
}

/// Generates spelling correction suggestions for a word, capped at 8 candidates.
///
/// @purpose Internal implementation of spelling suggestions decoupled from Tauri state for testability.
/// @inputs inner - Reference to the SpellInner container.
/// @inputs word - String slice of the word to generate suggestions for.
/// @outputs Vec<String> - Suggested correction candidates, capped at 8 entries.
/// @dataflow word -> dict.suggest -> truncate to 8 -> Vec<String>.
/// @controlflow Check if dictionary is loaded (None returns empty Vec) -> query suggestions -> truncate if > 8 -> return suggestions.
fn inner_suggest(inner: &SpellInner, word: &str) -> Vec<String> {
    // Check if a dictionary is currently loaded.
    let dict = match &inner.dictionary {
        Some(d) => {
            // Branch: Dictionary is loaded; proceed to query suggestions.
            d
        }
        None => {
            // Branch: No dictionary is loaded; return an empty vector rather than an error.
            return Vec::new();
        }
    };

    let mut suggestions = Vec::new();
    dict.suggest(word, &mut suggestions);

    // Cap suggestions at MAX_SUGGESTIONS (8) entries.
    // The cap exists because a context menu with forty entries is not a menu.
    if suggestions.len() > MAX_SUGGESTIONS {
        // Branch: Suggestions exceed display limit; truncate to MAX_SUGGESTIONS entries.
        suggestions.truncate(MAX_SUGGESTIONS);
    } else {
        // Branch: Suggestions within display limit; keep all.
    }

    suggestions
}

/// Inserts a trimmed non-empty custom word into the user dictionary.
///
/// @purpose Internal implementation of adding a user word decoupled from Tauri state for testability.
/// @inputs inner - Mutable reference to the SpellInner container.
/// @inputs word - String slice of the word to add.
/// @outputs Result<(), String> - Ok(()) on success, or Err if word is empty or whitespace-only.
/// @dataflow word -> trim -> validate non-empty -> insert into inner.user_words -> Ok(()).
/// @controlflow Trim word -> check if empty (return Err if empty) -> insert into HashSet -> return Ok(()).
fn inner_add_word(inner: &mut SpellInner, word: &str) -> Result<(), String> {
    let trimmed = word.trim();

    // Check if the trimmed word is empty.
    if trimmed.is_empty() {
        // Branch: Word is empty or whitespace-only; reject with descriptive error.
        // An empty entry would silently match nothing and look like the feature failing.
        return Err("Cannot add empty or whitespace-only word to user dictionary".to_string());
    } else {
        // Branch: Word contains non-whitespace characters; proceed to insert.
    }

    inner.user_words.insert(trimmed.to_string());
    Ok(())
}

/// Replaces the entire user dictionary with a new list of custom words.
///
/// @purpose Internal implementation of replacing user words decoupled from Tauri state for testability.
/// @inputs inner - Mutable reference to the SpellInner container.
/// @inputs words - Vector of custom words to populate the personal dictionary.
/// @outputs Result<(), String> - Ok(()) on successful replacement.
/// @dataflow words -> trim and filter non-empty -> collect into HashSet -> inner.user_words -> Ok(()).
/// @controlflow Iterate words -> trim and filter non-empty -> construct new HashSet -> replace inner.user_words -> return Ok(()).
fn inner_set_user_words(inner: &mut SpellInner, words: Vec<String>) -> Result<(), String> {
    let mut new_set = HashSet::with_capacity(words.len());
    for w in words {
        let trimmed = w.trim();
        // Check if word entry is non-empty.
        if !trimmed.is_empty() {
            // Branch: Non-empty word entry; insert into user word set.
            new_set.insert(trimmed.to_string());
        } else {
            // Branch: Empty or whitespace-only entry; skip to avoid ghost entries.
        }
    }
    inner.user_words = new_set;
    Ok(())
}

/// Loads a Hunspell dictionary from affix and dictionary contents into application state.
///
/// @purpose Compiles Hunspell .aff and .dic data and stores the resulting dictionary in SpellState (FR-12.1).
/// @inputs state - Tauri application state container managing SpellState.
/// @inputs aff - String containing Hunspell affix (.aff) rules.
/// @inputs dic - String containing Hunspell wordlist (.dic) entries.
/// @outputs Result<usize, String> - Number of retained user words on success, or descriptive parse error.
/// @dataflow (aff, dic) -> inner_load -> update state.inner.dictionary -> Ok(user_words count).
/// @controlflow Acquire state lock (recovering poisoning) -> delegate to inner_load -> return Result.
#[tauri::command]
pub fn spell_load(
    state: tauri::State<'_, SpellState>,
    language: String,
    aff: String,
    dic: String,
) -> Result<usize, String> {
    // Recover a poisoned mutex with unwrap_or_else rather than propagating:
    // a poisoned lock means some earlier call panicked, and refusing to spell-check
    // for the rest of the session compounds one failure into a permanent one.
    let mut guard = state.inner.lock().unwrap_or_else(|e| {
        // Branch: Mutex was poisoned by a previous panic; recover inner state.
        e.into_inner()
    });

    inner_load(&mut guard, &language, &aff, &dic)
}

/// Makes a dictionary loaded earlier the active one (FR-12.3).
///
/// @purpose Switches the spelling language when the reader moves to a document in another language.
/// @inputs state - Tauri spell state. language - The language tag wanted.
/// @outputs bool - true when the language is now active; false when it has never been loaded this session.
/// @dataflow language -> lock -> inner_select.
/// @controlflow Recovers a poisoned lock, then delegates.
#[tauri::command]
pub fn spell_select(state: tauri::State<'_, SpellState>, language: String) -> bool {
    let mut guard = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    inner_select(&mut guard, &language)
}

/// Checks a list of words against the loaded dictionary and personal word list.
///
/// @purpose Identifies misspelled words among the input list, returning de-duplicated results in order (FR-12.1).
/// @inputs state - Tauri application state container managing SpellState.
/// @inputs words - Vector of words to check for spelling errors.
/// @outputs Result<Vec<String>, String> - List of unique misspelled words in first-seen order.
/// @dataflow words -> state.inner lock -> inner_check -> Ok(misspelled words).
/// @controlflow Acquire state lock (recovering poisoning) -> delegate to inner_check -> return Ok(misspelled).
#[tauri::command]
pub fn spell_check(
    state: tauri::State<'_, SpellState>,
    words: Vec<String>,
) -> Result<Vec<String>, String> {
    // Recover a poisoned mutex with unwrap_or_else rather than propagating:
    // a poisoned lock means some earlier call panicked, and refusing to spell-check
    // for the rest of the session compounds one failure into a permanent one.
    let guard = state.inner.lock().unwrap_or_else(|e| {
        // Branch: Mutex was poisoned by a previous panic; recover inner state.
        e.into_inner()
    });

    Ok(inner_check(&guard, words))
}

/// Generates spelling correction suggestions for a single word.
///
/// @purpose Queries the loaded dictionary for spelling suggestions, capped at 8 candidates (FR-12.1).
/// @inputs state - Tauri application state container managing SpellState.
/// @inputs word - The misspelled word string to suggest corrections for.
/// @outputs Result<Vec<String>, String> - List of up to 8 suggested replacement words.
/// @dataflow word -> state.inner lock -> inner_suggest -> Ok(suggestions).
/// @controlflow Acquire state lock (recovering poisoning) -> delegate to inner_suggest -> return Ok(suggestions).
#[tauri::command]
pub fn spell_suggest(
    state: tauri::State<'_, SpellState>,
    word: String,
) -> Result<Vec<String>, String> {
    // Recover a poisoned mutex with unwrap_or_else rather than propagating:
    // a poisoned lock means some earlier call panicked, and refusing to spell-check
    // for the rest of the session compounds one failure into a permanent one.
    let guard = state.inner.lock().unwrap_or_else(|e| {
        // Branch: Mutex was poisoned by a previous panic; recover inner state.
        e.into_inner()
    });

    Ok(inner_suggest(&guard, &word))
}

/// Adds a word to the user's personal dictionary.
///
/// @purpose Inserts a trimmed non-empty custom word into the persistent user dictionary (FR-12.1).
/// @inputs state - Tauri application state container managing SpellState.
/// @inputs word - Custom word string to add to user words.
/// @outputs Result<(), String> - Ok(()) on success, or Err if word is empty or whitespace-only.
/// @dataflow word -> state.inner lock -> inner_add_word -> Ok(()).
/// @controlflow Acquire state lock (recovering poisoning) -> delegate to inner_add_word -> return Result.
#[tauri::command]
pub fn spell_add_word(
    state: tauri::State<'_, SpellState>,
    word: String,
) -> Result<(), String> {
    // Recover a poisoned mutex with unwrap_or_else rather than propagating:
    // a poisoned lock means some earlier call panicked, and refusing to spell-check
    // for the rest of the session compounds one failure into a permanent one.
    let mut guard = state.inner.lock().unwrap_or_else(|e| {
        // Branch: Mutex was poisoned by a previous panic; recover inner state.
        e.into_inner()
    });

    inner_add_word(&mut guard, &word)
}

/// Replaces the user's entire personal dictionary with a provided word list.
///
/// @purpose Restores persisted user dictionary words on application startup (FR-12.1).
/// @inputs state - Tauri application state container managing SpellState.
/// @inputs words - Vector of custom word strings to populate into user words.
/// @outputs Result<(), String> - Ok(()) on successful replacement.
/// @dataflow words -> state.inner lock -> inner_set_user_words -> Ok(()).
/// @controlflow Acquire state lock (recovering poisoning) -> delegate to inner_set_user_words -> return Result.
#[tauri::command]
pub fn spell_set_user_words(
    state: tauri::State<'_, SpellState>,
    words: Vec<String>,
) -> Result<(), String> {
    // Recover a poisoned mutex with unwrap_or_else rather than propagating:
    // a poisoned lock means some earlier call panicked, and refusing to spell-check
    // for the rest of the session compounds one failure into a permanent one.
    let mut guard = state.inner.lock().unwrap_or_else(|e| {
        // Branch: Mutex was poisoned by a previous panic; recover inner state.
        e.into_inner()
    });

    inner_set_user_words(&mut guard, words)
}

#[cfg(test)]
mod tests {
    use super::*;

    // WHY these tests exist:
    // The spell-check engine is responsible for highlighting misspelled words (FR-12.1) without false
    // positives on capitalised words or user-added terminology, and providing concise context-menu
    // suggestions. These tests verify state initialization, dictionary parsing, casing rules, user word
    // precedence, candidate capping, and de-duplication without requiring an active Tauri runtime.

    /// Minimal Hunspell affix configuration string for testing.
    const TEST_AFF: &str = "SET UTF-8\n";

    /// Minimal Hunspell dictionary file content containing 4 stems.
    const TEST_DIC: &str = "4\napple\nbanana\nthe\norange\n";

    // Guards switching: a second language parks the first, and selecting the first brings it back without a reload.
    #[test]
    fn select_switches_between_loaded_languages() {
        let mut inner = SpellInner::new();
        inner_load(&mut inner, "en-GB", TEST_AFF, TEST_DIC).expect("english");
        inner_load(&mut inner, "fr", TEST_AFF, "1\npomme\n").expect("french");
        assert_eq!(inner.language.as_deref(), Some("fr"));
        assert_eq!(inner_check(&inner, vec!["apple".to_string()]), vec!["apple".to_string()]);
        assert!(inner_select(&mut inner, "en-GB"));
        assert_eq!(inner.language.as_deref(), Some("en-GB"));
        assert!(inner_check(&inner, vec!["apple".to_string()]).is_empty());
        assert!(inner.parked.contains_key("fr"));
        assert!(!inner.parked.contains_key("en-GB"));
    }

    // Guards selecting the language already in use: nothing moves.
    #[test]
    fn select_of_the_active_language_keeps_it() {
        let mut inner = SpellInner::new();
        inner_load(&mut inner, "en-GB", TEST_AFF, TEST_DIC).expect("english");
        assert!(inner_select(&mut inner, "en-GB"));
        assert!(inner.dictionary.is_some());
        assert!(inner.parked.is_empty());
    }

    // Guards selecting a language never loaded: refused, and the active dictionary stays.
    #[test]
    fn select_of_an_unloaded_language_changes_nothing() {
        let mut inner = SpellInner::new();
        inner_load(&mut inner, "en-GB", TEST_AFF, TEST_DIC).expect("english");
        assert!(!inner_select(&mut inner, "de"));
        assert_eq!(inner.language.as_deref(), Some("en-GB"));
        assert!(inner.dictionary.is_some());
    }

    // Guards reloading a parked language: the new copy replaces the parked one rather than sitting beside it.
    #[test]
    fn reloading_a_parked_language_replaces_it() {
        let mut inner = SpellInner::new();
        inner_load(&mut inner, "fr", TEST_AFF, "1\npomme\n").expect("french");
        inner_load(&mut inner, "en-GB", TEST_AFF, TEST_DIC).expect("english");
        inner_load(&mut inner, "fr", TEST_AFF, "1\npoire\n").expect("french again");
        assert!(!inner.parked.contains_key("fr"));
        assert!(inner_check(&inner, vec!["poire".to_string()]).is_empty());
    }

    #[test]
    fn spell_state_starts_unloaded() {
        // Pins: SpellState::new() reports is_loaded() false initially.
        let state = SpellState::new();
        assert!(!state.is_loaded());
    }

    #[test]
    fn spell_state_default_starts_unloaded() {
        // Pins: Default trait implementation initializes an unloaded SpellState.
        let state = SpellState::default();
        assert!(!state.is_loaded());
    }

    #[test]
    fn missing_dictionary_reports_no_misspellings() {
        // Pins: When no dictionary is loaded, spell_check returns an empty list.
        // Reporting nothing wrong avoids filling the document with false errors on startup.
        let inner = SpellInner::new();
        let words = vec!["apple".to_string(), "xyzzy".to_string()];
        let misspelled = inner_check(&inner, words);
        assert!(misspelled.is_empty());
    }

    #[test]
    fn missing_dictionary_reports_no_suggestions() {
        // Pins: When no dictionary is loaded, spell_suggest returns an empty list without error.
        let inner = SpellInner::new();
        let suggestions = inner_suggest(&inner, "apple");
        assert!(suggestions.is_empty());
    }

    #[test]
    fn in_memory_dictionary_checks_known_and_nonsense_words() {
        // Pins: A loaded dictionary accepts known words and flags nonsense words as misspelled.
        let mut inner = SpellInner::new();
        let count = inner_load(&mut inner, "en-GB", TEST_AFF, TEST_DIC).expect("valid test dictionary");
        assert_eq!(count, 0);

        let words = vec![
            "apple".to_string(),
            "xyzzy".to_string(),
            "banana".to_string(),
            "qwerty".to_string(),
        ];
        let misspelled = inner_check(&inner, words);
        assert_eq!(misspelled, vec!["xyzzy".to_string(), "qwerty".to_string()]);
    }

    #[test]
    fn lowercase_retry_accepts_capitalized_words() {
        // Pins: A dictionary containing lowercase "the" accepts capitalized "The" via lowercase retry,
        // preventing false positives for sentence-initial words.
        let mut inner = SpellInner::new();
        inner_load(&mut inner, "en-GB", TEST_AFF, TEST_DIC).expect("valid test dictionary");

        let words = vec!["The".to_string(), "Apple".to_string(), "Banana".to_string()];
        let misspelled = inner_check(&inner, words);
        assert!(misspelled.is_empty());
    }

    #[test]
    fn user_dictionary_word_is_accepted_even_if_dictionary_rejects() {
        // Pins: A word in the user dictionary is accepted even if the Hunspell dictionary rejects it.
        let mut inner = SpellInner::new();
        inner_load(&mut inner, "en-GB", TEST_AFF, TEST_DIC).expect("valid test dictionary");

        // "K-Doc" is not in TEST_DIC.
        let words = vec!["K-Doc".to_string()];
        let misspelled_before = inner_check(&inner, words.clone());
        assert_eq!(misspelled_before, vec!["K-Doc".to_string()]);

        // Add to user dictionary.
        inner_add_word(&mut inner, "K-Doc").expect("valid user word");
        let misspelled_after = inner_check(&inner, words);
        assert!(misspelled_after.is_empty());
    }

    #[test]
    fn user_word_empty_or_whitespace_is_rejected() {
        // Pins: Empty or whitespace-only words are rejected with an error.
        let mut inner = SpellInner::new();
        assert!(inner_add_word(&mut inner, "").is_err());
        assert!(inner_add_word(&mut inner, "   ").is_err());
    }

    #[test]
    fn set_user_words_replaces_set_and_survives_reload() {
        // Pins: inner_set_user_words replaces the word set, and inner_load returns retained user word count.
        let mut inner = SpellInner::new();
        inner_set_user_words(
            &mut inner,
            vec!["custom1".to_string(), "custom2".to_string()],
        )
        .expect("set user words succeeds");
        assert_eq!(inner.user_words.len(), 2);

        let count = inner_load(&mut inner, "en-GB", TEST_AFF, TEST_DIC).expect("reload dictionary");
        assert_eq!(count, 2);
    }

    #[test]
    fn suggestions_are_capped_at_eight() {
        // Pins: Suggestions returned by inner_suggest are capped at MAX_SUGGESTIONS (8).
        let mut inner = SpellInner::new();
        // Create a dictionary with many words similar to "test".
        let aff = "SET UTF-8\n";
        let dic = "12\ntest\ntests\ntester\ntesting\ntested\ntesty\ntestee\ntestor\ntestudos\ntesters\ntestate\ntestbed\n";
        inner_load(&mut inner, "en-GB", aff, dic).expect("valid test dictionary");

        let suggestions = inner_suggest(&inner, "tst");
        assert!(suggestions.len() <= 8);
    }

    #[test]
    fn duplicate_input_words_produce_one_output_entry() {
        // Pins: Duplicate misspelled words produce only one entry in the output vector,
        // preserving first-seen order.
        let mut inner = SpellInner::new();
        inner_load(&mut inner, "en-GB", TEST_AFF, TEST_DIC).expect("valid test dictionary");

        let words = vec![
            "badword1".to_string(),
            "apple".to_string(),
            "badword2".to_string(),
            "badword1".to_string(),
            "badword2".to_string(),
            "badword1".to_string(),
        ];
        let misspelled = inner_check(&inner, words);
        assert_eq!(
            misspelled,
            vec!["badword1".to_string(), "badword2".to_string()]
        );
    }

    #[test]
    fn corrupt_dictionary_returns_parse_error() {
        // Pins: Corrupt or malformed dictionary data fails with a descriptive parse error.
        let mut inner = SpellInner::new();
        // Invalid dic format: row count is not a valid number.
        let bad_dic = "not_a_number\nword\n";
        let res = inner_load(&mut inner, "en-GB", TEST_AFF, bad_dic);
        assert!(res.is_err());
        let err_msg = res.unwrap_err();
        assert!(err_msg.contains("Dictionary parse error"));
    }
}
