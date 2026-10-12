/**
 * @file round-trip.spec.ts
 * @purpose Round-trip test suite verifying AST fidelity, schema conformance, and structural preservation for K-Doc's ProseMirror adapter (@k-doc/editor).
 * @inputs Markdown fixture files from core's golden corpus (@k-doc/core), markdown test strings for individual AST constructs, empty strings, and multi-construct documents.
 * @outputs Vitest test execution results asserting mdast ⇄ ProseMirror AST equality, schema validity, and documented asymmetries.
 * @functions
 *   - stripPositions: Deeply clones an AST node structure while stripping all 'position' properties at every depth.
 *   - roundTrip: Parses Markdown source to mdast, converts to ProseMirror document tree, and converts back to mdast.
 *   - loadCorpus: Reads all *.md fixture files from the core package's golden corpus directory, sorted deterministically by filename.
 * @dataflow Source Markdown -> parseMarkdown -> initial mdast Root (before) -> mdastToProseMirror -> ProseMirror Node -> proseMirrorToMdast -> reconstructed mdast Root (after) -> AST deep equality comparison against before.
 * @controlflow Define helper functions -> verify ProseMirror schema node/mark specifications -> execute construct-specific round-trip tests -> execute golden corpus test suite -> verify empty document asymmetry -> verify ProseMirror document validation via check().
 * @version 2
 * @date 2026-09-15
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@k-doc/core';
import { kdocSchema, mdastToProseMirror, proseMirrorToMdast } from '../src/index.js';
import type { Root } from 'mdast';

/**
 * Deeply clones an AST node structure while stripping all `position` properties.
 *
 * mdast positions describe offsets into the original source and cannot survive a trip
 * through a different document model, so they are excluded from comparison by design
 * rather than by oversight.
 *
 * @purpose Recursively removes the `position` property from an AST node and all its descendants.
 * @inputs value - Any unknown value (primitive, null, array, or object) to clone and sanitize.
 * @outputs unknown - A deep structural clone of the input with all `position` keys omitted.
 * @dataflow Traverses nested data structures -> filters out 'position' keys -> constructs sanitized clone.
 * @controlflow Branch on type: null/primitive -> return directly; array -> map recursively; object -> copy non-position keys recursively.
 */
function stripPositions(value: unknown): unknown {
  // Check if value is null or a primitive type (string, number, boolean, symbol, bigint, undefined).
  if (value === null || typeof value !== 'object') {
    // Primitives and null do not contain AST position properties; return value as-is.
    return value;
  } else if (Array.isArray(value)) {
    // Value is an array: recursively sanitize each element.
    const result: unknown[] = [];
    for (const item of value) {
      result.push(stripPositions(item));
    }
    return result;
  } else {
    // Value is a plain object record: clone properties excluding 'position'.
    // mdast positions describe offsets into the original source and cannot survive a trip through a different document model,
    // so they are excluded from comparison by design rather than by oversight.
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      // Check if current key is the unist/mdast 'position' property.
      if (key === 'position') {
        // Skip copying the position key.
        continue;
      } else {
        // Recursively strip positions from the child property value.
        const childValue = record[key];
        result[key] = stripPositions(childValue);
      }
    }
    return result;
  }
}

/**
 * Parses Markdown source to mdast, converts to ProseMirror document tree, and converts back to mdast.
 *
 * @purpose Executes the full round-trip conversion pipeline between Markdown, mdast, and ProseMirror.
 * @inputs source - The raw Markdown source string to test.
 * @outputs { before: Root; after: Root } - The parsed before-mdast AST and reconstructed after-mdast AST.
 * @dataflow Markdown source -> parseMarkdown -> before Root -> mdastToProseMirror -> PMNode -> proseMirrorToMdast -> after Root.
 * @controlflow Parse source with parseMarkdown -> extract root -> convert to PMNode -> convert back to mdast Root -> return pair.
 */
