/**
 * @file from-mdast.ts
 * @purpose Converts an mdast AST tree (CommonMark + GFM) into a ProseMirror document tree for the K-Doc editor pane.
 *
 *   This converter is one direction of the pair that must always change together with `to-mdast.ts`
 *   and `schema.ts` (DESIGN.md §7). Anything mdast can express that the schema does not model richly
 *   is carried by the `unknownBlock` and `unknownInline` atoms with the ORIGINAL mdast node stored
 *   verbatim in the `node` attribute, so nothing is ever dropped (FR-4.4) and the reverse conversion
 *   can restore it exactly.
 *
 * @inputs mdast `Root` document and an optional ProseMirror `Schema` (defaults to `kdocSchema`).
 * @outputs Root ProseMirror `Node` (PMNode) conforming to the provided schema.
 * @functions
 *   - mdastToProseMirror: Converts an mdast Root AST into a ProseMirror document node.
 *   - convertBlock: Maps an individual mdast block-level node to a ProseMirror PMNode.
 *   - convertInline: Maps an array of mdast phrasing (inline) nodes to an array of ProseMirror PMNodes.
 *   - stripPositions: Deeply clones an AST node structure while stripping all source position offsets.
 *   - getNodeType: Retrieves a NodeType from the schema, throwing an Error if undefined.
 *   - getMarkType: Retrieves a MarkType from the schema, throwing an Error if undefined.
 * @dataflow mdast `Root` → `mdastToProseMirror` → recursive block/inline mapping → ProseMirror document tree.
 * @controlflow Validate root children → convert top-level blocks → recursively map inline/block children and marks → construct root `doc` node (fallback to empty paragraph if empty).
 * @version 8
 * @date 2026-09-18
 */

import type { Mark, Node as PMNode, Schema, NodeType, MarkType } from 'prosemirror-model';
import type { Definition, PhrasingContent, Root, RootContent } from 'mdast';
import { kdocSchema } from './schema.js';
import { collectDefinitions, referenceAttrs } from './reference-links.js';

// Augmentation-only import. @k-doc/core declares the `toml` front matter node on mdast's
// RootContentMap, because @types/mdast ships `yaml` but deliberately leaves `toml` to the consumer.
// Without this import, this package's view of RootContent has no `toml` member and the narrowing in
// the front matter branch below fails to compile. It must not be removed as an unused import.
import type {} from '@k-doc/core';
import { alignmentOf, hintsOf, mediaOfParagraph, splitImageAlt } from '@k-doc/core';
import { wikiEmbedNodes } from './wiki-embed-nodes.js';

/**
 * Retrieves a required NodeType from the schema, throwing an Error if it is not defined.
 *
 * @purpose Looks up a node type by name on the given schema and guarantees type safety without non-null assertions.
 * @inputs schema - The ProseMirror schema to query.
 * @inputs name - The name of the node type to look up.
 * @outputs NodeType - The resolved NodeType object.
 * @dataflow Queries schema.nodes dictionary → validates existence → returns NodeType.
 * @controlflow Access schema.nodes[name] → check for undefined → throw Error if missing, return NodeType if found.
 */
function getNodeType(schema: Schema, name: string): NodeType {
  const nodeType = schema.nodes[name];
  // Check if the requested node type exists in the schema.
  if (!nodeType) {
    // Node type missing: throw immediate descriptive error.
    throw new Error(`Schema is missing required node type: "${name}"`);
  } else {
    // Node type exists: return the resolved NodeType.
    return nodeType;
  }
}

/**
 * Retrieves a required MarkType from the schema, throwing an Error if it is not defined.
 *
 * @purpose Looks up a mark type by name on the given schema and guarantees type safety without non-null assertions.
 * @inputs schema - The ProseMirror schema to query.
 * @inputs name - The name of the mark type to look up.
 * @outputs MarkType - The resolved MarkType object.
 * @dataflow Queries schema.marks dictionary → validates existence → returns MarkType.
 * @controlflow Access schema.marks[name] → check for undefined → throw Error if missing, return MarkType if found.
 */
function getMarkType(schema: Schema, name: string): MarkType {
  const markType = schema.marks[name];
  // Check if the requested mark type exists in the schema.
  if (!markType) {
    // Mark type missing: throw immediate descriptive error.
    throw new Error(`Schema is missing required mark type: "${name}"`);
  } else {
    // Mark type exists: return the resolved MarkType.
    return markType;
  }
}

