/**
 * @file diagram-images.test.ts
 * @purpose Unit test suite for Mermaid diagram recognition, source extraction, and image replacement in @k-doc/core.
 * @inputs Mdast Root trees, Code nodes, and image URL mapping entries.
 * @outputs Vitest test execution assertions validating isMermaidCode, mermaidSources, applyDiagramImages, and DIAGRAM_ALT_TEXT.
 * @functions None (test suite file executing describe and it blocks).
 * @dataflow Synthetic mdast trees and Map lookups -> diagram-images functions -> extracted strings or transformed mdast tree -> assertions.
 * @controlflow Test suite executes describe blocks for DIAGRAM_ALT_TEXT, isMermaidCode, mermaidSources, and applyDiagramImages, asserting happy paths, edge cases, deduplication, tree traversal, and AST immutability.
 * @version 1
 * @date 2026-10-28
 */

import type { Blockquote, Code, List, Paragraph, Root } from 'mdast';
import type { Position } from 'unist';
import { describe, expect, it } from 'vitest';
import {
  DIAGRAM_ALT_TEXT,
  applyDiagramImages,
  isMermaidCode,
  mermaidSources,
} from './diagram-images.js';

describe('DIAGRAM_ALT_TEXT', () => {
  it('exports the constant "Mermaid diagram"', () => {
    // Assert the default alt text constant matches the blueprint specification.
    expect(DIAGRAM_ALT_TEXT).toBe('Mermaid diagram');
  });
});

describe('isMermaidCode', () => {
  it('returns true for a code node with lang "mermaid"', () => {
    const node = { type: 'code', lang: 'mermaid', value: 'graph TD; A-->B' };
    // Node has type 'code', lang 'mermaid', and string value: returns true.
    expect(isMermaidCode(node)).toBe(true);
  });

  it('returns true for lang with uppercase and whitespace " MERMAID "', () => {
    const node = { type: 'code', lang: ' MERMAID ', value: 'graph LR; C-->D' };
    // Trimmed and lowercased lang matches 'mermaid': returns true.
    expect(isMermaidCode(node)).toBe(true);
  });

  it('returns true for mixed-case lang "Mermaid"', () => {
    const node = { type: 'code', lang: 'Mermaid', value: 'sequenceDiagram' };
    // Lowercased lang matches 'mermaid': returns true.
    expect(isMermaidCode(node)).toBe(true);
  });

  it('returns false when lang is "js"', () => {
    const node = { type: 'code', lang: 'js', value: 'console.log(1)' };
    // Non-mermaid lang: returns false.
    expect(isMermaidCode(node)).toBe(false);
  });

  it('returns false when lang is null', () => {
    const node = { type: 'code', lang: null, value: 'x' };
    // Lang is null rather than string: returns false.
    expect(isMermaidCode(node)).toBe(false);
  });

  it('returns false when lang is undefined or omitted', () => {
    const node = { type: 'code', value: 'x' };
    // Lang is missing: returns false.
    expect(isMermaidCode(node)).toBe(false);
  });

  it('returns false for non-code mdast nodes like paragraph', () => {
    const node = { type: 'paragraph', children: [] };
    // Node type is 'paragraph' instead of 'code': returns false.
    expect(isMermaidCode(node)).toBe(false);
  });

  it('returns false for null and undefined inputs', () => {
    // Null input: returns false.
    expect(isMermaidCode(null)).toBe(false);
    // Undefined input: returns false.
    expect(isMermaidCode(undefined)).toBe(false);
  });

  it('returns false for primitive values', () => {
    // String primitive: returns false.
    expect(isMermaidCode('code')).toBe(false);
    // Number primitive: returns false.
    expect(isMermaidCode(123)).toBe(false);
    // Boolean primitive: returns false.
    expect(isMermaidCode(true)).toBe(false);
  });

  it('returns false when value is missing or not a string', () => {
    // Missing value property: returns false.
    expect(isMermaidCode({ type: 'code', lang: 'mermaid' })).toBe(false);
    // Non-string value: returns false.
    expect(isMermaidCode({ type: 'code', lang: 'mermaid', value: 123 })).toBe(false);
  });

  it('returns false when lang is not a string', () => {
    // Numeric lang: returns false.
    expect(isMermaidCode({ type: 'code', lang: 42, value: 'x' })).toBe(false);
  });
});

