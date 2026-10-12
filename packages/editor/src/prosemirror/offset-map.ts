/**
 * @file offset-map.ts
 * @purpose Builds a correspondence between Markdown source offsets and ProseMirror document positions for K-Doc's editor pane so that an anchor recorded against raw markdown can be resolved to the equivalent caret position in the rendered tree.
 *
 *   A ProseMirror position and a Markdown source offset are different coordinate systems: markup characters (`**`, `#`,
 *   backticks, list markers) exist in the source but not in the ProseMirror tree. This module builds the correspondence by
 *   walking both trees and pairing their text-bearing leaves, because mdastToProseMirror (from-mdast.ts) creates ProseMirror
 *   text nodes from mdast leaf values in document order while dropping the `position` that recorded where they came from.
 *   collectSourceLeaves recovers those source offsets; collectDocLeaves reads the resulting positions; buildPositionIndex
 *   pairs them by shared document order and reports how far the two walks agree before diverging.
 *
 * @inputs root - The mdast `Root` AST produced from the original Markdown source text.
 * @inputs doc - The ProseMirror document node produced by mdastToProseMirror(root).
 * @outputs PositionIndex - Ordered, non-overlapping OffsetSegments mapping agreed coordinate spans plus a divergence marker.
 * @functions
 *   - collectSourceLeaves: Depth-first collects mdast leaves carrying string values and valid source positions.
 *   - collectDocLeaves: Collects ProseMirror text nodes with their document-order offsets.
 *   - buildPositionIndex: Pairs the two leaf lists in shared order into an OffsetSegment index, stopping at divergence.
 *   - offsetToPosition: Maps one source offset to a ProseMirror position.
 *   - positionToOffset: Maps one ProseMirror position back to a source offset.
 *   - offsetRangeToPositions: Maps a source range to a ProseMirror range, covering its final character whole.
 *   - mapSpansToPositions: Translates a whole comment decoration plan from source offsets into ProseMirror positions.
 *   - mapChangeSpansToPositions: The same for a tracked-change plan, where a deletion is a zero-width point.
 * @dataflow mdast Root → collectSourceLeaves (source offsets) ∥ PMNode doc → collectDocLeaves (document positions) → buildPositionIndex pairs by text equality and document order → PositionIndex.
 * @controlflow Collect both leaf lists in document order; walk them with two indices, advancing one or both on text match, skipping unpaired leaves, and breaking at the first mismatch to record divergedAt.
 * @version 1
 * @date 2026-09-07
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { Root } from 'mdast';
import type { CommentSpan, ChangeSpan } from '@k-doc/core';

/** A matched span between the two coordinate systems, usable at its endpoints and — when `linear` is true — throughout. */
export interface OffsetSegment {
  /** Source offset of the first character, inclusive. */
  readonly srcStart: number;
  /** Source offset just past the last character. */
  readonly srcEnd: number;
  /** ProseMirror position of the first character. */
  readonly pmStart: number;
  /** ProseMirror position just past the last character. */
  readonly pmEnd: number;
  /** True when the two spans are the same length, so an offset inside maps character for character. */
  readonly linear: boolean;
}

/** The result of pairing source and document leaves into a usable offset correspondence. */
export interface PositionIndex {
  /** Segments in document order, non-overlapping and ascending in both coordinate systems. */
  readonly segments: readonly OffsetSegment[];
  /** Source offset at which the two walks stopped agreeing, or null when they agreed to the end. */
  readonly divergedAt: number | null;
}

/** A text-bearing mdast leaf with its recoverable source offsets and exact rendered value. */
interface SourceLeaf {
  readonly text: string;
  readonly srcStart: number;
  readonly srcEnd: number;
}

/** A ProseMirror text terminal with the document positions it occupies. */
interface DocLeaf {
  readonly text: string;
  readonly pmStart: number;
  readonly pmEnd: number;
}

/**
 * @purpose Depth-first walk of the mdast tree collecting text-bearing leaves with recoverable source offsets.
 * @inputs root - The mdast `Root` AST whose descendants are scanned in document order.
 * @outputs readonly SourceLeaf[] - One entry per qualifying node, ordered by ascending source offset.
 * @dataflow For each descendant: read string value + unist position → emit {text, srcStart, srcEnd} leaf.
 * @controlflow Recurse over children arrays; for nodes with a string `value` and numeric start/end offsets push a leaf (skipping empty values), then descend into any array-valued `children`.
 */
