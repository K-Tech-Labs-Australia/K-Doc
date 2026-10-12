/**
 * @file decoration-spec.ts
 * @purpose The pure, headless decision half of tracked-change decoration (FR-11.1, FR-11.4, FR-11.6): given the current document text and the set of pending changes, decide which ranges are marked in what state — producing concrete ChangeSpans for re-found anchors plus margin bars for their lines — with zero ProseMirror or DOM dependency so every rule is unit-testable without a browser. This file exists because the drawing layer should decide only how to paint, never what: separating "which ranges are changed" from "how it looks" keeps each interesting rule testable in isolation and lets an identical plan drive any downstream surface (margin pane, inline gutter tint). Two facts shape every decision here. First, a deletion has no text in the document — its characters were removed and live only in the overlay — so a strike-through cannot be drawn over existing glyphs; the renderer must instead re-project the deleted string as content the document does not contain, which is why a deletion's span is a zero-width point carrying the text to draw rather than a range (FR-11.6). Second, nothing is ever orphaned: the anchor ladder's last rung clamps to the recorded offset so a change is always placed somewhere — a deliberate difference from comments, where orphaning is the safe outcome because a comment merely points at text while a tracked change *is* an edit and dropping one loses the user's work; instead of listing lost quotes, each span carries how confidently it was placed (its resolution rung) so nothing about placement is silently discarded.
 * @inputs text - the current document whose ranges are being decorated; changes - the full set of TrackedChanges under consideration; mode - which markup surface to build ('all', 'simple', 'none', or 'original').
 * @outputs A ChangePlan with `spans` (concrete inline marks) and `bars` (distinct lines carrying at least one change), plus a standalone originalText() that returns the pre-edit document.
 * @functions
 *   - lineOf: derive a ChangeBar (lineIndex + first-character offset) for any character offset within text.
 *   - authorHue: fold an author name into a stable hue so both panes underline insertions in one shared colour (FR-11.1).
 *   - planChanges: build spans and bars for 'all'/'simple', or return empty plans for 'none'/'original'.
 *   - originalText: reject every pending change to yield the pre-edit document read-only.
 * @dataflow Caller arguments -> per-change resolveChange ladder call -> ChangeSpan[] plus Map<lineIndex, ChangeBar> -> sorted spans and deduped bars returned to the view layer; originalText folds applyDecisions(text, changes, 'reject') directly.
 * @controlflow Reject 'none' (document already equals the accepted result) and 'original' (a different text rendered read-only by originalText()) early with empty plans; otherwise resolve each change skipping nulls (empty document), attribute a bar for every resolved line via a keyed Map, push an inline span only in 'all', sort spans start-then-end ascending so deletions precede replacements, then return the plan.
 * @version 1
 * @date 2026-09-07
 */

import type { ChangeKind, ResolvedChange } from './anchor.js';
import { resolveChange, applyDecisions, type TrackedChange } from './change.js';

/** Which markup surface planChanges should build (FR-11.4). */
export type MarkupMode = 'all' | 'simple' | 'none' | 'original';

/** A concrete inline mark placed over a tracked change's resolved range within `text`. */
export interface ChangeSpan {
  readonly changeId: string; // identity of the tracked-change record this mark belongs to.
  readonly kind: ChangeKind; // 'insert' or 'delete', driving whether added or removed text is tinted (FR-11.4).
  readonly author: string; // who made the edit; surfaced on hover or selection of the mark.
  /** Inclusive start in the current text. */
  readonly start: number;
  /** Exclusive end. Equal to `start` for a deletion, which occupies no characters. */
  readonly end: number;
  /** For a deletion, the text the renderer must re-project. For an insertion, the text already present. */
  readonly text: string;
  /** Which rung of the anchor ladder placed this span, so a renderer can mark an inferred position. */
  readonly resolution: ResolvedChange['kind'];
}

/** A margin bar attributed to one line that carries at least one change (FR-11.4). */
export interface ChangeBar {
  /** Zero-based index of a line carrying at least one change. */
  readonly lineIndex: number;
  /** Offset of that line's first character. */
  readonly lineStart: number;
}

/** The complete decoration decision for a document state: concrete inline spans plus the margin bars touching them. */
export interface ChangePlan {
  readonly spans: readonly ChangeSpan[]; // re-found ranges sorted into document order (see planChanges).
  readonly bars: readonly ChangeBar[]; // distinct lines carrying at least one change, sorted top-to-bottom.
}

/**
 * @purpose Locate the ChangeBar (zero-based row plus first-character offset) that a character offset falls within, so margin bars can be attributed to their lines.
 * @inputs text - the document whose lines are being measured; offset - the cursor or change position in characters, clamped into [0, text.length].
 * @outputs A ChangeBar with lineIndex = zero-based row and lineStart = that row's first-character offset within `text`.
 * @dataflow clamped offset -> lastIndexOf('\n') for this row's start -> slice-and-split counting preceding newlines -> {lineIndex, lineStart} returned.
 * @controlflow Clamp then set lineStart to one past the most recent '\n' at or before (offset - 1), defaulting to 0; derive lineIndex by counting those earlier lines' separators and return both — neither value is cached because a plan rebuilds whenever changes change rather than per keystroke, so recomputation stays cheap and always consistent.
 */
