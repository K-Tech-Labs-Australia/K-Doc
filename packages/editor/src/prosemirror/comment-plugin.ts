/**
 * @file comment-plugin.ts
 * @purpose ProseMirror decoration layer that renders subtle underlines and tints for commented ranges (FR-10.1).
 *   Manages comment decorations, active thread selection, position mapping across edits, transaction metadata updates,
 *   and comment thread queries.
 * @inputs ProseMirror transactions (carrying comment spans or active thread changes), EditorState instances, and document positions.
 * @outputs ProseMirror Plugin instance, CSS stylesheets for comment rendering, and comment query helpers.
 * @functions
 *   - buildDecorationClass: Constructs the composite CSS class list for a comment span based on state and active selection.
 *   - decorationAttrsFor: Resolves DecorationAttrs applying opacity reduction when confidence is below 1.
 *   - parseCommentSpec: Safely narrows and extracts comment metadata from a decoration's untyped spec using early return.
 *   - readMeta: Extracts and narrows CommentMeta payload from transaction metadata.
 *   - buildDecorations: Constructs inline decorations from comment spans guarding document bounds.
 *   - restyleDecorations: Updates decoration classes and styles in place without recomputing positions.
 *   - createCommentPlugin: Instantiates the ProseMirror plugin managing comment decorations and active thread state.
 *   - setCommentSpans: Attaches updated comment spans to a transaction's metadata under commentPluginKey.
 *   - setActiveThread: Attaches an active thread selection change to a transaction's metadata under commentPluginKey.
 *   - commentsAt: Queries all comment thread identifiers whose decorations contain a document position.
 *   - activeThreadId: Queries the currently active comment thread identifier from an editor state.
 * @dataflow Transaction metadata (CommentMeta) -> plugin apply handler -> DecorationSet & activeThreadId -> props.decorations & query helpers.
 * @controlflow Initialize empty DecorationSet and null activeThread -> apply receives transaction: rebuild if spans present (guarding doc bounds), restyle in place if active changed, map if absent -> readers query decoration set.
 * @version 1
 * @date 2026-09-07
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorState, Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { DecorationAttrs } from 'prosemirror-view';
import type { CommentMarkState, CommentSpan } from '@k-doc/core';

/**
 * Base CSS class name applied to inline decorations for commented ranges.
 */
export const COMMENT_DECORATION_CLASS: string = 'kdoc-commented';

/**
 * Modifier CSS class name applied to decorations for resolved comment threads.
 */
export const COMMENT_RESOLVED_CLASS: string = 'kdoc-commented-resolved';

/**
 * Modifier CSS class name applied to decorations for the currently active comment thread.
 */
export const COMMENT_ACTIVE_CLASS: string = 'kdoc-commented-active';

/**
 * Static stylesheet defining subtle underline and tint styles for commented ranges (FR-10.1).
 *
 * Design decisions:
 * - `border-bottom` is used rather than `text-decoration` because the spell plugin already owns
 *   `text-decoration` on any misspelled word (`text-decoration: underline wavy ...`), and only one
 *   of the two would survive if both targeted the same text range.
 * - The background tint is weak on purpose (about 10% for open, 22% for active, 7% for resolved)
 *   because a commented range shares its text with `<mark>` (highlighting), the selection highlight,
 *   and the spell squiggle, and a comment is the least urgent of the four.
 * - The three comment visual states are:
 *   1. Default/open comment (kdoc-commented): 1px border and about 10% accent tint that sits under
 *      the text without competing with higher-urgency decorations.
 *   2. Active thread comment (kdoc-commented-active): 2px solid accent border and about 22% accent tint
 *      that immediately identifies the currently selected or focused comment thread.
 *   3. Resolved comment (kdoc-commented-resolved): 1px dashed muted border and about 7% muted tint,
 *      signalling finished business that should not draw active attention.
 * - These three states remain distinctly distinguishable in both light and dark themes through the use of
 *   canonical `--kdoc-color-accent` and `--kdoc-color-text-muted` custom properties with fallbacks.
 */
