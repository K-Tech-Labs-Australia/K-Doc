/**
 * @file docx-export.ts
 * @purpose Writes a K-Doc document as a Word document (FR-13.4): headings become Word's own heading styles, lists become real numbered and bulleted lists, tables become Word tables, footnotes become Word footnotes, and local pictures are embedded. Anything Markdown can say that Word has no place for is left out and named, so the export says what it lost rather than losing it quietly.
 * @inputs the document's mdast tree (root), a title, and data URIs for its local pictures keyed by the address as written (options).
 * @outputs the .docx bytes and the names of whatever could not be carried across (DocxExport); a Document plus skipped names from buildDocx.
 * @functions
 *   - buildDocx: Builds a docx Document from an mdast root and returns it together with skipped node names.
 *   - exportDocx: Serialises the built document to .docx bytes via Packer for the host to write to disk.
 * @dataflow mdast -> blocks and runs -> a docx Document -> Packer -> bytes.
 * @controlflow every node is handled by its type; an unknown block with children is walked for its text, and anything else is recorded as skipped.
 * @version 1
 * @date 2026-09-17
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  FootnoteReferenceRun,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx';
import type { Root } from 'mdast';
import { MAX_IMAGE_WIDTH_PX, decodeImage, fitWidth } from './docx-images.js';

export interface DocxExportOptions {
  readonly title: string;
  readonly images: ReadonlyMap<string, string>;
}

export interface DocxExport {
  readonly bytes: Uint8Array;
  readonly skipped: readonly string[];
}

type Node = { readonly type: string; readonly children?: readonly Node[]; readonly value?: unknown; readonly [key: string]: unknown };

type Block = Paragraph | Table;

interface RunStyle {
  readonly bold: boolean;
  readonly italics: boolean;
  readonly strike: boolean;
  readonly code: boolean;
  readonly link: boolean;
}

interface Placement {
  readonly quoteDepth: number;
  readonly listLevel: number;
  readonly bullet: { readonly ordered: boolean; readonly instance: number; readonly checked: boolean | null } | null;
}

interface Context {
  readonly images: ReadonlyMap<string, string>;
  readonly definitions: Map<string, Node>;
  readonly footnoteIds: Map<string, number>;
  readonly footnotes: Record<string, { children: Paragraph[] }>;
  readonly skipped: Set<string>;
  orderedLists: number;
}

const NUMBERED = 'kdoc-numbered';

const INDENT_STEP = 720;

const CODE_FONT = 'Consolas';

const CODE_SHADING = { type: ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' } as const;

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

const PLAIN: RunStyle = { bold: false, italics: false, strike: false, code: false, link: false };

const TOP_LEVEL: Placement = { quoteDepth: 0, listLevel: 0, bullet: null };

function childrenOf(node: Node): readonly Node[] {
  // Return the existing children array when present, or an empty one when the node declares none.
  return Array.isArray(node.children) ? node.children : [];
}

function stringField(node: Node, field: string): string {
  const value = node[field];
  // Keep only genuine strings; coerce missing or non-string fields to an empty string.
  return typeof value === 'string' ? value : '';
}

function textRun(text: string, style: RunStyle): TextRun {
  return new TextRun({
    text,
    bold: style.bold,
    italics: style.italics,
    strike: style.strike,
    // Apply the monospace code treatment only for inline-code runs.
    ...(style.code ? { font: CODE_FONT, shading: CODE_SHADING } : {}),
    // Apply Word's built-in hyperlink style only for link children.
    ...(style.link ? { style: 'Hyperlink' } : {}),
  });
}

function footnoteId(identifier: string, ctx: Context): number | null {
  const known = ctx.footnoteIds.get(identifier);
  // A previously assigned id is reused verbatim so every reference to this footnote stays consistent.
  if (known !== undefined) {
    return known;
  } else {
    // No cached id yet: fall through to resolve it from the definition store below.
  }

  const definition = ctx.definitions.get(identifier);
  // Without a stored definition there is nothing to render, so the reference cannot be resolved.
  if (definition === undefined) {
    return null;
  } else {
    // No matching definition: fall through and report that no id could be assigned.
  }

  // Assign the id before building the body so a footnote that refers to itself cannot recurse forever.
  const id = ctx.footnoteIds.size + 1;
  ctx.footnoteIds.set(identifier, id);
  const paragraphs: Paragraph[] = [];
  for (const block of blocks(childrenOf(definition), TOP_LEVEL, ctx)) {
    if (block instanceof Paragraph) {
      // A footnote body keeps its paragraph children as-is.
      paragraphs.push(block);
    } else {
      // Word cannot embed a table inside a footnote, so it is named as skipped.
      ctx.skipped.add('table inside a footnote');
    }
  }
  ctx.footnotes[String(id)] = { children: paragraphs };
  return id;
}

function imageRun(node: Node, ctx: Context): ParagraphChild {
  const url = stringField(node, 'url');
  const alt = stringField(node, 'alt');
  // Bracketed description is used when the picture cannot be embedded rather than dropping it silently.
  const fallback = textRun(`[${alt.length > 0 ? alt : url}]`, PLAIN);
  const source = ctx.images.get(url);
  // A picture that was never gathered from disk has no bytes to embed, so it is named as skipped.
  if (source === undefined) {
    ctx.skipped.add('picture that could not be read');
    return fallback;
  } else {
    // Source present: fall through to decode the gathered data URI.
  }

  const decoded = decodeImage(source);
  // Word cannot embed certain formats (e.g. SVG), so such a picture is named as skipped and texted instead.
  if (decoded === null) {
    ctx.skipped.add('picture in a format Word cannot embed');
    return fallback;
  } else {
    // Decoded successfully: fall through to fit the image to the page width.
  }

  const size = fitWidth(decoded.width, decoded.height, MAX_IMAGE_WIDTH_PX);
  return new ImageRun({
    type: decoded.type,
    data: decoded.bytes,
    transformation: { width: size.width, height: size.height },
    // Use the alt text when present, otherwise a generic 'picture' label for accessibility.
    altText: { name: alt.length > 0 ? alt : 'picture', description: alt, title: alt },
  });
}

function inline(nodes: readonly Node[], style: RunStyle, ctx: Context): ParagraphChild[] {
  const runs: ParagraphChild[] = [];
  for (const node of nodes) {
    switch (node.type) {
      // Plain text renders verbatim; soft newlines collapse to spaces as they do on screen.
      case 'text':
        runs.push(textRun(stringField(node, 'value').replace(/\n/g, ' '), style));
        break;
      // Strong emphasis is rendered by recursing with bold turned on.
      case 'strong':
        runs.push(...inline(childrenOf(node), { ...style, bold: true }, ctx));
        break;
      // Emphasis is rendered by recursing with italics turned on.
      case 'emphasis':
        runs.push(...inline(childrenOf(node), { ...style, italics: true }, ctx));
        break;
      // Deleted text is rendered by recursing with strike-through turned on.
      case 'delete':
        runs.push(...inline(childrenOf(node), { ...style, strike: true }, ctx));
        break;
      // Inline code keeps the surrounding style but gains the monospace code treatment.
      case 'inlineCode':
        runs.push(textRun(stringField(node, 'value'), { ...style, code: true }));
        break;
      // A soft line break is a hard break run so Word wraps at the same point.
      case 'break':
        runs.push(new TextRun({ text: '', break: 1 }));
        break;
      // Links are external hyperlinks whose children inherit the hyperlink style.
      case 'link':
        runs.push(
          new ExternalHyperlink({
            link: stringField(node, 'url'),
            children: inline(childrenOf(node), { ...style, link: true }, ctx),
          }),
        );
        break;
      // Pictures are delegated to imageRun, which handles embedding or fallback.
      case 'image':
        runs.push(imageRun(node, ctx));
        break;
      // Footnote references resolve to a numbered run, or to literal Markdown when unresolved.
      case 'footnoteReference': {
        const id = footnoteId(stringField(node, 'identifier'), ctx);
        // No resolvable definition: fall back to the raw [^label] Markdown so nothing is lost silently.
        if (id === null) {
          runs.push(textRun(`[^${stringField(node, 'label')}]`, style));
        } else {
          // A known footnote emits Word's own reference run.
          runs.push(new FootnoteReferenceRun(id));
        }
        break;
      }
      // Raw HTML has no Word equivalent and is named as skipped.
      case 'html':
        ctx.skipped.add('raw HTML');
        break;
      default:
        // An unknown inline node with children is walked for its text...
        if (Array.isArray(node.children)) {
          runs.push(...inline(node.children, style, ctx));
        } else if (typeof node.value === 'string') {
          // ...otherwise a string value is emitted as plain text.
          runs.push(textRun(node.value, style));
        } else {
          // ...and anything else has no textual content to carry across, so it is named as skipped.
          ctx.skipped.add(node.type);
        }
    }
  }
  return runs;
}

function paragraph(children: ParagraphChild[], placement: Placement, first: boolean): Paragraph {
  const bullet = placement.bullet;
  const quoteIndent = placement.quoteDepth * INDENT_STEP;
  const listIndent = bullet !== null && !first ? (placement.listLevel + 1) * INDENT_STEP : 0;
  const leftIndent = quoteIndent + listIndent;

  let numbering: { reference: string; level: number; instance: number } | undefined;
  let bulletOption: { level: number } | undefined;
  // Only a list item's first paragraph carries the number or bullet; later paragraphs are merely indented.
  if (bullet !== null && first) {
    // Ordered lists use the shared numbered config with this item's instance.
    if (bullet.ordered) {
      numbering = { reference: NUMBERED, level: placement.listLevel, instance: bullet.instance };
    } else {
      // Bulleted lists use Word's built-in bullet option at this nesting level.
      bulletOption = { level: placement.listLevel };
    }
  } else {
    // Not the first paragraph of a list item: leave numbering/bullet unset so it lines up under the marker.
  }

  let runs = children;
  // A task-list item's opening paragraph is prefixed with a checked or unchecked box character.
  if (bullet !== null && first && bullet.checked !== null) {
    // Emit a filled box for checked items and an empty box otherwise, then the item text.
    runs = [new TextRun({ text: bullet.checked ? '☑ ' : '☐ ' }), ...children];
  } else {
    // A non-task list item keeps its children unchanged.
  }

  return new Paragraph({
    children: runs,
    // Omit the numbering option when this paragraph is not numbered.
    ...(numbering === undefined ? {} : { numbering }),
    // Omit the bullet option when this paragraph is not bulleted.
    ...(bulletOption === undefined ? {} : { bullet: bulletOption }),
    // Indent only when quote or list nesting produced a positive offset.
    ...(leftIndent > 0 ? { indent: { left: leftIndent } } : {}),
    // A quoted block is marked with a light left border so a Word reader recognises it.
    ...(placement.quoteDepth > 0
      ? { border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'BBBBBB', space: 8 } } }
      : {}),
  });
}

function alignmentOf(value: unknown): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  // A centre-aligned column returns Word's center alignment.
  if (value === 'center') {
    return AlignmentType.CENTER;
  } else if (value === 'right') {
    // A right-aligned column returns Word's right alignment.
    return AlignmentType.RIGHT;
  } else if (value === 'left') {
    // A left-aligned column returns Word's left alignment.
    return AlignmentType.LEFT;
  } else {
    // Unrecognised alignment: leave it to Word's default by returning undefined.
    return undefined;
  }
}

function table(node: Node, ctx: Context): Table {
  const align = Array.isArray(node['align']) ? (node['align'] as readonly unknown[]) : [];
  const rows = childrenOf(node).map(
    (row, rowIndex) =>
      new TableRow({
        // The first row is the header row, repeated on every page.
        tableHeader: rowIndex === 0,
        children: childrenOf(row).map((cell, columnIndex) => {
          const alignment = alignmentOf(align[columnIndex]);
          return new TableCell({
            children: [
              new Paragraph({
                // Header cells are bold; body cells use the plain style.
                children: inline(childrenOf(cell), rowIndex === 0 ? { ...PLAIN, bold: true } : PLAIN, ctx),
                // Omit alignment when the column has none so Word applies its default.
                ...(alignment === undefined ? {} : { alignment }),
              }),
            ],
          });
        }),
      }),
  );
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

function list(node: Node, placement: Placement, ctx: Context): Block[] {
  const ordered = node['ordered'] === true;
  let instance = 0;
  if (ordered) {
    // Each ordered list is its own numbering instance so a later list starts again at 1.
    ctx.orderedLists += 1;
    instance = ctx.orderedLists;
  } else {
    // Bulleted lists share no counter, so the instance stays 0 and Word supplies the bullet.
  }
  // A nested list sits one level deeper than the item that contains it.
  const level = placement.bullet === null ? 0 : placement.listLevel + 1;

  const out: Block[] = [];
  for (const item of childrenOf(node)) {
    // Use the checked flag when present, otherwise treat the item as an ordinary list entry.
    const checked = typeof item['checked'] === 'boolean' ? item['checked'] : null;
    const itemPlacement: Placement = {
      quoteDepth: placement.quoteDepth,
      listLevel: level,
      bullet: { ordered, instance, checked },
    };
    let first = true;
    for (const child of childrenOf(item)) {
      // A nested list goes through blocks like any other child, which places it one level deeper.
      if (child.type === 'paragraph') {
        // The item's first paragraph carries the number/bullet; later ones are indented to line up with it.
        out.push(paragraph(inline(childrenOf(child), PLAIN, ctx), itemPlacement, first));
        first = false;
      } else {
        // Any other child block is delegated to blocks at this item's placement.
        out.push(...blocks([child], itemPlacement, ctx));
        first = false;
      }
    }
  }
  return out;
}

function blocks(nodes: readonly Node[], placement: Placement, ctx: Context): Block[] {
  const out: Block[] = [];
  for (const node of nodes) {
    switch (node.type) {
      // Headings map to Word's own heading styles by depth; anything outside [1,6] is clamped.
      case 'heading': {
        // Use the declared depth when numeric, defaulting to level 1 otherwise.
        const depth = typeof node['depth'] === 'number' ? node['depth'] : 1;
        const heading = HEADINGS[Math.min(Math.max(depth, 1), 6) - 1] ?? HeadingLevel.HEADING_1;
        out.push(new Paragraph({ heading, children: inline(childrenOf(node), PLAIN, ctx) }));
        break;
      }
      case 'paragraph':
        // A top-level paragraph is its placement's first child block.
        out.push(paragraph(inline(childrenOf(node), PLAIN, ctx), placement, true));
        break;
      case 'blockquote':
        // Quoting runs one level deeper for everything nested inside the quote.
        out.push(...blocks(childrenOf(node), { ...placement, quoteDepth: placement.quoteDepth + 1 }, ctx));
        break;
      case 'list':
        // Ordered and unordered lists render through their own list builder.
        out.push(...list(node, placement, ctx));
        break;
      case 'code':
        // One Word paragraph per source line in a monospace, shaded run; an empty line is a space so the paragraph keeps its height.
        for (const line of stringField(node, 'value').split('\n')) {
          out.push(
            new Paragraph({
              children: [textRun(
                // An empty source line becomes a single space so the paragraph keeps its height.
                line.length === 0 ? ' ' : line,
                { ...PLAIN, code: true },
              )],
              shading: CODE_SHADING,
              // A quoted code block is indented one step per enclosing quote depth.
              ...(placement.quoteDepth > 0 ? { indent: { left: placement.quoteDepth * INDENT_STEP } } : {}),
            }),
          );
        }
        break;
      case 'table':
        // Word tables render through their own table builder.
        out.push(table(node, ctx));
        break;
      case 'thematicBreak':
        // A paragraph with a bottom border is how Word draws a horizontal rule.
        out.push(
          new Paragraph({
            children: [],
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } },
          }),
        );
        break;
      case 'footnoteDefinition':
      case 'definition':
      case 'yaml':
      case 'toml':
        // Footnotes are written where they are referred to, link definitions and front matter have nothing to show.
        break;
      case 'html':
        // No Word equivalent exists, so raw HTML is recorded as skipped.
        ctx.skipped.add('raw HTML');
        break;
      default:
        // An unknown block with children is walked node by node.
        if (Array.isArray(node.children)) {
          out.push(...blocks(node.children, placement, ctx));
        } else {
          // Anything without children is recorded as skipped.
          ctx.skipped.add(node.type);
        }
    }
  }
  return out;
}

/**
 * @purpose Renders a docx Document from a markdown AST, collecting footnote definitions and numbering configs.
 * @inputs root - The parsed markdown root node tree to export.
 * @inputs options - Export options containing title and embedded images.
 * @outputs A document object plus the sorted set of skipped block types.
 * @dataflow Markdown AST → blocks() walk → Document builder → { document, skipped }.
 * @controlflow Collect footnote definitions first → build context → render top-level blocks → assemble numbering and footnotes → return.
 */
