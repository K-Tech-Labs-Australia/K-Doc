/**
 * @file line-prefix.ts
 * @purpose The line prefix that continuation lines of a block nested in a blockquote or list item carry, so a re-serialized fragment can be spliced inside a container (FR-4.2).
 * @inputs Markdown source text and character offsets into it.
 * @outputs Line prefix strings used to align continuation content within a container.
 * @functions
 *   - continuationPrefix: Builds the base indentation prefix from characters before an offset.
 *   - itemContentPrefix: Extends the continuation prefix by a list marker's width and gap.
 *   - indentContinuation: Applies a prefix to every line of a fragment after the first.
 * @dataflow text + offset → continuationPrefix → itemContentPrefix → indentContinuation → spliced fragment.
 * @controlflow Compute base prefix from preceding characters, optionally extend for a list marker, then apply to fragment lines; early return when no marker is present.
 * @version 1
 * @date 2026-09-15
 */

/** The list marker and the gap after it at the start of an item: '-', '*', '+', or 1-9 digits then '.' or ')'. */
const ITEM_MARKER = /^(?:[*+-]|\d{1,9}[.)])([ \t]*)/;

/** CommonMark: a gap wider than four columns after a list marker counts as one, the rest being content (an indented code block). */
const MAX_MARKER_GAP = 4;

/** Characters read after an item's start to find its marker: nine digits, a delimiter, and a gap. */
const MARKER_LOOKAHEAD = 16;

/**
 * @purpose Builds the base indentation prefix from characters before an offset in a container line.
 * @inputs text - The full markdown source; offset - Character position where continuation begins.
 * @returns The prefix string: '>' and tabs preserved, all other characters become spaces.
 * @dataflow Characters between line start and offset → mapped to '>' or '\t' or space → concatenated into the prefix.
 * @controlflow Find the line start via lastIndexOf('\n'), iterate each preceding character, preserve '>' and tab, replace others with a space; return the accumulated prefix.
 */
export function continuationPrefix(text: string, offset: number): string {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  let prefix = '';
  for (const ch of text.slice(lineStart, offset)) {
    // '>' marks and tabs (whose width depends on the column) carry over; markers, checkboxes and spaces become spaces.
    if (ch === '>' || ch === '\t') {
      prefix += ch;
    } else {
      prefix += ' ';
    }
  }
  return prefix;
}

/**
 * @purpose Extends the continuation prefix by the width of a list item marker and its gap so content aligns after the marker.
 * @inputs text - The full markdown source; itemStart - Character position where the list item begins.
 * @returns The alignment prefix: base continuation prefix plus spaces covering the marker and gap.
 * @dataflow continuationPrefix(text, itemStart) + parsed ITEM_MARKER → marker width and gap length → combined prefix.
 * @controlflow Compute outer prefix; attempt to match a list marker in the lookahead window; if no marker return outer only; otherwise measure marker length and gap (clamped to one when empty or wider than MAX_MARKER_GAP) and append spaces.
 */
export function itemContentPrefix(text: string, itemStart: number): string {
  const outer = continuationPrefix(text, itemStart);
  const match = ITEM_MARKER.exec(text.slice(itemStart, itemStart + MARKER_LOOKAHEAD));
  // Without a readable marker only the prefix before the item is known.
  if (match === null) {
    return outer;
  } else {
    // A marker: its width and gap are measured below.
  }
  const gap = match[1] ?? '';
  const markerLength = match[0].length - gap.length;
  // No gap (the content starts on the next line) or one wider than the maximum counts as one column. A tab counts as one
  // column too; tabs after markers are rare, and a wrong width is caught by the caller's parse check.
  let gapLength: number;
  if (gap.length === 0 || gap.length > MAX_MARKER_GAP) {
    gapLength = 1;
  } else {
    gapLength = gap.length;
  }
  return outer + ' '.repeat(markerLength + gapLength);
}

/**
 * @purpose Applies a prefix to every line of a fragment after the first so it aligns within its container.
 * @inputs fragment - The text to re-indent; prefix - The alignment prefix to apply.
 * @returns The fragment with subsequent lines prefixed, blank lines using the trimmed prefix.
 * @dataflow Split fragment on newlines → map each line by index and content → join back with newlines.
 * @controlflow Split into lines and branch per line: first line returned as-is, blank lines get the trimmed prefix, content lines get the full prefix.
 */
export function indentContinuation(fragment: string, prefix: string): string {
  // An empty prefix needs no special case: every line then comes back unchanged.
  // A blank line takes the prefix without its trailing spaces: '>' in a blockquote, nothing in a list item.
  const blank = prefix.trimEnd();
  return fragment
    .split('\n')
    .map((line: string, index: number): string => {
      // The first line continues the line the splice starts on, which already carries the prefix.
      if (index === 0) {
        return line;
      } else if (line === '' || line === '\r') {
        // A blank line.
        return blank + line;
      } else {
        // A line with content.
        return prefix + line;
      }
    })
    .join('\n');
}