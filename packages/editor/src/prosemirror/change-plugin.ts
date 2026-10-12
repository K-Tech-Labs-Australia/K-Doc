/**
 * @file change-plugin.ts
 * @purpose ProseMirror decoration layer that paints tracked insertions and deletions in the WYSIWYG pane (FR-11.1, FR-11.6).
 *   Manages change decorations for both kinds of tracked edit, position mapping across edits, transaction metadata updates,
 *   and change-id queries at a document position.
 * @inputs ProseMirror transactions (carrying change spans), EditorState instances, and document positions.
 * @outputs ProseMirror Plugin instance, CSS stylesheets for change rendering, and change query helpers.
 * @functions
 *   - buildDeletionWidget: Builds the DOM node holding deleted text that is not part of the document.
 *   - parseChangeSpec: Safely narrows and extracts a string changeId from a decoration's untyped spec using early return.
 *   - buildDecorations: Constructs inline and widget decorations from change spans guarding document bounds.
 *   - createChangePlugin: Instantiates the ProseMirror plugin managing tracked-change decorations.
 *   - setChangeSpans: Attaches updated change spans to a transaction's metadata under changePluginKey.
 *   - changesAt: Queries all distinct change identifiers whose inline decorations contain a document position.
 * @dataflow Transaction metadata (readonly ChangeSpan[]) -> plugin apply handler -> DecorationSet & query helpers.
 * @controlflow Initialize empty DecorationSet -> apply receives transaction: rebuild if meta is an array, map otherwise -> readers query decoration set.
 * @notes Insertions live in the document so they paint as inline decorations; deletions were removed and exist only in the overlay,
 *   so they paint as widgets — DOM nodes holding text the document does not contain drawn at a zero-width point. That asymmetry is
 *   why this file needs two decoration kinds where comment-plugin needed one. ChangeSpan.start/.end must already be ProseMirror
 *   positions here (the caller maps them); passing raw source offsets paints at meaningless coordinates.
 * @version 2
 * @date 2026-09-10
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorState, Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { authorHue, type ChangeSpan } from '@k-doc/core';

/**
 * Base CSS class name applied to inline decorations for tracked insertions.
 */
export const CHANGE_INSERT_CLASS: string = 'kdoc-change-insert';

/**
 * Base CSS class name applied to widget nodes holding deleted text that is not part of the document.
 */
export const CHANGE_DELETE_CLASS: string = 'kdoc-change-delete';

/**
 * Static stylesheet defining underline and strikethrough styles for tracked changes (FR-11.1, FR-11.6).
 *
 * Design decisions:
 * - Both classes read their accent colour from `hsl(var(--kdoc-author-hue) 65% 45%)` so the author's own hue is inherited
 *   while only that single component varies per change; the saturation (65%) and lightness (45%) are fixed by the theme.
 * - Only the hue is inherited because the same hue reads differently on a light versus a dark ground, and pinning the
 *   saturation/lightness to the theme keeps both insertions and deletions legible in either mode without per-author tuning.
 */
export const CHANGE_STYLES: string = `
.${CHANGE_INSERT_CLASS} {
  text-decoration: underline;
  text-decoration-color: hsl(var(--kdoc-author-hue) 65% 45%);
  text-underline-offset: 2px;
}

.${CHANGE_DELETE_CLASS} {
  text-decoration: line-through;
  color: hsl(var(--kdoc-author-hue) 65% 45%);
  opacity: 0.7;
  user-select: none;
}

.kdoc-change-bar {
  position: relative;
}

.kdoc-change-bar::before {
  content: '';
  position: absolute;
  left: -0.75rem;
  top: 0;
  bottom: 0;
  width: 3px;
  border-radius: 1px;
  background: hsl(210 8% 45%);
}`;

/**
 * State retained by the change ProseMirror plugin.
 */
export interface ChangePluginState {
  /** The active set of inline and widget decorations representing tracked changes. */
  readonly decorations: DecorationSet;
}

/**
 * Plugin key uniquely identifying the change plugin and its state in an EditorState.
 */
export const changePluginKey: PluginKey<ChangePluginState> = new PluginKey<ChangePluginState>('changePlugin');

/**
 * Metadata stored in a ProseMirror decoration spec for a tracked-change span.
 */
interface ChangeDecoSpec {
  readonly changeId: string;
  readonly kind: 'insert' | 'delete';
}

/**
 * Builds the DOM node holding deleted text that is not part of the document (FR-11.6).
 *
 * @purpose Constructs a widget element rendering removed run text at a zero-width point in the pane.
 * @inputs span: ChangeSpan - The deletion change whose start position and text drive the widget's placement and content.
 * @outputs HTMLElement - A <span> carrying the deleted text, styled by the author hue and tagged with its change id.
 * @dataflow span.text + span.author -> element construction -> returned DOM node for ProseMirror to place at span.start.
 * @controlflow Create span -> set class, data-change-id, style attribute from authorHue -> assign textContent -> return node.
 */
