/**
 * @file anchor-text.ts
 * @purpose Text primitives that comment anchoring is built from (FR-10.5): a stable identity for a block of text, the
 *   block surrounding an offset, and a fast similarity score between two strings. Anchoring exists because a comment
 *   points at a range of text while the body Markdown is NEVER modified to record that pointing — so the anchor must
 *   survive the text around it changing. An anchor that cannot be resolved becomes an ORPHANED comment: listed with its
 *   quoted text and never silently discarded, because a comment is something a person wrote and losing one because the
 *   sentence beneath it was edited would make the feature untrustworthy in exactly the situation it exists for. This
 *   file holds only types and pure helpers — no tree walking, no resolution logic.
 * @inputs None; every function is self-contained and consumes only its own arguments.
 * @outputs A base-36 block hash (hashBlock) and the block of text surrounding an offset (blockAround).
 * @functions
 *   - hashBlock: FNV-1a digest over the string's code units, used to narrow candidate blocks without deciding them.
 *   - blockAround: the run of text containing an offset, bounded by the nearest blank lines or the document ends.
 *   (similarity lives in ./similarity.js, so this module stays free of scoring concerns.)
 * @dataflow Arguments -> pure transform -> returned value; no I/O, no shared state, no imports between modules.
 * @controlflow Each exported function is independent and deterministic; callers combine them to resolve an anchor.
 * @version 1
 * @date 2026-09-06
 */

/** Shared context window, in characters, that anchoring reasons about around a quoted block. */
export const CONTEXT_LENGTH: number = 32;

/** Minimum similarity score, on 0..1, below which two blocks are treated as unrelated. */
export const MIN_SIMILARITY: number = 0.75;

/** A resolved anchor's identity: the quoted text plus surrounding context and its block fingerprint. */
export interface CommentAnchor {
  /** The exact text the comment quotes. */
  readonly quotedText: string;
  /** Text preceding the quote within the same block, trimmed to a reasonable window. */
  readonly prefixContext: string;
  /** Text following the quote within the same block, trimmed to a reasonable window. */
  readonly suffixContext: string;
  /** Character offset of the quoted text within its document. */
  readonly charOffset: number;
  /** FNV-1a hash of the surrounding block, used only to narrow candidate matches. */
  readonly blockHash: string;
}

/** How confidently a resolved anchor matches its target, from coarsest (fuzzy) to exact. */
export type AnchorMatchKind = 'exact' | 'context' | 'quote' | 'fuzzy';

/** A concrete match of an anchor against text: where it landed, how well, and with what confidence. */
export interface ResolvedAnchor {
  /** Inclusive start offset of the matched range within the document. */
  readonly start: number;
  /** Exclusive end offset of the matched range within the document. */
  readonly end: number;
  /** The match category, coarsest to finest as listed. */
  readonly kind: AnchorMatchKind;
  /** 0..1 confidence; always 1 for an exact match. */
  readonly confidence: number;
}

/**
 * FNV-1a over the string's UTF-16 code units, returned as base-36. Deliberately NOT cryptographic: it exists only to
 * tell "this looks like the same paragraph" from "this is somewhere else entirely". A collision costs a slightly slower
 * search, never a wrong answer, because the hash only narrows — it never decides resolution on its own.
 */
export function hashBlock(text: string): string {
  const OFFSET_BASIS = 2166136261; // FNV-1a 32-bit offset basis (prime-derived constant).
  const PRIME = 16777619; // FNV-1a 32-bit multiplying prime.

  let hash = OFFSET_BASIS >>> 0; // unsigned 32-bit accumulator.
  for (let i = 0; i < text.length; i++) {
    const codeUnit = text.charCodeAt(i); // numeric value of the UTF-16 code unit at position i.
    hash ^= codeUnit; // FNV-1a: XOR the code unit in first.
    hash = Math.imul(hash, PRIME) >>> 0; // then multiply by the prime, wrapping to 32 bits unsigned.
  }

  return (hash >>> 0).toString(36); // base-36 digest of the final accumulator.
}

/**
 * Returns the run of text containing offset, bounded by the nearest blank lines (a line that is empty or whitespace
 * only) on each side, or the ends of the text. A blank line is the Markdown paragraph boundary, so this is the cheapest
 * correct notion of "the block this offset is in". An out-of-range offset is clamped rather than throwing.
 */
export function blockAround(text: string, offset: number): string {
  const length = text.length;

  // Clamp an out-of-range offset into [0, length] rather than throwing.
  const clampedOffset = offset < 0 ? 0 : offset > length ? length : offset;

  // Move to the start of the line containing the (clamped) offset by stepping back over non-newline characters.
  let start = clampedOffset;
  while (start > 0 && text[start - 1] !== '\n') {
    // Branch: character before `start` is not a newline; step back onto its line.
    start -= 1;
  }

  // Expand left across blank lines until the first non-blank line, which bounds the block's start.
  while (start > 0) {
    const prevNewline = text.lastIndexOf('\n', start - 2); // newline terminating the line directly above.
    const aboveStart = prevNewline + 1; // first character index of that line above.

    let blankLine = true; // assume blank until a non-whitespace character proves otherwise.
    for (let k = aboveStart; k < start - 1; k++) {
      const c = text[k];
      if (c !== undefined && c.trim() !== '') {
        // Branch: a non-whitespace character exists in the line above; it is not blank, so stop expanding.
        blankLine = false;
        break;
      } else {
        // Branch: this character is whitespace or absent; keep scanning toward the line's start.
      }
    }

    if (blankLine) {
      // Branch: the line above is a blank paragraph boundary, so the block starts at `start`.
      break;
    } else {
      // Branch: the line above is non-blank and part of the same block; move its start leftward.
      start = aboveStart;
    }
  }

  // Move to the end (exclusive) of the line containing the offset by stepping forward over non-newline characters.
  let end = clampedOffset;
  while (end < length && text[end] !== '\n') {
    // Branch: character at `end` is not a newline; step forward onto its line.
    end += 1;
  }

  // Expand right across blank lines until the first non-blank line, which bounds the block's end.
  while (end < length) {
    const nextNewline = text.indexOf('\n', end + 1); // newline terminating the line directly below.
    const belowEnd = nextNewline === -1 ? length : nextNewline; // run to document end when no following newline.

    let blankLine = true; // assume blank until a non-whitespace character proves otherwise.
    for (let k = end + 1; k < belowEnd; k++) {
      const c = text[k];
      if (c !== undefined && c.trim() !== '') {
        // Branch: a non-whitespace character exists in the line below; it is not blank, so stop expanding.
        blankLine = false;
        break;
      } else {
        // Branch: this character is whitespace or absent; keep scanning toward the line's end.
      }
    }

    if (blankLine) {
      // Branch: the line below is a blank paragraph boundary, so the block ends at `end`.
      break;
    } else {
      // Branch: the line below is non-blank and part of the same block; move its end rightward.
      end = belowEnd;
    }
  }

  return text.slice(start, end); // the contiguous run between the two boundaries.
}
