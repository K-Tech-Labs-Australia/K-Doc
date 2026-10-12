/**
 * @file map.ts
 * @purpose Implements position mapping and bidirectional translation between character offsets and AST nodes in @k-doc/core.
 * @inputs Source text strings, unist Point coordinates, character offsets, OffsetRange boundaries, AST Node structures, and KdocDocument instances.
 * @outputs OffsetRange records, unist Point objects, character offsets, NodePath references, and arrays of intersecting NodePath paths.
 * @functions
 *   - nodeRange: Extracts the half-open character offset range [start, end) from an AST node if present.
 *   - offsetToPoint: Converts a 0-based character offset into a 1-based unist Point (line, column, clamped offset).
 *   - pointToOffset: Converts a 1-based unist Point coordinate into a 0-based character offset.
 *   - nodeAtOffset: Locates the deepest AST node whose range contains the given character offset.
 *   - nodesInRange: Retrieves all AST nodes intersecting an offset range in pre-order document sequence.
 * @dataflow Character offsets / unist Points / OffsetRanges -> position coordinate calculation or recursive AST tree traversal -> OffsetRange / Point / NodePath results.
 * @controlflow Validate / clamp input offsets and point coordinates -> calculate line/column offsets or recursively traverse AST hierarchy -> return mapped coordinates or NodePath instances.
 * @version 1
 * @date 2026-09-04
 */

import type { Node, Parent, Point } from 'unist';
import type { KdocDocument } from '../ast/types.js';

/**
 * Half-open character offset range `[start, end)`.
 * Start offset is inclusive (0-based).
 * End offset is exclusive (0-based).
 */
export interface OffsetRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Path representation containing an AST node and its ancestor parent nodes.
 */
export interface NodePath {
  readonly node: Node;
  readonly ancestors: readonly Parent[];
}

/**
 * Extracts the half-open character offset range [start, end) from an AST node.
 *
 * @purpose Extracts the character offset range from a unist AST node's position metadata.
 * @inputs node - The AST node to inspect for position information.
 * @outputs OffsetRange | null - The half-open range [start, end) if start and end offsets are numbers; otherwise null.
 * @dataflow Node position property -> read start.offset and end.offset -> construct OffsetRange or return null.
 * @controlflow Inspect node.position start and end offsets -> return OffsetRange if both are numbers -> return null otherwise.
 */
export function nodeRange(node: Node): OffsetRange | null {
  const startOffset = node.position?.start?.offset;
  const endOffset = node.position?.end?.offset;

  // Check if both start and end character offsets are valid numbers.
  // Nodes constructed programmatically (rather than parsed) carry no position metadata,
  // making a null return a normal outcome rather than an error condition.
  if (typeof startOffset === 'number' && typeof endOffset === 'number') {
    // Both offsets are defined numbers: return the half-open range [start, end).
    return {
      start: startOffset,
      end: endOffset,
    };
  } else {
    // At least one offset is missing or not a number: return null.
    return null;
  }
}

/**
 * Converts a 0-based character offset into a 1-based unist Point.
 *
 * @purpose Translates a character offset in source text into a 1-based line and column Point structure.
 * @inputs text - The source text string.
 * @inputs offset - The 0-based character offset to convert.
 * @outputs Point - A unist Point containing 1-based line, 1-based column, and the clamped offset.
 * @dataflow Text string + character offset -> clamp offset -> scan text for newlines -> calculate line and column -> unist Point.
 * @controlflow Clamp offset to [0, text.length] -> iterate over characters up to clamped offset -> count \n newlines -> calculate column offset -> return Point.
 */
export function offsetToPoint(text: string, offset: number): Point {
  // Clamp the incoming character offset to the valid document range [0, text.length].
  // Callers routinely pass an end-of-document caret offset (e.g. text.length), which must be accepted without throwing.
  let clampedOffset: number;
  if (offset < 0) {
    // Offset is negative: clamp to the start of the document (0).
    clampedOffset = 0;
  } else if (offset > text.length) {
    // Offset exceeds document length: clamp to the end of the document (text.length).
    clampedOffset = text.length;
  } else {
    // Offset is within document bounds: use the offset directly.
    clampedOffset = offset;
  }

  let line = 1;
  let lineStartOffset = 0;

  // Scan through text up to the clamped offset to count newline characters.
  for (let i = 0; i < clampedOffset; i++) {
    // Check if the current character is a line feed (\n).
    if (text[i] === '\n') {
      // Increment line counter after each newline and advance lineStartOffset to the character following \n.
      // In CRLF sequences, the \r belongs to the preceding line, matching remark/unist position counting.
      line += 1;
      lineStartOffset = i + 1;
    } else {
      // Regular character: continue scanning.
    }
  }

  // Calculate 1-based column position relative to the start of the current line.
  const column = clampedOffset - lineStartOffset + 1;

  return {
    line,
    column,
    offset: clampedOffset,
  };
}

