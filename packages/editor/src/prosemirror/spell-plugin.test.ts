/**
 * @file spell-plugin.test.ts
 * @purpose Vitest test suite for K-Doc's spell check ProseMirror decoration layer and query functions (FR-12.1).
 *   Verifies plugin state initialization, metadata updates, position mapping across edits, boundary guards, and readers.
 * @inputs EditorState instances initialized with kdocSchema, candidate WordSpan fixtures, and ProseMirror transactions.
 * @outputs Vitest assertions verifying WordSpan queries, decoration mappings, out-of-bounds guards, and empty clears.
 * @functions
 *   - createTestDoc: Helper creating a standard ProseMirror document with a single paragraph.
 *   - createTestState: Helper creating an EditorState with kdocSchema, test doc, and optional spell plugin.
 * @dataflow WordSpan fixtures -> setMisspellings(tr) -> state.apply -> misspellingAt / misspellingsIn queries -> Vitest expect assertions.
 * @controlflow Test uninstalled plugin fallback -> test setMisspellings and query accuracy -> test position mapping on edit -> test shrunk doc guard -> test empty array clearing -> test stylesheet constants.
 * @version 1
 * @date 2026-09-06
 */

import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { kdocSchema } from './schema.js';
import type { WordSpan } from './spell-scan.js';
import {
  createSpellPlugin,
  setMisspellings,
  misspellingAt,
  misspellingsIn,
  SPELL_DECORATION_CLASS,
  SPELL_STYLES,
} from './spell-plugin.js';

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
 * Creates an EditorState initialized with kdocSchema and the given document text, optionally including the spell plugin.
 *
 * @purpose Helper to build a real EditorState with kdocSchema and optional createSpellPlugin().
 * @inputs
 *   - text: string - The text string for the test paragraph.
 *   - withPlugin: boolean - Whether to install the spell check plugin in this state.
 * @outputs EditorState - The configured ProseMirror EditorState.
 * @dataflow text + withPlugin -> createTestDoc -> EditorState.create.
 * @controlflow Create doc -> check withPlugin -> configure plugins array -> return EditorState.create.
 */
function createTestState(text: string, withPlugin: boolean): EditorState {
  const doc = createTestDoc(text);
  // Check whether the spell plugin should be installed on this test state.
  if (withPlugin) {
    // Plugin requested: install createSpellPlugin().
    return EditorState.create({
      doc,
      schema: kdocSchema,
      plugins: [createSpellPlugin()],
    });
  } else {
    // Plugin not requested: create state without spell plugin.
    return EditorState.create({
      doc,
      schema: kdocSchema,
      plugins: [],
    });
  }
}