export const COMMENT_STYLES: string = `
.${COMMENT_DECORATION_CLASS} {
  background-color: color-mix(in srgb, var(--kdoc-color-accent, #0969da) 10%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--kdoc-color-accent, #0969da) 60%, transparent);
}

.${COMMENT_ACTIVE_CLASS} {
  background-color: color-mix(in srgb, var(--kdoc-color-accent, #0969da) 22%, transparent);
  border-bottom: 2px solid var(--kdoc-color-accent, #0969da);
}

.${COMMENT_RESOLVED_CLASS} {
  background-color: color-mix(in srgb, var(--kdoc-color-text-muted, #57606a) 7%, transparent);
  border-bottom: 1px dashed color-mix(in srgb, var(--kdoc-color-text-muted, #57606a) 40%, transparent);
}
`;

/**
 * State retained by the comment ProseMirror plugin.
 */
export interface CommentPluginState {
  /** The active set of inline decorations representing commented ranges. */
  readonly decorations: DecorationSet;
  /** The identifier of the currently active/focused comment thread, or null if none. */
  readonly activeThreadId: string | null;
}

/**
 * Plugin key uniquely identifying the comment plugin and its state in an EditorState.
 */
export const commentPluginKey: PluginKey<CommentPluginState> = new PluginKey<CommentPluginState>('commentPlugin');

/**
 * Metadata stored in a ProseMirror decoration spec for a comment span.
 */
interface CommentDecoSpec {
  readonly threadId: string;
  readonly state: CommentMarkState;
  readonly confidence: number;
}

/**
 * Structured metadata payload attached to transactions by comment plugin setters.
 */
interface CommentMeta {
  readonly spans?: readonly CommentSpan[];
  readonly activeThreadId?: string | null;
  readonly setsActive?: boolean;
}

/**
 * Constructs the composite CSS class list for a comment decoration span.
 *
 * @purpose Assembles the class name incorporating base decoration, resolved status, and active selection.
 * @inputs
 *   - state: CommentMarkState - The mark state ('open' or 'resolved').
 *   - threadId: string - The identifier of the thread owning this decoration span.
 *   - activeId: string | null - The currently active thread identifier, if any.
 * @outputs string - Space-separated CSS class string.
 * @dataflow state + threadId + activeId -> string concatenation -> class list string.
 * @controlflow Append COMMENT_DECORATION_CLASS -> if state === 'resolved' append COMMENT_RESOLVED_CLASS -> if threadId === activeId append COMMENT_ACTIVE_CLASS -> return class string.
 */
function buildDecorationClass(
  state: CommentMarkState,
  threadId: string,
  activeId: string | null,
): string {
  let cls = COMMENT_DECORATION_CLASS;
  // Check whether this comment span belongs to a resolved thread.
  if (state === 'resolved') {
    // Resolved thread: append resolved modifier class for muted rendering.
    cls += ` ${COMMENT_RESOLVED_CLASS}`;
  } else {
    // Open thread: no resolved class added.
  }

  // Check whether this span belongs to the currently active comment thread.
  if (activeId !== null && threadId === activeId) {
    // Active thread: append active modifier class for prominent underline and tint.
    cls += ` ${COMMENT_ACTIVE_CLASS}`;
  } else {
    // Inactive thread: no active class added.
  }

  return cls;
}

/**
 * Resolves the DecorationAttrs for a comment span, determining CSS class and confidence-based style.
 *
 * @purpose Produces the attributes object for an inline comment decoration, applying opacity reduction when confidence < 1.
 * @inputs
 *   - state: CommentMarkState - Visual state of the comment mark ('open' | 'resolved').
 *   - threadId: string - The thread identifier associated with the span.
 *   - confidence: number - Resolution confidence score between 0 and 1.
 *   - activeId: string | null - Currently active thread identifier.
 * @outputs DecorationAttrs - Decoration attributes containing class and optional inline style.
 * @dataflow state + threadId + confidence + activeId -> buildDecorationClass + confidence check -> DecorationAttrs.
 * @controlflow Compute class name -> check if confidence < 1: set inline opacity style if true; otherwise return class only.
 */
