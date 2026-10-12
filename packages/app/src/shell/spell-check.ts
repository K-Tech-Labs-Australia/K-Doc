/**
 * @file spell-check.ts
 * @purpose Controller coordinating document spell checking for K-Doc's ProseMirror editor (FR-12.1, FR-12.2).
 *   Bridges the ProseMirror document scanner, the native Hunspell spell check service, and the squiggle decoration layer.
 * @inputs SpellCheckOptions containing EditorView instance, SpellService client adapter, Window context,
 *   initial enabled flag, language code, optional debounceMs delay, and optional onError callback.
 * @outputs SPELL_DEBOUNCE_MS constant, SpellCheckOptions and SpellCheck interfaces, and installSpellCheck factory.
 * @functions
 *   - installSpellCheck: Instantiates the spell check controller, kicks off dictionary loading, and binds lifecycle methods.
 * @dataflow view.state -> scanState -> distinct words -> service.check -> setMisspellings -> view.dispatch.
 * @controlflow Initialize controller -> async loadDictionary on enable -> debounced schedule or immediate checkNow ->
 *   scan document -> deduplicate words -> IPC verification -> monotonic generation check -> dispatch transaction.
 * @version 2
 * @date 2026-09-18
 */

import type { EditorView } from 'prosemirror-view';
import type { WordSpan } from '@k-doc/editor';
import {
  scanState,
  setMisspellings,
  misspellingAt as editorMisspellingAt,
  misspellingsIn,
} from '@k-doc/editor';
import { dictionaryCandidates } from '@k-doc/core';
import type { SpellService } from '../spell/spell-service.js';

/**
 * Default debounce period in milliseconds before triggering an asynchronous document spell check.
 */
export const SPELL_DEBOUNCE_MS: number = 400;

/**
 * Configuration options supplied to the spell check controller factory.
 */
export interface SpellCheckOptions {
  readonly view: EditorView;
  readonly service: SpellService;
  readonly win: Window;
  readonly enabled: boolean;
  readonly language: string;
  readonly debounceMs?: number;
  readonly onError?: (error: Error) => void;
  /** Called when no dictionary for the language could be loaded, so the shell can offer to download one (FR-12.3). */
  readonly onMissingDictionary?: (language: string) => void;
}

/**
 * Controller interface exposing spell checking state queries, manual checks, corrections, and lifecycle teardown.
 */
export interface SpellCheck {
  readonly isEnabled: boolean;
  /** The language the document is checked in. */
  readonly language: string;
  /** Switches to another language, loading its dictionary if checking is on (FR-12.3). */
  setLanguage(language: string): void;
  /** Loads the document's language again, after a dictionary download changed which dictionary is in use. */
  reload(): void;
  setEnabled(enabled: boolean): void;
  /** Restarts the debounce timer. Call from the view's update hook. */
  schedule(): void;
  /** Runs a check immediately, bypassing the debounce. Awaitable, for tests and F7. */
  checkNow(): Promise<void>;
  misspellingAt(pos: number): WordSpan | null;
  misspellings(): readonly WordSpan[];
  /** Replaces the span's text and re-checks. */
  correct(span: WordSpan, replacement: string): void;
  suggest(word: string): Promise<readonly string[]>;
  ignoreAll(word: string): void;
  addToDictionary(word: string): Promise<void>;
  destroy(): void;
}

/**
 * Installs and initializes the spell check controller on an editor view.
 *
 * @purpose Connects the editor view to the spell service, orchestrating scans, debounced IPC checks, and decorations.
 * @inputs options: SpellCheckOptions - Configuration options for the controller.
 * @outputs SpellCheck - The active spell check controller instance.
 * @dataflow options -> loadDictionary -> schedule / checkNow -> view.dispatch(setMisspellings).
 * @controlflow Bind state variables -> if enabled start dictionary load without blocking -> return SpellCheck controller.
 */
