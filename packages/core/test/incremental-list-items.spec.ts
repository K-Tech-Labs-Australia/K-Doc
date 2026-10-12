/**
 * @file incremental-list-items.spec.ts
 * @purpose Verifies FR-4.2: editing, inserting, or deleting a single item of a top-level list leaves every other item's bytes untouched in K-Doc's incremental serializer.
 * @inputs Markdown source strings and edit callbacks that mutate an mdast Root in place.
 * @outputs A Vitest spec covering the listMarker reader plus item-level splice fidelity through run().
 * @functions
 *   - shape: Serializes a value to JSON with the `position` field stripped for structural comparison.
 *   - listAt: Returns the top-level List node at a document index, throwing when it is not a list.
 *   - setItemText: Overwrites the text of a list item's first paragraph in place.
 *   - itemLike: Clones a list item with new text and no position, like a WYSIWYG-built node.
 *   - run: Parses, edits a clone, serializes incrementally, asserts read-back fidelity, and returns text plus replaced ranges.
 * @dataflow Markdown source -> parseMarkdown -> edit callback mutates a cloned root -> serializeIncremental -> shape equality check -> { text, ranges }.
 * @controlflow Define helpers; describe listMarker behavior; describe single-item edits; describe insert/delete splices; describe whole-list fallbacks, each asserting byte-level sibling preservation.
 * @version 2
 * @date 2026-09-15
 */

import type { List, ListItem, Paragraph, Root, Text } from 'mdast';
import { describe, expect, it } from 'vitest';
import { parseMarkdown, serializeIncremental } from '../src/index.js';
import { checkFidelity } from '../src/fidelity/fidelity-check.js';
import { listMarker } from '../src/serialize/list-marker.js';

/**
 * Serializes a value for structural comparison, dropping the mdast `position` field.
 * @purpose Produces a stable JSON string of an AST subtree so two trees compare equal without position noise.
 * @inputs value - The arbitrary value to serialize (typically an mdast node or array of nodes).
 * @outputs A JSON string with every `position` key omitted.
 * @dataflow value -> JSON.stringify with a replacer that drops `position` keys -> serialized string.
 * @controlflow For each visited key, return undefined when the key is `position` (removing it); otherwise return the raw value unchanged.
 */
function shape(value: unknown): string {
  // When the current key is `position`, drop it from the output; otherwise keep the raw value so only position noise is removed.
  return JSON.stringify(value, (key: string, v: unknown): unknown => (key === 'position' ? undefined : v));
}

/**
 * Returns the list node at a given index within a document's children.
 * @purpose Locates a top-level list by its position in the document so tests can mutate it directly.
 * @inputs root - The parsed mdast Root whose children are inspected.
 * @inputs index - The zero-based index of the desired list among `root.children`.
 * @outputs The List node found at that index.
 * @dataflow root.children[index] -> type check -> List node or thrown error.
 * @controlflow Read the child; if it is undefined or not a 'list', throw an Error; otherwise return it.
 */
function listAt(root: Root, index = 0): List {
  const node = root.children[index];
  // Guard clause: reject a missing child or any non-list node so callers never receive an unexpected type later.
  if (node === undefined || node.type !== 'list') {
    throw new Error('expected a list');
  }
  // Fall-through: the child is a valid list; hand it back to the caller.
  return node;
}

/**
 * Replaces the text content of a list item's first paragraph with a new value.
 * @purpose Mutates an existing ListItem in place so its visible text changes without rebuilding the node.
 * @inputs item - The list item whose text should be replaced.
 * @inputs value - The new text string to store as the item's only text node.
 * @outputs void; the `item` is mutated directly.
 * @dataflow item.children[0] (paragraph) -> its first child (text node) -> overwrite `.value`.
 * @controlflow Read the paragraph child; if it is missing or not a paragraph, throw; read the text child; if missing or not text, throw; otherwise assign `value` to the text node.
 */
function setItemText(item: ListItem, value: string): void {
  const paragraph = item.children[0];
  // Guard clause: the first child must be a paragraph holding the item's inline content.
  if (paragraph === undefined || paragraph.type !== 'paragraph') {
    throw new Error('expected a paragraph');
  }
  const text = (paragraph as Paragraph).children[0];
  // Guard clause: the paragraph must begin with a single text node to receive the replacement string.
  if (text === undefined || text.type !== 'text') {
    throw new Error('expected text');
  }
  // Assign the new value onto the existing text node instead of rebuilding the paragraph.
  (text as Text).value = value;
}

