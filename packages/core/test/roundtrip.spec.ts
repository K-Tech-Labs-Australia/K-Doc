/**
 * @file roundtrip.spec.ts
 * @purpose Golden-corpus round-trip test suite verifying byte-identity fidelity, AST stability, and parser robustness for @k-doc/core.
 * @inputs Markdown fixture files from test/corpus/, malformed and edge-case Markdown test strings, MarkdownStyle configurations.
 * @outputs Vitest test execution results asserting round-trip byte equality, AST deep equality, and error policies.
 * @functions
 *   - loadCorpus: Reads all *.md fixture files from the local corpus directory sorted deterministically by filename.
 *   - stripPositions: Recursively strips AST position metadata from nodes, objects, and arrays to enable structural comparison.
 * @dataflow Corpus Markdown files / test strings -> parseMarkdown -> KdocDocument AST -> serializeDocument -> reconstructed Markdown text -> equality assertion against source.
 * @controlflow Load corpus fixtures -> guard test for non-empty corpus -> execute parameterized round-trip tests (byte identity, AST stability, text preservation) -> execute parser robustness edge-case suite -> execute style policy error assertions.
 * @version 1
 * @date 2026-09-04
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MARKDOWN_STYLE,
  parseMarkdown,
  serializeDocument,
  type MarkdownStyle,
} from '../src/index.js';

interface CorpusFixture {
  readonly name: string;
  readonly source: string;
}

/**
 * Loads all golden Markdown corpus fixtures from the test corpus directory.
 *
 * @purpose Reads and returns all *.md fixture files from the local corpus directory sorted deterministically by filename.
 * @inputs None (resolves directory path relative to import.meta.url).
 * @outputs ReadonlyArray<CorpusFixture> - An array of fixture objects containing filename and source text.
 * @dataflow Test file URL -> fileURLToPath -> directory entries -> filter .md files -> sort filenames -> readFileSync -> CorpusFixture array.
 * @controlflow Resolve corpus directory -> check directory existence -> read directory entries -> filter .md filenames -> sort filenames deterministically -> read UTF-8 file contents -> return fixture array.
 */