function decorationAttrsFor(
  state: CommentMarkState,
  threadId: string,
  confidence: number,
  activeId: string | null,
): DecorationAttrs {
  const className = buildDecorationClass(state, threadId, activeId);

  // Check whether the anchor resolution confidence is less than 1.
  // Confidence drives opacity, not presence: a rescued anchor is still a real comment
  // and hiding it would lose it, but the reader deserves to see that its position is
  // inferred rather than certain. An inline style reducing opacity visually signals
  // that the comment position is estimated.
  if (confidence < 1) {
    // Inferred anchor: apply reduced opacity to signal lower confidence.
    return {
      class: className,
      style: 'opacity: 0.6;',
    };
  } else {
    // Certain anchor: standard opacity with full visual presence.
    return {
      class: className,
    };
  }
}

/**
 * Extracts and narrows comment metadata from a decoration's untyped spec.
 *
 * @purpose Narrows unknown decoration spec to CommentDecoSpec using an early return guard.
 * @inputs deco: Decoration - The ProseMirror decoration to extract spec metadata from.
 * @outputs CommentDecoSpec | null - Parsed comment spec, or null if invalid or absent.
 * @dataflow deco.spec -> early return guard -> property reads -> CommentDecoSpec.
 * @controlflow Guard non-object, null, or non-string threadId early returning null -> read state and confidence -> return CommentDecoSpec.
 */
function parseCommentSpec(deco: Decoration): CommentDecoSpec | null {
  const spec: unknown = deco.spec;
  // Guard with early return if spec is not an object, null, or does not carry a string threadId.
  if (
    typeof spec !== 'object' ||
    spec === null ||
    typeof (spec as { readonly threadId?: unknown }).threadId !== 'string'
  ) {
    // Invalid spec structure or missing string threadId: return null early.
    return null;
  } else {
    // Valid spec object: proceed with field extraction.
  }

  const threadId = (spec as { readonly threadId: string }).threadId;
  const rawState = (spec as { readonly state?: unknown }).state;
  // Check if the state property is 'resolved'.
  let state: CommentMarkState;
  if (rawState === 'resolved') {
    // Mark state is resolved.
    state = 'resolved';
  } else {
    // Mark state defaults to open.
    state = 'open';
  }

  const rawConf = (spec as { readonly confidence?: unknown }).confidence;
  // Check if confidence is a valid number.
  let confidence: number;
  if (typeof rawConf === 'number') {
    // Valid confidence score provided.
    confidence = rawConf;
  } else {
    // Default to full confidence when omitted.
    confidence = 1;
  }

  return { threadId, state, confidence };
}

/**
 * Reads and safely narrows comment metadata attached to a transaction under commentPluginKey.
 *
 * @purpose Extracts the CommentMeta payload, ensuring it is a non-null non-array object.
 * @inputs tr: Transaction - The ProseMirror transaction to inspect.
 * @outputs CommentMeta | null - The validated CommentMeta object, or null if missing or invalid.
 * @dataflow tr.getMeta(commentPluginKey) -> type validation -> CommentMeta | null.
 * @controlflow Retrieve meta -> check if typeof is 'object', non-null, and not Array -> return CommentMeta; else return null.
 */
function readMeta(tr: Transaction): CommentMeta | null {
  const meta: unknown = tr.getMeta(commentPluginKey);
  // Check whether the metadata is a non-null, non-array object.
  if (typeof meta === 'object' && meta !== null && !Array.isArray(meta)) {
    // Valid object payload: narrow and return CommentMeta.
    return meta as CommentMeta;
  } else {
    // Metadata is absent, primitive, null, or an array: return null.
    return null;
  }
}

/**
 * Constructs inline decorations from a list of comment spans against the document.
 *
 * @purpose Transforms CommentSpan records into ProseMirror inline decorations guarding bounds.
 * @inputs
 *   - spans: readonly CommentSpan[] - List of comment spans to convert into decorations.
 *   - docSize: number - Current document content size for boundary checking.
 *   - activeId: string | null - Currently active thread identifier.
 * @outputs Decoration[] - Array of constructed ProseMirror inline decorations.
 * @dataflow spans -> bounds checks -> decorationAttrsFor -> Decoration.inline -> Decoration[].
 * @controlflow Iterate spans -> skip undefined/out-of-bounds/collapsed spans -> create inline decoration with spec -> return array.
 */