/**
 * Builds a copy of a list item carrying new text and no source position, mirroring how a WYSIWYG pane creates items.
 * @purpose Produces a fresh ListItem (cloned from an existing one) with replaced text and the `position` field removed so it can be spliced into a document as a brand-new node.
 * @inputs item - The existing list item to clone as a template.
 * @inputs value - The new text to store in the cloned item's first paragraph.
 * @outputs A new ListItem identical to `item` except for its text and without a `position`.
 * @dataflow structuredClone(item) -> delete position -> setItemText(clone, value) -> returned clone.
 * @controlflow Clone the item; strip its position; overwrite its text via setItemText; return the result.
 */
function itemLike(item: ListItem, value: string): ListItem {
  const copy = structuredClone(item);
  // A freshly built node carries no source offset, matching how the WYSIWYG pane constructs items.
  delete (copy as { position?: unknown }).position;
  setItemText(copy, value);
  return copy;
}

/**
 * Parses a document, applies an edit to its AST, serializes it incrementally, and returns the result text with replaced ranges.
 * @purpose Drives one incremental-serializer scenario: mutate the tree, re-serialize, and assert both the output bytes and that the output reads back as the edited tree.
 * @inputs source - The original Markdown to parse before editing.
 * @inputs edit - A callback that mutates a clone of the parsed root in place.
 * @outputs An object with `text` (the serialized result) and `ranges` (the ranges the serializer replaced).
 * @dataflow parseMarkdown(source).root -> structuredClone -> edit(clone) -> serializeIncremental(original, updated) -> { text, ranges }.
 * @controlflow Parse then clone; apply the edit to the clone; run the incremental serializer; assert output parses back to the edited tree via shape equality; return text and replacedRanges.
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

describe('listMarker', () => {
  // A single test exercises the marker reader across bullet, ordered, and non-marker inputs.
  it('reads bullets, ordered markers, and returns null otherwise', () => {
    expect(listMarker('* a', 0)).toEqual({ kind: 'bullet', marker: '*' });
    expect(listMarker('x\n2. b', 2)).toEqual({ kind: 'ordered', number: 2, delimiter: '.' });
    expect(listMarker('3) c', 0)).toEqual({ kind: 'ordered', number: 3, delimiter: ')' });
    expect(listMarker('text', 0)).toBeNull();
    expect(listMarker('*emph*', 0)).toBeNull();
    expect(listMarker('-', 0)).toEqual({ kind: 'bullet', marker: '-' });
    expect(listMarker('1.5 apples', 0)).toBeNull();
  });
});

describe('editing one list item', () => {
  it('keeps a sibling written with a different bullet than the style', () => {
    // Editing item 0 must leave the second item's bytes untouched and replace only its paragraph, after the marker.
    const { text, ranges } = run('* one\n* two\n', (root) => {
      const item = listAt(root).children[0];
      if (item === undefined) throw new Error('no item');
      setItemText(item, 'one!');
    });
    expect(text).toBe('* one!\n* two\n');
    expect(ranges).toEqual([{ start: 2, end: 5 }]);
  });

  it('reports nothing to the Fidelity Check', () => {
    // A single-item edit should produce no fidelity violations against an empty expected set.
    const source = '* one\n* two\n';
    const { text } = run(source, (root) => {
      const item = listAt(root).children[0];
      if (item === undefined) throw new Error('no item');
      setItemText(item, 'one!');
    });
    expect(checkFidelity('* one\n* two\n', text, [])).toEqual([]);
  });

  it('keeps the numbers of an ordered list', () => {
    // Editing a middle item must preserve each sibling's original number.
    const { text } = run('1. a\n2. b\n3. c\n', (root) => {
      const item = listAt(root).children[1];
      if (item === undefined) throw new Error('no item');
      setItemText(item, 'b!');
    });
    expect(text).toBe('1. a\n2. b!\n3. c\n');
  });

  it('keeps line endings around the edited item', () => {
    // CRLF separators on untouched siblings must survive an edit to another item.
    const { text } = run('* a\r\n* b\r\n', (root) => {
      const item = listAt(root).children[0];
      if (item === undefined) throw new Error('no item');
      setItemText(item, 'a!');
    });
    expect(text).toBe('* a!\r\n* b\r\n');
  });

  it('keeps the spacing of a loose list', () => {
    // Blank-line separation between items must be preserved when one item changes.
    const { text } = run('* a\n\n* b\n', (root) => {
      const item = listAt(root).children[1];
      if (item === undefined) throw new Error('no item');
      setItemText(item, 'b!');
    });
    expect(text).toBe('* a\n\n* b!\n');
  });

  it('keeps a sibling with non-canonical spacing', () => {
    // Extra spaces after an untouched sibling's marker must not be normalized away.
    const { text } = run('*   a\n*   b\n', (root) => {
      const item = listAt(root).children[1];
      if (item === undefined) throw new Error('no item');
      setItemText(item, 'b!');
    });
    expect(text.startsWith('*   a\n')).toBe(true);
  });

  it('rewrites only the item holding an edited nested list', () => {
    // Changing a deep leaf must leave the outer trailing sibling's bytes intact.
    const { text } = run('* a\n  * x\n* b\n', (root) => {
      const outer = listAt(root).children[0];
      const inner = outer?.children[1];
      if (inner === undefined || inner.type !== 'list') throw new Error('no nested list');
      const leaf = inner.children[0];
      if (leaf === undefined) throw new Error('no leaf');
      setItemText(leaf, 'x!');
    });
    expect(text.endsWith('\n* b\n')).toBe(true);
  });

  it('ticks a task item without touching the next', () => {
    // Flipping the first task's checkbox must not alter the second task's marker.
    const { text } = run('- [ ] a\n- [x] b\n', (root) => {
      const item = listAt(root).children[0];
      if (item === undefined) throw new Error('no item');
      item.checked = true;
    });
    expect(text).toBe('- [x] a\n- [x] b\n');
  });

  it('rewrites every item when every item changed', () => {
    // When all items change, the whole list is replaced but the result stays correct.
    const { text } = run('* a\n* b\n', (root) => {
      const first = listAt(root).children[0];
      if (first === undefined) throw new Error('no item');
      setItemText(first, 'x');
      const second = listAt(root).children[1];
      if (second === undefined) throw new Error('no item');
      setItemText(second, 'y');
    });
    expect(text).toBe('* x\n* y\n');
  });
});

describe('inserting and deleting list items', () => {
  it('inserts between two items', () => {
    // Splicing a new node into the middle must place it between its neighbors.
    const { text } = run('* a\n* c\n', (root) => {
      const list = listAt(root);
      const first = list.children[0];
      if (first === undefined) throw new Error('no item');
      list.children.splice(1, 0, itemLike(first, 'b'));
    });
    expect(text).toBe('* a\n* b\n* c\n');
  });

  it('inserts before the first item', () => {
    // Splicing at index 0 must push every existing item down one slot.
    const { text } = run('* b\n* c\n', (root) => {
      const list = listAt(root);
      const first = list.children[0];
      if (first === undefined) throw new Error('no item');
      list.children.splice(0, 0, itemLike(first, 'a'));
    });
    expect(text).toBe('* a\n* b\n* c\n');
  });

  it('appends after the last item', () => {
    // Pushing a new node must place it at the end of the list.
    const { text } = run('* a\n* b\n', (root) => {
      const list = listAt(root);
      const first = list.children[0];
      if (first === undefined) throw new Error('no item');
      list.children.push(itemLike(first, 'c'));
    });
    expect(text).toBe('* a\n* b\n* c\n');
  });

  it('appends to a loose list with a blank line', () => {
    // Appending to a loose list must keep the blank-line separation between items.
    const { text } = run('* a\n\n* b\n', (root) => {
      const list = listAt(root);
      const first = list.children[0];
      if (first === undefined) throw new Error('no item');
      list.children.push(itemLike(first, 'c'));
    });
    expect(text).toBe('* a\n\n* b\n\n* c\n');
  });

  it('deletes a middle item and its line', () => {
    // Removing a middle item must drop both the node and its line.
    const { text } = run('* a\n* b\n* c\n', (root) => {
      listAt(root).children.splice(1, 1);
    });
    expect(text).toBe('* a\n* c\n');
  });

  it('deletes the last item', () => {
    // Removing the final item must leave the remaining items intact.
    const { text } = run('* a\n* b\n', (root) => {
      listAt(root).children.splice(1, 1);
    });
    expect(text).toBe('* a\n');
  });

  it('deletes the first item', () => {
    // Removing the leading item must leave the remaining items intact.
    const { text } = run('* a\n* b\n', (root) => {
      listAt(root).children.splice(0, 1);
    });
    expect(text).toBe('* b\n');
  });
});

describe('numbering ordered items', () => {
  it('keeps a number that is not in sequence', () => {
    // The edited item keeps the number it was written with, not its position in the list.
    const { text } = run('1. a\n5. b\n', (root) => {
      const item = listAt(root).children[1];
      if (item === undefined) throw new Error('no item');
      setItemText(item, 'b!');
    });
    expect(text).toBe('1. a\n5. b!\n');
  });

  it('numbers an item inserted after another from that item', () => {
    // An inserted item counts on from the item before it; the item after keeps its own bytes.
    const { text } = run('1. a\n2. c\n', (root) => {
      const list = listAt(root);
      const first = list.children[0];
      if (first === undefined) throw new Error('no item');
      list.children.splice(1, 0, itemLike(first, 'b'));
    });
    expect(text).toBe('1. a\n2. b\n2. c\n');
  });

  it('numbers an item inserted first with the list start', () => {
    // An item inserted first takes the list's first number, so the list still starts where it did.
    const { text } = run('3. b\n', (root) => {
      const list = listAt(root);
      const first = list.children[0];
      if (first === undefined) throw new Error('no item');
      list.children.splice(0, 0, itemLike(first, 'a'));
    });
    expect(text).toBe('3. a\n3. b\n');
  });

  it('spaces an item appended to a one-item list like a tight list', () => {
    // With no second item to copy spacing from, the item follows on the next line: a one-item list is never loose.
    const { text } = run('* a\n\n  more\n', (root) => {
      const list = listAt(root);
      const first = list.children[0];
      if (first === undefined) throw new Error('no item');
      list.children.push(itemLike(first, 'c'));
    });
    expect(text).toBe('* a\n\n  more\n* c\n\n  more\n');
  });
});

describe('falling back to the whole list', () => {
  it('still reads back correctly when the delimiter is a parenthesis', () => {
    // The internal read-back assertion must hold even for parenthetical ordered lists.
    run('1) a\n2) b\n', (root) => {
      const item = listAt(root).children[1];
      if (item === undefined) throw new Error('no item');
      setItemText(item, 'b!');
    });
  });

  it('still reads back correctly when a tight list becomes loose', () => {
    // Enforcing looseness must still produce output that parses back to the edited tree.
    run('* a\n* b\n', (root) => {
      listAt(root).spread = true;
    });
  });

  it('still reads back correctly when a bullet list becomes ordered', () => {
    // The internal read-back assertion must hold even when the marker kind changes.
    run('* a\n* b\n', (root) => {
      const list = listAt(root);
      list.ordered = true;
      // A parsed ordered list always has a start, so the edited tree must carry one to compare equal.
      list.start = 1;
    });
  });

  it('still reads back correctly when an ordered list starts elsewhere', () => {
    // The internal read-back assertion must hold even for a non-one start value.
    run('1. a\n2. b\n', (root) => {
      listAt(root).start = 3;
    });
  });

  it('still reads back correctly when the list and a paragraph become one list', () => {
    // The internal read-back assertion must hold even after removing a sibling node.
    run('* a\n\nPara\n', (root) => {
      const item = listAt(root).children[0];
      if (item === undefined) throw new Error('no item');
      setItemText(item, 'a!');
      root.children.splice(1, 1);
    });
  });

  it('replaces the whole list when its items carry no positions', () => {
    // A document built without positions for its items cannot keep their bytes, so the list is rewritten whole.
    const original = parseMarkdown('* a\n* b\n');
    const list = listAt(original.root);
    for (const item of list.children) {
      delete (item as { position?: unknown }).position;
    }
    const updated = structuredClone(original.root);
    const second = listAt(updated).children[1];
    if (second === undefined) throw new Error('no item');
    setItemText(second, 'b!');
    const result = serializeIncremental(original, updated);
    expect(shape(parseMarkdown(result.text).root.children)).toBe(shape(updated.children));
  });
});
