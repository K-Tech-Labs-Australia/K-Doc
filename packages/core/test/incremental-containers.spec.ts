/**
 * @file incremental-containers.spec.ts
 * @purpose Verifies FR-4.2 splices inside blockquotes, lists inside blockquotes, the blocks of an edited list item, and lists numbered with ')', each keeping untouched bytes.
 * @inputs Parsed mdast Root trees from parseMarkdown; line-prefix helpers (continuationPrefix, indentContinuation, itemContentPrefix) from serialize/line-prefix.js; edit callbacks that mutate a cloned tree.
 * @outputs Serialized incremental text and replaced byte ranges per case; round-trip assertions comparing reparsed output against the edited tree.
 * @functions
 *   - shape: Serialize an mdast value with position stripped so trees compare by structure alone.
 *   - nodeAt: Walk a numeric path from the root to return the named child node.
 *   - setText: Set the value of the text node at a given path.
 *   - paragraph: Build a minimal Paragraph node wrapping a single text child.
 *   - childrenAt: Return the mutable children array of a parent node at a given path.
 *   - run: Parse, edit via callback, serialize incrementally, and assert round-trip fidelity.
 * @dataflow parseMarkdown source → Root tree → edit callback mutates clone → serializeIncremental produces text/ranges → reparse compares against edited tree.
 * @controlflow Module load → describe blocks register cases → each it() runs run() or direct helper calls → expect() asserts byte-exact output.
 * @version 1
 * @date 2026-09-15
 */

import type { ListItem, Paragraph, Parent, Root, RootContent } from 'mdast';
import { describe, expect, it } from 'vitest';
import { parseMarkdown, serializeIncremental } from '../src/index.js';
import { continuationPrefix, indentContinuation, itemContentPrefix } from '../src/serialize/line-prefix.js';

/**
 * @purpose Serialize an mdast value with position stripped so trees compare by structure alone.
 * @inputs value - The mdast node or tree to stringify.
 * @outputs string - JSON representation of the value without any position fields.
 * @dataflow Input node → JSON.stringify replacer drops 'position' keys → structural JSON string.
 * @controlflow Invoke replacer on every key; return undefined for 'position', otherwise pass value through.
 */
function shape(value: unknown): string {
  // Drop `position` so trees compare by structure alone.
  return JSON.stringify(value, (key: string, v: unknown): unknown => (key === 'position' ? undefined : v));
}

/**
 * @purpose Resolve a numeric child path from the root and return the target node.
 * @inputs root - The mdast Root to descend into. path - Ordered list of child indices.
 * @outputs RootContent - The node located at the final index in path.
 * @dataflow Root → for each index, index into children → descend → return terminal node.
 * @controlflow Loop over indices; throw if any step names a missing child or if the root itself is returned.
 */
function nodeAt(root: Root, path: readonly number[]): RootContent {
  let node: Root | RootContent = root;
  for (const index of path) {
    const children: readonly RootContent[] = 'children' in node ? (node as Parent).children : [];
    const next = children[index];
    // Each step of the path must name an existing child.
    if (next === undefined) {
      throw new Error(`no child ${index} in path ${path.join('.')}`);
    } else {
      node = next;
    }
  }
  // The root itself is never a valid target.
  if (node.type === 'root') {
    throw new Error('empty path');
  } else {
    return node;
  }
}

/**
 * @purpose Assign a new value to the text node located at a given path.
 * @inputs root - The mdast Root containing the target node. path - Numeric path to the text node. value - New text content.
 * @outputs void - Mutates the target text node's value in place.
 * @dataflow Path → nodeAt lookup → assign value onto the resolved text node.
 * @controlflow Resolve node; throw unless it is a 'text' node, then set its value.
 */
function setText(root: Root, path: readonly number[], value: string): void {
  const node = nodeAt(root, path);
  // The path must end at a text node.
  if (node.type !== 'text') {
    throw new Error(`expected text at ${path.join('.')}, found ${node.type}`);
  } else {
    node.value = value;
  }
}

