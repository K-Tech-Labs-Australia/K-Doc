/**
 * @file anchor.ts
 * @purpose Creating and resolving comment anchors (FR-10.5): an anchor is a stable identity for a quoted range of text
 *   that survives edits to the surrounding document, because the body Markdown is NEVER rewritten to record where a
 *   comment points. createAnchor derives that identity from a slice of text; resolveAnchor hunts for it again as the
 *   document changes, descending a ladder from exact re-read through context, quote-proximity, and finally fuzzy match,
 *   so a comment keeps pointing at its target across moves, light edits, and (rarely) nothing at all — in which case it
 *   becomes an ORPHANED comment the caller lists rather than silently discards. This file is resolution orchestration on
 *   top of the pure primitives in anchor-text.ts and similarity.ts; it contains no hashing or block logic itself.
 * @inputs createAnchor consumes a document string and the start/end offsets of the quoted range; resolveAnchor consumes
 *   a document string and a previously created CommentAnchor to locate its current position within that same document.
 * @outputs createAnchor returns a CommentAnchor (quoted text, surrounding context windows, offset, block hash);
 *   resolveAnchor returns a ResolvedAnchor describing where the anchor now lands, or null when it cannot be located.
 * @functions
 *   - FUZZY_RADIUS: the character radius around the recorded offset searched before widening to the whole document.
 *   - createAnchor: builds a CommentAnchor from a text slice, clamping and ordering its offsets rather than throwing.
 *   - resolveAnchor: descends the exact/context/quote/fuzzy ladder over `text` to relocate `anchor`, or returns null.
 *   - findAll: every index at which a needle occurs within a haystack (private helper).
 *   - nearest: the position in a list closest to a reference value, ties favoring the earliest entry (private helper).
 *   - bestFuzzyIn: the highest-scoring fuzzy window over [from, to) above MIN_SIMILARITY, tie-broken by proximity.
 * @dataflow Document + offsets -> createAnchor -> CommentAnchor; document + CommentAnchor -> resolveAnchor ladder ->
 *   ResolvedAnchor or null; helpers transform raw indices and scores into the chosen match without any I/O or state.
 * @controlflow createAnchor clamps then slices to build the identity. resolveAnchor first rejects an empty quote, then
 *   tries exact re-read (the common case), then context, then nearest identical copy, then a bounded fuzzy scan that
 *   widens only if nothing clears the threshold in-radius, and finally returns null; each rung short-circuits on hit so
 *   an unedited document costs exactly one slice comparison.
 * @version 1
 * @date 2026-09-06
 */

import { CONTEXT_LENGTH, MIN_SIMILARITY, blockAround, hashBlock } from './anchor-text.js';
import type { CommentAnchor, ResolvedAnchor } from './anchor-text.js';
import { similarity } from './similarity.js';

export type { CommentAnchor, ResolvedAnchor, AnchorMatchKind } from './anchor-text.js';

/** Character radius around the recorded offset searched before a fuzzy match widens to the whole document. */
export const FUZZY_RADIUS: number = 2000;

/**
 * Builds a CommentAnchor identifying the quoted range [start, end) within `text`.
 * @purpose Derive a stable identity — quoted text, surrounding context windows, offset, and block hash — for a comment's
 *   target range so it can later be re-located as the document is edited.
 * @inputs text - the full document being anchored; start - the requested start offset of the quote; end - the requested end offset.
 * @returns A CommentAnchor whose quotedText, prefixContext, and suffixContext describe the slice and whose charOffset and
 *   blockHash record its position and surrounding block for later resolution.
 * @dataflow text + offsets -> clamped/ordered offsets -> sliced quote and context windows -> hashBlock(blockAround(...)) identity.
 * @controlflow Clamp both offsets into bounds, order them so start <= end via min/max (handling reversed input without branching),
 *   then slice the quote and its two context windows and return the assembled anchor object.
 */
export function createAnchor(text: string, start: number, end: number): CommentAnchor {
  // Clamp both offsets into [0, text.length] rather than throwing on an out-of-range request.
  const clampedStart = Math.max(0, Math.min(start, text.length));
  const clampedEnd = Math.max(0, Math.min(end, text.length));

  // Order the offsets so that start never exceeds end, regardless of whether the caller passed them reversed.
  const safeStart = Math.min(clampedStart, clampedEnd); // smaller offset becomes the quote's start.
  const safeEnd = Math.max(clampedStart, clampedEnd); // larger offset becomes the quote's end.

  const quotedText = text.slice(safeStart, safeEnd); // the exact text between the ordered offsets.

  // prefixContext: up to CONTEXT_LENGTH characters immediately before the quote, bounded by the document start.
  const prefixStart = Math.max(0, safeStart - CONTEXT_LENGTH);
  const prefixContext = text.slice(prefixStart, safeStart);

  // suffixContext: up to CONTEXT_LENGTH characters immediately after the quote, bounded by the document end.
  const suffixEnd = Math.min(text.length, safeEnd + CONTEXT_LENGTH);
  const suffixContext = text.slice(safeEnd, suffixEnd);

  return {
    quotedText,
    prefixContext,
    suffixContext,
    charOffset: safeStart, // the quote's start offset within the document.
    blockHash: hashBlock(blockAround(text, safeStart)), // fingerprint of the surrounding block for candidate narrowing.
  };
}

