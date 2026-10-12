/**
 * @file dom-free.spec.ts
 * @purpose Architectural guard test suite verifying the ProseMirror conversion layer in @k-doc/editor remains DOM-free.
 *   DESIGN.md claims the ProseMirror conversion layer is DOM-free, which is what lets the most correctness-critical part of the WYSIWYG pane be tested in a bare Node process.
 *   That claim used to be enforced by the compiler, because the package's lib excluded DOM. Adding ProseMirrorBinding forced DOM types into the package's lib, so the compiler
 *   now accepts DOM usage anywhere in it. This suite restores the guarantee by reading the source files directly: an architectural claim nobody checks is a comment, not a constraint.
 * @inputs Source code files in the prosemirror package directory (schema.ts, from-mdast.ts, to-mdast.ts, binding.ts).
 * @outputs Vitest assertions verifying absence of DOM references in conversion layer modules and presence of DOM-bound imports in binding.ts.
 * @functions
 *   - readSource: Reads and returns the UTF-8 text content of a source file from the prosemirror directory.
 *   - stripComments: Strips block comments and whole-line single-line comments from source code to prevent prose from triggering false positives.
 * @dataflow Source file name -> relative URL resolution -> filesystem path -> readFileSync UTF-8 -> strip comments for negative checks -> substring presence/absence assertions.
 * @controlflow Define file lists and forbidden token constants -> verify stripped conversion layer files contain no forbidden DOM tokens -> verify comment stripper preserves code and drops comments -> verify raw conversion files import prosemirror-model -> verify raw binding file imports prosemirror-view.
 * @version 2
 * @date 2026-09-04
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The conversion layer files that must remain strictly DOM-free.
const DOM_FREE_FILES = ['schema.ts', 'from-mdast.ts', 'to-mdast.ts'] as const;

// The one file permitted to touch the DOM.
const DOM_BOUND_FILES = ['binding.ts'] as const;

// Substrings indicating DOM references or DOM-bound module imports that must not appear in the conversion layer.
const FORBIDDEN_DOM_TOKENS = [
  'prosemirror-view',
  'document.',
  'window.',
  'HTMLElement',
  'addEventListener',
] as const;

/**
 * Resolves a source file path relative to this test module and reads its content.
 *
 * @purpose Reads a source file from packages/editor/src/prosemirror/ synchronously as UTF-8.
 * @inputs fileName - Name of the file within the prosemirror source directory.
 * @outputs string - The complete text content of the source file.
 * @dataflow fileName -> resolve relative URL -> convert to filesystem path -> readFileSync -> file source string.
 * @controlflow Build file URL with import.meta.url -> convert URL to path -> read file as utf8 string -> return source string.
 */
function readSource(fileName: string): string {
  const filePath = fileURLToPath(new URL(`../src/prosemirror/${fileName}`, import.meta.url));
  return readFileSync(filePath, 'utf8');
}

/**
 * Strips block comments and whole-line single-line comments from source code text.
 *
 * @purpose Removes comment blocks and whole-line comments so text scans inspect code rather than documentation prose.
 * @inputs source - The raw source code text string.
 * @outputs string - The source code with block and whole-line comments removed.
 * @dataflow source string -> regex replace block comments -> split lines -> filter whole-line comments -> join lines -> stripped string.
 * @controlflow Remove all block comments via regex -> split source into lines -> filter out lines whose trimmed content starts with '//' -> rejoin lines with '\n' -> return result.
 */
function stripComments(source: string): string {
  // 1. Every block comment: replace matches of `/\/\*[\s\S]*?\*\//g` with an empty string.
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, '');

  // 2. Every whole-line comment: split on '\n', drop each line whose trimmed form starts with '//', and rejoin.
  // Deliberate limitation: a trailing `// comment` after code on the same line is NOT stripped,
  // because doing so safely would mean distinguishing a comment from a `//` inside a string literal
  // such as a URL, and a guard test does not warrant a tokenizer. Whole-line comments and block
  // comments are where prose actually lives, so this is sufficient in practice — and if a trailing
  // comment ever does trip the guard, the fix is to move that comment onto its own line.
  return withoutBlockComments
    .split('\n')
    .filter((line: string): boolean => {
      // Check if line is a whole-line comment (trimmed line starts with '//').
      // Drop whole-line comments and keep all code / trailing comment lines.
      return !line.trim().startsWith('//');
    })
    .join('\n');
}

describe('the conversion layer is DOM-free', () => {
  for (const fileName of DOM_FREE_FILES) {
    it(fileName, () => {
      const source = stripComments(readSource(fileName));

      // The check is deliberately textual rather than type-based, because the type
      // system can no longer express the constraint once DOM is in lib.
      for (const token of FORBIDDEN_DOM_TOKENS) {
        const message = `Forbidden DOM token '${token}' found in conversion file '${fileName}'`;
        expect(source.includes(token), message).toBe(false);
      }
    });
  }

  it('the comment stripper does not hide real code', () => {
    // A guard's own helper needs a test, because a stripper that accidentally removed
    // real code would make the whole suite pass vacuously.
    const sample = 'const a = 1; // trailing\n// whole line\n/* block */\nconst b = document.body;';
    const stripped = stripComments(sample);

    expect(stripped.includes('const a = 1;')).toBe(true);
    expect(stripped.includes('const b = document.body;')).toBe(true);
    expect(stripped.includes('whole line')).toBe(false);
    expect(stripped.includes('block')).toBe(false);
  });

  it('imports from prosemirror-model', () => {
    // A guard which passes because it is looking at nothing is worse than no guard.
    // Asserting each conversion layer file imports from 'prosemirror-model' confirms
    // the list is pointing at real conversion-layer files rather than silently passing on files that no longer exist.
    // Asymmetry note: Positive assertions scan raw source without stripping comments because
    // an import statement is code and stripping comments cannot affect it, while stripping
    // would risk a false negative if the helper were ever wrong.
    for (const fileName of DOM_FREE_FILES) {
      const source = readSource(fileName);
      const message = `Conversion file '${fileName}' does not import from 'prosemirror-model'`;
      expect(source.includes('prosemirror-model'), message).toBe(true);
    }
  });
});

describe('the binding is the only DOM-bound file', () => {
  it('binding.ts imports prosemirror-view', () => {
    // This is the counterpart assertion: it pins the boundary from the other side,
    // so if the binding were ever refactored into the conversion layer this suite would notice.
    // Asymmetry note: Positive assertions scan raw source without stripping comments because
    // an import statement is code and stripping comments cannot affect it, while stripping
    // would risk a false negative if the helper were ever wrong.
    for (const fileName of DOM_BOUND_FILES) {
      const source = readSource(fileName);
      const message = `DOM-bound file '${fileName}' does not contain 'prosemirror-view'`;
      expect(source.includes('prosemirror-view'), message).toBe(true);
    }
  });
});