/**
 * @purpose Construct a minimal Paragraph node wrapping a single text child.
 * @inputs value - The text content for the paragraph's only child.
 * @outputs Paragraph - A fresh paragraph node with one text child holding value.
 * @dataflow Input string → text node → paragraph node containing it.
 * @controlflow Build nested objects and return without branching.
 */
function paragraph(value: string): Paragraph {
  return { type: 'paragraph', children: [{ type: 'text', value }] };
}

/**
 * @purpose Return the mutable children array of a parent node at a given path.
 * @inputs root - The mdast Root to descend into. path - Numeric path to the parent node.
 * @outputs RootContent[] - The children array owned by the resolved parent node.
 * @dataflow Path → nodeAt lookup → return that node's children array for in-place editing.
 * @controlflow Resolve node; throw unless it is a parent (has a children property).
 */
function childrenAt(root: Root, path: readonly number[]): RootContent[] {
  const node = nodeAt(root, path);
  // Only a parent node has children to edit.
  if (!('children' in node)) {
    throw new Error(`no children at ${path.join('.')}`);
  } else {
    return (node as Parent).children;
  }
}

/**
 * @purpose Parse source, apply an edit callback to a clone, serialize incrementally, and assert round-trip fidelity.
 * @inputs source - Original markdown text. edit - Callback that mutates the cloned Root tree.
 * @outputs { text: string; ranges: readonly { start: number; end: number }[] } - Serialized output and replaced byte ranges.
 * @dataflow Source → parseMarkdown → clone → edit callback → serializeIncremental → round-trip reparse → assertion.
 * @controlflow Parse original, deep-clone it, run the edit, serialize, then assert the reparsed edited tree matches; return text and ranges.
 */
function run(source: string, edit: (root: Root) => void): { text: string; ranges: readonly { start: number; end: number }[] } {
  const original = parseMarkdown(source);
  const updated = structuredClone(original.root);
  edit(updated);
  const result = serializeIncremental(original, updated);
  // Every case also proves the output reads back as the edited tree.
  expect(shape(parseMarkdown(result.text).root.children)).toBe(shape(updated.children));
  return { text: result.text, ranges: result.replacedRanges };
}

describe('line prefixes', () => {
  it('keeps quote marks and turns list markers into spaces', () => {
    expect(continuationPrefix('> - a', 4)).toBe('>   ');
    expect(continuationPrefix('para', 0)).toBe('');
    expect(continuationPrefix('x\n  - b', 4)).toBe('  ');
    expect(continuationPrefix('>\tb', 2)).toBe('>\t');
  });
  it('measures an item marker and its gap', () => {
    expect(itemContentPrefix('- a', 0)).toBe('  ');
    expect(itemContentPrefix('> 10) a', 2)).toBe('>     ');
    expect(itemContentPrefix('-   a', 0)).toBe('    ');
    expect(itemContentPrefix('-\n  a', 0)).toBe('  ');
    expect(itemContentPrefix('-      code', 0)).toBe('  ');
    expect(itemContentPrefix('text', 0)).toBe('');
  });
  it('prefixes every line after the first, and blank lines without trailing spaces', () => {
    expect(indentContinuation('a\n\nb', '> ')).toBe('a\n>\n> b');
    expect(indentContinuation('- a\n  b', '  ')).toBe('- a\n    b');
    expect(indentContinuation('a\r\n\r\nb', '  ')).toBe('a\r\n\r\n  b');
    expect(indentContinuation('x\ny', '')).toBe('x\ny');
  });
});

