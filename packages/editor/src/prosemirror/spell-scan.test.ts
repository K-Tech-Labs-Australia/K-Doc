/**
 * @file spell-scan.test.ts
 * @purpose Vitest test suite for K-Doc's spell check document scanner and skip rules (FR-12.2).
 *   Verifies token eligibility filtering, word offset extraction, and ProseMirror AST traversal across skipped and scanned nodes and marks.
 * @inputs Candidate word strings, text offset positions, and ProseMirror documents built with kdocSchema.
 * @outputs Vitest assertions verifying isCheckableWord, wordsInText, scanDocument, and scanState.
 * @functions
 *   - createTestDoc: Helper constructing a ProseMirror document containing a single paragraph using kdocSchema.
 *   - createTestState: Helper constructing an EditorState over a ProseMirror document using kdocSchema.
 * @dataflow Document nodes / text runs -> scanDocument / scanState / wordsInText -> WordSpan[] -> Vitest expect assertions.
 * @controlflow Test isCheckableWord token acceptance and rejection rules -> test wordsInText offset tracking and apostrophe stripping -> test scanDocument and scanState skip rules on node types and mark types -> test multi-block position accuracy.
 * @version 1
 * @date 2026-09-06
 */

import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { kdocSchema } from './schema.js';
import {
  isCheckableWord,
  wordsInText,
  scanDocument,
  scanState,
  SKIPPED_NODE_TYPES,
  SKIPPED_MARK_TYPES,
} from './spell-scan.js';
import type { WordSpan } from './spell-scan.js';

/**
 * Creates a standard ProseMirror test document node containing a single paragraph of text.
 *
 * @purpose Constructs a real ProseMirror Node tree using kdocSchema for deterministic test document structure.
 * @inputs text: string - The text content to populate inside the paragraph.
 * @outputs ProseMirrorNode - The root doc node containing the paragraph.
 * @dataflow text -> kdocSchema.text -> kdocSchema.node('paragraph') -> kdocSchema.node('doc').
 * @controlflow Wrap text in paragraph node -> wrap paragraph in doc node -> return doc.
 */
function createTestDoc(text: string): ProseMirrorNode {
  return kdocSchema.node('doc', null, [
    kdocSchema.node('paragraph', null, [kdocSchema.text(text)]),
  ]);
}

/**
 * Creates an EditorState initialized with kdocSchema and the provided ProseMirror document node.
 *
 * @purpose Helper to build a real EditorState over kdocSchema for scanState testing.
 * @inputs doc: ProseMirrorNode - The root document node to populate the editor state.
 * @outputs EditorState - The configured ProseMirror EditorState instance.
 * @dataflow doc -> EditorState.create -> configured editor state.
 * @controlflow Pass doc and kdocSchema to EditorState.create -> return state.
 */
function createTestState(doc: ProseMirrorNode): EditorState {
  return EditorState.create({
    doc,
    schema: kdocSchema,
  });
}

