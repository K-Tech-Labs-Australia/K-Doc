/**
 * @file spell-menu.ts
 * @purpose Builds the spelling entries that lead the right-click menu when the caret sits inside a misspelled word (FR-12.1).
 * @inputs SpellMenuOptions containing the active EditorView and SpellCheck controller.
 * @outputs MAX_MENU_SUGGESTIONS constant, SpellMenuOptions interface, and buildSpellEntries function.
 * @functions
 *   - buildSpellEntries: Queries the editor caret position against active misspellings and constructs suggestion, ignore, and dictionary menu entries.
 * @dataflow options.view caret position -> spell.misspellingAt -> spell.suggest -> PopupMenuEntry list.
 * @controlflow Verify spell.isEnabled -> query misspellingAt(pos) -> await spell.suggest(word) -> build suggestion items or disabled fallback -> append separator -> append Ignore All and Add to Dictionary -> return entries.
 * @version 1
 * @date 2026-09-06
 */

import type { EditorView } from 'prosemirror-view';
import type { WordSpan } from '@k-doc/editor';
import type { PopupMenuEntry } from './popup-menu.js';
import type { SpellCheck } from './spell-check.js';

/**
 * Maximum number of spelling suggestions displayed in the right-click context menu.
 */
export const MAX_MENU_SUGGESTIONS: number = 5;

/**
 * Configuration options supplied to buildSpellEntries.
 */
export interface SpellMenuOptions {
  readonly spell: SpellCheck;
  readonly view: EditorView;
}

/**
 * Builds the spelling entries that lead the right-click menu when the caret sits inside a misspelled word (FR-12.1).
 *
 * @purpose Queries the active editor caret for a misspelled word span and constructs contextual spelling suggestions,
 *   a separator, and batch ignore / dictionary addition menu items.
 * @inputs options: SpellMenuOptions - The spell check controller and active ProseMirror editor view.
 * @outputs Promise<readonly PopupMenuEntry[]> - Array of menu items and separators, or an empty array if spell checking is disabled or caret is not in a misspelling.
 * @dataflow options.view caret position -> spell.misspellingAt -> spell.suggest -> PopupMenuEntry list.
 * @controlflow Check isEnabled -> check misspellingAt -> fetch suggestions -> build suggestions or "No suggestions" -> add separator -> add Ignore All and Add to Dictionary -> return entries.
 */
export async function buildSpellEntries(
  options: SpellMenuOptions,
): Promise<readonly PopupMenuEntry[]> {
  // Check if spell checking is enabled on the controller.
  if (!options.spell.isEnabled) {
    // Returning nothing rather than a disabled "no suggestions" item is what keeps
    // the ordinary right-click menu unchanged for the overwhelmingly common case.
    return [];
  } else {
    // Spell checking enabled; query caret position for misspelled word span.
  }

  // Read the caret from options.view.state.selection.from and ask spell.misspellingAt(pos).
  const pos: number = options.view.state.selection.from;
  const span: WordSpan | null = options.spell.misspellingAt(pos);

  // Check if the caret sits inside a recorded misspelled word.
  if (span === null) {
    // Returning nothing rather than a disabled "no suggestions" item is what keeps
    // the ordinary right-click menu unchanged for the overwhelmingly common case.
    return [];
  } else {
    // Caret is inside a misspelled word; proceed to fetch suggestions and build entries.
  }

  // The span captured in each run closure is the one read before the await.
  // This is deliberate and safe: misspellingAt reads a decoration, decorations map
  // through edits, and correct re-validates the range against the document before
  // touching it — so a stale span is rejected rather than applied at the wrong place.
  const suggestions: readonly string[] = await options.spell.suggest(span.word);

  const entries: PopupMenuEntry[] = [];

  // Check if any suggestions were returned for the misspelled word.
  if (suggestions.length === 0) {
    // This one case does need a placeholder: the user right-clicked a red word
    // and an entirely absent spelling section would look like the squiggle was lying.
    entries.push({
      id: 'spell:no-suggestions',
      label: 'No suggestions',
      hint: '',
      enabled: false,
      run(): void {
        // Disabled placeholder item; no action to perform.
      },
    });
  } else {
    // The engine already caps at 8, and this caps again at 5 because a context menu
    // is read at a glance while a review dialog is read deliberately — the two
    // surfaces want different lengths, and the shorter one belongs here.
    const cappedSuggestions: readonly string[] = suggestions.slice(0, MAX_MENU_SUGGESTIONS);
    for (let i = 0; i < cappedSuggestions.length; i++) {
      const suggestion: string | undefined = cappedSuggestions[i];
      // Check if suggestion is defined under strict index access.
      if (suggestion === undefined) {
        // Branch: Undefined array element; skip.
        continue;
      } else {
        // Branch: Defined suggestion string; construct menu item.
        entries.push({
          id: `spell:suggest:${i}`,
          label: suggestion,
          hint: '',
          enabled: true,
          run(): void {
            options.spell.correct(span, suggestion);
          },
        });
      }
    }
  }

  // Visual divider separating suggestions from batch and dictionary actions.
  entries.push({ separator: true });

  // spell:ignore-all — Ignore All, calling spell.ignoreAll(span.word).
  entries.push({
    id: 'spell:ignore-all',
    label: 'Ignore All',
    hint: '',
    enabled: true,
    run(): void {
      options.spell.ignoreAll(span.word);
    },
  });

  // spell:add-to-dictionary — Add to Dictionary, calling void spell.addToDictionary(span.word).
  entries.push({
    id: 'spell:add-to-dictionary',
    label: 'Add to Dictionary',
    hint: '',
    enabled: true,
    run(): void {
      void options.spell.addToDictionary(span.word);
    },
  });

  return entries;
}