function buildDeletionWidget(span: ChangeSpan): HTMLElement {
  const el = document.createElement('span');
  // Apply the deletion marker class so CHANGE_STYLES renders it as a strikethrough tinted by the author hue.
  el.className = CHANGE_DELETE_CLASS;
  // Tag the node with its change id so callers can correlate a rendered widget back to its plan entry.
  el.setAttribute('data-change-id', span.changeId);
  // Carry the author's hue as an inline custom property, mirroring how inline insertions set --kdoc-author-hue.
  el.setAttribute('style', `--kdoc-author-hue: ${authorHue(span.author)}`);
  // textContent is used (rather than innerHTML) because the deleted run is arbitrary document text that must never be
  // parsed as markup; it also guarantees this node's characters are inert. This node is not part of the document — it
  // renders between characters without occupying a position, which is exactly what makes a tracked deletion visible at all.
  el.textContent = span.text;
  return el;
}

/**
 * Extracts and narrows a string changeId from a decoration's untyped spec.
 *
 * @purpose Narrows unknown decoration spec to ChangeDecoSpec using an early-return guard, tolerating widget specs without one.
 * @inputs deco: Decoration - The ProseMirror decoration to extract spec metadata from.
 * @outputs ChangeDecoSpec | null - Parsed change spec, or null if invalid, absent, or lacking a string changeId.
 * @dataflow deco.spec -> early return guard -> property reads -> ChangeDecoSpec | null.
 * @controlflow Guard non-object/null and missing string changeId early returning null -> read kind with default 'insert' -> return spec.
 */
function parseChangeSpec(deco: Decoration): ChangeDecoSpec | null {
  const spec: unknown = deco.spec;
  // Guard with early return if spec is not an object or does not carry a string changeId (widget decorations have none).
  if (
    typeof spec !== 'object' ||
    spec === null ||
    typeof (spec as { readonly changeId?: unknown }).changeId !== 'string'
  ) {
    // Invalid spec structure, no spec, or missing string changeId: return null early.
    return null;
  } else {
    // Valid spec object with a string changeId: proceed with field extraction.
  }

  const changeId = (spec as { readonly changeId: string }).changeId;
  const rawKind = (spec as { readonly kind?: unknown }).kind;
  // Widget decorations carry no kind in their spec, so default to 'insert' for anything that is not explicitly a deletion.
  let kind: ChangeDecoSpec['kind'];
  if (rawKind === 'delete') {
    // Spec marks this as a tracked deletion.
    kind = 'delete';
  } else {
    // No explicit delete marker (including absent spec): treat the change as an insertion.
    kind = 'insert';
  }

  return { changeId, kind };
}

/**
 * Constructs inline and widget decorations from a list of change spans against the document.
 *
 * @purpose Transforms ChangeSpan records into ProseMirror decorations — inline for insertions, widgets for deletions — guarding bounds.
 * @inputs
 *   - spans: readonly ChangeSpan[] - List of change spans to convert into decorations.
 *   - docSize: number - Current document content size for boundary checking.
 * @outputs Decoration[] - Array of constructed ProseMirror inline and widget decorations.
 * @dataflow spans -> bounds checks -> kind branch -> Decoration.inline / Decoration.widget -> Decoration[].
 * @controlflow Iterate spans -> skip undefined/out-of-bounds/collapsed spans -> branch on kind -> push decoration -> return array.
 */
function buildDecorations(spans: readonly ChangeSpan[], docSize: number): Decoration[] {
  const decorations: Decoration[] = [];

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    // Check if span at index i is defined to satisfy strict noUncheckedIndexedAccess.
    if (span === undefined) {
      // Undefined span element: skip iteration.
      continue;
    } else {
      // Defined span element: inspect document boundaries.
    }

    // Skip a span whose end exceeds docSize.
    // A plan computed a moment ago can outrun the document, and a decoration placed past the end throws inside ProseMirror.
    if (span.end > docSize) {
      // Span extends beyond current document boundaries: skip this span to avoid an out-of-range decoration.
      continue;
    } else {
      // Span end is within document bounds.
    }

    // Check whether the span marks a tracked insertion or deletion, choosing inline versus widget rendering accordingly.
    if (span.kind === 'insert') {
      // Insertions live in the document: paint them as an inline decoration over their range.
      // A collapsed range (start >= end) has no characters to mark and is skipped so nothing renders at a zero-width point.
      if (span.start >= span.end) {
        // Collapsed insertion with no characters: skip, there is nothing to underline.
        continue;
      } else {
        // Non-collapsed insertion: construct inline decoration carrying the change id and kind in its spec for queries.
        decorations.push(
          Decoration.inline(span.start, span.end, { class: CHANGE_INSERT_CLASS, style: `--kdoc-author-hue: ${authorHue(span.author)}` }, { changeId: span.changeId, kind: span.kind }),
        );
      }
    } else if (span.kind === 'delete') {
      // Deletions were removed from the document and exist only in the overlay: paint them as a widget at their start point.
      decorations.push(
        Decoration.widget(span.start, () => buildDeletionWidget(span), { side: -1, key: `del-${span.changeId}` }),
      );
    } else {
      // Unknown kind: leave it unmarked rather than guessing an rendering mode for a span we do not understand.
    }
  }

  return decorations;
}

