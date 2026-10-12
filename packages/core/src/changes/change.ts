/**
 * @file change.ts
 * @purpose The tracked-change model (FR-11.3, FR-11.5, FR-11.6): pure functions that build insertions and deletions as anchors over post-edit text, re-locate them against live Markdown, and apply accept/reject decisions. Because on-disk Markdown always holds the accepted-plus-pending text, an insertion's characters are already present while a deletion's were removed — so accepting never edits the document (it only drops the op from the overlay) and rejecting is the sole operation that mutates it: reject an insertion to cut its text out, reject a deletion to restore it.
 * @inputs createInsertion/createDeletion take an id, text, post-edit source, offset(s), author, and optional clock; resolveChange/applyDecision apply one change against live source; applyDecisions applies one decision across many changes as a single transaction.
 * @outputs A TrackedChange from each constructor, a ResolvedChange | null from resolveChange, new or unchanged source text (or null) from applyDecision, and one folded string from applyDecisions — no input is mutated.
 * @functions
 *   - createInsertion: build an insert change anchored over the post-edit span [start, start + text.length).
 *   - createDeletion: build a delete change whose anchor seam marks where the removed characters used to be (start === end).
 *   - resolveChange: re-locate a change's range against live source by delegating to resolveChangeAnchor.
 *   - applyDecision: return new source for one decision, or null when the change cannot be resolved; accept is never an edit.
 *   - applyDecisions: fold many changes under one decision into a single string, rejecting from the end backward and skipping unplaceable ones.
 * @dataflow Caller arguments -> pure transform (anchor slice / indexOf ladder / string concat) -> returned model or text; no I/O, no shared state.
 * @controlflow Constructors record an anchor at edit time; resolveChange re-locates it later; applyDecision/applyDecisions mutate only on reject and return the resulting document in one transaction per call site.
 * @version 2
 * @date 2026-09-16
 */

import {
  createChangeAnchor,
  resolveChangeAnchor,
  type ChangeAnchor,
  type ChangeKind,
  type ResolvedChange,
} from './anchor.js';

export interface TrackedChange {
  readonly id: string;
  readonly kind: ChangeKind;
  readonly author: string;
  /** ISO 8601, which sorts lexicographically and survives JSON without a reviver. */
  readonly createdAt: string;
  /** The characters inserted, or the characters deleted. */
  readonly text: string;
  readonly anchor: ChangeAnchor;
}

export type ChangeDecision = 'accept' | 'reject';

/**
 * @purpose Build an insertion change over post-edit source, where the inserted text is already present in that source.
 * @inputs id - stable identity of this tracked change; text - characters added by the edit (the span being recorded); source - Markdown after the insert so the anchor's context reflects what will later be resolved against; start - inclusive offset of the first inserted character within `source`; author - who made the edit; now - optional clock, defaulting to the current time.
 * @outputs TrackedChange whose kind is 'insert', text holds the added characters, and an anchor spanning [start, start + text.length).
 * @dataflow source slice -> createChangeAnchor(prefix/suffix/offset) -> fully populated TrackedChange returned immediately.
 * @controlflow Pure construction with no branching; returns right after stamping createdAt from now ?? new Date(). The recorded offset is the insertion's own start because that is where its text currently sits in `source`.
 */
export function createInsertion(
  id: string,
  text: string,
  source: string,
  start: number,
  author: string,
  now?: Date,
): TrackedChange {
  const anchor = createChangeAnchor(source, start, start + text.length); // Insertion spans its own characters in post-edit text, so the range is [start, start + length).

  return {
    id,
    kind: 'insert',
    author,
    createdAt: (now ?? new Date()).toISOString(), // ISO 8601 sorts lexicographically and survives JSON without a reviver.
    text,
    anchor,
  };
}

/**
 * @purpose Build a deletion change over post-edit source, where the deleted characters are already gone from that source.
 * @inputs id - stable identity of this tracked change; text - characters removed by the edit (retained only in the overlay); source - Markdown after the delete so the anchor's context reflects what will later be resolved against; at - offset within `source` where the deleted run used to begin; author - who made the edit; now - optional clock, defaulting to the current time.
 * @outputs TrackedChange whose kind is 'delete', text holds the removed characters, and an anchor whose start === end marks the empty seam they left behind.
 * @dataflow source slice -> createChangeAnchor(prefix/suffix/offset) -> fully populated TrackedChange returned immediately.
 * @controlflow Pure construction with no branching; returns right after stamping createdAt from now ?? new Date(). The recorded offset is where the deletion began because its characters are absent, so start and end are identical — a point rather than a span.
 */
export function createDeletion(
  id: string,
  text: string,
  source: string,
  at: number,
  author: string,
  now?: Date,
): TrackedChange {
  // start and end are the same offset because the deleted characters are already gone from `source`; the anchor marks the seam they left rather than a span of live text.
  const anchor = createChangeAnchor(source, at, at);

  return {
    id,
    kind: 'delete',
    author,
    createdAt: (now ?? new Date()).toISOString(), // ISO 8601 sorts lexicographically and survives JSON without a reviver.
    text,
    anchor,
  };
}

/**
 * @purpose Re-locate a tracked change's range against live source so it can be accepted or rejected in place.
 * @inputs source - current on-disk Markdown; change - the recorded change whose anchor is re-resolved here.
 * @outputs ResolvedChange at the first matching rung, or null only when `source` cannot hold the change (e.g. an empty document).
 * @dataflow change.anchor + kind + text -> resolveChangeAnchor ladder -> resolved range returned unchanged.
 * @controlflow Pure delegation with no branching; returns whatever resolveChangeAnchor yields so a resolution failure propagates to callers as null.
 */