export function collectSourceLeaves(root: Root): readonly SourceLeaf[] {
  const leaves: SourceLeaf[] = [];

  // Read the numeric source [start, end) offsets from a node's unist position, or null when absent.
  function readOffsets(node: Record<string, unknown>): [number, number] | null {
    const rawPosition = node.position;

    // A candidate must expose an object-shaped `position`; primitives and null cannot carry endpoints.
    if (typeof rawPosition !== 'object' || rawPosition === null) {
      return null;
    }

    const position = rawPosition as Record<string, unknown>;
    const start = position.start;
    const end = position.end;

    // Both the start and end endpoints must be objects carrying a numeric offset.
    if (typeof start !== 'object' || typeof end !== 'object') {
      return null;
    }

    const startPos = start as Record<string, unknown>;
    const endPos = end as Record<string, unknown>;
    const srcStart = startPos.offset;
    const srcEnd = endPos.offset;

    // Only numeric offsets are usable for coordinate pairing.
    if (typeof srcStart !== 'number' || typeof srcEnd !== 'number') {
      return null;
    }

    return [srcStart, srcEnd];
  }

  function visit(node: unknown): void {
    // Primitives and null cannot carry value/position/children, so skip them outright.
    if (typeof node !== 'object' || node === null) {
      return;
    }

    const record = node as Record<string, unknown>;

    // Collect this node when it carries a string `value` plus valid source offsets — the exact text that mdastToProseMirror turns into a ProseMirror text leaf in document order. Listing every qualifying node type here would be an ever-growing list to keep in step with from-mdast.ts; instead we accept any such node and let the pairing step validate each candidate, dropping anything that renders nothing there rather than hard-coding assumptions about which mdast nodes carry visible text.
    if (typeof record.value === 'string') {
      const offsets = readOffsets(record);

      // A valid position is required before a leaf can be paired with a document text node.
      if (offsets !== null) {
        const [srcStart, srcEnd] = offsets;

        // Skip empty strings: ProseMirror forbids an empty text node, so the converter never emits one and there would be nothing on the document side to pair this source leaf with.
        if (record.value !== '') {
          leaves.push({ text: record.value, srcStart, srcEnd });
        }
      }
    }

    // Recurse into children when present as an array; iterating in order preserves document/offset ordering.
    const rawChildren = record.children;
    if (Array.isArray(rawChildren)) {
      for (const child of rawChildren) {
        visit(child);
      }
    }
  }

  // Walk the top-level blocks depth-first, then descend into each subtree in document order.
  for (const child of root.children) {
    visit(child);
  }

  return leaves;
}

/**
 * @purpose Collect ProseMirror text terminals together with the document positions they occupy.
 * @inputs doc - The root PMNode whose descendants are visited in document order.
 * @outputs readonly DocLeaf[] - One entry per non-empty text node, ordered by ascending document position.
 * @dataflow For each descendant: read text + base offset → emit {text, pmStart, pmEnd} leaf where pmEnd = pos + nodeSize.
 * @controlflow Invoke doc.descendants; for nodes with isText and a non-empty string `text`, push the leaf and continue until every node has been visited.
 */
export function collectDocLeaves(doc: PMNode): readonly DocLeaf[] {
  const leaves: DocLeaf[] = [];

  // `descendants` visits nodes in document order, which is exactly the same order mdastToProseMirror emitted them into ProseMirror — that shared ordering is the entire basis on which this module pairs source and doc.
  doc.descendants((node, pos) => {
    // Only genuine text terminals carry a string `text`; atoms and elements have isText === false.
    if (node.isText && typeof node.text === 'string') {
      // Skip empty strings: the converter never emits an empty ProseMirror text node, so any here would be orphaned on the source side with nothing to pair against.
      if (node.text !== '') {
        const pmStart = pos;
        const pmEnd = pos + node.nodeSize;

        leaves.push({ text: node.text, pmStart, pmEnd });
      }
    }
  });

  return leaves;
}

