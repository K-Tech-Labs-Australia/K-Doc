/**
 * @file snippet-body.spec.ts
 * @purpose Tests parseSnippetBody's handling of numbered stops, placeholders, date/time expansions, and escaping.
 * @inputs Snippet body strings; a fixed NOW Date used for date/time expansion.
 * @outputs Parsed { text, stops } objects asserted against expected values.
 * @functions (none exported) — vitest describe/it blocks exercising parseSnippetBody.
 * @dataflow Literal snippet string + NOW → parseSnippetBody → parsed result → expect assertions.
 * @controlflow Describe suite runs each it() in order; each asserts text and stops independently.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { parseSnippetBody } from '../src/index.js';

const NOW = new Date(2026, 0, 5, 7, 3);

describe('parseSnippetBody', () => {
  // Braced, bare and default stops are emitted in number order with the implicit final cursor last.
  it('reads braced, bare and default stops in number order with the final cursor last', () => {
    const parsed = parseSnippetBody('a ${2:two} $1 ${3} b', NOW);
    expect(parsed.text).toBe('a two   b');
    expect(parsed.stops).toEqual([
      { index: 1, from: 6, to: 6 },
      { index: 2, from: 2, to: 5 },
      { index: 3, from: 7, to: 7 },
      { index: 0, from: 9, to: 9 },
    ]);
  });

  // An explicit $0 final cursor becomes the sole stop.
  it('uses an explicit final cursor', () => {
    expect(parseSnippetBody('x$0y', NOW).stops).toEqual([{ index: 0, from: 1, to: 1 }]);
    expect(parseSnippetBody('${0:end}', NOW)).toEqual({ text: 'end', stops: [{ index: 0, from: 0, to: 3 }] });
  });

  // A repeated stop number is treated as literal text; only the first occurrence is a real stop.
  it('treats a repeated number as text, keeping the first as the stop', () => {
    const parsed = parseSnippetBody('${1:a} ${1:b} $1', NOW);
    expect(parsed.text).toBe('a b ');
    expect(parsed.stops[0]).toEqual({ index: 1, from: 0, to: 1 });
  });

  // Built-in $DATE and $TIME placeholders expand; an unknown token is left untouched.
  it('fills in the date and time, braced or bare', () => {
    expect(parseSnippetBody('$DATE ${TIME}', NOW).text).toBe('2026-01-05 07:03');
    expect(parseSnippetBody('$DATEX', NOW).text).toBe('$DATEX');
  });

  // Escaped dollars and unrecognised placeholders are preserved literally.
  it('keeps escaped and unrecognised dollars literally', () => {
    expect(parseSnippetBody('cost \\$5 and $name and ${x}', NOW).text).toBe('cost $5 and $name and ${x}');
  });

  // With no explicit stop, the cursor ends at the end of the expanded text.
  it('ends the cursor after the text when there is no final stop', () => {
    expect(parseSnippetBody('plain', NOW)).toEqual({ text: 'plain', stops: [{ index: 0, from: 5, to: 5 }] });
  });
});
