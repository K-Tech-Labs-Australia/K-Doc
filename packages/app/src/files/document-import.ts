/**
 * @file document-import.ts
 * @purpose Selects a format-specific converter for an imported file based on its extension and produces canonical Markdown together with a report of every construct that could not be carried across the conversion (FR-13.5).
 *   Why this exists:
 *   Files arrive in several binary and text formats (Word, HTML, rich text, plain text) but K-Doc stores only Markdown. Each format needs a different decoder and converter, and each loses information on the way to Markdown; this module centralises that dispatch so callers learn exactly what was dropped rather than discovering the gap on the next save.
 *   Known limitation:
 *   Encodings come only from what a file announces (a byte order mark, or a web page's charset declaration) followed by a strict UTF-8 attempt — K-Doc deliberately does not guess at encodings it cannot identify, and RTF decoding assumes 7-bit Latin-1 because its escape sequences carry every other character.
 * @inputs A file name (used only for extension-based dispatch) and the raw bytes of the file.
 * @outputs ImportFormat for a recognised extension; decoded text; converted HTML with losses; or an ImportResult carrying Markdown and an aggregated loss report.
 * @functions
 *   - importFormatOf: Maps a file name to its ImportFormat by lower-casing the extension, returning null when unrecognised.
 *   - decodeHtml: Decodes a web page in the character set its meta tag declares, falling back to decodeText.
 *   - decodeText: Honours a UTF-16 byte order mark and otherwise decodes bytes as strict UTF-8 text (with or without its mark).
 *   - docxToHtml: Converts Word .docx bytes to HTML via mammoth with an explicit style map, reporting every loss.
 *   - importDocument: Dispatches on the detected format to the matching converter and merges per-format losses.
 * @dataflow File name + bytes -> importFormatOf dispatch -> format decoder (decodeText/docxToHtml/importRtf) -> HTML/Markdown importer -> mergeLosses aggregation -> ImportResult.
 * @controlflow Resolve extension -> switch on format -> throw for unknown, decode for text formats, convert docx to HTML then import it; merge losses from each stage before returning.
 * @version 1
 * @date 2026-09-17
 */

import mammoth from 'mammoth';
import { importHtml, importPlainText, importRtf, mergeLosses, type ImportLoss, type ImportResult } from '@k-doc/core';

/**
 * The import formats K-Doc accepts, keyed by the extension-based dispatch in importFormatOf.
 */
export type ImportFormat = 'docx' | 'html' | 'rtf' | 'text';

/**
 * Every file extension that importDocument recognises, mirroring the cases handled in importFormatOf.
 */
export const IMPORT_EXTENSIONS: readonly string[] = ['docx', 'html', 'htm', 'rtf', 'txt'];

/**
 * Lists what an import leaves behind, for the pre-import report.
 *
 * @purpose Turns the loss list into one readable phrase.
 * @inputs losses - What could not be represented, with how often each occurred.
 * @outputs string - Each label, with its count in brackets when it happened more than once, joined by semicolons.
 * @dataflow losses -> "label" or "label (count)" -> joined.
 * @controlflow One pass over the list.
 */
export function describeLosses(losses: readonly ImportLoss[]): string {
  return losses
    .map((loss) => {
      // A count of one is implied by the label itself.
      if (loss.count > 1) {
        return `${loss.label} (${loss.count})`;
      } else {
        return loss.label;
      }
    })
    .join('; ');
}

// A <meta charset="..."> or <meta http-equiv="Content-Type" content="...; charset=..."> declaration; group 1 is the label.
const CHARSET_DECLARATION = /<meta[^>]*charset\s*=\s*["']?([\w.:-]+)/i;

// HTML requires the declaration within the first 1024 bytes, which are ASCII whatever the character set.
const CHARSET_SCAN_BYTES = 1024;

/**
 * Decodes a web page in the character set it declares, or as text when it declares none.
 *
 * @purpose Reads pages written in a legacy character set, such as Word's filtered HTML in windows-1252, without
 *   guessing: the page itself names the encoding.
 * @inputs bytes - The raw page.
 * @outputs string - The page's text.
 * @dataflow first 1024 bytes as latin1 -> charset declaration -> TextDecoder for that label -> text; no declaration -> decodeText.
 * @controlflow A declared, supported charset is used and an unsupported one refused by name; a page declaring none, UTF-16
 *   pages included, goes to decodeText.
 */
export function decodeHtml(bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, CHARSET_SCAN_BYTES));
  const declared = CHARSET_DECLARATION.exec(head)?.[1];
  // Check for no declaration. A UTF-16 page lands here too: every other byte of it is zero, so no declaration can be
  // read from it as ASCII, and decodeText reads it by its byte order mark.
  if (declared === undefined) {
    return decodeText(bytes);
  } else {
    // The page names its character set: use it.
  }
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(declared);
  } catch (error: unknown) {
    // Check whether the label is one the platform does not know.
    if (error instanceof RangeError) {
      throw new Error(`The page says it is written in ${declared}, which K-Doc cannot read.`);
    } else {
      throw error;
    }
  }
  return decoder.decode(bytes);
}

