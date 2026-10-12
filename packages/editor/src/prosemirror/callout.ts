/**
 * @file callout.ts
 * @purpose Implements GitHub-style callouts (alerts) as commands over standard blockquote nodes (FR-8.5, FR-8.10).
 *
 *   A callout is not a new node. GitHub and Obsidian both write one as a blockquote whose first line is
 *   `[!NOTE]`, and that is ordinary Markdown: any reader that does not know about alerts still sees a quote
 *   with a line of text in it. Adding a `callout` node to the schema would have bought a prettier tree at the
 *   cost of a document that only K-Doc can read, and the whole point of the editor is that the file on disk is
 *   plain Markdown.
 *
 *   So the marker paragraph stays in the document. It is styled to look like a title rather than hidden,
 *   because a marker that is invisible in the pane but present in the file is a difference between the two
 *   panes that the user cannot see and cannot fix.
 *
 *   The marker is the first line, not the whole paragraph. `> [!NOTE]` followed by `> body` is a single
 *   paragraph, because a quote's continuation line joins the one above it — so a rule that required the marker
 *   to be the paragraph's entire text recognised only the shape K-Doc's own editor produces and missed the
 *   commonest shape a GFM file arrives in.
 *
 *   An unknown alert word is still an alert. `[!QUESTION]` is somebody else's extension or the user's own,
 *   and refusing to colour it at all would make K-Doc the only reader that treats it as prose. It is recognised
 *   and rendered in a neutral accent rather than guessed at as one of the five K-Doc knows.
 *
 * @inputs ProseMirror EditorState instances, CalloutKind variants, custom alert words, and optional dispatch callbacks.
 * @outputs CalloutKind types, CALLOUT_KINDS list, AlertMarker interface, callout marker formatters/parsers, and ProseMirror editing Commands.
 * @functions
 *   - calloutMarker: Returns the GitHub-style alert marker string for a callout kind (e.g. `[!NOTE]`).
 *   - parseAlertMarker: Reads the alert marker a paragraph opens with, whether or not the paragraph is only the marker.
 *   - parseCalloutMarker: Parses a text string to extract and validate a CalloutKind, or returns null.
 *   - alertMarkerAt: Reports the alert marker on the caret's own blockquote, of any word.
 *   - calloutAt: Reports which callout kind the caret is currently inside, or null.
 *   - setCallout: Creates a command converting the active block/blockquote into a callout of the given kind.
 *   - setCalloutWord: Makes the block under the caret a callout carrying an arbitrary alert word.
 *   - clearCallout: Creates a command removing the alert marker while preserving the blockquote and body content.
 * @dataflow EditorState -> selection inspection -> marker parsing / transaction construction -> dispatch callback.
 * @controlflow Inspect selection ancestor chain for blockquote -> parse or modify leading marker paragraph -> dispatch transaction.
 * @version 2
 * @date 2026-09-11
 */

import { wrapIn } from 'prosemirror-commands';
import { kdocSchema } from './schema.js';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';

export type CalloutKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';

export const CALLOUT_KINDS: readonly CalloutKind[] = [
  'note',
  'tip',
  'important',
  'warning',
  'caution',
] as const;

/** An alert marker found at the start of a blockquote's first paragraph. */
export interface AlertMarker {
  /** The word between `[!` and `]`, lower-cased. */
  readonly word: string;
  /** The kind, when the word is one of the five K-Doc colours; null for any other word. */
  readonly kind: CalloutKind | null;
  /** Length in characters of the marker itself, so a decoration can cover exactly it. */
  readonly length: number;
}

/**
 * Regular expression matching GitHub-style alert markers at the start of a paragraph.
 *
 * The lookahead (?=\n|$) is what separates `[!NOTE]` opening a line from `[!NOTE] and more`, which is prose.
 * The regexp carries no global flag because a global one keeps lastIndex between calls.
 */
const ALERT_MARKER_PATTERN: RegExp = /^\[!([A-Za-z]+)\](?=\n|$)/;

/**
 * @purpose Returns the markdown alert marker string for a given callout kind.
 * @inputs kind: CalloutKind - The callout variant ('note', 'tip', 'important', 'warning', 'caution').
 * @outputs string - The formatted callout marker string, e.g. '[!NOTE]'.
 * @dataflow kind -> uppercase string interpolation -> formatted marker.
 * @controlflow Converts kind to upper case and formats within '[!...]' delimiter.
 */
export function calloutMarker(kind: CalloutKind): string {
  return `[!${kind.toUpperCase()}]`;
}

