/**
 * @file schema.ts
 * @purpose Defines the ProseMirror schema for K-Doc's WYSIWYG pane, mirroring the mdast AST subset
 *   supported by the engine (CommonMark + GFM).
 *
 *   This schema is one third of the contract DESIGN.md §7 describes. A node that can be represented
 *   here but not converted back to mdast would silently break the round-trip guarantee, so the
 *   schema and the two converters must always change together. Anything mdast can express that
 *   this schema deliberately does NOT model richly is carried by the `unknownBlock` and `unknownInline`
 *   atoms, which hold the original mdast node verbatim in an attribute — nothing is ever dropped (FR-4.4).
 *
 *   Note on DOM serialization: The schema was written without `toDOM` on the reasoning that the view layer
 *   would supply node views. That was wrong — `EditorView` renders every node through `spec.toDOM`
 *   unless a `nodeViews` entry exists for that type, so constructing a view over any document threw
 *   `TypeError: node.type.spec.toDOM is not a function` and every binding test failed. Note precisely what
 *   `toDOM` is, because it changes nothing about this module's DOM-freedom: it returns a DOMOutputSpec,
 *   a plain data description such as `['p', 0]` where `0` marks the content hole. It performs no DOM API
 *   calls, constructs no elements and touches no globals, so this module remains importable and testable
 *   in a bare Node process. Also note that `parseDOM` is still absent because documents are built from
 *   mdast rather than parsed from HTML, and adding it is a known prerequisite for rich paste support
 *   (FR-7.4) rather than an oversight.
 *
 * @inputs ProseMirror node and mark specifications and mdast AST representations.
 * @outputs The unified `kdocSchema` instance, along with `KdocNodeName` and `KdocMarkName` type unions.
 * @functions None (schema specification and type definitions module).
 * @dataflow mdast nodes ⇄ ProseMirror schema definitions ⇄ WYSIWYG editor state.
 * @controlflow Static schema and type definitions instantiated on module evaluation.
 * @version 9
 * @date 2026-09-18
 */

import {
  Schema,
  type DOMOutputSpec,
  type Mark,
  type MarkSpec,
  type Node as ProsemirrorNode,
  type NodeSpec,
} from 'prosemirror-model';
import { unknownNodeText } from './reference-links.js';

/**
 * The attributes a block carries for its alignment: the style a browser reads and a data attribute a
 * stylesheet or a test can hook. An unaligned block gets an empty attribute object, so nothing is written.
 *
 * @purpose Turns the `align` attribute into DOM attributes for toDOM (FR-8.11).
 * @inputs node - The paragraph or heading being rendered.
 * @outputs A record of DOM attributes, empty when the block is not aligned.
 * @dataflow node.attrs.align -> 'left' | 'center' | 'right' -> { style, data-kdoc-align } or {}.
 * @controlflow Accept only the three alignments; anything else renders as an ordinary block.
 */
function alignAttributes(node: ProsemirrorNode): Record<string, string> {
  const align = node.attrs.align;
  // Check whether the block carries one of the three alignments K-Doc writes.
  if (align === 'left' || align === 'center' || align === 'right') {
    return { style: `text-align: ${align}`, 'data-kdoc-align': align };
  } else {
    // Not aligned (usually null): no attributes at all, so the block renders exactly as it did before.
    return {};
  }
}

/**
 * Node specifications defining the document structure for K-Doc's WYSIWYG editor.
 *
 * NOTE: The declaration order of nodes is significant in ProseMirror. The first node in the
 * 'block' group (`paragraph`) serves as the default block type for commands and operations.
 */
