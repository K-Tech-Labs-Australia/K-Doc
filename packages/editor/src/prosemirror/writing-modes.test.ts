// @vitest-environment jsdom
/**
 * @file writing-modes.test.ts
 * @purpose Verifies the prose-mirror focus/writing-modes behavior: block- and sentence-scoped dimming, list-item isolation, off/no-textblock edge cases, plugin refresh redraws, and source-code decoration ranges.
 * @inputs MARKDOWN fixture string; WritingModes focus scopes ('off' | 'paragraph' | 'sentence'); caret positions.
 * @outputs Assertion results comparing rendered decoration text and DOM decoration counts against expected arrays/counts.
 * @functions
 *   - stateAt: Builds an EditorState whose TextSelection caret sits at the first occurrence of needle in any text node.
 *   - dimmedText: Returns the text covered by each focus decoration, with leaf blocks replaced by '#'.
 * @dataflow MARKDOWN → parseMarkdown → mdastToProseMirror → EditorState → focusDecorations → decoration text arrays compared to expectations.
 * @controlflow For each describe block, construct state via helpers, invoke the function under test, and assert equality; edge-case tests build alternate selections before asserting.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseMarkdown } from '@k-doc/core';
import { kdocSchema } from './schema.js';
import { mdastToProseMirror } from './from-mdast.js';
import { createWritingModesPlugin, focusDecorations, refreshWritingModesIn, FOCUS_DIM_CLASS } from './writing-modes.js';
import type { WritingModes } from './writing-modes.js';
import { sourceFocusDecorations } from '../codemirror/writing-modes.js';

const MARKDOWN = '# Title\n\nFirst one. Second two.\n\n- item\n\n---\n';

// stateAt builds a state with the caret at the start of the first text containing needle.
function stateAt(needle: string): EditorState {
  const doc = mdastToProseMirror(parseMarkdown(MARKDOWN).root, kdocSchema);
  let pos = -1;
  doc.descendants((node, at) => {
    if (pos < 0 && node.isText && node.text !== undefined && node.text.includes(needle)) {
      pos = at + node.text.indexOf(needle);
    }
    return pos < 0;
  });
  return EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
}

// dimmedText lists the text under each focus decoration, '#' standing for a leaf block.
function dimmedText(state: EditorState, scope: WritingModes['focus']): string[] {
  return focusDecorations(state, scope)
    .find()
    .sort((a, b) => a.from - b.from)
    .map((decoration) => state.doc.textBetween(decoration.from, decoration.to, '|', '#'));
}

describe('focusDecorations', () => {
  // The caret's paragraph stays lit, the heading, list item and rule fade.
  it('dims every other block in paragraph scope', () => {
    expect(dimmedText(stateAt('Second'), 'paragraph')).toEqual(['Title', 'item', '#']);
  });

  // The other sentence fades inline as well.
  it('also dims the rest of the active paragraph in sentence scope', () => {
    expect(dimmedText(stateAt('Second'), 'sentence')).toEqual(['Title', 'First one. ', 'item', '#']);
    expect(dimmedText(stateAt('First'), 'sentence')).toEqual(['Title', ' Second two.', 'item', '#']);
  });

  // The list item's paragraph is lit and the list around it is not decorated.
  it('focuses a list item paragraph without fading its list', () => {
    expect(dimmedText(stateAt('item'), 'paragraph')).toEqual(['Title', 'First one. Second two.', '#']);
  });

  // Off draws nothing, and a selected rule has no textblock so all blocks fade.
  it('dims nothing when off, and every block when no textblock holds the caret', () => {
    expect(focusDecorations(stateAt('Second'), 'off').find()).toEqual([]);
    const state = stateAt('Title');
    let rule = -1;
    state.doc.forEach((node, offset) => {
      if (node.type.name === 'thematicBreak' || node.type.name === 'horizontal_rule') {
        rule = offset;
      }
    });
    const selected = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, rule)));
    expect(dimmedText(selected, 'sentence')).toEqual(['Title', 'First one. Second two.', 'item', '#']);
  });
});

describe('focusDecorations with a selected node', () => {
  it('dims every block, including the paragraph that starts where the selected node ends', () => {
    // A selected list item or rule leaves no textblock to focus, even when the next paragraph begins at the selection's end.
    const doc = mdastToProseMirror(parseMarkdown('- one\n- two\n\n---\n\nAfter.\n').root, kdocSchema);
    const base = EditorState.create({ doc });
    const texts = (state: EditorState): string[] =>
      focusDecorations(state, 'sentence')
        .find()
        .sort((a, b) => a.from - b.from)
        .map((decoration) => state.doc.textBetween(decoration.from, decoration.to, '|', '#'));
    const list = doc.child(0);
    const secondItem = 1 + (list.firstChild?.nodeSize ?? 0);
    expect(texts(base.apply(base.tr.setSelection(NodeSelection.create(doc, secondItem))))).toEqual(['one', 'two', '#', 'After.']);
    const rule = list.nodeSize;
    expect(texts(base.apply(base.tr.setSelection(NodeSelection.create(doc, rule))))).toEqual(['one', 'two', '#', 'After.']);
  });
});

describe('createWritingModesPlugin', () => {
  // Toggling through the getter then refreshing redraws, and a later edit still works.
  it('draws the modes the getter reports after a refresh', () => {
    let modes: WritingModes = { focus: 'off', typewriter: false };
    const view = new EditorView(document.body.appendChild(document.createElement('div')), {
      state: EditorState.create({ doc: stateAt('Second').doc, plugins: [createWritingModesPlugin(() => modes)] }),
    });
    expect(view.dom.querySelectorAll(`.${FOCUS_DIM_CLASS}`).length).toBe(0);
    modes = { focus: 'paragraph', typewriter: true };
    refreshWritingModesIn(view);
    expect(view.dom.querySelectorAll(`.${FOCUS_DIM_CLASS}`).length).toBe(3);
    view.dispatch(view.state.tr.insertText('x', 3));
    view.destroy();
  });
});

describe('sourceFocusDecorations', () => {
  // Source marks cover everything outside the focus range.
  it('dims the Markdown before and after the caret paragraph or sentence', () => {
    const text = 'One.\n\nTwo a. Two b.\n\nThree.';
    const ranges = (scope: WritingModes['focus'], head: number): [number, number][] => {
      const found: [number, number][] = [];
      sourceFocusDecorations(text, head, scope).between(0, text.length, (from, to) => {
        found.push([from, to]);
      });
      return found;
    };
    expect(ranges('paragraph', text.indexOf('Two b'))).toEqual([[0, 6], [19, text.length]]);
    expect(ranges('sentence', text.indexOf('Two b'))).toEqual([[0, 13], [19, text.length]]);
    expect(ranges('paragraph', 1)).toEqual([[4, text.length]]);
    expect(ranges('paragraph', text.length)).toEqual([[0, 21]]);
    expect(ranges('off', 3)).toEqual([]);
  });
});
