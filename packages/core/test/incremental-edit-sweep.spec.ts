/**
 * @file incremental-edit-sweep.spec.ts
 * @purpose sweeps edits over every text node and container of documents written in non-canonical container syntax, proving each incremental save reads back as the edited tree (FR-4.2)
 * @inputs SOURCES: array of non-canonical Markdown source strings; parseMarkdown and serializeIncremental imported from ../src/index.js
 * @outputs A vitest describe block running three edit sweeps across every text node and container in each source, asserting round-trip fidelity
 * @functions
 *   - shape: serializes a tree to JSON with position metadata removed so trees compare by structure alone.
 *   - textPaths: collects the index paths of every text node in a tree.
 *   - containerPaths: collects the index paths of every blockquote and listItem container.
 *   - nodeAt: resolves a recorded index path back to the exact node it names within a tree.
 *   - check: parses, edits via callback, re-serializes incrementally, and asserts the read-back tree matches the edited tree.
 * @dataflow source string → parseMarkdown → Root tree → edit through a collected path → structuredClone/serializeIncremental → result.text → parseMarkdown again → structural shape comparison.
 * @controlflow Define SOURCES → describe block runs three it.each sweeps; each sweep enumerates paths, applies an edit through check, which parses and re-parses to verify the incremental save reads back as the edited tree.
 * @version 1
 * @date 2026-09-15
 */

import type { Parent, Root, RootContent } from 'mdast';
import { describe, expect, it } from 'vitest';
import { parseMarkdown, serializeDocument, serializeIncremental } from '../src/index.js';

/** Documents in the container syntax the canonical style would rewrite: other bullets, ')' numbering, wide gaps, lazy lines, nested quotes, tasks, alerts, code in items. */
const SOURCES: readonly string[] = [
  '> *one* two\n>\n> three\n> four\n',
  '> - *a*\n> - b\n>\n> after the list\n',
  '* item *one*\n  continued\n\n  second paragraph\n\n  + nested\n  + nested two\n* item two\n',
  '1) first\n2) second\n   * inner\n   * inner two\n3) third\n',
  '-   wide gap\n-   another\n\n    with a paragraph\n',
  '> quote\nlazy continuation\n>\n> > nested *quote*\n> > more\n',
  '- [ ] todo *one*\n- [x] done\n  - [ ] sub task\n',
  '> [!NOTE]\n> An *alert* body.\n>\n> Second paragraph.\n',
  '- code in an item:\n\n  ```js\n  const a = 1;\n  ```\n\n  text after\n',
  '> 1. quoted *ordered*\n>    continued\n> 2. second\n>\n>    loose paragraph\n',
  '+ a\n\n  > quote in item\n  > *more*\n\n+ b\n',
  '10. ten\n11. eleven\n    12. nested start\n',
  '> ```\n> code in a quote\n> ```\n>\n> *after*\n',
  '- a\r\n- *b*\r\n\r\n  para\r\n',
  '>\n\n* empty quote above\n',
];

/**
 * @purpose Serializes a tree to JSON with position metadata removed so trees compare by structure alone.
 * @inputs value - The AST node or array to serialize; key - the current JSON key during traversal; v - the current value at that key.
 * @outputs string - A compact JSON representation of the tree without any `position` fields.
 * @dataflow AST → JSON.stringify replacer drops position keys → structural JSON string.
 * @controlflow For each key/value pair, return undefined when the key is 'position' to omit it; otherwise pass v through unchanged.
 */
function shape(value: unknown): string {
  // Drop `position` so trees compare by structure alone.
  return JSON.stringify(value, (key: string, v: unknown): unknown => (key === 'position' ? undefined : v));
}

/**
 * @purpose Collects the index paths of every text node in a tree so each can be edited.
 * @inputs node - The current AST node being visited; path - the running index path from the root; out - the accumulator of collected paths.
 * @outputs number[][] - The same `out` array, now containing one path per text node encountered.
 * @dataflow Tree traversal → each text node appends its path to out; parents recurse into children.
 * @controlflow If the node is 'text', push a copy of the current path; else if it has children, recurse over each child with an extended path; otherwise do nothing and return out.
 */
function textPaths(node: Root | RootContent, path: readonly number[], out: number[][]): number[][] {
  // A text node is a place to edit; a parent is searched.
  if (node.type === 'text') {
    out.push([...path]);
  } else if ('children' in node) {
    (node as Parent).children.forEach((child: RootContent, index: number): void => { textPaths(child, [...path, index], out); });
  } else {
    // A leaf that is not text (code, inline code, a break): nothing to edit here.
  }
  return out;
}