/**
 * @purpose Pair source and document leaves by shared text equality to produce an offset correspondence index.
 * @inputs root - The mdast `Root` AST feeding collectSourceLeaves.
 * @inputs doc - The ProseMirror document node feeding collectDocLeaves.
 * @outputs PositionIndex - Agreed OffsetSegments plus divergedAt (null when the walks agreed to the end).
 * @dataflow Two ordered leaf lists → two-pointer walk emitting segments on text match, skipping unpaired leaves, stopping at first mismatch.
 * @controlflow Advance both indices on exact text equality; advance only s when the next source leaf matches the current doc leaf; advance only p when the next doc leaf matches the current source leaf; otherwise record divergedAt and break.
 */
export function buildPositionIndex(root: Root, doc: PMNode): PositionIndex {
  const sourceLeaves = collectSourceLeaves(root);
  const docLeaves = collectDocLeaves(doc);
  const segments: OffsetSegment[] = [];

  // divergedAt stays null unless the two walks lose step; a null value means they agreed to the end.
  let divergedAt: number | null = null;

  // Two independent pointers, one per coordinate system, advanced in lockstep when texts match and apart otherwise.
  for (let s = 0, p = 0; s < sourceLeaves.length && p < docLeaves.length;) {
    const srcLeaf = sourceLeaves[s];
    const docLeaf = docLeaves[p];
    const nextSrcLeaf = sourceLeaves[s + 1];
    const nextDocLeaf = docLeaves[p + 1];

    // Both pointers are in-bounds by the loop guard, but index access is T | undefined under noUncheckedIndexedAccess.
    if (srcLeaf === undefined || docLeaf === undefined) {
      break;
    }

    // Exact text match: emit a segment across both coordinate spans and advance both walks to consume the pair.
    if (srcLeaf.text === docLeaf.text) {
      const srcStart = srcLeaf.srcStart;
      const srcEnd = srcLeaf.srcEnd;
      const pmStart = docLeaf.pmStart;
      const pmEnd = docLeaf.pmEnd;

      // `linear` compares span lengths. It is false for inline code and escaped characters, where the source carries delimiters or backslashes (`**`, `` ` ``, `\`) that the rendered text does not — such a segment still maps at its endpoints but cannot interpolate interior offsets linearly.
      segments.push({
        srcStart,
        srcEnd,
        pmStart,
        pmEnd,
        linear: (srcEnd - srcStart) === (pmEnd - pmStart),
      });

      s += 1;
      p += 1;
    }
    // The next source leaf will render this same document text, so skip it — the current source leaf produced nothing here.
    else if (nextSrcLeaf !== undefined && nextSrcLeaf.text === docLeaf.text) {
      s += 1;
    }
    // The next document leaf matches the current source text, meaning this doc leaf came from something with no own position of its own.
    else if (nextDocLeaf !== undefined && nextDocLeaf.text === srcLeaf.text) {
      p += 1;
    }
    // Neither side can resynchronise: the walks have lost step and everything after this point would map to the wrong text, so stop mapping here rather than continuing confidently — a wrong position is far worse than a missing one.
    else {
      divergedAt = srcLeaf.srcStart;
      break;
    }
  }

  return { segments, divergedAt };
}

/**
 * Searches a sorted, non-overlapping offset segment table for the single span that contains an offset.
 * @purpose Finds the OffsetSegment whose source span satisfies srcStart <= offset < srcEnd via binary search.
 * @inputs segments - ascending, non-overlapping OffsetSegments; offset - candidate source position to locate.
 * @returns The owning OffsetSegment on a hit, or null when no segment contains the offset.
 * @dataflow (offset, segments) → narrowed index window → compared against each mid segment's span → returned owner.
 * @controlflow Binary-search: compare offset against seg.srcStart/srcEnd; descend left/right until found or window empties.
 */
function segmentAtOffset(segments: readonly OffsetSegment[], offset: number): OffsetSegment | null {
  let lo = 0;
  let hi = segments.length - 1;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const seg = segments[mid];

    // Required by noUncheckedIndexedAccess: mid is in range, but an indexed read is still possibly undefined.
    if (seg === undefined) {
      // Cannot happen while lo <= hi: give up rather than assert.
      return null;
    } else {
      // A real segment: compare the offset against its source span to locate the owner.

      // Offset falls before this segment's inclusive start, so it belongs to an earlier segment.
      if (offset < seg.srcStart) {
        hi = mid - 1;
      }
      // Offset is at or past this segment's exclusive end, so it belongs to a later segment.
      else if (offset >= seg.srcEnd) {
        lo = mid + 1;
      }
      // srcStart <= offset < srcEnd: the offset falls inside this source span and owns it.
      else {
        return seg;
      }
    }
  }

  return null;
}

