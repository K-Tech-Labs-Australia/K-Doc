/**
 * @file incremental.spec.ts
 * @purpose Vitest test suite for the incremental serializer of @k-doc/core verifying requirement FR-4.2 (untouched byte ranges pass through unchanged).
 * @inputs Source Markdown strings, KdocDocument instances, mutated mdast Root trees, and synthetic AST nodes.
 * @outputs Vitest test assertions validating IncrementalResult text identity, replacedRanges, reusedBytes, and AST structure.
 * @functions
 *   - cloneRoot: Creates an independent deep clone of an mdast Root AST tree.
 *   - paragraph: Constructs a synthetic mdast Paragraph AST node without position metadata.
 * @dataflow Source Markdown text -> parseMarkdown -> KdocDocument -> clone / mutate AST root -> serializeIncremental -> IncrementalResult -> equality and structural assertions.
 * @controlflow Execute test suites across unchanged documents, single block edits, multiple separate edits, insertion and deletion, degenerate inputs, and output validity.
 * @version 1
 * @date 2026-09-04
 */

import type { Paragraph, Root, RootContent, Text } from 'mdast';
import { describe, expect, it } from 'vitest';
import {
  parseMarkdown,
  serializeIncremental,
  type IncrementalResult,
  type KdocDocument,
} from '../src/index.js';

/**
 * Creates an independent deep clone of an mdast Root AST tree.
 *
 * @purpose Deeply clones an mdast Root tree to give each test an independent tree so mutating one cannot leak into another.
 * @inputs root - The mdast Root AST tree to clone.
 * @outputs Root - An independent deep clone of the input Root tree.
 * @dataflow root AST -> structuredClone -> independent cloned Root AST.
 * @controlflow Deeply clone the Root AST tree using structuredClone and return the cloned tree.
 */
function cloneRoot(root: Root): Root {
  // structuredClone gives each test an independent tree so mutating one cannot leak into another.
  return structuredClone(root);
}

/**
 * Constructs a synthetic mdast Paragraph AST node without position metadata.
 *
 * @purpose Constructs a synthetic Paragraph AST node without position metadata, representing a freshly authored block.
 * @inputs text - The raw string text content for the paragraph.
 * @outputs Paragraph - A synthetic mdast Paragraph node with no position metadata.
 * @dataflow text string -> Text child node -> Paragraph parent node.
 * @controlflow Wrap string value in a Text node -> construct and return a Paragraph node containing the Text node.
 */
function paragraph(text: string): Paragraph {
  return {
    type: 'paragraph',
    children: [{ type: 'text', value: text } as Text],
  };
}

describe('unchanged documents', () => {
  it('returns the original text byte-for-byte when nothing changed', () => {
    const source = '# Title\n\nBody.\n';
    const doc: KdocDocument = parseMarkdown(source);
    const result: IncrementalResult = serializeIncremental(doc, doc.root);

    // Assert that the serialized text strictly equals the canonical source byte-for-byte.
    expect(result.text).toBe(source);

    // Assert that replacedRanges is empty when no AST nodes were changed.
    expect(result.replacedRanges).toEqual([]);

    // Assert that reusedBytes strictly equals totalBytes.
    expect(result.reusedBytes).toBe(result.totalBytes);
    expect(result.totalBytes).toBe(source.length);
  });

  it('preserves non-canonical formatting exactly', () => {
    // Headline test: source with formatting the whole-document serializer would rewrite.
    // The five-space HTML indentation and the '*   ' bullets would both be rewritten by the whole-document serializer;
    // preserving them untouched is the entire point of the incremental serializer module.
    const source =
      '# Title\n\n<img align="right"\n     alt="logo"\n     src="x.png">\n\n*   Item one\n*   Item two\n\nBody.\n';
    const doc: KdocDocument = parseMarkdown(source);
    const result: IncrementalResult = serializeIncremental(doc, doc.root);

    // Assert that non-canonical HTML indentation and bullet indentation survive untouched.
    expect(result.text).toBe(source);

    // Assert that no ranges were replaced.
    expect(result.replacedRanges).toEqual([]);

    // Assert that reusedBytes strictly equals totalBytes.
    expect(result.reusedBytes).toBe(result.totalBytes);
    expect(result.totalBytes).toBe(source.length);
  });
});

