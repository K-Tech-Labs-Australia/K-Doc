/**
 * @file scope.ts
 * @purpose Semantic scoping engine for Find and Replace in @k-doc/core (FR-9.4).
 *   `findMatches` in `search.ts` already returns `SearchMatch` records carrying `start`/`end`
 *   source offsets. This module filters those, so search stays one implementation and the
 *   semantics are a lens over it. Provides options to exclude code blocks (fenced and inline),
 *   exclude link URLs/titles, and restrict search results to the heading section containing a caret offset.
 * @inputs SearchMatch records from search.ts, mdast Root AST trees, Markdown source strings, and SearchScope options.
 * @outputs Readonly arrays of SourceRange objects, optional section SourceRange or null, and filtered SearchMatch arrays.
 * @functions
 *   - codeRanges: Collects source offset ranges of all fenced code blocks and inline code spans in an AST.
 *   - linkUrlRanges: Collects source offset ranges of destination URLs and titles for inline links in source text.
 *   - sectionRange: Resolves the source offset range of the heading section containing or preceding a character offset.
 *   - scopeMatches: Filters an array of SearchMatch records according to enabled SearchScope options.
 * @dataflow Markdown AST + source text + SearchMatch array → scope options evaluation (code / link / section ranges) → boundary intersection tests → filtered SearchMatch array.
 * @controlflow Traverse AST for code/link ranges → calculate depth-aware section boundaries → iterate matches dropping those overlapping excluded ranges or outside active section → return filtered matches.
 * @version 1
 * @date 2026-09-06
 */

import type { Heading, Link, Node, Parent, Root } from 'mdast';
import type { SearchMatch } from './search.js';

/**
 * Half-open character offset range `[start, end)` in Markdown source text.
 */
export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Scoping configuration to filter Find and Replace search matches by document semantics (FR-9.4).
 */
export interface SearchScope {
  /** Skip matches inside fenced or indented code blocks and inline code. Default false. */
  readonly excludeCodeBlocks?: boolean;
  /** Skip matches inside a link's destination URL or title. Default false. */
  readonly excludeLinkUrls?: boolean;
  /** Restrict to the heading section containing this source offset. Null for the whole document. */
  readonly sectionAt?: number | null;
}

/**
 * Collects the source offset ranges of every code block (fenced or indented) and inline code node in an AST.
 *
 * @purpose Walks an mdast tree to identify character offset ranges corresponding to code spans for exclusion.
 * @inputs root - The mdast Root syntax tree to inspect.
 * @outputs readonly SourceRange[] - Readonly array of SourceRange intervals for all code spans.
 * @dataflow mdast Root → recursive AST traversal → inspect node.type for 'code' or 'inlineCode' → extract position offsets → SourceRange array.
 * @controlflow Traverse AST nodes recursively → check if node is 'code' or 'inlineCode' → if position offsets exist append SourceRange; if position missing skip with comment → return collected ranges.
 */
export function codeRanges(root: Root): readonly SourceRange[] {
  const ranges: SourceRange[] = [];

  /**
   * Recursively walks AST nodes collecting code and inlineCode source ranges.
   *
   * @param node - The current AST node being visited.
   */
  function walk(node: Node): void {
    // Check if the node is a block-level code element or an inline code span.
    if (node.type === 'code' || node.type === 'inlineCode') {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;

      // Check if both start and end character offsets are defined numbers.
      if (typeof start === 'number' && typeof end === 'number') {
        // Valid position metadata: record the source range of this code node.
        ranges.push({ start, end });
      } else {
        // A node without a position was synthesised rather than parsed,
        // so there is no source region to exclude and excluding nothing is the safe answer.
      }
    } else {
      // Non-code node: continue traversal to child nodes.
    }

    // Check if the node contains child nodes to traverse.
    if ('children' in node && Array.isArray((node as Parent).children)) {
      const parent = node as Parent;
      for (const child of parent.children) {
        walk(child);
      }
    } else {
      // Leaf node with no children.
    }
  }

  walk(root);
  return ranges;
}

/**
 * Collects the source offset ranges of destination URLs and titles for inline links in Markdown source text.
 *
 * @purpose Derives character offset ranges of link URLs by searching within link source slices for the delimiter sequence.
 * @inputs root - The mdast Root syntax tree to search for link nodes.
 * @inputs source - The complete Markdown source text string.
 * @outputs readonly SourceRange[] - Readonly array of SourceRange intervals corresponding to link destination URLs and titles.
 * @dataflow mdast Root + source text → recursive traversal finding link nodes → slice source at link position → find ']( ' and closing ')' → SourceRange array.
 * @controlflow Traverse AST for 'link' nodes → check position metadata → slice source text → locate destination delimiters → append valid ranges or skip reference/malformed links with comment → return ranges.
 */
