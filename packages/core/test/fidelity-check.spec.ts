/**
 * @file fidelity-check.spec.ts
 * @purpose Verifies that the Fidelity Check (FR-4.5) reports every span whose content is unchanged but whose bytes changed — entire blocks and the blank gaps between them — and nothing else, excluding spans the user edited as text and blocks whose content changed.
 * @inputs Base and current document texts plus the offset ranges the user edited; expected finding records for each scenario.
 * @outputs Test assertions that pass when checkFidelity returns exactly the expected findings, or fail otherwise.
 * @functions
 *   - describe: Groups every Fidelity Check scenario under a single suite.
 *   - it: Runs one scenario and asserts its findings against expectations.
 *   - checkFidelity: The production function under test, invoked within each scenario.
 * @dataflow Literal text constants -> checkFidelity -> readonly FidelityFinding[] -> expect assertions.
 * @controlflow For each scenario: call checkFidelity with base/current/touched inputs, then assert the returned findings equal or match the expected shape.
 * @version 1
 * @date 2026-09-14
 */

import { describe, expect, it } from 'vitest';
import { checkFidelity } from '../src/fidelity/fidelity-check.js';

// Base document: a two-item bullet list using asterisks followed by a paragraph.
const BULLETS_STAR = '* a\n* b\n\nText\n';
// Current document: identical content but with hyphen bullets, so only the bytes changed.
const BULLETS_DASH = '- a\n- b\n\nText\n';

