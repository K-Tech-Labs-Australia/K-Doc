/**
 * @file spell-service.ts
 * @purpose Webview-side spell check service for K-Doc (FR-12.1), providing dictionary loading over webview origin,
 *   IPC wrappers over native Tauri spell commands, in-memory session ignore list, and persistent user dictionary.
 * @inputs SpellServiceOptions containing Window context, optional onError callback, and optional fetchImpl;
 *   Hunspell dictionary files fetched over webview origin; Tauri IPC command responses.
 * @outputs DICTIONARY_BASE_PATH and USER_DICTIONARY_STORAGE_KEY constants, SpellServiceOptions and SpellService interfaces,
 *   and createSpellService factory function.
 * @functions
 *   - isTauri: Probes whether the runtime is a Tauri host via __TAURI_INTERNALS__ without throwing exceptions.
 *   - loadUserWordsFromStorage: Retrieves and parses user dictionary words from localStorage, starting empty on missing/corrupt data.
 *   - saveUserWordsToStorage: Persists user dictionary words to localStorage as a JSON array inside a guarded try/catch.
 *   - createSpellService: Factory constructing the SpellService client adapter bound to the provided window context.
 * @dataflow Webview origin dictionary fetch -> Tauri spell_load IPC -> spell_check / spell_suggest IPC;
 *   user dictionary -> localStorage -> in-memory Set -> Tauri spell_add_word / spell_set_user_words.
 * @controlflow Capability probe via isTauri(win) -> load user words from localStorage -> return SpellService ->
 *   loadDictionary fetches .aff/.dic and pushes user words to Rust -> check filters ignored/user words and queries Rust ->
 *   addWord persists to localStorage and informs Rust -> destroy marks service inert and clears session state.
 * @version 2
 * @date 2026-09-18
 */

import { invoke } from '@tauri-apps/api/core';
import { dictionaryCandidates } from '@k-doc/core';

/**
 * Base path relative to webview origin where language dictionary assets are served.
 */
export const DICTIONARY_BASE_PATH: string = 'dictionaries';

/** Where dictionaries for other languages are downloaded from, with the reader's agreement (FR-12.3). */
export const DICTIONARY_SOURCE_URL: string = 'https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries';

/** The same source, as a reader would recognise it. */
export const DICTIONARY_SOURCE_NAME: string = 'github.com/wooorm/dictionaries';

/**
 * Key used to persist the user's custom dictionary words array in browser localStorage.
 */
export const USER_DICTIONARY_STORAGE_KEY: string = 'kdoc.userDictionary';

/**
 * Options for configuring and instantiating the spell check service.
 */
export interface SpellServiceOptions {
  readonly win: Window;
  readonly onError?: (error: Error) => void;
  /** Injectable for tests. Defaults to win.fetch bound to win. */
  readonly fetchImpl?: (input: string) => Promise<Response>;
}

/**
 * Public interface for interacting with the spell checking subsystem.
 */
export interface SpellService {
  readonly available: boolean;
  readonly loaded: boolean;
  loadDictionary(language: string): Promise<boolean>;
  /** Downloads and keeps a dictionary for a language; resolves with the name it was installed under (FR-12.3). */
  downloadDictionary(language: string): Promise<string>;
  check(words: readonly string[]): Promise<readonly string[]>;
  suggest(word: string): Promise<readonly string[]>;
  addWord(word: string): Promise<void>;
  ignoreAll(word: string): void;
  isIgnored(word: string): boolean;
  readonly userWords: readonly string[];
  destroy(): void;
}

/**
 * Narrow local interface extending the browser Window to declare Tauri runtime internals.
 */
interface TauriWindow extends Window {
  readonly __TAURI_INTERNALS__?: unknown;
}

/**
 * Checks whether the application is running inside a Tauri desktop host environment.
 *
 * @purpose Determines desktop runtime availability by detecting the Tauri global without throwing exceptions.
 * @inputs win - The browser Window object to inspect.
 * @outputs boolean - True if running inside Tauri host, false otherwise.
 * @dataflow Window object -> '__TAURI_INTERNALS__' property presence check -> boolean capability status.
 * @controlflow Inspect '__TAURI_INTERNALS__' in window -> return true if present, false if absent.
 */
