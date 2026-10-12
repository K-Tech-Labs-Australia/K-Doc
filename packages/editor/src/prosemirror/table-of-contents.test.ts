// @vitest-environment jsdom
/**
 * @file table-of-contents.test.ts
 * @purpose Verifies inserting and refreshing a table of contents in the WYSIWYG document and its Markdown form (FR-8.30).
 * @inputs Markdown fixtures; ProseMirror editor state helpers.
 * @outputs vitest assertions covering insertTableOfContents, refreshTableOfContents, and documentHeadings.
 * @functions
 *   - stateOf: Builds an EditorState from a Markdown string with an optional caret position.
 *   - markdownOf: Serializes an EditorState's document back to Markdown.
 *   - run: Applies a ProseMirror command to an editor state and returns the applied flag and next state.
 * @dataflow Markdown -> ProseMirror -> command -> Markdown.
 * @controlflow describe per command; each it asserts insertion, refresh, or heading extraction behavior.
 * @version 1
 * @date 2026-09-15
 */

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { parseMarkdown, serializeDocument } from '@k-doc/core';
import { kdocSchema } from './schema.js';
import { mdastToProseMirror } from './from-mdast.js';
import { proseMirrorToMdast } from './to-mdast.js';
import { documentHeadings, findTableOfContents, hasTableOfContents, insertTableOfContents, refreshTableOfContents } from './table-of-contents.js';

/**
 * Build an EditorState from a Markdown string with the caret placed after a target substring.
 * @purpose Parses Markdown into a ProseMirror document and positions the selection near a marker node.
 * @inputs markdown - Source Markdown text; caretAfter - Optional substring whose end becomes the caret position.
 * @outputs EditorState - A state whose doc is parsed from markdown and whose selection sits at the computed position.
 * @dataflow Markdown -> parseMarkdown -> mdastToProseMirror -> EditorState with TextSelection.
 * @controlflow Parse then walk descendants to find the marker; return a near selection, or a default selection when no marker.
 */
function stateOf(markdown: string, caretAfter?: string): EditorState {
  const doc = mdastToProseMirror(parseMarkdown(markdown).root, kdocSchema);
  let pos = 0;
  // Place the caret after the marker substring only when one is supplied.
  if (caretAfter !== undefined) {
    doc.descendants((node, nodePos) => {
      // Advance pos past the marker once its exact text match is found at the top of the walk.
      if (pos === 0 && node.isText && node.text === caretAfter) { pos = nodePos + caretAfter.length; } else { /* Marker not matched here; keep walking. */ }
      return pos === 0;
    });
  } else { /* No marker supplied: leave the selection at the default position (pos 0). */ }
  return EditorState.create({ doc, selection: TextSelection.near(doc.resolve(pos)), schema: kdocSchema });
}

/**
 * Serialize an editor state's document back to Markdown.
 * @purpose Converts a ProseMirror document into its canonical Markdown representation for assertions.
 * @inputs state - The editor state whose document is serialized.
 * @outputs string - The serialized Markdown document with empty text and no front matter.
 * @dataflow state.doc -> proseMirrorToMdast -> serializeDocument -> Markdown string.
 * @controlflow Single transformation path with no branching.
 */
function markdownOf(state: EditorState): string {
  return serializeDocument({ text: '', root: proseMirrorToMdast(state.doc), frontMatter: null });
}

/**
 * Apply a ProseMirror command to an editor state.
 * @purpose Executes a command and captures whether it applied along with the resulting state.
 * @inputs state - The starting editor state; command - The command to run.
 * @outputs { applied, next } - Whether the command modified the state and the resulting editor state.
 * @dataflow command(state, apply) -> state.apply(tr) -> next state.
 * @controlflow Initialize next to state; invoke the command with an apply closure that reassigns next; return results.
 */
function run(state: EditorState, command: Command): { applied: boolean; next: EditorState } {
  let next = state;
  const applied = command(state, (tr: Transaction): void => { next = state.apply(tr); });
  return { applied, next };
}

const DOC = '# Guide\n\nIntro text.\n\n## Install\n\n### Windows\n\n## Use\n';

