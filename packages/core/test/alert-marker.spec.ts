/**
 * @file alert-marker.spec.ts
 * @purpose Vitest test suite pinning the GitHub-alert escape fix (FR-8.5). This defect was found
 *   by running the editor and reading the Source pane, not by a test: the callout rendered correctly
 *   in K-Doc while the file on disk said `> \[!NOTE]`, which GitHub and Obsidian both render as
 *   literal text. These cases exist so that cannot come back.
 * @inputs Markdown source strings with alert callouts and edge cases, synthetic mdast AST nodes.
 * @outputs Vitest test execution assertions validating Markdown round-trip serialization and
 *   isAlertMarkerParagraph AST predicate behavior.
 * @functions
 *   - roundTrip: Parses Markdown source text and serializes it back to ensure byte-identity and semantic preservation.
 *   - textPara: Constructs a synthetic mdast Paragraph node containing a single Text child.
 *   - quoteOf: Constructs a synthetic mdast Blockquote node containing the specified Paragraph children.
 * @dataflow Markdown text -> parseMarkdown -> serializeDocument -> string assertions; synthetic mdast nodes -> alertMarkerOf -> marker-or-null assertions.
 * @controlflow Run round-trip preservation tests -> run narrow exception tests -> run direct alertMarkerOf tests.
 * @version 1
 * @date 2026-09-11
 */

import type { Blockquote, Link, Paragraph, Parents, Text } from 'mdast';
import { describe, expect, it } from 'vitest';
import { parseMarkdown, serializeDocument } from '../src/index.js';
import {
  ALERT_MARKER_PATTERN,
  alertMarkerOf,
} from '../src/serialize/alert-marker.js';

/**
 * Parses Markdown source text and serializes it straight back into Markdown.
 *
 * This is the property the whole editor rests on: the bytes that come out
 * have to be Markdown that means what the bytes going in meant.
 *
 * @purpose Parses Markdown source to AST and serializes it directly back to string.
 * @inputs source - The raw Markdown source text string to round-trip.
 * @outputs string - The serialized Markdown output string.
 * @dataflow source string -> parseMarkdown -> KdocDocument AST -> serializeDocument -> serialized Markdown string.
 * @controlflow Parse input Markdown text into KdocDocument AST; serialize AST back to formatted Markdown text and return.
 */
function roundTrip(source: string): string {
  const doc = parseMarkdown(source);
  return serializeDocument(doc);
}

/**
 * Constructs a synthetic mdast Paragraph node containing a single Text child.
 *
 * @purpose Creates a synthetic Paragraph AST node with a single text node child for isolated testing.
 * @inputs value - The text content string for the inner Text node.
 * @outputs Paragraph - A synthetic mdast Paragraph node containing the text node.
 * @dataflow value string -> Text child node -> Paragraph parent node.
 * @controlflow Wrap string value in a Text node; construct and return a Paragraph node containing the Text node.
 */
function textPara(value: string): Paragraph {
  const textNode: Text = {
    type: 'text',
    value,
  };
  return {
    type: 'paragraph',
    children: [textNode],
  };
}

/**
 * Constructs a synthetic mdast Blockquote node containing the specified Paragraph children.
 *
 * @purpose Creates a synthetic Blockquote AST node containing the provided Paragraph children.
 * @inputs children - Variadic list of Paragraph nodes to include as children of the blockquote.
 * @outputs Blockquote - A synthetic mdast Blockquote node containing the paragraph children.
 * @dataflow children array -> Blockquote node with shallow-copied children array.
 * @controlflow Construct Blockquote node with type 'blockquote' and shallow copy of children; return Blockquote.
 */
function quoteOf(...children: readonly Paragraph[]): Blockquote {
  return {
    type: 'blockquote',
    children: [...children],
  };
}

describe('an alert marker survives a round trip', () => {
  it('preserves every alert kind without escaping', () => {
    const kinds: readonly string[] = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'];
    for (const kind of kinds) {
      const source = `> [!${kind}]\n> body\n`;
      const output = roundTrip(source);
      const expectedNeedle = `> [!${kind}]`;
      const escapedNeedle = `\\[!${kind}]`;

      expect(output).toContain(expectedNeedle);
      expect(output).not.toContain(escapedNeedle);
      // The marker and the body share one paragraph in this shape, so emitting the marker means
      // taking it off the front of a text node -- and everything after it has to survive that.
      expect(output).toContain('body');
    }
  });

  it('does not emit a backslash in the alert marker', () => {
    const output = roundTrip('> [!NOTE]\n> body\n');
    // A single '\' before the '[' is the whole defect, and the rendered result
    // on GitHub is plain text where an alert was meant.
    expect(output).not.toContain('\\');
  });

  it('remains stable across a second round trip', () => {
    const src = '> [!NOTE]\n> body\n';
    const firstPass = roundTrip(src);
    const secondPass = roundTrip(firstPass);
    // An unescaped emission that the parser then re-escapes would still be a bug,
    // just a slower one.
    expect(secondPass).toBe(firstPass);
  });
});