describe('spell-plugin', () => {
  const sampleText = 'The quikc brown fox jumpz over lazy dog';
  // Position mapping in ProseMirror doc:
  // Position 0 is before <doc>
  // Position 1 is before 'The...' inside <paragraph>
  // 'quikc' is from character index 4 to 9 -> document positions 5 to 10
  // 'jumpz' is from character index 20 to 25 -> document positions 21 to 26

  it('tolerates the plugin being absent from state returning null / []', () => {
    const stateWithout = createTestState(sampleText, false);

    // misspellingAt must return null when plugin is not installed
    const atResult = misspellingAt(stateWithout, 7);
    // Check if result is null as expected when plugin is uninstalled.
    if (atResult === null) {
      expect(atResult).toBeNull();
    } else {
      expect.fail('misspellingAt should return null when plugin is absent');
    }

    // misspellingsIn must return [] when plugin is not installed
    const inResult = misspellingsIn(stateWithout);
    // Check if result array is empty as expected when plugin is uninstalled.
    if (inResult.length === 0) {
      expect(inResult).toEqual([]);
    } else {
      expect.fail('misspellingsIn should return empty array when plugin is absent');
    }
  });

  it('records misspellings via setMisspellings and queries them accurately', () => {
    const state = createTestState(sampleText, true);

    // Initial state before dispatching misspellings should have empty list
    expect(misspellingsIn(state)).toEqual([]);

    const spans: readonly WordSpan[] = [
      { from: 5, to: 10, word: 'quikc' },
      { from: 21, to: 26, word: 'jumpz' },
    ];

    const tr = setMisspellings(state.tr, spans);
    const updatedState = state.apply(tr);

    // misspellingsIn returns all spans in document order
    expect(misspellingsIn(updatedState)).toEqual(spans);

    // misspellingAt inside 'quikc' (pos 7) returns the span
    const hitQuikc = misspellingAt(updatedState, 7);
    // Check if hitQuikc is found.
    if (hitQuikc !== null) {
      expect(hitQuikc).toEqual({ from: 5, to: 10, word: 'quikc' });
    } else {
      expect.fail('misspellingAt inside span should not be null');
    }

    // misspellingAt inside 'jumpz' (pos 23) returns the span
    const hitJumpz = misspellingAt(updatedState, 23);
    // Check if hitJumpz is found.
    if (hitJumpz !== null) {
      expect(hitJumpz).toEqual({ from: 21, to: 26, word: 'jumpz' });
    } else {
      expect.fail('misspellingAt inside span should not be null');
    }

    // misspellingAt outside any span (pos 2 in 'The', pos 15 in 'brown') returns null
    expect(misspellingAt(updatedState, 2)).toBeNull();
    expect(misspellingAt(updatedState, 15)).toBeNull();
  });

  it('survives an unrelated edit with positions shifted correctly via mapping', () => {
    const state = createTestState(sampleText, true);
    const spans: readonly WordSpan[] = [
      { from: 5, to: 10, word: 'quikc' },
      { from: 21, to: 26, word: 'jumpz' },
    ];

    const stateWithSpans = state.apply(setMisspellings(state.tr, spans));

    // Insert text 'PREFIX ' (length 7) before the first span at document position 1
    const prefix = 'PREFIX ';
    const editTr = stateWithSpans.tr.insertText(prefix, 1);
    const mappedState = stateWithSpans.apply(editTr);

    const expectedSpans: readonly WordSpan[] = [
      { from: 5 + prefix.length, to: 10 + prefix.length, word: 'quikc' },
      { from: 21 + prefix.length, to: 26 + prefix.length, word: 'jumpz' },
    ];

    // Assert that the spans survived and shifted by the inserted length
    expect(misspellingsIn(mappedState)).toEqual(expectedSpans);

    // Querying at the new shifted position (7 + 7 = 14) finds 'quikc'
    expect(misspellingAt(mappedState, 7 + prefix.length)).toEqual({
      from: 12,
      to: 17,
      word: 'quikc',
    });

    // Outside the spans returns null
    expect(misspellingAt(mappedState, 2)).toBeNull();
  });

  it('drops a span past the end of a shrunk document rather than throwing', () => {
    const state = createTestState(sampleText, true);
    const docSize = state.doc.content.size;

    // Spans where the second span extends beyond the document end
    const spansWithOutOfBound: readonly WordSpan[] = [
      { from: 5, to: 10, word: 'quikc' },
      { from: docSize + 5, to: docSize + 15, word: 'pastEnd' },
    ];

    // Check that applying transaction does not throw and skips the out-of-bounds span
    expect(() => {
      const tr = setMisspellings(state.tr, spansWithOutOfBound);
      const nextState = state.apply(tr);
      const surviving = misspellingsIn(nextState);

      // Only the in-bounds span should be retained
      expect(surviving).toEqual([{ from: 5, to: 10, word: 'quikc' }]);
    }).not.toThrow();
  });

  it('clears all misspellings when an empty span array is dispatched', () => {
    const state = createTestState(sampleText, true);
    const spans: readonly WordSpan[] = [
      { from: 5, to: 10, word: 'quikc' },
      { from: 21, to: 26, word: 'jumpz' },
    ];

    const stateWithSpans = state.apply(setMisspellings(state.tr, spans));
    expect(misspellingsIn(stateWithSpans).length).toBe(2);

    // Dispatch empty array to clear all misspellings
    const clearTr = setMisspellings(stateWithSpans.tr, []);
    const clearedState = stateWithSpans.apply(clearTr);

    expect(misspellingsIn(clearedState)).toEqual([]);
    expect(misspellingAt(clearedState, 7)).toBeNull();
    expect(misspellingAt(clearedState, 23)).toBeNull();
  });

  it('exports valid stylesheet constants and decoration class name', () => {
    expect(SPELL_DECORATION_CLASS).toBe('kdoc-misspelled');
    expect(SPELL_STYLES).toContain('.kdoc-misspelled');
    expect(SPELL_STYLES).toContain('text-decoration: underline wavy');
    expect(SPELL_STYLES).toContain('text-decoration-skip-ink: none');
    expect(SPELL_STYLES).toContain('text-underline-offset:');
  });
});