function isTauri(win: Window): boolean {
  // Checking for the __TAURI_INTERNALS__ global is how the Tauri runtime announces itself.
  // Checking this property is preferable to a try/catch around a failing invoke,
  // because a capability check should not be implemented as an exception.
  const candidate = win as unknown as TauriWindow;

  // Check if '__TAURI_INTERNALS__' exists on the window object.
  if ('__TAURI_INTERNALS__' in candidate) {
    // Branch: Running inside Tauri desktop runtime host.
    return true;
  } else {
    // Branch: Running inside standard browser environment.
    return false;
  }
}

/**
 * Loads the stored user dictionary word list from localStorage, recovering gracefully from missing or malformed data.
 *
 * @purpose Reads and parses the user dictionary from browser storage, returning an empty set on missing/corrupt data.
 * @inputs win - The Window object providing localStorage access.
 * @outputs Set<string> - The set of unique user dictionary words.
 * @dataflow win.localStorage.getItem -> JSON.parse -> type check array of strings -> Set<string>.
 * @controlflow Wrap localStorage in try/catch -> if item null or throws return empty Set -> parse JSON -> verify is array -> filter string elements -> return Set.
 */
function loadUserWordsFromStorage(win: Window): Set<string> {
  const words = new Set<string>();

  // Guard every localStorage access in try/catch exactly the way settings-store.ts does.
  // Private-browsing modes and storage-blocking settings make localStorage throw on access
  // rather than merely returning null, so an unguarded read takes the whole editor down.
  // This is where the user dictionary lives rather than settings.json, because settings.json
  // is a validated schema of settings and an unbounded word list is data, not configuration.
  try {
    const raw = win.localStorage.getItem(USER_DICTIONARY_STORAGE_KEY);

    // Check if the user dictionary key exists in localStorage.
    if (raw === null) {
      // Branch: First run or missing storage key; start with an empty set.
      return words;
    } else {
      // Branch: Stored string exists; attempt JSON parsing.
    }

    // A corrupt personal dictionary must not stop the editor from opening,
    // and the worst case is the user re-adding a few words.
    const parsed: unknown = JSON.parse(raw);

    // Check if parsed payload is an array.
    if (!Array.isArray(parsed)) {
      // Branch: Payload is not a JSON array; ignore and return empty set.
      return words;
    } else {
      // Branch: Payload is an array; extract non-empty trimmed strings.
    }

    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i];
      // Check if element is defined under strict indexing.
      if (item === undefined) {
        // Branch: Element is undefined; skip iteration.
        continue;
      } else {
        // Branch: Element is defined; check if it is a string.
      }

      // Check if item is a string.
      if (typeof item === 'string') {
        const trimmed = item.trim();
        // Check if trimmed item is non-empty.
        if (trimmed.length > 0) {
          // Branch: Valid non-empty word string; add to set.
          words.add(trimmed);
        } else {
          // Branch: Whitespace-only string; skip.
        }
      } else {
        // Branch: Non-string element in array; skip.
      }
    }
  } catch {
    // Branch: JSON parsing failed or localStorage access threw; return empty set without throwing.
  }

  return words;
}

/**
 * Persists the user dictionary word list to localStorage as a JSON array.
 *
 * @purpose Serializes and stores the user words list into browser storage, catching any quota or security exceptions.
 * @inputs
 *   - win - The Window object providing localStorage access.
 *   - words - The collection of user dictionary words to persist.
 * @outputs void.
 * @dataflow words Set -> Array.from -> JSON.stringify -> win.localStorage.setItem.
 * @controlflow Wrap localStorage in try/catch -> serialize to JSON string -> write to localStorage -> catch errors silently.
 */