export function lineOf(text: string, offset: number): ChangeBar {
  // Clamp the requested position into the document's valid character range before deriving anything from it.
  const clampedOffset = Math.max(0, Math.min(offset, text.length));

  let lineStart = 0; // first-character offset of this row, defaulting to column zero when no newline precedes the cursor.

  if (clampedOffset > 0) {
    // Branch: there is at least one character before the cursor, so a preceding newline may exist and must be located within [0, offset - 1].
    const lastIndex = text.lastIndexOf('\n', clampedOffset - 1); // most recent '\n' not past (offset - 1), i.e. the last line break on this row's left side.

    if (lastIndex >= 0) {
      // Branch: a newline sits at or before the cursor, so this line begins immediately after it — one past that index.
      lineStart = lastIndex + 1;
    } else {
      // Branch: no newline precedes the cursor within `text`, so the position lies on the first line beginning at column zero.
      lineStart = 0;
    }
  }

  // lineIndex is derived, not cached — a plan rebuilds whenever changes change rather than per keystroke, so recomputing it here stays cheap and always consistent with `lineStart`.
  const prefixBeforeLine = text.slice(0, lineStart); // characters belonging to lines entirely before this one.

  return {
    lineIndex: prefixBeforeLine.split('\n').length - 1, // each newline separates two rows, so the separator count is exactly this row's zero-based index.
    lineStart,
  };
}

/**
 * @purpose Derive a stable hue (0-359 degrees) from an author's name so both panes underline insertions in one shared colour per FR-11.1 — derived here beside the other headless decoration decisions rather than duplicated in each renderer or stored anywhere. The hue is **derived, not assigned**: two people editing the same document offline and later merging still see each other in the colours they saw before, because a colour table persisted in the overlay would conflict on merge (the very thing this line-oriented store was shaped to avoid). Only the hue is chosen here; saturation and lightness stay with each pane's stylesheet, since the same hue needs different treatment on a light versus dark ground — a question the theme answers rather than this module. An empty author string is not special-cased: it hashes like any other name and lands on a stable hue, deliberately so that no reader adds a guard making one author's colour depend on a branch nobody exercises (FR-11.1).
 * @inputs author - the tracked-change record's `author` field; its exact string content is what folds into the hash, so any two identical names always yield an identical hue regardless of who else edits.
 * @outputs A number in [0, 360) usable directly as an HSL hue component for underlining insertions (FR-11.4).
 * @dataflow author string -> FNV-1a fold over each UTF-16 code unit starting from the offset basis -> unsigned 32-bit hash -> `hash % 360` returned as a stable degree value.
 * @controlflow Seed with the FNV-1a offset basis (so an empty name still produces a non-zero hue), XOR then multiply each character's code unit by the FNV prime via Math.imul to keep a true 32-bit product above 2^32, force back to unsigned each round with `>>> 0`, and finally reduce modulo 360 — no branching on author content so every name, including an empty one, follows exactly this path.
 */
export function authorHue(author: string): number {
  // FNV-1a offset basis seeds the hash before any character folds in, so even an empty author still lands on a stable non-zero hue rather than defaulting to zero (FR-11.1).
  let hash = 0x811c9dc5;

  for (let i = 0; i < author.length; i++) {
    // Fold this UTF-16 code unit into the running hash: XOR it in, then scale with the FNV prime via Math.imul so the product stays a true 32-bit value above 2^32 instead of silently dropping high-order precision as plain JS multiplication would.
    const scaled = Math.imul(hash ^ author.charCodeAt(i), 0x01000193);

    // Force back to an unsigned 32-bit integer each round so the next iteration's XOR starts from a clean, well-defined base regardless of sign (FR-11.1).
    hash = scaled >>> 0;
  }

  // Map the full 32-bit range onto [0, 360) hue degrees — one stable colour per author with no table to reconcile on merge (FR-11.1).
  return hash % 360;
}

/**
 * @purpose Decide which ranges are marked in what state over the current `text` for one of four markup surfaces (FR-11.4), returning concrete inline spans plus margin bars with zero ProseMirror or DOM dependency so every rule is unit-testable without a browser.
 * @inputs text - the current document whose changes are being decorated; changes - the full set of TrackedChanges under consideration; mode - which surface to build ('all', 'simple', 'none', or 'original').
 * @outputs A ChangePlan with `spans` (concrete inline marks) and `bars` (distinct lines carrying at least one change); 'none' and 'original' return empty plans because they decorate nothing.
 * @dataflow text + changes -> per-change resolveChange ladder call -> ChangeSpan[] plus Map<lineIndex, ChangeBar> -> sorted spans and deduped bars returned to the view layer.
 * @controlflow Reject 'none' (document already equals the accepted result) and 'original' (a different text rendered read-only by originalText()) early with empty plans; otherwise resolve each change skipping nulls (empty document), attribute a bar for every resolved line via a keyed Map, push an inline span only in 'all', sort spans start-then-end ascending so deletions precede replacements, then return the plan.
 */