describe('single block edits', () => {
  it('rewrites only the edited block', () => {
    const source =
      '# Title\n\n*   Weird bullet\n\nSecond paragraph.\n\nThird paragraph.\n';
    const doc: KdocDocument = parseMarkdown(source);
    const updated: Root = cloneRoot(doc.root);

    // Replace the last child with a newly authored paragraph node.
    updated.children.splice(
      updated.children.length - 1,
      1,
      paragraph('Replaced third.')
    );

    const result: IncrementalResult = serializeIncremental(doc, updated);

    // Assert that the result text contains the replaced block content.
    expect(result.text).toContain('Replaced third.');

    // Assert that the untouched non-canonical list block was not normalized.
    expect(result.text).toContain('*   Weird bullet');

    // Assert that exactly one range was replaced.
    expect(result.replacedRanges.length).toBe(1);

    // Assert that reusedBytes is greater than zero and less than totalBytes.
    expect(result.reusedBytes).toBeGreaterThan(0);
    expect(result.reusedBytes).toBeLessThan(result.totalBytes);
  });

  it('rewrites only the middle block when the edit is in the middle', () => {
    const source =
      '# Title\n\n*   Weird bullet\n\nSecond paragraph.\n\nThird paragraph.\n';
    const doc: KdocDocument = parseMarkdown(source);
    const updated: Root = cloneRoot(doc.root);

    // Replace the middle paragraph (index 2: 'Second paragraph.') with a new paragraph node.
    updated.children.splice(2, 1, paragraph('Replaced second.'));

    const result: IncrementalResult = serializeIncremental(doc, updated);

    // Assert that the first block's original bytes ('# Title') and last block's original bytes ('Third paragraph.') are present.
    expect(result.text).toContain('# Title');
    expect(result.text).toContain('Third paragraph.');

    // Assert that the untouched non-canonical list block survived.
    expect(result.text).toContain('*   Weird bullet');

    // Assert that the replaced content is present.
    expect(result.text).toContain('Replaced second.');

    // Assert that exactly one range was replaced.
    expect(result.replacedRanges.length).toBe(1);

    // Assert that reusedBytes is greater than zero and less than totalBytes.
    expect(result.reusedBytes).toBeGreaterThan(0);
    expect(result.reusedBytes).toBeLessThan(result.totalBytes);
  });
});

describe('multiple separate edits', () => {
  it('keeps untouched content between two edits', () => {
    // Build a five-paragraph document where paragraphs 2 and 4 are non-canonically formatted list blocks.
    const source =
      'First paragraph.\n\n*   Item 1\n*   Item 2\n\nThird paragraph.\n\n1.  First item\n2.  Second item\n\nFifth paragraph.\n';
    const doc: KdocDocument = parseMarkdown(source);
    const updated: Root = cloneRoot(doc.root);

    // Replace paragraph 1 (index 0) and paragraph 5 (index 4).
    updated.children.splice(0, 1, paragraph('Updated first.'));
    updated.children.splice(
      updated.children.length - 1,
      1,
      paragraph('Updated fifth.')
    );

    const result: IncrementalResult = serializeIncremental(doc, updated);

    // Assert that both non-canonical middle blocks survive verbatim in the output.
    expect(result.text).toContain('*   Item 1\n*   Item 2');
    expect(result.text).toContain('1.  First item\n2.  Second item');

    // Assert that the replacement texts are present.
    expect(result.text).toContain('Updated first.');
    expect(result.text).toContain('Updated fifth.');

    // Assert that the untouched middle paragraph survives.
    expect(result.text).toContain('Third paragraph.');

    // Assert that exactly two distinct ranges were replaced.
    // A naive prefix/suffix match would collapse this into one span and reformat everything between,
    // which is exactly what the LCS matching exists to prevent.
    expect(result.replacedRanges.length).toBe(2);
  });
});