describe('the exception stays narrow', () => {
  it('keeps the escape on a bare paragraph that reads like a marker', () => {
    const output = roundTrip('[!NOTE]\n');
    // Outside a quote it is prose, and prose keeps the escape that makes it round-trip.
    expect(output).toContain('\\[!NOTE]');
  });

  it('keeps the escape on a marker that is not the first line', () => {
    const output = roundTrip('> body\n> [!NOTE]\n');
    // GitHub only reads the opening line as an alert.
    expect(output).toContain('\\[!NOTE]');
  });

  it('keeps the escape on a marker in a later block of the quote', () => {
    // A blank quote line ends the paragraph, so this marker really is its own block -- and the only
    // thing that rejects it is that it is not the quote's *first* block, which is where GitHub looks.
    const output = roundTrip('> body\n>\n> [!NOTE]\n');
    expect(output).toContain('\\[!NOTE]');
  });

  it('treats a marker with more on the line as prose and escapes it', () => {
    const output = roundTrip('> [!NOTE] and more\n');
    // The paragraph has more than one inline child, which is what the check tests.
    expect(output).toContain('\\');
  });

  it('emits an unknown alert word unescaped because it matches the alert marker shape', () => {
    const output = roundTrip('> [!QUESTION]\n');
    // The serializer asks only whether the line has the shape of an alert,
    // because a word K-Doc does not colour is still a word some other reader might,
    // and re-escaping it would change somebody else's document.
    expect(output).toContain('> [!QUESTION]');
    expect(output).not.toContain('\\[!QUESTION]');
  });
});

describe('alertMarkerOf', () => {
  it('returns true for the first paragraph of a quote', () => {
    const firstPara = textPara('[!NOTE]');
    const bodyPara = textPara('body');
    const quote = quoteOf(firstPara, bodyPara);

    const firstChild = quote.children[0];
    // Guard the index-0 read against undefined and verify it is a Paragraph for strict typing under noUncheckedIndexedAccess.
    if (firstChild === undefined || firstChild.type !== 'paragraph') {
      // Child is missing or not a paragraph: fail loudly rather than proceed with invalid test data.
      throw new Error('expected quote.children[0] to be a Paragraph');
    } else {
      // Child is a Paragraph: assert that alertMarkerOf returns the marker it opens with.
      expect(alertMarkerOf(firstChild, quote)).toBe('[!NOTE]');
    }
  });

  it('returns false with no parent', () => {
    const para = textPara('[!NOTE]');
    expect(alertMarkerOf(para, undefined)).toBeNull();
  });

  it('returns false when the parent is not a blockquote', () => {
    const para = textPara('[!NOTE]');
    const rootParent: Parents = {
      type: 'root',
      children: [para],
    };
    expect(alertMarkerOf(para, rootParent)).toBeNull();
  });

  it('returns false for the second paragraph of a quote', () => {
    const firstPara = textPara('[!NOTE]');
    const secondPara = textPara('body');
    const quote = quoteOf(firstPara, secondPara);

    const secondChild = quote.children[1];
    // Guard the index-1 read against undefined and verify it is a Paragraph for strict typing under noUncheckedIndexedAccess.
    if (secondChild === undefined || secondChild.type !== 'paragraph') {
      // Child is missing or not a paragraph: fail loudly rather than proceed with invalid test data.
      throw new Error('expected quote.children[1] to be a Paragraph');
    } else {
      // Child is a Paragraph: assert that alertMarkerOf rejects it as not the first child.
      expect(alertMarkerOf(secondChild, quote)).toBeNull();
    }
  });

  it('returns null when the paragraph opens with something other than text', () => {
    // A marker is literal text. A paragraph whose first inline child is a link begins with markup,
    // and reading a marker out of the link's own text would unescape somebody else's prose.
    const link: Link = {
      type: 'link',
      url: 'x',
      title: null,
      children: [{ type: 'text', value: '[!NOTE]' }],
    };
    const para: Paragraph = { type: 'paragraph', children: [link] };
    const quote = quoteOf(para);
    expect(alertMarkerOf(para, quote)).toBeNull();
  });

  it('returns false for an empty paragraph', () => {
    const emptyPara: Paragraph = {
      type: 'paragraph',
      children: [],
    };
    const quote = quoteOf(emptyPara);
    expect(alertMarkerOf(emptyPara, quote)).toBeNull();
  });

  it('verifies that the pattern is not global and evaluates reliably', () => {
    expect(ALERT_MARKER_PATTERN.global).toBe(false);

    // A global regexp keeps lastIndex between calls, so the second test would fail
    // and the bug would look like every other callout being broken.
    expect(ALERT_MARKER_PATTERN.test('[!NOTE]')).toBe(true);
    expect(ALERT_MARKER_PATTERN.test('[!NOTE]')).toBe(true);
  });
});