export function linkUrlRanges(root: Root, source: string): readonly SourceRange[] {
  const ranges: SourceRange[] = [];

  /**
   * Recursively walks AST nodes collecting inline link destination URL ranges.
   *
   * @param node - The current AST node being visited.
   */
  function walk(node: Node): void {
    // Check if the node is a link node.
    if (node.type === 'link') {
      const linkNode = node as Link;
      const start = linkNode.position?.start?.offset;
      const end = linkNode.position?.end?.offset;

      // Check if link node has valid position coordinates.
      if (typeof start === 'number' && typeof end === 'number') {
        const slice = source.slice(start, end);
        const openMarker = slice.indexOf('](');

        // Check if the slice contains the standard inline destination opening sequence ']('.
        if (openMarker !== -1) {
          const closeMarker = slice.lastIndexOf(')');

          // Check if a closing parenthesis exists after the opening delimiter.
          if (closeMarker > openMarker + 1) {
            // URL range starts immediately after '](' and ends before the closing ')'.
            ranges.push({
              start: start + openMarker + 2,
              end: start + closeMarker,
            });
          } else {
            // A reference link or one whose shape is not found contributes no range —
            // guessing at a range would exclude the wrong characters, and excluding nothing
            // merely leaves the current (text-only) behaviour rather than corrupting a replace.
          }
        } else {
          // A reference link or one whose shape is not found contributes no range —
          // guessing at a range would exclude the wrong characters, and excluding nothing
          // merely leaves the current (text-only) behaviour rather than corrupting a replace.
        }
      } else {
        // A node without a position was synthesised rather than parsed, so there is no source region to inspect.
      }
    } else {
      // Non-link node: continue traversal.
    }

    // Check if the node contains child nodes to traverse (e.g. link text formatting).
    if ('children' in node && Array.isArray((node as Parent).children)) {
      const parent = node as Parent;
      for (const child of parent.children) {
        walk(child);
      }
    } else {
      // Leaf node with no children.
    }
  }

  walk(root);
  return ranges;
}

/**
 * Resolves the character offset range of the heading section containing or preceding a given character offset.
 *
 * @purpose Finds the active heading section boundaries for scoped search, depth-aware so subsections belong to parents.
 * @inputs root - The mdast Root syntax tree to inspect for top-level headings.
 * @inputs offset - The 0-based character offset (caret position) into the source text.
 * @inputs sourceLength - The total length of the Markdown source text.
 * @outputs SourceRange | null - The SourceRange spanning from heading start to the next same/shallower heading start (or sourceLength), or null if no section applies.
 * @dataflow mdast Root → iterate root.children filtering headings → locate heading containing or preceding offset → find terminating heading of same/shallower depth → return SourceRange or null.
 * @controlflow Collect top-level headings with positions → check if headings empty or offset precedes first heading (return null) → locate preceding heading → scan subsequent headings for depth <= target.depth → return { start, end }.
 */
export function sectionRange(root: Root, offset: number, sourceLength: number): SourceRange | null {
  interface HeadingEntry {
    readonly depth: number;
    readonly start: number;
    readonly end: number;
  }

  const headings: HeadingEntry[] = [];

  // Collect top-level headings in document order.
  for (const child of root.children) {
    // Check if the top-level AST node is a heading.
    if (child.type === 'heading') {
      const heading = child as Heading;
      const start = heading.position?.start?.offset;
      const end = heading.position?.end?.offset;

      // Check if heading has valid position offsets.
      if (typeof start === 'number' && typeof end === 'number') {
        headings.push({
          depth: heading.depth,
          start,
          end,
        });
      } else {
        // Skip heading node without position metadata.
      }
    } else {
      // Non-heading child node.
    }
  }

  // Check if document has any headings.
  if (headings.length === 0) {
    // Return null when the document has no headings, or when offset sits before the first one —
    // "the section containing the caret" is not defined there and a null scope must mean
    // the whole document rather than nothing.
    return null;
  } else {
    // Document contains at least one heading.
  }

  const firstHeading = headings[0];
  // Check if offset sits before the start of the first heading.
  if (firstHeading === undefined || offset < firstHeading.start) {
    // Return null when the document has no headings, or when offset sits before the first one —
    // "the section containing the caret" is not defined there and a null scope must mean
    // the whole document rather than nothing.
    return null;
  } else {
    // Offset is at or after the first heading start.
  }

  // Find the heading whose range contains or most recently precedes offset.
  let targetIndex = -1;
  for (let i = 0; i < headings.length; i++) {
    const current = headings[i];
    // Check if this heading starts at or before the target offset.
    if (current !== undefined && current.start <= offset) {
      targetIndex = i;
    } else {
      // Heading starts after target offset; preceding heading was the previous one.
      break;
    }
  }

  // Check if a target heading was found.
  if (targetIndex === -1) {
    // Offset sits before the first heading.
    return null;
  } else {
    // Target heading index identified.
  }

  const targetHeading = headings[targetIndex];
  // Guard against undefined index access under strict compiler settings.
  if (targetHeading === undefined) {
    return null;
  } else {
    // Target heading resolved.
  }

  // Locate the terminating heading: the next heading of the same or shallower depth.
  let sectionEnd = sourceLength;
  for (let j = targetIndex + 1; j < headings.length; j++) {
    const next = headings[j];
    // Check if the next heading has the same or shallower depth (numerically <= target depth).
    // A subsection belongs to its parent section, which is why the terminator
    // is depth-aware rather than "the next heading".
    if (next !== undefined && next.depth <= targetHeading.depth) {
      sectionEnd = next.start;
      break;
    } else {
      // Next heading is deeper (a subsection): belongs to this section, so continue scanning.
    }
  }

  return {
    start: targetHeading.start,
    end: sectionEnd,
  };
}