describe('mermaidSources', () => {
  it('extracts diagram values in document order, traversing blockquotes and lists while ignoring non-mermaid and duplicates', () => {
    const root: Root = {
      type: 'root',
      children: [
        {
          type: 'code',
          lang: 'mermaid',
          value: 'graph TD; A-->B',
        },
        {
          type: 'code',
          lang: 'js',
          value: 'const x = 1;',
        },
        {
          type: 'blockquote',
          children: [
            {
              type: 'code',
              lang: 'mermaid',
              value: 'graph LR; C-->D',
            },
          ],
        },
        {
          type: 'list',
          children: [
            {
              type: 'listItem',
              children: [
                {
                  type: 'code',
                  lang: 'mermaid',
                  value: 'sequenceDiagram; Alice->>Bob: Hello',
                },
              ],
            },
          ],
        },
        {
          type: 'code',
          lang: 'mermaid',
          value: 'graph TD; A-->B',
        },
        {
          type: 'paragraph',
          children: [
            {
              type: 'text',
              value: 'Some descriptive prose',
            },
          ],
        },
        {
          type: 'code',
          lang: ' MERMAID ',
          value: 'pie title Pets\n  "Dogs": 386',
        },
      ],
    };

    // Document order depth-first collection: top-level mermaid -> blockquote mermaid -> list item mermaid -> pie chart mermaid.
    // The duplicate 'graph TD; A-->B' must appear only once, and 'js' code block must be omitted.
    const expected = [
      'graph TD; A-->B',
      'graph LR; C-->D',
      'sequenceDiagram; Alice->>Bob: Hello',
      'pie title Pets\n  "Dogs": 386',
    ];

    expect(mermaidSources(root)).toEqual(expected);
  });

  it('returns an empty array when root contains only a paragraph', () => {
    const root: Root = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'text',
              value: 'Only text content',
            },
          ],
        },
      ],
    };

    // No mermaid code nodes exist in the tree: returns empty array.
    expect(mermaidSources(root)).toEqual([]);
  });

  it('returns an empty array for an empty root', () => {
    const root: Root = {
      type: 'root',
      children: [],
    };

    // Root with no children: returns empty array.
    expect(mermaidSources(root)).toEqual([]);
  });

  it('returns an empty array when root has non-mermaid code blocks only', () => {
    const root: Root = {
      type: 'root',
      children: [
        {
          type: 'code',
          lang: 'typescript',
          value: 'const a: number = 5;',
        },
        {
          type: 'code',
          lang: 'python',
          value: 'print("hello")',
        },
      ],
    };

    // All code blocks have non-mermaid languages: returns empty array.
    expect(mermaidSources(root)).toEqual([]);
  });

  it('preserves first occurrence when duplicates appear at different tree depths', () => {
    const root: Root = {
      type: 'root',
      children: [
        {
          type: 'blockquote',
          children: [
            {
              type: 'code',
              lang: 'mermaid',
              value: 'flowchart TD; A-->B',
            },
          ],
        },
        {
          type: 'code',
          lang: 'mermaid',
          value: 'flowchart TD; A-->B',
        },
        {
          type: 'code',
          lang: 'mermaid',
          value: 'stateDiagram-v2; [*] --> Idle',
        },
      ],
    };

    // First occurrence in blockquote is collected; identical subsequent code node is skipped.
    expect(mermaidSources(root)).toEqual([
      'flowchart TD; A-->B',
      'stateDiagram-v2; [*] --> Idle',
    ]);
  });
});

