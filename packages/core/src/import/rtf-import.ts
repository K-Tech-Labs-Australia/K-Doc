/**
 * @file rtf-import.ts
 * @purpose Reads RTF tokens, tracks group and paragraph state, drives RtfHtmlWriter,
 *          and records lossy conversions; importRtf converts the resulting HTML via importHtml.
 * @inputs Raw RTF document string.
 * @outputs RtfConversion (html + losses) from rtfToHtml; ImportResult (markdown + merged losses) from importRtf.
 * @functions
 *   - rtfToHtml: Parse an RTF string into an intermediate HTML fragment and record conversion losses.
 *   - importRtf: Convert RTF to Markdown by delegating to rtfToHtml then importHtml, merging both loss sets.
 * @dataflow Raw RTF → tokenizeRtf → per-token dispatch → state machine → RtfHtmlWriter → HTML fragment → importHtml → Markdown.
 * @controlflow Validate prefix → set up state → iterate tokens → dispatch per kind → maintain group/paragraph/format state → emit text and structure → finish writer → merge losses.
 * @version 1
 * @date 2026-09-17
 */

import { importHtml, mergeLosses, IMPORT_LOSS, type ImportLoss, type ImportResult } from './html-import.js';
import { tokenizeRtf } from './rtf-tokens.js';
import { RtfHtmlWriter, type RunFormat } from './rtf-html-writer.js';

export interface RtfConversion {
  readonly html: string;
  readonly losses: readonly ImportLoss[];
}

export const RTF_LOSS = {
  pictures: 'pictures',
  objects: 'embedded objects',
  headersFooters: 'headers and footers',
  footnotes: 'footnotes',
  comments: 'comments',
  nestedLists: 'nested list levels',
} as const;

// Structural groups whose contents are intentionally dropped without a loss record.
const SKIPPED = new Set([
  'fonttbl', 'colortbl', 'info', 'generator', 'xmlnstbl', 'themedata',
  'colorschememapping', 'latentstyles', 'datastore', 'rsidtbl', 'listtable',
  'listoverridetable', 'pgdsctbl', 'nonshppict', 'bkmkstart', 'bkmkend',
  'atnid', 'atnauthor', 'atndate', 'atnref', 'revtbl', 'filetbl', 'userprops',
  'docvar', 'ftnsep', 'ftnsepc', 'aftnsep', 'aftnsepc',
]);

// Group words that are dropped but counted as a specific loss category.
const LOSSY: Readonly<Record<string, string>> = {
  pict: RTF_LOSS.pictures,
  object: RTF_LOSS.objects,
  header: RTF_LOSS.headersFooters,
  headerl: RTF_LOSS.headersFooters,
  headerr: RTF_LOSS.headersFooters,
  headerf: RTF_LOSS.headersFooters,
  footer: RTF_LOSS.headersFooters,
  footerl: RTF_LOSS.headersFooters,
  footerr: RTF_LOSS.headersFooters,
  footerf: RTF_LOSS.headersFooters,
  footnote: RTF_LOSS.footnotes,
  annotation: RTF_LOSS.comments,
};

// Named control words that map to a Unicode replacement glyph.
const SYMBOLS: Readonly<Record<string, string>> = {
  emdash: '—',
  endash: '–',
  bullet: '•',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  emspace: ' ',
  enspace: ' ',
  tab: ' ',
};

// Named underline styles recognized by the character-format switch.
const UNDERLINES = new Set([
  'ul', 'uld', 'uldb', 'ulw', 'uldash', 'ulwave', 'ulth', 'uldashd',
  'uldashdd', 'ulhwave', 'ulldash', 'ulthd', 'ulthdash', 'ulthdashd',
  'ulthdashdd', 'ulthldash', 'ululdbwave',
]);

// Matches a stylesheet name that declares a heading level (e.g. "Heading 1").
const HEADING_STYLE = /^heading\s*([1-6])$/i;

// Extracts a hyperlink target from a field instruction string.
const HYPERLINK = /HYPERLINK\s+"([^"]+)"/i;