/**
 * Maps a source document offset to its nearest rendered (ProseMirror) position using an offset index.
 * @purpose Resolves a source offset to a rendered character position, handling empty docs, divergence, linear/non-linear spans, and inter-segment markup.
 * @inputs index - PositionIndex describing segment layout and divergence point; offset - candidate source position.
 * @returns The mapped rendered position as a number, or null when the offset is unmappable (empty doc, past divergence, or in pure markup with no anchor).
 * @dataflow (offset, index) → guard checks → binary-searched segment → linear interpolation or non-linear snap → markup fallback scan.
 * @controlflow Early-return on empty/diverged; resolve via segmentAtOffset; branch on linearity; fall back to forward-scan and trailing-end snap.
 */
export function offsetToPosition(index: PositionIndex, offset: number): number | null {
  // No segments exist yet: mapping against nothing is a legitimate empty-document state, not an error.
  if (index.segments.length === 0) {
    return null;
  }

  // Past the divergence point the two walks were out of step, so any answer would be confidently wrong;
  // a missing position is far better than a wrong one.
  if (index.divergedAt !== null && offset >= index.divergedAt) {
    return null;
  }

  const hit = segmentAtOffset(index.segments, offset);

  // The offset fell inside a source span; resolve it to a rendered position based on linearity.
  if (hit !== null && hit.linear) {
    // A linear segment maps source and rendered text one character at a time, so advance proportionally from its start.
    return hit.pmStart + (offset - hit.srcStart);
  } else if (hit !== null) {
    // Inside a non-linear segment the source carries delimiters the rendered text does not, so an interior offset has no character-for-character counterpart; the segment start is the nearest position that is certainly right, and over-covering is the safe direction because a range that marks a little too much still marks the right words.
    return hit.pmStart;
  }

  // The offset landed in markup between segments: markup has no position of its own. Scan forward for the first segment whose source span begins after this offset and snap to its rendered start.
  for (let i = 0; i < index.segments.length; i++) {
    const seg = index.segments[i];

    // Required by noUncheckedIndexedAccess: bind the indexed read to a local and skip any undefined element.
    if (seg === undefined) {
      continue;
    } else if (seg.srcStart > offset) {
      return seg.pmStart;
    }
  }

  // No later segment matched; bind the final element, which may be undefined under noUncheckedIndexedAccess.
  const last = index.segments[index.segments.length - 1];

  if (last === undefined) {
    return null;
  } else {
    // An offset past the last text snaps to its rendered end.
    return last.pmEnd;
  }
}

/**
 * @purpose Binary-searches the offset map for the segment whose rendered (ProseMirror) span contains pos, mirroring segmentAtOffset on the ProseMirror axis.
 * @inputs segments - ascending, non-overlapping OffsetSegment records; pos - a position in the ProseMirror coordinate space to resolve into a covering segment.
 * @outputs The single OffsetSegment whose [pmStart, pmEnd) range contains pos, or null when pos falls outside every rendered span.
 * @dataflow pos → compared against each candidate seg.pmStart/pmEnd window → matching segment returned on containment, otherwise bounds narrow until no span remains.
 * @controlflow Binary search narrows lo/hi toward the containing segment; returns early with a hit, advances bounds by comparing pos to the rendered span boundaries, and falls through to null when no bound contains pos.
 */
function segmentAtPosition(segments: readonly OffsetSegment[], pos: number): OffsetSegment | null {
  let lo = 0;
  let hi = segments.length - 1;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const seg = segments[mid];

    // Required by noUncheckedIndexedAccess: mid is in range, but an indexed read is still possibly undefined.
    if (seg === undefined) {
      // Cannot happen while lo <= hi: give up rather than assert.
      return null;
    } else {
      // A real segment: compare the position against its rendered span.
      if (pos < seg.pmStart) {
        // pos precedes this segment's rendered start, so it must lie in an earlier segment or before all segments.
        hi = mid - 1;
      } else if (pos >= seg.pmEnd) {
        // pos is at or past this segment's rendered end, so it lies in a later segment or after all segments.
        lo = mid + 1;
      } else {
        // pos falls within [pmStart, pmEnd): this segment covers the position.
        return seg;
      }
    }
  }

  return null;
}