describe('checkFidelity', () => {
  // Identical texts have no changes, so there is nothing to report.
  it('reports nothing for identical texts', () => {
    expect(checkFidelity(BULLETS_STAR, BULLETS_STAR, [])).toEqual([]);
  });

  // The list block keeps its content but its bullet bytes changed, so it is reported.
  it('reports a block whose content is unchanged but whose bytes changed', () => {
    expect(checkFidelity(BULLETS_STAR, BULLETS_DASH, [])).toEqual([
      { kind: 'block', nodeType: 'list', from: 0, to: 7, baseFrom: 0, baseTo: 7, before: '* a\n* b', after: '- a\n- b' },
    ]);
  });

  // A span the user edited as text must be excluded from findings.
  it('does not report a span the user edited as text', () => {
    expect(checkFidelity(BULLETS_STAR, BULLETS_DASH, [{ start: 0, end: 1 }])).toEqual([]);
  });

  // An edit that ends exactly where the span ends still counts as touching it.
  it('treats an edit ending where the span ends as touching it', () => {
    expect(checkFidelity(BULLETS_STAR, BULLETS_DASH, [{ start: 7, end: 7 }])).toEqual([]);
  });

  // A later edit that does not overlap the block is ignored for touch purposes.
  it('does not treat a later edit as touching it', () => {
    const touched = [{ start: 8, end: 9 }];
    expect(checkFidelity(BULLETS_STAR, BULLETS_DASH, touched)).toHaveLength(1);
  });

  // A block whose content changed is not judged for formatting-only edits.
  it('does not judge a block whose content changed', () => {
    expect(checkFidelity('*One* two\n\nKeep\n', '_One_ three\n\nKeep\n', [])).toEqual([]);
  });

  // An appended block does not affect the untouched original blocks.
  it('does not report an added block', () => {
    expect(checkFidelity('# A\n\nOne.\n', '# A\n\nOne.\n\nTwo.\n', [])).toEqual([]);
  });

  // Blank space between two unedited blocks is reported when its bytes change.
  it('reports changed blank space between two unedited blocks', () => {
    expect(checkFidelity('One.\n\n\nTwo.\n', 'One.\n\nTwo.\n', [])).toEqual([
      { kind: 'gap', nodeType: 'gap', from: 4, to: 6, baseFrom: 4, baseTo: 7, before: '\n\n\n', after: '\n\n' },
    ]);
  });

  // A removed trailing newline is reported as a changed gap at the document end.
  it('reports a changed trailing newline', () => {
    const found = checkFidelity('# A\n', '# A', []);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('gap');
    expect(found[0]?.before).toBe('\n');
    expect(found[0]?.after).toBe('');
    expect(found[0]?.from).toBe(3);
  });

  // A removed leading newline is reported as a changed gap at the document start.
  it('reports changed leading space', () => {
    const found = checkFidelity('\n# A\n', '# A\n', []);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('gap');
    expect(found[0]?.from).toBe(0);
    expect(found[0]?.to).toBe(0);
    expect(found[0]?.before).toBe('\n');
  });

  // CRLF-to-LF changes between unedited blocks are reported as a gap.
  it('reports line endings changed between unedited blocks', () => {
    const found = checkFidelity('# A\r\n\r\nOne.\r\n', '# A\n\nOne.\r\n', []);
    expect(found.map((f) => f.kind)).toEqual(['gap']);
    expect(found[0]?.before).toBe('\r\n\r\n');
    expect(found[0]?.after).toBe('\n\n');
  });

  // Findings are ordered by their position in the current text.
  it('returns findings in document order', () => {
    const found = checkFidelity('* a\n\n\nPara\n', '- a\n\nPara\n', []);
    expect(found.map((f) => f.kind)).toEqual(['block', 'gap']);
    // Guard against an absent second finding by defaulting the upper bound to -1.
    expect(found[0]?.from).toBeLessThan(found[1]?.from ?? -1);
  });

  // An unedited block is left alone when an earlier block was edited.
  it('leaves an unedited block alone when an earlier one was edited', () => {
    expect(checkFidelity('Edit me.\n\n* keep\n', 'Edited.\n\n* keep\n', [])).toEqual([]);
  });

  // A new block inserted at the document start does not flag the original leading space.
  it('does not report the space before a block inserted at the start', () => {
    expect(checkFidelity('Keep.\n', 'New.\n\nKeep.\n', [])).toEqual([]);
  });

  // Removing the first block leaves no finding for the space that preceded it.
  it('does not report the space before a block removed from the start', () => {
    expect(checkFidelity('Old.\n\nKeep.\n', 'Keep.\n', [])).toEqual([]);
  });

  // Inserting or removing an interior block does not flag the surrounding gaps.
  it('does not report the space around a block inserted between unedited blocks', () => {
    expect(checkFidelity('One.\n\nTwo.\n', 'One.\n\nNew.\n\nTwo.\n', [])).toEqual([]);
    expect(checkFidelity('One.\n\nOld.\n\nTwo.\n', 'One.\n\nTwo.\n', [])).toEqual([]);
  });

  // A changed leading gap is ordered before the block it precedes.
  it('orders a changed leading space before the block after it', () => {
    const found = checkFidelity('\n\n* a\n', '\n- a\n', []);
    expect(found.map((f) => f.kind)).toEqual(['gap', 'block']);
  });

  // An unedited list item beside an edited one is reported as its own rewritten span.
  it('reports an unedited list item rewritten beside an edited one', () => {
    expect(checkFidelity('* one\n* two\n', '- one!\n- two\n', [])).toEqual([{ kind: 'block', nodeType: 'listItem', from: 7, to: 12, baseFrom: 6, baseTo: 11, before: '* two', after: '- two' }]);
  });

  // List items that kept their exact bytes are not reported.
  it('does not report list items that kept their bytes', () => {
    expect(checkFidelity('- one\n- two\n', '- one!\n- two\n', [])).toEqual([]);
  });

  // A paragraph whose content changed only in emphasis inside an edited blockquote is still reported.
  it('reports an unedited paragraph rewritten inside an edited blockquote', () => {
    const found = checkFidelity('> One.\n>\n> *Two*.\n', '> One!\n>\n> _Two_.\n', []);
    expect(found.map((f) => f.nodeType)).toEqual(['paragraph']);
    expect(found[0]?.after).toBe('_Two_.');
  });

  // Table columns realigned by design are not flagged as fidelity changes.
  it('does not enter a table, whose columns are realigned by design', () => {
    expect(checkFidelity('| a | b |\n|---|---|\n| 1 | 2 |\n', '| a     | b |\n| ----- | - |\n| 10000 | 2 |\n', [])).toEqual([]);
  });

  // A container whose type changed (list to blockquote) is not entered for item-level findings.
  it('does not enter a container whose type changed', () => {
    expect(checkFidelity('* one\n* two\n', '> one!\n>\n> two\n', [])).toEqual([]);
  });

  // An unedited paragraph rewritten inside an edited list item is reported as its own span.
  it('reports an unedited paragraph rewritten inside an edited list item', () => {
    const found = checkFidelity('- one\n\n  *keep*\n', '- one!\n\n  _keep_\n', []);
    expect(found.map((f) => f.nodeType)).toEqual(['paragraph']);
    expect(found[0]?.after).toBe('_keep_');
  });

  // A list is not entered when the base text replaced more than one block.
  it('does not enter a list when the base replaced more than one block', () => {
    expect(checkFidelity('* one\n* two\n\nA.\n', '- one!\n- two\n', [])).toEqual([]);
  });

  // A list is not entered when the current text replaced more than one block.
  it('does not enter a list when the current text replaced more than one block', () => {
    expect(checkFidelity('* one\n* two\n', '- one!\n- two\n\nB.\n', [])).toEqual([]);
  });

  // A list is not paired with a quote, so no item-level findings are produced.
  it('does not pair a list with a quote', () => {
    expect(checkFidelity('* *x*\n', '> > _x_\n', [])).toEqual([]);
  });

  // The interior space of a container is measured from the container's own offsets, not the document.
  it('measures the space inside a container from the container, not the document', () => {
    expect(checkFidelity('Intro.\n\n* keep\n\n  old\n', 'Intro.\n\n- keep\n\n  new\n', [])).toEqual([{ kind: 'gap', nodeType: 'gap', from: 8, to: 10, baseFrom: 8, baseTo: 10, before: '* ', after: '- ' }]);
  });
});