/**
 * Relocates `anchor` within a possibly-edited `text`, descending an exact/context/quote/fuzzy ladder and returning the
 * ResolvedAnchor for the first rung that matches, or null when no rung matches (an orphaned comment).
 * @purpose Re-find where a comment's quoted text now sits so the comment keeps pointing at its target across edits.
 * @inputs text - the current document state; anchor - a CommentAnchor previously created over an earlier version of this text.
 * @returns A ResolvedAnchor describing the matched range and confidence, or null when the quote cannot be located anywhere.
 * @dataflow anchor identity -> rung-by-rung search against text -> first successful match resolved to offsets + kind + confidence.
 * @controlflow Reject an empty quote, then try exact re-read (short-circuiting on hit), context substring, nearest identical
 *   copy, a bounded fuzzy scan that widens only if nothing clears the threshold in-radius, and finally return null.
 */
export function resolveAnchor(text: string, anchor: CommentAnchor): ResolvedAnchor | null {
  const quotedText = anchor.quotedText; // the exact text the comment quotes; the primary key every rung tries to reuse.

  if (quotedText.length === 0) {
    // An empty quote matches everywhere and is therefore useless; reject it rather than return a false positive.
    return null;
  }

  const charOffset = anchor.charOffset; // original character offset of the quoted text within its document.

  // Rung 1 — exact: re-read the quote from its recorded offset; this is the overwhelmingly common unedited case.
  if (text.slice(charOffset, charOffset + quotedText.length) === quotedText) {
    // Branch: the quote is byte-for-byte where it was recorded; return immediately so nothing else runs on a clean doc.
    return { start: charOffset, end: charOffset + quotedText.length, kind: 'exact', confidence: 1 };
  }

  // Rung 2 — context: search for the full prefix+quote+suffix block, which survives when the text merely moved.
  const context = anchor.prefixContext + quotedText + anchor.suffixContext; // the whole anchored block as recorded.
  const contextIndex = text.indexOf(context); // first position where that contiguous block reappears, or -1.

  if (contextIndex !== -1) {
    // Branch: the entire block is present elsewhere, so the quote starts right after its preserved prefix.
    const start = contextIndex + anchor.prefixContext.length; // offset of the quote within the relocated block.
    return { start, end: start + quotedText.length, kind: 'context', confidence: 0.9 };
  }

  // Rung 3 — quote: the exact quote still exists somewhere; proximity to the original offset is all we can use.
  const occurrences = findAll(text, quotedText); // every index at which the identical quoted text currently appears.

  if (occurrences.length > 0) {
    // Branch: at least one identical copy remains; choose the one nearest the recorded offset as the best guess.
    const start = nearest(charOffset, occurrences); // closest occurrence to where the quote was originally located.
    return { start, end: start + quotedText.length, kind: 'quote', confidence: 0.8 };
  }

  // Rung 4a — fuzzy within radius: search a bounded window around the recorded offset first, since most comments have
  // not moved far; bounding it keeps a large document from paying a quadratic cost for an anchor that is essentially in place.
  const radiusStart = Math.max(0, charOffset - FUZZY_RADIUS); // left edge of the initial fuzzy search window.
  const radiusEnd = Math.min(text.length, charOffset + FUZZY_RADIUS); // right edge, clamped to the document end.
  const inRadius = bestFuzzyIn(text, quotedText, radiusStart, radiusEnd, charOffset);

  if (inRadius !== null) {
    // Branch: a near-match cleared the threshold inside the radius; adopt it without scanning the whole document.
    return inRadius;
  }

  // Rung 4b — fuzzy widened: nothing within the radius cleared the threshold, so widen to the entire document as a last resort.
  const anywhere = bestFuzzyIn(text, quotedText, 0, text.length, charOffset);

  if (anywhere !== null) {
    // Branch: a near-match exists only outside the radius; accept it rather than report the comment as orphaned.
    return anywhere;
  }

  // Rung 5 — no rung matched; the comment is orphaned and the caller lists it with its quoted text, never discarding it.
  return null;
}

/**
 * Returns every index at which `needle` occurs within `haystack`, in ascending order; empty when none are found.
 * @purpose Enumerate all exact positions of a quoted string so the nearest can be chosen on the quote rung.
 * @inputs haystack - the document text to search; needle - the exact substring whose occurrences are collected.
 * @returns An array of occurrence indices in ascending order, empty when `needle` is absent or empty.
 * @dataflow haystack + needle -> repeated indexOf from a moving cursor -> collected index list.
 * @controlflow Reject an empty needle up front, then loop indexOf advancing the cursor by one past each match to capture
 *   overlaps, breaking when no further occurrence exists.
 */
