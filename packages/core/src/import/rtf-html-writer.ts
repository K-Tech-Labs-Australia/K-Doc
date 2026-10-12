/**
 * @file rtf-html-writer.ts
 * @purpose Collects RTF text runs, paragraphs, list items and table cells into simple HTML.
 *   Why this exists:
 *   The RTF importer decodes its source into a stream of formatting events (runs carrying inline styles) plus block-level markers for paragraphs, lists and tables. Callers need a concrete serialisation of that event stream into HTML so the rest of the import pipeline can treat RTF output like any other HTML source. This module knows nothing about RTF syntax itself; it only consumes the already-decoded run/paragraph/list/table events and emits well-formed HTML.
 *   Known limitation:
 *   The emitted HTML is intentionally minimal — formatting collapses to a fixed set of semantic tags (<strong>, <em>, <u>, <s>, <sub>, <sup>, <a>) and tables use the first row as header cells, so richer RTF styling (colours, fonts, cell merging) is not represented.
 * @inputs A stream of run text with RunFormat metadata, line breaks, paragraph terminators with ParagraphFormat markers, list-item terminators, table cell/row terminators.
 * @outputs HTML string produced by finish() containing paragraphs, headings, lists and tables in the order events were received.
 * @functions
 *   - escapeHtml: Escapes a raw text string for safe inclusion in HTML.
 *   - formatKey: Serialises a RunFormat into a stable comparison key (module-private).
 *   - wrapRun: Wraps escaped run text in the inline HTML tags implied by its RunFormat (module-private).
 *   - RtfHtmlWriter.text: Buffers a formatted text run, flushing the previous run when the format changes.
 *   - RtfHtmlWriter.lineBreak: Appends a <br> to the current paragraph.
 *   - RtfHtmlWriter.endParagraph: Finalises the current paragraph as a heading, list item or plain paragraph (or cell content).
 *   - RtfHtmlWriter.endCell: Finalises the current table cell into the current row.
 *   - RtfHtmlWriter.endRow: Finalises the current table row into the table buffer.
 *   - RtfHtmlWriter.finish: Flushes all pending state and returns the accumulated HTML.
 * @dataflow Run text + format -> flushRun buffers into paragraph -> endParagraph/endCell emit block markup -> closeTable/closeList append terminators -> finish returns out.
 * @controlflow Buffer runs until format changes or a block boundary arrives -> on block boundary flush the run then emit the appropriate tag -> finish flushes remaining state, closes tables and lists, returns HTML.
 * @version 1
 * @date 2026-09-17
 */

/**
 * Inline formatting applied to a single text run within an RTF document.
 */
export interface RunFormat {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strike: boolean;
  readonly sup: boolean;
  readonly sub: boolean;
  readonly link: string | null;
}

/**
 * Block-level formatting applied to a paragraph, list item or table cell.
 */
export interface ParagraphFormat {
  /** Heading level (1-6) when the paragraph is a heading, otherwise null. */
  readonly heading: number | null;
  /** Ordered ('ol') or unordered ('ul') list this item belongs to, otherwise null. */
  readonly list: 'ol' | 'ul' | null;
  /** Whether the paragraph sits inside a table cell (affects output routing). */
  readonly inTable: boolean;
}

/** Horizontal alignment a table column can keep in Markdown. */
export type CellAlignment = 'center' | 'right' | null;

/** One finished table cell: its markup and its alignment. */
interface TableCell {
  readonly html: string;
  readonly align: CellAlignment;
}

/**
 * Escapes a raw text string for safe inclusion in HTML.
 *
 * @purpose Replaces the five characters that are unsafe in HTML text and attribute contexts.
 * @inputs text - Raw text to escape.
 * @outputs string - The escaped text, safe to embed directly in HTML.
 * @dataflow Raw text -> sequential character replacement -> escaped string.
 * @controlflow Apply ampersand first (to avoid double-escaping), then less-than, greater-than and quote replacements in order.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Serialises a RunFormat into a stable comparison key.
 *
 * @purpose Produces a string that is equal for two formats if and only if every field matches, enabling cheap run-format comparisons.
 * @inputs f - The RunFormat to serialise.
 * @outputs string - A pipe-joined key of each boolean field followed by the link value (or empty string when null).
 * @dataflow Each format field -> array element -> joined with '|' separators.
 * @controlflow Map booleans and the nullable link into an ordered array then join; no branching required.
 */
function formatKey(f: RunFormat): string {
  return [f.bold, f.italic, f.underline, f.strike, f.sup, f.sub, f.link ?? ''].join('|');
}