describe('spell-scan', () => {
  describe('isCheckableWord', () => {
    it('accepts ordinary words and words containing ASCII or curly apostrophes', () => {
      expect(isCheckableWord('hello')).toBe(true);
      expect(isCheckableWord('world')).toBe(true);
      expect(isCheckableWord('prose')).toBe(true);
      expect(isCheckableWord("don't")).toBe(true);
      expect(isCheckableWord('don’t')).toBe(true);
      expect(isCheckableWord("it's")).toBe(true);
      expect(isCheckableWord('it’s')).toBe(true);
      expect(isCheckableWord("o'clock")).toBe(true);
      expect(isCheckableWord('café')).toBe(true);
    });

    it('rejects single characters and empty strings', () => {
      // Single letters (such as 'a' or 'I') are almost always intentional pronouns or articles and not worth checking.
      expect(isCheckableWord('a')).toBe(false);
      expect(isCheckableWord('I')).toBe(false);
      expect(isCheckableWord('x')).toBe(false);
      expect(isCheckableWord('')).toBe(false);
    });

    it('rejects tokens containing numeric digits', () => {
      // Tokens containing digits are technical identifiers, versions, or coordinates, not natural prose.
      expect(isCheckableWord('h3llo')).toBe(false);
      expect(isCheckableWord('x1')).toBe(false);
      expect(isCheckableWord('utf8')).toBe(false);
      expect(isCheckableWord('v2')).toBe(false);
      expect(isCheckableWord('2026')).toBe(false);
      expect(isCheckableWord('word123')).toBe(false);
    });

    it('rejects tokens containing path, identifier, or email delimiters', () => {
      // Underscores, slashes, backslashes, at-signs, and dots denote paths, code identifiers, or email addresses.
      // Flagging constructs like "README.md" trains users to disregard the spell checker.
      expect(isCheckableWord('snake_case')).toBe(false);
      expect(isCheckableWord('foo_bar')).toBe(false);
      expect(isCheckableWord('path/to')).toBe(false);
      expect(isCheckableWord('usr/bin')).toBe(false);
      expect(isCheckableWord('win\\path')).toBe(false);
      expect(isCheckableWord('C:\\Users')).toBe(false);
      expect(isCheckableWord('user@domain')).toBe(false);
      expect(isCheckableWord('README.md')).toBe(false);
      expect(isCheckableWord('example.com')).toBe(false);
    });

    it('rejects ALL-CAPS acronym tokens but accepts capitalised title-case words', () => {
      // Acronyms (e.g. "NASA", "HTTP", "HTML") are the common case for all-caps tokens;
      // flagging them in a spell checker produces noise and causes users to ignore warnings.
      expect(isCheckableWord('HTTP')).toBe(false);
      expect(isCheckableWord('NASA')).toBe(false);
      expect(isCheckableWord('HTML')).toBe(false);
      expect(isCheckableWord('API')).toBe(false);
      expect(isCheckableWord('URL')).toBe(false);

      // Assert that a capitalised word (such as "Hello") is NOT rejected by the all-caps rule.
      expect(isCheckableWord('Hello')).toBe(true);
      expect(isCheckableWord('World')).toBe(true);
      expect(isCheckableWord('ProseMirror')).toBe(true);
      expect(isCheckableWord("Don't")).toBe(true);
    });
  });

  describe('wordsInText', () => {
    it('splits on non-letters and returns document positions offset by the offset argument', () => {
      // Offset 12: 'hello world'
      // 'hello' has length 5 starting at index 0 -> from 12, to 17
      // 'world' has length 5 starting at index 6 -> from 18, to 23
      const text = 'hello world';
      const offset = 12;
      const spans = wordsInText(text, offset);

      expect(spans).toEqual<WordSpan[]>([
        { from: 12, to: 17, word: 'hello' },
        { from: 18, to: 23, word: 'world' },
      ]);
    });

    it('strips leading and trailing apostrophes and adjusts positions accordingly', () => {
      // For single-quoted text "'quoted'" at offset 10:
      // Raw match starts at index 0 (doc pos 10) and ends at index 8 (doc pos 18).
      // Stripping leading quote increments from to 11 (one greater than quote's position).
      // Stripping trailing quote decrements to to 17 (one less than closing quote's position).
      const singleQuoted = "'quoted'";
      const singleSpans = wordsInText(singleQuoted, 10);
      expect(singleSpans).toEqual<WordSpan[]>([
        { from: 11, to: 17, word: 'quoted' },
      ]);

      // Test typographic curly quotes ’quoted’ at offset 20:
      const curlyQuoted = '’quoted’';
      const curlySpans = wordsInText(curlyQuoted, 20);
      expect(curlySpans).toEqual<WordSpan[]>([
        { from: 21, to: 27, word: 'quoted' },
      ]);

      // Test trailing possessive apostrophe (e.g. "dogs'" at offset 5):
      // 'dogs' (length 4) should have from: 5, to: 9, stripping trailing quote.
      const possessive = "dogs'";
      const possessiveSpans = wordsInText(possessive, 5);
      expect(possessiveSpans).toEqual<WordSpan[]>([
        { from: 5, to: 9, word: 'dogs' },
      ]);

      // Test internal apostrophes are preserved (e.g. "don't" at offset 0):
      const contraction = "don't";
      const contractionSpans = wordsInText(contraction, 0);
      expect(contractionSpans).toEqual<WordSpan[]>([
        { from: 0, to: 5, word: "don't" },
      ]);
    });

    it('omits tokens that are too short or unfit entirely rather than flagging them', () => {
      // 'I am a fast runner'
      // 'I' (length 1) -> omitted
      // 'am' (length 2) -> kept, from 2, to 4
      // 'a' (length 1) -> omitted
      // 'fast' -> kept, from 7, to 11
      // 'runner' -> kept, from 12, to 18
      const text = 'I am a fast runner';
      const spans = wordsInText(text, 0);
      expect(spans).toEqual<WordSpan[]>([
        { from: 2, to: 4, word: 'am' },
        { from: 7, to: 11, word: 'fast' },
        { from: 12, to: 18, word: 'runner' },
      ]);

      // All-caps tokens (NASA, HTTP) omitted entirely
      const acroText = 'NASA launched HTTP service';
      const acroSpans = wordsInText(acroText, 10);
      expect(acroSpans).toEqual<WordSpan[]>([
        { from: 15, to: 23, word: 'launched' },
        { from: 29, to: 36, word: 'service' },
      ]);

      // Standalone quotes or punctuation runs produce no checkable words
      const punctText = "' '' ’ ’’’";
      expect(wordsInText(punctText, 0)).toEqual([]);
    });

    it('yields an empty array for an empty string', () => {
      expect(wordsInText('', 0)).toEqual([]);
      expect(wordsInText('', 42)).toEqual([]);
    });
  });

  describe('scanDocument and scanState', () => {
    it('scans text inside a paragraph node', () => {
      const doc = createTestDoc('Proper prose is scanned accurately.');
      const spans = scanDocument(doc);

      expect(spans.map((s) => s.word)).toEqual([
        'Proper',
        'prose',
        'is',
        'scanned',
        'accurately',
      ]);
    });

    it('skips text inside codeBlock nodes, verifying against SKIPPED_NODE_TYPES', () => {
      // Verify that 'codeBlock' is registered in SKIPPED_NODE_TYPES rather than hard-coding the name twice.
      expect(SKIPPED_NODE_TYPES.has('codeBlock')).toBe(true);

      // Construct a document with a prose paragraph and a codeBlock containing identifier tokens.
      const doc = kdocSchema.node('doc', null, [
        kdocSchema.node('paragraph', null, [kdocSchema.text('Prose before code.')]),
        kdocSchema.node('codeBlock', null, [
          kdocSchema.text('const variableName = calculateScore();'),
        ]),
        kdocSchema.node('paragraph', null, [kdocSchema.text('Prose after code.')]),
      ]);

      const spans = scanDocument(doc);
      // Only words from the paragraphs should be returned; codeBlock identifiers must be excluded.
      expect(spans.map((s) => s.word)).toEqual([
        'Prose',
        'before',
        'code',
        'Prose',
        'after',
        'code',
      ]);
      expect(spans.some((s) => s.word === 'variableName')).toBe(false);
      expect(spans.some((s) => s.word === 'calculateScore')).toBe(false);
    });

    it('identifies all skipped node types and safely ignores skipped atom nodes', () => {
      // Verify that SKIPPED_NODE_TYPES contains all four designated node types.
      expect(SKIPPED_NODE_TYPES.has('codeBlock')).toBe(true);
      expect(SKIPPED_NODE_TYPES.has('frontMatter')).toBe(true);
      expect(SKIPPED_NODE_TYPES.has('unknownBlock')).toBe(true);
      expect(SKIPPED_NODE_TYPES.has('unknownInline')).toBe(true);

      // Note: in kdocSchema, codeBlock is the only skipped node type that accepts plain text child nodes (content: 'text*').
      // The remaining skipped types (frontMatter, unknownBlock, unknownInline) are defined as atoms (atom: true)
      // without text content holes, storing raw strings in node attributes (attrs.value or attrs.node).
      const docWithAtoms = kdocSchema.node('doc', null, [
        kdocSchema.node('frontMatter', { format: 'yaml', value: 'title: Skipped Front Matter' }),
        kdocSchema.node('paragraph', null, [
          kdocSchema.text('Natural prose '),
          kdocSchema.node('unknownInline', { node: { type: 'html', value: '<code>raw</code>' } }),
          kdocSchema.text(' continues here.'),
        ]),
        kdocSchema.node('unknownBlock', { node: { type: 'html', value: '<div>ignored</div>' } }),
      ]);

      const spans = scanDocument(docWithAtoms);
      expect(spans.map((s) => s.word)).toEqual([
        'Natural',
        'prose',
        'continues',
        'here',
      ]);
    });

    it('skips text carrying the inlineCode mark, verifying against SKIPPED_MARK_TYPES', () => {
      // Verify that 'inlineCode' is registered in SKIPPED_MARK_TYPES rather than hard-coding the name twice.
      expect(SKIPPED_MARK_TYPES.has('inlineCode')).toBe(true);

      const doc = kdocSchema.node('doc', null, [
        kdocSchema.node('paragraph', null, [
          kdocSchema.text('Run the command '),
          kdocSchema.text('npmInstallNow', [kdocSchema.mark('inlineCode')]),
          kdocSchema.text(' in terminal.'),
        ]),
      ]);

      const spans = scanDocument(doc);
      // 'npmInstallNow' carries inlineCode mark and must be skipped.
      expect(spans.map((s) => s.word)).toEqual([
        'Run',
        'the',
        'command',
        'in',
        'terminal',
      ]);
      expect(spans.some((s) => s.word === 'npmInstallNow')).toBe(false);
    });

    it('scans text carrying the link mark while ignoring the URL in href attribute', () => {
      // The link mark is the interesting case for spell checking:
      // The URL lives in the mark's `href` attribute, not in the text content,
      // so skipping marked text would skip the prose the user wrote while leaving the URL unexamined anyway.
      // Therefore, text inside a link mark must be scanned, and the href attribute is not parsed as text.
      const doc = kdocSchema.node('doc', null, [
        kdocSchema.node('paragraph', null, [
          kdocSchema.text('Read the '),
          kdocSchema.text('documentation guide', [
            kdocSchema.mark('link', { href: 'https://example.org/path/misspelledurl' }),
          ]),
          kdocSchema.text(' carefully.'),
        ]),
      ]);

      const spans = scanDocument(doc);
      expect(spans.map((s) => s.word)).toEqual([
        'Read',
        'the',
        'documentation',
        'guide',
        'carefully',
      ]);
      // The URL itself in href must not be parsed or included as candidate words.
      expect(spans.some((s) => s.word.includes('example'))).toBe(false);
      expect(spans.some((s) => s.word.includes('misspelledurl'))).toBe(false);
    });

    it('scans text carrying strong or emphasis marks', () => {
      const doc = kdocSchema.node('doc', null, [
        kdocSchema.node('paragraph', null, [
          kdocSchema.text('Plain '),
          kdocSchema.text('boldText', [kdocSchema.mark('strong')]),
          kdocSchema.text(' and '),
          kdocSchema.text('italicText', [kdocSchema.mark('emphasis')]),
          kdocSchema.text(' end.'),
        ]),
      ]);

      const spans = scanDocument(doc);
      expect(spans.map((s) => s.word)).toEqual([
        'Plain',
        'boldText',
        'and',
        'italicText',
        'end',
      ]);
    });

    it('scans text inside a heading node', () => {
      const doc = kdocSchema.node('doc', null, [
        kdocSchema.node('heading', { level: 1 }, [kdocSchema.text('Project Overview')]),
        kdocSchema.node('paragraph', null, [kdocSchema.text('Introduction content.')]),
      ]);

      const spans = scanDocument(doc);
      expect(spans.map((s) => s.word)).toEqual([
        'Project',
        'Overview',
        'Introduction',
        'content',
      ]);
    });

    it('maintains correct positions across multiple blocks resolving back via doc.textBetween', () => {
      const doc = kdocSchema.node('doc', null, [
        kdocSchema.node('paragraph', null, [kdocSchema.text('First block content.')]),
        kdocSchema.node('paragraph', null, [kdocSchema.text('Second block content.')]),
      ]);

      const spans = scanDocument(doc);

      // Locate the word 'Second' in the second paragraph.
      const secondSpan = spans.find((s) => s.word === 'Second');

      // Check if secondSpan is defined to satisfy strict noUncheckedIndexedAccess.
      if (secondSpan !== undefined) {
        // Crucial assertion: resolving the document text slice between from and to must yield exactly 'Second'.
        // This is the assertion that actually protects the decorations from landing in the wrong place.
        const resolvedWord = doc.textBetween(secondSpan.from, secondSpan.to);
        expect(resolvedWord).toBe('Second');
        expect(resolvedWord).toBe(secondSpan.word);
      } else {
        // Span was unexpectedly missing: fail test immediately.
        expect.fail('Expected to find word span for "Second" in the second paragraph');
      }

      // Verify that every scanned span resolves back to its exact word in the document via doc.textBetween.
      for (let i = 0; i < spans.length; i++) {
        const span = spans[i];
        // Check if the span at index i is defined to satisfy strict noUncheckedIndexedAccess.
        if (span === undefined) {
          // Unchecked index element is undefined: skip iteration.
          continue;
        } else {
          // Span element is defined: verify that doc.textBetween resolves to span.word.
        }
        expect(doc.textBetween(span.from, span.to)).toBe(span.word);
      }
    });

    it('yields an empty array for an empty document', () => {
      const emptyDoc = kdocSchema.node('doc', null, [
        kdocSchema.node('paragraph', null, []),
      ]);
      expect(scanDocument(emptyDoc)).toEqual([]);
    });

    it('extracts word spans from an EditorState identical to scanDocument', () => {
      const doc = kdocSchema.node('doc', null, [
        kdocSchema.node('paragraph', null, [kdocSchema.text('Scanning editor state.')]),
      ]);
      const state = createTestState(doc);
      const stateSpans = scanState(state);
      const docSpans = scanDocument(doc);

      expect(stateSpans).toEqual(docSpans);
      expect(stateSpans.map((s) => s.word)).toEqual([
        'Scanning',
        'editor',
        'state',
      ]);
    });
  });
});