describe('insertTableOfContents', () => {
  it('inserts markers around a nested list of links at the caret', () => {
    const { applied, next } = run(stateOf(DOC, 'Intro text.'), insertTableOfContents(2));
    expect(applied).toBe(true);
    expect(markdownOf(next)).toBe('# Guide\n\nIntro text.\n\n<!-- toc depth=2 -->\n\n- [Guide](#guide)\n  - [Install](#install)\n  - [Use](#use)\n\n<!-- /toc -->\n\n## Install\n\n### Windows\n\n## Use\n');
    expect(hasTableOfContents(next)).toBe(true);
    expect(findTableOfContents(next.doc)?.depth).toBe(2);
  });
  it('refuses a bad depth, a second table of contents, and a document without a heading that deep', () => {
    const state = stateOf(DOC, 'Intro text.');
    expect(insertTableOfContents(0)(state)).toBe(false);
    expect(insertTableOfContents(7)(state)).toBe(false);
    expect(insertTableOfContents(2.5)(state)).toBe(false);
    expect(insertTableOfContents(6)(state)).toBe(true);
    const withToc = run(state, insertTableOfContents(3)).next;
    expect(insertTableOfContents(3)(withToc)).toBe(false);
    expect(insertTableOfContents(1)(stateOf('## Only level two\n'))).toBe(false);
    expect(insertTableOfContents(1)(stateOf('No headings at all.\n'))).toBe(false);
  });
});

describe('refreshTableOfContents', () => {
  const WITH_TOC = '# Guide\n\n<!-- toc depth=2 -->\n\n- [Guide](#guide)\n\n<!-- /toc -->\n\n## Install\n';

  it('rewrites the list from the current headings at the marker depth', () => {
    const { applied, next } = run(stateOf(WITH_TOC), refreshTableOfContents());
    expect(applied).toBe(true);
    expect(markdownOf(next)).toBe('# Guide\n\n<!-- toc depth=2 -->\n\n- [Guide](#guide)\n  - [Install](#install)\n\n<!-- /toc -->\n\n## Install\n');
  });
  it('refuses a list already up to date and a document without markers', () => {
    const fresh = run(stateOf(WITH_TOC), refreshTableOfContents()).next;
    expect(refreshTableOfContents()(fresh)).toBe(false);
    expect(refreshTableOfContents()(stateOf(DOC))).toBe(false);
  });
  it('empties the list when no heading is shallow enough, keeping the markers', () => {
    const { applied, next } = run(stateOf('<!-- toc depth=1 -->\n\n- [Old](#old)\n\n<!-- /toc -->\n\n## Deep\n'), refreshTableOfContents());
    expect(applied).toBe(true);
    expect(markdownOf(next)).toBe('<!-- toc depth=1 -->\n\n<!-- /toc -->\n\n## Deep\n');
  });
  it('uses the default depth for a bare marker and ignores an unclosed one', () => {
    const bare = run(stateOf('<!-- toc -->\n\n<!-- /toc -->\n\n# A\n\n#### D\n'), refreshTableOfContents());
    expect(markdownOf(bare.next)).toBe('<!-- toc -->\n\n- [A](#a)\n\n<!-- /toc -->\n\n# A\n\n#### D\n');
    expect(findTableOfContents(stateOf('<!-- toc -->\n\n# A\n').doc)).toBeNull();
    expect(findTableOfContents(stateOf('<!-- /toc -->\n\n<!-- toc -->\n\n# A\n').doc)).toBeNull();
  });
});

describe('finding the markers', () => {
  it('takes the first start marker when another follows before the end', () => {
    expect(findTableOfContents(stateOf('<!-- toc -->\n\n<!-- toc depth=1 -->\n\n<!-- /toc -->\n\n# A\n').doc)?.depth).toBe(3);
  });
  it('ignores marker text held in a raw block that is not HTML', () => {
    const raw = (type: string, value: string) => kdocSchema.nodes['unknownBlock']?.create({ node: { type, value } });
    const start = raw('math', '<!-- toc -->');
    const end = raw('html', '<!-- /toc -->');
    const heading = kdocSchema.node('heading', { level: 1 }, [kdocSchema.text('A')]);
    if (start === undefined || end === undefined) {
      throw new Error('schema has no unknownBlock');
    } else {
      const doc = kdocSchema.node('doc', null, [start, heading, end]);
      expect(findTableOfContents(doc)).toBeNull();
    }
  });
  it('reports whether a document has a table of contents', () => {
    expect(hasTableOfContents(stateOf(DOC))).toBe(false);
    expect(hasTableOfContents(stateOf('<!-- toc -->\n\n<!-- /toc -->\n'))).toBe(true);
  });
});

describe('documentHeadings', () => {
  it('lists top-level headings with their levels and text', () => {
    expect(documentHeadings(stateOf('# One\n\n> # Quoted\n\n### *Three*\n').doc)).toEqual([{ depth: 1, text: 'One' }, { depth: 3, text: 'Three' }]);
  });
});