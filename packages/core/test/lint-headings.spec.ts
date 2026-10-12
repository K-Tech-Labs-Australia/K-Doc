/**
 * @file lint-headings.spec.ts
 * @purpose Tests for heading-level outline skips (FR-12.7) and duplicate top-level headings, covering finding shapes, quick fixes, and edge cases.
 * @inputs Parsed KdocDocument fixtures produced by parseMarkdown; original source text used to verify applyLintEdits output.
 * @outputs LintFinding[] assertions from headingSkips and duplicateHeadings; fixed-source strings after applying edits.
 * @functions
 *   - describe: Groups tests under the headingSkips and duplicateHeadings suites.
 *   - it: Asserts a single behavior of a heading rule against a parsed fixture.
 * @dataflow parseMarkdown source → KdocDocument → heading rules → LintFinding[] → expect assertions; applyLintEdits rewrites text for fix verification.
 * @controlflow For each suite, run each it in order asserting findings or fixed output; throw on unexpected undefined/fixable state.
 * @version 1
 * @date 2026-09-14
 */

import { describe, expect, it } from 'vitest';
import { duplicateHeadings, headingSkips } from '../src/lint/heading-rules.js';
import { applyLintEdits } from '../src/lint/lint-finding.js';
import { parseMarkdown } from '../src/parse/parser.js';

describe('headingSkips', () => {
  it('reports a skipped level with a fix to the next level', () => {
    // A single H1→H3 jump must produce one finding whose fix downgrades H3 to H2.
    expect(headingSkips(parseMarkdown('# A\n\n### C\n'))).toEqual([{ rule: 'heading-skip', label: 'C', message: 'Heading level jumps from H1 to H3', from: 5, to: 10, fix: { label: 'Make it H2', edits: [{ from: 5, to: 8, insert: '##' }] } }]);
  });

  it('leaves nothing to report once the fix is applied', () => {
    // Apply the quick fix and confirm the re-parsed document no longer reports a skip.
    const text = '# A\n\n### C\n';
    const [finding] = headingSkips(parseMarkdown(text));
    if (finding === undefined || finding.fix === null) throw new Error('expected a fixable finding');
    const fixed = applyLintEdits(text, finding.fix.edits);
    expect(fixed).toBe('# A\n\n## C\n');
    expect(headingSkips(parseMarkdown(fixed))).toEqual([]);
  });

  it('offers the next level down from the previous heading, however far it jumped', () => {
    // An H1 followed by an H4 is fixed to H2, the level after the H1, not to H3.
    const [finding] = headingSkips(parseMarkdown('# A\n\n#### D\n'));
    expect(finding?.fix).toEqual({ label: 'Make it H2', edits: [{ from: 5, to: 9, insert: '##' }] });
  });

  it('measures each heading against the one before it', () => {
    // Only B (H4 after H2) skips a level; D (H3 after H2) does not.
    const found = headingSkips(parseMarkdown('## A\n\n#### B\n\n## C\n\n### D\n'));
    expect(found.map((f) => f.label)).toEqual(['B']);
  });

  it('does not report a document that starts below H1', () => {
    // With no prior level, the first heading cannot be judged as a skip.
    expect(headingSkips(parseMarkdown('### Start\n\n#### Next\n'))).toEqual([]);
  });

  it('changes only the hashes of an indented heading', () => {
    // The fix must rewrite just the hash run, preserving leading indentation.
    const [finding] = headingSkips(parseMarkdown('# A\n\n   ### C\n'));
    expect(finding?.fix?.edits).toEqual([{ from: 8, to: 11, insert: '##' }]);
  });

  it('ignores headings nested in a quote', () => {
    // Quoted content is not a top-level child, so its heading is skipped.
    expect(headingSkips(parseMarkdown('# A\n\n> ### Q\n'))).toEqual([]);
  });

  it('labels an empty heading', () => {
    // An empty H3 after H1 still reports the skip with a placeholder label.
    expect(headingSkips(parseMarkdown('# A\n\n###\n'))[0]?.label).toBe('(empty heading)');
  });
});

describe('duplicateHeadings', () => {
  it('reports a repeat with the line of the first', () => {
    // Case-insensitive match against an earlier H1 reports its original line.
    expect(duplicateHeadings(parseMarkdown('# Setup\n\ntext\n\n## setup\n'))).toEqual([{ rule: 'duplicate-heading', label: 'setup', message: 'Same heading as line 1', from: 15, to: 23, fix: null }]);
  });

  it('ignores case and spacing', () => {
    // Normalised text collapses extra spaces and case differences into one duplicate.
    expect(duplicateHeadings(parseMarkdown('# A  b\n\n# a b\n'))).toHaveLength(1);
  });

  it('reports every repeat against the first', () => {
    // Each subsequent identical heading references the original line number.
    const found = duplicateHeadings(parseMarkdown('# X\n\n# X\n\n# X\n'));
    expect(found.map((f) => f.message)).toEqual(['Same heading as line 1', 'Same heading as line 1']);
  });

  it('does not treat empty headings as duplicates', () => {
    // Empty titles are excluded from duplicate tracking.
    expect(duplicateHeadings(parseMarkdown('#\n\n#\n'))).toEqual([]);
  });

  it('does not report different headings', () => {
    // Distinct texts never collide in the seen map.
    expect(duplicateHeadings(parseMarkdown('# A\n\n# B\n'))).toEqual([]);
  });
});
