/**
 * @file decoration-spec.ts
 * @purpose The pure, headless decision half of comment decoration (FR-10.1): given the current document text and the set of
 *   threads, decide which ranges are commented and in what state — producing concrete spans for re-found anchors and orphaned
 *   records for quotes that can no longer be located — with zero ProseMirror or DOM dependency so every rule is testable without a
 *   browser. This file exists because the drawing layer (the plugin that paints underlines and tints) should decide only how to
 *   paint, never what: separating "what ranges are commented" from "how it looks" keeps each interesting rule — which threads count
 *   as resolved, which become orphaned, how overlaps sort — unit-testable in isolation, and the exact same list can later drive a
 *   margin pane that needs precisely these spans without re-deriving them. Spans are never merged or split: every comment stays its
 *   own mark so each character still knows which thread it belongs to (what a click on an underline must learn).
 * @inputs text - the current document whose ranges are being decorated; threads - the full set of CommentThreads under consideration;
 *   includeResolved - optional flag that overrides the default skip-resolved behavior when true.
 * @outputs A DecorationPlan with `spans` (concrete, sorted comment marks) and `orphaned` (threads listed because their quote vanished).
 * @functions
 *   - planDecorations: iterate threads, resolve each anchor, classify into spans or orphans, then return a start-ascending sort.
 * @dataflow text + threads -> per-thread resolveAnchor call -> CommentSpan[] / OrphanedThread[] -> sorted DecorationPlan returned to the view layer.
 * @controlflow Reject empty-comment and resolved-skip branches early; otherwise resolve the anchor and branch on hit (push span) or miss (push orphan);
 *   finally sort spans by start ascending then end descending before returning both lists together.
 * @version 1
 * @date 2026-09-06
 */

import type { CommentThread } from './thread.js';
import type { ResolvedAnchor } from './anchor.js';
import { resolveAnchor } from './anchor.js';

/** Visual state of a drawn comment range, mirroring the thread's resolved flag. */
export type CommentMarkState = 'open' | 'resolved';

/** A concrete commented range that was re-located to real offsets within `text`. */
export interface CommentSpan {
  readonly threadId: string; // identifies which thread owns this exact character range.
  readonly start: number; // inclusive start offset of the marked range (character index).
  readonly end: number; // exclusive end offset of the marked range (character index).
  readonly state: CommentMarkState; // whether the owning thread is open or resolved at decoration time.
  /** How confidently the anchor was re-found; drives a subtler style for a rescued anchor. */
  readonly confidence: number;
}

/** A thread whose quoted text could not be relocated, carried with its quote so nothing about it is lost (FR-10.5). */
export interface OrphanedThread {
  readonly threadId: string; // identifies the orphaned thread in the pane and on click.
  readonly quotedText: string; // the last remaining evidence of what the comment pointed at, preserved verbatim.
}

/** The complete decoration decision for a document state: concrete spans plus any orphans that must still be listed. */
export interface DecorationPlan {
  readonly spans: readonly CommentSpan[]; // re-found ranges sorted into document order (see planDecorations).
  readonly orphaned: readonly OrphanedThread[]; // threads whose anchor could not be resolved, kept for display per FR-10.5.
}

/**
 * Decides which comment ranges are commented and in what state over the current `text`, returning concrete spans plus orphans.
 * @purpose Classify every thread into either a re-located CommentSpan (anchor found) or an OrphanedThread (quote lost), applying
 *   the skip-resolved filter and empty-comment guard, then order the spans so nesting paints outer-before-inner without merging them.
 * @inputs text - the current document whose ranges are being decorated; threads - the full set of CommentThreads under consideration;
 *   includeResolved - when true, resolved threads are processed like open ones instead of being skipped (default false).
 * @returns A DecorationPlan whose `spans` is sorted by start ascending then end descending and whose `orphaned` lists every lost quote.
 * @dataflow Each thread -> resolveAnchor(text, anchor) -> span carrying thread id/state/confidence or orphan carrying quoted text -> both lists returned together.
 * @controlflow Skip empty-comment threads (store integrity), skip resolved threads unless opted in; otherwise branch on the resolution hit:
 *   push a span on match, an orphan on miss; finally sort spans and return — no merging or splitting of overlapping ranges is performed.
 */
export function planDecorations(
  text: string,
  threads: readonly CommentThread[],
  includeResolved = false, // default to hiding finished business unless the caller explicitly opts in via the pane filter (FR-10.4).
): DecorationPlan {
  const spans: CommentSpan[] = []; // concrete ranges re-located into `text`, filled below and sorted before return.
  const orphaned: OrphanedThread[] = []; // threads whose quote could not be found, preserved verbatim per FR-10.5.

  for (const thread of threads) {
    if (thread.comments.length === 0) {
      // Branch: no entry survives this thread; deleteEntry already returns null to signal an emptied thread, so a present-but-empty one can only come from a hand-edited store file that must be ignored rather than trusted as real state.
      continue;
    } else if (thread.resolved && !includeResolved) {
      // Branch: the thread is finished business — tinting it keeps drawing attention to something already dealt with, so skip it unless the caller opted in via the resolved filter (FR-10.4).
      continue;
    }

    // Re-find where this comment's quoted text now sits within `text`; annotated explicitly so ResolvedAnchor | null is visible at the branch below.
    const resolved: ResolvedAnchor | null = resolveAnchor(text, thread.anchor);

    if (resolved !== null) {
      // Branch: a rung of the resolution ladder matched; record a concrete mark with the thread's state and how confidently it was re-located.
      spans.push({
        threadId: thread.id, // ties this range back to its owning thread for click handling in the view layer.
        start: resolved.start, // inclusive offset where the quote now begins within `text`.
        end: resolved.end, // exclusive offset just past the quote's current position.
        state: thread.resolved ? 'resolved' : 'open', // mirror the owning flag so tint matches whether it is finished or active.
        confidence: resolved.confidence, // lower for fuzzy/context rescues; drives a subtler style rather than full emphasis (FR-10.5).
      });
    } else {
      // Branch: no rung matched — the comment is orphaned and travels with its quoted text because that quote is the only thing left telling the reader what it was about, which FR-10.5 requires be listed rather than discarded (FR-10.5).
      orphaned.push({
        threadId: thread.id, // keeps the orphan identifiable in the pane and on later resolution attempts.
        quotedText: thread.anchor.quotedText, // verbatim quote preserved as evidence of the original target range; never truncated or dropped.
      });
    }
  }

  spans.sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start; // ascending start so ranges read left-to-right in document order regardless of insertion order.
    } else {
      return b.end - a.end; // on a shared start the longer range sorts first, so an outer comment paints before any inner one it contains.
    }
  });

  // Spans are deliberately returned unmerged and unsplitted: each comment is its own mark, and flattening overlapping ranges would lose which thread a given character belongs to — exactly what a click on the underline needs to know (FR-10.5).
  return { spans, orphaned };
}
