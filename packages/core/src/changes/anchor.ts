/**
 * @file anchor.ts
 * @purpose Anchors tracked changes so a pending edit can be re-located as its surrounding Markdown evolves (FR-11.5, FR-11.6).
 *   A change is anchored by what the document should currently contain around it: because on-disk Markdown holds accepted-plus-pending text, an insertion's own text is present while a deletion's text was removed and lives only in the overlay — that single asymmetry yields one uniform rule. The string to search for is `prefix + changeText + suffix` for an insertion and `prefix + suffix` for a deletion, and both resolve to a range: an insertion to the span of its text, a deletion to the empty point at the seam where it used to be. A comment anchor cannot be reused here because resolving an empty quote is meaningless — exactly what a deletion's current context would be. Resolution climbs a ladder (exact -> context -> text -> offset) from most to least confident and never drops a change.
 * @inputs None; every function consumes only its own arguments and imports CONTEXT_LENGTH for the context-window size.
 * @outputs ChangeAnchor / ResolvedChange types plus createChangeAnchor, expectedText, resolveChangeAnchor, and two internal helpers (rangeFromMatch, nearestIndexOf).
 * @functions
 *   - createChangeAnchor: slices prefix/suffix/context around a recorded offset from post-edit text.
 *   - expectedText: builds the search string (prefix + changeText? + suffix) per kind.
 *   - rangeFromMatch: derives a ResolvedChange's start/end from where its located prefix ends.
 *   - nearestIndexOf: finds the needle occurrence closest to a target offset, or -1 when absent.
 *   - resolveChangeAnchor: climbs the exact/context/text/offset ladder and returns null only for an empty document.
 * @dataflow Arguments -> pure transform (slice / concat / indexOf) -> returned anchor or resolved range; no I/O, no shared state.
 * @controlflow Each function is independent and deterministic; callers build an anchor at edit time and resolve it later against live text.
 * @version 2
 * @date 2026-09-16
 */

import { CONTEXT_LENGTH } from '../comments/anchor-text.js';

/** The shortest one-sided context (characters) that resolution will match on its own; shorter runs recur too often. */
const PARTIAL_CONTEXT_MIN = 8;

export type ChangeKind = 'insert' | 'delete';

export interface ChangeAnchor {
  /** Up to CONTEXT_LENGTH characters immediately before the change. */
  readonly prefix: string;
  /** Up to CONTEXT_LENGTH characters immediately after the change. */
  readonly suffix: string;
  /** Where the change sat when it was recorded. A hint for choosing between equal candidates, never authoritative. */
  readonly offset: number;
}

export interface ResolvedChange {
  /** Inclusive start of the change in the current text. */
  readonly start: number;
  /** Exclusive end. Equal to `start` for a deletion, which occupies no characters. */
  readonly end: number;
  /** How the match was found, coarsest last. */
  readonly kind: 'exact' | 'context' | 'text' | 'offset';
}

/**
 * @purpose Captures what the document should contain around a tracked change so it can later be re-located.
 * @inputs text - Markdown at the moment of recording; start and end are the inclusive/exclusive offsets of the change within it (a deletion is passed as start === end, its seam).
 * @outputs ChangeAnchor holding up to CONTEXT_LENGTH characters before (prefix) and after (suffix), plus the recorded offset.
 * @dataflow slice(text, ...) -> prefix/suffix strings + numeric offset -> anchor object.
 * @controlflow Pure slicing with no branching; returns immediately. Context is read from the text as it stands AFTER the edit so it describes exactly what the anchor will later be resolved against.
 */
export function createChangeAnchor(text: string, start: number, end: number): ChangeAnchor {
  const prefix = text.slice(Math.max(0, start - CONTEXT_LENGTH), start); // preceding context taken from post-edit state, bounded by the recorded offset.
  const suffix = text.slice(end, Math.min(text.length, end + CONTEXT_LENGTH)); // following context likewise reflects post-edit state, bounded by document end.
  return { prefix, suffix, offset: start }; // recorded position is a tie-break hint only; it never decides resolution authoritatively.
}

/**
 * @purpose Builds the exact string the current document should contain at a tracked change's seam, per the insert/delete asymmetry.
 * @inputs anchor - recorded prefix/suffix context; kind - whether this is an insertion or deletion; changeText - inserted text (ignored for deletions).
 * @outputs The concatenation to search for: `prefix + changeText + suffix` for insertions, `prefix + suffix` for deletions.
 * @dataflow anchor.prefix + optional changeText + anchor.suffix -> single searchable string.
 * @controlflow Pure concatenation with one branch on kind; returns immediately. This is the uniform rule the whole module turns on.
 */