/**
 * Wraps escaped run text in the inline HTML tags implied by its RunFormat.
 *
 * @purpose Applies the nested inline markup for each enabled style attribute to run text, escaping it first.
 * @inputs text - Raw run text; escaped here.
 * @inputs f - The RunFormat describing which inline styles to apply.
 * @outputs string - The escaped text wrapped in the appropriate sequence of inline tags.
 * @dataflow Raw text -> escapeHtml -> nested tag wrapping (sub, sup, u, s, em, strong, a) -> wrapped HTML.
 * @controlflow Wrap innermost first and outermost last so tags nest correctly; each style adds one layer only when enabled.
 */
function wrapRun(text: string, f: RunFormat): string {
  // Escaped first: RTF text is words, and a "<" in it must not become markup in the HTML step.
  let html = escapeHtml(text);

  if (f.sub) {
    // Branch: Text is subscript; wrap in <sub> as the innermost layer.
    html = `<sub>${html}</sub>`;
  } else {
    // Branch: Text is not subscript; leave it unwrapped for this style.
  }

  if (f.sup) {
    // Branch: Text is superscript; wrap in <sup>.
    html = `<sup>${html}</sup>`;
  } else {
    // Branch: Text is not superscript; leave it unwrapped for this style.
  }

  if (f.underline) {
    // Branch: Text is underlined; wrap in <u>.
    html = `<u>${html}</u>`;
  } else {
    // Branch: Text is not underlined; leave it unwrapped for this style.
  }

  if (f.strike) {
    // Branch: Text is struck through; wrap in <s>.
    html = `<s>${html}</s>`;
  } else {
    // Branch: Text is not struck through; leave it unwrapped for this style.
  }

  if (f.italic) {
    // Branch: Text is italic; wrap in <em>.
    html = `<em>${html}</em>`;
  } else {
    // Branch: Text is not italic; leave it unwrapped for this style.
  }

  if (f.bold) {
    // Branch: Text is bold; wrap in <strong> as the outermost text-style layer.
    html = `<strong>${html}</strong>`;
  } else {
    // Branch: Text is not bold; leave it unwrapped for this style.
  }

  if (f.link !== null) {
    // Branch: Text carries a hyperlink; wrap in an <a> element using the escaped link target.
    html = `<a href="${escapeHtml(f.link)}">${html}</a>`;
  } else {
    // Branch: Text has no hyperlink; leave it unwrapped for this style.
  }

  return html;
}

/**
 * Collects RTF text runs, paragraphs, list items and table cells into simple HTML.
 *
 * @purpose Buffers decoded RTF events and serialises them into well-formed HTML paragraphs, headings, lists and tables.
 * @inputs Runs of text with RunFormat via text(), line breaks via lineBreak(), block terminators via endParagraph(), cell/row terminators via endCell() and endRow().
 * @outputs HTML string returned by finish() containing all emitted blocks in event order.
 * @functions
 *   - text: Buffers a formatted run, flushing the previous run when its format changes.
 *   - lineBreak: Appends a <br> to the current paragraph.
 *   - endParagraph: Finalises the current paragraph as heading, list item or plain paragraph (or cell content).
 *   - endCell: Finalises the current table cell into the current row.
 *   - endRow: Finalises the current table row into the table buffer.
 *   - finish: Flushes pending state and returns the accumulated HTML.
 * @dataflow Run text -> flushRun buffers into paragraph -> endParagraph/endCell emit block markup -> closeTable/closeList append terminators -> finish returns out.
 * @controlflow Buffer runs until format changes or a block boundary arrives -> on block boundary flush the run then emit the appropriate tag -> finish flushes remaining state, closes tables and lists, returns HTML.
 */
export class RtfHtmlWriter {
  private out = '';
  private paragraph = '';
  private runText = '';
  private runFormat: RunFormat | null = null;
  private listOpen: 'ol' | 'ul' | null = null;
  private rows: TableCell[][] = [];
  private row: TableCell[] = [];
  private cellParts: string[] = [];

  /**
   * Buffers a formatted text run, flushing the previous run when its format changes.
   *
   * @purpose Accumulates consecutive runs that share identical formatting into one buffered run so wrapRun is applied once per contiguous style.
   * @inputs text - The run text to buffer.
   * @inputs format - The RunFormat of this run; a change from the buffered run triggers a flush.
   * @outputs void - State is mutated in place (runText and possibly runFormat).
   * @dataflow Incoming text -> appended to runText when format matches, or flushed then re-buffered on format change.
   * @controlflow Skip empty input; compare the new format key with the buffered one via formatKey; flush and reset when they differ.
   */
  public text(text: string, format: RunFormat): void {
    if (text === '') {
      // Branch: Input run is empty; skip buffering to avoid emitting empty content.
      return;
    } else {
      // Branch: Input run carries text; proceed to buffer it.
    }

    if (this.runFormat === null || formatKey(this.runFormat) !== formatKey(format)) {
      // Branch: No buffered run yet or the format changed; flush the previous run before starting a new one.
      this.flushRun();
      this.runFormat = format;
    } else {
      // Branch: The buffered run already carries this format; keep appending to it without flushing.
    }

    this.runText += text;
  }

