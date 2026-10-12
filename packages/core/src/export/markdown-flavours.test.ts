/**
 * @file markdown-flavours.test.ts
 * @purpose Vitest test suite for K-Doc's Markdown export flavours (packages/core/src/export/markdown-flavours.ts).
 *   Verifies exportMarkdownFlavour for the 'commonmark' and 'gfm' flavours: extension rendering to plain-text targets, change tallies, footnote numbering, front matter wrapping and export purity.
 * @inputs Markdown documents containing K-Doc extensions (highlighting, subscript/superscript, strikethrough, maths, tables, task lists, footnotes, YAML/TOML front matter); the target flavour tags 'commonmark' and 'gfm'.
 * @outputs Vitest assertions on exported .markdown strings and .changes tallies, plus a check that the parsed document tree is not mutated.
 * @functions None.
 * @dataflow Markdown string -> parseMarkdown AST -> exportMarkdownFlavour -> Vitest assertions on .markdown / .changes.
 * @controlflow Run describe blocks per flavour; each it asserts an exact output or empty change list, and one block asserts document immutability across repeated exports.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../parse/parser.js';
import { exportMarkdownFlavour } from './markdown-flavours.js';

const cm = (text: string) => exportMarkdownFlavour(parseMarkdown(text), 'commonmark');
const gfm = (text: string) => exportMarkdownFlavour(parseMarkdown(text), 'gfm');

const SAMPLE = '---\ntitle: Demo\n---\n\n# Demo\n\nSome ==highlighted== text, H~2~O and x^2^, ~~gone~~, and $e = mc^2$.[^n]\n\n| A | B |\n| - | -: |\n| 1 | **2** |\n\n- [x] done\n- [ ] todo\n\n$$\nx^2\n$$\n\n[^n]: A note with ==mark==.\n';

describe('exportMarkdownFlavour: CommonMark', () => {
  // Guards every K-Doc extension is rendered to its plain-text target (HTML element, escaped text or fenced code).
  it('writes every extension as HTML, text or code', () => {
    expect(cm(SAMPLE).markdown).toBe('<!--\n---\ntitle: Demo\n---\n-->\n\n# Demo\n\nSome <mark>highlighted</mark> text, H<sub>2</sub>O and x<sup>2</sup>, <del>gone</del>, and `e = mc^2`.<sup id="fnref-1"><a href="#fn-1">1</a></sup>\n\n<table><thead><tr><th>A</th><th align="right">B</th></tr></thead><tbody><tr><td>1</td><td align="right"><strong>2</strong></td></tr></tbody></table>\n\n- \\[x] done\n- \\[ ] todo\n\n```math\nx^2\n```\n\n<div class="footnote" id="fn-1">\n\n<sup>1</sup> A note with <mark>mark</mark>.\n\n</div>\n');
  });

  // Guards the change report tallies each extension type with its exact occurrence count.
  it('counts what it changed', () => {
    expect(cm(SAMPLE).changes).toEqual([
      { label: 'front matter written as an HTML comment', count: 1 },
      { label: 'highlighting written as HTML', count: 2 },
      { label: 'subscript and superscript written as HTML', count: 2 },
      { label: 'strikethrough written as HTML', count: 1 },
      { label: 'maths written as code', count: 2 },
      { label: 'tables written as HTML', count: 1 },
      { label: 'task list checkboxes written as text', count: 2 },
      { label: 'footnotes written as HTML', count: 1 },
    ]);
  });

  // Guards footnote references are numbered in document reading order, with unreferenced definitions appended last.
  it('numbers footnotes in reading order, then any never referred to', () => {
    expect(cm('First.[^b] Second.[^a]\n\n[^a]: Note A.\n\n[^b]: Note B.\n\n[^c]: Never used.\n').markdown).toBe('First.<sup id="fnref-1"><a href="#fn-1">1</a></sup> Second.<sup id="fnref-2"><a href="#fn-2">2</a></sup>\n\n<div class="footnote" id="fn-2">\n\n<sup>2</sup> Note A.\n\n</div>\n\n<div class="footnote" id="fn-1">\n\n<sup>1</sup> Note B.\n\n</div>\n\n<div class="footnote" id="fn-3">\n\n<sup>3</sup> Never used.\n\n</div>\n');
  });

  // Guards a footnote whose content begins with a list is given its own line after the definition marker.
  it('gives a footnote that starts with a list its own number line', () => {
    expect(cm('Claim.[^n]\n\n[^n]:\n    - item one\n').markdown).toBe('Claim.<sup id="fnref-1"><a href="#fn-1">1</a></sup>\n\n<div class="footnote" id="fn-1">\n\n<sup>1</sup> \n\n- item one\n\n</div>\n');
  });

  // Guards TOML front matter (delimited by +++) is wrapped in an HTML comment preserving its own fences.
  it('keeps TOML front matter in a comment with its own fences', () => {
    expect(cm('+++\ntitle = "x"\n+++\n\nBody.\n').markdown).toBe('<!--\n+++\ntitle = "x"\n+++\n-->\n\nBody.\n');
  });

  // Guards a --> sequence inside front matter is broken so it cannot prematurely terminate the wrapping HTML comment.
  it('breaks up an arrow in front matter that would end the comment early', () => {
    expect(cm('---\nnote: a --> b\n---\n\nBody.\n').markdown).toBe('<!--\n---\nnote: a -- > b\n---\n-->\n\nBody.\n');
  });

  // Guards a document already in CommonMark form is returned unchanged (asterisks normalised to underscores) with an empty change list.
  it('changes nothing in a document that is already CommonMark', () => {
    expect(cm('# Title\n\nJust *words* and `code`.\n')).toEqual({ markdown: '# Title\n\nJust _words_ and `code`.\n', changes: [] });
  });

  // Guards only task-list checkboxes are escaped; plain list items without a checkbox are left untouched.
  it('leaves list items without a checkbox alone', () => {
    expect(cm('- [x] done\n- plain\n')).toEqual({ markdown: '- \\[x] done\n- plain\n', changes: [{ label: 'task list checkboxes written as text', count: 1 }] });
  });
});

describe('exportMarkdownFlavour: GFM', () => {
  // Guards the GFM flavour preserves GitHub-native syntax while rewriting only K-Doc's own extensions.
  it('keeps GitHub syntax and rewrites only K-Doc\'s own', () => {
    expect(gfm(SAMPLE).markdown).toBe('---\ntitle: Demo\n---\n\n# Demo\n\nSome <mark>highlighted</mark> text, H<sub>2</sub>O and x<sup>2</sup>, ~~gone~~, and `e = mc^2`.[^n]\n\n| A |     B |\n| - | ----: |\n| 1 | **2** |\n\n- [x] done\n- [ ] todo\n\n```math\nx^2\n```\n\n[^n]: A note with <mark>mark</mark>.\n');
    expect(gfm(SAMPLE).changes).toEqual([
      { label: 'highlighting written as HTML', count: 2 },
      { label: 'subscript and superscript written as HTML', count: 2 },
      { label: 'maths written as code', count: 2 },
    ]);
  });

  // Guards a document using only GitHub syntax is returned unchanged with an empty change list.
  it('changes nothing in a document with only GitHub syntax', () => {
    expect(gfm('# Title\n\n- [x] done\n\n~~gone~~\n')).toEqual({ markdown: '# Title\n\n- [x] done\n\n~~gone~~\n', changes: [] });
  });
});

describe('exportMarkdownFlavour: the open document', () => {
  // Guards the export functions are pure and do not mutate the parsed document tree across repeated exports.
  it('is never changed by an export', () => {
    const document = parseMarkdown(SAMPLE);
    const before = JSON.stringify(document.root);
    exportMarkdownFlavour(document, 'commonmark');
    exportMarkdownFlavour(document, 'gfm');
    expect(JSON.stringify(document.root)).toBe(before);
  });
});
