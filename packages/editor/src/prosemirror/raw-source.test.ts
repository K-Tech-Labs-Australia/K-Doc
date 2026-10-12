/**
 * @file raw-source.test.ts
 * @purpose Tests rawSourceOf, withRawValue, atEdge and isHistoryKey (FR-7.9).
 * @version 1
 * @date 2026-09-13
 */
import { describe, it, expect } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { rawSourceOf, withRawValue } from './raw-source.js';
import { atEdge, isHistoryKey } from './raw-source-keys.js';

// Build an EditorState positioned at a single caret within doc.
function stateAt(doc: string, anchor: number, head: number = anchor): EditorState {
  return EditorState.create({ doc, selection: EditorSelection.single(anchor, head) });
}

// Build a minimal fake KeyboardEvent (cast through unknown to satisfy the DOM type).
function key(k: string, mods: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}): KeyboardEvent {
  return { key: k, ctrlKey: mods.ctrlKey ?? false, metaKey: mods.metaKey ?? false, shiftKey: mods.shiftKey ?? false } as unknown as KeyboardEvent;
}

describe('rawSourceOf', (): void => {
  // An html node exposes its inner markup as the raw source.
  it('exposes the html node value as raw source', (): void => {
    expect(rawSourceOf({ type: 'html', value: '<div>x</div>' })).toEqual({ text: '<div>x</div>', language: 'html', label: 'HTML' });
  });

  // A kdocRaw that failed to classify is still emitted as raw HTML.
  it('emits unknown-html kdocRaw as html with the Raw label', (): void => {
    const result = rawSourceOf({ type: 'kdocRaw', value: '<x>', reason: 'unknown-html' });
    expect(result).not.toBeNull();
    expect(result?.language).toBe('html');
    expect(result?.label).toBe('Raw');
  });

  // A kdocRaw that failed to parse has no language.
  it('reports null language for a parse-failure kdocRaw', (): void => {
    const result = rawSourceOf({ type: 'kdocRaw', value: '<x>', reason: 'parse-failure' });
    expect(result?.language).toBeNull();
  });

  // A definition node is structure, not a single source string.
  it('returns null for a definition node', (): void => {
    expect(rawSourceOf({ type: 'definition', url: 'x', label: 'a', identifier: 'a' })).toBeNull();
  });

  // A node with a string value that is neither html nor kdocRaw is still not offered as source.
  it('returns null for a value-bearing node of another kind', (): void => {
    expect(rawSourceOf({ type: 'inlineMath', value: 'x^2' })).toBeNull();
  });

  // An html node without a value has no raw source.
  it('returns null when the html node lacks a value', (): void => {
    expect(rawSourceOf({ type: 'html' })).toBeNull();
  });

  // Non-source inputs yield no raw source.
  it('returns null for null, string and array inputs', (): void => {
    expect(rawSourceOf(null)).toBeNull();
    expect(rawSourceOf('text')).toBeNull();
    expect(rawSourceOf([])).toBeNull();
  });
});

describe('withRawValue', (): void => {
  // It returns a new object carrying the new value and preserving other fields.
  it('returns a new object with the updated value and kept fields', (): void => {
    expect(withRawValue({ type: 'html', value: 'a', extra: 1 }, 'b')).toEqual({ type: 'html', value: 'b', extra: 1 });
  });

  // It must not mutate the original node.
  it('does not mutate the input object', (): void => {
    const input = { type: 'html', value: 'a' };
    const result = withRawValue(input, 'b');
    expect(input.value).toBe('a');
    expect(result).not.toBe(input);
  });

  // Non-object inputs are returned unchanged.
  it('returns non-object inputs unchanged', (): void => {
    expect(withRawValue(null, 'b')).toBeNull();
    expect(withRawValue('s', 'b')).toBe('s');
  });
});

describe('atEdge', (): void => {
  // Moving up from the first line is an edge; from later lines it is not.
  it('reports a line-up edge on the first line but not on later lines', (): void => {
    expect(atEdge(stateAt('ab\ncd', 1), -1, 'line')).toBe(true);
    expect(atEdge(stateAt('ab\ncd', 4), -1, 'line')).toBe(false);
  });

  // Moving down from the last line is an edge; from earlier lines it is not.
  it('reports a line-down edge on the last line but not on earlier lines', (): void => {
    expect(atEdge(stateAt('ab\ncd', 4), 1, 'line')).toBe(true);
    expect(atEdge(stateAt('ab\ncd', 1), 1, 'line')).toBe(false);
  });

  // Moving left from offset 0 is an edge; further in it is not.
  it('reports a char-left edge at offset 0 but not at offset 1', (): void => {
    expect(atEdge(stateAt('ab\ncd', 0), -1, 'char')).toBe(true);
    expect(atEdge(stateAt('ab\ncd', 1), -1, 'char')).toBe(false);
  });

  // Moving right at doc length is an edge; before it is not.
  it('reports a char-right edge at doc length but not before it', (): void => {
    expect(atEdge(stateAt('ab\ncd', 5), 1, 'char')).toBe(true);
    expect(atEdge(stateAt('ab\ncd', 4), 1, 'char')).toBe(false);
  });

  // A non-empty selection is never considered an edge.
  it('never reports an edge for a non-empty selection', (): void => {
    // The head sits at offset 0, which would be a left edge were the selection empty.
    expect(atEdge(stateAt('ab\ncd', 2, 0), -1, 'char')).toBe(false);
  });
});

describe('isHistoryKey', (): void => {
  // Modifier+letter combos that map to history actions are recognized.
  it('recognizes ctrl+z, ctrl+shift+Z and meta+y as history keys', (): void => {
    expect(isHistoryKey(key('z', { ctrlKey: true }))).toBe(true);
    expect(isHistoryKey(key('Z', { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isHistoryKey(key('y', { metaKey: true }))).toBe(true);
  });

  // The same letters without a modifier, or an unrelated key, are not.
  it('rejects z without a modifier and ctrl+x', (): void => {
    expect(isHistoryKey(key('z'))).toBe(false);
    expect(isHistoryKey(key('x', { ctrlKey: true }))).toBe(false);
  });
});