function buildDecorations(
  spans: readonly CommentSpan[],
  docSize: number,
  activeId: string | null,
): Decoration[] {
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
    // The plan is computed from source text while the decoration lands in a ProseMirror document,
    // so the two can disagree by a keystroke.
    if (span.end > docSize) {
      // Span extends beyond current document boundaries: skip this span.
      continue;
    } else {
      // Span end is within document bounds.
    }

    // Check if start position is valid (non-negative and strictly less than end).
    if (span.start < 0 || span.start >= span.end) {
      // Span has invalid or collapsed boundaries: skip this span.
      continue;
    } else {
      // Span boundaries are strictly valid: construct inline decoration.
    }

    const attrs = decorationAttrsFor(span.state, span.threadId, span.confidence, activeId);
    decorations.push(
      Decoration.inline(
        span.start,
        span.end,
        attrs,
        {
          threadId: span.threadId,
          state: span.state,
          confidence: span.confidence,
        },
      ),
    );
  }

  return decorations;
}

/**
 * Restyles existing mapped decorations with updated active thread classes without recomputing positions.
 *
 * @purpose Updates decoration visual classes and attributes in place when active thread changes.
 * @inputs
 *   - set: DecorationSet - The mapped decoration set to restyle.
 *   - activeId: string | null - The new active thread identifier.
 * @outputs Decoration[] - Array of restyled decorations with updated attributes.
 * @dataflow set.find() -> parseCommentSpec -> decorationAttrsFor -> new Decoration.inline -> Decoration[].
 * @controlflow Extract decorations -> iterate -> parse spec -> update attrs with new activeId -> return array.
 */
function restyleDecorations(set: DecorationSet, activeId: string | null): Decoration[] {
  const existingDecos = set.find();
  const updatedDecos: Decoration[] = [];

  for (let i = 0; i < existingDecos.length; i++) {
    const deco = existingDecos[i];
    // Check if decoration at index i is defined to satisfy strict noUncheckedIndexedAccess.
    if (deco === undefined) {
      // Undefined decoration element: skip.
      continue;
    } else {
      // Defined decoration element: extract comment spec.
    }

    const spec = parseCommentSpec(deco);
    // Check if comment spec was successfully parsed.
    if (spec !== null) {
      // Comment spec parsed: re-derive decoration attributes with updated active thread ID.
      const attrs = decorationAttrsFor(spec.state, spec.threadId, spec.confidence, activeId);
      updatedDecos.push(
        Decoration.inline(
          deco.from,
          deco.to,
          attrs,
          deco.spec,
        ),
      );
    } else {
      // Unknown spec structure: retain decoration unchanged.
      updatedDecos.push(deco);
    }
  }

  return updatedDecos;
}

/**
 * Creates the ProseMirror plugin that manages and renders comment underline and tint decorations (FR-10.1).
 *
 * @purpose Instantiates the ProseMirror plugin responsible for painting comment decorations, updating active threads, and mapping across edits.
 * @inputs None.
 * @outputs Plugin - Configured ProseMirror Plugin instance with CommentPluginState management and decoration props.
 * @dataflow Transactions -> apply() state handler -> CommentPluginState (decorations + activeThreadId) -> props.decorations().
 * @controlflow Configure Plugin with commentPluginKey -> state field handles init and apply -> props exports decorations.
 */