/**
 * @purpose Reads the alert marker a paragraph opens with, whether or not the paragraph is only the marker.
 * @inputs text: string - The text content to parse (e.g. from the first paragraph of a blockquote).
 * @outputs AlertMarker | null - The parsed alert marker if recognized, or null if invalid or absent.
 * @dataflow text -> ALERT_MARKER_PATTERN exec -> extract word and length -> match against CALLOUT_KINDS -> AlertMarker | null.
 * @controlflow Test text against ALERT_MARKER_PATTERN -> if null return null -> guard match[1] and match[0] against undefined -> loop CALLOUT_KINDS to find matching kind -> return AlertMarker object.
 */
export function parseAlertMarker(text: string): AlertMarker | null {
  const match = ALERT_MARKER_PATTERN.exec(text);

  // Check if text does not match the alert marker pattern.
  if (match === null) {
    // Text does not open with a valid alert marker: return null.
    return null;
  } else {
    // Alert marker matched: extract captured groups.
    const rawWord = match[1];
    const matchedText = match[0];

    // Check if captured groups are defined under strict indexing.
    if (rawWord === undefined || matchedText === undefined) {
      // Captured marker text or word is undefined: return null.
      return null;
    } else {
      // Captured groups are valid strings: lowercase the word for kind matching.
      const word = rawWord.toLowerCase();
      let matchedKind: CalloutKind | null = null;

      // Check if the lower-cased word matches any recognized CalloutKind without casting.
      for (const kind of CALLOUT_KINDS) {
        // Check if candidate kind matches the captured word.
        if (kind === word) {
          // Valid kind matched: assign and stop checking.
          matchedKind = kind;
          break;
        } else {
          // Did not match candidate kind: check next kind.
        }
      }

      // Return the parsed alert marker with its lower-cased word, recognized kind, and character length.
      return {
        word,
        kind: matchedKind,
        length: matchedText.length,
      };
    }
  }
}

/**
 * @purpose Parses a text string to determine if it contains a valid callout marker and returns the matching CalloutKind.
 * @inputs text: string - The text content to parse (e.g. from the first paragraph of a blockquote).
 * @outputs CalloutKind | null - The parsed callout kind if recognized, or null if invalid or unknown.
 * @dataflow text -> trim -> parseAlertMarker -> kind property -> CalloutKind | null.
 * @controlflow Trim text -> parseAlertMarker -> if marker present return kind (or null); if marker absent return null.
 */
export function parseCalloutMarker(text: string): CalloutKind | null {
  // It stays because it is the narrower question — is this one of the five —
  // and the serializer's own alert test asks the wider one.
  const marker = parseAlertMarker(text.trim());

  // Check if an alert marker was recognized in the trimmed text.
  if (marker !== null) {
    // Alert marker parsed: return recognized CalloutKind or null for custom words.
    return marker.kind;
  } else {
    // Text does not contain an alert marker: return null.
    return null;
  }
}

/**
 * @purpose Finds the innermost blockquote node enclosing the current selection caret.
 * @inputs state: EditorState - The current ProseMirror editor state.
 * @outputs { node: ProseMirrorNode; pos: number } | null - The innermost blockquote node and its start position, or null.
 * @dataflow state.selection.$from -> walk depth from $from.depth down to 1 -> inspect node.type.name -> return match or null.
 * @controlflow Loop depth from $from.depth down to 1 -> check if type.name === 'blockquote' -> if matched, return node and $from.before(d); if loop terminates, return null.
 */
function blockquoteAround(
  state: EditorState,
): { node: ProseMirrorNode; pos: number } | null {
  const { $from } = state.selection;
  // Walk from the selection depth down to depth 1 to find the innermost enclosing blockquote.
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d);
    // Check if the ancestor node at depth d is a blockquote.
    if (node.type.name === 'blockquote') {
      // Innermost blockquote found: break and return the node with its before position.
      return { node, pos: $from.before(d) };
    } else {
      // Ancestor is not a blockquote: continue scanning toward the document root.
    }
  }

  // No enclosing blockquote found in the ancestor chain.
  return null;
}

/**
 * @purpose Reports the alert marker on the caret's own blockquote, of any word.
 * @inputs state: EditorState - The current ProseMirror editor state.
 * @outputs AlertMarker | null - The alert marker on the enclosing blockquote, or null.
 * @dataflow state -> blockquoteAround -> first child paragraph -> parseAlertMarker(textContent) -> AlertMarker | null.
 * @controlflow Resolve blockquoteAround(state) -> if null, return null -> inspect firstChild of blockquote -> if null or not paragraph, return null -> return parseAlertMarker(first.textContent).
 */
