/**
 * @file snippet-body.ts
 * @purpose Parses a snippet body (FR-7.10) into the text it inserts and its tab stops: $1, ${1}, ${1:default}, $0 for the final cursor, \$ for a literal dollar, and $DATE / $TIME.
 * @inputs the body text and the current time
 * @outputs ParsedSnippet
 * @functions
 *   - SnippetStop: interface describing a tab stop's index and character range.
 *   - ParsedSnippet: interface for parsed snippet text and ordered stops.
 *   - pad: zero-pads a number to two digits.
 *   - snippetDate: formats now as a local YYYY-MM-DD date.
 *   - snippetTime: formats now as a local HH:MM time.
 *   - parseSnippetBody: scans body left-to-right, building inserted text and tab-stop ranges.
 * @dataflow body -> single left-to-right scan -> text + stop ranges -> stops ordered 1..n then 0
 * @controlflow each $ is tried as a braced stop, a bare stop, then a variable, else kept literally
 * @version 1
 * @date 2026-09-16
 */

export interface SnippetStop {
  readonly index: number;
  readonly from: number;
  readonly to: number;
}

export interface ParsedSnippet {
  readonly text: string;
  readonly stops: readonly SnippetStop[];
}

/**
 * @purpose Zero-pads a non-negative integer to two digits.
 * @inputs value - The number to pad (e.g. month or hour).
 * @outputs string - The zero-padded representation, always length 2.
 * @dataflow Numeric input → String() coercion → padStart(2, '0') → padded string.
 * @controlflow No branching; a single expression returns the padded value.
 */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * @purpose Formats the current date as a local ISO-style YYYY-MM-DD string.
 * @inputs now - The Date whose calendar fields are read (local time).
 * @outputs string - A ten-character date string with zero-padded month and day.
 * @dataflow Date → getFullYear/getMonth(+1)/getDate → pad() each numeric field → template literal.
 * @controlflow No branching; fields are composed in a single expression.
 */
export function snippetDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * @purpose Formats the current time as a local ISO-style HH:MM string.
 * @inputs now - The Date whose clock fields are read (local time).
 * @outputs string - A five-character time string with zero-padded hour and minute.
 * @dataflow Date → getHours/getMinutes → pad() each numeric field → template literal joined by ':'.
 * @controlflow No branching; fields are composed in a single expression.
 */
export function snippetTime(now: Date): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * @purpose Scans the raw snippet body once, left to right, producing the literal text to insert and the range of that text for each tab stop.
 * @inputs body - The raw snippet body containing stops ($1, ${1}, ${1:default}, $0), escapes (\$), and variables ($DATE/$TIME).
 * @inputs now - The current Date used when substituting $DATE / $TIME (local time).
 * @outputs ParsedSnippet - The assembled text plus its ordered stops (numbered 1..n, then the final cursor 0).
 * @dataflow body → per-character scan → appended inserted text + recorded stop ranges → stops sorted by index with $0 last.
 * @controlflow Loop over each character; branch on escaped dollar, literal char, or a recognized stop/variable; stops are emitted in index order after the loop.
 */
export function parseSnippetBody(body: string, now: Date): ParsedSnippet {
  let text = '';
  const found = new Map<number, { readonly from: number; readonly to: number }>();
  let i = 0;
  while (i < body.length) {
    const char = body.charAt(i);
    // Escaped dollar sign ($\$): emit a literal '$' and consume both characters.
    if (char === '\\' && body.charAt(i + 1) === '$') {
      text += '$';
      i += 2;
      continue;
    } else if (char !== '$') {
      // Ordinary character: copy it verbatim and advance one position.
      text += char;
      i += 1;
      continue;
    } else {
      // A dollar sign that is not escaped: fall through to stop/variable parsing below.
    }
    const rest = body.slice(i);
    const braced = /^\$\{(\d+)(?::([^}]*))?\}/.exec(rest);
    const bare = /^\$(\d+)/.exec(rest);
    const variable = /^\$(?:\{(DATE|TIME)\}|(DATE|TIME)(?![A-Za-z0-9_]))/.exec(rest);
    // Braced tab stop: ${N} or ${N:default}. Records the first occurrence as a stop spanning its default text.
    if (braced !== null) {
      const index = Number(braced[1]);
      const from = text.length;
      text += braced[2] ?? '';
      // First time this stop number appears: register it as a tab stop covering the inserted default text.
      if (!found.has(index)) {
        found.set(index, { from, to: text.length });
      } else {
        // Stop number already recorded earlier: do not create a second stop; its default text was still appended above.
      }
      i += braced[0].length;
    } else if (bare !== null) {
      // Bare tab stop: $N with no default. Records an empty-range stop at the current cursor position on first occurrence.
      const index = Number(bare[1]);
      // First time this stop number appears: register an empty-range stop at the current text length.
      if (!found.has(index)) {
        found.set(index, { from: text.length, to: text.length });
      } else {
        // Stop number already recorded earlier: do not create a second stop; bare stops carry no default text to append.
      }
      i += bare[0].length;
    } else if (variable !== null) {
      // Variable substitution: $DATE or $TIME expands to the formatted local date or time string.
      const name = variable[1] ?? variable[2];
      text += name === 'DATE' ? snippetDate(now) : snippetTime(now);
      i += variable[0].length;
    } else {
      // None of the stop/variable patterns matched: keep the dollar sign literally in the output.
      text += '$';
      i += 1;
    }
  }
  const numbered: SnippetStop[] = [...found.entries()]
    .filter(([index]) => index !== 0)
    .sort((a, b) => a[0] - b[0])
    .map(([index, range]) => ({ index, from: range.from, to: range.to }));
  const final = found.get(0);
  // Final cursor ($0): use its recorded range if present, otherwise place it after the whole text.
  const last: SnippetStop = final === undefined ? { index: 0, from: text.length, to: text.length } : { index: 0, from: final.from, to: final.to };
  return { text, stops: [...numbered, last] };
}