export function createCommentPlugin(): Plugin {
  return new Plugin<CommentPluginState>({
    key: commentPluginKey,
    state: {
      init(): CommentPluginState {
        // Initial state begins with no comment decorations and no active thread.
        return {
          decorations: DecorationSet.empty,
          activeThreadId: null,
        };
      },
      apply(tr: Transaction, value: CommentPluginState, _old: EditorState, newState: EditorState): CommentPluginState {
        const meta = readMeta(tr);

        // Case 1: No metadata attached under commentPluginKey.
        if (meta === null) {
          // No metadata present: map existing decorations across transaction changes via tr.mapping.
          // Mapping rather than clearing is what keeps the tint steady while the user types,
          // exactly as the spell plugin does, and that the authoritative re-plan follows on a debounce.
          return {
            decorations: value.decorations.map(tr.mapping, tr.doc),
            activeThreadId: value.activeThreadId,
          };
        } else {
          // Metadata object is present: determine active thread ID and rebuild or restyle.
        }

        // Resolve active thread id: update if setsActive is true, otherwise retain current active thread.
        let resolvedActiveId: string | null;
        if (meta.setsActive === true) {
          // Explicit active thread change: adopt new activeThreadId (string or null).
          resolvedActiveId = meta.activeThreadId ?? null;
        } else {
          // No active thread change specified: keep existing activeThreadId.
          resolvedActiveId = value.activeThreadId;
        }

        // Case 2: Metadata contains spans -> rebuild decorations.
        if (meta.spans !== undefined) {
          // Rebuild the decoration set from spans against newState.doc.
          // Using Decoration.inline(start, end, attrs, { threadId, state, confidence }) so a click can
          // recover which thread it hit without consulting the plan again.
          const decorations = buildDecorations(meta.spans, newState.doc.content.size, resolvedActiveId);
          return {
            decorations: DecorationSet.create(newState.doc, decorations),
            activeThreadId: resolvedActiveId,
          };
        } else {
          // Case 3: Metadata without spans -> restyle decorations in place.
          // Positions are deliberately not recomputed there, because recomputing them would let clicking a comment move the comment.
          const mapped = value.decorations.map(tr.mapping, tr.doc);
          const decorations = restyleDecorations(mapped, resolvedActiveId);
          return {
            decorations: DecorationSet.create(newState.doc, decorations),
            activeThreadId: resolvedActiveId,
          };
        }
      },
    },
    props: {
      decorations(state: EditorState): DecorationSet | undefined {
        const pluginState = commentPluginKey.getState(state);
        // Check if comment plugin state is present on the editor state.
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
 * Attaches updated comment spans to a transaction's metadata under commentPluginKey.
 *
 * @purpose Encapsulates metadata assignment for comment span updates so callers do not manipulate plugin keys directly.
 * @inputs
 *   - tr: Transaction - The ProseMirror transaction to annotate.
 *   - spans: readonly CommentSpan[] - The collection of planned comment spans to set.
 * @outputs Transaction - The transaction with metadata attached.
 * @dataflow tr + spans -> readMeta -> merge into existing meta -> tr.setMeta(commentPluginKey, payload) -> Transaction.
 * @controlflow Inspect existing metadata via readMeta -> merge spans into existing payload if present -> setMeta under commentPluginKey -> return transaction.
 */
export function setCommentSpans(tr: Transaction, spans: readonly CommentSpan[]): Transaction {
  const existing = readMeta(tr);
  // Check whether metadata is already attached to this transaction.
  if (existing !== null) {
    // Existing metadata found: merge updated spans into payload so re-plan and selection changes coexist.
    const merged: CommentMeta = {
      ...existing,
      spans,
    };
    return tr.setMeta(commentPluginKey, merged);
  } else {
    // No prior metadata: construct new payload carrying spans.
    const payload: CommentMeta = { spans };
    return tr.setMeta(commentPluginKey, payload);
  }
}

/**
 * Attaches an active thread selection change to a transaction's metadata under commentPluginKey.
 *
 * @purpose Sets the currently focused comment thread identifier (or null to clear) on a transaction.
 * @inputs
 *   - tr: Transaction - The ProseMirror transaction to annotate.
 *   - threadId: string | null - The thread identifier to activate, or null to clear active selection.
 * @outputs Transaction - The transaction with metadata attached.
 * @dataflow tr + threadId -> readMeta -> merge into existing meta with setsActive: true -> tr.setMeta -> Transaction.
 * @controlflow Inspect existing metadata via readMeta -> merge activeThreadId and setsActive: true into payload -> return transaction.
 */
export function setActiveThread(tr: Transaction, threadId: string | null): Transaction {
  const existing = readMeta(tr);
  // Both setters merge into whatever is already attached (so one transaction can re-plan and change the selection),
  // and setActiveThread sets setsActive: true — this is what distinguishes "clear the selection" (setsActive: true,
  // activeThreadId: null) from "say nothing about the selection" (setsActive: undefined), which a bare activeThreadId: null cannot.
  if (existing !== null) {
    // Existing metadata found: merge activeThreadId and flag into existing payload.
    const merged: CommentMeta = {
      ...existing,
      activeThreadId: threadId,
      setsActive: true,
    };
    return tr.setMeta(commentPluginKey, merged);
  } else {
    // No prior metadata: construct new payload carrying activeThreadId and setsActive: true.
    const payload: CommentMeta = {
      activeThreadId: threadId,
      setsActive: true,
    };
    return tr.setMeta(commentPluginKey, payload);
  }
}

/**
 * Queries all comment thread identifiers whose decorations contain the specified document position.
 *
 * @purpose Finds all active comment thread IDs covering a given position, accommodating overlapping comments.
 * @inputs
 *   - state: EditorState - The current editor state to query.
 *   - pos: number - The document position to test for comment containment.
 * @outputs readonly string[] - Array of matching thread identifiers, or empty array if plugin absent or no comments found.
 * @dataflow state -> pluginState -> decorations.find(pos, pos) -> parseCommentSpec -> readonly string[].
 * @controlflow Return empty array if plugin absent -> find decorations touching pos -> filter by [from, to] containment -> collect unique threadIds -> return array.
 */
export function commentsAt(state: EditorState, pos: number): readonly string[] {
  const pluginState = commentPluginKey.getState(state);
  // Check whether the comment plugin is active in this editor state.
  // Both readers must tolerate the plugin being absent from state (returns [] / null) rather than throwing:
  // a state built without it is a legitimate configuration, not an error.
  if (pluginState === undefined) {
    // Plugin not installed: return empty array without throwing.
    return [];
  } else {
    // Plugin state is available: proceed to query decorations at pos.
  }

  // Find decorations whose range touches pos using find(pos, pos).
  // Comments overlap and a click may land on more than one, so return every thread id.
  const hits = pluginState.decorations.find(pos, pos);
  const threadIds: string[] = [];

  for (let i = 0; i < hits.length; i++) {
    const deco = hits[i];
    // Check if decoration at index i is defined to satisfy strict noUncheckedIndexedAccess.
    if (deco === undefined) {
      // Undefined decoration element: skip.
      continue;
    } else {
      // Valid decoration element: inspect containment.
    }

    // Check whether the document position falls within decoration boundaries [from, to].
    if (deco.from <= pos && pos <= deco.to) {
      const spec = parseCommentSpec(deco);
      // Check if comment spec is present and threadId not yet collected.
      if (spec !== null && !threadIds.includes(spec.threadId)) {
        // Collect thread identifier.
        threadIds.push(spec.threadId);
      } else {
        // Spec missing or thread identifier already collected: skip.
      }
    } else {
      // Position lies outside decoration boundaries: skip.
    }
  }

  return threadIds;
}

/**
 * Queries the identifier of the currently active comment thread from the editor state, if any.
 *
 * @purpose Returns the active thread ID tracked in the plugin state, or null if none is active or plugin is absent.
 * @inputs state: EditorState - The current editor state to query.
 * @outputs string | null - The active thread ID, or null if absent/unset.
 * @dataflow state -> pluginState -> activeThreadId.
 * @controlflow Check if plugin state exists on editor state -> return null if absent -> return activeThreadId from plugin state.
 */
export function activeThreadId(state: EditorState): string | null {
  const pluginState = commentPluginKey.getState(state);
  // Check whether the comment plugin is active in this editor state.
  // Tolerates the plugin being absent from state, returning null rather than throwing.
  if (pluginState === undefined) {
    // Plugin not installed: return null without throwing.
    return null;
  } else {
    // Plugin state available: return the active thread identifier.
    return pluginState.activeThreadId;
  }
}