const nodes = {
  // Mirrors mdast `root` (top-level document container).
  doc: {
    content: 'block+',
  },

  // Mirrors mdast `paragraph` (standard textblock; first node in `block` group becomes default block).
  paragraph: {
    group: 'block',
    content: 'inline*',
    attrs: {
      // Block alignment (FR-8.11); null is the ordinary unaligned block, which is every block in a file that
      // carries no HTML wrapper.
      align: { default: null },
    },
    // Renders as a standard <p> element with a content hole and an optional alignment from `alignAttributes`.
    toDOM(node: ProsemirrorNode): DOMOutputSpec {
      return ['p', alignAttributes(node), 0];
    },
  },

  // Mirrors mdast `heading` (header levels 1 through 6).
  heading: {
    group: 'block',
    content: 'inline*',
    attrs: {
      level: { default: 1 },
      // Block alignment (FR-8.11); null is the ordinary unaligned block.
      align: { default: null },
    },
    // Renders as an <h1> through <h6> element depending on the level attribute, plus optional alignment from `alignAttributes`.
    toDOM(node: ProsemirrorNode): DOMOutputSpec {
      const level =
        typeof node.attrs.level === 'number'
          ? Math.max(1, Math.min(6, Math.floor(node.attrs.level)))
          : 1;
      return ['h' + String(level), alignAttributes(node), 0];
    },
  },

  // A video or audio reference the document made with an ordinary link or image (FR-8.17). It is an atom because
  // a player is not text: the document's own words are the link, which `to-mdast` writes back out.
  media: {
    group: 'block',
    atom: true,
    attrs: {
      // 'video' or 'audio' for a file; 'provider' for something a site plays.
      kind: { default: 'video' },
      // The address exactly as the document wrote it.
      target: { default: '' },
      // The link text or image alt.
      label: { default: '' },
      // Which syntax the document used, so the same one is written back.
      syntax: { default: 'link' },
      // The site for a provider embed, and the address of its player; both empty for a file.
      provider: { default: '' },
      embedUrl: { default: '' },
    },
    // Rendered by the node view; this is only what a copy to the clipboard carries.
    toDOM(node: ProsemirrorNode): DOMOutputSpec {
      const target = typeof node.attrs.target === 'string' ? node.attrs.target : '';
      return ['div', { class: 'kdoc-media', 'data-kdoc-media': target }];
    },
  },

  // Mirrors mdast `blockquote` (container for nested block content).
  blockquote: {
    group: 'block',
    content: 'block+',
    // Renders as a <blockquote> element with a content hole.
    toDOM(): DOMOutputSpec {
      return ['blockquote', 0];
    },
  },

  // Mirrors mdast `code` (fenced or indented code block).
  // Note: `marks: ''` and `code: true` are what stop inline formatting leaking into code.
  codeBlock: {
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,
    attrs: {
      language: { default: null },
      meta: { default: null },
    },
    // Renders as a <pre> element containing a <code> element with data-language attribute.
    toDOM(node: ProsemirrorNode): DOMOutputSpec {
      return [
        'pre',
        {
          'data-language':
            typeof node.attrs.language === 'string' ? node.attrs.language : '',
        },
        ['code', 0],
      ];
    },
  },

  // Mirrors mdast `thematicBreak` (horizontal rule separator).
  thematicBreak: {
    group: 'block',
    atom: true,
    // Renders as an <hr> horizontal rule element.
    toDOM(): DOMOutputSpec {
      return ['hr'];
    },
  },

  // Mirrors mdast `list` (unordered bullet list).
  bulletList: {
    group: 'block',
    content: 'listItem+',
    attrs: {
      spread: { default: false },
    },
    // Renders as an <ul> unordered list element with a content hole.
    toDOM(): DOMOutputSpec {
      return ['ul', 0];
    },
  },

  // Mirrors mdast `list` (ordered list with start offset).
  orderedList: {
    group: 'block',
    content: 'listItem+',
    attrs: {
      start: { default: 1 },
      spread: { default: false },
    },
    // Renders as an <ol> ordered list element with a start attribute and content hole.
    toDOM(node: ProsemirrorNode): DOMOutputSpec {
      return [
        'ol',
        {
          start: String(
            typeof node.attrs.start === 'number' ? node.attrs.start : 1,
          ),
        },
        0,
      ];
    },
  },

  // Mirrors mdast `listItem` (single item in an ordered or unordered list).
  // Note: `checked` is `null` for an ordinary item and a boolean for a GFM task-list item, so the three states are distinguishable.
  listItem: {
    content: 'block+',
    defining: true,
    attrs: {
      checked: { default: null },
      // Whether a blank line separates the item's blocks, carried so an untouched loose item compares equal to its source (FR-4.2).
      spread: { default: false },
    },
    // Renders as an <li> list item element with a data-checked attribute and content hole.
    toDOM(node: ProsemirrorNode): DOMOutputSpec {
      return [
        'li',
        {
          'data-checked':
            node.attrs.checked === true
              ? 'true'
              : node.attrs.checked === false
                ? 'false'
                : 'none',
        },
        0,
      ];
    },
  },

  // Mirrors mdast GFM `table` (tabular data container).
  // Note: alignment lives on the table in mdast, not on the cell, so it is stored here to round-trip faithfully.
  table: {
    group: 'block',
    content: 'tableRow+',
    attrs: {
      align: { default: [] },
    },
    // Renders as a <table> element containing a <tbody> wrapper and content hole.
    toDOM(): DOMOutputSpec {
      return ['table', ['tbody', 0]];
    },
  },

  // Mirrors mdast GFM `tableRow` (row within a table).
  tableRow: {
    content: 'tableCell+',
    // Renders as a <tr> table row element with a content hole.
    toDOM(): DOMOutputSpec {
      return ['tr', 0];
    },
  },

  // Mirrors mdast GFM `tableCell` (individual cell within a table row).
  tableCell: {
    content: 'inline*',
    attrs: {
      // A header cell's column width hint in characters (FR-8.26), or null. Kept on the header cell so the hint moves with its column.
      widthHint: { default: null },
    },
    // Renders as a <td> table cell element with a content hole; a hinted header cell sets its column's minimum width.
    toDOM(node: ProsemirrorNode): DOMOutputSpec {
      const hint: unknown = node.attrs.widthHint;
      // Check whether this cell carries a width hint.
      if (typeof hint === 'number') {
        return ['td', { style: `min-width: ${hint}ch` }, 0];
      } else {
        return ['td', 0];
      }
    },
  },

  // Mirrors mdast `yaml` / `toml` (document front matter block).
  // Note: front matter is an atom rather than editable text because a structured metadata panel (FR-4.3) will edit it later; keeping it in the document preserves its position and content exactly.
  frontMatter: {
    group: 'block',
    atom: true,
    attrs: {
      format: { default: 'yaml' },
      value: { default: '' },
    },
    // Renders as a <div> container representing metadata front matter.
    toDOM(node: ProsemirrorNode): DOMOutputSpec {
      return [
        'div',
        {
          class: 'kdoc-front-matter',
          'data-format':
            typeof node.attrs.format === 'string' ? node.attrs.format : 'yaml',
        },
        typeof node.attrs.value === 'string' ? node.attrs.value : '',
      ];
    },
  },

  // A footnote's note ([^id]: ...), shown where it sits in the file: a block of ordinary editable blocks labelled with its id.
  footnoteDefinition: {
    group: 'block',
    content: 'block+',
    defining: true,
    attrs: {
      identifier: { default: '' },
      label: { default: null },
    },
    toDOM(node: ProsemirrorNode): DOMOutputSpec {
      const identifier = typeof node.attrs.identifier === 'string' ? node.attrs.identifier : '';
      const label = typeof node.attrs.label === 'string' ? node.attrs.label : identifier;
      return ['div', { class: 'kdoc-footnote-definition', 'data-footnote': identifier, 'data-label': label }, 0];
    },
  },

  // Mirrors unsupported or raw mdast block constructs (e.g. raw HTML blocks or kdocRaw nodes).
  // Note: the `node` attr holds the original mdast node object verbatim.
  unknownBlock: {
    group: 'block',
    atom: true,
    attrs: {
      node: { default: null },
    },
    // Renders as a <div> container for unsupported block constructs.
    // Note: The raw value is rendered as a TEXT child deliberately: these nodes carry
    // arbitrary source including raw HTML, and injecting it as markup would make the editor
    // an XSS vector for its own documents.
    toDOM(node: ProsemirrorNode): DOMOutputSpec {
      // Raw value, a readable definition line, or the placeholder.
      const textValue = unknownNodeText(node.attrs.node, false);
      return ['div', { class: 'kdoc-unknown-block' }, textValue];
    },
  },

  // Mirrors mdast `text` (raw text leaf node).
  text: {
    group: 'inline',
  },

  // Mirrors mdast `break` (explicit hard line break).
  hardBreak: {
    group: 'inline',
    inline: true,
    atom: true,
    // Renders as a <br> line break element.
    toDOM(): DOMOutputSpec {
      return ['br'];
    },
  },

  // Mirrors mdast `image` (inline image element).
  image: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: {
      src: { default: '' },
      alt: { default: null },
      title: { default: null },
      // Display width in pixels from the alt slot's width hint (`![alt|600](x)`, FR-8.15), or null for natural size.
      width: { default: null },
      // True when this picture came from a wiki embed, `![[img.png|600]]` (FR-8.15). It is drawn like any
      // other image; the flag is what to-mdast reads to write it back as that text rather than as Markdown.
      embed: { default: false },
    },
    // Renders as an <img> inline image element with src, alt, and title attributes, and the width when there is one.
    toDOM(node: ProsemirrorNode): DOMOutputSpec {
      const src = typeof node.attrs.src === 'string' ? node.attrs.src : '';
      const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : '';
      const title = typeof node.attrs.title === 'string' ? node.attrs.title : '';
      // A width hint sizes the picture; without one the picture keeps its natural size.
      return typeof node.attrs.width === 'number'
        ? ['img', { src, alt, title, style: `width: ${node.attrs.width}px` }]
        : ['img', { src, alt, title }];
    },
  },

  // A footnote reference ([^id]), drawn as a small superscript label; the label is data, never editable text.
  footnoteReference: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: {
      identifier: { default: '' },
      label: { default: null },
    },
    toDOM(node: ProsemirrorNode): DOMOutputSpec {
      const identifier = typeof node.attrs.identifier === 'string' ? node.attrs.identifier : '';
      const label = typeof node.attrs.label === 'string' ? node.attrs.label : identifier;
      return ['sup', { class: 'kdoc-footnote-reference', 'data-footnote': identifier }, label];
    },
  },

  // Mirrors unsupported or raw mdast inline constructs (e.g. raw inline HTML or custom directives).
  // Note: the `node` attr holds the original mdast node object verbatim.
  unknownInline: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: {
      node: { default: null },
    },
    // Renders as a <span> inline container for unsupported inline constructs.
    // Note: The raw value is rendered as a TEXT child deliberately: these nodes carry
    // arbitrary source including raw HTML, and injecting it as markup would make the editor
    // an XSS vector for its own documents.
    toDOM(node: ProsemirrorNode): DOMOutputSpec {
      // Raw value or the placeholder.
      const textValue = unknownNodeText(node.attrs['node'], true);
      return ['span', { class: 'kdoc-unknown-inline' }, textValue];
    },
  },
} as const satisfies Record<string, NodeSpec>;

