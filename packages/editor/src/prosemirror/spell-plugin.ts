/**
 * @file spell-plugin.ts
 * @purpose ProseMirror decoration layer that renders wavy red squiggles under misspelled words (FR-12.1).
 *   Manages spell check decorations, position mapping across edits, transaction metadata updates, and misspelling queries.
 * @inputs ProseMirror transactions (with misspelling metadata), EditorState instances, and document positions.
 * @outputs ProseMirror Plugin instance, CSS stylesheets for squiggle rendering, and misspelling query functions.
 * @functions
 *   - wordFromDecoration: Resolves the misspelled word string associated with a decoration, narrowing its spec or reading from doc text.
 *   - createSpellPlugin: Instantiates the ProseMirror plugin managing spell check decorations.
 *   - setMisspellings: Attaches updated misspelling word spans to a transaction's metadata.
 *   - misspellingAt: Queries whether a document position falls inside a misspelled word decoration.
 *   - misspellingsIn: Collects all active misspelled word spans in document order.
 * @dataflow Transaction metadata (WordSpan[]) -> plugin state rebuild / mapping -> DecorationSet -> view decoration prop & query helpers.
 * @controlflow Initialize empty DecorationSet -> apply receives transaction: rebuild if meta present (guarding bounds), map if absent -> readers query decoration set.
 * @version 1
 * @date 2026-09-06
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorState, Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { WordSpan } from './spell-scan.js';

/**
 * CSS class name applied to inline decorations for misspelled words.
 */
export const SPELL_DECORATION_CLASS: string = 'kdoc-misspelled';

/**
 * Static stylesheet defining the wavy red underline for misspelled words (FR-12.1).
 *
 * Design decisions:
 * - A background tint was rejected: it competes with the selection highlight and with `mark`.
 * - The squiggle is drawn using `text-decoration: underline wavy` with a vivid red visible on both light and dark themes.
 * - `text-decoration-skip-ink: none` ensures descenders (e.g. 'g', 'j', 'p', 'q', 'y') do not break the wavy line.
 * - `text-underline-offset: 3px` ensures the squiggle sits comfortably clear of the text baseline.
 */
export const SPELL_STYLES: string = `
.${SPELL_DECORATION_CLASS} {
  text-decoration: underline wavy var(--kdoc-color-danger, #e53935);
  text-decoration-skip-ink: none;
  text-underline-offset: 3px;
}
`;

/**
 * State retained by the spell check ProseMirror plugin.
 */
export interface SpellPluginState {
  /** The active set of inline decorations representing misspelled words. */
  readonly decorations: DecorationSet;
}

/**
 * Plugin key uniquely identifying the spell check plugin and its state in an EditorState.
 */
export const spellPluginKey: PluginKey<SpellPluginState> = new PluginKey<SpellPluginState>('spellPlugin');

/**
 * Resolves the misspelled word string associated with a decoration, narrowing its spec or reading from doc text.
 *
 * @purpose Extracts the word string from a Decoration's untyped spec with runtime narrowing, falling back to doc text.
 * @inputs
 *   - deco: Decoration - The ProseMirror decoration representing the misspelling.
 *   - state: EditorState - The current editor state containing the document.
 * @outputs string - The resolved misspelled word string.
 * @dataflow deco.spec -> type narrowing -> string, or state.doc.textBetween(deco.from, deco.to) fallback.
 * @controlflow Check if deco.spec is object with string 'word' -> return spec.word; else extract textBetween from doc -> return string.
 */
function wordFromDecoration(deco: Decoration, state: EditorState): string {
  const spec: unknown = deco.spec;
  // Check if spec is a non-null object with a string word property.
  // The spec is untyped in ProseMirror's types, so narrow it: read decoration.spec as unknown,
  // check it is a non-null object with a string word, and fall back to state.doc.textBetween(from, to) when it is not.
  // Narrowing exists rather than casting because ProseMirror's type definitions type spec as any/unknown;
  // runtime verification ensures strict type safety without assumptions, gracefully handling decorations
  // created externally or where the spec object was modified.
  if (
    typeof spec === 'object' &&
    spec !== null &&
    'word' in spec &&
    typeof (spec as { readonly word?: unknown }).word === 'string'
  ) {
    // Valid spec object with string word found: return the stored word directly.
    return (spec as { readonly word: string }).word;
  } else {
    // Spec missing or does not contain a string word: fall back to reading text from the document slice.
    return state.doc.textBetween(deco.from, deco.to);
  }
}

