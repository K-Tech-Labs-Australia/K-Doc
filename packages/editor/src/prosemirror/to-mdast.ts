/**
 * @file to-mdast.ts
 * @purpose Converts a ProseMirror document tree into an mdast (Markdown Abstract Syntax Tree) Root,
 *   performing the exact reverse conversion of from-mdast.ts with mark run nesting and structural fidelity.
 *
 *   This converter is one third of the contract DESIGN.md §7 describes. It is the exact reverse of
 *   from-mdast.ts, and the schema and the two converters must always change together. Anything mdast
 *   can express that the schema deliberately does not model richly is carried by the unknownBlock and
 *   unknownInline atoms, which hold the original mdast node verbatim in an attribute — nothing is ever
 *   dropped (FR-4.4).
 *
 * @inputs doc - A ProseMirror document root Node (PMNode) conforming to kdocSchema.
 * @outputs Root - An mdast Root AST node representing the structured Markdown document.
 * @functions
 *   - proseMirrorToMdast: Public entry point that converts a ProseMirror document node to an mdast Root.
 *   - convertBlock: Converts a ProseMirror block node into a corresponding mdast RootContent node or null if unrecognized.
 *   - convertInlineChildren: Extracts inline children from a ProseMirror parent node and groups them by mark hierarchy.
 *   - groupByMarks: Recursively groups contiguous inline nodes sharing formatting marks into nested mdast phrasing content.
 *   - convertInlineLeaf: Converts a ProseMirror leaf inline node (text, hardBreak, image, unknownInline) into an mdast PhrasingContent node.
 * @dataflow ProseMirror doc → block dispatch (convertBlock) → inline children extraction (convertInlineChildren) → mark run grouping (groupByMarks) → leaf conversion (convertInlineLeaf) → mdast Root tree.
 * @controlflow Top-down recursive tree traversal: iterate block nodes in document fragment, extract inline fragments, group runs of contiguous formatting marks into nested AST wrappers, and convert leaf nodes.
 * @version 8
 * @date 2026-09-18
 */

import type { Mark, Node as PMNode } from 'prosemirror-model';
import { applyAlignment, COLUMN_WIDTHS_KEY, joinImageAlt, wikiEmbedText } from '@k-doc/core';
import type { BlockAlignment } from '@k-doc/core';
import { linkReferenceNode, referenceAttrsOf } from './reference-links.js';
import type {
  Blockquote,
  Code,
  FootnoteDefinition,
  FootnoteReference,
  Heading,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableCell,
  TableRow,
  Text,
} from 'mdast';

/**
 * Canonical mark nesting hierarchy.
 *
 * The order of mark names in this array determines how formatting marks nest within the mdast tree,
 * matching the canonical AST shape produced by remark: a link wraps a strong, which wraps a
 * emphasis, which wraps a strikethrough (delete).
 */
// The order decides which mark becomes the outer mdast node when several apply to the same text.
//
// `highlight` sits above the character formats because that is how people write it: `==**bold**==`
// is far commoner than `**==bold==**`, and putting `strong` first turned the first form into the
// second on every round trip through the WYSIWYG pane -- a silent rewrite of the user's source.
//
// `subscript` and `superscript` go last because they are genuinely the narrowest: they wrap a digit
// or a short token, never a formatted run.
const MARK_NESTING_ORDER = [
  'link',
  'highlight',
  'strong',
  'emphasis',
  'strikethrough',
  'subscript',
  'superscript',
] as const;

/**
 * Converts a ProseMirror document tree into an mdast syntax tree.
 *
 * @purpose Converts a ProseMirror document root node into an mdast Root AST.
 * @inputs doc - ProseMirror document root Node (PMNode).
 * @outputs Root - The resulting mdast Root AST node containing converted block children.
 * @dataflow ProseMirror doc fragment → iterate direct children → convertBlock → filter nulls → mdast Root.
 * @controlflow Iterates over all block children in doc.content, converts each via convertBlock, filters out nulls, and wraps in Root.
 */