function saveUserWordsToStorage(win: Window, words: ReadonlySet<string>): void {
  // Guard every localStorage access in try/catch exactly the way settings-store.ts does.
  // Private-browsing modes, storage-blocking settings, or quota limits make localStorage throw
  // rather than merely returning null, and a failed write should not crash the editor.
  // This is where the user dictionary lives rather than settings.json, because settings.json
  // is a validated schema of settings and an unbounded word list is data, not configuration.
  try {
    const list = Array.from(words);
    const serialized = JSON.stringify(list);
    win.localStorage.setItem(USER_DICTIONARY_STORAGE_KEY, serialized);
  } catch {
    // Branch: Storage write threw an exception; safely swallow to prevent crashing the editor.
  }
}

/**
 * Instantiates and activates the spell-check client adapter service for K-Doc (FR-12.1).
 *
 * @purpose Constructs a SpellService managing dictionary acquisition, IPC commands, and word filtering.
 * @inputs options - SpellServiceOptions specifying the window context, error callback, and fetch implementation.
 * @outputs SpellService - Controller interface exposing availability, dictionary loading, word checking, suggestions, and user words.
 * @dataflow SpellServiceOptions -> capability check & localStorage hydration -> SpellService controller interface.
 * @controlflow Probe Tauri runtime availability -> hydrate user words from localStorage -> initialize session ignore set ->
 *   construct methods wrapped with error handling and destroyed guards -> return SpellService instance.
 */
