/**
 * @file go-to-line.ts
 * @purpose Parses a "Go To" entry typed by the user in the Source pane and converts a parsed line/column target into a character offset within source text.
 * @inputs Raw string typed by the user (parseLineTarget); source text plus a LineTarget (lineTargetOffset).
 * @outputs A clamped LineTarget or null from parseLineTarget; a zero-based character offset from lineTargetOffset.
 * @functions
 *   - parseLineTarget: Validate and normalize a "line[:column]" string into a document-clamped LineTarget, or null when invalid.
 *   - lineTargetOffset: Map a LineTarget to a zero-based character offset in the given source text, clamping the column to the line's content.
 * @dataflow User keystrokes → trimmed regex match → parsed integers → clamped LineTarget; then source text → walked newline boundaries → clamped column offset.
 * @controlflow Reject non-matching input early; reject zero/negative line or column; clamp the line to document length; then walk newlines to locate the target line and clamp the column within its content.
 * @version 1
 * @date 2026-09-13
 */

/**
 * A resolved destination inside a source document, with 1-based coordinates.
 */
export interface LineTarget {
  /** 1-based line number, already clamped to the document. */
  readonly line: number;
  /** 1-based column; the caller's text decides how far it can actually go. */
  readonly column: number;
}

/**
 * @purpose Parse a user-entered "line[:column]" string into a clamped LineTarget, or null when the input is not a valid target.
 * @inputs input - The raw string typed by the user in the Go To prompt. lineCount - The number of lines currently present in the document.
 * @outputs A LineTarget whose 1-based line and column are valid within the document; null if the input does not denote a valid line.
 * @dataflow Trimmed input → regex capture groups (line digits, optional column digits) → parsed integers → clamped destination.
 * @controlflow Reject non-matching input early; reject zero or negative line/column; clamp the line to the document length; return the target.
 */
export function parseLineTarget(input: string, lineCount: number): LineTarget | null {
  // Normalize surrounding whitespace so " 3:5 " parses identically to "3:5".
  const trimmed = input.trim();

  // Match an optional leading colon, a required run of digits (the line), and an optional ":column" group.
  const match = trimmed.match(/^:?(\d+)(?::(\d+))?$/);

  // No structural match means the user did not type a valid line reference; reject it.
  if (match === null) {
    return null;
  }

  // The first capture group always holds the line digits whenever a match succeeds; the guard satisfies indexed-access checks.
  const lineGroup = match[1];
  if (lineGroup === undefined) {
    return null;
  }
  const line = Number.parseInt(lineGroup, 10);

  // A line number below 1 is invalid because lines are 1-based, so reject it (this also rejects "0").
  if (line < 1) {
    return null;
  }

  // The second capture group is present only when the user typed an explicit ":column" suffix.
  const columnGroup: string | undefined = match.length >= 3 ? match[2] : undefined;

  // Default to column 1 (the line's first character) when no explicit column was supplied.
  const column = columnGroup === undefined ? 1 : Number.parseInt(columnGroup, 10);

  // A column below 1 is invalid because columns are 1-based, so reject it (this also rejects "3:0").
  if (column < 1) {
    return null;
  }

  // A document with no lines still exposes a single logical position to jump to.
  const effectiveLineCount = lineCount < 1 ? 1 : lineCount;

  // A request past the end of the file clamps to the last line, matching every editor's Go To behavior.
  const clampedLine = Math.min(line, effectiveLineCount);

  // All values are valid and normalized; hand back the resolved destination.
  return { line: clampedLine, column };
}

/**
 * @purpose Convert a LineTarget into a zero-based character offset within source text, clamping the column to the target line's content.
 * @inputs text - The full source document whose characters are being indexed. target - A 1-based LineTarget with already-clamped line and column values.
 * @outputs A zero-based character offset pointing at the requested column on the requested line.
 * @dataflow Source text → walked newline boundaries to locate the target line start → column clamped against that line's content length → final offset.
 * @controlflow Walk newlines to find the line start (stopping at the last line if fewer lines exist); extend to the line end; drop a trailing carriage return; clamp and add the column.
 */
export function lineTargetOffset(text: string, target: LineTarget): number {
  // Lines are separated by '\n' and line 1 begins at offset 0; walk forward to locate the target line's start.
  let lineStart = 0;
  let currentLine = 1;

  // Advance past each newline, moving the line start to the following character, until the target line is reached or the text ends.
  for (let i = 0; i < text.length && currentLine < target.line; i++) {
    // A newline terminates the current line and begins the next one at the following index.
    if (text.charAt(i) === '\n') {
      currentLine++;
      lineStart = i + 1;
    }
  }

  // If the document has fewer lines than requested, the loop ends with lineStart pinned to the last line's start.

  // Determine where this line's content ends: the next newline, or the end of the document when none follows.
  let contentEnd = lineStart;
  while (contentEnd < text.length && text.charAt(contentEnd) !== '\n') {
    contentEnd++;
  }

  // CRLF files: a carriage return immediately precedes the newline, so trim it to keep the caret from landing between \r and \n.
  if (contentEnd > lineStart && text.charAt(contentEnd - 1) === '\r') {
    contentEnd--;
  }

  // Clamp the requested column to this line's content width and add it to the line start for the final offset.
  return lineStart + Math.min(target.column - 1, contentEnd - lineStart);
}