describe('inside a blockquote', () => {
  it('keeps the untouched paragraph when another changes', () => {
    const { text, ranges } = run('> *keep* this\n>\n> change me\n', (root) => { setText(root, [0, 1, 0], 'changed'); });
    expect(text).toBe('> *keep* this\n>\n> changed\n');
    expect(ranges).toEqual([{ start: 18, end: 27 }]);
  });
  it('puts the quote mark on every line of a changed paragraph', () => {
    const { text } = run('> *a*\n>\n> b\n', (root) => { setText(root, [0, 1, 0], 'b1\nb2'); });
    expect(text).toBe('> *a*\n>\n> b1\n> b2\n');
  });
  it('inserts a paragraph spaced like its neighbours', () => {
    const { text } = run('> *a*\n>\n> b\n', (root) => { childrenAt(root, [0]).push(paragraph('new')); });
    expect(text).toBe('> *a*\n>\n> b\n>\n> new\n');
  });
  it('inserts before the first paragraph', () => {
    const { text } = run('> *a*\n>\n> b\n', (root) => { childrenAt(root, [0]).unshift(paragraph('new')); });
    expect(text).toBe('> new\n>\n> *a*\n>\n> b\n');
  });
  it('inserts into a one-paragraph quote with a blank quoted line', () => {
    const { text } = run('> *a*\n', (root) => { childrenAt(root, [0]).push(paragraph('new')); });
    expect(text).toBe('> *a*\n>\n> new\n');
  });
  it('deletes a paragraph and one separator', () => {
    expect(run('> a\n>\n> *b*\n', (root) => { childrenAt(root, [0]).splice(0, 1); }).text).toBe('> *b*\n');
    expect(run('> *a*\n>\n> b\n', (root) => { childrenAt(root, [0]).splice(1, 1); }).text).toBe('> *a*\n');
  });
  it('keeps the first item of a quoted list when the second changes', () => {
    const { text } = run('> - *a*\n> - b\n', (root) => { setText(root, [0, 0, 1, 0, 0], 'c'); });
    expect(text).toBe('> - *a*\n> - c\n');
  });
  it('adds an item to a one-item quoted list inside the quote', () => {
    const { text } = run('> - *a*\n', (root) => {
      const item = structuredClone(nodeAt(root, [0, 0, 0])) as ListItem;
      delete (item as { position?: unknown }).position;
      item.children = [paragraph('new')];
      childrenAt(root, [0, 0]).push(item);
    });
    expect(text).toBe('> - *a*\n> - new\n');
  });
  it('keeps a nested quote untouched when the outer one changes', () => {
    const { text } = run('> *a*\n>\n> > *b*\n', (root) => { setText(root, [0, 0, 0, 0], 'z'); });
    expect(text).toBe('> _z_\n>\n> > *b*\n');
  });
  it('rewrites a quote whose added paragraph would join the list above it', () => {
    const { text } = run('> a\n> - b\n', (root) => { childrenAt(root, [0]).push(paragraph('new')); });
    expect(text).toBe('> a\n>\n> - b\n>\n> new\n');
  });
  it('splices inside a nested quote, keeping both quotes untouched parts', () => {
    const { text } = run('> *a*\n>\n> > *b*\n> >\n> > c\n', (root) => { setText(root, [0, 1, 1, 0], 'changed'); });
    expect(text).toBe('> *a*\n>\n> > *b*\n> >\n> > changed\n');
  });
  it('indents every line of an item added to a quoted list', () => {
    const { text } = run('> - *a*\n', (root) => {
      const item = structuredClone(nodeAt(root, [0, 0, 0])) as ListItem;
      delete (item as { position?: unknown }).position;
      item.children = [paragraph('n1\nn2')];
      childrenAt(root, [0, 0]).push(item);
    });
    expect(text).toBe('> - *a*\n> - n1\n>   n2\n');
  });
  it('keeps an alert marker and first paragraph when a later paragraph changes', () => {
    const { text } = run('> [!NOTE]\n> *keep*\n>\n> change\n', (root) => { setText(root, [0, 1, 0], 'changed'); });
    expect(text).toBe('> [!NOTE]\n> *keep*\n>\n> changed\n');
  });
  it('rewrites an alert whose first paragraph changes', () => {
    const { text } = run('> [!NOTE]\n> *keep*\n', (root) => { setText(root, [0, 0, 1, 0], 'changed'); });
    expect(text.startsWith('> [!NOTE]\n')).toBe(true);
  });
});