  /**
   * Appends a <br> to the current paragraph.
   *
   * @purpose Records an inline line break within the running paragraph buffer.
   * @inputs void - No parameters.
   * @outputs void - State is mutated in place (paragraph).
   * @dataflow Line-break event -> flushRun then append <br> to paragraph.
   * @controlflow Flush any pending run so its text precedes the break, then append the break tag.
   */
  public lineBreak(): void {
    this.flushRun();
    this.paragraph += '<br>';
  }

  /**
   * Finalises the current paragraph as a heading, list item or plain paragraph (or cell content).
   *
   * @purpose Emits the buffered paragraph markup into the output, routing through table-cell, list and block handling.
   * @inputs format - The ParagraphFormat describing how to emit the paragraph.
   * @outputs void - State is mutated in place (paragraph, out, listOpen).
   * @dataflow Buffered paragraph -> flushRun -> routed by inTable/list/heading into cellParts or out.
   * @controlflow Flush run; if in a table push cell content and return; otherwise close any open table, then route through list handling, else emit heading or paragraph.
   */
  public endParagraph(format: ParagraphFormat): void {
    this.flushRun();

    const content = this.paragraph;
    this.paragraph = '';

    if (format.inTable) {
      // Branch: Paragraph is a table cell; store its content for the current row and return early.
      if (content.trim() !== '') {
        // Branch: Cell content is non-empty; append it to the cell parts buffer.
        this.cellParts.push(content);
      } else {
        // Branch: Cell content is empty; skip appending so trailing whitespace does not create phantom cells.
      }
      return;
    } else {
      // Branch: Paragraph is not in a table; fall through to block-level handling below.
    }

    this.closeTable();

    if (format.list !== null) {
      // Branch: Paragraph belongs to a list item; manage the open list then emit an <li>.
      if (this.listOpen !== format.list) {
        // Branch: The currently open list differs from the requested one; close it and open the new list.
        this.closeList();
        this.out += `<${format.list}>`;
        this.listOpen = format.list;
      } else {
        // Branch: The requested list is already open; leave the list tag untouched.
      }
      this.out += `<li>${content}</li>`;
      return;
    } else {
      // Branch: Paragraph is not a list item; close any open list and emit a block element below.
    }

    this.closeList();

    if (content.trim() === '') {
      // Branch: Paragraph content is empty; drop it to avoid emitting blank blocks.
      return;
    } else {
      // Branch: Paragraph content is non-empty; emit the appropriate block element.
    }

    if (format.heading !== null) {
      // Branch: Paragraph is a heading; wrap content in an <hN> element using its level.
      this.out += `<h${format.heading}>${content}</h${format.heading}>`;
    } else {
      // Branch: Paragraph is not a heading; emit it as a plain paragraph.
      this.out += `<p>${content}</p>`;
    }
  }

  /**
   * Finalises the current table cell into the current row.
   *
   * @purpose Flushes any buffered paragraph and appends the assembled cell markup to the running row.
   * @inputs align - The cell's alignment, which becomes its column's; null for left.
   * @outputs void - State is mutated in place (cellParts, row).
   * @dataflow Buffered paragraph -> flushRun -> joined cell parts appended to row.
   * @controlflow Flush run; if a trailing paragraph exists push it as the final cell part, then join all cell parts with <br> and append to the row.
   */
  public endCell(align: CellAlignment = null): void {
    this.flushRun();

    if (this.paragraph.trim() !== '') {
      // Branch: A trailing paragraph remains; treat it as the last cell content.
      this.cellParts.push(this.paragraph);
    } else {
      // Branch: No trailing paragraph; nothing extra to append for this cell.
    }

    this.paragraph = '';
    this.row.push({ html: this.cellParts.join('<br>'), align });
    this.cellParts = [];
  }

