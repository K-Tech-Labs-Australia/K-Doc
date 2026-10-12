/**
 * @file search-plugin.ts
 * @purpose ProseMirror decoration layer that highlights find matches in the WYSIWYG pane (FR-9.2). Each match is an inline decoration placed over a document position range, driven by ranges already mapped from source offsets to live-document positions by the shell.
 *   Manages search-match decorations: rebuilding them from incoming SearchMeta on each re-search and mapping them across ordinary edits so highlights stay anchored to the matched words while the user types.
 * @inputs ProseMirror transactions (carrying SearchMeta with document position ranges), EditorState instances, an EditorView for dispatching updates, and the already-mapped range list produced by the shell's offset mapper.
 * @outputs ProseMirror Plugin instance carrying a DecorationSet, the CSS class names 'kdoc-search-match' and 'kdoc-search-active', and the SEARCH_STYLES stylesheet shared with the Source pane.
 * @functions
 *   - createSearchPlugin: Instantiates the ProseMirror plugin managing search-match decorations.
 *   - setSearchRanges: Attaches updated ranges to a transaction's metadata under searchPluginKey for dispatch by the caller's view.
 *   - buildSearchDecorations: Constructs one inline decoration per mapped range (module-private, not exported).
 * @dataflow Transaction meta (SearchMeta.ranges[]) -> plugin apply handler rebuilds via buildSearchDecorations; otherwise maps existing set across tr.mapping -> props.decorations returns the DecorationSet.
 * @controlflow Initialize empty DecorationSet -> apply receives transaction: rebuild when SearchMeta present, map otherwise -> readers read decorations from plugin state.
 * @notes The find panel searches source text, but this pane is not indexed by source offsets: what arrives here is a list of already-mapped document position ranges, never raw mdast offsets. Only the shell holds both the mdast root and the live document, so mapping each range's through/into positions to live-document coordinates is the shell's job — passing raw source offsets would paint highlights at meaningless coordinates.
 * @notes The styling classes are identical to those the Source pane uses ('kdoc-search-match' / 'kdoc-search-active') so a match looks like a match in whichever pane the reader happens to be in, and SEARCH_STYLES is shared with that pane's stylesheet.
 * @version 1
 * @date 2026-09-11
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

/**
 * Plugin key uniquely identifying the search plugin and its state in an EditorState.
 */
export const searchPluginKey: PluginKey<DecorationSet> = new PluginKey<DecorationSet>('searchPlugin');

/**
 * Base CSS class name applied to non-active find-match inline decorations (FR-9.2).
 * Shares the Source pane's match styling so a highlight looks identical in either pane.
 */
export const PM_SEARCH_MATCH_CLASS: string = 'kdoc-search-match';

/**
 * CSS class name applied to the currently active (focused) find-match inline decoration (FR-9.2).
 * Shares the Source pane's active styling so a highlight looks identical in either pane.
 */
export const PM_SEARCH_ACTIVE_CLASS: string = 'kdoc-search-active';

/**
 * Shared stylesheet for find-match highlighting, one rule per class (FR-9.2).
 * A background tint is used rather than an underline because this pane already spends text-decoration on spell squiggles and border-bottom on comment ranges; a second decorative layer would clutter the text. The rules match the Source pane's tints so matches look identical across panes.
 */
export const SEARCH_STYLES: string = `
.kdoc-search-match {
  background: color-mix(in srgb, var(--kdoc-color-accent, #0969da) 22%, transparent);
  border-radius: 2px;
}

.kdoc-search-active {
  background: color-mix(in srgb, var(--kdoc-color-accent, #0969da) 55%, transparent);
  outline: 1px solid var(--kdoc-color-accent, #0969da);
}
`;

/**
 * A single find-match range expressed as document positions (FR-9.2).
 * Positions are already mapped from source offsets by the shell; this pane performs no remapping of its own.
 */
export interface SearchRange {
  /** Start document position of the match. */
  readonly from: number;
  /** End document position of the match. */
  readonly to: number;
}

/**
 * Metadata carried on a transaction's plugin slot requesting a rebuild of the search highlights (FR-9.2).
 */
export interface SearchMeta {
  /** Document position ranges, already mapped by the caller, one per match found in source text. */
  readonly ranges: readonly SearchRange[];
  /** Index into `ranges` of the currently active (focused) match, or -1 when none is focused. */
  readonly activeIndex: number;
}

/**
 * Creates the ProseMirror plugin that manages and renders find-match highlights (FR-9.2).
 *
 * @purpose Instantiates the ProseMirror plugin responsible for painting inline match decorations, rebuilding them from incoming ranges on each re-search, and mapping them across ordinary edits so a highlight stays anchored to its matched words while typing.
 * @inputs None.
 * @outputs Plugin<DecorationSet> - Configured ProseMirror Plugin whose state is directly the DecorationSet of active search matches.
 * @dataflow Transactions -> apply() state handler -> DecorationSet -> props.decorations returns it to the view.
 * @controlflow Configure Plugin with searchPluginKey -> state field handles init (empty set) and apply (rebuild on meta, map otherwise) -> props exports decorations from plugin state.
 */