/**
 * Creates the ProseMirror plugin that manages and renders spell check squiggle decorations.
 *
 * @purpose Instantiates the ProseMirror plugin responsible for drawing red squiggles and mapping them across edits.
 * @inputs None.
 * @outputs Plugin - The configured ProseMirror Plugin instance with state and decoration props.
 * @dataflow Transactions -> apply() state handler -> DecorationSet -> props.decorations().
 * @controlflow Configure Plugin with spellPluginKey -> state field manages DecorationSet -> props exports decorations.
 */
export function createSpellPlugin(): Plugin {
  return new Plugin<SpellPluginState>({
    key: spellPluginKey,
    state: {
      init(): SpellPluginState {
        // Initial state has no misspellings: provide an empty DecorationSet.
        return { decorations: DecorationSet.empty };
      },
      apply(tr: Transaction, value: SpellPluginState, _old: EditorState, newState: EditorState): SpellPluginState {
        const meta = tr.getMeta(spellPluginKey);

        // Check whether misspelling metadata is present under spellPluginKey.
        if (meta !== undefined) {
          // Metadata is present: rebuild the decoration set from WordSpan[] against newState.doc.
          // Using Decoration.inline(from, to, { class: SPELL_DECORATION_CLASS }, { word: span.word })
          // so the word travels with the decoration and misspellingAt can recover it without re-reading the document.
          const spans = meta as readonly WordSpan[];
          const decorations: Decoration[] = [];
          const docSize = newState.doc.content.size;

          for (let i = 0; i < spans.length; i++) {
            const span = spans[i];
            // Check if the span element at index i is defined to satisfy strict noUncheckedIndexedAccess.
            if (span === undefined) {
              // Undefined span element: skip iteration.
              continue;
            } else {
              // Defined span element: inspect document boundaries.
            }

            // Guard against a span whose to exceeds newState.doc.content.size and skip it.
            // The scan and the check are separated by an await, so the document can have shrunk in between,
            // and a decoration past the end throws inside ProseMirror.
            if (span.to > docSize) {
              // Document shrunk: skip decoration extending past current document size.
              continue;
            } else {
              // Span end position is within document boundaries.
            }

            // Check if from position is valid (non-negative and strictly less than to).
            if (span.from < 0 || span.from >= span.to) {
              // Span has invalid or collapsed boundaries: skip this span.
              continue;
            } else {
              // Span boundaries are strictly valid: construct inline decoration.
            }

            decorations.push(
              Decoration.inline(
                span.from,
                span.to,
                { class: SPELL_DECORATION_CLASS },
                { word: span.word },
              ),
            );
          }

          return {
            decorations: DecorationSet.create(newState.doc, decorations),
          };
        } else {
          // If absent, map existing decorations across transaction changes via tr.mapping.
          // Mapping rather than dropping is what stops every squiggle flickering off on each keystroke
          // while the debounced re-check is still pending: the result is briefly stale, and briefly stale
          // is far less distracting than briefly absent.
          return {
            decorations: value.decorations.map(tr.mapping, tr.doc),
          };
        }
      },
    },
    props: {
      decorations(state: EditorState): DecorationSet | undefined {
        const pluginState = spellPluginKey.getState(state);
        // Check if spell plugin state is present on the editor state.
        if (pluginState !== undefined) {
          // Plugin state found: return decorations from plugin state.
          return pluginState.decorations;
        } else {
          // Plugin absent: return undefined.
          return undefined;
        }
      },
    },
  });
}