/**
 * @purpose Maps a ProseMirror position back to an offset: linear segments map character-for-character while gaps and non-linear runs fall back to the nearest honest boundary.
 * @inputs index - the PositionIndex (segments plus divergence marker); pos - a position in the ProseMirror coordinate space to resolve into an offset.
 * @outputs The corresponding source offset when a covering or adjacent segment exists, otherwise null when there is nothing to map against.
 * @dataflow pos → segmentAtPosition resolves it to a segment → linear segments expand by delta from pmStart; gaps and non-linear runs fall back to nearest boundaries via forward scan then trailing end.
 * @controlflow Early-return on empty index, resolve the covering segment, branch on linearity for exact vs. boundary mapping, then scan forward across gap positions before falling back to the final segment's source end.
 */
export function positionToOffset(index: PositionIndex, pos: number): number | null {
  if (index.segments.length === 0) {
    // An empty index has no segments to map against; this is a legitimate state for an empty document rather than a fault.
    return null;
  }

  const hit = segmentAtPosition(index.segments, pos);

  if (hit !== null && hit.linear) {
    // A linear segment maps character-for-character, so expand from its start by the position's offset within the rendered span.
    return hit.srcStart + (pos - hit.pmStart);
  } else if (hit !== null) {
    // A non-linear segment has no character-for-character counterpart inside it, so its start is the nearest offset that is certainly right.
    return hit.srcStart;
  }

  // No `divergedAt` check belongs here: a position past the divergence has no segment covering it at all, so the gap logic below already returns the nearest honest answer rather than an invented one.

  if (hit === null) {
    // The position sits between text runs where the source carries markup and the document has nothing; scan forward for the first run that begins after pos.
    let result: number | null = null;
    for (let i = 0; i < index.segments.length; i += 1) {
      const seg = index.segments[i];

      // Required by noUncheckedIndexedAccess: bind the indexed read and skip an undefined element rather than dereference it.
      if (seg === undefined) {
        continue;
      } else if (seg.pmStart > pos) {
        // This run starts strictly after pos, so its source start is the nearest offset to jump back into text.
        result = seg.srcStart;
        break;
      }

      // The run begins at or before pos: keep scanning for a later one that starts after pos.
    }

    if (result !== null) {
      return result;
    } else {
      // No run started after pos, so the position is in the trailing gap; fall back to the final segment's source end when present.
      const last = index.segments[index.segments.length - 1];

      // Required by noUncheckedIndexedAccess: bind the indexed read and guard against undefined before reading its fields.
      if (last === undefined) {
        return null;
      } else {
        return last.srcEnd;
      }
    }
  }

  return null;
}

/**
 * @purpose Maps a source-offset range [start, end) onto proportional ProseMirror positions derived from an offset index.
 * @inputs index - The PositionIndex describing how source offsets map to proportional positions; start and end are the inclusive/exclusive source bounds of the requested range.
 * @outputs An object { from, to } with mapped proportional positions, or null when the range cannot be represented (empty/inverted, unmappable start/end, collapsed under mapping).
 * @dataflow Source offsets → offsetToPosition/segmentAtOffset lookups on index.segments → proportional position pair returned to ProseMirror.
 * @controlflow Reject empty ranges → map start and fail if it has no counterpart → compute the exclusive end's last character then extend past it → reject unmappable or collapsed results → return the mapped range.
 */
