/**
 * @file change-bar-plugin.ts
 * @purpose ProseMirror decoration layer that paints Simple Markup's margin change bars in the WYSIWYG pane (FR-11.4). Each bar is a single node decoration placed beside an entire top-level block, driven by whole-line signals rather than character ranges.
 *   Manages change-bar decorations: rebuilding them from planned line positions on each plan arrival and mapping them across ordinary edits so a bar stays beside its line while the user types.
 * @inputs ProseMirror transactions (carrying ChangeBarMeta with document positions), EditorState instances, an EditorView for dispatching updates, and arrays of mapped document positions.
 * @outputs ProseMirror Plugin instance carrying a DecorationSet, the CSS class name 'kdoc-change-bar', and the changeBarPluginKey identifying its state.
 * @functions
 *   - createChangeBarPlugin: Instantiates the ProseMirror plugin managing margin change-bar decorations.
 *   - setChangeBarPositions: Attaches updated document positions to a transaction's metadata under changeBarPluginKey for dispatch by the caller's view.
 *   - buildBarDecorations: Constructs one node decoration per unique top-level block that contains a planned position (module-private, not exported).
 * @dataflow Transaction meta (ChangeBarMeta.positions[]) -> plugin apply handler rebuilds via buildBarDecorations; otherwise maps existing set across tr.mapping -> props.decorations returns the DecorationSet.
 * @controlflow Initialize empty DecorationSet -> apply receives transaction: rebuild when ChangeBarMeta present, map otherwise -> readers read decorations from plugin state.
 * @notes This is a deliberately separate plugin from change-plugin.ts rather than an extra decoration inside it. The mark plugin's metadata contract is a bare array of spans and is covered by tests; bars arrive on a different schedule (a whole-line signal rather than a character range) and mixing the two would mean changing that contract to carry a second payload. Two small plugins each with one job cost less than one plugin with a branch.
 * @notes Positions are document positions, not offsets and not line indices: the caller has already mapped each bar's lineStart through the offset mapper before calling setChangeBarPositions. This plugin performs no remapping of its own — it only finds the block that contains each position and decorates that block. Passing raw source offsets would paint bars at meaningless coordinates.
 * @version 1
 * @date 2026-09-10
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

/**
 * Plugin key uniquely identifying the change-bar plugin and its state in an EditorState.
 */
export const changeBarPluginKey: PluginKey<DecorationSet> = new PluginKey<DecorationSet>('changeBarPlugin');

/**
 * Base CSS class name applied to margin change-bar node decorations (FR-11.4).
 */
export const PM_CHANGE_BAR_CLASS: string = 'kdoc-change-bar';

/**
 * Metadata carried on a transaction's plugin slot requesting a rebuild of the change bars.
 */
export interface ChangeBarMeta {
  /** Document positions, already mapped by the caller, one per planned changed line. */
  readonly positions: readonly number[];
}

/**
 * Creates the ProseMirror plugin that manages and renders Simple Markup margin change bars (FR-11.4).
 *
 * @purpose Instantiates the ProseMirror plugin responsible for painting whole-line margin bars, rebuilding them from planned positions on each plan arrival, and mapping them across ordinary edits so a bar stays beside its line while typing.
 * @inputs None.
 * @outputs Plugin<DecorationSet> - Configured ProseMirror Plugin whose state is directly the DecorationSet of active change bars.
 * @dataflow Transactions -> apply() state handler -> DecorationSet -> props.decorations returns it to the view.
 * @controlflow Configure Plugin with changeBarPluginKey -> state field handles init (empty set) and apply (rebuild on meta, map otherwise) -> props exports decorations from plugin state.
 */
export function createChangeBarPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: changeBarPluginKey,
    state: {
      init(): DecorationSet {
        // Initial editor state begins with no margin bars painted.
        return DecorationSet.empty;
      },
      apply(tr: Transaction, value: DecorationSet, _oldState: EditorState, newState: EditorState): DecorationSet {
        // Read the plan's bar positions off this transaction; undefined means "no new plan arrived".
        const meta = tr.getMeta(changeBarPluginKey) as ChangeBarMeta | undefined;

        // Case 1: a change-bar plan arrived on this transaction -> rebuild bars against the current document.
        if (meta !== undefined) {
          // Rebuild so each bar is re-laid-out over the possibly-changed document from the freshly mapped positions.
          return buildBarDecorations(newState, meta.positions);
        } else {
          // No new plan: map existing bars across this transaction's changes via tr.mapping.
          // Mapping rather than clearing keeps a bar beside its line while the user types, since the plan only re-arrives on a debounce.
          return value.map(tr.mapping, tr.doc);
        }
      },
    },
    props: {
      decorations(state: EditorState): DecorationSet {
        const pluginState = changeBarPluginKey.getState(state);
        // Return the stored bar set when present; fall back to an empty set if the plugin is absent from this state.
        return pluginState ?? DecorationSet.empty;
      },
    },
  });
}

