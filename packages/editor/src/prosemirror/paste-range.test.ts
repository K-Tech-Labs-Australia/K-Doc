// @vitest-environment jsdom
/**
 * @file paste-range.test.ts
 * @purpose Vitest test suite pinning the document range that pasteContentAt reports (FR-7.4). The defect
 *   these cases exist for was found by running the editor: pasting a TSV, choosing Table from the
 *   paste-options control, and then choosing Unformatted Text. The second choice inserted the text into
 *   the table instead of replacing it, because the range the first paste reported had been read off the
 *   selection after the dispatch — and ProseMirror puts the caret inside a newly inserted block. The end
 *   of a replacement is the old end mapped through the transaction. For an inline paste the two agree,
 *   which is why every test before this one passed.
 * @inputs Plain text, TSV tabular text, and Markdown string payloads; ProseMirror EditorView instances.
 * @outputs Vitest assertions verifying reported PastedRange bounds, replacement behavior, and boolean wrapper parity.
 * @functions
 *   - mount: Builds doc(paragraph(text)), appends a container to document.body, and mounts an EditorView with the caret at the end of the paragraph.
 *   - selectAll: Selects the whole first paragraph's text in the view.
 *   - nodeAt: Returns the document child node at the given index.
 * @dataflow Text fixtures -> mount EditorView -> selectAll -> pasteContentAt / pasteContent -> transaction mapping -> PastedRange assertions.
 * @controlflow Mount EditorView -> select initial range -> execute pasteContentAt / pasteContent -> verify PastedRange coordinates and doc structure -> tear down via afterEach.
 * @version 2
 * @date 2026-09-15
 */

import { describe, expect, it, afterEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { kdocSchema } from './schema.js';
import { changedRange, pasteContentAt, pasteContent, type PastedRange } from './clipboard.js';

const views: EditorView[] = [];
const roots: HTMLElement[] = [];

afterEach((): void => {
  for (let i = 0; i < views.length; i++) {
    const view = views[i];
    // Check if view at current index is defined.
    if (view !== undefined) {
      view.destroy();
    } else {
      // Branch: Undefined view.
    }
  }
  views.length = 0;

  for (let i = 0; i < roots.length; i++) {
    const root = roots[i];
    // Check if root at current index is defined.
    if (root !== undefined) {
      root.remove();
    } else {
      // Branch: Undefined root element.
    }
  }
  roots.length = 0;
});

/**
 * Builds doc(paragraph(text)), appends a container to document.body, and mounts an EditorView.
 *
 * @purpose Mounts an EditorView with an initial paragraph and the caret at the end of the paragraph.
 * @inputs text: string - Initial text content for the paragraph.
 * @outputs Object containing the mounted view (EditorView) and its root element (HTMLElement).
 * @dataflow text -> kdocSchema paragraph -> doc -> EditorState with selection -> EditorView -> registry arrays.
 * @controlflow Create container -> append to body -> build paragraph and doc -> create EditorState with caret at paragraph end -> instantiate EditorView -> record in views and roots arrays -> return view and root.
 */
function mount(text: string): { view: EditorView; root: HTMLElement } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  roots.push(root);

  let paragraphNode: ProseMirrorNode;
  // Check if text is provided for the initial paragraph.
  if (text.length > 0) {
    // Non-empty text: populate paragraph with a text node.
    paragraphNode = kdocSchema.node('paragraph', null, [kdocSchema.text(text)]);
  } else {
    // Empty text: create an empty paragraph node.
    paragraphNode = kdocSchema.node('paragraph', null, []);
  }

  const doc = kdocSchema.node('doc', null, [paragraphNode]);
  const selection = TextSelection.create(doc, 1 + text.length);
  const state = EditorState.create({
    schema: kdocSchema,
    doc,
    selection,
  });

  const view = new EditorView(root, { state });
  views.push(view);
  return { view, root };
}