export function offsetRangeToPositions(
  index: PositionIndex,
  start: number,
  end: number
): { readonly from: number; readonly to: number } | null {
  // An empty or inverted range has no characters between its bounds, so there is nothing to map.
  if (start >= end) {
    return null;
  }

  const from = offsetToPosition(index, start);
  // A range whose start cannot be mapped has no counterpart at all, so the whole range fails.
  if (from === null) {
    return null;
  }

  // The end is exclusive, so map the last character and then extend past it, otherwise the range would stop one character short.
  const lastCharSegment = segmentAtOffset(index.segments, end - 1);
  let to: number | null;

  if (lastCharSegment !== null) {
    // A segment covers the final character of the range, so its proportional position is derived from that segment directly.
    if (lastCharSegment.linear) {
      // Linear segments map source offsets to proportional positions one-to-one; adding the full `end` rather than `end - 1` includes the final character in the span.
      to = lastCharSegment.pmStart + (end - lastCharSegment.srcStart);
    } else {
      // A non-linear segment is taken whole — the same over-covering choice made elsewhere, because marking a little too much still marks the right words while marking too little can cut a word in half.
      to = lastCharSegment.pmEnd;
    }
  } else {
    // The final character sat in markup (no offset segment covers `end - 1`), so the ordinary offset mapping is the best available answer.
    to = offsetToPosition(index, end);
  }

  if (to === null) {
    return null;
  }

  // A range which collapsed or inverted under mapping is not a range, and handing it to ProseMirror would throw.
  if (to <= from) {
    return null;
  }

  return { from, to };
}

/**
 * @purpose Translate a decoration plan expressed in source offsets into ProseMirror positions, returning spans of the same shape whose start and end are now positions rather than source offsets.
 * @inputs index - The offset-to-position mapping used to resolve ranges; spans - The comment decorations keyed by source offsets.
 * @outputs An array of CommentSpan-shaped objects whose start and end carry ProseMirror positions, not source offsets — the shape is reused because the comment plugin consumes exactly that shape, and a caller that mixes the two up would paint at meaningless coordinates.
 * @dataflow For each input span: offsetRangeToPositions(index, span.start, span.end) → resolved range or null → push { ...span, start: range.from, end: range.to } into the result array; collected array returned.
 * @controlflow Iterate spans in order; skip any that cannot be placed (see below); accumulate resolvable ones; return at the end.
 */
export function mapSpansToPositions(index: PositionIndex, spans: readonly CommentSpan[]): readonly CommentSpan[] {
  const result: CommentSpan[] = [];

  for (const span of spans) {
    // Resolve this span's source-offset range into ProseMirror positions; null means it cannot be placed here.
    const range = offsetRangeToPositions(index, span.start, span.end);

    if (range === null) {
      // A span the mapper cannot place is dropped rather than guessed at: a comment painted over the wrong words is worse than one that briefly does not appear, and the Source pane still shows it either way.
      continue;
    } else {
      // The range resolved successfully: reuse the original shape but carry ProseMirror positions in start/end instead of source offsets.
      result.push({ ...span, start: range.from, end: range.to });
    }
  }

  return result;
}

/**
 * @purpose Translate a tracked-change plan from source offsets into ProseMirror positions.
 * @inputs index - The position index used to resolve offsets; spans - the change plan expressed in source-offset space.
 * @outputs A new array of ChangeSpan whose start and end carry ProseMirror positions, not source offsets — this shape is reused because the change plugin consumes exactly it, so a caller that mixes the two up paints at meaningless coordinates.
 * @dataflow Each span's source offsets → offsetToPosition/offsetRangeToPositions via index → mapped span with position-space start/end; spans that cannot resolve are dropped rather than guessed.
 * @controlflow Iterate spans; branch on kind to select the correct mapper; skip spans whose resolution is null; collect and return the mapped spans.
 */

export function mapChangeSpansToPositions(index: PositionIndex, spans: readonly ChangeSpan[]): readonly ChangeSpan[] {
  // A skipped span is dropped rather than guessed at: a change painted over the wrong words is worse than one that briefly does not appear, and the Source pane shows it either way.
  const result: ChangeSpan[] = [];

  for (const span of spans) {
    // Insertions keep their characters in the document, so they map as a real range via offsetRangeToPositions.
    if (span.kind === 'insert') {
      const mapped = offsetRangeToPositions(index, span.start, span.end);

      // Skip the span when that returns null rather than guessing an out-of-range insertion position.
      if (mapped === null) {
        continue;
      }

      result.push({ ...span, start: mapped.from, end: mapped.to });
    } else {
      // Deletions are zero-width points and offsetRangeToPositions refuses a collapsed range by design, so map the single source offset with offsetToPosition.
      const point = offsetToPosition(index, span.start);

      // Skip the span when that returns null — reaching for the range mapper here would silently drop every deletion, since start === end makes it return null every time.
      if (point === null) {
        continue;
      }

      result.push({ ...span, start: point, end: point });
    }
  }

  return result;
}