export function expectedText(anchor: ChangeAnchor, kind: ChangeKind, changeText: string): string {
  let result: string;
  if (kind === 'insert') {
    result = anchor.prefix + changeText + anchor.suffix; // an insertion's text is present in the on-disk Markdown.
  } else {
    result = anchor.prefix + anchor.suffix; // a deletion's text was removed and lives only in the overlay, so it is absent here.
  }
  return result;
}

/**
 * @purpose Derives this change's resolved range from where its located prefix ends within `text`.
 * @inputs matchIndex - index of the located expected string (or, for exact, the position where it begins); captured anchor/kind/changeText describe the tracked change.
 * @outputs ResolvedChange whose start is matchIndex plus the prefix length and whose end extends by changeText only for insertions.
 * @dataflow matchIndex -> add prefix length for inclusive start -> extend by changeText for insertion -> range object.
 * @controlflow Pure arithmetic with one branch on kind; always returns a fully populated ResolvedChange of the given kind.
 */

/**
 * @purpose Finds the index of the needle occurrence in haystack nearest to near, or -1 when it never occurs.
 * @inputs haystack - text to scan; needle - non-empty substring to locate; near - recorded offset used as the proximity target.
 * @outputs Index of the closest occurrence to `near`, or -1 when needle is absent (also -1 for an empty needle).
 * @dataflow indexOf scans -> per-occurrence distance computed -> smallest-distance candidate retained -> returned index.
 * @controlflow Left-to-right scan keeps the strictly-nearer candidate; ties favor the earlier (leftmost) occurrence, which matches the recorded offset of an unedited document.
 */
function nearestIndexOf(haystack: string, needle: string, near: number): number {
  if (needle === '') { // An empty needle matches everywhere and would resolve to index 0 with false confidence; return -1 defensively and avoid a zero-advance loop.
    return -1;
  }

  let bestIndex = -1; // Sentinel meaning "no occurrence found yet".
  let bestDistance = Number.POSITIVE_INFINITY; // Smallest distance from `near` among occurrences seen so far.

  for (let index = haystack.indexOf(needle); index !== -1; index = haystack.indexOf(needle, index + needle.length)) {
    const distance = Math.abs(index - near); // Absolute gap between this occurrence and the recorded offset.
    if (distance < bestDistance) {
      bestIndex = index; // Strictly nearer occurrence becomes the new candidate.
      bestDistance = distance;
    } else {
      // An earlier scan already holds an equally close or closer candidate, so keep it (ties favor the leftmost).
    }
  }

  return bestIndex; // Nearest occurrence to `near`, or -1 when needle never occurs in haystack.
}

/**
 * @purpose Re-locates a tracked change against live text by climbing from most to least confident rungs.
 * @inputs text - current on-disk Markdown; anchor - recorded context/offset; kind - insertion or deletion; changeText - inserted text (ignored for deletions).
 * @outputs ResolvedChange at the first matching rung, or null only when `text` is empty.
 * @dataflow expected string -> startsWith / indexOf ladder -> range derived from located prefix end -> returned value.
 * @controlflow Returns on the first successful rung; each failed rung falls through to a coarser one, ending at an offset fallback that never drops the change.
 */