/**
 * Deeply clones an AST node structure while stripping all `position` properties.
 *
 * NOTE: Positions are dropped deliberately: they describe offsets into the ORIGINAL source text,
 * which is meaningless once the node is being carried through a different document model (ProseMirror).
 * Furthermore, keeping stale position offsets would cause otherwise-identical node attributes to
 * compare unequal during reconciliation, caching, or diffing.
 *
 * @purpose Recursively removes the `position` property from an AST node and all its descendants.
 * @inputs value - Any unknown value (primitive, null, array, or object) to clone and sanitize.
 * @outputs unknown - A deep structural clone of the input with all `position` keys omitted.
 * @dataflow Traverses nested data structures → filters out 'position' keys → constructs sanitized clone.
 * @controlflow Branch on type (null/primitive → return directly; array → map recursively; object → copy filtered keys).
 */
function stripPositions(value: unknown): unknown {
  // Check if the value is null or not an object (i.e. primitives: string, number, boolean, undefined, symbol, bigint).
  if (value === null || typeof value !== 'object') {
    // Primitives and null are immutable and have no position properties; return as-is.
    return value;
  } else if (Array.isArray(value)) {
    // Arrays: recursively sanitize every item.
    const result: unknown[] = [];
    for (const item of value) {
      result.push(stripPositions(item));
    }
    return result;
  } else {
    // Plain objects: copy every key except 'position', recursing into child values.
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      // Check if the current key is the unist/mdast 'position' property.
      if (key === 'position') {
        // Skip copying the position key.
        continue;
      } else {
        // Copy and recursively strip positions from the child value.
        const childValue = record[key];
        result[key] = stripPositions(childValue);
      }
    }
    return result;
  }
}

/**
 * Converts an array of mdast phrasing (inline) nodes into ProseMirror inline nodes.
 *
 * @purpose Recursively processes phrasing content, accumulating inline marks from enclosing nodes.
 * @inputs nodes - Array of mdast PhrasingContent nodes to convert.
 * @inputs schema - The ProseMirror schema to query for mark and node types.
 * @inputs marks - The accumulated array of ProseMirror Mark instances from enclosing AST elements.
 * @inputs definitions - The document's link definitions by identifier, which resolve reference links.
 * @outputs PMNode[] - Array of converted ProseMirror inline nodes.
 * @dataflow mdast phrasing AST nodes + accumulated marks → type dispatch → ProseMirror inline nodes.
 * @controlflow Iterate over nodes → branch on node.type → accumulate marks or create leaf nodes → return flattened PMNode array.
 */