export function proseMirrorToMdast(doc: PMNode): Root {
  const children: RootContent[] = [];

  // Iterate over each direct child block of the ProseMirror document.
  doc.forEach((childNode) => {
    const converted = convertBlock(childNode);
    // Include only successfully converted block nodes; skip unrecognized or invalid nodes.
    if (converted !== null) {
      children.push(converted);
    } else {
      // Unrecognized node returned null; skipping to prevent emitting a malformed tree.
    }
  });

  return {
    type: 'root',
    children,
  };
}

/**
 * Converts an individual ProseMirror block node into an mdast RootContent node.
 *
 * @purpose Maps a ProseMirror block node to its corresponding mdast block construct.
 * @inputs node - The ProseMirror block Node (PMNode) to convert.
 * @outputs RootContent | null - The converted mdast block node, or null if the node type is unrecognized.
 * @dataflow ProseMirror block node → type inspection & attribute normalization → mdast block node.
 * @controlflow Dispatches on node.type.name, extracts and narrows attributes defensively, converts nested block or inline children, and returns the mdast node or null for unrecognized types.
 */
function convertBlock(node: PMNode): RootContent | null {
  const nodeType = node.type.name;

  // Handles schema node: `paragraph`
  // A player is written back as the link or image the document used for it (FR-8.17), so the file never learns
  // that K-Doc showed it as a player.
  if (nodeType === 'media') {
    const target = typeof node.attrs.target === 'string' ? node.attrs.target : '';
    const label = typeof node.attrs.label === 'string' ? node.attrs.label : '';
    // Check which syntax the document used for this reference.
    if (node.attrs.syntax === 'image') {
      const imageNode: Paragraph = {
        type: 'paragraph',
        children: [{ type: 'image', url: target, alt: label, title: null }],
      };
      return imageNode;
    } else {
      // A link, which is the default: its text is the label, and an empty label writes an empty link text.
    }
    const linkNode: Paragraph = {
      type: 'paragraph',
      children: [{ type: 'link', url: target, title: null, children: label === '' ? [] : [{ type: 'text', value: label }] }],
    };
    return linkNode;
  } else {
    // Not a player: fall through to the ordinary block conversions below.
  }

  if (nodeType === 'paragraph') {
    const paragraphNode: Paragraph = {
      type: 'paragraph',
      children: convertInlineChildren(node),
    };
    // Write the block's alignment back into mdast (FR-8.11).
    applyAlignment(paragraphNode, alignmentAttr(node));
    return paragraphNode;
  }

  // Handles schema node: `heading`
  if (nodeType === 'heading') {
    // Narrow and clamp level attribute between 1 and 6 for mdast heading depth.
    const rawLevel = typeof node.attrs.level === 'number' && Number.isFinite(node.attrs.level)
      ? Math.floor(node.attrs.level)
      : 1;
    const clampedLevel = Math.max(1, Math.min(6, rawLevel));
    const depth = (clampedLevel >= 1 && clampedLevel <= 6 ? clampedLevel : 1) as 1 | 2 | 3 | 4 | 5 | 6;

    const headingNode: Heading = {
      type: 'heading',
      depth,
      children: convertInlineChildren(node),
    };
    // Write the block's alignment back into mdast (FR-8.11).
    applyAlignment(headingNode, alignmentAttr(node));
    return headingNode;
  }

/**
 * @purpose Reads a block's alignment attribute, accepting only the three values K-Doc writes (FR-8.11).
 * @inputs node - The ProseMirror paragraph or heading being converted.
 * @outputs BlockAlignment | null - The alignment, or null for an ordinary block.
 * @dataflow node.attrs.align -> validated alignment or null.
 * @controlflow Accept 'left', 'center' and 'right'; treat everything else, including null, as unaligned.
 */
function alignmentAttr(node: PMNode): BlockAlignment | null {
  const align = node.attrs.align;
  // Check whether the attribute holds one of the three alignments.
  if (align === 'left' || align === 'center' || align === 'right') {
    return align;
  } else {
    // Anything else, null included, is an ordinary block.
    return null;
  }
}

  // Handles schema node: `blockquote`
  if (nodeType === 'blockquote') {
    const blockquoteChildren: RootContent[] = [];
    node.forEach((childNode) => {
      const converted = convertBlock(childNode);
      // Filter out unrecognized or invalid child nodes.
      if (converted !== null) {
        blockquoteChildren.push(converted);
      } else {
        // Skip unrecognized block child.
      }
    });

    const blockquoteNode: Blockquote = {
      type: 'blockquote',
      children: blockquoteChildren as Blockquote['children'],
    };
    return blockquoteNode;
  }

  // Handles schema node: `codeBlock`
  if (nodeType === 'codeBlock') {
    const lang = typeof node.attrs.language === 'string' ? node.attrs.language : null;
    const meta = typeof node.attrs.meta === 'string' ? node.attrs.meta : null;

    const codeNode: Code = {
      type: 'code',
      lang,
      meta,
      value: node.textContent,
    };
    return codeNode;
  }

  // Handles schema node: `thematicBreak`
  if (nodeType === 'thematicBreak') {
    return {
      type: 'thematicBreak',
    };
  }

  // Handles schema node: `bulletList`. remark emits `start: null` on an unordered list rather than omitting the field, so it must be present here or every round-trip of a bullet list differs by exactly that one key. This was found by the corpus tests rather than reasoned about up front.
  if (nodeType === 'bulletList') {
    const listItems: ListItem[] = [];
    node.forEach((childNode) => {
      const converted = convertBlock(childNode);
      // Verify that the converted child is a valid ListItem.
      if (converted !== null && converted.type === 'listItem') {
        listItems.push(converted);
      } else {
        // Skip unrecognized or non-listItem child in bulletList.
      }
    });

    const spread = typeof node.attrs.spread === 'boolean' ? node.attrs.spread : false;
    const listNode: List = {
      type: 'list',
      ordered: false,
      start: null,
      spread,
      children: listItems,
    };
    return listNode;
  }

  // Handles schema node: `orderedList`
  if (nodeType === 'orderedList') {
    const listItems: ListItem[] = [];
    node.forEach((childNode) => {
      const converted = convertBlock(childNode);
      // Verify that the converted child is a valid ListItem.
      if (converted !== null && converted.type === 'listItem') {
        listItems.push(converted);
      } else {
        // Skip unrecognized or non-listItem child in orderedList.
      }
    });

    const rawStart = typeof node.attrs.start === 'number' && Number.isFinite(node.attrs.start)
      ? Math.floor(node.attrs.start)
      : 1;
    const start = rawStart >= 0 ? rawStart : 1;
    const spread = typeof node.attrs.spread === 'boolean' ? node.attrs.spread : false;

    const listNode: List = {
      type: 'list',
      ordered: true,
      start,
      spread,
      children: listItems,
    };
    return listNode;
  }

  // Handles schema node: `listItem`
  if (nodeType === 'listItem') {
    const checked = typeof node.attrs.checked === 'boolean' ? node.attrs.checked : null;
    const listItemChildren: RootContent[] = [];
    node.forEach((childNode) => {
      const converted = convertBlock(childNode);
      // Filter out unrecognized or invalid child nodes.
      if (converted !== null) {
        listItemChildren.push(converted);
      } else {
        // Skip unrecognized child in listItem.
      }
    });

    const listItemNode: ListItem = {
      type: 'listItem',
      checked,
      spread: node.attrs.spread === true,
      children: listItemChildren as ListItem['children'],
    };
    return listItemNode;
  }

  // Handles schema node: `table`
  if (nodeType === 'table') {
    let align: ('left' | 'right' | 'center' | null)[] | null = null;
    if (Array.isArray(node.attrs.align)) {
      align = node.attrs.align.map((entry) => {
        if (entry === 'left' || entry === 'right' || entry === 'center') {
          return entry;
        }
        return null;
      });
    }

    const tableRows: TableRow[] = [];
    node.forEach((childNode) => {
      const converted = convertBlock(childNode);
      // Verify that the converted child is a valid TableRow.
      if (converted !== null && converted.type === 'tableRow') {
        tableRows.push(converted);
      } else {
        // Skip unrecognized or non-tableRow child in table.
      }
    });

    // Column width hints (FR-8.26) are read back off the header row's cells; a table without any keeps no data at all, so
    // an untouched table compares equal to its parsed source.
    const hints: (number | null)[] = [];
    node.firstChild?.forEach((cell) => {
      const hint: unknown = cell.attrs.widthHint;
      hints.push(typeof hint === 'number' ? hint : null);
    });
    const tableNode: Table = {
      type: 'table',
      align,
      children: tableRows,
      ...(hints.some((hint) => hint !== null) ? { data: { [COLUMN_WIDTHS_KEY]: hints } as Table['data'] } : {}),
    };
    return tableNode;
  }

  // Handles schema node: `tableRow`
  if (nodeType === 'tableRow') {
    const tableCells: TableCell[] = [];
    node.forEach((childNode) => {
      const converted = convertBlock(childNode);
      // Verify that the converted child is a valid TableCell.
      if (converted !== null && converted.type === 'tableCell') {
        tableCells.push(converted);
      } else {
        // Skip unrecognized or non-tableCell child in tableRow.
      }
    });

    const tableRowNode: TableRow = {
      type: 'tableRow',
      children: tableCells,
    };
    return tableRowNode;
  }

  // Handles schema node: `tableCell`
  if (nodeType === 'tableCell') {
    const tableCellNode: TableCell = {
      type: 'tableCell',
      children: convertInlineChildren(node),
    };
    return tableCellNode;
  }

  // Handles schema node: `frontMatter`
  if (nodeType === 'frontMatter') {
    const format = node.attrs.format === 'toml' ? 'toml' : 'yaml';
    const value = typeof node.attrs.value === 'string' ? node.attrs.value : '';

    // The resulting front matter node is cast through unknown to RootContent because `toml`
    // is a K-Doc-declared mdast RootContentMap module augmentation (see packages/core/src/ast/types.ts).
    return {
      type: format,
      value,
    } as unknown as RootContent;
  }

  // Handles schema node: `footnoteDefinition` (its blocks convert as a blockquote's do).
  if (nodeType === 'footnoteDefinition') {
    const children: RootContent[] = [];
    node.forEach((childNode) => {
      const converted = convertBlock(childNode);
      // A block K-Doc cannot express in mdast is left out rather than written wrongly.
      if (converted !== null) {
        children.push(converted);
      } else {
        // Skip unrecognized block child.
      }
    });
    const identifier = typeof node.attrs.identifier === 'string' ? node.attrs.identifier : '';
    const definition: FootnoteDefinition = {
      type: 'footnoteDefinition',
      identifier,
      children: children as FootnoteDefinition['children'],
    };
    // The label is what the file spelled; keep it only when there was one.
    if (typeof node.attrs.label === 'string') {
      definition.label = node.attrs.label;
    } else {
      // No label: the identifier alone is written.
    }
    return definition;
  }

  // Handles schema node: `unknownBlock`
  if (nodeType === 'unknownBlock') {
    // Deep-clone the stored original mdast node via structuredClone so mutations to the returned AST cannot mutate document attributes.
    if (node.attrs.node !== null && typeof node.attrs.node === 'object') {
      return structuredClone(node.attrs.node) as RootContent;
    }
    return null;
  }

  // Handles any unrecognized schema node type.
  // A null return signifies that the document contained an unexpected node type not permitted
  // by the schema; skipping it is safer than emitting a malformed or corrupted AST tree.
  return null;
}