function roundTrip(source: string): { before: Root; after: Root } {
  const doc = parseMarkdown(source);
  const before = doc.root;
  const pmDoc = mdastToProseMirror(before);
  const after = proseMirrorToMdast(pmDoc);
  return { before, after };
}

/**
 * Reads all *.md fixture files from the core package's golden corpus directory.
 *
 * @purpose Loads all golden Markdown fixtures from @k-doc/core sorted deterministically by filename.
 * @inputs None (resolves directory path relative to import.meta.url).
 * @outputs ReadonlyArray<{ name: string; source: string }> - Array of corpus fixture objects with name and source.
 * @dataflow Corpus directory URL -> fileURLToPath -> read entries -> filter *.md -> sort -> readFileSync -> fixture array.
 * @controlflow Resolve corpus directory path -> check directory existence -> if absent return [] -> read entries -> filter .md files -> sort filenames lexicographically -> read UTF-8 file contents -> return fixture array.
 */
function loadCorpus(): ReadonlyArray<{ name: string; source: string }> {
  const corpusDir = fileURLToPath(new URL('../../core/test/corpus/', import.meta.url));

  // Check if the corpus directory exists on the filesystem.
  if (!existsSync(corpusDir)) {
    // Directory does not exist; return an empty array so guard assertions detect missing corpus.
    return [];
  } else {
    // Directory exists; proceed to read directory entries.
  }

  const entries = readdirSync(corpusDir);

  // Filter directory entries to include only Markdown files with the .md extension.
  const mdFiles = entries.filter((file: string): boolean => {
    // Check if filename ends with .md.
    if (file.endsWith('.md')) {
      // Include .md file.
      return true;
    } else {
      // Exclude non-markdown files.
      return false;
    }
  });

  // Sort filenames lexicographically for deterministic test execution across platforms.
  mdFiles.sort((a: string, b: string): number => a.localeCompare(b));

  const fixtures: Array<{ name: string; source: string }> = [];

  for (const file of mdFiles) {
    const filePath = join(corpusDir, file);
    const source = readFileSync(filePath, 'utf8');
    fixtures.push({
      name: file,
      source,
    });
  }

  return fixtures;
}

describe('schema', () => {
  it('contains every expected node name', () => {
    const expectedNodes = [
      'doc',
      'paragraph',
      'heading',
      'blockquote',
      'codeBlock',
      'thematicBreak',
      'bulletList',
      'orderedList',
      'listItem',
      'table',
      'tableRow',
      'tableCell',
      'frontMatter',
      'footnoteDefinition',
      'unknownBlock',
      'text',
      'hardBreak',
      'image',
      'footnoteReference',
      'unknownInline',
    ];

    for (const nodeName of expectedNodes) {
      // Check that the node specification exists in the schema.
      expect(kdocSchema.nodes[nodeName]).toBeDefined();
    }
  });

  it('contains every expected mark name', () => {
    const expectedMarks = ['strong', 'emphasis', 'inlineCode', 'strikethrough', 'link'];

    for (const markName of expectedMarks) {
      // Check that the mark specification exists in the schema.
      expect(kdocSchema.marks[markName]).toBeDefined();
    }
  });
});