function convertInline(
  nodes: readonly PhrasingContent[],
  schema: Schema,
  marks: readonly Mark[],
  definitions: ReadonlyMap<string, Definition>
): PMNode[] {
  const result: PMNode[] = [];

  for (const node of nodes) {
    // Handle mdast `text` construct (plain text leaf node).
    if (node.type === 'text') {
      // Check if the text node value is the empty string.
      // ProseMirror strictly forbids empty text nodes (`schema.text('')` throws an error).
      // Therefore, any mdast text node with an empty string value is skipped entirely.
      // A run of text may hold wiki image embeds, `![[img.png|600]]`, which are drawn as pictures rather
      // than as the brackets around their names (FR-8.15); a run with none comes back as itself.
      // wikiEmbedNodes skips an empty stretch, so the empty-text-node rule ProseMirror enforces is kept.
      for (const inline of wikiEmbedNodes(node.value, schema, marks)) {
        result.push(inline);
      }
    }
    // Handle mdast `strong` construct (bold formatting): recurse into children with strong mark appended.
    else if (node.type === 'strong') {
      const strongMarkType = getMarkType(schema, 'strong');
      const nextMarks = marks.concat(strongMarkType.create());
      const childNodes = convertInline(node.children, schema, nextMarks, definitions);
      for (const child of childNodes) {
        result.push(child);
      }
    }
    // Handle mdast `emphasis` construct (italic formatting): recurse into children with emphasis mark appended.
    else if (node.type === 'emphasis') {
      const emphasisMarkType = getMarkType(schema, 'emphasis');
      const nextMarks = marks.concat(emphasisMarkType.create());
      const childNodes = convertInline(node.children, schema, nextMarks, definitions);
      for (const child of childNodes) {
        result.push(child);
      }
    }
    // Handle mdast GFM `delete` construct (strikethrough formatting): recurse into children with strikethrough mark appended.
    else if (node.type === 'delete') {
      const strikethroughMarkType = getMarkType(schema, 'strikethrough');
      const nextMarks = marks.concat(strikethroughMarkType.create());
      const childNodes = convertInline(node.children, schema, nextMarks, definitions);
      for (const child of childNodes) {
        result.push(child);
      }
    }
    // Handle mdast `highlight` (Tier-4 `==x==`): recurse with the highlight mark appended.
    else if (node.type === 'highlight') {
      const highlightMarkType = getMarkType(schema, 'highlight');
      const nextMarks = marks.concat(highlightMarkType.create());
      const childNodes = convertInline(node.children, schema, nextMarks, definitions);
      for (const child of childNodes) {
        result.push(child);
      }
    }
    // Handle mdast `subscript` (Tier-4 `~x~`): recurse with the subscript mark appended.
    else if (node.type === 'subscript') {
      const subscriptMarkType = getMarkType(schema, 'subscript');
      const nextMarks = marks.concat(subscriptMarkType.create());
      const childNodes = convertInline(node.children, schema, nextMarks, definitions);
      for (const child of childNodes) {
        result.push(child);
      }
    }
    // Handle mdast `superscript` (Tier-4 `^x^`): recurse with the superscript mark appended.
    else if (node.type === 'superscript') {
      const superscriptMarkType = getMarkType(schema, 'superscript');
      const nextMarks = marks.concat(superscriptMarkType.create());
      const childNodes = convertInline(node.children, schema, nextMarks, definitions);
      for (const child of childNodes) {
        result.push(child);
      }
    }
    // Handle mdast `link` construct: recurse into children with link mark appended.
    else if (node.type === 'link') {
      const linkMarkType = getMarkType(schema, 'link');
      const linkMark = linkMarkType.create({
        href: node.url,
        title: node.title ?? null,
      });
      const nextMarks = marks.concat(linkMark);
      const childNodes = convertInline(node.children, schema, nextMarks, definitions);
      for (const child of childNodes) {
        result.push(child);
      }
    }
    // Handle mdast `linkReference` (`[text][label]`, `[label][]`, `[label]`): a link whose target comes from its definition.
    // It becomes the same link mark an inline link does, so it is clickable and editable, and the mark keeps the reference
    // so the link is written back as a reference rather than rewritten inline.
    else if (node.type === 'linkReference') {
      const definition = definitions.get(node.identifier);
      const linkMarkType = getMarkType(schema, 'link');
      const linkMark = linkMarkType.create({
        // A reference always has a definition when parsed; one missing here leaves the link without a target rather than failing.
        href: definition === undefined ? '' : definition.url,
        title: definition === undefined ? null : definition.title ?? null,
        reference: referenceAttrs(node),
      });
      const childNodes = convertInline(node.children, schema, marks.concat(linkMark), definitions);
      for (const child of childNodes) {
        result.push(child);
      }
    }
    // Handle mdast `inlineCode` construct: create a text node with inlineCode mark appended.
    else if (node.type === 'inlineCode') {
      // Check if the inlineCode value is empty.
      // ProseMirror forbids empty text nodes; skip creating a text node if value is empty string.
      if (node.value !== '') {
        const inlineCodeMarkType = getMarkType(schema, 'inlineCode');
        const codeMark = inlineCodeMarkType.create();
        result.push(schema.text(node.value, marks.concat(codeMark)));
      } else {
        // Skip empty inlineCode value.
      }
    }
    // Handle mdast `break` construct (hard line break): create hardBreak inline atom with marks.
    else if (node.type === 'break') {
      const hardBreakType = getNodeType(schema, 'hardBreak');
      result.push(hardBreakType.create(null, null, marks));
    }
    // Handle mdast `image` construct: create image inline atom with src/alt/title attributes and marks.
    else if (node.type === 'image') {
      const imageType = getNodeType(schema, 'image');
      // The width hint is split off the alt so the alt field edits only the words (FR-8.15).
      const parts = splitImageAlt(node.alt);
      const attrs = {
        src: node.url,
        alt: parts.alt,
        title: node.title ?? null,
        width: parts.width,
      };
      result.push(imageType.create(attrs, null, marks));
    }
    // A footnote reference keeps its identifier and the label as written, which is what the serializer writes back.
    else if (node.type === 'footnoteReference') {
      const referenceType = getNodeType(schema, 'footnoteReference');
      result.push(referenceType.create({ identifier: node.identifier, label: node.label ?? null }, null, marks));
    }
    // Handle any other or unsupported mdast phrasing construct (e.g. raw html, unknown directives, kdocRaw).
    else {
      const unknownInlineType = getNodeType(schema, 'unknownInline');
      result.push(
        unknownInlineType.create(
          {
            node: stripPositions(node),
          },
          null,
          marks
        )
      );
    }
  }

  return result;
}