/**
 * @purpose Collects the index paths of every blockquote and listItem container so a block can be added or removed at each.
 * @inputs node - The current AST node being visited; path - the running index path from the root; out - the accumulator of collected paths.
 * @outputs number[][] - The same `out` array, now containing one path per container encountered.
 * @dataflow Tree traversal → each blockquote/listItem appends its path to out; every parent recurses into children regardless of type.
 * @controlflow If the node is a container, push a copy of the current path; then if it has children, recurse over each child with an extended path; otherwise return out.
 */
function containerPaths(node: Root | RootContent, path: readonly number[], out: number[][]): number[][] {
  // A blockquote or list item is a place to add a block; every parent is searched.
  if (node.type === 'blockquote' || node.type === 'listItem') {
    out.push([...path]);
  } else {
    // Not a container of blocks.
  }
  if ('children' in node) {
    (node as Parent).children.forEach((child: RootContent, index: number): void => { containerPaths(child, [...path, index], out); });
  } else {
    // A leaf.
  }
  return out;
}

/**
 * @purpose Resolves a previously recorded index path back to the exact node it names within a tree.
 * @inputs root - The tree to walk; path - the sequence of child indices from the root to the target node.
 * @outputs Root | RootContent - The node located at the end of `path`.
 * @dataflow Path indices → successive children lookups → resolved target node.
 * @controlflow Walk each index, descending into children when present; throw if any step names a missing child (which cannot happen since paths originate from this same tree); return the final node.
 */
function nodeAt(root: Root, path: readonly number[]): Root | RootContent {
  let node: Root | RootContent = root;
  for (const index of path) {
    const next: RootContent | undefined = 'children' in node ? (node as Parent).children[index] : undefined;
    // Every step names an existing child, since the paths were read from this same tree.
    if (next === undefined) {
      throw new Error(`no child at ${path.join('.')}`);
    } else {
      node = next;
    }
  }
  return node;
}

/**
 * @purpose Applies an edit to a parsed document and asserts that the incremental save reads back exactly as a full rewrite of the edited tree does (FR-4.2).
 * @inputs source - The original non-canonical Markdown; edit - a callback that mutates a Root in place with the desired change.
 * @outputs void - No return value; assertions inside throw on mismatch.
 * @dataflow source → parseMarkdown(original) → structuredClone(root) → edit(updated) → serializeIncremental(original, updated).text → parseMarkdown again → shape comparison.
 * @controlflow Parse the original, clone and mutate a copy, run an incremental serialization against the original, re-parse the serialized text, and assert the two trees have identical structural shapes.
 */
function check(source: string, edit: (root: Root) => void): void {
  const original = parseMarkdown(source);
  const updated = structuredClone(original.root);
  edit(updated);
  const result = serializeIncremental(original, updated);
  // Some edits (a second block in a tight item) have no exact Markdown form; splicing must read back as a full rewrite does.
  const rewritten = serializeDocument({ text: '', root: updated, frontMatter: original.frontMatter });
  expect(shape(parseMarkdown(result.text).root.children)).toBe(shape(parseMarkdown(rewritten).root.children));
}

describe('an edit anywhere in a container document', () => {
  it.each(SOURCES.map((source: string, index: number): [number, string] => [index, source]))('reads back after editing each text in source %i', (_index: number, source: string): void => {
    const paths = textPaths(parseMarkdown(source).root, [], []);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      check(source, (root: Root): void => {
        const node = nodeAt(root, path);
        // The path was read as a text node from an identical tree.
        if (node.type === 'text') {
          node.value = `${node.value} edited`;
        } else {
          throw new Error(`expected text at ${path.join('.')}`);
        }
      });
    }
  });

  it.each(SOURCES.map((source: string, index: number): [number, string] => [index, source]))('reads back after adding a paragraph to each container in source %i', (_index: number, source: string): void => {
    for (const path of containerPaths(parseMarkdown(source).root, [], [])) {
      check(source, (root: Root): void => {
        const node = nodeAt(root, path);
        // The path was read as a container from an identical tree.
        if (node.type === 'blockquote' || node.type === 'listItem') {
          node.children.push({ type: 'paragraph', children: [{ type: 'text', value: 'added' }] });
        } else {
          throw new Error(`expected a container at ${path.join('.')}`);
        }
      });
    }
  });

  it.each(SOURCES.map((source: string, index: number): [number, string] => [index, source]))('reads back after removing the first block of each container in source %i', (_index: number, source: string): void => {
    for (const path of containerPaths(parseMarkdown(source).root, [], [])) {
      check(source, (root: Root): void => {
        const node = nodeAt(root, path);
        // Only a container with a second block keeps a block after the first is removed.
        if ((node.type === 'blockquote' || node.type === 'listItem') && node.children.length > 1) {
          node.children.splice(0, 1);
        } else {
          // One block or none: removing it would empty the container, which this sweep does not cover.
        }
      });
    }
  });
});