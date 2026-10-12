/**
 * @file structure.spec.ts
 * @purpose Vitest suite for block movement (FR-8.27) and heading level changes (FR-8.28), asserting on the resulting Markdown rather than ProseMirror internals — the house style here.
 * @inputs The DOC fixture, ad-hoc Markdown strings, and the structural Command factories consumed through the table-helpers utilities.
 * @outputs Asserted Markdown strings and boolean applicability results; the suite produces no runtime values beyond its assertions.
 * @functions
 *   - blockLines: Returns the non-blank lines of a Markdown string so tests can assert on block order rather than exact spacing.
 *   - describe/it blocks: Grouped Vitest cases covering topBlockAt, moveBlockUp, moveBlockDown, headingLevelAt, promoteHeading, demoteHeading, and undo coalescing.
 * @dataflow Markdown fixture -> stateFor -> caretAt -> structural command -> captureTr / runToMarkdown -> asserted Markdown or boolean applicability.
 * @controlflow Build a per-case EditorState -> run the command dry-run or to-Markdown -> assert the result -> move on; cases share no mutable state.
 * @version 1
 * @date 2026-09-05
 */

import { describe, expect, it } from 'vitest';
import { topBlockAt, headingLevelAt, moveBlockUp, moveBlockDown, promoteHeading, demoteHeading } from '../src/index.js';
import { stateFor, caretAt, runToMarkdown, captureTr } from './table-helpers.js';

/**
 * @purpose Returns the non-blank lines of a Markdown string so tests can assert on block order rather than exact spacing.
 * @inputs markdown: string - The serialised Markdown whose blank and whitespace-only lines should be dropped.
 * @outputs string[] - An array of non-empty lines in document order.
 * @dataflow markdown -> split('\n') -> filter(trim length > 0) -> returned array of non-blank lines.
 * @controlflow Split on newlines -> drop empty/whitespace-only lines -> return the remaining lines.
 */
function blockLines(markdown: string): string[] {
  // Drop blank and whitespace-only lines so assertions compare block order, not spacing.
  return markdown.split('\n').filter((line) => line.trim().length > 0);
}

/**
 * The document under test across most cases: an H1, a paragraph, an H2, and a list item at the top level.
 */
const DOC = ['# Alpha', '', 'Beta paragraph.', '', '## Gamma', '', '- item one', ''].join('\n');

describe('topBlockAt', () => {
  it('reports index 1 with type paragraph when the caret is in Beta', () => {
    const state = caretAt(stateFor(DOC), 'Beta');
    const block = topBlockAt(state);
    // Guard: this case must resolve to a real top-level block; fail loudly rather than assert on null.
    if (block === null) {
      throw new Error('expected a top block');
    }
    expect(block.index).toBe(1);
    expect(block.node.type.name).toBe('paragraph');
  });

  it('reports index 0 when the caret is in Alpha', () => {
    const state = caretAt(stateFor(DOC), 'Alpha');
    const block = topBlockAt(state);
    // Guard: this case must resolve to a real top-level block; fail loudly rather than assert on null.
    if (block === null) {
      throw new Error('expected a top block');
    }
    expect(block.index).toBe(0);
  });
});

describe('moveBlockUp', () => {
  it('moves the paragraph above the heading when the caret is in Beta', () => {
    const state = caretAt(stateFor(DOC), 'Beta');
    const md = runToMarkdown(state, moveBlockUp());
    const lines = blockLines(md);
    // The paragraph moved above the heading: it now occupies the first line.
    expect(lines[0] ?? '').toBe('Beta paragraph.');
    // And the heading is pushed to second position.
    expect(lines[1] ?? '').toBe('# Alpha');
  });

  it('refuses to move up from the first block, which is correct at the document top', () => {
    const state = caretAt(stateFor(DOC), 'Alpha');
    // Refusing at the boundary is the correct response to "move this up" at the top of a document, not a failure.
    expect(moveBlockUp()(state)).toBe(false);
  });

  it('keeps the caret inside the moved block so repeated Alt+Up works', () => {
    const state = caretAt(stateFor(DOC), 'Beta');
    // Capture the transaction that performs the move rather than running to Markdown.
    const tr = captureTr(state, moveBlockUp());
    // Build the second state by applying the captured transaction rather than re-parsing.
    const movedState = state.apply(tr);
    // A second move up now returns false: this can only happen if the caret travelled with the block to index 0.
    // This is what makes repeated Alt+Up work, which is how the command is actually used.
    expect(moveBlockUp()(movedState)).toBe(false);
  });
});