describe('applyDiagramImages', () => {
  it('replaces a top-level mermaid code node with a paragraph containing an image node and preserves position', () => {
    const codePosition: Position = {
      start: { line: 10, column: 1, offset: 120 },
      end: { line: 14, column: 4, offset: 180 },
    };

    const codeNode: Code = {
      type: 'code',
      lang: 'mermaid',
      value: 'graph TD; X-->Y',
      position: codePosition,
    };

    const root: Root = {
      type: 'root',
      children: [codeNode],
    };

    const images = new Map<string, string>([
      ['graph TD; X-->Y', 'data:image/svg+xml;base64,PHN2Zz4='],
    ]);

    const result = applyDiagramImages(root, images);

    // Replaced node must be a paragraph with image child and the same position metadata.
    expect(result).toEqual({
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'image',
              url: 'data:image/svg+xml;base64,PHN2Zz4=',
              alt: 'Mermaid diagram',
              title: null,
            },
          ],
          position: codePosition,
        },
      ],
    });
  });

  it('replaces a top-level mermaid code node without position metadata', () => {
    const codeNode: Code = {
      type: 'code',
      lang: 'mermaid',
      value: 'graph TD; X-->Y',
    };

    const root: Root = {
      type: 'root',
      children: [codeNode],
    };

    const images = new Map<string, string>([
      ['graph TD; X-->Y', 'data:image/svg+xml;base64,PHN2Zz4='],
    ]);

    const result = applyDiagramImages(root, images);

    // Replaced node must be a paragraph with image child and no position assigned.
    expect(result).toEqual({
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'image',
              url: 'data:image/svg+xml;base64,PHN2Zz4=',
              alt: 'Mermaid diagram',
              title: null,
            },
          ],
        },
      ],
    });

    const firstChild = result.children[0] as Paragraph;
    // Position property must remain undefined when original node had no position.
    expect(firstChild.position).toBeUndefined();
  });

  it('replaces mermaid code nested inside a blockquote', () => {
    const blockquote: Blockquote = {
      type: 'blockquote',
      children: [
        {
          type: 'code',
          lang: 'mermaid',
          value: 'graph LR; Alpha-->Beta',
        },
      ],
    };

    const root: Root = {
      type: 'root',
      children: [blockquote],
    };

    const images = new Map<string, string>([
      ['graph LR; Alpha-->Beta', 'data:image/png;base64,iVBORw0KGgo='],
    ]);

    const result = applyDiagramImages(root, images);

    // Child within blockquote is replaced with paragraph image.
    expect(result).toEqual({
      type: 'root',
      children: [
        {
          type: 'blockquote',
          children: [
            {
              type: 'paragraph',
              children: [
                {
                  type: 'image',
                  url: 'data:image/png;base64,iVBORw0KGgo=',
                  alt: 'Mermaid diagram',
                  title: null,
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('replaces mermaid code nested inside list and list item', () => {
    const list: List = {
      type: 'list',
      children: [
        {
          type: 'listItem',
          children: [
            {
              type: 'code',
              lang: 'mermaid',
              value: 'flowchart TD; A-->B',
            },
          ],
        },
      ],
    };

    const root: Root = {
      type: 'root',
      children: [list],
    };

    const images = new Map<string, string>([
      ['flowchart TD; A-->B', 'data:image/svg+xml;utf8,<svg></svg>'],
    ]);

    const result = applyDiagramImages(root, images);

    // Child within list item is replaced with paragraph image.
    expect(result).toEqual({
      type: 'root',
      children: [
        {
          type: 'list',
          children: [
            {
              type: 'listItem',
              children: [
                {
                  type: 'paragraph',
                  children: [
                    {
                      type: 'image',
                      url: 'data:image/svg+xml;utf8,<svg></svg>',
                      alt: 'Mermaid diagram',
                      title: null,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('leaves mermaid code untouched when its value is not present in the images map', () => {
    const unrenderedCode: Code = {
      type: 'code',
      lang: 'mermaid',
      value: 'graph TD; FailedToDraw-->Error',
    };

    const root: Root = {
      type: 'root',
      children: [unrenderedCode],
    };

    // Images map contains an unrelated key; diagram value is missing.
    const images = new Map<string, string>([
      ['different diagram', 'data:something'],
    ]);

    const result = applyDiagramImages(root, images);

    // Unrendered diagram must stay as the original code node.
    expect(result.children[0]).toEqual(unrenderedCode);
  });

  it('leaves non-mermaid code blocks untouched even if value matches a key in the map', () => {
    const jsCode: Code = {
      type: 'code',
      lang: 'js',
      value: 'console.log("not a diagram");',
    };

    const root: Root = {
      type: 'root',
      children: [jsCode],
    };

    // Images map has a key matching the JS code value.
    const images = new Map<string, string>([
      ['console.log("not a diagram");', 'data:image/png;base64,dummy'],
    ]);

    const result = applyDiagramImages(root, images);

    // Non-mermaid code must remain a code node.
    expect(result.children[0]).toEqual(jsCode);
  });

  it('does not mutate the input root and returns a new object reference', () => {
    const pos: Position = {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 3, column: 1, offset: 35 },
    };

    const inputRoot: Root = {
      type: 'root',
      children: [
        {
          type: 'code',
          lang: 'mermaid',
          value: 'graph TD; NodeA-->NodeB',
          position: pos,
        },
        {
          type: 'paragraph',
          children: [
            {
              type: 'text',
              value: 'Untouched paragraph',
            },
          ],
        },
      ],
    };

    // Clone before execution to verify input immutability.
    const snapshot = structuredClone(inputRoot);

    const images = new Map<string, string>([
      ['graph TD; NodeA-->NodeB', 'data:image/svg+xml;base64,PHN2Zz4='],
    ]);

    const result = applyDiagramImages(inputRoot, images);

    // Input root must deep-equal the pre-call snapshot.
    expect(inputRoot).toEqual(snapshot);

    // The returned root must be a new object reference, not the original input.
    expect(result).not.toBe(inputRoot);

    // Children array of returned root must be a distinct reference.
    expect(result.children).not.toBe(inputRoot.children);
  });
});