/**
 * Creates the ProseMirror plugin that manages and renders tracked-change insertions and deletions (FR-11.1, FR-11.6).
 *
 * @purpose Instantiates the ProseMirror plugin responsible for painting change decorations, mapping them across edits, and querying positions.
 * @inputs None.
 * @outputs Plugin - Configured ProseMirror Plugin instance with ChangePluginState management and decoration props.
 * @dataflow Transactions -> apply() state handler -> DecorationSet -> props.decorations & query helpers.
 * @controlflow Configure Plugin with changePluginKey -> state field handles init and apply -> props exports decorations.
 */
export function createChangePlugin(): Plugin {
  return new Plugin<ChangePluginState>({
    key: changePluginKey,
    state: {
      init(): ChangePluginState {
        // Initial state begins with no tracked-change decorations.
        return {
          decorations: DecorationSet.empty,
        };
      },
      apply(tr: Transaction, value: ChangePluginState, _old: EditorState, newState: EditorState): ChangePluginState {
        const meta = tr.getMeta(changePluginKey);

        // Case 1: metadata is an array of change spans -> rebuild decorations from the plan against the new document.
        if (Array.isArray(meta)) {
          // Rebuild so insertions and deletions are re-laid-out over the current document after any edit.
          const decorations = buildDecorations(meta, newState.doc.content.size);
          return {
            decorations: DecorationSet.create(newState.doc, decorations),
          };
        } else {
          // No metadata (or non-array): map existing decorations across transaction changes via tr.mapping.
          // Mapping rather than clearing keeps the marks steady while the user types, since the plan is recomputed on a debounce.
          return {
            decorations: value.decorations.map(tr.mapping, tr.doc),
          };
        }
      },
    },
    props: {
      decorations(state: EditorState): DecorationSet | undefined {
        const pluginState = changePluginKey.getState(state);
        // Check if change plugin state is present on the editor state.
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
 * Attaches updated change spans to a transaction's metadata under changePluginKey.
 *
 * @purpose Encapsulates metadata assignment for change span updates so callers do not manipulate plugin keys directly.
 * @inputs
 *   - tr: Transaction - The ProseMirror transaction to annotate.
 *   - spans: readonly ChangeSpan[] - The collection of planned change spans to set.
 * @outputs Transaction - The transaction with metadata attached.
 * @dataflow tr + spans -> tr.setMeta(changePluginKey, spans) -> Transaction.
 * @controlflow Attach the span array directly as plugin meta and return the annotated transaction.
 */
export function setChangeSpans(tr: Transaction, spans: readonly ChangeSpan[]): Transaction {
  // The apply handler treats an array under changePluginKey as "rebuild from these spans", so store them verbatim.
  return tr.setMeta(changePluginKey, spans);
}

/**
 * Queries all distinct change identifiers whose inline decorations contain the specified document position.
 *
 * @purpose Finds every tracked-change id covering a given position, accommodating overlapping insertions and clicks landing on more than one.
 * @inputs
 *   - state: EditorState - The current editor state to query.
 *   - pos: number - The document position to test for change containment.
 * @outputs readonly string[] - Array of distinct matching change identifiers, or empty array if plugin absent or none found.
 * @dataflow state -> pluginState -> decorations.find(pos, pos) -> parseChangeSpec -> distinct changeIds.
 * @controlflow Return empty array if plugin absent -> find decorations touching pos -> read spec.changeId narrowing through unknown -> collect unique ids -> return array.
 */
export function changesAt(state: EditorState, pos: number): readonly string[] {
  const pluginState = changePluginKey.getState(state);
  // Check whether the change plugin is active in this editor state.
  // Tolerates the plugin being absent from state (returns []) rather than throwing: a state built without it is a legitimate configuration, not an error.
  if (pluginState === undefined) {
    // Plugin not installed: return empty array without throwing.
    return [];
  } else {
    // Plugin state is available: proceed to query decorations at pos.
  }

  // Find decorations whose range touches pos using find(pos, pos). Only inline insertions carry a spec.changeId; widget deletions do not.
  const hits = pluginState.decorations.find(pos, pos);
  const changeIds: string[] = [];

  for (let i = 0; i < hits.length; i++) {
    const deco = hits[i];
    // Check if decoration at index i is defined to satisfy strict noUncheckedIndexedAccess.
    if (deco === undefined) {
      // Undefined decoration element: skip.
      continue;
    } else {
      // Valid decoration element: inspect its spec for a change id.
    }

    const spec = parseChangeSpec(deco);
    // Check if the decoration carries a parsed changeId and it has not already been collected (dedupe overlapping hits).
    if (spec !== null && !changeIds.includes(spec.changeId)) {
      // Collect this distinct change identifier.
      changeIds.push(spec.changeId);
    } else {
      // Spec missing/absent or id already recorded: skip to avoid duplicates and widget noise.
    }
  }

  return changeIds;
}