function loadCorpus(): ReadonlyArray<CorpusFixture> {
  const corpusDir = fileURLToPath(new URL('./corpus/', import.meta.url));

  // Check if the corpus directory exists on the filesystem.
  if (!existsSync(corpusDir)) {
    // Directory does not exist; return an empty array so the guard test detects the missing corpus.
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

  // Sort filenames lexicographically for deterministic test ordering across platforms.
  mdFiles.sort((a: string, b: string): number => a.localeCompare(b));

  const fixtures: CorpusFixture[] = [];

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

/**
 * Recursively strips the `position` metadata property from an AST node or data structure.
 *
 * @purpose Deeply clones an AST node, array, or object while omitting all position properties to enable structural AST equality checks.
 * @inputs value - The unknown AST node, record, array, or primitive to sanitize.
 * @outputs unknown - Deep structural clone of the input value with all position properties removed.
 * @dataflow Input AST/object -> recursive tree traversal -> clone without position keys -> sanitized AST.
 * @controlflow Check for null/primitive -> return as-is; check for array -> map recursively; for objects -> clone keys excluding 'position' recursively.
 */
function stripPositions(value: unknown): unknown {
  // Check if value is null or a primitive type (string, number, boolean, symbol, bigint, undefined).
  if (value === null || typeof value !== 'object') {
    // Primitives and null do not contain AST position properties; return value as-is.
    return value;
  } else {
    // Value is a non-null object or array; proceed to inspect and strip child positions.
  }

  // Check if value is an Array structure.
  if (Array.isArray(value)) {
    // Value is an array: recursively strip position properties from each item.
    return value.map((item: unknown): unknown => stripPositions(item));
  } else {
    // Value is a plain object: clone properties excluding 'position'.
  }

  // Value is a non-null object record.
  const record = value as Readonly<Record<string, unknown>>;
  const sanitized: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(record)) {
    // Source positions differ between original and re-parsed AST trees by construction,
    // so comparing position properties directly would guarantee a false failure.
    if (key === 'position') {
      // Branch: key is 'position' -> omit from sanitized clone.
      continue;
    } else {
      // Branch: key is not 'position' -> recursively sanitize child value.
      sanitized[key] = stripPositions(val);
    }
  }

  return sanitized;
}

describe('round-trip contract', () => {
  it('corpus is non-empty', () => {
    // Guard assertion: verify loadCorpus().length > 0 to prevent vacuous test passes.
    expect(loadCorpus().length > 0).toBe(true);
  });

  const fixtures = loadCorpus();

  for (const fixture of fixtures) {
    it(`round-trips fixture: ${fixture.name}`, () => {
      const { source } = fixture;

      // a. Byte identity (FR-4.1): serializeDocument(parseMarkdown(source)) strictly equals source.
      expect(serializeDocument(parseMarkdown(source))).toBe(source);

      // b. AST stability: stripPositions(parseMarkdown(serializeDocument(parseMarkdown(source))).root) deep-equals stripPositions(parseMarkdown(source).root).
      expect(
        stripPositions(parseMarkdown(serializeDocument(parseMarkdown(source))).root)
      ).toEqual(stripPositions(parseMarkdown(source).root));

      // c. Text preservation: parseMarkdown(source).text strictly equals source.
      expect(parseMarkdown(source).text).toBe(source);
    });
  }
});

describe('parser robustness', () => {
  it('does not throw for the empty string', () => {
    // Check that parsing an empty string input does not throw.
    expect(() => parseMarkdown('')).not.toThrow();
  });

  it('does not throw for a lone newline', () => {
    // Check that parsing a lone newline character input does not throw.
    expect(() => parseMarkdown('\n')).not.toThrow();
  });

  it('does not throw for a string of only spaces and tabs', () => {
    // Check that parsing a string consisting only of whitespace characters does not throw.
    expect(() => parseMarkdown('   \t  \t ')).not.toThrow();
  });

  it('does not throw for an unterminated code fence', () => {
    // Check that parsing an unclosed code block fence does not throw.
    expect(() => parseMarkdown('```ts\nconst a = 1')).not.toThrow();
  });

  it('does not throw for an unterminated YAML front matter fence', () => {
    // Check that parsing an unclosed YAML front matter block does not throw.
    expect(() => parseMarkdown('---\ntitle: x')).not.toThrow();
  });

  it('does not throw for malformed YAML front matter and degrades metadata gracefully', () => {
    const malformedYaml = '---\n: : :\n---\n\nBody.\n';

    // Check that parsing malformed YAML front matter does not throw an exception.
    expect(() => parseMarkdown(malformedYaml)).not.toThrow();

    const doc = parseMarkdown(malformedYaml);

    // Malformed metadata must degrade gracefully, not fail.
    // Check that frontMatter is preserved as non-null.
    expect(doc.frontMatter).not.toBeNull();

    // Check that frontMatter.data degrades to an empty dictionary object.
    expect(doc.frontMatter?.data).toEqual({});
  });

  it('does not throw for an unclosed HTML tag', () => {
    // Check that parsing unclosed HTML tags does not throw.
    expect(() => parseMarkdown('<div><p>Unclosed HTML')).not.toThrow();
  });

  it('does not throw for a 200-level-deep nested blockquote built programmatically', () => {
    // Programmatically construct a 200-level-deep nested blockquote string.
    const deepBlockquote = `${'> '.repeat(200)}Deeply nested blockquote content`;

    // Check that parsing deeply nested syntax structures does not throw or overflow call stack.
    expect(() => parseMarkdown(deepBlockquote)).not.toThrow();
  });
});

describe('style policy', () => {
  it('throws an error mentioning Phase 0b when column line wrapping is configured', () => {
    const doc = parseMarkdown('Sample text for style policy assertion.');
    const styleWithColumnWrap: MarkdownStyle = {
      ...DEFAULT_MARKDOWN_STYLE,
      lineWrap: { kind: 'column', width: 80 },
    };

    // Check that requesting column line wrapping throws an Error mentioning Phase 0b.
    expect(() => serializeDocument(doc, styleWithColumnWrap)).toThrow(/Phase 0b/);
  });
});