export function buildDocx(root: Root, options: DocxExportOptions): { readonly document: Document; readonly skipped: readonly string[] } {
  const definitions = new Map<string, Node>();
  // Collected from the whole tree, not just the top level: a footnote may be defined inside a quotation
  // or a list, and one collected only from the top would be dropped and its reference left as raw text.
  const collect = (nodes: readonly Node[]): void => {
    for (const candidate of nodes) {
      // Check whether this node is a footnote definition, which is remembered by its identifier.
      if (candidate.type === 'footnoteDefinition') {
        definitions.set(stringField(candidate, 'identifier'), candidate);
      } else {
        // Anything else may still contain one further down.
        collect(childrenOf(candidate));
      }
    }
  };
  collect(childrenOf(root as unknown as Node));
  const ctx: Context = {
    images: options.images,
    definitions,
    footnoteIds: new Map<string, number>(),
    footnotes: {},
    skipped: new Set<string>(),
    orderedLists: 0,
  };

  // Every ordered list gets its own numbering instance of one shared nine-level decimal definition.
  const children = blocks(childrenOf(root as unknown as Node), TOP_LEVEL, ctx);
  const document = new Document({
    creator: 'K-Doc',
    title: options.title,
    numbering: {
      config: [
        {
          reference: NUMBERED,
          levels: Array.from({ length: 9 }, (_unused, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: INDENT_STEP * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    footnotes: ctx.footnotes,
    sections: [{ children }],
  });
  return { document, skipped: [...ctx.skipped].sort() };
}

/**
 * @purpose Serializes the built document to a docx byte buffer for host consumption.
 * @inputs root - The parsed markdown root node tree to export.
 * @inputs options - Export options controlling title and embedded images.
 * @outputs A promise resolving to the docx bytes and skipped block types.
 * @dataflow Markdown AST → buildDocx() → Packer.toArrayBuffer() → Uint8Array bytes.
 * @controlflow Build document → serialize to array buffer → wrap in Uint8Array → resolve.
 */
export async function exportDocx(root: Root, options: DocxExportOptions): Promise<DocxExport> {
  const { document, skipped } = buildDocx(root, options);
  // The bytes are what the host writes to disk.
  const buffer = await Packer.toArrayBuffer(document);
  return { bytes: new Uint8Array(buffer), skipped };
}
