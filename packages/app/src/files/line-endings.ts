/**
 * @file line-endings.ts
 * @purpose Converts a note between its line endings on disk and the LF text the editor works on, so offsets agree between the document, CodeMirror and ProseMirror while a CRLF file is saved back as CRLF.
 * @inputs File text read from disk (string).
 * @outputs InternalText with normalized text and detected line ending; or text formatted for writing to disk.
 * @functions
 *   - fromDisk: Detects whether a file uses LF or CRLF and returns editor-ready LF text.
 *   - toDisk: Converts editor LF text back to the file's original line ending for saving.
 * @dataflow Disk text → fromDisk → editor; editor text → toDisk → disk.
 * @controlflow One scan for a lone LF decides whether a file is converted; conversion happens only when every line break is CRLF.
 * @version 1
 * @date 2026-09-15
 */

/** How a file's lines end on disk. */
export type LineEnding = 'lf' | 'crlf';

/** A note's text as the editor holds it, and how its lines ended on disk. */
export interface InternalText {
  readonly text: string;
  readonly lineEnding: LineEnding;
}

const CRLF = '\r\n';
const LF = '\n';

// @purpose Detects a file's line ending and returns editor-ready LF text.
// @inputs text - Raw file contents read from disk.
// @outputs InternalText with normalized LF text and detected lineEnding ('lf' or 'crlf').
// @dataflow Disk bytes → string → scan for lone LF → return normalized text.
// @controlflow Returns early as LF if no CRLF present; scans for a lone LF to detect mixed endings; otherwise normalizes CRLF to LF.
export function fromDisk(text: string): InternalText {
  // Without a CRLF the text is already what the editor works on.
  if (!text.includes(CRLF)) {
    return { text, lineEnding: 'lf' };
  } else {
    // CRLF present: converted only when every line break is one.
  }
  for (let index = text.indexOf(LF); index !== -1; index = text.indexOf(LF, index + 1)) {
    // A line feed without a carriage return before it: the file mixes line endings and is kept exactly as written,
    // since no single ending would write it back byte for byte.
    if (text[index - 1] !== '\r') {
      return { text, lineEnding: 'lf' };
    } else {
      // Part of a CRLF: keep scanning.
    }
  }
  return { text: text.split(CRLF).join(LF), lineEnding: 'crlf' };
}

// @purpose Converts editor LF text back to the file's original line ending for saving.
// @inputs text - Editor-held LF text; lineEnding - The file's detected line ending ('lf' or 'crlf').
// @outputs String formatted with the correct line ending for writing to disk.
// @dataflow Editor text + lineEnding → join with CRLF (or passthrough) → disk bytes.
// @controlflow Returns text unchanged for LF; converts every LF to CRLF otherwise.
export function toDisk(text: string, lineEnding: LineEnding): string {
  // An LF file is written as the editor holds it.
  if (lineEnding === 'lf') {
    return text;
  } else {
    // Every line feed becomes CRLF. The exact inverse of fromDisk: a carriage return that stood before a CRLF was kept
    // in the text and stays in front of the one written back.
    return text.split(LF).join(CRLF);
  }
}