export function resolveChange(source: string, change: TrackedChange): ResolvedChange | null {
  return resolveChangeAnchor(source, change.anchor, change.kind, change.text); // Delegate entirely; the anchor already encodes everything this layer needs.
}

/**
 * @purpose Apply an accept/reject decision to a single change against live source, returning new text or null when unresolvable.
 * @inputs source - current on-disk Markdown; change - the recorded change to act on; decision - 'accept' leaves the document untouched, 'reject' edits it.
 * @outputs New source string for an applied rejection, `source` unchanged for an accept, or null when the change cannot be resolved against this source.
 * @dataflow resolveChange -> range start/end -> slice-and-concat per kind -> resulting text returned; no input is mutated.
 * @controlflow Resolve first and return null on failure (a change that cannot be placed must not be guessed at). Accept returns immediately since the document already holds every accepted result — this asymmetry exists because on-disk Markdown stores accepted-plus-pending text, so accepting only drops the op from the overlay rather than editing anything. Reject then branches by kind: cut an insertion's range out, or restore a deletion's text at its seam.
 */
export function applyDecision(source: string, change: TrackedChange, decision: ChangeDecision): string | null {
  const at = resolveChange(source, change); // Re-locate the change against live source; without a range there is nothing to act on.

  if (at === null) {
    // Branch: this change cannot be resolved in the current document, so no decision can be applied — return null rather than guess an offset and corrupt the text.
    return null;
  } else {
    // Branch: the change is placed; apply the decision per its kind below.

    if (decision === 'accept') {
      // Accepting never edits anything: on-disk Markdown already contains the accepted result, so this returns `source` verbatim — accepting only drops the op from the overlay in the caller's bookkeeping. Returning the text unchanged says that contract in the type rather than relying on a comment nobody reads.
      return source;
    } else {
      // Branch: decision is 'reject', which mutates the document by undoing what the change did.

      if (change.kind === 'insert') {
        // Reject an insertion by cutting its resolved range out of the text, restoring the state before it was added.
        return source.slice(0, at.start) + source.slice(at.end); // Everything before the inserted run is kept verbatim; everything after resumes immediately with no gap left behind.
      } else {
        // Branch: kind is 'delete', so reject by putting the removed characters back at their seam to restore what was deleted.
        return source.slice(0, at.start) + change.text + source.slice(at.start); // The text before the seam and after it are spliced together with the deleted run restored in between.
      }
    }
  }
}

/**
 * @purpose Apply one decision across many changes as a single undoable transaction, returning the fully folded document.
 * @inputs source - current on-disk Markdown; changes - every change to act on (a selection or an author's whole set); decision - 'accept' is a no-op edit-wise, 'reject' rewrites each resolvable change at once.
 * @outputs New source string with all applicable decisions applied in one pass — the single resulting text a caller needs for one transactional write.
 * @dataflow changes -> sorted newest first (stable within one moment) -> fold applyDecision over the running text, skipping unplaceable ones -> final folded string returned; no input is mutated.
 * @controlflow Accept returns immediately since any number of accepts still edits nothing. Otherwise the changes are undone newest first: each was anchored in the text as it stood right after it was made, so undoing the newer ones first turns the running text back into the text each older one was anchored in, and applyDecision re-resolves it there. Changes made at one moment keep the caller's order; where a neighbour's rejection rewrote part of a change's context, resolveChangeAnchor's partial-context rung still places it. A change that cannot be placed is left alone rather than guessed at, since a rejection at the wrong offset silently corrupts the document.
 */
export function applyDecisions(source: string, changes: readonly TrackedChange[], decision: ChangeDecision): string {
  if (decision === 'accept') { // Accepting any number of changes still edits nothing — every accepted result already lives in `source`.
    return source;
  } else {
    // Branch: a mutating decision (reject); order the changes, then fold each against the running text.

    // Newest first: each change is anchored in the text as it stood right after it was made, so undoing the newest first
    // rebuilds, step by step, the text every older change was anchored in. By position instead, two quick deletions came
    // back in the wrong order (backspacing "c" then "b" restored "abdc"). Changes made at one moment (one edit, or one
    // comparison) keep the caller's order; the partial-context rung places each whichever of them goes first.
    // ISO 8601 strings compare in time order: a newer change sorts earlier, and one from the same moment scores 0 and keeps
    // the caller's order (Array.prototype.sort is stable).
    const ordered = [...changes].sort((a, b) => Number(a.createdAt < b.createdAt) - Number(a.createdAt > b.createdAt));

    let result = source; // Running text each rejection is applied to.
    for (const change of ordered) {
      // Re-resolve against the running text, which the newer changes undone so far have turned back into the text this
      // change was anchored in; where a neighbour's decision rewrote part of its context, the partial-context rung of
      // resolveChangeAnchor still places it.
      const applied = applyDecision(result, change, decision);
      // Check whether the change could be placed.
      if (applied === null) {
        // Branch: unplaceable; leave it alone rather than guess and corrupt the document.
      } else {
        // Branch: adopt the text with this change undone.
        result = applied;
      }
    }

    return result; // Fully folded document, ready to be written back in one transactional write.
  }
}
