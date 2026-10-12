/**
 * @file reference-links.test.ts
 * @purpose Unit tests for the reference-link helper functions used by the ProseMirror markdown parser.
 * @inputs Markdown source strings and synthetic remark AST nodes passed to the helpers under test.
 * @outputs Assertion results from vitest; no runtime values are produced beyond pass/fail.
 * @functions
 *   - collectDefinitions: Verifies first-definition selection for a label.
 *   - definitionText: Verifies serialization of definition nodes back to source lines.
 *   - linkReferenceNode: Verifies reference-type preservation and label omission.
 *   - plainText: Verifies formatting stripping across inline children.
 *   - referenceAttrsOf: Verifies attribute extraction and malformed-input rejection.
 *   - unknownNodeText: Verifies fallback rendering for unhandled node types.
 * @dataflow Markdown source → parseMarkdown → remark AST → helper under test → expected value assertion.
 * @controlflow Describe block groups tests by helper; each it() parses input, invokes one helper, and asserts the result.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@k-doc/core';
import { collectDefinitions, definitionText, linkReferenceNode, plainText, referenceAttrsOf, unknownNodeText } from './reference-links.js';

describe('reference link helpers', () => {
  // Assert the first definition wins when a label is defined more than once.
  it('collects the first definition of a label', () => {
    expect(collectDefinitions(parseMarkdown('[a]: https://one\n[A]: https://two\n').root).get('a')?.url).toBe('https://one');
  });

  // Assert definitions inside blockquotes are still collected.
  it('collects definitions nested in a blockquote', () => {
    expect(collectDefinitions(parseMarkdown('> [q]: https://quoted\n').root).get('q')?.url).toBe('https://quoted');
  });

  // Assert inline formatting is stripped while text content is concatenated.
  it('reads plain text through formatting', () => {
    const paragraph = parseMarkdown('**x** `y` ![z](i.png)\n').root.children[0];
    if (paragraph?.type !== 'paragraph') {
      throw new Error('expected a paragraph');
    } else {
      expect(plainText(paragraph.children)).toBe('x y z');
      expect(plainText([{ type: 'text', value: 'a' }, { type: 'break' }, { type: 'text', value: 'b' }])).toBe('a b');
    }
  });

  // Assert malformed or inconsistent attribute shapes return null.
  it('rejects malformed reference attributes', () => {
    expect(referenceAttrsOf(null)).toBeNull();
    expect(referenceAttrsOf(undefined)).toBeNull();
    expect(referenceAttrsOf({ identifier: 1, label: 'a', referenceType: 'full', text: 'a' })).toBeNull();
    expect(referenceAttrsOf({ identifier: 'a', label: 'a', referenceType: 'full', text: 2 })).toBeNull();
    expect(referenceAttrsOf({ identifier: 'a', label: 'a', referenceType: 'odd', text: 'a' })).toBeNull();
    expect(referenceAttrsOf({ identifier: 'a', label: 3, referenceType: 'full', text: 'a' })).toBeNull();
    expect(referenceAttrsOf({ identifier: 'a', label: null, referenceType: 'full', text: 'a' })?.label).toBeNull();
  });

  // Assert the reference type is retained and only changes when the resolved text differs.
  it('keeps the reference type while the text is unchanged', () => {
    const reference = { identifier: 'a', label: 'A', referenceType: 'shortcut' as const, text: 'A' };
    expect(linkReferenceNode(reference, [{ type: 'text', value: 'A' }]).referenceType).toBe('shortcut');
    expect(linkReferenceNode(reference, [{ type: 'text', value: 'B' }]).referenceType).toBe('full');
    expect(linkReferenceNode({ ...reference, referenceType: 'full' }, [{ type: 'text', value: 'B' }]).referenceType).toBe('full');
  });

  // Assert a null label is omitted from the produced node rather than emitted as undefined.
  it('leaves out a missing label', () => {
    const node = linkReferenceNode({ identifier: 'a', label: null, referenceType: 'full', text: 'x' }, [{ type: 'text', value: 'x' }]);
    expect('label' in node).toBe(false);
  });

  // Assert definitions serialize to their source line and non-definition nodes yield null.
  it('describes a definition as its source line', () => {
    expect(definitionText({ type: 'definition', identifier: '1', label: '1', url: 'https://example.com', title: 'Home' })).toBe('[1]: https://example.com "Home"');
    expect(definitionText({ type: 'definition', identifier: 'id', url: 'u', title: null })).toBe('[id]: u');
    expect(definitionText({ type: 'html', value: 'x' })).toBeNull();
    expect(definitionText({ type: 'image', url: 'u' })).toBeNull();
    expect(definitionText({ type: 'definition', identifier: 'label', label: 'Label', url: 'u' })).toBe('[Label]: u');
    expect(definitionText(null)).toBeNull();
  });

  // Assert raw HTML, definitions, and inline/block placeholders render as expected.
  it('shows raw values, definitions, or a placeholder', () => {
    expect(unknownNodeText({ type: 'html', value: '<b>' }, true)).toBe('<b>');
    expect(unknownNodeText({ type: 'definition', identifier: 'd', label: 'd', url: 'u' }, false)).toBe('[d]: u');
    expect(unknownNodeText({ type: 'footnoteReference' }, true)).toBe('[unrenderable inline]');
    expect(unknownNodeText(null, false)).toBe('[unrenderable block]');
  });
});
