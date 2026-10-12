/**
 * @file search-marks.ts
 * @purpose CodeMirror 6 decorations for find matches in K-Doc's Source pane (FR-9.2): a state field holding a DecorationSet of background-tinted match marks plus an effect that replaces it with a freshly computed authoritative set, and the theme rules that colour them — so every match the search engine reports is visible on screen rather than only the one the selection points at, letting a reader see which of the twelve the panel claims exist.
 * @inputs setSearchMatchesEffect carries readonly SearchMarkState (start/end offsets plus an active index); EditorView when dispatching; document length derived at build time to drop stale or out-of-range matches.
 * @outputs a DecorationSet of match marks on editor state, two CSS class constants consumed by the theme, and extensions embeddable in the Source pane's extension list.
 * @functions
 *   - setSearchMatchesEffect: StateEffect replacing the current mark set with a freshly computed authoritative set.
 *   - searchMarksField: StateField holding the DecorationSet of match marks across editor transactions.
 *   - buildSearchMarks: Assembles a DecorationSet from validated matches for a document length (module-level helper).
 *   - searchMarks: Extension composing just the state field for embedding in a pane's extension list.
 *   - searchMarkTheme: Extension providing CSS rules colouring match and active marks as background tints.
 *   - setSearchMatchesIn: Dispatches the effect on behalf of callers who need not know about it.
 * @dataflow Search engine offsets -> setSearchMatchesEffect.of(state) -> searchMarksField rebuilds DecorationSet via buildSearchMarks -> EditorView.decorations reads it and paints a background tint over every match range, stronger for the active one.
 * @controlflow create returns an empty set; update replaces the set on a search-match effect (the authoritative set wins, no merge) or maps changes otherwise so typed edits keep ranges steady until the next find runs again — briefly approximate beats briefly absent. Every match is painted as a background tint rather than an underline because the Source pane already spends text-decoration on spell squiggles and border-bottom on comment ranges; the active match carries a second class so it reads at greater strength, since next and previous are meaningless without seeing which one you are on.
 * @version 1
 * @date 2026-09-11
 */

import { StateEffect, StateField } from '@codemirror/state';
import type { Extension, Range, Transaction } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import type { SearchMatch } from '@k-doc/core';

/** The CSS class applied to every find-match background tint in the Source pane (FR-9.2). */
export const CM_SEARCH_MATCH_CLASS: string = 'kdoc-cm-search-match';

/** The CSS class applied to the active (current) find match so it reads at greater strength than its siblings (FR-9.2). */
export const CM_SEARCH_ACTIVE_CLASS: string = 'kdoc-cm-search-active';

/** The payload carried by setSearchMatchesEffect: the authoritative set of match ranges and which one is current (FR-9.2). */
export interface SearchMarkState {
  readonly matches: readonly SearchMatch[];
  readonly activeIndex: number;
}

/**
 * @purpose Carries a freshly computed set of find matches into editor state so the search field can rebuild its DecorationSet from scratch.
 * @inputs state - the authoritative SearchMarkState (source-offset ranges plus the active index) produced by the search engine for the current document snapshot.
 * @outputs A StateEffect instance whose payload is readonly SearchMarkState.
 * @dataflow Caller builds state via the search -> setSearchMatchesEffect.of(state) produces an effect applied inside a dispatch's effects array.
 * @controlflow Pure definition with no branching; the effect only takes meaning when searchMarksField.update inspects tr.effects for it below.
 */
export const setSearchMatchesEffect = StateEffect.define<SearchMarkState>();

/**
 * @purpose Holds the DecorationSet of find-match marks and keeps it in sync with editor transactions (FR-9.2).
 * @inputs create receives a fresh EditorState; update receives the previous set plus each applied Transaction, including search-match effects.
 * @outputs A DecorationSet: empty on creation, rebuilt from an incoming match effect, or change-mapped for ordinary edits.
 * @dataflow StateEffect payload state -> buildSearchMarks(state, docLength) produces a DecorationSet -> EditorView.decorations reads it to paint the tints.
 * @controlflow On create return the empty set; on update branch: a search-match effect triggers an authoritative rebuild (the new set wins over any stale mark), every other transaction maps its changes over the existing set so typed edits keep ranges steady until the next find runs again — briefly approximate beats briefly absent.
 */
export const searchMarksField = StateField.define<DecorationSet>({
  create(): DecorationSet {
    return Decoration.none;
  },

  update(value: DecorationSet, tr: Transaction): DecorationSet {
    for (const effect of tr.effects) {
      if (effect.is(setSearchMatchesEffect)) {
        // Branch: a fresh set of find matches arrived — rebuild from scratch rather than merge, because the new set is authoritative and any mark left over from the previous set would otherwise linger as a phantom match.
        return buildSearchMarks(effect.value, tr.state.doc.length);
      } else {
        // Branch: some other effect. Keep scanning rather than returning here: a transaction can carry
        // several effects, and returning on the first non-matching one would let a setSearchMatchesEffect
        // behind it go unseen — the matches would be dropped silently and stop updating entirely.
      }
    }

    // No search-match effect in this transaction: map the existing marks across its changes so typed edits keep ranges steady until the next find runs again, since the authoritative re-set only arrives when the user searches.
    return value.map(tr.changes);
  },

  provide: (field) => EditorView.decorations.from(field),
});