export function installSpellCheck(options: SpellCheckOptions): SpellCheck {
  let enabled: boolean = options.enabled;
  let destroyed: boolean = false;
  let timerId: ReturnType<typeof options.win.setTimeout> | null = null;
  let generation: number = 0;

  // The language can change after construction (FR-12.3): front matter edited, or a choice from the status bar.
  let language: string = options.language;

  // Construction: if enabled, start using the language without awaiting — the editor's first paint must not wait.
  if (enabled) {
    // Branch: Spell checking enabled at mount; load the dictionary and check.
    void useLanguage();
  } else {
    // Branch: Spell checking initially disabled; omit initial dictionary load.
  }

  /**
   * Loads the dictionary for the current language and checks the document against it (FR-12.3).
   *
   * @purpose Makes the service use this document's language, trying the full tag and then its primary language
   *   ("fr-FR", then "fr"), and says so when no dictionary for it is available.
   * @inputs void; reads language, enabled and destroyed.
   * @outputs Promise<void> - Settles once the document has been checked, or cleared when there is no dictionary.
   * @dataflow language -> dictionaryCandidates -> service.loadDictionary per candidate -> checkNow.
   * @controlflow Stops at the first candidate that loads. A rejection goes to onError. When the controller was destroyed
   *   or disabled, or the language changed while loading, the result is dropped: a newer call owns the outcome.
   */
  async function useLanguage(): Promise<void> {
    const wanted = language;
    let loaded = false;
    try {
      for (const candidate of dictionaryCandidates(wanted)) {
        loaded = await options.service.loadDictionary(candidate);
        // Check whether this candidate loaded, which ends the search.
        if (loaded) {
          break;
        } else {
          // Not available under this name: try the next one.
        }
      }
    } catch (err: unknown) {
      // Check whether anyone is still listening for the failure.
      if (!destroyed) {
        options.onError?.(err instanceof Error ? err : new Error(String(err)));
      } else {
        // Destroyed while loading: nobody to tell.
      }
      return;
    }

    // Check whether the result still matters.
    if (destroyed || !enabled || wanted !== language) {
      return;
    } else {
      // Still wanted: act on it.
    }

    // Check whether any dictionary was found for the language.
    if (!loaded) {
      options.onMissingDictionary?.(wanted);
    } else {
      // A dictionary is in use.
    }
    // With no dictionary this clears the squiggles, so words are never checked against another language's dictionary.
    await checkNow();
  }

  /**
   * Changes the language this document is checked in (FR-12.3).
   *
   * @purpose Switches dictionaries when the document's language changes.
   * @inputs next - The new language tag.
   * @outputs void.
   * @dataflow next -> language -> useLanguage.
   * @controlflow Ignored after destroy or when unchanged; loads only while checking is enabled.
   */
  /**
   * Loads the document's language again (FR-12.3).
   *
   * @purpose Puts the document's own dictionary back in use after a download made another one active.
   * @inputs void.
   * @outputs void.
   * @dataflow useLanguage.
   * @controlflow Does nothing after destroy or while checking is off.
   */
  function reload(): void {
    // Check whether there is a live, enabled controller to reload.
    if (destroyed || !enabled) {
      return;
    } else {
      void useLanguage();
    }
  }

  function setLanguage(next: string): void {
    // Check whether there is anything to change.
    if (destroyed || next === language) {
      return;
    } else {
      language = next;
    }
    // Check whether checking is on; when it is off, the new language is used the next time it is turned on.
    if (enabled) {
      void useLanguage();
    } else {
      // Off: nothing to load yet.
    }
  }

  /**
   * Restarts the debounce timer for asynchronous spell checking.
   * Call this method from the editor view's update hook.
   *
   * @purpose Schedules a delayed spell check pass to avoid checking incomplete words mid-keystroke.
   * @inputs void.
   * @outputs void.
   * @dataflow schedule() -> win.clearTimeout / win.setTimeout -> delayed checkNow() invocation.
   * @controlflow Check destroyed and enabled guards -> clear existing timer -> set new timeout.
   */
  function schedule(): void {
    // Check if controller has been destroyed.
    if (destroyed) {
      // Branch: Controller destroyed; schedule is a no-op.
      return;
    } else {
      // Branch: Controller active; proceed.
    }

    // Check if spell checking is enabled.
    if (!enabled) {
      // Branch: Spell checking disabled; do not schedule checks.
      return;
    } else {
      // Branch: Spell checking enabled; proceed to schedule.
    }

    // Clear any prior pending debounce timer to restart the window.
    if (timerId !== null) {
      // Branch: Existing timer pending; cancel it to restart debounce period.
      options.win.clearTimeout(timerId);
      timerId = null;
    } else {
      // Branch: No existing timer pending; proceed to arm timer.
    }

    // A check on every keystroke would make an IPC round trip per character while the word
    // being typed is still incomplete and therefore misspelled by definition — the debounce
    // is what stops the squiggle appearing under the word you are in the middle of writing.
    const delay = options.debounceMs ?? SPELL_DEBOUNCE_MS;
    timerId = options.win.setTimeout((): void => {
      timerId = null;

      // Check whether controller is destroyed or disabled when timer fires.
      if (destroyed || !enabled) {
        // Branch: Controller destroyed or disabled; cancel check execution.
        return;
      } else {
        // Branch: Active and enabled; trigger checkNow.
        void checkNow();
      }
    }, delay);
  }

  /**
   * Runs a spell check immediately, bypassing the debounce timer.
   *
   * @purpose Performs synchronous/immediate document scanning, queries the spell service for misspelled words,
   *   and updates ProseMirror decoration metadata via setMisspellings.
   * @inputs void.
   * @outputs Promise<void> - Resolves when the spell check cycle and transaction dispatch complete.
   * @dataflow view.state -> scanState -> distinct words -> service.check -> filter misspelled spans -> view.dispatch(setMisspellings).
   * @controlflow Check destroyed guard -> if disabled or not loaded dispatch empty and return ->
   *   bump generation counter -> scanState -> deduplicate words -> await service.check ->
   *   guard destroyed / stale generation -> filter misspelled spans -> dispatch transaction.
   */
  async function checkNow(): Promise<void> {
    // Check if controller has been destroyed.
    if (destroyed) {
      // Branch: Controller destroyed; checkNow is a no-op.
      return;
    } else {
      // Branch: Controller active; proceed.
    }

    // If not enabled, or the service is not loaded, dispatch an empty span list and return.
    // This is what makes setEnabled(false) clear the squiggles rather than freeze them on screen.
    if (!enabled || !options.service.loaded) {
      // Branch: Feature disabled or dictionary not loaded; clear squiggles immediately.
      const tr = setMisspellings(options.view.state.tr, []);
      options.view.dispatch(tr);
      return;
    } else {
      // Branch: Feature enabled and dictionary loaded; proceed with spell check.
    }

    // Clear any pending debounce timer since an immediate check is now executing.
    if (timerId !== null) {
      // Branch: Debounce timer active; cancel it to prevent redundant re-check.
      options.win.clearTimeout(timerId);
      timerId = null;
    } else {
      // Branch: No debounce timer active.
    }

    // Monotonically increasing generation counter to guard against overlapping runs.
    // Two checks can be in flight when a fast edit follows a slow IPC call, and applying
    // the older answer would resurrect squiggles the newer one cleared.
    const currentGen = ++generation;

    // 1. scanState(view.state) for candidate word spans.
    const candidateSpans = scanState(options.view.state);

    // 2. Collect distinct words.
    // The word list sent is de-duplicated because a long document repeats common words heavily,
    // and the answer for a word does not depend on where it appeared.
    const distinctWordsSet = new Set<string>();
    for (let i = 0; i < candidateSpans.length; i++) {
      const span = candidateSpans[i];
      // Check if span is defined under strict index access.
      if (span === undefined) {
        // Branch: Undefined array slot; skip.
        continue;
      } else {
        // Branch: Defined span; add word to distinct set.
        distinctWordsSet.add(span.word);
      }
    }
    const distinctWords: readonly string[] = Array.from(distinctWordsSet);

    let misspelledWords: readonly string[];
    try {
      misspelledWords = await options.service.check(distinctWords);
    } catch (err: unknown) {
      // Check if controller has been destroyed during async IPC call.
      if (destroyed) {
        // Branch: Controller destroyed; suppress error handling.
        return;
      } else {
        // Branch: Controller active; report error to onError callback.
        const error = err instanceof Error ? err : new Error(String(err));
        options.onError?.(error);
        return;
      }
    }

    // Guard against controller destruction while service.check was in flight.
    // A pending promise resolving after destroy must not dispatch into a destroyed view.
    if (destroyed) {
      // Branch: Controller destroyed; do not mutate view.
      return;
    } else {
      // Branch: Controller active; check generation freshness.
    }

    // Check if a newer check has started while this check was in flight.
    if (currentGen !== generation) {
      // Branch: Generation mismatch; abandon this stale check result.
      return;
    } else {
      // Branch: Generation is fresh; proceed to apply misspellings.
    }

    // Check if feature was disabled while check was in flight.
    if (!enabled) {
      // Branch: Feature disabled during check; clear squiggles.
      const tr = setMisspellings(options.view.state.tr, []);
      options.view.dispatch(tr);
      return;
    } else {
      // Branch: Still enabled; proceed to build misspelled spans.
    }

    // 3. Build the misspelled span list by keeping every span whose word is in the returned set.
    const misspelledSet = new Set<string>(misspelledWords);
    const misspelledSpans: WordSpan[] = [];
    const docSize = options.view.state.doc.content.size;

    for (let i = 0; i < candidateSpans.length; i++) {
      const span = candidateSpans[i];
      // Check if span is defined under strict index access.
      if (span === undefined) {
        // Branch: Undefined slot; skip.
        continue;
      } else {
        // Branch: Defined span; test bounds and misspelling membership.
      }

      // Guard against document shrinkage past doc boundaries:
      // The scan and the check are separated by an await, so the document can have shrunk in between,
      // and a decoration past the end throws inside ProseMirror.
      if (span.to > docSize) {
        // Branch: Span exceeds document boundary; skip.
        continue;
      } else {
        // Branch: Span within document boundaries; check misspelling.
      }

      // Check if word is contained in the misspelled set returned by the service.
      if (misspelledSet.has(span.word)) {
        // Branch: Word is misspelled; include in decorations list.
        misspelledSpans.push(span);
      } else {
        // Branch: Word is correct; omit decoration.
      }
    }

    // Dispatch the transaction with updated misspelling metadata.
    const tr = setMisspellings(options.view.state.tr, misspelledSpans);
    options.view.dispatch(tr);
  }

  /**
   * Queries whether the specified document position falls inside a misspelled word decoration.
   *
   * @purpose Evaluates if a caret or cursor location contains a registered misspelling.
   * @inputs pos: number - The document position to test.
   * @outputs WordSpan | null - The containing WordSpan record if found; null otherwise.
   * @dataflow pos -> editorMisspellingAt(view.state, pos) -> WordSpan | null.
   * @controlflow Check destroyed and enabled guards -> delegate to editorMisspellingAt -> return result.
   */
  function misspellingAt(pos: number): WordSpan | null {
    // Check if controller is destroyed or disabled.
    if (destroyed || !enabled) {
      // Branch: Inactive or destroyed; return null.
      return null;
    } else {
      // Branch: Active; query editorMisspellingAt on view.state.
      return editorMisspellingAt(options.view.state, pos);
    }
  }

  /**
   * Retrieves all currently decorated misspelled word spans in document order.
   *
   * @purpose Returns active misspelling spans across the entire document for navigation or review dialogs.
   * @inputs void.
   * @outputs readonly WordSpan[] - Array of WordSpan records in document order, or empty array if inactive.
   * @dataflow view.state -> misspellingsIn(view.state) -> readonly WordSpan[].
   * @controlflow Check destroyed and enabled guards -> delegate to misspellingsIn -> return array.
   */
  function misspellings(): readonly WordSpan[] {
    // Check if controller is destroyed or disabled.
    if (destroyed || !enabled) {
      // Branch: Inactive or destroyed; return empty array.
      return [];
    } else {
      // Branch: Active; query misspellingsIn on view.state.
      return misspellingsIn(options.view.state);
    }
  }

  /**
   * Enables or disables spell checking.
   *
   * @purpose Toggles active spell checking state, loading dictionary on enable and clearing decorations immediately on disable.
   * @inputs nextEnabled: boolean - True to activate spell checking; false to deactivate.
   * @outputs void.
   * @dataflow nextEnabled -> updates enabled state -> loadDictionary & checkNow or immediate setMisspellings clear.
   * @controlflow Check destroyed guard -> if identical return -> update enabled ->
   *   if enabling: load dictionary if needed then checkNow ->
   *   if disabling: clear timer, bump generation, and dispatch empty misspellings immediately.
   */
  function setEnabled(nextEnabled: boolean): void {
    // Check if controller has been destroyed.
    if (destroyed) {
      // Branch: Controller destroyed; setEnabled is a no-op.
      return;
    } else {
      // Branch: Controller active; proceed.
    }

    // Check if requested state is identical to current state.
    if (enabled === nextEnabled) {
      // Branch: State unchanged; no action needed.
      return;
    } else {
      // Branch: State changed; update stored state.
      enabled = nextEnabled;
    }

    // Branch on whether feature is being enabled or disabled.
    if (nextEnabled) {
      // Branch: Turning on; load dictionary if not already loaded and then check.
      // Branch: Turning on; use the document's language, which may not be the one the service holds now.
      void useLanguage();
    } else {
      // Branch: Turning off; clear immediately (not on a timer).
      // A user turning spell check off expects the red to be gone now.
      if (timerId !== null) {
        // Branch: Pending debounce timer exists; cancel it.
        options.win.clearTimeout(timerId);
        timerId = null;
      } else {
        // Branch: No pending timer.
      }

      // Invalidate any currently pending asynchronous check runs.
      generation++;

      // Dispatch empty span list immediately to remove all squiggles.
      const tr = setMisspellings(options.view.state.tr, []);
      options.view.dispatch(tr);
    }
  }

  /**
   * Replaces the text of a misspelled word span with a replacement string and re-checks the document.
   *
   * @purpose Applies a spelling correction to the ProseMirror document, restores focus to the editor pane,
   *   and triggers a follow-up spell check pass.
   * @inputs
   *   - span: WordSpan - The target word span to replace.
   *   - replacement: string - The replacement word text.
   * @outputs void.
   * @dataflow span + replacement -> view.state.tr.insertText -> view.dispatch -> view.focus() -> checkNow().
   * @controlflow Check destroyed guard -> validate span boundaries against doc size ->
   *   dispatch insertText transaction -> restore focus to view -> call checkNow().
   */
  function correct(span: WordSpan, replacement: string): void {
    // Check if controller has been destroyed.
    if (destroyed) {
      // Branch: Controller destroyed; correct is a no-op.
      return;
    } else {
      // Branch: Controller active; proceed.
    }

    const docSize = options.view.state.doc.content.size;

    // Guard span.to <= view.state.doc.content.size before dispatching, and skip otherwise —
    // the document may have changed since the menu opened.
    if (span.to > docSize || span.from < 0 || span.from > span.to) {
      // Branch: Span boundaries extend past current document size or are inverted; skip dispatch.
      return;
    } else {
      // Branch: Span boundaries are valid; proceed with replacement.
    }

    // Positions come from the decoration (which maps through edits) rather than from a stale scan.
    const tr = options.view.state.tr.insertText(replacement, span.from, span.to);
    options.view.dispatch(tr);

    // Focus returns to the pane because K-Doc keys its edit lock on which pane holds focus.
    options.view.focus();

    // Re-check the document to update remaining squiggles.
    void checkNow();
  }

  /**
   * Obtains spelling correction suggestions for a word from the spell service.
   *
   * @purpose Queries the underlying dictionary engine for candidate replacement suggestions.
   * @inputs word: string - The misspelled word string to suggest alternatives for.
   * @outputs Promise<readonly string[]> - Array of suggested replacement word strings.
   * @dataflow word -> service.suggest(word) -> suggestions array.
   * @controlflow Check destroyed and enabled guards -> delegate to service.suggest -> catch errors to onError and return [].
   */
  async function suggest(word: string): Promise<readonly string[]> {
    // Check if controller has been destroyed or spell checking is disabled.
    if (destroyed || !enabled) {
      // Branch: Controller destroyed or disabled; return empty suggestions.
      return [];
    } else {
      // Branch: Controller active and enabled; query service.
    }

    try {
      return await options.service.suggest(word);
    } catch (err: unknown) {
      // Check if controller was destroyed while query was in flight.
      if (destroyed) {
        // Branch: Controller destroyed; return empty array.
        return [];
      } else {
        // Branch: Controller active; report error and return empty array.
        const error = err instanceof Error ? err : new Error(String(err));
        options.onError?.(error);
        return [];
      }
    }
  }

  /**
   * Ignores all occurrences of a word for the current editing session and updates squiggles.
   *
   * @purpose Adds a word to the session ignore list and triggers an immediate re-check so all occurrences clear.
   * @inputs word: string - The word to ignore in the session.
   * @outputs void.
   * @dataflow word -> service.ignoreAll(word) -> checkNow().
   * @controlflow Check destroyed guard -> delegate to service.ignoreAll -> trigger checkNow().
   */
  function ignoreAll(word: string): void {
    // Check if controller has been destroyed.
    if (destroyed) {
      // Branch: Controller destroyed; ignoreAll is a no-op.
      return;
    } else {
      // Branch: Controller active; proceed.
    }

    options.service.ignoreAll(word);

    // Re-checking rather than removing the matching decorations directly keeps
    // one source of truth for what is misspelled.
    void checkNow();
  }

  /**
   * Adds a word to the user's persistent dictionary and updates squiggles across the document.
   *
   * @purpose Persists a new word in the user dictionary and refreshes spell checking decorations.
   * @inputs word: string - The word to permanently add to the user dictionary.
   * @outputs Promise<void> - Resolves when the word has been added and document re-checked.
   * @dataflow word -> service.addWord(word) -> checkNow().
   * @controlflow Check destroyed guard -> await service.addWord -> catch errors to onError ->
   *   guard destroyed -> await checkNow().
   */
  async function addToDictionary(word: string): Promise<void> {
    // Check if controller has been destroyed.
    if (destroyed) {
      // Branch: Controller destroyed; addToDictionary is a no-op.
      return;
    } else {
      // Branch: Controller active; proceed.
    }

    try {
      await options.service.addWord(word);
    } catch (err: unknown) {
      // Check if controller has been destroyed during async operation.
      if (destroyed) {
        // Branch: Controller destroyed; suppress error.
        return;
      } else {
        // Branch: Controller active; report error to onError callback.
        const error = err instanceof Error ? err : new Error(String(err));
        options.onError?.(error);
        return;
      }
    }

    // Check if controller was destroyed while addWord was in flight.
    if (destroyed) {
      // Branch: Controller destroyed; abort without re-checking.
      return;
    } else {
      // Branch: Controller active; trigger re-check.
    }

    // Re-checking rather than removing the matching decorations directly keeps
    // one source of truth for what is misspelled.
    await checkNow();
  }

  /**
   * Destroys the spell check controller, cancelling pending timers and rendering all methods inert.
   *
   * @purpose Tears down the controller idempotently, ensuring no further transactions or callbacks reach the view.
   * @inputs void.
   * @outputs void.
   * @dataflow void -> destroyed = true, timerId cleared, generation bumped.
   * @controlflow Check destroyed guard -> set destroyed = true -> clearTimeout if armed -> increment generation.
   */
  function destroy(): void {
    // Check if controller has already been destroyed.
    if (destroyed) {
      // Branch: Already destroyed; return immediately for idempotent teardown.
      return;
    } else {
      // Branch: Active controller; proceed with teardown.
      destroyed = true;
    }

    // Clear any armed debounce timer.
    if (timerId !== null) {
      // Branch: Timer active; cancel with win.clearTimeout.
      options.win.clearTimeout(timerId);
      timerId = null;
    } else {
      // Branch: No timer active.
    }

    // Invalidate any in-flight asynchronous operations so they do not dispatch into the destroyed view.
    generation++;
  }

  return {
    get isEnabled(): boolean {
      // Check if controller is destroyed.
      if (destroyed) {
        // Branch: Controller destroyed; isEnabled is false.
        return false;
      } else {
        // Branch: Controller active; return current enabled status.
        return enabled;
      }
    },
    get language(): string {
      return language;
    },
    setLanguage,
    reload,
    setEnabled,
    schedule,
    checkNow,
    misspellingAt,
    misspellings,
    correct,
    suggest,
    ignoreAll,
    addToDictionary,
    destroy,
  };
}
