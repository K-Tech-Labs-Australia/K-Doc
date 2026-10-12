/**
 * @file reference-links.spec.ts
 * @purpose Verifies conversion of inline Markdown links to reference-style definitions, definition parsing, and deduplication semantics.
 * @inputs Parsed Markdown documents produced by parseMarkdown; source strings containing inline links and reference definitions.
 * @outputs Assertion results from vitest comparing convertToReferenceLinks/linkDefinitions output against expected text and metadata.
 * @functions
 *   - convertToReferenceLinks: Converts inline link syntax to reference-style labels and appends a deduplicated definition block.
 *   - linkDefinitions: Parses reference definitions, counting uses and flagging duplicates with source ranges.
 *   - parseMarkdown: Tokenizes/parses raw Markdown into an AST consumed by the functions under test.
 * @dataflow Raw Markdown string → parseMarkdown AST → convertToReferenceLinks/linkDefinitions → expected text/metadata assertions.
 * @controlflow describe groups each function; it() runs one scenario, invokes a function on sample input, and asserts equality.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { convertToReferenceLinks, linkDefinitions, parseMarkdown } from '../src/index.js';

describe('convertToReferenceLinks', () => {
  // Verifies that new destinations receive sequential numeric labels and repeated destinations reuse an existing label.
  it('numbers new definitions and reuses one per destination', () => {
    const result = convertToReferenceLinks(parseMarkdown('See [a](https://a.example) and [b](https://b.example "B").\n\nAgain [a again](https://a.example).\n'));
    expect(result.text).toBe('See [a][1] and [b][2].\n\nAgain [a again][1].\n\n[1]: https://a.example\n[2]: https://b.example "B"\n');
    expect(result.converted).toBe(3);
  });

  // Confirms inline links already using a reference label are left untouched while new ones extend the trailing definition block.
  it('skips labels already defined and extends a trailing definition block', () => {
    const result = convertToReferenceLinks(parseMarkdown('Use [x](https://x.example) and [y][1].\n\n[1]: https://y.example\n'));
    expect(result.text).toBe('Use [x][2] and [y][1].\n\n[1]: https://y.example\n[2]: https://x.example\n');
    expect(result.converted).toBe(1);
  });

  // Checks that a link pointing at an already-defined destination reuses that label instead of creating a duplicate.
  it('reuses an existing definition for the same destination', () => {
    const result = convertToReferenceLinks(parseMarkdown('Go [here](https://y.example).\n\n[Why]: https://y.example\n'));
    expect(result.text).toBe('Go [here][Why].\n\n[Why]: https://y.example\n');
  });

  // Ensures links with identical URLs but differing titles are treated as distinct destinations.
  it('treats a different title as a different destination', () => {
    const result = convertToReferenceLinks(parseMarkdown('Go [here](https://y.example "T").\n\n[y]: https://y.example\n'));
    expect(result.text).toBe('Go [here][1].\n\n[y]: https://y.example\n[1]: https://y.example "T"\n');
  });

  // Validates that inline markup within link text is preserved when converting to reference form.
  it('keeps the link text and its formatting', () => {
    const result = convertToReferenceLinks(parseMarkdown('A [**bold** `code`](https://c.example) link.\n'));
    expect(result.text).toBe('A [**bold** `code`][1] link.\n\n[1]: https://c.example\n');
  });

  // Confirms autolinks, bare URLs, and empty links are not converted.
  it('leaves autolinks, bare URLs and empty links alone', () => {
    const text = 'Visit <https://auto.example> or https://bare.example or [](https://empty.example).\n';
    expect(convertToReferenceLinks(parseMarkdown(text))).toEqual({ text, converted: 0 });
  });

  // Verifies that titles containing quotes and destinations with spaces are escaped so re-parsing round-trips them.
  it('writes titles with quotes and destinations with spaces so they parse back', () => {
    const result = convertToReferenceLinks(parseMarkdown('[q](<https://s.example/a b> "say \\"hi\\"")\n'));
    expect(result.text).toBe('[q][1]\n\n[1]: <https://s.example/a b> "say \\"hi\\""\n');
    const reparsed = linkDefinitions(parseMarkdown(result.text))[0];
    expect(reparsed?.url).toBe('https://s.example/a b');
    expect(reparsed?.title).toBe('say "hi"');
  });

  // Ensures definitions are appended correctly even when the source lacks a trailing newline.
  it('writes an empty destination in angle brackets', () => {
    expect(convertToReferenceLinks(parseMarkdown('[x]()\n')).text).toBe('[x][1]\n\n[1]: <>\n');
  });

  it('reuses the first of two definitions for the same destination', () => {
    expect(convertToReferenceLinks(parseMarkdown('[go](https://y)\n\n[a]: https://y\n[b]: https://y\n')).text).toBe('[go][a]\n\n[a]: https://y\n[b]: https://y\n');
  });

  it('adds definitions after a document with no trailing newline', () => {
    expect(convertToReferenceLinks(parseMarkdown('[a](https://a.example)')).text).toBe('[a][1]\n\n[1]: https://a.example\n');
  });
});

describe('linkDefinitions', () => {
  const text = 'A [x][one] [y][one] ![z][two]\n\n[one]: https://one\n[two]: https://two "T"\n[one]: https://dup\n[three]: https://three\n';

  // Confirms each definition is reported with its label, URL, title, use count, and duplicate flag.
  it('lists every definition with its uses', () => {
    const entries = linkDefinitions(parseMarkdown(text));
    expect(entries.map((entry) => [entry.label, entry.url, entry.title, entry.uses, entry.duplicate])).toEqual([
      ['one', 'https://one', null, 2, false],
      ['two', 'https://two', 'T', 1, false],
      ['one', 'https://dup', null, 2, true],
      ['three', 'https://three', null, 0, false],
    ]);
  });

  // Verifies that definitions expose their start and end offsets in the source text.
  it('gives each definition its source range', () => {
    const first = linkDefinitions(parseMarkdown(text))[0];
    expect(first?.start).toBe(text.indexOf('[one]: https://one'));
    expect(text.slice(first?.start, first?.end)).toBe('[one]: https://one');
  });

  // Checks that labels are preserved exactly as authored, including internal spaces.
  it('keeps the label as written', () => {
    expect(linkDefinitions(parseMarkdown('[My Label]: https://m\n'))[0]?.label).toBe('My Label');
  });
});