/**
 * Converts a 1-based unist Point coordinate into a 0-based character offset.
 *
 * @purpose Translates a 1-based line and column Point into a 0-based character offset within the source text.
 * @inputs text - The source text string.
 * @inputs point - The unist Point specifying 1-based line and column coordinates.
 * @outputs number - The 0-based character offset corresponding to the Point.
 * @dataflow Point line/column + text string -> validate line and column bounds -> scan lines -> clamp column to line end -> return 0-based character offset.
 * @controlflow Validate point.line >= 1 and point.column >= 1 -> scan text to locate target line -> throw RangeError if line exceeds document length -> clamp column to line end -> return computed offset.
 */
export function pointToOffset(text: string, point: Point): number {
  // Check if point.line is less than 1 (1-based line indexing violation).
  if (point.line < 1) {
    // Fail fast on invalid line number < 1.
    throw new RangeError(`Invalid line number ${point.line}: line numbers must be >= 1`);
  } else {
    // Line number is >= 1; continue validation.
  }

  // Check if point.column is less than 1 (1-based column indexing violation).
  if (point.column < 1) {
    // Fail fast on invalid column number < 1.
    throw new RangeError(`Invalid column number ${point.column}: column numbers must be >= 1`);
  } else {
    // Column number is >= 1; continue line resolution.
  }

  // Parse document into line start and end offsets to resolve line boundaries.
  // Note the deliberate asymmetry: requesting a non-existent line is a caller bug and fails fast,
  // whereas a column beyond the end of the line is normal editor behavior (caret at end of line) and is clamped.
  //
  // A line's addressable range ends AT the offset of its terminating \n, not before a preceding \r.
  // Including the \r is what makes pointToOffset(offsetToPoint(text, i)) === i hold for every offset
  // in a CRLF document; excluding it would silently collapse the \n's offset onto the \r's.
  let currentLine = 1;
  let lineStart = 0;
  let lineEnd = text.length;
  let foundTargetLine = false;

  for (let i = 0; i < text.length; i++) {
    // Check if the current character marks the end of a line.
    if (text[i] === '\n') {
      // Check if currentLine matches the requested line number.
      if (currentLine === point.line) {
        // Target line found: its content ends at the offset of the terminating newline.
        lineEnd = i;
        foundTargetLine = true;
        break;
      } else {
        // Advance to the next line.
        currentLine += 1;
        lineStart = i + 1;
      }
    } else {
      // Regular character within the current line.
    }
  }

  // Check if the target line is the final line in the document (not terminated by a newline).
  if (!foundTargetLine) {
    // Check if the requested line matches the final line number.
    if (currentLine === point.line) {
      // Target line is the last line; lineEnd extends to text.length.
      lineEnd = text.length;
      foundTargetLine = true;
    } else {
      // Requested line exceeds total line count in document: fail fast.
      throw new RangeError(
        `Invalid line number ${point.line}: document has only ${currentLine} line(s)`
      );
    }
  } else {
    // Target line was already located and bounded during iteration.
  }

  // Calculate target offset from 1-based column (column 1 -> lineStart + 0).
  const targetOffset = lineStart + (point.column - 1);

  // Clamp target offset to the line end if column exceeds line length.
  // Editors legitimately report columns beyond the last character when caret is positioned at end-of-line.
  if (targetOffset > lineEnd) {
    // Column exceeds line boundary: clamp to lineEnd.
    return lineEnd;
  } else {
    // Column falls within line bounds: return calculated target offset.
    return targetOffset;
  }
}

/**
 * Locates the deepest AST node whose range contains the given character offset.
 *
 * @purpose Finds the most deeply nested AST node containing a character offset, along with its root-first ancestors.
 * @inputs doc - The KdocDocument containing the AST root to search.
 * @inputs offset - The 0-based character offset to locate.
 * @outputs NodePath | null - NodePath containing the deepest matching node and its ancestors; null if no node contains offset.
 * @dataflow KdocDocument AST root + character offset -> recursive descent search -> deepest matching NodePath or null.
 * @controlflow Start at doc.root -> recursively search child subtrees with child arrays -> check containment [start, end) -> return deepest match or null.
 */