export function createSearchPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: searchPluginKey,
    state: {
      init(): DecorationSet {
        // Initial editor state begins with no match highlights painted.
        return DecorationSet.empty;
      },
      apply(tr: Transaction, value: DecorationSet, _oldState: EditorState, newState: EditorState): DecorationSet {
        // Read the search ranges off this transaction; undefined means "no new search arrived".
        const meta = tr.getMeta(searchPluginKey) as SearchMeta | undefined;

        // Case 1: a re-search arrived on this transaction -> rebuild highlights against the current document.
        if (meta !== undefined) {
          // Rebuild so each match is re-laid-out over the possibly-changed document from the freshly mapped ranges.
          return buildSearchDecorations(newState, meta);
        } else {
          // No new search: map existing highlights across this transaction's changes via tr.mapping.
          // Mapping rather than clearing keeps the highlights on the right words while the user types, since a re-search only arrives on the next keystroke's debounce.
          return value.map(tr.mapping, tr.doc);
        }
      },
    },
    props: {
      decorations(state: EditorState): DecorationSet {
        const pluginState = searchPluginKey.getState(state);
        // Return the stored highlight set when present; fall back to an empty set if the plugin is absent from this state.
        return pluginState ?? DecorationSet.empty;
      },
    },
  });
}

/**
 * Constructs one inline decoration per mapped find-match range (FR-9.2).
 *
 * @purpose Emits exactly one inline decoration per SearchRange, tagging the currently active match with a distinct class so it can be visually distinguished from the other matches.
 * @inputs
 *   - state: EditorState - The editor state whose document positions are resolved against; must reflect the current document so clamping is meaningful.
 *   - meta: SearchMeta - Document position ranges, already mapped by the caller, and the index of the active match.
 * @outputs DecorationSet - A set of inline decorations, one per valid range, each tagged with PM_SEARCH_MATCH_CLASS or PM_SEARCH_ACTIVE_CLASS.
 * @dataflow meta.ranges -> clamp to doc bounds -> skip collapsed ranges -> pick class by activeIndex -> Decoration.inline per range -> DecorationSet.create(doc, ...).
 * @controlflow Iterate ranges with index -> clamp from/to -> skip when clamped to <= from -> choose class via if/else on index === activeIndex -> push inline decoration -> return created set.
 */
function buildSearchDecorations(state: EditorState, meta: SearchMeta): DecorationSet {
  const decorations: Decoration[] = [];

  for (let i = 0; i < meta.ranges.length; i++) {
    const range = meta.ranges[i];
    // Guard against an out-of-range index under strict noUncheckedIndexedAccess: skip any undefined element.
    if (range === undefined) {
      // Undefined range slot: skip iteration.
      continue;
    } else {
      // Defined range slot: proceed to clamp it against the document bounds.
    }

    // Clamp both ends of the range into current document bounds — a range computed a moment ago can outrun the document, and a decoration placed past the end throws inside ProseMirror.
    const from = Math.min(Math.max(range.from, 0), state.doc.content.size);
    const to = Math.min(Math.max(range.to, 0), state.doc.content.size);

    // Clamping can itself collapse a range that reached past the end, and there is deliberately no guard
    // for that here: ProseMirror drops a collapsed inline decoration on its own. An explicit skip was
    // written first and mutation testing showed removing it broke nothing, so it was removed rather than
    // left as a branch nothing exercises. The behaviour is pinned by a test, not by this code.

    // The active match is distinguished by a heavier tint, so tag it with the active class and every other match with the base class.
    if (i === meta.activeIndex) {
      // This is the currently focused match: apply the stronger active highlight.
      decorations.push(Decoration.inline(from, to, { class: PM_SEARCH_ACTIVE_CLASS }));
    } else {
      // This is a non-active match: apply the standard base highlight.
      decorations.push(Decoration.inline(from, to, { class: PM_SEARCH_MATCH_CLASS }));
    }
  }

  return DecorationSet.create(state.doc, decorations);
}

/**
 * Attaches updated search ranges to a transaction's metadata under searchPluginKey for the caller's view to dispatch.
 *
 * @purpose Encapsulates metadata assignment so callers do not manipulate the plugin key or SearchMeta shape directly, and guarantees the update rides on its own transaction (triggering an apply rebuild).
 * @inputs
 *   - view: EditorView - The live ProseMirror view whose state is dispatched.
 *   - meta: SearchMeta - Document position ranges, already mapped by the caller, plus the active match index.
 * @outputs void - No return value; the transaction is dispatched on the provided view as a side effect.
 * @dataflow meta -> tr.setMeta(searchPluginKey, meta) -> view.dispatch triggers apply rebuild.
 * @controlflow Wrap meta in a fresh transaction via view.state.tr -> dispatch to update editor state.
 */
export function setSearchRanges(view: EditorView, meta: SearchMeta): void {
  // Dispatching on its own transaction carries the meta so apply() rebuilds the highlights; a plain read would never paint anything.
  view.dispatch(view.state.tr.setMeta(searchPluginKey, meta));
}