// Word formatting Markdown has no mark for is mapped to HTML elements the HTML importer reports; mammoth ignores underlining unless told.
const DOCX_STYLE_MAP: readonly string[] = ['u => u', 'highlight => mark'];

/**
 * Maps a file name to its ImportFormat by inspecting the lower-cased extension, returning null when no supported format matches.
 *
 * @purpose Selects the import format for a file purely from its extension so callers can dispatch to the right converter.
 * @inputs fileName - The imported file's name; only the substring after the final dot is used.
 * @outputs ImportFormat | null - The matching format, or null when the extension is unrecognised.
 * @dataflow File name -> lastIndexOf('.') -> lower-cased extension -> switch dispatch -> ImportFormat literal or null.
 * @controlflow Locate the final dot; derive the extension (empty when absent); match against docx/html/htm/rtf/txt/text and return the first hit, else null.
 */
export function importFormatOf(fileName: string): ImportFormat | null {
  // Locate the final dot that separates the extension from the file name; -1 means no extension is present.
  const dot = fileName.lastIndexOf('.');

  // Build the lower-cased extension, defaulting to an empty string when no dot is present so it matches nothing below.
  const extension = dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();

  // Dispatch on the detected extension to its matching ImportFormat.
  switch (extension) {
    case 'docx':
      // Branch: Word document; map to the docx format.
      return 'docx';
    case 'html':
    case 'htm':
      // Branch: Web page in either .html or legacy .htm spelling; map to the html format.
      return 'html';
    case 'rtf':
      // Branch: Rich text file; map to the rtf format.
      return 'rtf';
    case 'txt':
    case 'text':
      // Branch: Plain text in either .txt or legacy .text spelling; map to the text format.
      return 'text';
    default:
      // Branch: Unrecognised extension; report that no supported format matches this file.
      return null;
  }
}

/**
 * Honours a UTF-16 byte order mark and otherwise decodes bytes as strict UTF-8 text, refusing to guess at unknown encodings.
 *
 * @purpose Turns raw file bytes into a string by honouring BOMs and rejecting invalid UTF-8 rather than silently corrupting the content.
 * @inputs bytes - The raw file bytes; the leading bytes are inspected for a byte order mark before decoding.
 * @outputs string - The decoded text with any detected BOM stripped.
 * @dataflow Bytes -> BOM sniff (UTF-8/UTF-16LE/UTF-16BE) -> matching TextDecoder, else strict UTF-8 decode -> string.
 * @controlflow Check for each UTF-16 mark in turn and return on the first match; otherwise attempt a fatal UTF-8 decode and throw on failure.
 */
export function decodeText(bytes: Uint8Array): string {
  // A little-endian UTF-16 byte order mark (FF FE) precedes UTF-16LE text; strip it before decoding.
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    // Branch: Input carries a UTF-16LE BOM; skip the two BOM bytes and decode as little-endian UTF-16.
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  } else {
    // Branch: No UTF-16LE BOM present; fall through to the next sniffing check.
  }

  // A big-endian UTF-16 byte order mark (FE FF) precedes UTF-16BE text; strip it before decoding.
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    // Branch: Input carries a UTF-16BE BOM; skip the two BOM bytes and decode as big-endian UTF-16.
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  } else {
    // Branch: No UTF-16BE BOM present; fall through to the strict UTF-8 attempt.
  }

  // No UTF-16 mark: attempt a strict UTF-8 decode that rejects invalid byte sequences rather than substituting them.
  // A UTF-8 byte order mark needs no branch of its own, because TextDecoder removes it.
  try {
    // Branch (success): Bytes form valid UTF-8; return the decoded string.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error: unknown) {
    // The decode failed because the bytes are not valid UTF-8.
    if (error instanceof TypeError) {
      // Branch: Failure is a malformed-encoding TypeError; refuse to guess and report the unsupported encoding.
      throw new Error('The file is not UTF-8 text, and K-Doc does not guess at encodings.');
    } else {
      // Branch: A different error type surfaced; rethrow it unchanged so no exception is swallowed.
      throw error;
    }
  }
}