/**
 * Converts a single mdast block-level node into a corresponding ProseMirror Node.
 *
 * @purpose Maps mdast block elements to ProseMirror nodes according to the K-Doc schema.
 * @inputs node - The mdast RootContent node to convert.
 * @inputs schema - The ProseMirror schema to query for node and mark types.
 * @inputs definitions - The document's link definitions by identifier, passed down to inline conversion.
 * @outputs PMNode - The converted ProseMirror block node.
 * @dataflow mdast RootContent node → type-specific translation and child recursion → ProseMirror block node.
 * @controlflow Inspect node.type → dispatch to corresponding block constructor → validate content constraints → return PMNode.
 */
function convertBlock(node: RootContent, schema: Schema, definitions: ReadonlyMap<string, Definition>): PMNode {
  // Handle mdast `paragraph` construct: convert inline children.
  if (node.type === 'paragraph') {
    // A paragraph that is nothing but a reference to a video, audio file or provider becomes a player (FR-8.17).
    const embed = mediaOfParagraph(node);
    const mediaType = schema.nodes['media'];
    // Check whether this paragraph is such a reference and the schema has a node to hold it.
    if (embed !== null && mediaType !== undefined) {
      return mediaType.create({
        kind: embed.kind,
        target: embed.target,
        label: embed.label,
        syntax: embed.syntax,
        provider: embed.provider ?? '',
        embedUrl: embed.embedUrl ?? '',
      });
    } else {
      // Ordinary prose, or a schema without the media node: convert it as the paragraph it is.
    }
    const paragraphType = getNodeType(schema, 'paragraph');
    const inlineChildren = convertInline(node.children, schema, [], definitions);
    // Alignment comes from the HTML wrapper the file carries (FR-8.11).
    return paragraphType.create({ align: alignmentOf(node) }, inlineChildren);
  }
  // Handle mdast `heading` construct: set level attribute and convert inline children.
  else if (node.type === 'heading') {
    const headingType = getNodeType(schema, 'heading');
    const inlineChildren = convertInline(node.children, schema, [], definitions);
    // Alignment comes from the HTML wrapper the file carries (FR-8.11).
    return headingType.create({ level: node.depth, align: alignmentOf(node) }, inlineChildren);
  }
  // Handle mdast `blockquote` construct: convert nested block children.
  else if (node.type === 'blockquote') {
    const blockquoteType = getNodeType(schema, 'blockquote');
    // Check if the blockquote has any children.
    // The ProseMirror schema requires `block+` content for blockquotes; an empty blockquote
    // would be invalid according to the schema. Therefore, when children are empty, insert one empty paragraph.
    if (node.children.length === 0) {
      // Empty blockquote: insert a single empty paragraph to satisfy the `block+` schema constraint.
      const paragraphType = getNodeType(schema, 'paragraph');
      const emptyParagraph = paragraphType.create();
      return blockquoteType.create(null, [emptyParagraph]);
    } else {
      // Non-empty blockquote: recursively convert each child block.
      const blockChildren: PMNode[] = [];
      for (const child of node.children) {
        blockChildren.push(convertBlock(child, schema, definitions));
      }
      return blockquoteType.create(null, blockChildren);
    }
  }
  // Handle mdast `code` construct (fenced or indented code block).
  else if (node.type === 'code') {
    const codeBlockType = getNodeType(schema, 'codeBlock');
    const attrs = {
      language: node.lang ?? null,
      meta: node.meta ?? null,
    };
    // Check if the code block value is the empty string.
    // ProseMirror strictly forbids creating empty text nodes (`schema.text('')` throws).
    // When value is empty, provide empty/null content to produce a valid empty code block.
    if (node.value === '') {
      // Value is empty: create codeBlock with no child text node.
      return codeBlockType.create(attrs);
    } else {
      // Value is non-empty: create a single text child node holding the code value.
      const textNode = schema.text(node.value);
      return codeBlockType.create(attrs, [textNode]);
    }
  }
  // Handle mdast `thematicBreak` construct: create horizontal rule atom.
  else if (node.type === 'thematicBreak') {
    const thematicBreakType = getNodeType(schema, 'thematicBreak');
    return thematicBreakType.create();
  }
  // Handle mdast `list` construct (ordered or bullet list).
  else if (node.type === 'list') {
    // Check if the list has any children.
    // The ProseMirror schema requires `listItem+` for both `orderedList` and `bulletList`.
    // An empty list cannot satisfy this constraint. Falling back to an `unknownBlock` atom
    // preserving the raw node is preferable to emitting an invalid document structure.
    if (node.children.length === 0) {
      // Empty list: fall back to unknownBlock holding the stripped mdast node.
      const unknownBlockType = getNodeType(schema, 'unknownBlock');
      return unknownBlockType.create({ node: stripPositions(node) });
    } else {
      // Non-empty list: convert each child listItem block.
      const listItems: PMNode[] = [];
      for (const child of node.children) {
        listItems.push(convertBlock(child, schema, definitions));
      }
      // Check if the list is ordered.
      if (node.ordered === true) {
        // Ordered list: create orderedList node with start offset and spread attrs.
        const orderedListType = getNodeType(schema, 'orderedList');
        return orderedListType.create(
          {
            start: node.start ?? 1,
            spread: node.spread ?? false,
          },
          listItems
        );
      } else {
        // Unordered list: create bulletList node with spread attr.
        const bulletListType = getNodeType(schema, 'bulletList');
        return bulletListType.create(
          {
            spread: node.spread ?? false,
          },
          listItems
        );
      }
    }
  }
  // Handle mdast `listItem` construct (item within a list).
  else if (node.type === 'listItem') {
    const listItemType = getNodeType(schema, 'listItem');
    const attrs = {
      checked: node.checked ?? null,
      spread: node.spread ?? false,
    };
    // Check if the listItem has any children.
    // The ProseMirror schema requires `block+` content for listItem; an empty listItem
    // would be invalid. When children are empty, insert one empty paragraph.
    if (node.children.length === 0) {
      // Empty listItem: insert a single empty paragraph to satisfy `block+`.
      const paragraphType = getNodeType(schema, 'paragraph');
      const emptyParagraph = paragraphType.create();
      return listItemType.create(attrs, [emptyParagraph]);
    } else {
      // Non-empty listItem: recursively convert each child block.
      const blockChildren: PMNode[] = [];
      for (const child of node.children) {
        blockChildren.push(convertBlock(child, schema, definitions));
      }
      return listItemType.create(attrs, blockChildren);
    }
  }
  // Handle mdast `table` construct (GFM table container).
  else if (node.type === 'table') {
    // Check if the table has any rows.
    // The ProseMirror schema requires `tableRow+` content; an empty table is invalid.
    if (node.children.length === 0) {
      // Empty table: fall back to unknownBlock holding the stripped mdast node.
      const unknownBlockType = getNodeType(schema, 'unknownBlock');
      return unknownBlockType.create({ node: stripPositions(node) });
    } else {
      // Non-empty table: convert each tableRow child.
      const tableType = getNodeType(schema, 'table');
      const rows: PMNode[] = [];
      // Column width hints (FR-8.26) go onto the header row's cells, so column edits carry them along.
      const hints = hintsOf(node);
      node.children.forEach((child, index) => {
        const row = convertBlock(child, schema, definitions);
        // Only the header row of a table with hints needs them; a row that fell back to unknownBlock has no cells.
        if (index === 0 && hints !== null && row.type.name === 'tableRow') {
          const cells: PMNode[] = [];
          row.forEach((cell, _offset, cellIndex) => {
            cells.push(cell.type.create({ ...cell.attrs, widthHint: hints[cellIndex] ?? null }, cell.content, cell.marks));
          });
          rows.push(row.type.create(row.attrs, cells));
        } else {
          rows.push(row);
        }
      });
      return tableType.create(
        {
          align: node.align ?? [],
        },
        rows
      );
    }
  }
  // Handle mdast `tableRow` construct (row in a GFM table).
  else if (node.type === 'tableRow') {
    // Check if the tableRow has any cells.
    // The ProseMirror schema requires `tableCell+` content; a row with no cells is invalid.
    if (node.children.length === 0) {
      // Row with no cells: fall back to unknownBlock holding the stripped mdast node.
      const unknownBlockType = getNodeType(schema, 'unknownBlock');
      return unknownBlockType.create({ node: stripPositions(node) });
    } else {
      // Non-empty tableRow: convert each tableCell child.
      const tableRowType = getNodeType(schema, 'tableRow');
      const cells: PMNode[] = [];
      for (const child of node.children) {
        cells.push(convertBlock(child, schema, definitions));
      }
      return tableRowType.create(null, cells);
    }
  }
  // Handle mdast `tableCell` construct (individual cell within a table row).
  else if (node.type === 'tableCell') {
    const tableCellType = getNodeType(schema, 'tableCell');
    const inlineChildren = convertInline(node.children, schema, [], definitions);
    return tableCellType.create(null, inlineChildren);
  }
  // Handle mdast `yaml` and `toml` front matter constructs.
  else if (node.type === 'yaml' || node.type === 'toml') {
    // Both yaml and toml front matter nodes are mdast Literals carrying a string `value`, so once
    // the union has narrowed the value can be read directly — no defensive cast is warranted.
    const frontMatterType = getNodeType(schema, 'frontMatter');
    return frontMatterType.create({
      format: node.type,
      value: node.value,
    });
  }
  // A footnote's note: its blocks are converted like a blockquote's, so the note is edited like any other text.
  else if (node.type === 'footnoteDefinition') {
    const definitionType = getNodeType(schema, 'footnoteDefinition');
    const attrs = { identifier: node.identifier, label: node.label ?? null };
    // An empty note still needs one block to hold the caret.
    if (node.children.length === 0) {
      return definitionType.create(attrs, [getNodeType(schema, 'paragraph').create()]);
    } else {
      return definitionType.create(attrs, node.children.map((child) => convertBlock(child, schema, definitions)));
    }
  }
  // Handle any other or unsupported mdast block construct (e.g. html, definition, kdocRaw, etc.).
  else {
    const unknownBlockType = getNodeType(schema, 'unknownBlock');
    return unknownBlockType.create({
      node: stripPositions(node),
    });
  }
}

