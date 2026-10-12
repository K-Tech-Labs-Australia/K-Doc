/**
 * @file heading-path.spec.ts
 * @purpose Vitest unit tests pinning the breadcrumb reconstruction behavior of headingPath across nesting depth, sibling dropping, preamble handling, empty outlines, level resets, skipped levels, h1 termination, on-heading caret offsets, and result immutability.
 * @inputs Markdown source strings plus marker substrings used to locate character offsets; a frozen empty entry array for the empty-outline case.
 * @outputs Assertion results (expect) validating breadcrumb text arrays and frozen-state booleans; no runtime values are returned by this module.
 * @functions
 *   - pathAt: Resolves a marker within a freshly built outline to its ordered breadcrumb text array.
 *   - headingPath tests: Exercise the production function directly for on-heading offsets and immutability checks.
 * @dataflow Source string → DocumentSession snapshot → buildOutline entries → indexOf(marker) offset → headingPath(entries, offset) → mapped .text arrays compared against expected paths.
 * @controlflow Module scope defines pathAt helper → describe registers nine it cases in order → each case builds a session/outline or calls headingPath directly → asserts equality, non-membership, or frozen state.
 * @version 1
 * @date 2026-09-13
 */

import { describe, expect, it } from 'vitest';
import { DocumentSession, buildOutline, headingPath } from '../src/index.js';

/**
 * Resolve a marker substring in a source document to its ancestor breadcrumb as ordered heading texts.
 *
 * @purpose Locates the first occurrence of a marker and returns the breadcrumb trail of ancestor headings for that offset.
 * @inputs source - The full Markdown source text whose outline is built to resolve the marker; marker - A substring whose position identifies the active section.
 * @outputs string[] - Ordered breadcrumb heading texts, shallowest first; an empty array when no heading precedes the marker.
 * @dataflow source → DocumentSession snapshot → buildOutline entries → indexOf(marker) offset → headingPath(entries, offset) → map .text → returned array.
 * @controlflow Build session and outline → compute marker offset → guard on negative offset (throw) → resolve breadcrumb → map to texts.
 */
function pathAt(source: string, marker: string): string[] {
  const session = new DocumentSession(source);
  const entries = buildOutline(session.snapshot.document);
  const offset = source.indexOf(marker);

  // Guard: if the marker is absent from the source, indexOf returns -1 and there is no valid offset to resolve.
  if (offset < 0) {
    // Marker not found: fail loudly rather than silently resolving a breadcrumb against a negative offset.
    throw new Error(`no marker ${marker}`);
  } else {
    // Marker present: offset holds the character index of its first occurrence; proceed to resolve it.
  }

  return headingPath(entries, offset).map((e) => e.text);
}

describe('headingPath', () => {
  it('reconstructs nested heading levels for deep and mid sections', () => {
    // A section's breadcrumb must chain every ancestor from the top level down to itself.
    const source = '# A\n\n## B\n\n### C\n\nc-body\n\n## D\n\n#### E\n\ne-body\n';
    expect(pathAt(source, 'e-body')).toEqual(['A', 'D', 'E']);
    expect(pathAt(source, 'c-body')).toEqual(['A', 'B', 'C']);
  });

  it('drops a sibling heading from the breadcrumb trail', () => {
    // A section must never include a heading that shares (or exceeds) its own depth.
    const source = '# A\n\n## B\n\n### C\n\nc-body\n\n## D\n\n#### E\n\ne-body\n';
    expect(pathAt(source, 'e-body')).not.toContain('B');
  });

  it('returns an empty path for text above the first heading', () => {
    // Content in a preamble before any heading has no ancestor breadcrumb to report.
    const source = 'intro text\n\n# A\n';
    expect(pathAt(source, 'intro')).toEqual([]);
  });

  it('returns an empty path for an empty outline', () => {
    // With no entries at all there is nothing to resolve against regardless of offset.
    expect(headingPath([], 5)).toEqual([]);
  });

  it('resets the breadcrumb when a shallower heading appears later', () => {
    // A lower-depth heading supersedes deeper ancestors, restarting the trail from its level.
    const source = '## X\n\n# Y\n\n### Z\n\nz-body\n';
    expect(pathAt(source, 'z-body')).toEqual(['Y', 'Z']);
  });

  it('keeps an ancestor across skipped heading levels', () => {
    // Missing intermediate levels must not drop the nearest shallower ancestor.
    const source = '# A\n\n### C\n\nc-body\n';
    expect(pathAt(source, 'c-body')).toEqual(['A', 'C']);
  });

  it('stops the breadcrumb at the top level (h1)', () => {
    // Only the most recent h1 is an ancestor; any earlier h1 must be excluded.
    const source = '# First\n\n# Second\n\n## Inner\n\ninner-body\n';
    expect(pathAt(source, 'inner-body')).toEqual(['Second', 'Inner']);
  });

  it('counts the caret when it sits on the heading line itself', () => {
    // A cursor positioned at a heading's own marker must include that heading in its trail.
    const source = '# A\n\n## B\n';
    const session = new DocumentSession(source);
    const entries = buildOutline(session.snapshot.document);
    expect(headingPath(entries, source.indexOf('## B')).map((e) => e.text)).toEqual(['A', 'B']);
  });

  it('freezes the returned path for both populated and empty results', () => {
    // The breadcrumb array must be immutable so callers cannot mutate shared outline state.
    const source = '# A\n\n## B\n';
    const session = new DocumentSession(source);
    const entries = buildOutline(session.snapshot.document);
    expect(Object.isFrozen(headingPath(entries, source.indexOf('B')))).toBe(true);
    // The offset value is irrelevant when the outline is empty; any positive index exercises the no-match branch.
    expect(Object.isFrozen(headingPath([], 5))).toBe(true);
  });
});