/**
 * Constructs one node decoration per unique top-level block that contains a planned position (FR-11.4).
 *
 * @purpose Maps each mapped document position to the whole-line block it lives in and emits exactly one bar per distinct block, deduping multiple changes on the same line into a single decoration.
 * @inputs
 *   - state: EditorState - The editor state whose document positions are resolved against; must reflect the current document so clamping is meaningful.
 *   - positions: readonly number[] - Document positions (already mapped by the caller), one per planned changed line.
 * @outputs DecorationSet - A set of node decorations, one per unique block start, each tagged with PM_CHANGE_BAR_CLASS.
 * @dataflow positions -> clamp to doc bounds -> resolve -> top-level block -> dedupe starts -> Decoration.node per unique start -> DecorationSet.create(doc, ...).
 * @controlflow Iterate positions -> skip out-of-range/undefined and depth-0 (no-block) positions -> compute block start/node -> skip if already seen -> push decoration -> return created set.
 */
function buildBarDecorations(state: EditorState, positions: readonly number[]): DecorationSet {
  const decorations: Decoration[] = [];
  // Track each block's start position so two changes landing on the same top-level block collapse into a single bar rather than two.
  const seenStarts = new Set<number>();

  for (let i = 0; i < positions.length; i++) {
    const position = positions[i];
    // Guard against an out-of-range index under strict noUncheckedIndexedAccess: skip any undefined element.
    if (position === undefined) {
      // Undefined position slot: skip iteration.
      continue;
    } else {
      // Defined position slot: proceed to clamp and resolve it against the document.
    }

    // Clamp the plan's document position into current document bounds — a plan computed a moment ago can outrun the document, and a decoration placed past the end throws inside ProseMirror.
    // The lower bound is 1, not 0: every position inside a block is at least 1, and resolving at 0 lands in the
    // document root at depth 0 where there is no block to decorate, so the first line's bar would silently vanish.
    const clamped = Math.min(Math.max(position, 1), state.doc.content.size);
    const resolved = state.doc.resolve(clamped);

    // Resolve upward to find the top-level block node this position lives in; depth 1 is the paragraph/heading/list that owns the margin bar, so a single before(1)/node(1) suffices.
    const block = resolved.depth === 0 ? null : { start: resolved.before(1), node: resolved.node(1)! };

    // A depth of 0 means the position resolves into the document root itself (e.g. an empty doc) with no enclosing block to decorate.
    if (block === null) {
      // Position sits directly in the document root: there is no enclosing block, so skip it.
      continue;
    } else {
      // A top-level block was found at depth >= 1: use its start and node size for a single bar decoration.
    }

    const { start, node } = block;
    // Check whether this block already has a bar so repeated changes on the same line do not stack into multiple decorations.
    if (seenStarts.has(start)) {
      // This block already carries a bar — Simple Markup says *this line changed*, so emitting it again for one line is noise: skip.
      continue;
    } else {
      // First time seeing this block: record its start and emit exactly one node decoration spanning the whole block in the margin.
    }

    seenStarts.add(start);
    decorations.push(Decoration.node(start, start + node.nodeSize, { class: PM_CHANGE_BAR_CLASS }));
  }

  return DecorationSet.create(state.doc, decorations);
}

/**
 * Attaches updated change-bar positions to a transaction's metadata under changeBarPluginKey for the caller's view to dispatch.
 *
 * @purpose Encapsulates metadata assignment so callers do not manipulate the plugin key or ChangeBarMeta shape directly, and guarantees the update rides on its own transaction (triggering an apply rebuild).
 * @inputs
 *   - view: EditorView - The live ProseMirror view whose state is dispatched.
 *   - positions: readonly number[] - Document positions, already mapped by the caller, one per planned changed line.
 * @outputs void - No return value; the transaction is dispatched on the provided view as a side effect.
 * @dataflow positions -> ChangeBarMeta { positions } -> tr.setMeta(changeBarPluginKey, meta) -> view.dispatch triggers apply rebuild.
 * @controlflow Build the meta object from positions -> wrap it in a fresh transaction via view.state.tr -> dispatch to update editor state.
 */
export function setChangeBarPositions(view: EditorView, positions: readonly number[]): void {
  const meta: ChangeBarMeta = { positions };
  // Dispatching on its own transaction carries the meta so apply() rebuilds the bars; a plain read would never paint anything.
  view.dispatch(view.state.tr.setMeta(changeBarPluginKey, meta));
}