/**
 * Mark specifications defining inline formatting for K-Doc's WYSIWYG editor.
 */
const marks = {
  // Mirrors mdast `strong` (bold text formatting).
  strong: {
    // Renders as a <strong> inline formatting element.
    toDOM(): DOMOutputSpec {
      return ['strong', 0];
    },
  },

  // Mirrors mdast `emphasis` (italic text formatting).
  emphasis: {
    // Renders as an <em> inline formatting element.
    toDOM(): DOMOutputSpec {
      return ['em', 0];
    },
  },

  // Mirrors mdast `inlineCode` (inline code span).
  // Note: `excludes: '_'` makes it mutually exclusive with every other mark, because Markdown cannot express bold inside inline code.
  inlineCode: {
    excludes: '_',
    // Renders as an inline <code> formatting element.
    toDOM(): DOMOutputSpec {
      return ['code', 0];
    },
  },

  // Mirrors mdast GFM `delete` (strikethrough text formatting).
  strikethrough: {
    // Renders as an <s> inline strikethrough element.
    toDOM(): DOMOutputSpec {
      return ['s', 0];
    },
  },

  // Mirrors mdast `highlight` (highlighted text; Markdown syntax `==x==`).
  highlight: {
    // Renders as a <mark> inline highlight element.
    toDOM(): DOMOutputSpec {
      return ['mark', 0];
    },
  },

  // Mirrors mdast `subscript` (subscript text; Markdown syntax `~x~`).
  subscript: {
    // Renders as a <sub> inline subscript element.
    toDOM(): DOMOutputSpec {
      return ['sub', 0];
    },
  },

  // Mirrors mdast `superscript` (superscript text; Markdown syntax `^x^`).
  superscript: {
    // Renders as a <sup> inline superscript element.
    toDOM(): DOMOutputSpec {
      return ['sup', 0];
    },
  },

  // Mirrors mdast `link` (hyperlink with target URI and optional title).
  // Note: `inclusive: false` stops typing at a link's edge from extending it, which is the behaviour every editor user expects.
  link: {
    attrs: {
      href: { default: '' },
      title: { default: null },
      // The reference (identifier, label, reference type, parsed text) a reference-style link came from, or null for an
      // inline link. Editing the link's target replaces the mark, which makes it an inline link.
      reference: { default: null },
    },
    inclusive: false,
    // Renders as an <a> hyperlink element with href and title attributes.
    toDOM(mark: Mark): DOMOutputSpec {
      return [
        'a',
        {
          href: typeof mark.attrs.href === 'string' ? mark.attrs.href : '',
          title: typeof mark.attrs.title === 'string' ? mark.attrs.title : '',
        },
        0,
      ];
    },
  },
} as const satisfies Record<string, MarkSpec>;

/**
 * String-literal union type of all valid node names in the K-Doc ProseMirror schema.
 */
export type KdocNodeName = keyof typeof nodes;

/**
 * String-literal union type of all valid mark names in the K-Doc ProseMirror schema.
 */
export type KdocMarkName = keyof typeof marks;

/**
 * The canonical ProseMirror schema for K-Doc's WYSIWYG pane.
 */
export const kdocSchema: Schema<KdocNodeName, KdocMarkName> = new Schema({ nodes, marks });