describe('moveBlockDown', () => {
  it('moves the heading below the paragraph when the caret is in Alpha', () => {
    const state = caretAt(stateFor(DOC), 'Alpha');
    const md = runToMarkdown(state, moveBlockDown());
    const lines = blockLines(md);
    // The paragraph comes first after the swap.
    expect(lines[0] ?? '').toBe('Beta paragraph.');
    // The heading is now second.
    expect(lines[1] ?? '').toBe('# Alpha');
  });

  it('refuses to move down from the last block', () => {
    const state = caretAt(stateFor(DOC), 'item one');
    expect(moveBlockDown()(state)).toBe(false);
  });
});

describe('headingLevelAt', () => {
  it('reports level 1 for a top-level heading (Alpha)', () => {
    const state = caretAt(stateFor(DOC), 'Alpha');
    expect(headingLevelAt(state)).toBe(1);
  });

  it('reports level 2 for the H2 (Gamma)', () => {
    const state = caretAt(stateFor(DOC), 'Gamma');
    expect(headingLevelAt(state)).toBe(2);
  });

  it('reports null when the caret is in a paragraph (Beta)', () => {
    const state = caretAt(stateFor(DOC), 'Beta');
    expect(headingLevelAt(state)).toBeNull();
  });
});

describe('promoteHeading and demoteHeading', () => {
  it('promotes an H2 to an H1 when the caret is in Gamma', () => {
    const state = caretAt(stateFor(DOC), 'Gamma');
    const md = runToMarkdown(state, promoteHeading());
    // Promote moves the number down because it makes the heading more important (H2 -> H1); this direction is the thing most likely to get inverted by a later edit.
    expect(blockLines(md)).toContain('# Gamma');
    expect(blockLines(md)).not.toContain('## Gamma');
  });

  it('demotes an H2 to an H3 when the caret is in Gamma', () => {
    const state = caretAt(stateFor(DOC), 'Gamma');
    const md = runToMarkdown(state, demoteHeading());
    // Anchored to whole lines rather than substrings: '### Gamma' *contains* '## Gamma', so a
    // plain not.toContain would fail on a correct result. Comparing lines is what actually
    // distinguishes an H2 from an H3.
    expect(blockLines(md)).toContain('### Gamma');
    expect(blockLines(md)).not.toContain('## Gamma');
  });

  it('refuses to promote an H1', () => {
    const state = caretAt(stateFor(DOC), 'Alpha');
    expect(promoteHeading()(state)).toBe(false);
  });

  it('refuses to demote an H6', () => {
    const state = caretAt(stateFor('###### Deep\n'), 'Deep');
    expect(demoteHeading()(state)).toBe(false);
  });

  it('both refuse when the caret is in a paragraph', () => {
    const state = caretAt(stateFor(DOC), 'Beta');
    expect(promoteHeading()(state)).toBe(false);
    expect(demoteHeading()(state)).toBe(false);
  });

  it('demoting does not carry the subtree, leaving Gamma at its level', () => {
    const state = caretAt(stateFor(DOC), 'Alpha');
    const md = runToMarkdown(state, demoteHeading());
    // Alpha is demoted H1 -> H2.
    expect(blockLines(md)).toContain('## Alpha');
    // Gamma stays exactly where it was: FR-8.28 calls subtree carrying optional and it is deliberately
    // not implemented, so this test pins the current behaviour rather than asserting the eventual one.
    expect(blockLines(md)).toContain('## Gamma');
    expect(blockLines(md)).not.toContain('### Gamma');
  });
});

describe('undo coalescing', () => {
  it('tags a move-down transaction as structural', () => {
    const state = caretAt(stateFor(DOC), 'Alpha');
    // Without the tag a move would merge into the user's last typing run under undo.
    expect(captureTr(state, moveBlockDown()).getMeta('kdocStructural')).toBe(true);
  });

  it('tags a demote transaction as structural', () => {
    const state = caretAt(stateFor(DOC), 'Gamma');
    // Without the tag a move would merge into the user's last typing run under undo.
    expect(captureTr(state, demoteHeading()).getMeta('kdocStructural')).toBe(true);
  });
});