/**
 * Extracts inline children from a ProseMirror parent node and groups them by mark hierarchy.
 *
 * @purpose Collects inline PMNode children from a parent and groups them hierarchically by mark runs.
 * @inputs parent - The ProseMirror parent Node (PMNode) containing inline content.
 * @outputs PhrasingContent[] - Array of converted mdast phrasing content nodes with appropriate mark nesting.
 * @dataflow parent inline children → array collection → groupByMarks(children, []) → PhrasingContent[].
 * @controlflow Iterates over parent's child nodes using forEach, collects them into a flat array, and delegates mark grouping to groupByMarks.
 */
function convertInlineChildren(parent: PMNode): PhrasingContent[] {
  const inlineNodes: PMNode[] = [];
  parent.forEach((child) => {
    inlineNodes.push(child);
  });
  return groupByMarks(inlineNodes, []);
}

/**
 * Recursively groups contiguous inline nodes sharing formatting marks into nested mdast phrasing content.
 *
 * @purpose Implements mark nesting hierarchy (link > strong > emphasis > strikethrough) and maximal run grouping.
 * @inputs
 *   - nodes: Readonly array of ProseMirror inline nodes to convert and group.
 *   - applied: Readonly array of mark names already applied by ancestor mdast wrapper nodes.
 * @outputs PhrasingContent[] - Array of mdast PhrasingContent nodes representing the grouped inline sequence.
 * @dataflow nodes sequence → identify first unapplied mark in hierarchy → find maximal run of consecutive nodes carrying that mark → recurse → wrap in mdast parent node → repeat until all nodes are leaf-converted.
 * @controlflow Walks nodes by index. For each node, checks for the first unapplied mark in MARK_NESTING_ORDER. If none, converts the single node to a leaf and advances by 1. If present, scans forward to find the maximal consecutive run of nodes sharing that mark, recurses on that run with the mark added to applied, wraps the result in the corresponding mdast node, and advances past the run.
 */