describe('insertion and deletion', () => {
  it('inserts a new block without gluing it to its neighbour', () => {
    const source = 'First.\n\nSecond.\n';
    const doc: KdocDocument = parseMarkdown(source);
    const updated: Root = cloneRoot(doc.root);

    // Splice a new paragraph between child 0 ('First.') and child 1 ('Second.').
    updated.children.splice(1, 0, paragraph('Inserted.'));

    const result: IncrementalResult = serializeIncremental(doc, updated);

    // Assert that the output contains the inserted text as well as existing texts.
    expect(result.text).toContain('Inserted.');
    expect(result.text).toContain('First.');
    expect(result.text).toContain('Second.');

    // Critically assert that re-parsing the output yields THREE top-level children, proving blocks did not merge.
    const reparsed: KdocDocument = parseMarkdown(result.text);
    expect(reparsed.root.children.length).toBe(3);
  });

  it('inserts at the very start', () => {
    const source = 'First.\n\nSecond.\n';
    const doc: KdocDocument = parseMarkdown(source);
    const updated: Root = cloneRoot(doc.root);

    // Splice a new paragraph at index 0.
    updated.children.splice(0, 0, paragraph('Inserted.'));

    const result: IncrementalResult = serializeIncremental(doc, updated);

    // Assert that the text begins with 'Inserted.'.
    expect(result.text.startsWith('Inserted.')).toBe(true);

    // Assert that re-parsing yields three top-level children.
    const reparsed: KdocDocument = parseMarkdown(result.text);
    expect(reparsed.root.children.length).toBe(3);
  });

  it('deletes a block', () => {
    const source = 'First.\n\nSecond.\n\nThird.\n';
    const doc: KdocDocument = parseMarkdown(source);
    const updated: Root = cloneRoot(doc.root);

    // Remove the middle child (index 1: 'Second.').
    updated.children.splice(1, 1);

    const result: IncrementalResult = serializeIncremental(doc, updated);

    // Assert that the removed text is gone and surviving blocks remain.
    expect(result.text).not.toContain('Second.');
    expect(result.text).toContain('First.');
    expect(result.text).toContain('Third.');

    // Assert that re-parsing yields two children.
    const reparsed: KdocDocument = parseMarkdown(result.text);
    expect(reparsed.root.children.length).toBe(2);
  });

  it('handles replacing every block', () => {
    const source = 'First.\n\nSecond.\n';
    const doc: KdocDocument = parseMarkdown(source);
    const updated: Root = cloneRoot(doc.root);

    // Replace the entire children array with new paragraph nodes.
    updated.children = [paragraph('All new one.'), paragraph('All new two.')];

    const result: IncrementalResult = serializeIncremental(doc, updated);

    // Assert that the output contains only the new content and none of the old content.
    expect(result.text).toContain('All new one.');
    expect(result.text).toContain('All new two.');
    expect(result.text).not.toContain('First.');
    expect(result.text).not.toContain('Second.');

    // Assert that re-parsing yields two children.
    const reparsed: KdocDocument = parseMarkdown(result.text);
    expect(reparsed.root.children.length).toBe(2);
  });
});