describe('construct round-trips', () => {
  it('heading', () => {
    const { before, after } = roundTrip('# Title\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('paragraph with emphasis and strong', () => {
    const { before, after } = roundTrip('Plain _em_ and **strong** here.\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('nested marks', () => {
    // This is the case that fails if mark runs are not grouped.
    const { before, after } = roundTrip('**_both_**\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('adjacent shared mark', () => {
    // Naive per-node wrapping would emit two adjacent strong nodes instead of one.
    const { before, after } = roundTrip('**bold _and italic_**\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('strikethrough', () => {
    const { before, after } = roundTrip('~~gone~~\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('inline code', () => {
    const { before, after } = roundTrip('Use `code` here.\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('link', () => {
    const { before, after } = roundTrip('A [link](https://example.com "T") here.\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('link containing strong', () => {
    const { before, after } = roundTrip('[**bold link**](https://example.com)\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('image', () => {
    const { before, after } = roundTrip('![alt](./a.png "T")\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('hard break', () => {
    const { before, after } = roundTrip('line one  \nline two\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('blockquote', () => {
    const { before, after } = roundTrip('> quoted\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('footnote reference and definition', () => {
    const { before, after } = roundTrip('Text[^1] and[^note].\n\n[^1]: First **note**.\n\n[^note]: Second.\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('fenced code with language', () => {
    const { before, after } = roundTrip('```ts\nconst a = 1;\n```\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('empty fenced code', () => {
    const { before, after } = roundTrip('```\n```\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('bullet list', () => {
    const { before, after } = roundTrip('- one\n- two\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('ordered list with start', () => {
    const { before, after } = roundTrip('3. three\n4. four\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('task list', () => {
    const { before, after } = roundTrip('- [ ] todo\n- [x] done\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('loose item in a tight list keeps its spacing', () => {
    const { before, after } = roundTrip('- [x] done\n- [ ] todo\n\n  second paragraph\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('nested list', () => {
    const { before, after } = roundTrip('- one\n  - nested\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('table with alignment', () => {
    const { before, after } = roundTrip('| A | B |\n| :- | -: |\n| 1 | 2 |\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('thematic break', () => {
    const { before, after } = roundTrip('---\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('front matter', () => {
    const { before, after } = roundTrip('---\ntitle: T\n---\n\nBody.\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('raw HTML block', () => {
    // Exercises the unknownBlock atom: the whole point is the node surviving verbatim rather than being understood.
    const { before, after } = roundTrip('<div class="x">raw</div>\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });

  it('inline HTML', () => {
    // Exercises the unknownInline atom: the inline raw tag survives verbatim.
    const { before, after } = roundTrip('Text <span>raw</span> more.\n');
    expect(stripPositions(after)).toEqual(stripPositions(before));
  });
});

describe('the golden corpus', () => {
  it('corpus is non-empty', () => {
    // Guard assertion: prevents the suite from passing vacuously.
    const fixtures = loadCorpus();
    expect(fixtures.length).toBeGreaterThan(0);
  });

  const fixtures = loadCorpus();

  for (const fixture of fixtures) {
    it(`round-trips golden corpus fixture: ${fixture.name}`, () => {
      // This is the adapter's headline claim: every document the engine round-trips through Markdown also round-trips through the ProseMirror model.
      const { before, after } = roundTrip(fixture.source);
      expect(stripPositions(after)).toEqual(stripPositions(before));
    });
  }
});

describe('the empty-document asymmetry', () => {
  it('empty document converts to a single empty paragraph upon round trip', () => {
    // This is the single documented place the conversion is not information-preserving,
    // because ProseMirror's `doc` requires `block+`; asserting it explicitly stops it from being mistaken for a bug later.
    const { before, after } = roundTrip('');

    expect(before.children).toHaveLength(0);
    expect(after.children).toHaveLength(1);
    expect(after.children[0]?.type).toBe('paragraph');
  });
});

describe('generated documents are valid', () => {
  it('produces a ProseMirror document that passes schema check() without throwing', () => {
    const complexSource = [
      '# Document Title',
      '',
      '> A blockquote containing **bold text** and a [link](https://example.com "Example").',
      '',
      'A regular paragraph with *emphasis*, ~~strikethrough~~, and `inline code`.',
      '',
      '- Item 1',
      '- Item 2',
      '  - Nested item',
      '',
      '```typescript',
      'const answer: number = 42;',
      '```',
      '',
      '| Header A | Header B |',
      '| :------- | -------: |',
      '| Cell 1   | Cell 2   |',
      '',
      '---',
    ].join('\n');

    const doc = parseMarkdown(complexSource);
    const pmDoc = mdastToProseMirror(doc.root);

    // check() validates the document against the schema's content expressions,
    // so this catches a converter emitting a structurally invalid document even when the round-trip happens to compare equal.
    expect(() => pmDoc.check()).not.toThrow();
  });
});