describe('inside an edited list item', () => {
  it('keeps a nested list when the item text changes', () => {
    const { text } = run('- a\n  * *x*\n  * y\n', (root) => { setText(root, [0, 0, 0, 0], 'b'); });
    expect(text).toBe('- b\n  * *x*\n  * y\n');
  });
  it('keeps the item and its sibling when a nested item changes', () => {
    const { text } = run('- a\n  * *x*\n  * y\n', (root) => { setText(root, [0, 0, 1, 1, 0, 0], 'z'); });
    expect(text).toBe('- a\n  * *x*\n  * z\n');
  });
  it('keeps the first paragraph when the second changes', () => {
    const { text } = run('1. *keep*\n\n   change\n', (root) => { setText(root, [0, 0, 1, 0], 'changed'); });
    expect(text).toBe('1. *keep*\n\n   changed\n');
  });
  it('indents every line of a changed paragraph to the item content', () => {
    const { text } = run('- *a*\n\n  b\n', (root) => { setText(root, [0, 0, 1, 0], 'b1\nb2'); });
    expect(text).toBe('- *a*\n\n  b1\n  b2\n');
  });
  it('keeps a task checkbox when the task text changes', () => {
    const { text } = run('- [x] task\n', (root) => { setText(root, [0, 0, 0, 0], 'done'); });
    expect(text).toBe('- [x] done\n');
  });
  it('rewrites the item when its checkbox changes', () => {
    const { text } = run('- [x] task\n- [ ] *other*\n', (root) => { (nodeAt(root, [0, 0]) as ListItem).checked = false; });
    expect(text).toBe('- [ ] task\n- [ ] *other*\n');
  });
  it('rewrites a quoted item whose block would parse differently when spliced', () => {
    const { text } = run('- a\n', (root) => { childrenAt(root, [0, 0]).push({ type: 'code', lang: null, meta: null, value: 'x' }); });
    expect(text).toBe('- a\n  ```\n  x\n  ```\n');
  });
});

describe('neighbouring blocks that both changed', () => {
  it('are taken pair by pair when their types match, so each keeps its untouched parts', () => {
    const { text } = run('para *x*\n\n- *a*\n- b\n', (root) => {
      setText(root, [0, 0], 'text ');
      setText(root, [1, 1, 0, 0], 'c');
    });
    expect(text).toBe('text _x_\n\n- *a*\n- c\n');
  });
  it('stay one stretch when a block is added among them', () => {
    const { text } = run('para *x*\n\n- *a*\n- b\n', (root) => {
      setText(root, [0, 0], 'text ');
      setText(root, [1, 1, 0, 0], 'c');
      root.children.push(paragraph('end'));
    });
    expect(text).toBe('text _x_\n\n- _a_\n- c\n\nend\n');
  });
  it('stay one stretch when a type changes, since the separator between them may not suit the new blocks', () => {
    const { text } = run('# h\n2. x\n', (root) => {
      root.children[0] = paragraph('h');
      setText(root, [1, 0, 0, 0], 'y');
    });
    expect(text).toBe('h\n\n2. y\n');
  });
});

describe('lists numbered with a parenthesis', () => {
  it('keeps the delimiter and untouched items when one item changes', () => {
    const { text } = run('1) *a*\n2) b\n', (root) => { setText(root, [0, 1, 0, 0], 'c'); });
    expect(text).toBe('1) *a*\n2) c\n');
  });
  it('numbers an added item with the same delimiter', () => {
    const { text } = run('1) *a*\n2) b\n', (root) => {
      const item = structuredClone(nodeAt(root, [0, 1])) as ListItem;
      delete (item as { position?: unknown }).position;
      item.children = [paragraph('new')];
      childrenAt(root, [0]).push(item);
    });
    expect(text).toBe('1) *a*\n2) b\n3) new\n');
  });
});