/**
 * Selects the whole first paragraph's text in the editor view.
 *
 * @purpose Selects the entire text range of the first paragraph node in the document.
 * @inputs view: EditorView - The EditorView whose selection will be updated.
 * @outputs void.
 * @dataflow view.state.doc -> first child content size -> TextSelection.create -> view.dispatch.
 * @controlflow Resolve first child -> construct TextSelection covering paragraph text -> dispatch transaction to view.
 */
function selectAll(view: EditorView): void {
  const firstChild = nodeAt(view, 0);
  // A re-paste replaces a range rather than inserting at a caret, so the interesting cases all start from a selection.
  const tr = view.state.tr.setSelection(
    TextSelection.create(view.state.doc, 1, 1 + firstChild.content.size)
  );
  view.dispatch(tr);
}

/**
 * Returns the document's child node at the specified index.
 *
 * @purpose Retrieves a direct child node from the document root by index without guarding.
 * @inputs view: EditorView - The EditorView containing the document.
 * @inputs index: number - Zero-based child node index.
 * @outputs ProseMirrorNode - The child ProseMirror node at the given index.
 * @dataflow view.state.doc -> child(index) -> ProseMirrorNode.
 * @controlflow Directly returns view.state.doc.child(index).
 */
function nodeAt(view: EditorView, index: number): ProseMirrorNode {
  return view.state.doc.child(index);
}

