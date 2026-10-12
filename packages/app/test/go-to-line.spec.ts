/**
 * @file go-to-line.spec.ts
 * @purpose Exercises parseLineTarget and lineTargetOffset from src/shell/go-to-line.ts, covering valid targets, clamping, rejection of malformed input, and offset math including CRLF handling.
 * @inputs No runtime inputs; the spec supplies literal source strings and LineTarget objects to the functions under test.
 * @outputs Assertions on the returned LineTarget or zero-based character offset for each scenario.
 * @functions
 *   - parseLineTarget tests: validate normalization, clamping, and rejection of invalid input.
 *   - lineTargetOffset tests: verify newline walking, column clamping, CRLF trimming, and end-of-document behavior.
 * @dataflow Literal test fixtures → functions under test → expect() assertions; failures surface as Vitest assertion errors.
 * @controlflow describe blocks group related cases; each it runs independently against fresh literals; it.each drives the rejection matrix.
 * @version 1
 * @date 2026-09-13
 */

import { describe, expect, it } from 'vitest';
import { parseLineTarget, lineTargetOffset } from '../src/shell/go-to-line.js';

describe('parseLineTarget', () => {
  // A bare line number defaults to column 1 within a document wide enough to contain it.
  it('parses a bare line as the first column', () => {
    expect(parseLineTarget('12', 40)).toEqual({ line: 12, column: 1 });
  });

  // A leading colon is optional and parsed identically to a bare line reference.
  it('accepts a leading colon before the line number', () => {
    expect(parseLineTarget(':7', 40)).toEqual({ line: 7, column: 1 });
  });

  // Surrounding whitespace is trimmed so " 3:5 " matches "3:5" exactly.
  it('ignores surrounding whitespace around line and column', () => {
    expect(parseLineTarget(' 3:5 ', 40)).toEqual({ line: 3, column: 5 });
  });

  // A request past the end of the document clamps to the last line.
  it('clamps a line beyond the document length to the last line', () => {
    expect(parseLineTarget('99', 10)).toEqual({ line: 10, column: 1 });
  });

  // Every malformed input must be rejected with null rather than a partial target.
  it.each([
    '0', // zero is not a valid 1-based line number
    '', // empty string has no digits to match
    '   ', // whitespace-only trims to nothing and fails the regex
    'abc', // non-numeric characters do not match the digit groups
    '3:', // trailing colon with no column group is incomplete
    '3:0', // zero column is invalid because columns are 1-based
    '-2', // negative sign is rejected by the digit-only pattern
    '1.5', // a decimal point breaks the integer line match
    '2:3:4', // a second colon produces an unstructured reference
    '12a', // trailing letters fail the anchored end-of-string anchor
  ])('rejects invalid input %j', (input) => {
    expect(parseLineTarget(input, 40)).toBeNull();
  });

  // An empty document still exposes a single logical line to jump to.
  it('maps any line onto a single-line empty document', () => {
    expect(parseLineTarget('5', 0)).toEqual({ line: 1, column: 1 });
  });
});

describe('lineTargetOffset', () => {
  // The first character of a middle line sits after its preceding newline.
  it('locates the start of a middle line', () => {
    expect(lineTargetOffset('a\nbcd\ne', { line: 2, column: 1 })).toBe(2);
  });

  // A column inside the line advances the offset by (column - 1) from the line start.
  it('advances within a line for an interior column', () => {
    expect(lineTargetOffset('a\nbcd\ne', { line: 2, column: 3 })).toBe(4);
  });

  // A column past the end of the line clamps to the line's last character, never spilling onto the next line.
  it('clamps an over-long column to the current line end', () => {
    expect(lineTargetOffset('a\nbcd\ne', { line: 2, column: 99 })).toBe(5);
  });

  // The first line starts at offset 0, so its second character is offset 1.
  it('handles a column on the first line from the document origin', () => {
    expect(lineTargetOffset('abc\ndef', { line: 1, column: 2 })).toBe(1);
  });

  // A line beyond the document clamps to the last line's start offset.
  it('clamps a line past the end to the last line start', () => {
    expect(lineTargetOffset('a\nbcd\ne', { line: 9, column: 1 })).toBe(6);
  });

  // CRLF files must never place the caret between the carriage return and the newline.
  it('keeps the caret off the carriage return on a CRLF first line', () => {
    expect(lineTargetOffset('ab\r\ncd', { line: 1, column: 9 })).toBe(2);
  });

  // On a CRLF file the second line begins immediately after the \r\n pair.
  it('lands on the start of a CRLF second line after the newline pair', () => {
    expect(lineTargetOffset('ab\r\ncd', { line: 2, column: 1 })).toBe(4);
  });

  // A trailing empty logical line still resolves to the offset just past the final newline.
  it('resolves a target on an empty trailing line at the last newline', () => {
    expect(lineTargetOffset('a\n', { line: 2, column: 5 })).toBe(2);
  });
});