export function planChanges(text: string, changes: readonly TrackedChange[], mode: MarkupMode): ChangePlan {
  if (mode === 'none') {
    // Branch: markup disabled — but this is not a stub; accepting never edits the document so on-disk Markdown already equals the accepted result and a clean preview needs no decoration at all, which is precisely what makes this mode free.
    return { spans: [], bars: [] };
  } else if (mode === 'original') {
    // Branch: Original renders a different text produced by originalText() read-only instead of decorating `text`, so there are no inline marks or margin bars to emit here either — not an empty stub.
    return { spans: [], bars: [] };
  }

  const spans: ChangeSpan[] = []; // concrete inline marks, filled only in 'all' mode and sorted into document order before returning.
  const barByLine = new Map<number, ChangeBar>(); // distinct lines touched by any change, keyed by lineIndex so each row appears exactly once (FR-11.4).

  for (const change of changes) {
    const at = resolveChange(text, change); // re-locate this change's range against live text.

    if (at === null) {
      // Branch: resolution fails only on an empty document with nowhere to draw, so skip it rather than fabricate a span or bar — nothing can be placed when there are no lines at all.
      continue;
    } else {
      // Branch: the change resolves against `text`; attribute its line for margin bars below (both markup modes emit bars), then optionally record an inline mark.

      const bar = lineOf(text, at.start); // first-character offset and zero-based row of where this change sits within `text`.

      // Map keys are unique by lineIndex, so setting here both inserts new rows and collapses repeats — exactly the dedup FR-11.4 requires without an explicit check.
      barByLine.set(bar.lineIndex, bar);

      // Full markup additionally records an inline span; 'simple' mode adds nothing here because it shows only margin bars (FR-11.4).
      if (mode === 'all') {
        // Push a concrete inline span carrying this change's identity, resolved range, re-projected text, and resolution rung so the renderer can paint it (FR-11.4).
        spans.push({
          changeId: change.id, // ties this mark to its tracked-change record for click handling in the pane.
          kind: change.kind, // 'insert' or 'delete', driving whether added or removed text is tinted (FR-11.4).
          author: change.author, // who made the edit; surfaced on hover or selection of the mark.
          start: at.start, // inclusive offset where this change's range begins within `text`.
          end: at.end, // exclusive offset just past it — equal to `start` for a deletion that occupies no characters (FR-11.6).
          text: change.text, // insertion carries its already-present text; deletion carries the removed run the renderer must re-project (FR-11.4).
          resolution: at.kind, // which ladder rung placed this span, so an inferred position can be styled accordingly.
        });
      }
    }
  }

  if (mode === 'all') {
    // Branch: order spans into document order so a zero-width deletion sorts before an insertion sharing its offset — exactly what a replacement produces — letting the renderer draw removed text ahead of what replaces it (FR-11.6).
    spans.sort((a, b) => {
      if (a.start !== b.start) {
        return a.start - b.start; // ascending start reads spans left-to-right in document order regardless of change-recording order.
      } else {
        return a.end - b.end; // on a shared offset the shorter range sorts first, so the zero-width deletion precedes its replacement insertion and draws removed text ahead of what replaces it (FR-11.6).
      }
    });
  }

  // Ascending lineIndex so margin bars read top-to-bottom in document order; the Map already deduplicated rows (FR-11.4).
  const bars = [...barByLine.values()].sort((a, b) => a.lineIndex - b.lineIndex);

  // No branch on mode is needed here. Spans are only ever built under the `mode === 'all'` guard above,
  // so in simple markup `spans` is already empty and re-emptying it would be dead code dressed up as the
  // thing withholding inline marks. Mutation testing bears that out: removing a second guard here fails
  // nothing, while removing the one that gates the push does.
  return { spans, bars };
}

/**
 * @purpose Produce the Original display mode: every pending change undone so `text` reflects what the document looked like before this round of edits (FR-11.4).
 * @inputs text - current on-disk Markdown holding accepted-plus-pending content; changes - every tracked change whose effect must be reversed.
 * @outputs New source string with all resolvable insertions cut out and deletions restored — the pre-edit document ready to render read-only.
 * @dataflow applyDecisions(text, changes, 'reject') -> fully folded Original text returned directly.
 * @controlflow Single delegation: rejecting every change is exactly "undo this round of edits", so no per-change branching lives here beyond what applyDecisions performs internally.
 */
export function originalText(text: string, changes: readonly TrackedChange[]): string {
  return applyDecisions(text, changes, 'reject'); // Rejecting each pending change reverses it — cutting insertions out and restoring deletions — yielding the pre-edit document (FR-11.4).
}