function groupByMarks(nodes: readonly PMNode[], applied: readonly string[]): PhrasingContent[] {
  const result: PhrasingContent[] = [];
  let i = 0;

  while (i < nodes.length) {
    const currentNode = nodes[i];
    // Guard against out-of-bounds indexing under noUncheckedIndexedAccess.
    if (currentNode === undefined) {
      break;
    }

    // Find the first mark name in the canonical nesting hierarchy that currentNode carries and that has not yet been applied.
    const targetMarkName = MARK_NESTING_ORDER.find(
      (markName) => !applied.includes(markName) && currentNode.marks.some((m: Mark) => m.type.name === markName),
    );

    // Case 1: No unapplied formatting marks remain on this node; convert it directly to an mdast leaf node.
    if (targetMarkName === undefined) {
      const leaf = convertInlineLeaf(currentNode);
      if (leaf !== null) {
        result.push(leaf);
      } else {
        // Skip unrecognized inline leaf node.
      }
      i++;
    } else {
      // Case 2: An unapplied mark is found. Scan forward to find the maximal run of consecutive nodes that ALSO carry that mark.
      // Run-scanning is required because converting each node independently would emit adjacent wrapper nodes
      // (e.g. two adjacent `strong` nodes) where remark produces a single wrapper containing all children,
      // which is a structural difference the round-trip test would catch.
      let j = i + 1;
      while (j < nodes.length) {
        const nextNode = nodes[j];
        if (nextNode !== undefined && nextNode.marks.some((m: Mark) => m.type.name === targetMarkName)) {
          j++;
        } else {
          break;
        }
      }

      const run = nodes.slice(i, j);
      const groupedChildren = groupByMarks(run, applied.concat(targetMarkName));

      // Wrap the grouped children in the corresponding mdast AST node.
      if (targetMarkName === 'link') {
        const linkMark = currentNode.marks.find((m: Mark) => m.type.name === 'link');
        const rawHref = linkMark?.attrs?.href ?? linkMark?.attrs?.url;
        const url = typeof rawHref === 'string' ? rawHref : '';
        const title = typeof linkMark?.attrs?.title === 'string' ? linkMark.attrs.title : null;
        const reference = referenceAttrsOf(linkMark?.attrs?.reference);

        // A link that came from a reference is written back as that reference; its target lives in the definition.
        if (reference !== null) {
          result.push(linkReferenceNode(reference, groupedChildren));
        } else {
          // An inline link keeps its target and title in place.
          result.push({
            type: 'link',
            url,
            title,
            children: groupedChildren,
          });
        }
      } else if (targetMarkName === 'strong') {
        result.push({
          type: 'strong',
          children: groupedChildren,
        });
      } else if (targetMarkName === 'emphasis') {
        result.push({
          type: 'emphasis',
          children: groupedChildren,
        });
      } else if (targetMarkName === 'strikethrough') {
        result.push({
          type: 'delete',
          children: groupedChildren,
        });
      } else if (targetMarkName === 'highlight') {
        // Tier-4 highlight: the mdast node shares the mark's name.
        result.push({
          type: 'highlight',
          children: groupedChildren,
        });
      } else if (targetMarkName === 'subscript') {
        // Tier-4 subscript: the mdast node shares the mark's name.
        result.push({
          type: 'subscript',
          children: groupedChildren,
        });
      } else if (targetMarkName === 'superscript') {
        // Tier-4 superscript: the mdast node shares the mark's name.
        result.push({
          type: 'superscript',
          children: groupedChildren,
        });
      }

      // Advance index past the entire contiguous run of formatted nodes.
      i = j;
    }
  }

  return result;
}