export function alertMarkerAt(state: EditorState): AlertMarker | null {
  const existing = blockquoteAround(state);

  // Check if the selection is enclosed in a blockquote.
  if (existing === null) {
    // Caret is not inside any blockquote: cannot be an alert.
    return null;
  } else {
    // Caret is inside a blockquote: inspect its first child node.
    const first = existing.node.firstChild;

    // Check if the blockquote has a first child and whether it is a paragraph.
    if (first === null || first.type.name !== 'paragraph') {
      // No first child or first child is not a paragraph: not a valid alert structure.
      return null;
    } else {
      // First child is a paragraph: parse its text content for an alert marker.
      return parseAlertMarker(first.textContent);
    }
  }
}

/**
 * @purpose Reports which callout kind the caret is currently inside, or null.
 * @inputs state: EditorState - The current ProseMirror editor state.
 * @outputs CalloutKind | null - The callout kind if the caret is inside a recognized callout, or null.
 * @dataflow state -> alertMarkerAt -> inspect marker.kind -> CalloutKind | null.
 * @controlflow Resolve alertMarkerAt(state) -> if null, return null -> otherwise return marker.kind.
 */
export function calloutAt(state: EditorState): CalloutKind | null {
  const marker = alertMarkerAt(state);

  // Check if an alert marker was found on the enclosing blockquote.
  // Written as an explicit if/else rather than '?.' so the two answers are visibly separate:
  // no marker at all and a marker K-Doc does not colour both give null here,
  // and the plugin needs alertMarkerAt to tell them apart.
  if (marker === null) {
    // No alert marker found: return null.
    return null;
  } else {
    // Alert marker present: return its recognized CalloutKind or null for custom words.
    return marker.kind;
  }
}

/**
 * @purpose Applies a formatted alert marker string to the block under the caret, wrapping in a blockquote if absent or updating existing marker.
 * @inputs markerText: string - The formatted alert marker string (e.g. '[!NOTE]' or '[!CUSTOM]').
 * @outputs Command - A ProseMirror editing command applying or updating the alert marker.
 * @dataflow state -> blockquoteAround -> wrap in blockquote if absent -> replace marker characters or insert marker paragraph -> dispatch transaction.
 * @controlflow 1. Find existing blockquote.
 *   2. If null: wrap in blockquote via wrapIn(kdocSchema.nodes['blockquote']), capture transaction, and recurse with updated state.
 *   3. If present: test first child paragraph with parseAlertMarker; replace marker characters if present or insert marker paragraph if absent.
 */
function applyMarker(markerText: string): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const existing = blockquoteAround(state);

    // Check if the selection is already inside an enclosing blockquote.
    if (existing === null) {
      // Caret is not in a blockquote: resolve blockquote node type from schema.
      const type = kdocSchema.nodes['blockquote'];

      // Check if blockquote node type exists in the schema.
      if (type === undefined) {
        // Schema has no blockquote node type: command cannot apply.
        return false;
      } else {
        // Blockquote node type resolved: check if this is a dry run query.
        // Check if dispatch callback was provided.
        if (dispatch === undefined) {
          // Dry run: ask only whether the block can be wrapped in a blockquote.
          return wrapIn(type)(state);
        } else {
          // Dispatch provided: wrap selection and capture the resulting transaction.
          let latest: Transaction | null = null;
          const capture = (tr: Transaction): void => {
            latest = tr;
            dispatch(tr);
          };
          const wrapped = wrapIn(type)(state, capture);
          const dispatchedTr = latest;

          // Check if the wrap command succeeded and dispatched a transaction.
          if (!wrapped || dispatchedTr === null) {
            // Wrap failed or dispatched nothing: return false.
            return false;
          } else {
            // Wrap succeeded: insert the marker into the state that transaction produced.
            // The second pass finds the blockquote the first pass just made, so the marker logic
            // lives in one branch rather than two.
            return applyMarker(markerText)(state.apply(dispatchedTr), dispatch);
          }
        }
      }
    } else {
      // Selection is already inside an enclosing blockquote: inspect its first child.
      const first = existing.node.firstChild;
      let marker: AlertMarker | null = null;

      // Check if the blockquote has a first child and whether it is a paragraph.
      if (first !== null && first.type.name === 'paragraph') {
        // First child is a paragraph: parse for an existing alert marker.
        marker = parseAlertMarker(first.textContent);
      } else {
        // First child is absent or not a paragraph: no marker can be present.
      }

      // Check whether the first child has an existing alert marker.
      if (marker !== null) {
        // Marker present: replace existing marker text.
        // Check if dispatch callback was provided or if this is a dry run.
        if (dispatch === undefined) {
          // Dry run: replacing existing marker is valid.
          return true;
        } else {
          // existing.pos + 2 is the first character of the paragraph's text — one step into the
          // blockquote and one into the paragraph — and replacing only the marker's own characters is what
          // keeps a compact `> [!NOTE] body` from losing its body.
          dispatch(
            state.tr.replaceWith(
              existing.pos + 2,
              existing.pos + 2 + marker.length,
              kdocSchema.text(markerText),
            ),
          );
          return true;
        }
      } else {
        // No marker present: insert a leading marker paragraph.
        // Check if dispatch callback was provided or if this is a dry run.
        if (dispatch === undefined) {
          // Dry run: inserting marker paragraph into blockquote is valid.
          return true;
        } else {
          // Position arithmetic: existing.pos + 1 is just inside the blockquote, before its first child.
          const markerParagraph = kdocSchema.node('paragraph', null, [
            kdocSchema.text(markerText),
          ]);
          dispatch(state.tr.insert(existing.pos + 1, markerParagraph));
          return true;
        }
      }
    }
  };
}