// Detects an ordered list marker (number/letter followed by . or )).
const ORDERED_MARKER = /^\s*[0-9a-zA-Z]{1,4}[.)]/;

type Destination = 'body' | 'skip' | 'fldinst' | 'listtext' | 'stylesheet';

interface GroupState {
  dest: Destination;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  sup: boolean;
  sub: boolean;
  link: string | null;
  uc: number;
}

interface ParagraphState {
  style: number;
  list: boolean;
  level: number;
  inTable: boolean;
  alignment: 'center' | 'right' | 'justify' | null;
}

/**
 * Converts a raw RTF document into an HTML fragment, recording what could not be carried.
 *
 * @purpose Convert a raw RTF document into an HTML fragment, recording lossy conversions.
 * @inputs rtf - Raw RTF source text to parse.
 * @outputs RtfConversion - The generated HTML and the list of recorded losses.
 * @dataflow rtf → tokenizeRtf → per-token dispatch → state machine → writer.finish() + losses map.
 * @controlflow Validate prefix → set up state → iterate tokens → return finished conversion.
 */
export function rtfToHtml(rtf: string): RtfConversion {
  if (!rtf.trimStart().startsWith('{' + '\\' + 'rtf')) {
    // Branch: missing the RTF header — reject as invalid input.
    throw new Error('This is not an RTF document.');
  } else {
    // Branch: valid RTF prefix — proceed with parsing.
  }

  const writer = new RtfHtmlWriter();
  let state: GroupState = { dest: 'body', bold: false, italic: false, underline: false, strike: false, sup: false, sub: false, link: null, uc: 1 };
  const stack: GroupState[] = [];
  let groupStart = false;
  let ignorable = false;
  let pendingSkip = 0;
  let para: ParagraphState = { style: 0, list: false, level: 0, inTable: false, alignment: null };
  let ordered: boolean | null = null;
  const losses = new Map<string, number>();
  const headingStyles = new Map<number, number>();
  let styleNumber = 0;
  let styleName = '';
  let fieldInstruction = '';
  let listText = '';

  // @purpose Increment the loss counter for a given label.
  // @inputs label - Loss category key to tally.
  // @outputs void
  // @dataflow label → losses map update.
  // @controlflow Read current count, add one, write back.
  function note(label: string): void {
    losses.set(label, (losses.get(label) ?? 0) + 1);
  }

  // @purpose Build a RunFormat snapshot from the current character state.
  // @inputs void — reads mutable group state via closure.
  // @outputs RunFormat - Current bold/italic/underline/strike/sup/sub/link values.
  // @dataflow state fields → RunFormat object literal.
  // @controlflow no branching; direct field mapping.
  function runFormat(): RunFormat {
    return {
      bold: state.bold,
      italic: state.italic,
      underline: state.underline,
      strike: state.strike,
      sup: state.sup,
      sub: state.sub,
      link: state.link,
    };
  }

  // @purpose Route incoming text to the active destination and emit when in body.
  // @inputs value - Text string routed by the current destination.
  // @outputs void
  // @dataflow value → destination branch → writer.text (body) or accumulator.
  // @controlflow switch on state.dest; body trims pendingSkip then writes.
  function text(value: string): void {
    switch (state.dest) {
      case 'fldinst':
        // Collect field instruction text verbatim for later hyperlink extraction.
        fieldInstruction += value;
        break;
      case 'listtext':
        // Accumulate list marker glyphs to detect ordered vs unordered lists.
        listText += value;
        break;
      case 'skip':
        // Branch: destination is skip — discard text without side effects.
        break;
      case 'stylesheet':
        // Parse style definitions, tracking the current style name and number.
        for (const ch of value) {
          if (ch === ';') {
            // End-of-style-name delimiter — finalize any heading style mapping.
            const m = HEADING_STYLE.exec(styleName.trim());
            if (m !== null && styleNumber >= 0) {
              // Branch: matching heading style with a valid number — record the level.
              headingStyles.set(styleNumber, Number(m[1]));
            } else {
              // Branch: non-heading style or invalid number — do not record.
            }
            styleName = '';
            styleNumber = 0;
          } else {
            // Accumulate characters that form the current style name.
            styleName += ch;
          }
        }
        break;
      case 'body':
        // Body text — honor any pending skip window, then emit to the writer.
        if (pendingSkip > 0) {
          // Trim leading characters consumed by the pending skip count.
          const skipped = Math.min(pendingSkip, value.length);
          pendingSkip -= skipped;
          value = value.slice(skipped);
        } else {
          // Branch: no pending skip — emit the full value unchanged.
        }
        writer.text(value, runFormat());
        break;
    }
  }

  // @purpose Flush the current paragraph's structure to the writer.
  // @inputs void — reads mutable paragraph and ordered state via closure.
  // @outputs void
  // @dataflow para + headingStyles + ordered → writer.endParagraph call.
  // @controlflow Record nesting loss when applicable, compute list kind, emit.
  function endParagraph(): void {
    if (para.list && !para.inTable && para.level > 0) {
      // Branch: list item at a nested level — record the nesting loss.
      note(RTF_LOSS.nestedLists);
    } else {
      // Branch: top-level or non-list paragraph — no nesting loss to record.
    }

    // Check for alignment set on a paragraph outside a table.
    if (para.alignment !== null && !para.inTable) {
      // Branch: body text aligned other than left — Markdown cannot say so.
      note(IMPORT_LOSS.alignment);
    } else {
      // Branch: left-aligned, or a table cell — nothing lost.
    }

    // Choose 'ol' for an ordered marker match, 'ul' otherwise; null when not a list.
    let listKind: 'ol' | 'ul' | null = null;
    // Check whether the paragraph is a list item at all.
    if (para.list) {
      // Check whether its marker text looked like a number or letter.
      if (ordered === true) {
        // Branch: ordered marker detected — emit an ordered list.
        listKind = 'ol';
      } else {
        // Branch: unordered or undetected marker — emit an unordered list.
        listKind = 'ul';
      }
    } else {
      // Branch: an ordinary paragraph — no list.
    }

    writer.endParagraph({
      heading: headingStyles.get(para.style) ?? null,
      list: listKind,
      inTable: para.inTable,
    });
    ordered = null;
  }

  // @purpose Map a group-start word to a known destination; true when handled.
  // @inputs name - The control-word name of the opening group.
  // @outputs boolean - True if name was consumed as a destination, false otherwise.
  // @dataflow name → destination lookup → state.dest update (side effect).
  // @controlflow Sequential if/else-if chain; first match wins, else return false.
  function destination(name: string): boolean {
    if (name === 'shppict') {
      // Branch: Word's wrapper around a picture — pass through so the \pict inside is reported, not skipped as unknown.
      return true;
    } else if (name === 'stylesheet') {
      // Branch: stylesheet group — route subsequent tokens to style parsing.
      state.dest = 'stylesheet';
      return true;
    } else if (name === 'fldinst') {
      // Branch: field instruction group — reset and capture the raw instruction.
      state.dest = 'fldinst';
      fieldInstruction = '';
      return true;
    } else if (name === 'fldrslt') {
      // Branch: field result group — resolve any hyperlink from the instruction.
      const m = HYPERLINK.exec(fieldInstruction);
      if (state.dest === 'fldinst') {
        // Branch: still inside a field instruction — return to body text.
        state.dest = 'body';
      } else {
        // Branch: not in a field instruction — leave destination unchanged.
      }
      if (m !== null) {
        // Branch: hyperlink found — store the target URL (text in a skipped group is dropped whatever its link).
        state.link = m[1] ?? null;
      } else {
        // Branch: no hyperlink — leave link unchanged.
      }
      return true;
    } else if (name === 'listtext' || name === 'pntext') {
      // Branch: list-text group — accumulate marker glyphs for ordered detection.
      state.dest = 'listtext';
      listText = '';
      return true;
    } else if (Object.hasOwn(LOSSY, name)) {
      // Branch: lossy construct encountered — record the loss once per group.
      if (state.dest !== 'skip') {
        // Branch: not already skipping — record and enter skip mode.
        note(LOSSY[name] ?? name);
        state.dest = 'skip';
      } else {
        // Branch: already skipping — avoid double-counting the loss.
      }
      return true;
    } else if (SKIPPED.has(name)) {
      // Branch: ignorable structural group — skip its contents silently.
      state.dest = 'skip';
      return true;
    } else {
      // Branch: unknown group name — not a destination, fall through to word handling.
      return false;
    }
  }

  // @purpose Apply a control word to the current group/paragraph/format state.
  // @inputs name - Control-word name; param - Numeric parameter or null.
  // @outputs void
  // @dataflow name/param → state mutation, text emission, or writer calls.
  // @controlflow Consume start/ignorable flags, handle stylesheet/u early, else switch on name.
  function word(name: string, param: number | null): void {
    const wasStart = groupStart;
    const wasIgnorable = ignorable;
    groupStart = false;
    ignorable = false;

    if (wasStart && destination(name)) {
      // Branch: group-start word resolved to a destination — handled there.
      return;
    } else if (wasStart && wasIgnorable) {
      // Branch: ignorable group-start word — skip its contents.
      state.dest = 'skip';
      return;
    } else {
      // Branch: normal control word or non-start word — continue processing below.
    }

    if (state.dest === 'stylesheet') {
      // Branch: inside the stylesheet — track style numbers only.
      if (name === 's') {
        // Branch: paragraph style declaration — record the current style number.
        styleNumber = param ?? 0;
      } else {
        // Branch: other stylesheet token — ignore for heading detection.
      }
      return;
    } else {
      // Branch: not inside the stylesheet — handle the word as document content.
    }

    // Check for a Unicode character escape, which applies in every destination.
    if (name === 'u') {
      // Branch: Unicode character — emit it, then skip the fallback characters that follow it in body text.
      // RTF writes code points above 32767 as negative numbers; fromCharCode takes its argument modulo 65536, which
      // turns them back into the character they stand for.
      text(String.fromCharCode(param ?? 0));
      if (state.dest === 'body') {
        // Branch: in body — consume the glyph via pending skip.
        pendingSkip = state.uc;
      } else {
        // Branch: not in body — leave pending skip untouched.
      }
      return;
    } else {
      // Branch: any other control word.
    }

    if (state.dest === 'body') {
      // Branch: in body — process formatting words via the switch below.
    } else {
      // Branch: outside body text — ignore formatting words until back in body.
      return;
    }

    switch (name) {
      case 'par':
      case 'sect':
      case 'page':
        // Paragraph/section/page break — flush the current paragraph.
        endParagraph();
        break;
      case 'line':
        // Soft line break within a paragraph.
        writer.lineBreak();
        break;
      case 'pard':
        // Reset paragraph defaults after a section break.
        para = { style: 0, list: false, level: 0, inTable: false, alignment: null };
        break;
      case 'plain':
        // Clear all character formatting for the current run.
        state.bold = false;
        state.italic = false;
        state.underline = false;
        state.strike = false;
        state.sup = false;
        state.sub = false;
        break;
      case 'b':
        // Branch: bold toggle — param 0 disables, any other value enables.
        state.bold = param !== 0;
        break;
      case 'i':
        // Branch: italic toggle — param 0 disables, any other value enables.
        state.italic = param !== 0;
        break;
      case 'strike':
      case 'striked':
        // Branch: strikethrough toggle — param 0 disables, any other value enables.
        state.strike = param !== 0;
        break;
      case 'ulnone':
        // Disable underline.
        state.underline = false;
        break;
      case 'super':
        // Branch: superscript on — clear subscript.
        state.sup = true;
        state.sub = false;
        break;
      case 'sub':
        // Branch: subscript on — clear superscript.
        state.sub = true;
        state.sup = false;
        break;
      case 'nosupersub':
        // Clear both superscript and subscript.
        state.sup = false;
        state.sub = false;
        break;
      case 'cf':
        // Branch: color index — any explicit color is a styling loss.
        if ((param ?? 0) > 0) {
          note(IMPORT_LOSS.styling);
        } else {
          // Branch: no color change — nothing to record.
        }
        break;
      case 'highlight':
      case 'cb':
      case 'chcbpat':
        // Branch: highlight/background index — any explicit value is a loss.
        if ((param ?? 0) > 0) {
          note(IMPORT_LOSS.highlight);
        } else {
          // Branch: no highlight change — nothing to record.
        }
        break;
      case 'qc':
        // Centred — remembered; reported when a paragraph outside a table ends, kept as a table column's alignment.
        para.alignment = 'center';
        break;
      case 'qr':
        // Right-aligned — handled like centred.
        para.alignment = 'right';
        break;
      case 'qj':
      case 'qd':
        // Justified — reported outside a table; a table column has no justified alignment, so a cell reads as left.
        para.alignment = 'justify';
        break;
      case 's':
        // Branch: style number for the paragraph.
        para.style = param ?? 0;
        break;
      case 'ls':
        // Branch: list level specifier — mark this as a list paragraph.
        para.list = true;
        break;
      case 'ilvl':
        // Branch: nested list level for the current paragraph.
        para.level = param ?? 0;
        break;
      case 'intbl':
        // Branch: table cell marker — mark that we are inside a table.
        para.inTable = true;
        break;
      case 'cell':
      case 'nestcell':
        // End the current table cell, passing on the alignment a Markdown column can keep.
        writer.endCell(para.alignment === 'justify' ? null : para.alignment);
        break;
      case 'row':
      case 'nestrow':
        // End the current table row.
        writer.endRow();
        break;
      case 'uc':
        // Branch: number of fallback characters that follow each Unicode escape.
        state.uc = param ?? 1;
        break;
      default:
        if (UNDERLINES.has(name)) {
          // Branch: named underline style — apply based on parameter.
          state.underline = param !== 0;
        } else if (Object.hasOwn(SYMBOLS, name)) {
          // Branch: named symbol — emit its Unicode replacement glyph.
          text(SYMBOLS[name] ?? '');
        } else {
          // Branch: unrecognized word — ignore silently.
        }
        break;
    }
  }

  for (const token of tokenizeRtf(rtf)) {
    switch (token.kind) {
      case 'open':
        // Enter a new group — snapshot state and mark the next word as a start.
        stack.push({ ...state });
        groupStart = true;
        ignorable = false;
        break;
      case 'close': {
        // Exit a group — finalize list detection, restore prior state.
        if (state.dest === 'listtext') {
          // Branch: closing a list-text group — detect ordered markers.
          ordered = ORDERED_MARKER.test(listText);
        } else {
          // Branch: not a list-text group — leave ordered unchanged.
        }
        const restored = stack.pop();
        if (restored !== undefined) {
          // Branch: had a saved state — restore it.
          state = restored;
        } else {
          // Branch: empty stack — drop the stray close, keep current state.
        }
        groupStart = false;
        ignorable = false;
        break;
      }
      case 'ignorable':
        // Mark that the next word is an ignorable control word.
        ignorable = true;
        break;
      case 'word':
        // Dispatch a control word to the state machine.
        word(token.name, token.param);
        break;
      case 'text':
        // Text token — skip it if it arrived during an ignorable group-start.
        if (groupStart && ignorable) {
          state.dest = 'skip';
        } else {
          // Branch: normal text outside an ignorable start — process as usual.
        }
        groupStart = false;
        ignorable = false;
        text(token.text);
        break;
    }
  }

  return {
    html: writer.finish(),
    losses: [...losses].map(([label, count]) => ({ label, count })),
  };
}

/**
 * Converts a raw RTF document to Markdown.
 *
 * @purpose Convert a raw RTF document to Markdown, merging conversion and import losses.
 * @inputs rtf - Raw RTF source text to parse.
 * @outputs ImportResult - The generated Markdown and combined loss counts.
 * @dataflow rtf → rtfToHtml → HTML fragment → importHtml → markdown + merged losses.
 * @controlflow Convert to HTML, delegate to importHtml, merge both loss sets.
 */
export function importRtf(rtf: string): ImportResult {
  const conversion = rtfToHtml(rtf);
  const result = importHtml(conversion.html);
  return {
    markdown: result.markdown,
    losses: mergeLosses(conversion.losses, result.losses),
  };
}