function findAll(haystack: string, needle: string): number[] {
  const indices: number[] = []; // collected occurrence positions, in ascending order of discovery.

  // An empty needle has no meaningful occurrences for anchoring; the caller rejects it before reaching here.
  if (needle.length === 0) {
    // Branch: nothing to search for; return without scanning so an accidental empty query stays empty.
    return indices;
  } else {
    // Branch: a real needle exists; proceed to scan `haystack` for each of its occurrences.
    let from = 0; // index at which the next indexOf search begins, advancing past each match found.

    while (true) {
      const index = haystack.indexOf(needle, from); // next occurrence of `needle` at or after `from`.

      if (index === -1) {
        // Branch: no further occurrence exists; stop scanning and return what has been collected.
        break;
      } else {
        // Branch: an occurrence was found; record it and resume the search one character later to capture overlaps.
        indices.push(index);
        from = index + 1;
      }
    }
  }

  return indices;
}

/**
 * Returns the value in `positions` closest to `reference`; ties favor the earliest entry, and an empty list yields
 * `reference` itself since there is nothing nearer.
 * @purpose Pick the single candidate position nearest a recorded offset when several identical quotes exist.
 * @inputs reference - the original character offset used as the proximity target; positions - candidate start indices.
 * @returns The nearest position value, or `reference` unchanged when `positions` contains no entries.
 * @dataflow Each candidate -> its absolute distance from reference -> running minimum adopted into `best`.
 * @controlflow Seed best with the reference and infinite distance, then iterate positions adopting any strictly closer one;
 *   strict comparison keeps the earliest entry on ties.
 */
function nearest(reference: number, positions: readonly number[]): number {
  let best = reference; // fallback when no candidate exists; replaced by the first position on the next iteration.
  let bestDistance = Number.POSITIVE_INFINITY; // largest possible distance, so any real candidate is strictly closer.

  for (const position of positions) {
    // `for...of` yields each number directly, avoiding index access under noUncheckedIndexedAccess.
    const distance = Math.abs(position - reference); // horizontal gap between this candidate and the reference offset.

    if (distance < bestDistance) {
      // Branch: strictly closer than everything seen so far; adopt it as the new nearest match.
      best = position;
      bestDistance = distance;
    } else {
      // Branch: not strictly closer (equal or farther); keep the current best, favoring the earliest on ties.
    }
  }

  return best;
}

/**
 * Slides a window of `windowText.length` over text[from..to) and returns the highest-scoring fuzzy match above
 * MIN_SIMILARITY, tie-broken toward the position nearest `reference`; null when nothing clears the threshold.
 * @purpose Locate a lightly-edited copy of the quoted text within a bounded region by scoring every window with similarity.
 * @inputs text - the document to scan; windowText - the quoted text defining the window width and comparison target; from, to -
 *   the inclusive-exclusive search bounds; reference - the recorded offset used to break score ties by proximity.
 * @returns A ResolvedAnchor of kind 'fuzzy' with confidence equal to the winning similarity score, or null if none qualifies.
 * @dataflow Each window slice -> similarity(candidate, windowText) -> keep best above threshold, tie-break by distance.
 * @controlflow Guard zero-width windows, then step one character at a time across [from, to), skipping sub-threshold scores and
 *   adopting strictly better or nearer-equal windows; return the accumulated best or null.
 */
function bestFuzzyIn(text: string, windowText: string, from: number, to: number, reference: number): ResolvedAnchor | null {
  const windowLength = windowText.length; // fixed width of the sliding window, equal to the quoted text length.

  if (windowLength === 0) {
    // Branch: a zero-width window cannot be scored meaningfully against similarity; there is no match to return.
    return null;
  }

  let best: ResolvedAnchor | null = null; // best fuzzy match found so far, or none until the first qualifying window.

  for (let start = from; start + windowLength <= to; start++) {
    // Step one character at a time across [from, to); a coarser step would skip a candidate by a whole character.
    const candidate = text.slice(start, start + windowLength); // the exact text of the current window position.
    const score = similarity(candidate, windowText); // Dice coefficient over bigrams comparing the two strings.

    if (score <= MIN_SIMILARITY) {
      // Branch: below the minimum acceptable similarity; skip this window without considering it for `best`.
      continue;
    }

    const distance = Math.abs(start - reference); // gap between this candidate's start and the original offset.

    if (best === null) {
      // Branch: first window above threshold; adopt it unconditionally as the initial best match.
      best = { start, end: start + windowLength, kind: 'fuzzy', confidence: score };
    } else if (score > best.confidence) {
      // Branch: strictly higher similarity than the current best; a better match regardless of position.
      best = { start, end: start + windowLength, kind: 'fuzzy', confidence: score };
    } else if (score === best.confidence && distance < Math.abs(best.start - reference)) {
      // Branch: equal score but nearer to the reference; break the tie toward proximity.
      best = { start, end: start + windowLength, kind: 'fuzzy', confidence: score };
    } else {
      // Branch: not strictly better than the current best; leave `best` unchanged.
    }
  }

  return best;
}