export function createSpellService(options: SpellServiceOptions): SpellService {
  const available = isTauri(options.win);
  let loaded: boolean = false;
  let destroyed: boolean = false;

  const userWordsSet: Set<string> = loadUserWordsFromStorage(options.win);
  const ignoredSet: Set<string> = new Set<string>();

  /**
   * Helper to report errors to the optional onError callback without throwing.
   *
   * @purpose Dispatches caught errors to options.onError, wrapping non-Error values as Error instances.
   * @inputs err - The unknown error value caught during an operation.
   * @outputs void.
   * @dataflow err -> type check / wrapping -> options.onError(Error).
   * @controlflow Check if options.onError exists -> check err instanceof Error -> call onError.
   */
  function reportError(err: unknown): void {
    // Check if an error callback was provided in options.
    if (options.onError !== undefined) {
      // Check if the caught error is an instance of Error.
      if (err instanceof Error) {
        // Branch: Forward Error instance directly to onError.
        options.onError(err);
      } else {
        // Branch: Wrap non-Error value in an Error instance.
        options.onError(new Error(String(err)));
      }
    } else {
      // Branch: No error callback registered; silently ignore error.
    }
  }

  // Resolve the fetch implementation, defaulting to win.fetch bound to win.
  let fetchFn: (input: string) => Promise<Response>;
  // Check if a custom fetch implementation was provided.
  if (options.fetchImpl !== undefined) {
    // Branch: Custom fetch implementation supplied; use it directly.
    fetchFn = options.fetchImpl;
  } else if (typeof options.win.fetch === 'function') {
    // Branch: Default to window.fetch bound to the window context.
    fetchFn = options.win.fetch.bind(options.win);
  } else {
    // Branch: Fetch is completely absent on window; fallback to rejecting stub.
    fetchFn = async (): Promise<Response> => {
      throw new Error('fetch is not available on window');
    };
  }

  /**
   * Makes the dictionary for a language the one in use, from wherever it can be found without downloading (FR-12.3).
   *
   * @purpose Switches to a dictionary loaded earlier this session, or loads the bundled one, or one downloaded before.
   * @inputs language - The language tag (e.g. 'en-GB', 'fr').
   * @outputs Promise<boolean> - true when a dictionary for the language is in use; false when none is available here.
   * @dataflow language -> spell_select -> loadBundledDictionary -> spell_load_cached -> spell_set_user_words.
   * @controlflow Stops at the first source that has it. A false result leaves loaded false, so no document is checked
   *   against a dictionary for another language.
   */
  async function loadDictionary(language: string): Promise<boolean> {
    // Check the service can load anything at all.
    if (!available || destroyed) {
      return false;
    } else {
      // Desktop and alive: find the dictionary.
    }

    // A dictionary loaded earlier this session is switched to without reading it again (FR-12.3).
    let selected: boolean;
    try {
      selected = await invoke<boolean>('spell_select', { language });
    } catch (err: unknown) {
      reportError(err);
      loaded = false;
      return false;
    }
    // Check whether the switch succeeded, and that nobody destroyed the service meanwhile.
    if (destroyed) {
      return false;
    } else if (selected) {
      loaded = true;
      return true;
    } else {
      // Not loaded before: try the dictionary that ships with the app.
    }

    // Check the bundled dictionary, which only exists for the default language.
    if (await loadBundledDictionary(language)) {
      return true;
    } else {
      // Not bundled: try one downloaded earlier.
    }
    // Check that the service is still alive after the bundled attempt.
    if (destroyed) {
      return false;
    } else {
      // Alive: ask for the cached copy.
    }

    let cached: boolean;
    try {
      cached = await invoke<boolean>('spell_load_cached', { language });
    } catch (err: unknown) {
      reportError(err);
      loaded = false;
      return false;
    }
    // Check whether a downloaded copy was found.
    if (destroyed || !cached) {
      loaded = false;
      return false;
    } else {
      loaded = true;
    }
    await pushUserWords();
    return true;
  }

  /**
   * Sends the user's own words to Rust, which starts every launch without them.
   *
   * @purpose Keeps personal words accepted whichever dictionary is in use.
   * @inputs void.
   * @outputs Promise<void> - Settles once sent; a failure is reported, not thrown.
   * @dataflow userWordsSet -> spell_set_user_words.
   * @controlflow One invoke, errors reported through onError.
   */
  async function pushUserWords(): Promise<void> {
    try {
      await invoke<void>('spell_set_user_words', { words: Array.from(userWordsSet) });
    } catch (err: unknown) {
      reportError(err);
    }
  }

  /**
   * Downloads a dictionary for a language and installs it for this and later sessions (FR-12.3).
   *
   * @purpose Fetches the Hunspell files from wooorm/dictionaries — only when the reader has agreed — and hands them to
   *   Rust, which parses them before keeping them on disk.
   * @inputs language - The language tag wanted.
   * @outputs Promise<string> - The name the dictionary was installed under (the full tag, or its primary language).
   * @dataflow dictionaryCandidates -> fetch index.aff + index.dic -> spell_install_dictionary -> spell_set_user_words.
   * @controlflow A candidate that is not published (404) is skipped; any other HTTP failure, a network failure or a
   *   parse failure rejects. When no candidate exists the rejection says so.
   */
  async function downloadDictionary(language: string): Promise<string> {
    // Check the desktop app is there to keep the dictionary.
    if (!available) {
      throw new Error('Downloading dictionaries requires the desktop app.');
    } else {
      // Desktop: go and fetch it.
    }
    for (const candidate of dictionaryCandidates(language)) {
      const base = `${DICTIONARY_SOURCE_URL}/${candidate}`;
      const [affRes, dicRes] = await Promise.all([fetchFn(`${base}/index.aff`), fetchFn(`${base}/index.dic`)]);
      // Check whether the dictionary is published under this name.
      if (affRes.status === 404 || dicRes.status === 404) {
        continue;
      } else if (!affRes.ok || !dicRes.ok) {
        throw new Error(`The download failed: HTTP ${!affRes.ok ? affRes.status : dicRes.status}.`);
      } else {
        // Found: read and install it.
      }
      const [aff, dic] = await Promise.all([affRes.text(), dicRes.text()]);
      // Check the service was not closed while the files arrived.
      if (destroyed) {
        throw new Error('Spell checking closed before the dictionary arrived.');
      } else {
        // Still open: install.
      }
      await invoke<number>('spell_install_dictionary', { language: candidate, aff, dic });
      loaded = true;
      await pushUserWords();
      return candidate;
    }
    throw new Error(`${DICTIONARY_SOURCE_NAME} has no dictionary for ${language}.`);
  }

  /**
   * Loads the dictionary bundled with the app for a language, if there is one.
   *
   * @purpose Reads the dictionary shipped in public/dictionaries (the default language) over the webview origin.
   * @inputs language - The language tag.
   * @outputs Promise<boolean> - true when loaded; false when not bundled or it could not be loaded.
   * @dataflow fetch index.aff + index.dic -> spell_load -> spell_set_user_words.
   * @controlflow A 404, or a page served in place of a missing file, means not bundled; other failures are reported.
   */
  async function loadBundledDictionary(language: string): Promise<boolean> {
    // Guard against running outside desktop environment.
    // The browser dev build has no native spell engine, and this is absence, not failure.
    if (!available) {
      // Branch: Running outside Tauri desktop environment; no-op returning false.
      return false;
    } else {
      // Branch: Desktop environment available; proceed with dictionary acquisition.
    }

    // Guard against invocations after service destruction.
    if (destroyed) {
      // Branch: Service has been destroyed; reject load request benignly.
      return false;
    } else {
      // Branch: Service is active; proceed.
    }

    // The dictionary is served as a static asset from the app's public/ directory
    // rather than resolved as a Tauri resource, because that one path works identically
    // in the Vite dev server, in the packaged app, and in tests — and the alternative
    // would need a second code path that only ever runs in one of the three.
    const affUrl = `${DICTIONARY_BASE_PATH}/${language}/index.aff`;
    const dicUrl = `${DICTIONARY_BASE_PATH}/${language}/index.dic`;

    let affRes: Response;
    let dicRes: Response;
    try {
      const [a, d] = await Promise.all([fetchFn(affUrl), fetchFn(dicUrl)]);
      affRes = a;
      dicRes = d;
    } catch (err: unknown) {
      // Branch: Network or fetch failure during dictionary retrieval.
      reportError(err);
      loaded = false;
      return false;
    }

    // Guard against service destruction while fetch was in-flight.
    // An in-flight promise resolving after destroy must not touch state.
    if (destroyed) {
      // Branch: Service was destroyed during fetch; abort without updating state.
      return false;
    } else {
      // Branch: Service still active; proceed to check HTTP status.
    }

    // A 404 is not an error: return false and leave loaded false.
    // No dictionary is a supported state (the asset is fetched by a script, not committed),
    // and the whole feature degrades to drawing nothing rather than to an error dialog
    // the user cannot act on.
    if (affRes.status === 404 || dicRes.status === 404) {
      // Branch: Dictionary files not found (404); degrade gracefully without error.
      loaded = false;
      return false;
    } else {
      // Branch: Files found or non-404 status; verify successful HTTP responses.
    }

    // Check whether both HTTP requests succeeded.
    if (!affRes.ok || !dicRes.ok) {
      // Branch: Non-404 HTTP error encountered; report as error and return false.
      const failedStatus = !affRes.ok ? affRes.status : dicRes.status;
      reportError(new Error(`Failed to load dictionary files: HTTP ${failedStatus}`));
      loaded = false;
      return false;
    } else {
      // Branch: Both HTTP responses OK; read text content.
    }

    let affText: string;
    let dicText: string;
    try {
      const [aText, dText] = await Promise.all([affRes.text(), dicRes.text()]);
      affText = aText;
      dicText = dText;
    } catch (err: unknown) {
      // Branch: Failed to extract response body text.
      reportError(err);
      loaded = false;
      return false;
    }

    // Guard against destruction during body reading.
    if (destroyed) {
      // Branch: Destroyed during text reading; abort.
      return false;
    } else {
      // Branch: Active; proceed to invoke Rust spell_load.
    }

    // Check for a web page served in place of a missing file, which a packaged app can do: it is not a dictionary.
    if (affText.trimStart().startsWith('<') || dicText.trimStart().startsWith('<')) {
      loaded = false;
      return false;
    } else {
      // Dictionary text: parse it.
    }

    // A parse failure from Rust is an error: report through onError and return false.
    // An absent dictionary is a configuration the user chose, a corrupt one is a fault.
    // Loading twice is allowed and simply replaces the dictionary.
    try {
      await invoke<number>('spell_load', { language, aff: affText, dic: dicText });
    } catch (err: unknown) {
      // Branch: Rust spellbook parser failed to compile affix/dictionary rules.
      reportError(err);
      loaded = false;
      return false;
    }

    // Guard against destruction during Rust dictionary loading.
    if (destroyed) {
      // Branch: Destroyed while Rust command was running; abort without updating state.
      return false;
    } else {
      // Branch: Active; mark loaded and push user words.
    }

    loaded = true;

    // After a successful load, push the current user words to Rust with spell_set_user_words,
    // because the Rust side is a fresh process on every launch and the words live in the webview's storage.
    try {
      const words = Array.from(userWordsSet);
      await invoke<void>('spell_set_user_words', { words });
    } catch (err: unknown) {
      // Branch: Failed to synchronize user words to Rust; report error.
      reportError(err);
    }

    // Guard against destruction during user words synchronization.
    if (destroyed) {
      // Branch: Destroyed while synchronizing user words; return false.
      return false;
    } else {
      // Branch: Successfully loaded and synchronized dictionary; return true.
      return true;
    }
  }

  /**
   * Checks whether a word is ignored in the current session or accepted in the personal dictionary.
   *
   * @purpose Consults both the session-scoped ignore set and the persistent user dictionary.
   * @inputs word - The word string to test.
   * @outputs boolean - True if the word is in the session ignore list or user dictionary, false otherwise.
   * @dataflow word -> trim -> set lookups in ignoredSet and userWordsSet -> boolean.
   * @controlflow Check destroyed guard -> trim word -> if empty return false -> check sets -> return boolean.
   */
  function isIgnored(word: string): boolean {
    // Guard against invocations after service destruction.
    if (destroyed) {
      // Branch: Service destroyed; return false.
      return false;
    } else {
      // Branch: Service active; proceed with check.
    }

    const trimmed = word.trim();
    // Check if trimmed word is empty.
    if (trimmed.length === 0) {
      // Branch: Empty word string; not ignored.
      return false;
    } else {
      // Branch: Non-empty word; consult ignore set and user words.
    }

    // isIgnored consults both the ignore set and the user words.
    if (ignoredSet.has(trimmed) || userWordsSet.has(trimmed)) {
      // Branch: Word present in session ignore set or persistent user words.
      return true;
    } else {
      // Branch: Word not present in either set.
      return false;
    }
  }

  /**
   * Ignores a word for the duration of the current editing session.
   *
   * @purpose Adds a word to the session-scoped ignore set without persisting it to storage.
   * @inputs word - The word string to ignore.
   * @outputs void.
   * @dataflow word -> trim -> ignoredSet.add.
   * @controlflow Check destroyed guard -> trim word -> if non-empty add to ignoredSet.
   */
  function ignoreAll(word: string): void {
    // Guard against invocations after service destruction.
    if (destroyed) {
      // Branch: Service destroyed; ignoreAll is a no-op.
      return;
    } else {
      // Branch: Service active; proceed.
    }

    const trimmed = word.trim();
    // Check if trimmed word is empty.
    if (trimmed.length === 0) {
      // Branch: Empty word string; ignoreAll is a no-op.
      return;
    } else {
      // Branch: Non-empty word string; proceed to ignore.
    }

    // ignoreAll adds to an in-memory Set that is never persisted:
    // Ignore All is scoped to the session by design: a permanent decision is what
    // Add to Dictionary is for, and silently making Ignore All permanent would remove
    // the user's only cheap, reversible option.
    ignoredSet.add(trimmed);
  }

  /**
   * Checks a list of words for spelling errors, filtering out session-ignored and user words before IPC.
   *
   * @purpose Identifies misspelled words by validating candidates against the native Hunspell dictionary.
   * @inputs words - The array of word strings to inspect.
   * @outputs Promise<readonly string[]> - Resolves to the subset of misspelled words.
   * @dataflow words -> filter out isIgnored -> invoke spell_check -> misspelled subset.
   * @controlflow Check available, loaded, destroyed guards -> filter candidates ->
   *   if empty return [] -> invoke spell_check -> catch rejections to onError -> return misspelled.
   */
  async function check(words: readonly string[]): Promise<readonly string[]> {
    // Guard against running outside desktop environment.
    if (!available) {
      // Branch: Desktop runtime absent; return empty array.
      return [];
    } else {
      // Branch: Desktop runtime present; proceed.
    }

    // Guard against invocations when no dictionary is loaded.
    // Returns [] when not loaded.
    if (!loaded) {
      // Branch: No dictionary loaded; return empty array.
      return [];
    } else {
      // Branch: Dictionary is loaded; proceed.
    }

    // Guard against invocations after service destruction.
    if (destroyed) {
      // Branch: Service destroyed; return empty array.
      return [];
    } else {
      // Branch: Service active; proceed.
    }

    // Check if words list is empty.
    if (words.length === 0) {
      // Branch: Empty input words array; return empty array.
      return [];
    } else {
      // Branch: Non-empty input words array; filter candidates.
    }

    // Filter out ignored words and words already in userWords before the IPC call.
    // Filtering here rather than only in Rust keeps the ignore list purely a webview concern:
    // Ignore All is a property of this editing session and must not leak into the persistent dictionary.
    const candidates: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      // Check if word entry is defined under strict indexing.
      if (w === undefined) {
        // Branch: Undefined entry; skip iteration.
        continue;
      } else {
        // Branch: Defined word entry; inspect ignore status.
      }

      // Check if the word is ignored or in user words.
      if (!isIgnored(w)) {
        // Branch: Word is neither ignored nor in user words; submit for spell checking.
        candidates.push(w);
      } else {
        // Branch: Word is ignored or in user dictionary; omit from IPC payload.
      }
    }

    // Check if all words were filtered out.
    if (candidates.length === 0) {
      // Branch: All words are ignored or in user dictionary; nothing to check.
      return [];
    } else {
      // Branch: Non-empty candidate list; invoke Rust spell_check command.
    }

    // Every invoke is wrapped so a rejection becomes an Error passed to onError
    // and a benign return value — never a rejected promise out of this module.
    // A spell-check failure must not take down the caller's update cycle.
    try {
      const misspelled = await invoke<readonly string[]>('spell_check', { words: candidates });

      // Guard against service destruction while IPC was in-flight.
      if (destroyed) {
        // Branch: Service destroyed during IPC; return empty array.
        return [];
      } else {
        // Branch: Service active; return misspelled words.
        return misspelled;
      }
    } catch (err: unknown) {
      // Branch: Tauri IPC invocation failed or threw an exception.
      reportError(err);
      return [];
    }
  }

  /**
   * Generates spelling correction suggestions for a misspelled word.
   *
   * @purpose Queries the native Hunspell dictionary for suggested word corrections.
   * @inputs word - The misspelled word string to suggest corrections for.
   * @outputs Promise<readonly string[]> - Resolves to an array of up to 8 suggestion candidates.
   * @dataflow word -> trim -> invoke spell_suggest -> suggestions array.
   * @controlflow Check available, loaded, destroyed guards -> trim word -> if empty return [] ->
   *   invoke spell_suggest -> catch rejections to onError -> return suggestions.
   */
  async function suggest(word: string): Promise<readonly string[]> {
    // Guard against running outside desktop environment.
    if (!available) {
      // Branch: Desktop runtime absent; return empty array.
      return [];
    } else {
      // Branch: Desktop runtime present; proceed.
    }

    // Guard against invocations when no dictionary is loaded.
    // Returns [] when not loaded.
    if (!loaded) {
      // Branch: No dictionary loaded; return empty array.
      return [];
    } else {
      // Branch: Dictionary is loaded; proceed.
    }

    // Guard against invocations after service destruction.
    if (destroyed) {
      // Branch: Service destroyed; return empty array.
      return [];
    } else {
      // Branch: Service active; proceed.
    }

    const trimmed = word.trim();
    // Check if trimmed word is empty.
    if (trimmed.length === 0) {
      // Branch: Empty word string; return empty suggestions list.
      return [];
    } else {
      // Branch: Non-empty word string; invoke Rust spell_suggest command.
    }

    // Every invoke is wrapped so a rejection becomes an Error passed to onError
    // and a benign return value — never a rejected promise out of this module.
    // A spell-check failure must not take down the caller's update cycle.
    try {
      const suggestions = await invoke<readonly string[]>('spell_suggest', { word: trimmed });

      // Guard against service destruction while IPC was in-flight.
      if (destroyed) {
        // Branch: Service destroyed during IPC; return empty array.
        return [];
      } else {
        // Branch: Service active; return suggestions list.
        return suggestions;
      }
    } catch (err: unknown) {
      // Branch: Tauri IPC invocation failed or threw an exception.
      reportError(err);
      return [];
    }
  }

  /**
   * Adds a custom word to the persistent user dictionary and notifies the native backend.
   *
   * @purpose Adds a trimmed non-empty word to in-memory set, localStorage, and native Rust state.
   * @inputs word - The custom word string to add.
   * @outputs Promise<void> - Resolves when the word has been recorded and persisted.
   * @dataflow word -> trim -> userWordsSet.add -> saveUserWordsToStorage -> invoke spell_add_word.
   * @controlflow Check destroyed guard -> trim word -> if empty return -> update set & localStorage ->
   *   if available invoke spell_add_word -> catch rejections to onError.
   */
  async function addWord(word: string): Promise<void> {
    // Guard against invocations after service destruction.
    if (destroyed) {
      // Branch: Service destroyed; addWord is a no-op.
      return;
    } else {
      // Branch: Service active; proceed.
    }

    const trimmed = word.trim();
    // Check if trimmed word is empty.
    // addWord('') and addWord('   ') are no-ops.
    if (trimmed.length === 0) {
      // Branch: Empty or whitespace-only word; no-op.
      return;
    } else {
      // Branch: Non-empty word string; proceed to add.
    }

    // Check if word is already present in user dictionary set.
    if (!userWordsSet.has(trimmed)) {
      // Branch: Word not yet in user dictionary; add to in-memory set and persist to storage.
      userWordsSet.add(trimmed);
      saveUserWordsToStorage(options.win, userWordsSet);
    } else {
      // Branch: Word already present in user dictionary; retain existing entry.
    }

    // Check if running inside desktop environment to notify native backend.
    if (available) {
      // Every invoke is wrapped so a rejection becomes an Error passed to onError
      // and a benign return value — never a rejected promise out of this module.
      // A spell-check failure must not take down the caller's update cycle.
      try {
        await invoke<void>('spell_add_word', { word: trimmed });
      } catch (err: unknown) {
        // Branch: Rust spell_add_word invocation failed or threw an exception.
        reportError(err);
      }
    } else {
      // Branch: Desktop runtime absent; native IPC invocation is skipped.
    }
  }

  /**
   * Tears down the spell service, marking it permanently inert and clearing session state.
   *
   * @purpose Idempotently destroys the spell service lifecycle.
   * @inputs void.
   * @outputs void.
   * @dataflow void -> destroyed = true -> loaded = false -> ignoredSet.clear().
   * @controlflow Check destroyed guard -> mark destroyed = true -> reset loaded and clear ignoredSet.
   */
  function destroy(): void {
    // Check if service has already been destroyed.
    if (destroyed) {
      // Branch: Already destroyed; return immediately for idempotent teardown.
      return;
    } else {
      // Branch: Active service; mark destroyed and reset state.
      destroyed = true;
      loaded = false;
      ignoredSet.clear();
    }
  }

  return {
    get available(): boolean {
      return available;
    },
    get loaded(): boolean {
      // Guard against checking loaded on a destroyed or unavailable service.
      if (destroyed || !available) {
        // Branch: Destroyed or unavailable; loaded is false.
        return false;
      } else {
        // Branch: Active service; return loaded state.
        return loaded;
      }
    },
    loadDictionary,
    downloadDictionary,
    check,
    suggest,
    addWord,
    ignoreAll,
    isIgnored,
    get userWords(): readonly string[] {
      // Check if service has been destroyed.
      if (destroyed) {
        // Branch: Destroyed service; return empty array.
        return [];
      } else {
        // Branch: Active service; return array copy of current user words.
        return Array.from(userWordsSet);
      }
    },
    destroy,
  };
}
