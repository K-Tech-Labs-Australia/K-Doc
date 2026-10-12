/**
 * @file comment-marks.ts
 * @purpose CodeMirror 6 decorations for commented ranges in K-Doc's Source pane (FR-10.1): a state field holding a DecorationSet of per-thread marks, an effect that replaces it with a freshly computed authoritative plan, and the theme rules that tint those marks — so every comment reads identically whether painted here or by the ProseMirror plugin in the WYSIWYG pane.
 * @inputs setCommentSpansEffect carries readonly CommentSpan[] (source offsets from planDecorations); EditorView when dispatching; document length derived at build time to drop stale spans.
 * @outputs a DecorationSet of comment marks on editor state, two CSS class constants consumed by the theme, and extensions embeddable in the Source pane's extension list.
 * @functions
 *   - setCommentSpansEffect: StateEffect replacing the current span set with an authoritative plan.
 *   - commentMarksField: StateField holding the DecorationSet of commented ranges across editor transactions.
 *   - buildMarks: Assembles a DecorationSet from validated spans for a document length (module-level helper).
 *   - commentMarks: Extension composing just the state field for embedding in a pane's extension list.
 *   - commentSpanTheme: Extension providing CSS rules tinting open and resolved marks to match the WYSIWYG plugin.
 *   - setCommentSpansIn: Dispatches the span effect on behalf of callers who need not know about it.
 * @dataflow planDecorations source offsets -> setCommentSpansEffect.of(spans) -> commentMarksField rebuilds DecorationSet via buildMarks -> EditorView.decorations reads it and paints marks using commentSpanTheme styling.
 * @controlflow create returns an empty set; update replaces the set on a span effect (the authoritative plan wins, no merge) or maps changes otherwise so typed edits keep ranges steady until the debounced re-plan arrives again — briefly approximate beats briefly absent.
 * @note planDecorations returns source offsets — exactly what a CodeMirror document is indexed by — so this Source pane can paint the plan directly; the WYSIWYG pane cannot because ProseMirror positions differ from source offsets (markup characters are absent from its tree) and that mapping does not exist yet.
 * @version 1
 * @date 2026-09-07
 */

import { StateEffect, StateField, RangeSetBuilder } from '@codemirror/state';
import type { Extension, Transaction } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import type { CommentSpan } from '@k-doc/core';

/** The CSS class applied to every commented range mark in the Source pane (FR-10.1). */
export const CM_COMMENT_CLASS = 'kdoc-cm-commented';

/** The additional CSS class layered onto a comment whose owning thread has been resolved (FR-10.1). */
export const CM_COMMENT_RESOLVED_CLASS = 'kdoc-cm-commented-resolved';

/**
 * @purpose Carries a freshly computed CommentSpan[] into editor state so the comment field can rebuild its DecorationSet from scratch.
 * @inputs spans - the authoritative, source-offset ranges produced by planDecorations for the current document snapshot.
 * @outputs A StateEffect instance whose payload is readonly CommentSpan[].
 * @dataflow Caller builds spans via planDecorations -> setCommentSpansEffect.of(spans) produces an effect applied inside a dispatch's effects array.
 * @controlflow Pure definition with no branching; the effect only takes meaning when commentMarksField.update inspects tr.effects for it below.
 */
export const setCommentSpansEffect = StateEffect.define<readonly CommentSpan[]>();

/**
 * @purpose Holds the DecorationSet of commented-range marks and keeps it in sync with editor transactions (FR-10.1).
 * @inputs create receives a fresh EditorState; update receives the previous set plus each applied Transaction, including span effects.
 * @outputs A DecorationSet: empty on creation, rebuilt from an incoming plan effect, or change-mapped for ordinary edits.
 * @dataflow StateEffect payload spans -> buildMarks(spans, docLength) produces a DecorationSet -> EditorView.decorations reads it to paint marks.
 * @controlflow On create return the empty set; on update branch: a span effect triggers an authoritative rebuild (the plan wins over any stale mark), every other transaction maps its changes over the existing set so typed edits keep ranges steady until the debounced re-plan arrives again.
 */
export const commentMarksField = StateField.define<DecorationSet>({
  create(): DecorationSet {
    return Decoration.none;
  },

  update(value: DecorationSet, tr: Transaction): DecorationSet {
    for (const effect of tr.effects) {
      if (effect.is(setCommentSpansEffect)) {
        // Branch: an authoritative plan arrived — rebuild from scratch rather than merge, because the new plan is a complete statement of what exists and any mark left over from the previous set would otherwise linger as a phantom comment.
        return buildMarks(effect.value, tr.state.doc.length);
      } else {
        // Branch: some other effect. Keep scanning rather than returning here: a transaction can carry
        // several effects, and returning on the first non-matching one would let a span effect behind it
        // go unseen -- the plan would be dropped silently and the marks would simply stop updating.
      }
    }

    // No span effect in this transaction: map the existing marks across its changes so a commented range
    // stays put while the user types, since the authoritative re-plan only arrives on a debounce.
    // Briefly approximate beats briefly absent.
    return value.map(tr.changes);
  },

  provide: (field) => EditorView.decorations.from(field),
});