/**
 * @purpose Assembles a DecorationSet of match marks from an authoritative SearchMarkState for a document of `docLength`.
 * @inputs state - the match ranges plus active index to paint; docLength - the current document length used to drop stale or out-of-range matches.
 * @outputs A finished DecorationSet whose marks carry either the base class alone or the base plus active class, sorted by Decoration.set rather than assumed input order.
 * @dataflow Each match -> validated against bounds -> a mark tagged with the chosen class appended to a range array -> Decoration.set(ranges, true) sorts and yields the set.
 * @controlflow Drop matches that start before offset 0, end past the document end, or are zero-width (the search was computed from a snapshot and the document can have moved on), then tag each remaining match with its class — active when its index equals state.activeIndex — before Decoration.set sorts rather than RangeSetBuilder so shared offsets never throw.
 */
function buildSearchMarks(state: SearchMarkState, docLength: number): DecorationSet {
  const ranges: Range<Decoration>[] = [];

  for (let index = 0; index < state.matches.length; index++) {
    const match = state.matches[index];

    // An indexed read is possibly undefined under noUncheckedIndexedAccess, so the bounds test below
    // needs a defined match to test; a hole in the array is skipped for the same reason a bad range is.
    if (match === undefined || match.start < 0 || match.end > docLength || match.end <= match.start) {
      // Branch: this match is out of bounds or degenerate — either it starts before offset 0, ends past the document end, or has zero width. Skip it rather than clamp, because a stale match from an earlier snapshot must not paint over characters that no longer belong to it, and a zero-width range (possible with a regex like \b) would throw in Decoration.set instead of drawing.
      continue;
    }

    // Choose the class: every match gets the base tint, but the active one — the one next/previous landed on — also carries the active class so it reads distinctly from the rest.
    if (index === state.activeIndex) {
      // Branch: this is the current match — tag it with both classes so the theme paints it at greater strength and a reader can see which of the twelve they are on, since next and previous are meaningless without that anchor.
      ranges.push(Decoration.mark({ class: `${CM_SEARCH_MATCH_CLASS} ${CM_SEARCH_ACTIVE_CLASS}` }).range(match.start, match.end));
    } else {
      // Branch: an inactive match — tag it with only the base class so it reads as a dimmer sibling of the active one rather than a different kind of thing.
      ranges.push(Decoration.mark({ class: CM_SEARCH_MATCH_CLASS }).range(match.start, match.end));
    }
  }

  // Decoration.set(ranges, true) sorts for us rather than assuming input order: matches arrive in document order already from the search engine, but the flag costs nothing and removes that assumption so a future caller cannot rely on it.
  return Decoration.set(ranges, true);
}

/**
 * @purpose Exposes just the search-marks state field as an Extension so it can be composed into a pane's extension list (FR-9.2).
 * @inputs void — the field carries its own logic and needs no host configuration to function.
 * @outputs readonly Extension[] containing only searchMarksField, ready to spread alongside markdown() and keymaps in a pane setup.
 * @dataflow None — this is a pure passthrough returning an extension descriptor; the state field does all work when mounted.
 * @controlflow Returns a one-element array literal with no branching or state transition.
 */
export function searchMarks(): Extension {
  return [searchMarksField];
}

/**
 * @purpose Provides CSS rules that colour find-match marks in the Source pane as background tints (FR-9.2).
 * @inputs void — theme variables (--kdoc-color-accent) are expected to be defined on a host element or :root by the surrounding design tokens; each rule injects its own tint inline via color-mix over that accent.
 * @outputs an Extension wrapping EditorView.theme with two selector rules keyed by the exported class constants.
 * @dataflow None — pure descriptor; CodeMirror injects the CSS into the document head when the extension mounts and applies it to every mark carrying these classes.
 * @controlflow Returns a single theme-extension object literal built from two rule entries, no branching or state transition.
 */
export function searchMarkTheme(): Extension {
  return EditorView.theme({
    // Inactive matches: a light background tint using the accent colour at low strength with a small border radius to soften the highlight. A background tint is used rather than an underline because the Source pane already spends text-decoration on spell squiggles and border-bottom on comment ranges, so this is the only decoration left that does not collide with those existing marks.
    ['.' + CM_SEARCH_MATCH_CLASS]: {
      background: 'color-mix(in srgb, var(--kdoc-color-accent, #0969da) 22%, transparent)',
      borderRadius: '2px',
    },

    // Active match: the same accent hue at greater strength plus a thin outline so it stands out from the dim siblings. It is the same colour at higher intensity rather than a different colour because next, previous, and every other match are the same kind of thing — a second colour would wrongly suggest a different category (FR-9.2).
    ['.' + CM_SEARCH_ACTIVE_CLASS]: {
      background: 'color-mix(in srgb, var(--kdoc-color-accent, #0969da) 55%, transparent)',
      outline: '1px solid var(--kdoc-color-accent, #0969da)',
    },
  });
}

/**
 * @purpose Dispatches a search-match effect onto an editor view so callers paint matches without knowing about the effect itself (FR-9.2).
 * @inputs view - the live EditorView to dispatch on; state - the authoritative SearchMarkState source-offset ranges plus active index from the search engine.
 * @outputs void — the new set is applied as a side effect of the dispatched transaction, not returned.
 * @dataflow Caller's computed state -> setSearchMatchesEffect.of(state) wrapped in view.dispatch -> searchMarksField.update rebuilds the DecorationSet and re-renders the match tints.
 * @controlflow A single dispatch call with no branching; wraps the effect so callers never import StateEffect or reference searchMarksField directly, keeping decoration plumbing out of feature code (FR-9.2).
 */
export function setSearchMatchesIn(view: EditorView, state: SearchMarkState): void {
  view.dispatch({ effects: setSearchMatchesEffect.of(state) });
}