export function resolveChangeAnchor(
  text: string,
  anchor: ChangeAnchor,
  kind: ChangeKind,
  changeText: string,
): ResolvedChange | null {
  // An empty document contains no characters for any tracked change to live against; return null rather than a bogus range.
  if (text === '') {
    return null;
  }

  const expected = expectedText(anchor, kind, changeText); // What the current document should contain at this change's seam.

  // Derive this change's resolved range from where its located prefix ends, per the module's uniform rule.
  const rangeFromMatch = (matchIndex: number, matchKind: ResolvedChange['kind']): ResolvedChange => {
    const start = matchIndex + anchor.prefix.length; // Inclusive end of preceding context and inclusive start of the change.
    let end: number;
    if (kind === 'insert') {
      end = start + changeText.length; // Insertion spans its own text, so extend by the inserted length.
    } else {
      end = start; // A deletion occupies no characters and stays an empty point at the seam where it used to be.
    }
    // matchKind names the rung that located the match, which is a different question from whether the
    // change is an insertion or a deletion -- that distinction is what sets the range width above.
    return { start, end, kind: matchKind };
  };

  // Rung 1 — exact: an unedited document still holds the recorded context verbatim, so one prefix check settles it.
  const prefixStart = anchor.offset - anchor.prefix.length; // where the recorded prefix begins in a document unchanged around this change.
  if (text.startsWith(expected, prefixStart)) {
    return rangeFromMatch(prefixStart, 'exact'); // Exact match at the recorded offset: start there and extend by inserted text when present.
  } else {
    // Branch: context no longer lines up at the recorded position; fall through to coarser rungs.
  }

  // Rung 2 — context: search the whole document for the full expected string and take the occurrence nearest the recorded offset.
  if (expected === '') {
    // An empty needle matches at every position, which would resolve to index 0 with false confidence; skip this rung entirely.
  } else {
    const matchIndex = nearestIndexOf(text, expected, anchor.offset); // Closest of possibly several occurrences to the recorded offset.
    if (matchIndex !== -1) {
      return rangeFromMatch(matchIndex, 'context'); // Change sits at the seam where its surrounding context was located somewhere in the document.
    } else {
      // Branch: no occurrence of the full context exists; fall through to text and offset rungs.
    }
  }

  // Rung 3a — partial context: a neighbouring change was decided since, rewriting part of the context while the rest
  // still stands next to the change. Keep the full suffix and trim the prefix from its far end, then keep the full
  // prefix and trim the suffix, longest first, so the match keeps as much context as survives (down to one whole side
  // alone). Reported on the 'text' rung, since part of a context is a weaker match than all of it. Less than
  // PARTIAL_CONTEXT_MIN characters of context recurs too often to trust.
  const inserted = kind === 'insert' ? changeText : '';
  for (let kept = anchor.prefix.length - 1; kept >= 0; kept -= 1) {
    // Check that enough context remains with this much of the prefix.
    if (kept + anchor.suffix.length < PARTIAL_CONTEXT_MIN) {
      break; // Shorter prefixes only leave less; stop trimming.
    } else {
      const tail = anchor.prefix.slice(anchor.prefix.length - kept);
      const matchIndex = nearestIndexOf(text, tail + inserted + anchor.suffix, anchor.offset - kept);
      // Check whether this much of the context still occurs.
      if (matchIndex !== -1) {
        return { start: matchIndex + kept, end: matchIndex + kept + inserted.length, kind: 'text' }; // After the surviving prefix tail.
      } else {
        // Branch: not with this much prefix; trim one more character.
      }
    }
  }
  for (let kept = anchor.suffix.length - 1; kept >= 0; kept -= 1) {
    // Check that enough context remains with this much of the suffix.
    if (anchor.prefix.length + kept < PARTIAL_CONTEXT_MIN) {
      break; // Shorter suffixes only leave less; stop trimming.
    } else {
      const head = anchor.suffix.slice(0, kept);
      const matchIndex = nearestIndexOf(text, anchor.prefix + inserted + head, anchor.offset - anchor.prefix.length);
      // Check whether this much of the context still occurs.
      if (matchIndex !== -1) {
        return rangeFromMatch(matchIndex, 'text'); // After the whole prefix.
      } else {
        // Branch: not with this much suffix; trim one more character.
      }
    }
  }

  // Rung 3 — text (insertions only): the surrounding prose was edited but the inserted run itself survived intact.
  if (kind === 'insert' && changeText !== '') { // Applies to insertions whose characters still exist; deletions and empty inserts have nothing distinct here.
    const matchIndex = nearestIndexOf(text, changeText, anchor.offset); // Closest surviving occurrence of the inserted run to its recorded offset.
    if (matchIndex !== -1) {
      return { start: matchIndex, end: matchIndex + changeText.length, kind: 'text' }; // The inserted characters themselves are still present in the document.
    } else {
      // Branch: even the surviving run is gone; fall through to the offset fallback.
    }
  } else {
    // A deletion leaves no text to search for here, and an empty insertion has nothing distinct either.
  }

  // Rung 4 — offset (last resort): keep the change in the review pane at an approximate position rather than dropping it.
  const start = Math.max(0, Math.min(anchor.offset, text.length)); // Recorded offset clamped into [0, text.length] so it never escapes the document.
  let end: number;
  if (kind === 'insert') {
    end = Math.max(0, Math.min(start + changeText.length, text.length)); // Insertion length added then clamped to the document bounds.
  } else {
    end = start; // A deletion occupies no characters and stays an empty point at its seam.
  }

  return { start, end, kind: 'offset' }; // Approximate but present — a mis-placed change is reviewable; a vanished one would be data loss.
}