/**
 * Converts an mdast Root AST node into a complete ProseMirror document Node.
 *
 * NOTE ON EMPTY ROOT ASYMMETRY:
 * ProseMirror's `doc` node requires `block+` content and cannot represent a genuinely empty document.
 * Therefore, when `root.children` is empty, this function creates a document containing a single
 * empty `paragraph` node. This is a deliberate, documented asymmetry (DESIGN.md §7 / FR-4.4): an
 * empty mdast root becomes a document with one empty paragraph and does NOT round-trip back to
 * an empty root. This is the only place where the conversion is not strictly information-preserving.
 *
 * @purpose Top-level converter transforming an mdast Root AST into a ProseMirror document Node.
 * @inputs root - The root mdast AST node.
 * @inputs schema - The ProseMirror schema to validate and build nodes with (defaults to `kdocSchema`).
 * @outputs PMNode - The constructed ProseMirror root `doc` Node.
 * @dataflow mdast Root → convert children blocks → construct doc node.
 * @controlflow Inspect root.children length → if empty create single paragraph doc, else convert all block children → return doc node.
 */
export function mdastToProseMirror(root: Root, schema: Schema = kdocSchema): PMNode {
  const docType = getNodeType(schema, 'doc');

  // Check if the mdast root has any children.
  // ProseMirror's `doc` node requires `block+` content and cannot represent a genuinely empty document.
  // As a deliberate, documented asymmetry (DESIGN.md §7 / FR-4.4), an empty mdast root becomes a
  // document containing one empty paragraph and does NOT round-trip back to an empty root.
  // This is the only place where the conversion is not strictly information-preserving.
  if (root.children.length === 0) {
    // Root is empty: create a doc node containing a single empty paragraph.
    const paragraphType = getNodeType(schema, 'paragraph');
    const emptyParagraph = paragraphType.create();
    return docType.create(null, [emptyParagraph]);
  } else {
    // Root has children: convert each top-level block child into a ProseMirror node.
    // Definitions are gathered first, since a reference can come before the definition it uses.
    const definitions = collectDefinitions(root);
    const children: PMNode[] = [];
    for (const child of root.children) {
      children.push(convertBlock(child, schema, definitions));
    }
    return docType.create(null, children);
  }
}