describe('degenerate inputs', () => {
  it('handles empty source without throwing and returns empty string', () => {
    const source = '';
    const doc: KdocDocument = parseMarkdown(source);

    // Assert that serializeIncremental does not throw on empty source with unchanged root and returns empty string.
    const result: IncrementalResult = serializeIncremental(doc, doc.root);
    expect(result.text).toBe('');
    expect(result.replacedRanges).toEqual([]);
    expect(result.reusedBytes).toBe(0);
    expect(result.totalBytes).toBe(0);
  });

  it('returns text that re-parses to zero children when updated root has zero children', () => {
    const source = 'Some text.\n';
    const doc: KdocDocument = parseMarkdown(source);
    const updated: Root = { type: 'root', children: [] };

    const result: IncrementalResult = serializeIncremental(doc, updated);

    // Assert that re-parsing the output yields zero children.
    const reparsed: KdocDocument = parseMarkdown(result.text);
    expect(reparsed.root.children.length).toBe(0);
  });

  it('falls back safely when position data is missing', () => {
    const source = '# Title\n\nBody.\n';
    const doc: KdocDocument = parseMarkdown(source);

    // Build an updated root whose children are all freshly constructed paragraph nodes AND
    // replace doc.root.children with position-less clones so the old side has no ranges either.
    const positionlessDoc: KdocDocument = {
      ...doc,
      root: {
        type: 'root',
        children: [paragraph('a'), paragraph('b')],
      },
    } as KdocDocument;

    // The two trees must differ structurally. If both sides were identical, serializeIncremental would
    // take its fast path (element-wise equal structural keys) and return original.text unchanged before any
    // byte range is ever needed, so the position-less bail-out below would go unexercised and this test would
    // pass for the wrong reason. Diverging forces a replace run that genuinely requires an old child's byte range.
    const updated: Root = {
      type: 'root',
      children: [paragraph('a'), paragraph('changed')],
    };

    const result: IncrementalResult = serializeIncremental(
      positionlessDoc,
      updated
    );

    // Assert that reusedBytes is 0, signalling the whole-document fallback.
    // A correct-but-unminimal answer is always preferable to a minimal-but-wrong one.
    expect(result.reusedBytes).toBe(0);

    // Assert that the output re-parses to two paragraphs.
    const reparsed: KdocDocument = parseMarkdown(result.text);
    expect(reparsed.root.children.length).toBe(2);
  });
});

describe('output validity', () => {
  it('output always re-parses to the updated tree', () => {
    // Scenario 1: Single edit
    const docEdit: KdocDocument = parseMarkdown(
      '# Header\n\nParagraph 1.\n\nParagraph 2.\n'
    );
    const updatedEdit: Root = cloneRoot(docEdit.root);
    updatedEdit.children.splice(1, 1, paragraph('Modified paragraph.'));

    const resultEdit: IncrementalResult = serializeIncremental(
      docEdit,
      updatedEdit
    );
    const reparsedEdit: KdocDocument = parseMarkdown(resultEdit.text);
    const expectedEditTypes: readonly string[] = updatedEdit.children.map(
      (child: RootContent): string => child.type
    );
    const actualEditTypes: readonly string[] = reparsedEdit.root.children.map(
      (child: RootContent): string => child.type
    );
    expect(actualEditTypes).toEqual(expectedEditTypes);

    // Scenario 2: Insertion
    const docInsert: KdocDocument = parseMarkdown('# Header\n\nParagraph 1.\n');
    const updatedInsert: Root = cloneRoot(docInsert.root);
    updatedInsert.children.splice(1, 0, paragraph('Inserted paragraph.'));

    const resultInsert: IncrementalResult = serializeIncremental(
      docInsert,
      updatedInsert
    );
    const reparsedInsert: KdocDocument = parseMarkdown(resultInsert.text);
    const expectedInsertTypes: readonly string[] = updatedInsert.children.map(
      (child: RootContent): string => child.type
    );
    const actualInsertTypes: readonly string[] =
      reparsedInsert.root.children.map(
        (child: RootContent): string => child.type
      );
    expect(actualInsertTypes).toEqual(expectedInsertTypes);

    // Scenario 3: Deletion
    const docDelete: KdocDocument = parseMarkdown(
      '# Header\n\nParagraph 1.\n\nParagraph 2.\n'
    );
    const updatedDelete: Root = cloneRoot(docDelete.root);
    updatedDelete.children.splice(1, 1);

    const resultDelete: IncrementalResult = serializeIncremental(
      docDelete,
      updatedDelete
    );
    const reparsedDelete: KdocDocument = parseMarkdown(resultDelete.text);
    const expectedDeleteTypes: readonly string[] = updatedDelete.children.map(
      (child: RootContent): string => child.type
    );
    const actualDeleteTypes: readonly string[] =
      reparsedDelete.root.children.map(
        (child: RootContent): string => child.type
      );
    expect(actualDeleteTypes).toEqual(expectedDeleteTypes);

    // This is the safety net: byte-preservation is worthless if the resulting document no longer means what the edit intended.
  });
});