describe('the range a paste reports', () => {
  // Pins inline plain-text paste reporting the range spanning exactly the inserted characters.
  it('an inline paste reports the text it inserted', () => {
    const { view } = mount('start');
    selectAll(view);

    const range: PastedRange | null = pasteContentAt(view, '', 'hello', 'plain');
    expect(range).not.toBeNull();

    // Check if range is non-null to satisfy strict typing without casts.
    if (range !== null) {
      expect(range.to - range.from).toBe('hello'.length);
      expect(view.state.doc.textBetween(range.from, range.to)).toBe('hello');
    } else {
      // Branch: Unexpected null range.
    }
  });

  // Pins block table paste reporting the full node size of the table rather than an internal cell selection.
  it('a block paste reports the whole block, not a position inside it', () => {
    const { view } = mount('x');
    selectAll(view);

    const range: PastedRange | null = pasteContentAt(view, '', 'a\tb\nc\td', 'table');
    expect(range).not.toBeNull();

    const firstChild = nodeAt(view, 0);
    expect(firstChild.type.name).toBe('table');

    // Check if range is non-null to satisfy strict typing without casts.
    if (range !== null) {
      // This is the assertion the defect would have failed: the selection after a table paste
      // sits in a cell, whose size is a fraction of the table's.
      expect(range.to - range.from).toBe(firstChild.nodeSize);
    } else {
      // Branch: Unexpected null range.
    }
  });

  // A block pasted at the end of a paragraph lands after it, beyond the selection; the range must still cover it.
  it('a block pasted after a paragraph reports that block', () => {
    const { view } = mount('Paste here.');
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));

    const range: PastedRange | null = pasteContentAt(view, '', 'name,city\r\nAda,London', 'markdown');
    expect(range).not.toBeNull();
    // Check the range before reading the document through it.
    if (range !== null) {
      expect(view.state.doc.textBetween(range.from, range.to, '|')).toContain('name,city\nAda,London');
      // Taking the range and pasting it as a table replaces the paragraph rather than adding beside it.
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)));
      expect(pasteContentAt(view, '', 'name,city\r\nAda,London', 'table')).not.toBeNull();
      expect(view.state.doc.textContent).toBe('Paste here.namecityAdaLondon');
    } else {
      // Branch: Unexpected null range.
    }
  });

  // A span inserted by an early step is moved by a later insertion in front of it; the range follows it.
  it('maps a span changed by one step through the steps after it', () => {
    const { view } = mount('abcdef');
    const tr = view.state.tr.insertText('XYZ', 5).insertText('12', 2);
    // The first step put XYZ at 5..8; the second added two characters before it, so it now sits at 7..10, and the range runs from that insertion at 2.
    const range = changedRange(tr, { from: 7, to: 7 });
    expect(range).toEqual({ from: 2, to: 10 });
    expect(tr.doc.textBetween(range.from, range.to)).toBe('12bcdXYZ');
  });

  // Pasted CRLF text reaches the document with LF line breaks.
  it('turns a pasted CRLF into LF', () => {
    const { view } = mount('');
    pasteContentAt(view, '', 'one\r\ntwo\rthree', 'plain');
    expect(view.state.doc.textContent).toBe('one\ntwo\nthree');
  });

  // Pins replacement of a block paste using the reported range, preventing insertion inside the table.
  it('the reported range can be replaced', () => {
    const { view } = mount('x');
    selectAll(view);

    const tsv = 'a\tb\nc\td';
    const tableRange: PastedRange | null = pasteContentAt(view, '', tsv, 'table');
    expect(tableRange).not.toBeNull();

    // Check if initial table range is non-null before replacing.
    if (tableRange !== null) {
      const tr = view.state.tr.setSelection(
        TextSelection.create(view.state.doc, tableRange.from, tableRange.to)
      );
      view.dispatch(tr);

      const plainRange: PastedRange | null = pasteContentAt(view, '', tsv, 'plain');
      expect(plainRange).not.toBeNull();

      let hasTable = false;
      view.state.doc.descendants((node: ProseMirrorNode): void => {
        // Check if node is a table type.
        if (node.type.name === 'table') {
          hasTable = true;
        } else {
          // Branch: Node is not a table.
        }
      });

      // This is the whole point of recording a range: a second reading has to be able to replace the first.
      expect(hasTable).toBe(false);
      expect(view.state.doc.textContent).toContain('a\tb');
    } else {
      // Branch: Unexpected null table range.
    }
  });

  // Pins Markdown paste reporting the range spanning across all parsed block nodes.
  it('a Markdown paste reports its blocks', () => {
    const { view } = mount('start');
    selectAll(view);

    const range: PastedRange | null = pasteContentAt(view, '', '# One\n\n# Two', 'markdown');
    expect(range).not.toBeNull();

    // Check if range is non-null to satisfy strict typing without casts.
    if (range !== null) {
      const text = view.state.doc.textBetween(range.from, range.to, ' ');
      expect(text).toContain('One');
      expect(text).toContain('Two');
    } else {
      // Branch: Unexpected null range.
    }
  });

  // Pins empty or invalid payloads returning null from pasteContentAt.
  it('a paste that inserts nothing reports null', () => {
    const { view } = mount('test');

    expect(pasteContentAt(view, '', '', 'plain')).toBeNull();
    expect(pasteContentAt(view, '', 'not a grid', 'table')).toBeNull();
  });

  // Pins boolean wrapper pasteContent agreeing with the non-null status of pasteContentAt.
  it('the boolean wrapper agrees with the range', () => {
    const { view } = mount('test');

    const text = 'hello';
    const successRange: PastedRange | null = pasteContentAt(view, '', text, 'plain');
    const successBool = pasteContent(view, '', text, 'plain');
    expect(successRange).not.toBeNull();
    expect(successBool).toBe(true);

    // The wrapper exists so most callers need not care about the range, and the two must not drift.
    const failRange: PastedRange | null = pasteContentAt(view, '', '', 'plain');
    const failBool = pasteContent(view, '', '', 'plain');
    expect(failRange).toBeNull();
    expect(failBool).toBe(false);

    const failTableRange: PastedRange | null = pasteContentAt(view, '', 'not a grid', 'table');
    const failTableBool = pasteContent(view, '', 'not a grid', 'table');
    expect(failTableRange).toBeNull();
    expect(failTableBool).toBe(false);
  });
});
