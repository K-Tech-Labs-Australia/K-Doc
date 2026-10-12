/**
 * @file html-import.ts
 * @purpose Imports HTML and plain-text source into K-Doc mdast syntax trees together with a report of every construct that could not be represented in Markdown.
 *   Why this exists:
 *   Converting to Markdown is lossy by design (see parse/html.ts), but callers importing external content must learn exactly what was dropped rather than discovering the gap on the next save. This module runs the same hast -> mdast pipeline as html.ts while walking the tree once to tally every construct that Markdown cannot express, returning both the converted document and a per-label loss count.
 *   Known limitation:
 *   The loss report counts occurrences of each dropped construct but does not capture their position in the source; it is an aggregate summary rather than a location-aware audit. Inline data-URI images are reported as lost because they cannot be embedded as Markdown, even though the bytes still exist in the original file.
 * @inputs Raw HTML (a whole page or a fragment) or plain-text source string.
 * @outputs ImportResult carrying canonical Markdown text and an aggregated list of what was lost on import.
 * @functions
 *   - mergeLosses: Fuses multiple loss groups into a single per-label count map.
 *   - inspectChildren: Recursively walks a hast subtree, dropping unrepresentable nodes and tallying losses via the note callback.
 *   - importHtml: Converts an HTML string to Markdown while producing a loss report.
 *   - importPlainText: Converts plain text into canonical Markdown with no losses.
 * @dataflow Source string -> whitespace guard -> unified processor (rehypeParse + rehypeRemark) -> hast tree -> inspectChildren tally -> mdast Root -> KdocDocument -> serializeDocument -> ImportResult.
 * @controlflow Guard empty input -> parse HTML to hast -> take footnotes out -> inspect children and record losses -> runSync to mdast -> wrap in KdocDocument -> serialize and attach loss report (plain text: split into paragraphs, serialize with no losses).
 * @version 1
 * @date 2026-09-17
 */

import type { Root, BlockContent, DefinitionContent } from 'mdast';
import type { Root as HastRoot, RootContent as HastContent, Element } from 'hast';
import { extractFootnotes, FOOTNOTE_REFERENCE_TAG } from './html-footnotes.js';
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import type { KdocDocument } from '../ast/types.js';
import { serializeDocument } from '../serialize/serializer.js';

/**
 * A single entry in the loss report describing a construct that was dropped on import and how many times it occurred.
 */
export interface ImportLoss {
  readonly label: string;
  readonly count: number;
}

/**
 * The result of an import: canonical Markdown text plus the aggregated list of what was lost.
 */
export interface ImportResult {
  readonly markdown: string;
  readonly losses: readonly ImportLoss[];
}

/**
 * Per-label identifiers for constructs that HTML can express but Markdown cannot, paired with a human-readable description of what was lost.
 */
export const IMPORT_LOSS = {
  underline: 'underlining',
  highlight: 'highlighting',
  script: 'subscript and superscript',
  styling: 'text colours, fonts and sizes',
  alignment: 'paragraph alignment',
  mergedCells: 'merged table cells',
  nestedTable: 'tables inside tables',
  blockInCell: 'lists and blocks inside table cells',
  media: 'embedded media',
  form: 'form fields',
  embeddedPicture: 'pictures stored inside the file',
  scripts: 'scripts',
} as const;