/**
 * Converts a ProseMirror leaf inline node into an mdast PhrasingContent node.
 *
 * @purpose Converts leaf inline nodes (text, hardBreak, image, unknownInline) to mdast phrasing nodes.
 * @inputs node - The ProseMirror leaf inline Node (PMNode) to convert.
 * @outputs PhrasingContent | null - The converted mdast phrasing content node, or null if unrecognized.
 * @dataflow ProseMirror inline leaf node → type & mark inspection → mdast PhrasingContent node.
 * @controlflow Checks if text node has inlineCode mark (converting to inlineCode literal), plain text (converting to text literal), hardBreak (break), image (image), unknownInline (structuredClone of node attr), or returns null.
 */
function convertInlineLeaf(node: PMNode): PhrasingContent | null {
  // Handles schema node: `text` node carrying `inlineCode` mark.
  // inlineCode is treated as a leaf rather than a wrapper because the schema defines `excludes: '_'`
  // on inlineCode, making it mutually exclusive with every other mark, so it can never contain formatted children.
  if (node.isText && node.marks.some((m: Mark) => m.type.name === 'inlineCode')) {
    return {
      type: 'inlineCode',
      value: node.text ?? '',
    };
  }

  // Handles schema node: plain `text`
  if (node.isText) {
    const textNode: Text = {
      type: 'text',
      value: node.text ?? '',
    };
    return textNode;
  }

  // Handles schema node: `hardBreak`
  if (node.type.name === 'hardBreak') {
    return {
      type: 'break',
    };
  }

  // Handles schema node: `image`
  if (node.type.name === 'image') {
    const src = typeof node.attrs.src === 'string' ? node.attrs.src : '';
    const words = typeof node.attrs.alt === 'string' ? node.attrs.alt : null;
    const title = typeof node.attrs.title === 'string' ? node.attrs.title : null;
    const pixels = typeof node.attrs.width === 'number' ? node.attrs.width : null;

    // A picture that came from a wiki embed is written back as the text it was read from, `![[img.png|600]]`
    // (FR-8.15). It is a text node rather than an image because that is what the file holds: a Markdown
    // image here would rewrite a reader's wiki embed into a different syntax just because they resized it.
    if (node.attrs.embed === true) {
      const embedText: Text = { type: 'text', value: wikiEmbedText({ target: src, width: pixels }) };
      return embedText;
    } else {
      // An ordinary Markdown image: fall through to write it back as one.
    }

    // The width hint goes back into the alt slot only when the image has a width (FR-8.15).
    const alt = joinImageAlt(words, pixels);

    return {
      type: 'image',
      url: src,
      alt,
      title,
    };
  }

  // Handles schema node: `footnoteReference`.
  if (node.type.name === 'footnoteReference') {
    const identifier = typeof node.attrs.identifier === 'string' ? node.attrs.identifier : '';
    const reference: FootnoteReference = { type: 'footnoteReference', identifier };
    // The label is what the file spelled; keep it only when there was one.
    if (typeof node.attrs.label === 'string') {
      reference.label = node.attrs.label;
    } else {
      // No label: the identifier alone is written.
    }
    return reference;
  }

  // Handles schema node: `unknownInline`
  if (node.type.name === 'unknownInline') {
    // Deep-clone the stored original mdast node via structuredClone so caller mutations do not affect document attributes.
    if (node.attrs.node !== null && typeof node.attrs.node === 'object') {
      return structuredClone(node.attrs.node) as PhrasingContent;
    }
    return null;
  }

  // Handles any unrecognized inline node type.
  // Returning null allows the caller to safely skip unknown inline structures without crashing.
  return null;
}