/**
 * @purpose Makes the block under the caret a callout of the given kind, wrapping it in a blockquote if absent and replacing any marker.
 * @inputs kind: CalloutKind - The target callout variant to set ('note', 'tip', 'important', 'warning', 'caution').
 * @outputs Command - A ProseMirror editing command applying or updating the callout.
 * @dataflow kind -> calloutMarker -> applyMarker -> Command.
 * @controlflow Converts kind to formatted marker string and delegates to applyMarker.
 */
export function setCallout(kind: CalloutKind): Command {
  return applyMarker(calloutMarker(kind));
}

/**
 * @purpose Makes the block under the caret a callout carrying an arbitrary alert word.
 * @inputs word: string - The raw alert word to apply (e.g. 'question', 'todo').
 * @outputs Command - A ProseMirror editing command applying or updating the custom callout.
 * @dataflow word -> trim and uppercase -> validation test -> applyMarker -> Command.
 * @controlflow Trim and uppercase word -> test against /^[A-Za-z]+$/ -> if invalid, return failing command -> otherwise delegate to applyMarker with formatted marker.
 */
export function setCalloutWord(word: string): Command {
  const clean = word.trim().toUpperCase();

  // Check whether the cleaned word consists solely of alphabetic characters.
  // GFM's alert syntax admits letters only, and a word with a space or a digit in it
  // would serialise as a line of prose that happens to start with a bracket.
  if (!/^[A-Za-z]+$/.test(clean)) {
    // Word contains invalid characters: return command that fails without modifying state.
    return (): boolean => false;
  } else {
    // Word is valid: delegate to applyMarker with the formatted custom marker.
    return applyMarker(`[!${clean}]`);
  }
}

/**
 * @purpose Removes the marker line, leaving the plain quote the callout was built from.
 * @inputs None.
 * @outputs Command - A ProseMirror editing command that deletes the callout marker.
 * @dataflow state -> blockquoteAround -> inspect first child marker -> tr.delete(marker range) -> dispatch.
 * @controlflow Resolve blockquoteAround and first child paragraph -> parse alert marker -> if no marker, return false -> if dry run, return true -> if marker is whole paragraph text, delete paragraph node; else delete marker characters and following newline -> dispatch.
 */
export function clearCallout(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const existing = blockquoteAround(state);

    // Check if the caret is inside a blockquote.
    if (existing === null) {
      // Not in a blockquote: no callout present to clear.
      return false;
    } else {
      // Caret is inside a blockquote: inspect its first child node.
      const first = existing.node.firstChild;

      // Check if the first child is absent or not a paragraph.
      if (first === null || first.type.name !== 'paragraph') {
        // First child is absent or not a paragraph: not a valid callout structure.
        return false;
      } else {
        const marker = parseAlertMarker(first.textContent);

        // Check if an alert marker is present in the first paragraph.
        if (marker === null) {
          // There is no callout there: return false.
          // There is nothing to clear, and a command that reports success for doing nothing
          // puts an empty entry in the undo history.
          return false;
        } else {
          // Callout marker present: check if dispatch callback was provided.
          if (dispatch === undefined) {
            // Dry run: clearing an active callout is valid.
            return true;
          } else {
            // Check whether the marker comprises the paragraph's entire text content.
            // A compact alert's body is the rest of that same paragraph and deleting the node would take the body with it.
            if (marker.length === first.textContent.length) {
              // The marker is the whole text, so there is no newline to take.
              // Delete the marker paragraph whole, from just inside the blockquote to just past the paragraph node.
              const from = existing.pos + 1;
              const to = existing.pos + 1 + first.nodeSize;
              dispatch(state.tr.delete(from, to));
              return true;
            } else {
              // The marker is only the first line of the paragraph.
              // Delete just the marker characters and the newline that follows it.
              // The + 1 is the newline, and leaving it would start the body with a blank line.
              const from = existing.pos + 2;
              const to = existing.pos + 2 + marker.length + 1;
              dispatch(state.tr.delete(from, to));
              return true;
            }
          }
        }
      }
    }
  };
}