/**
 * Filters search matches according to semantic scope settings (code exclusions, link exclusions, and section restriction).
 *
 * @purpose Filters SearchMatch records by document semantics as a lens over the core search results (FR-9.4).
 * @inputs matches - Readonly array of SearchMatch items produced by findMatches.
 * @inputs root - The mdast Root syntax tree for the document.
 * @inputs source - The Markdown source text string.
 * @inputs scope - The SearchScope configuration specifying semantic filters.
 * @outputs readonly SearchMatch[] - Filtered array of SearchMatch records meeting all scope criteria.
 * @dataflow matches + root + source + scope → compute excluded ranges & section boundary → filter match array → return matching subset.
 * @controlflow Guard empty matches -> gather enabled excluded ranges -> resolve section boundary if sectionAt specified -> filter matches testing section containment and range overlap -> return results.
 */
export function scopeMatches(
  matches: readonly SearchMatch[],
  root: Root,
  source: string,
  scope: SearchScope,
): readonly SearchMatch[] {
  // Check if incoming matches list is empty.
  if (matches.length === 0) {
    // No matches to filter: return empty array immediately.
    return [];
  } else {
    // Matches present: proceed with scope evaluation.
  }

  const excluded: SourceRange[] = [];

  // Check if code blocks should be excluded from search matches.
  if (scope.excludeCodeBlocks === true) {
    // Exclude both fenced and inline code ranges.
    const codeSpanRanges = codeRanges(root);
    for (const r of codeSpanRanges) {
      excluded.push(r);
    }
  } else {
    // Code blocks are not excluded.
  }

  // Check if link destination URLs and titles should be excluded.
  if (scope.excludeLinkUrls === true) {
    // Exclude link destination URL ranges while leaving link text searchable.
    const urlSpanRanges = linkUrlRanges(root, source);
    for (const r of urlSpanRanges) {
      excluded.push(r);
    }
  } else {
    // Link destination URLs are not excluded.
  }

  // Resolve section range if sectionAt offset is provided.
  let activeSection: SourceRange | null = null;
  if (typeof scope.sectionAt === 'number') {
    activeSection = sectionRange(root, scope.sectionAt, source.length);
  } else {
    // sectionAt is null or undefined: whole document search.
  }

  const filtered: SearchMatch[] = [];

  for (const match of matches) {
    // Check if section boundary restriction applies.
    if (activeSection !== null) {
      // Drop a match outside the section range when one applies.
      if (match.start < activeSection.start || match.end > activeSection.end) {
        // Match falls outside active section boundaries; drop it.
        continue;
      } else {
        // Match falls within active section boundaries.
      }
    } else {
      // No active section restriction; match applies document-wide.
    }

    // Check if match overlaps any excluded source range.
    let overlapsExcluded = false;
    for (const range of excluded) {
      // Check if the match overlaps this excluded range.
      // Overlap rather than containment is the test, because a match that starts
      // in prose and runs into a code span is still partly inside the code.
      const overlaps =
        match.start === match.end
          ? match.start >= range.start && match.start < range.end
          : match.start < range.end && range.start < match.end;

      if (overlaps) {
        // Match overlaps an excluded range: mark for dropping.
        overlapsExcluded = true;
        break;
      } else {
        // Match does not overlap this excluded range.
      }
    }

    // Check if match was flagged as overlapping an excluded range.
    if (overlapsExcluded) {
      // Drop match: overlaps an excluded code block or link destination URL.
      continue;
    } else {
      // Match does not overlap any excluded range: keep it.
      filtered.push(match);
    }
  }

  return filtered;
}