  /**
   * Finalises the current table row into the table buffer.
   *
   * @purpose Pushes any remaining cell parts as a final cell, then commits the completed row to the rows buffer.
   * @inputs void - No parameters.
   * @outputs void - State is mutated in place (row, rows).
   * @dataflow Partial row -> flush remaining cell part -> committed row appended to rows.
   * @controlflow If cell parts remain push them as a final cell; if the row has cells commit it to rows and reset.
   */
  public endRow(): void {
    if (this.cellParts.length > 0) {
      // Branch: Cell parts remain uncommitted; append them as the final cell of the row.
      this.row.push({ html: this.cellParts.join('<br>'), align: null });
      this.cellParts = [];
    } else {
      // Branch: No remaining cell parts; leave the row as-is.
    }

    if (this.row.length > 0) {
      // Branch: The row contains at least one cell; commit it to the rows buffer and reset.
      this.rows.push(this.row);
      this.row = [];
    } else {
      // Branch: The row is empty; skip committing an empty row.
    }
  }

  /**
   * Flushes all pending state and returns the accumulated HTML.
   *
   * @purpose Emits any trailing paragraph, closes open tables and lists, and returns the final HTML document.
   * @inputs void - No parameters.
   * @outputs string - The complete HTML produced from all received events.
   * @dataflow Pending run/paragraph -> flushRun -> endParagraph for trailing content -> closeTable/closeList -> out returned.
   * @controlflow Flush the final run; emit a trailing paragraph if any remains; close tables and lists; return the accumulated output.
   */
  public finish(): string {
    this.flushRun();

    if (this.paragraph.trim() !== '') {
      // Branch: A trailing paragraph remains; finalise it as a plain block-level paragraph.
      this.endParagraph({ heading: null, list: null, inTable: false });
    } else {
      // Branch: No trailing paragraph; nothing further to emit before closing tables and lists.
    }

    this.closeTable();
    this.closeList();

    return this.out;
  }

  /**
   * Flushes the buffered text run into the current paragraph.
   *
   * @purpose Applies wrapRun to any accumulated run text and appends it to the running paragraph buffer.
   * @inputs void - No parameters.
   * @outputs void - State is mutated in place (paragraph, runText, runFormat).
   * @dataflow Buffered runText + runFormat -> wrapRun -> appended to paragraph; buffers cleared.
   * @controlflow Return early when there is no buffered run; otherwise wrap and append then clear the buffers.
   */
  private flushRun(): void {
    if (this.runText !== '' && this.runFormat !== null) {
      // Branch: A formatted run is buffered; wrap it and append to the paragraph.
      this.paragraph += wrapRun(this.runText, this.runFormat);
    } else {
      // Branch: No buffered run; skip wrapping.
    }

    this.runText = '';
    this.runFormat = null;
  }

  /**
   * Closes the currently open list element.
   *
   * @purpose Appends the closing tag for the open ordered or unordered list and clears the open-list marker.
   * @inputs void - No parameters.
   * @outputs void - State is mutated in place (out, listOpen).
   * @dataflow Open list type -> </tag> appended to out; listOpen cleared.
   * @controlflow Return early when no list is open; otherwise append the closing tag and reset the marker.
   */
  private closeList(): void {
    if (this.listOpen !== null) {
      // Branch: A list is open; append its closing tag.
      this.out += `</${this.listOpen}>`;
      this.listOpen = null;
    } else {
      // Branch: No list is open; skip the closing tag.
    }
  }

  /**
   * Closes the currently open table by committing any pending row and emitting the <table> markup.
   *
   * @purpose Finalises all buffered rows into a single <table> element with the first row as header cells, then clears the buffer.
   * @inputs void - No parameters.
   * @outputs void - State is mutated in place (out, rows, row).
   * @dataflow Buffered rows -> endRow flushes final cell -> each row rendered as <tr> with <th>/<td> -> appended to out; buffers cleared.
   * @controlflow Flush the pending row via endRow; return early when no rows exist; otherwise map rows to tr/cell markup and append.
   */
  private closeTable(): void {
    this.endRow();

    if (this.rows.length === 0) {
      // Branch: No rows have been buffered; skip emitting a table element.
      return;
    } else {
      // Branch: At least one row exists; render the table below.
    }

    // A table is never part of a list: a list still open would otherwise wrap the table inside its last item.
    this.closeList();

    this.out += '<table>' + this.rows.map((cells, index) => '<tr>' + cells.map((cell) => {
      const tag = index === 0 ? 'th' : 'td';
      // An aligned cell says so; the HTML step turns that into its column's alignment.
      const attribute = cell.align === null ? '' : ` align="${cell.align}"`;
      return `<${tag}${attribute}>${cell.html}</${tag}>`;
    }).join('') + '</tr>').join('') + '</table>';
    this.rows = [];
  }
}