export function nodeAtOffset(doc: KdocDocument, offset: number): NodePath | null {
  /**
   * Recursively traverses an AST node to find the deepest node whose offset range contains the target offset.
   *
   * @param currentNode - The candidate AST node to inspect.
   * @param ancestors - Array of ancestor Parent nodes leading from the root down to currentNode.
   * @returns NodePath if a matching node or descendant is found; null otherwise.
   */
  function findDeepest(
    currentNode: Node,
    ancestors: readonly Parent[]
  ): NodePath | null {
    // Check if the current node has a valid position offset range.
    const currentRange = nodeRange(currentNode);
    const currentMatches =
      currentRange !== null &&
      currentRange.start <= offset &&
      offset < currentRange.end;

    // Check if the current node has a children array (narrow with Array.isArray, never assume Parent).
    if ('children' in currentNode && Array.isArray((currentNode as Parent).children)) {
      const parentNode = currentNode as Parent;
      const childAncestors: readonly Parent[] = [...ancestors, parentNode];

      // Recursively inspect all child nodes to find a deeper matching node.
      for (const child of parentNode.children) {
        const childMatch = findDeepest(child, childAncestors);
        // Check if a child (or deeper descendant) matched the target offset.
        if (childMatch !== null) {
          // Return the deeper match found in the child subtree.
          return childMatch;
        } else {
          // Child subtree did not contain offset; continue checking remaining children.
        }
      }
    } else {
      // Leaf node without children.
    }

    // If no child matched, check if the current node itself contains the target offset.
    if (currentMatches) {
      // Current node is the deepest matching node in this branch.
      return {
        node: currentNode,
        ancestors,
      };
    } else {
      // Neither the current node nor its children matched the offset.
      return null;
    }
  }

  return findDeepest(doc.root, []);
}

/**
 * Retrieves all AST nodes intersecting an offset range in pre-order document sequence.
 *
 * @purpose Collects all AST nodes whose character offset ranges intersect a specified OffsetRange in pre-order order.
 * @inputs doc - The KdocDocument containing the AST root to traverse.
 * @inputs range - The OffsetRange to test for intersection with AST nodes.
 * @outputs readonly NodePath[] - Array of matching NodePath objects ordered root-first in pre-order document order.
 * @dataflow KdocDocument AST root + query OffsetRange -> normalize range -> recursive pre-order traversal -> array of intersecting NodePaths.
 * @controlflow Normalize reversed range -> determine if range is empty -> pre-order traverse tree visiting parent before children -> test intersection formula -> collect matching NodePaths.
 */
export function nodesInRange(doc: KdocDocument, range: OffsetRange): readonly NodePath[] {
  // Normalize reversed ranges (start > end) by swapping start and end offsets.
  let rangeStart = range.start;
  let rangeEnd = range.end;
  if (rangeStart > rangeEnd) {
    // Range is reversed: swap start and end to normalize into [start, end).
    const temp = rangeStart;
    rangeStart = rangeEnd;
    rangeEnd = temp;
  } else {
    // Range is already well-ordered.
  }

  const isEmpty = rangeStart === rangeEnd;
  const results: NodePath[] = [];

  /**
   * Pre-order traversal to collect all nodes whose character offset ranges intersect the query range.
   *
   * @param currentNode - The AST node currently being visited.
   * @param ancestors - Array of ancestor Parent nodes leading from the root down to currentNode.
   */
  function traverse(
    currentNode: Node,
    ancestors: readonly Parent[]
  ): void {
    const nodeR = nodeRange(currentNode);

    // Check if the current node possesses a valid position range.
    if (nodeR !== null) {
      let intersects = false;

      // Check whether query range is empty (bare caret) or non-empty.
      if (isEmpty) {
        // Empty query range (start === end, e.g. a bare caret):
        // Intersects when nodeStart <= range.start && range.start < nodeEnd.
        if (nodeR.start <= rangeStart && rangeStart < nodeR.end) {
          intersects = true;
        } else {
          intersects = false;
        }
      } else {
        // Non-empty query range [start, end):
        // Intersects when nodeStart < range.end && nodeEnd > range.start.
        if (nodeR.start < rangeEnd && nodeR.end > rangeStart) {
          intersects = true;
        } else {
          intersects = false;
        }
      }

      // If the node intersects the query range, add it to results in pre-order.
      if (intersects) {
        results.push({
          node: currentNode,
          ancestors,
        });
      } else {
        // Node does not intersect; do not add to results.
      }
    } else {
      // Node lacks position metadata; skip adding the node itself but continue visiting its children.
    }

    // Traverse children in pre-order (parents before children).
    // Check if the current node has a children array (narrow with Array.isArray, never assume Parent).
    if ('children' in currentNode && Array.isArray((currentNode as Parent).children)) {
      const parentNode = currentNode as Parent;
      const childAncestors: readonly Parent[] = [...ancestors, parentNode];

      for (const child of parentNode.children) {
        traverse(child, childAncestors);
      }
    } else {
      // Leaf node without children.
    }
  }

  traverse(doc.root, []);

  return results;
}