/**
 * @purpose Assembles a DecorationSet of comment marks from authoritative spans for a document of `docLength`.
 * @inputs spans - the source-offset ranges to paint; docLength - the current document length used to drop stale or out-of-range spans.
 * @outputs A finished DecorationSet whose marks carry class, thread-id attribute, and confidence-driven opacity styling.
 * @dataflow Each span -> validated against bounds -> Decoration.mark({class, attributes}) appended to a builder -> builder.finish() yields the set.
 * @controlflow Sort copies of the spans into ascending from-order (RangeSetBuilder's requirement), drop out-of-range or invalid spans per range, then mark each survivor; no merging or splitting is performed so every character still knows its owning thread for click handling (FR-10.5).
 */
function buildMarks(spans: readonly CommentSpan[], docLength: number): DecorationSet {
  // planDecorations sorts by start ascending but end descending for overlaps — not the ascending-from order RangeSetBuilder requires and throws on, so copy and re-sort by start then end ascending; this only ever fails on a document that happens to contain overlapping comments.
  const ordered = [...spans].sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start; // ascending start so marks are added in the order RangeSetBuilder accepts without throwing.
    } else {
      return a.end - b.end; // tie-break on end ascending to fully satisfy the required from-then-to ordering for shared starts.
    }
  });

  const builder = new RangeSetBuilder<Decoration>();

  for (const span of ordered) {
    if (span.end > docLength) {
      // Branch: this anchor points past the current document end, so it is stale — drop rather than clamp because the plan was computed from an earlier snapshot and clamping would paint a comment over characters that never belonged to it.
      continue;
    } else if (span.start < 0 || span.start >= span.end) {
      // Branch: malformed range with no valid extent — skip defensively so a corrupt or empty span can never produce a zero-width mark.
      continue;
    }

    const classes = [CM_COMMENT_CLASS];
    if (span.state === 'resolved') {
      // Branch: the owning thread is finished business, so layer on the resolved class to signal completion without removing the range entirely.
      classes.push(CM_COMMENT_RESOLVED_CLASS);
    }

    const attributes: Record<string, string> = {
      'data-thread-id': span.threadId, // lets a click recover which thread owns this exact character range (FR-10.5).
    };

    if (span.confidence < 1) {
      // Branch: the anchor was rescued rather than re-found cleanly — drive opacity down so the reader knows its position is inferred, yet keep it visible because a fainter range still marks a real comment that must not be lost to the resolver.
      attributes.style = 'opacity: 0.6;';
    }

    builder.add(
      span.start, // inclusive start offset within the document (source offsets match CodeMirror indexing).
      span.end, // exclusive end offset just past the marked range.
      Decoration.mark({ class: classes.join(' '), attributes }),
    );
  }

  return builder.finish();
}

/**
 * @purpose Exposes just the comment-marks state field as an Extension so it can be composed into a pane's extension list (FR-10.1).
 * @inputs void — the field carries its own logic and needs no host configuration to function.
 * @outputs readonly Extension[] containing only commentMarksField, ready to spread alongside markdown() and keymaps in a pane setup.
 * @dataflow None — this is a pure passthrough returning an extension descriptor; the state field does all work when mounted.
 * @controlflow Returns a one-element array literal with no branching or state transition.
 */
export function commentMarks(): Extension {
  return [commentMarksField];
}

/**
 * @purpose Provides CSS rules that tint open and resolved comment marks in the Source pane so they match the WYSIWYG plugin exactly (FR-10.1).
 * @inputs void — theme variables (--kdoc-color-accent, --kdoc-color-text-muted) are expected to be defined on a host element or :root by the surrounding design tokens.
 * @outputs an Extension wrapping EditorView.theme with two selector rules keyed by the exported class constants.
 * @dataflow None — pure descriptor; CodeMirror injects the CSS into the document head when the extension mounts and applies it to every mark carrying these classes.
 * @controlflow Returns a single theme-extension object literal built from two rule entries, no branching or state transition.
 */
export function commentSpanTheme(): Extension {
  return EditorView.theme({
    // Open comments: faint accent tint with a solid bottom border hinting at an active thread (FR-10.1).
    ['.' + CM_COMMENT_CLASS]: {
      backgroundColor: 'color-mix(in srgb, var(--kdoc-color-accent, #0969da) 10%, transparent)',
      borderBottom: '1px solid color-mix(in srgb, var(--kdoc-color-accent, #0969da) 55%, transparent)',
    },

    // Resolved comments: muted tint with a dashed border so finished business reads as quieter without disappearing (FR-10.1).
    ['.' + CM_COMMENT_RESOLVED_CLASS]: {
      backgroundColor: 'color-mix(in srgb, var(--kdoc-color-text-muted, #57606a) 7%, transparent)',
      borderBottom: '1px dashed color-mix(in srgb, var(--kdoc-color-text-muted, #57606a) 40%, transparent)',
    },
  });
}

/**
 * @purpose Dispatches a span effect onto an editor view so callers paint comments without knowing about the effect itself (FR-10.1).
 * @inputs view - the live EditorView to dispatch on; spans - the authoritative CommentSpan[] source-offset ranges from planDecorations.
 * @outputs void — the new set is applied as a side effect of the dispatched transaction, not returned.
 * @dataflow Caller's computed spans -> setCommentSpansEffect.of(spans) wrapped in view.dispatch -> commentMarksField.update rebuilds the DecorationSet and re-renders marks.
 * @controlflow A single dispatch call with no branching; wraps the effect so callers never import StateEffect or reference commentMarksField directly, keeping decoration plumbing out of feature code.
 */
export function setCommentSpansIn(view: EditorView, spans: readonly CommentSpan[]): void {
  view.dispatch({ effects: setCommentSpansEffect.of(spans) });
}