/**
 * Attaches updated misspelling word spans to a transaction's metadata.
 *
 * @purpose Encapsulates metadata setting so callers never have to know the meta key's shape.
 * @inputs
 *   - tr: Transaction - The ProseMirror transaction to annotate.
 *   - spans: readonly WordSpan[] - The collection of misspelled word spans to set.
 * @outputs Transaction - The transaction with metadata attached.
 * @dataflow tr + spans -> tr.setMeta(spellPluginKey, spans) -> Transaction.
 * @controlflow Attach metadata to transaction under spellPluginKey -> return modified transaction.
 */
export function setMisspellings(tr: Transaction, spans: readonly WordSpan[]): Transaction {
  return tr.setMeta(spellPluginKey, spans);
}

/**
 * Finds the misspelled word span containing the given document position, if any.
 *
 * @purpose Queries whether a document position falls inside a misspelled word decoration (FR-12.1).
 * @inputs
 *   - state: EditorState - The current editor state to query.
 *   - pos: number - The document position to test for misspelling containment.
 * @outputs WordSpan | null - The containing WordSpan record if found, or null otherwise.
 * @dataflow state -> pluginState -> decorations.find(pos, pos) -> wordFromDecoration -> WordSpan | null.
 * @controlflow Return null if plugin absent from state -> find decorations touching pos -> return null if no hits -> extract word from first hit -> return WordSpan.
 */
export function misspellingAt(state: EditorState, pos: number): WordSpan | null {
  const pluginState = spellPluginKey.getState(state);
  // Check whether the spell check plugin is active in this editor state.
  // Both readers must tolerate the plugin being absent from state (returns null / []) rather than throwing:
  // spell check is optional and a state built without it is a legitimate configuration, not an error.
  if (pluginState === undefined) {
    // Plugin not installed: return null without throwing.
    return null;
  } else {
    // Plugin state is available: proceed to query decorations at pos.
  }

  // Find decorations whose range contains pos using find(pos, pos).
  // A right-click places the caret inside the word, so containment is the right test
  // and an exact-boundary test would miss the common case.
  const hits = pluginState.decorations.find(pos, pos);
  const hit = hits[0];

  // Check whether any misspelling decoration was found containing pos.
  if (hit === undefined) {
    // No misspelling decoration at this position: return null.
    return null;
  } else {
    // Decoration hit found: resolve word and return WordSpan descriptor.
    return {
      from: hit.from,
      to: hit.to,
      word: wordFromDecoration(hit, state),
    };
  }
}

/**
 * Collects all misspelled word spans currently decorated in the editor state, in document order.
 *
 * @purpose Returns every active misspelling decoration as a WordSpan array for the F7 review dialog.
 * @inputs state: EditorState - The editor state containing the document and spell plugin.
 * @outputs readonly WordSpan[] - Array of WordSpan records in document order, or empty array if plugin absent.
 * @dataflow state -> pluginState -> decorations.find() -> wordFromDecoration -> readonly WordSpan[].
 * @controlflow Return empty array if plugin absent from state -> find all decorations -> map to WordSpan objects -> return array.
 */
export function misspellingsIn(state: EditorState): readonly WordSpan[] {
  const pluginState = spellPluginKey.getState(state);
  // Check whether the spell check plugin is active in this editor state.
  // Both readers must tolerate the plugin being absent from state (returns null / []) rather than throwing:
  // spell check is optional and a state built without it is a legitimate configuration, not an error.
  if (pluginState === undefined) {
    // Plugin not installed: return empty array without throwing.
    return [];
  } else {
    // Plugin state is available: retrieve all active decorations in document order.
  }

  // Calling find() with no range arguments returns all decorations in document order.
  // This is what the F7 review dialog walks to navigate through misspellings sequentially.
  const decorations = pluginState.decorations.find();
  const spans: WordSpan[] = [];

  for (let i = 0; i < decorations.length; i++) {
    const deco = decorations[i];
    // Check if the decoration at index i is defined to satisfy strict noUncheckedIndexedAccess.
    if (deco === undefined) {
      // Undefined element: skip iteration.
      continue;
    } else {
      // Valid decoration element: extract word and collect span.
    }

    spans.push({
      from: deco.from,
      to: deco.to,
      word: wordFromDecoration(deco, state),
    });
  }

  return spans;
}