// Elements whose content is embedded media with no Markdown form; dropped and reported.
const DROPPED_MEDIA = new Set(['iframe', 'video', 'audio', 'embed', 'object', 'canvas', 'svg']);
// Interactive form controls; dropped and reported.
const DROPPED_FORM = new Set(['input', 'button', 'select', 'textarea']);
// Inline formatting that is reported and then replaced by its own text.
const UNWRAPPED = new Set(['u', 'ins', 'mark']);
// Blocks that a Markdown table cell cannot hold.
const CELL_BLOCKS = new Set(['ul', 'ol', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
// Table structure, whose alignment Markdown tables can express.
const TABLE_PARTS = new Set(['td', 'th', 'tr', 'col', 'colgroup', 'table']);
// An inline style that sets colour, background, font or size.
const STYLING_PATTERN = /(^|;)\s*(color|background|background-color|font-family|font-size)\s*:/i;
// An inline style that sets text alignment; group 2 is the value.
const ALIGN_PATTERN = /(^|;)\s*text-align\s*:\s*([a-z-]+)/i;

/**
 * Makes the first row of a table with no header its header.
 *
 * @purpose A Markdown table must have a header row; Word and most pages mark none, and without this the import
 *   writes an empty header above the data.
 * @inputs table - A table element, changed in place.
 * @outputs void.
 * @dataflow table -> rows (directly or inside thead/tbody/tfoot) -> first row's td cells renamed th.
 * @controlflow Stop when any th already exists; otherwise rename the first row's cells (a thead row is a header row
 *   whatever its cells are called).
 */
function promoteHeaderRow(table: Element): void {
  const rows: Element[] = [];
  let hasHeader = false;
  const visit = (element: Element): void => {
    for (const child of element.children) {
      // Only elements can be rows, header cells or row groups.
      if (child.type !== 'element') {
        continue;
      } else if (child.tagName === 'table') {
        // A nested table has its own header; do not look inside it.
        continue;
      } else if (child.tagName === 'th') {
        hasHeader = true;
      } else if (child.tagName === 'tr') {
        rows.push(child);
        visit(child);
      } else {
        // A row group or anything else: look inside it for rows.
        visit(child);
      }
    }
  };
  visit(table);
  const first = rows[0];
  // Check whether the table already says which row is its header, or has no rows at all.
  if (hasHeader || first === undefined) {
    return;
  } else {
    // No header: the first row becomes it.
  }
  for (const cell of first.children) {
    // Only data cells are renamed; whitespace between them stays as it is.
    if (cell.type === 'element' && cell.tagName === 'td') {
      cell.tagName = 'th';
    } else {
      // Not a data cell: leave it.
    }
  }
}

/**
 * Fuses multiple loss groups into a single per-label count map.
 *
 * @purpose Combines several ImportLoss arrays into one aggregated report keyed by label.
 * @inputs ...groups - Loss groups to merge, each an array of ImportLoss entries.
 * @outputs ImportLoss[] - One entry per distinct label with the summed count across all groups.
 * @dataflow Each group's losses -> running Map<label,count> -> flattened ImportLoss list.
 * @controlflow For each group and loss, increment the map counter; collapse the map into a flat list on return.
 */
export function mergeLosses(...groups: ReadonlyArray<readonly ImportLoss[]>): ImportLoss[] {
  // Accumulate per-label counts across all groups into a single map.
  const map = new Map<string, number>();

  // Walk each loss group supplied to the call.
  for (const group of groups) {
    // Iterate every loss entry within the current group.
    for (const loss of group) {
      // Increment the running count for this label, defaulting to zero when first seen.
      map.set(loss.label, (map.get(loss.label) ?? 0) + loss.count);
    }
  }

  // Collapse the accumulated counts back into a flat list of ImportLoss objects.
  return [...map].map(([label, count]) => ({ label, count }));
}

/**
 * Recursively walks a hast subtree, dropping unrepresentable nodes and tallying losses via the note callback.
 *
 * @purpose Inspects each element for constructs Markdown cannot express, recording losses while preserving representable structure.
 * @inputs children - The hast child nodes to inspect.
 * @inputs inCell - Whether the current node sits inside a table cell (affects nested-table and block-in-cell rules).
 * @inputs note - Callback invoked with a IMPORT_LOSS label whenever a construct is dropped or flattened.
 * @outputs HastContent[] - Only the children that survived inspection, with descendants re-inspected in place.
 * @dataflow hast children -> per-element rule checks + recursion -> kept child list.
 * @controlflow Skip non-elements; for elements apply drop/record rules by tag, recurse into cells, then keep the element.
 */
function inspectChildren(
  children: HastContent[],
  inCell: boolean,
  note: (label: string) => void,
): HastContent[] {
  // Collect the child nodes that survive inspection into the returned list.
  const kept: HastContent[] = [];

  // Walk each direct child of the current element.
  for (const child of children) {
    // Non-element nodes (text, comments, etc.) are always preserved as-is.
    if (child.type !== 'element') {
      // Branch: Child is not an element; keep it unchanged and skip further inspection.
      kept.push(child);
      continue;
    } else {
      // Branch: Child is an element; inspect its tag, attributes and descendants.
    }

    // Extract the element's tag name and attribute map for inspection.
    const tag = child.tagName;
    const props = child.properties;

    // Resolve the inline style string, defaulting to empty when absent or non-string.
    const style = typeof props.style === 'string' ? props.style : '';

    // Drop <script> nodes and record that script content was lost on import.
    if (tag === 'script') {
      // Branch: Node is a script element; discard it and note the loss.
      note(IMPORT_LOSS.scripts);
      continue;
    } else {
      // Branch: Node is not a script element; continue inspection.
    }

    // Drop embedded media elements (iframes, video, audio, etc.) and record the loss.
    if (DROPPED_MEDIA.has(tag)) {
      // Branch: Node is dropped media; discard it and note the loss.
      note(IMPORT_LOSS.media);
      continue;
    } else {
      // Branch: Node is not dropped media; continue inspection.
    }

    // Drop form field elements (inputs, buttons, selects, etc.) and record the loss.
    if (DROPPED_FORM.has(tag)) {
      // Branch: Node is a form field; discard it and note the loss.
      note(IMPORT_LOSS.form);
      continue;
    } else {
      // Branch: Node is not a form field; continue inspection.
    }

    // Record that an inline data-URI image cannot be embedded as Markdown.
    if (tag === 'img' && typeof props.src === 'string' && props.src.startsWith('data:')) {
      // Branch: Node is a data-URI image; note the loss of the embedded picture.
      note(IMPORT_LOSS.embeddedPicture);
      continue;
    } else {
      // Branch: Node is not an inline data-URI image; continue inspection.
    }

    // Record that underlining (<u>, <ins>) has no Markdown equivalent.
    if (tag === 'u' || tag === 'ins') {
      // Branch: Node marks underlined text; note the loss of underlining.
      note(IMPORT_LOSS.underline);
    } else {
      // Branch: Node does not underline text; leave it untouched.
    }

    // Record that highlighting (<mark>) has no Markdown equivalent.
    if (tag === 'mark') {
      // Branch: Node marks highlighted text; note the loss of highlighting.
      note(IMPORT_LOSS.highlight);
    } else {
      // Branch: Node does not highlight text; leave it untouched.
    }

    // Record that subscript/superscript (<sub>, <sup>) has no Markdown equivalent.
    if (tag === 'sub' || tag === 'sup') {
      // Branch: Node renders subscript or superscript; note the loss of script styling.
      note(IMPORT_LOSS.script);
    } else {
      // Branch: Node is not subscript/superscript; leave it untouched.
    }

    // Record that <font> tags or inline colour/font styles are dropped by Markdown.
    if (tag === 'font' || STYLING_PATTERN.test(style)) {
      // Branch: Node carries text styling; note the loss of colours, fonts and sizes.
      note(IMPORT_LOSS.styling);
    } else {
      // Branch: Node carries no text styling; leave it untouched.
    }

    // Detect paragraph-level alignment that Markdown cannot represent.
    if (!TABLE_PARTS.has(tag)) {
      // Branch: Node is not a table part; alignment applies at the block level.
      // Resolve the align attribute, falling back to an explicit text-align style value.
      const align = typeof props.align === 'string' ? props.align : (ALIGN_PATTERN.exec(style)?.[2] ?? '');
      const lower = align.toLowerCase();

      // Note any alignment other than the default left/start direction.
      if (lower !== '' && lower !== 'left' && lower !== 'start') {
        // Branch: Alignment is non-default; note the loss of paragraph alignment.
        note(IMPORT_LOSS.alignment);
      } else {
        // Branch: Alignment is empty or default left/start; record no alignment loss.
      }
    } else {
      // Branch: Node is a table part; block-level alignment does not apply, so skip the check.
    }

    // Record that merged cells (colspan/rowspan > 1) are flattened on import.
    if ((tag === 'td' || tag === 'th') && (Number(props.colSpan ?? 1) > 1 || Number(props.rowSpan ?? 1) > 1)) {
      // Branch: Cell spans multiple columns or rows; note the loss of merged cells.
      note(IMPORT_LOSS.mergedCells);
    } else {
      // Branch: Cell does not span multiple columns or rows; record no merge loss.
    }

    // Record that tables nested inside a cell cannot be represented in Markdown.
    if (tag === 'table' && inCell) {
      // Branch: Table is nested within another cell; note the loss of the nested table.
      note(IMPORT_LOSS.nestedTable);
    } else {
      // Branch: Node is not a nested table; leave it untouched.
    }

    // Record that block-level content inside a cell is flattened on import.
    if (inCell && CELL_BLOCKS.has(tag)) {
      // Branch: Block element sits inside a table cell; note the loss of in-cell blocks.
      note(IMPORT_LOSS.blockInCell);
    } else {
      // Branch: Node is not an in-cell block; leave it untouched.
    }

    // Check for a table, whose header row Markdown requires.
    if (tag === 'table') {
      promoteHeaderRow(child);
    } else {
      // Not a table: nothing to promote.
    }

    // Recurse into descendants, treating cells as nested for further inspection.
    child.children = inspectChildren(child.children as HastContent[], inCell || tag === 'td' || tag === 'th', note) as Element['children'];

    // Check for formatting Markdown has no mark for; rehype-remark would turn it into emphasis, which the text never had.
    if (UNWRAPPED.has(tag)) {
      // Branch: keep the words and drop the element around them.
      kept.push(...(child.children as HastContent[]));
    } else {
      // Branch: preserve the inspected element in the kept list.
      kept.push(child);
    }
  }

  // Return only the elements that survived inspection.
  return kept;
}

/**
 * Converts an HTML string into Markdown together with a report of what was lost on import.
 *
 * @purpose Parses and converts HTML to canonical Markdown while tallying every dropped construct.
 * @inputs html - Raw HTML source string to convert.
 * @outputs ImportResult - The converted Markdown text and the aggregated loss report.
 * @dataflow HTML string -> whitespace guard -> unified processor (rehypeParse + rehypeRemark) -> hast tree -> inspectChildren tally -> mdast Root -> KdocDocument -> serializeDocument -> ImportResult.
 * @controlflow Guard empty input -> build processor -> parse to hast -> inspect children and record losses -> runSync to mdast -> wrap in KdocDocument -> serialize and attach loss report.
 */
export function importHtml(html: string): ImportResult {
  // Guard empty or whitespace-only HTML input: return an empty result without running the pipeline.
  if (html.trim().length === 0) {
    // Branch: Input is empty or whitespace-only; return an empty Markdown string with no losses.
    return { markdown: '', losses: [] };
  } else {
    // Branch: Input contains non-whitespace HTML markup; proceed with conversion.
  }

  // Build the unified processor. Parsed as a fragment: a whole page gives the same Markdown, since head content is
  // not converted, and a fragment (Word's conversion, the RTF reader's output) needs no page around it.
  // The footnote placeholder left by extractFootnotes becomes a Markdown footnote reference carrying its label.
  const processor = unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypeRemark, {
      handlers: {
        [FOOTNOTE_REFERENCE_TAG]: (_state, element) => {
          const label = String(element.properties.dataLabel);
          return { type: 'footnoteReference', identifier: label, label };
        },
      },
    });

  // Parse the HTML string into a hast tree.
  const tree = processor.parse(html) as HastRoot;

  // Footnotes are taken out before inspection, so the superscript around a reference is not reported as lost.
  const footnotes = extractFootnotes(tree);

  // Accumulate per-label loss counts discovered during inspection.
  const found = new Map<string, number>();

  // Define the note callback that increments the running count for each reported loss label.
  const note = (label: string): void => {
    // Branch: Record one occurrence of this loss label, defaulting to zero when first seen.
    found.set(label, (found.get(label) ?? 0) + 1);
  };

  // Inspect the hast tree's top-level children, dropping unrepresentable nodes and recording losses.
  tree.children = inspectChildren(tree.children, false, note) as HastRoot['children'];

  // Run the unified transformers to convert the inspected hast tree into an mdast Root.
  const root = processor.runSync(tree) as Root;

  // Each footnote body is inspected like the rest of the page, converted on its own, and appended as a definition.
  for (const footnote of footnotes) {
    const body: HastRoot = { type: 'root', children: inspectChildren(footnote.children, false, note) };
    const converted = processor.runSync(body) as Root;
    root.children.push({
      type: 'footnoteDefinition',
      identifier: footnote.label,
      label: footnote.label,
      children: converted.children as Array<BlockContent | DefinitionContent>,
    });
  }

  // Wrap the parsed root in a canonical KdocDocument: HTML input carries no source text or front matter.
  const document: KdocDocument = {
    text: '',
    root,
    frontMatter: null,
  };

  // Serialize to Markdown and attach the aggregated loss report.
  return {
    markdown: serializeDocument(document),
    losses: [...found].map(([label, count]) => ({ label, count })),
  };
}

/**
 * Converts plain text into canonical Markdown with no reported losses.
 *
 * @purpose Normalises plain text into paragraph-only Markdown without any loss report.
 * @inputs text - Raw plain-text source string to convert.
 * @outputs ImportResult - The converted Markdown text and an empty loss report.
 * @dataflow Plain text -> CRLF normalisation -> blank-line split into blocks -> mdast paragraphs -> serializeDocument -> ImportResult.
 * @controlflow Normalise line endings -> split into trimmed paragraph blocks -> build mdast Root -> serialize with no losses.
 */
export function importPlainText(text: string): ImportResult {
  // Normalise line endings to LF so CRLF and CR inputs are handled uniformly.
  const normalised = text.replace(/\r\n?/g, '\n');

  // Split into paragraphs on blank lines, trimming each line (Markdown paragraphs cannot keep indentation) and surrounding newlines from each block.
  const blocks = normalised
    .split(/\n[ \t]*\n/)
    .map((block: string) =>
      block
        .split('\n')
        .map((line: string) => line.trim())
        .join('\n')
        .replace(/^\n+|\n+$/g, ''),
    )
    .filter((block: string) => block.trim() !== '');

  // Build an mdast Root whose paragraphs mirror the trimmed plain-text blocks.
  const root: Root = {
    type: 'root',
    children: blocks.map(
      (value: string) => ({
        type: 'paragraph',
        children: [{ type: 'text', value }],
      }),
    ),
  };

  // Serialize the plain-text document; plain text loses nothing, so report no losses.
  return {
    markdown: serializeDocument({ text: '', root, frontMatter: null }),
    losses: [],
  };
}