/**
 * Converts Word .docx bytes to HTML via mammoth, applying an explicit style map so unrepresentable formatting surfaces as import losses.
 *
 * @purpose Bridges the binary docx format into the same HTML importer used for web pages while preserving every conversion loss.
 * @inputs bytes - The raw .docx file bytes; copied into a dedicated buffer before being handed to mammoth.
 * @outputs Promise<{ html: string; losses: ImportLoss[] }> - The converted HTML and its aggregated loss report.
 * @dataflow Docx bytes -> ArrayBuffer view -> mammoth.convertToHtml with DOCX_STYLE_MAP -> result.value + mapped messages -> merged losses.
 * @controlflow Copy the buffer, build the dual-view input object, run the async conversion, then map each mammoth message to a one-count loss and merge them.
 */
export async function docxToHtml(bytes: Uint8Array): Promise<{ readonly html: string; readonly losses: ImportLoss[] }> {
  // Copy the bytes into a fresh buffer that owns exactly this content so mammoth's Node build cannot read past our slice.
  const buffer = bytes.slice().buffer;

  // Provide both the ArrayBuffer and Buffer views: mammoth reads `arrayBuffer` in its browser build and `buffer` in its Node build (the tests); both reference the same bytes.
  const input: { arrayBuffer: ArrayBuffer; buffer: ArrayBuffer } = { arrayBuffer: buffer, buffer };

  // Convert to HTML using mammoth with an explicit style map so Word formatting Markdown lacks a mark is reported by the HTML importer.
  const result = await mammoth.convertToHtml(input, { styleMap: [...DOCX_STYLE_MAP] });

  // Return the converted HTML and every loss mammoth reported, mapped to one-count losses and aggregated into per-label counts.
  return {
    html: result.value,
    losses: mergeLosses(result.messages.map((message) => ({ label: message.message, count: 1 }))),
  };
}

/**
 * Dispatches an imported file to the converter matching its extension and returns Markdown together with every construct that could not be carried over.
 *
 * @purpose Implements FR-13.5: routes a file by extension to docx/html/rtf/text handling and merges the losses reported at each conversion stage.
 * @inputs fileName - The imported file's name, used only for extension-based dispatch.
 * @inputs bytes - The raw file bytes consumed by the selected converter.
 * @outputs ImportResult - Canonical Markdown text plus an aggregated loss report covering all stages of the chosen conversion path.
 * @dataflow File name + bytes -> importFormatOf dispatch -> format decoder (decodeText/docxToHtml/importRtf) -> HTML/Markdown importer -> mergeLosses aggregation -> ImportResult.
 * @controlflow Resolve the extension; switch on format, throwing for null and delegating to the matching converter otherwise, merging docx losses across the docx->HTML and HTML->Markdown steps.
 */
export async function importDocument(fileName: string, bytes: Uint8Array): Promise<ImportResult> {
  // Determine which converter applies from the file's extension; an unrecognised extension is handled by the switch below.
  const format = importFormatOf(fileName);

  // Dispatch on the detected format to its matching converter and merge each stage's loss report.
  switch (format) {
    case null:
      // Branch: No recognised extension; refuse with a message naming every supported format.
      throw new Error(`K-Doc cannot import ${fileName}: it imports Word (.docx), web page (.html), rich text (.rtf) and plain text (.txt) files.`);
    case 'docx': {
      // Branch: Word document; convert to HTML first, then import that HTML.
      const converted = await docxToHtml(bytes);
      const result = importHtml(converted.html);

      // Merge the docx->HTML losses with the HTML->Markdown losses into one aggregated report.
      return { markdown: result.markdown, losses: mergeLosses(converted.losses, result.losses) };
    }
    case 'html':
      // Branch: Web page; decode the bytes in the character set the page declares, then import it as HTML.
      return importHtml(decodeHtml(bytes));
    case 'rtf':
      // Branch: Rich text file; decode as Latin-1 since RTF is 7-bit text whose escape sequences carry every other character.
      return importRtf(new TextDecoder('latin1').decode(bytes));
    case 'text':
      // Branch: Plain text; decode using BOM sniffing and strict UTF-8, then convert to paragraph Markdown with no losses.
      return importPlainText(decodeText(bytes));
  }
}
