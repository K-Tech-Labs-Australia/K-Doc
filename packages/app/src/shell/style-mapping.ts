/**
 * @file style-mapping.ts
 * @purpose Translates between the Styles gallery's entries and the ProseMirror editor commands behind them (FR-8.5).
 *   The gallery knows what a style looks like; this module knows what a style is. Keeping the two apart
 *   means the gallery can be tested without an editor and this mapping can be tested without a DOM, and neither
 *   has to know the other's difficulties.
 *   One asymmetry is worth stating: reading the caret's style and writing a style are not mirror images.
 *   Reading has to pick one answer out of several that are true at once — a heading inside a blockquote is both
 *   — so the order the checks run in is the answer, not an implementation detail.
 * @inputs ProseMirror EditorState instances and gallery StyleId identifiers.
 * @outputs Resolved StyleId for the caret's block, CalloutKind parser, and ProseMirror Command factories for applying styles.
 * @functions
 *   - calloutKindOf: Maps a StyleId to its corresponding CalloutKind or null without unsafe casting.
 *   - styleIdAt: Reports which gallery entry describes the block under the caret, or null when none does.
 *   - commandForStyle: Returns the ProseMirror Command that makes the block under the caret carry the given style.
 *   - canApplyStyle: Reports whether a gallery entry could be applied where the caret is.
 * @dataflow EditorState / StyleId -> block activity & callout inspection / command resolution -> StyleId | null / ProseMirror Command.
 * @controlflow styleIdAt evaluates ordered block type predicates (callout -> codeBlock -> heading 1..6 -> blockquote -> paragraph) -> commandForStyle dispatches target ProseMirror block commands or composed quote command.
 * @version 2
 * @date 2026-09-11
 */

import {
  setParagraph,
  setHeading,
  setCodeBlock,
  toggleBlockquote,
  isBlockActive,
  calloutAt,
  setCallout,
  setCalloutWord,
  clearCallout,
  type CalloutKind,
} from '@k-doc/editor';
import type { Command, EditorState } from 'prosemirror-state';
import type { StyleId } from './styles-gallery.js';

/**
 * Maps a gallery style identifier to its corresponding callout kind.
 *
 * @purpose Maps a StyleId to its corresponding CalloutKind or null without unsafe casting.
 * @inputs id: StyleId - The gallery style identifier to inspect.
 * @outputs CalloutKind | null - The corresponding callout kind ('note', 'tip', 'important', 'warning', 'caution'), or null if not a callout style.
 * @dataflow id -> explicit branch matching -> CalloutKind | null.
 * @controlflow Evaluate id against each callout style literal -> return matching CalloutKind -> return null for non-callout styles.
 */
export function calloutKindOf(id: StyleId): CalloutKind | null {
  // Check if id is 'callout-note'.
  if (id === 'callout-note') {
    // Style represents a Note callout.
    return 'note';
  } else if (id === 'callout-tip') {
    // Check if id is 'callout-tip'.
    // Style represents a Tip callout.
    return 'tip';
  } else if (id === 'callout-important') {
    // Check if id is 'callout-important'.
    // Style represents an Important callout.
    return 'important';
  } else if (id === 'callout-warning') {
    // Check if id is 'callout-warning'.
    // Style represents a Warning callout.
    return 'warning';
  } else if (id === 'callout-caution') {
    // Check if id is 'callout-caution'.
    // Style represents a Caution callout.
    return 'caution';
  } else {
    // Non-callout style identifier: return null.
    return null;
  }
}

/**
 * Reports which gallery entry describes the block under the caret, or null when none does.
 *
 * @purpose Reports which gallery entry describes the block under the caret, or null when none does.
 * @inputs state: EditorState - The current ProseMirror editor state.
 * @outputs StyleId | null - The matching StyleId describing the active block, or null if no gallery entry matches.
 * @dataflow state -> calloutAt / isBlockActive tests in precedence order -> matching StyleId or null.
 * @controlflow Test calloutAt(state) (must precede quote check) -> test isBlockActive('codeBlock') -> loop heading levels 1..6 testing isBlockActive('heading', { level }) (must precede quote check) -> test isBlockActive('blockquote') -> test isBlockActive('paragraph') -> fallback to null.
 */
export function styleIdAt(state: EditorState): StyleId | null {
  const callout = calloutAt(state);
  // 1. Check calloutAt(state) before the quote check: a callout is a blockquote, so it has to be
  // asked about before the quote check or every callout would read as a plain quote.
  if (callout !== null) {
    // Map the callout kind to `callout-${kind}` through an explicit commented chain, not a template cast.
    if (callout === 'note') {
      // Note callout matches 'callout-note'.
      return 'callout-note';
    } else if (callout === 'tip') {
      // Check if callout kind is 'tip'.
      // Tip callout matches 'callout-tip'.
      return 'callout-tip';
    } else if (callout === 'important') {
      // Check if callout kind is 'important'.
      // Important callout matches 'callout-important'.
      return 'callout-important';
    } else if (callout === 'warning') {
      // Check if callout kind is 'warning'.
      // Warning callout matches 'callout-warning'.
      return 'callout-warning';
    } else {
      // Caution callout matches 'callout-caution'.
      return 'callout-caution';
    }
  } else if (isBlockActive(state, 'codeBlock')) {
    // 2. Check isBlockActive(state, 'codeBlock') before quote and paragraph checks,
    // as a code block is a distinct block container with its own gallery entry.
    return 'code-block';
  } else {
    // 3. Check headings via loop over levels 1..6 before the quote check, because a heading
    // inside a blockquote is a heading first: that is the block the caret is actually in.
    for (let level = 1; level <= 6; level++) {
      // Test whether a heading with the given level is active in the selection ancestors.
      if (isBlockActive(state, 'heading', { level })) {
        // Return the matching id through an explicit commented chain over the six literals.
        if (level === 1) {
          // Level 1 matches 'heading-1'.
          return 'heading-1';
        } else if (level === 2) {
          // Level 2 matches 'heading-2'.
          return 'heading-2';
        } else if (level === 3) {
          // Level 3 matches 'heading-3'.
          return 'heading-3';
        } else if (level === 4) {
          // Level 4 matches 'heading-4'.
          return 'heading-4';
        } else if (level === 5) {
          // Level 5 matches 'heading-5'.
          return 'heading-5';
        } else {
          // Level 6 matches 'heading-6'.
          return 'heading-6';
        }
      } else {
        // Heading level not active: continue to check next heading level.
      }
    }

    // 4. Check isBlockActive(state, 'blockquote') after callouts and headings have been checked,
    // so that plain blockquotes without alert markers or headings are identified as quote.
    if (isBlockActive(state, 'blockquote')) {
      // Active blockquote matches 'quote'.
      return 'quote';
    } else if (isBlockActive(state, 'paragraph')) {
      // 5. Check isBlockActive(state, 'paragraph') after containers (callout, codeBlock, heading, blockquote),
      // identifying standard text paragraphs as normal.
      return 'normal';
    } else {
      // 6. Otherwise null: the caret is in something the gallery has no entry for, such as a table cell
      // or a list item, and marking nothing is the truthful answer.
      return null;
    }
  }
}

/**
 * Returns the command that makes the block under the caret carry the given style.
 *
 * @purpose Returns the command that makes the block under the caret carry the given style.
 * @inputs id: StyleId - The gallery style identifier to apply.
 * @outputs Command - A ProseMirror editing Command that applies the given style to the block under the caret.
 * @dataflow id -> command mapping (callout / paragraph / heading / codeBlock / quote / fallback) -> Command.
 * @controlflow Branch on id: if callout, return setCallout(kind) -> if normal, return setParagraph() -> if heading-1..6, return setHeading(1..6) -> if code-block, return setCodeBlock() -> if quote, return composed quote command -> else return false-returning command.
 */
export function commandForStyle(id: StyleId): Command {
  const calloutKind = calloutKindOf(id);
  // Check if id represents any callout kind.
  if (calloutKind !== null) {
    // Callout style: return command setting the specific callout kind.
    return setCallout(calloutKind);
  } else if (id === 'normal') {
    // Check if id is 'normal'.
    // Normal style: return command converting the active block to a paragraph.
    return setParagraph();
  } else if (id === 'heading-1') {
    // Check if id is 'heading-1'.
    // Heading 1 style: return command setting heading level 1.
    return setHeading(1);
  } else if (id === 'heading-2') {
    // Check if id is 'heading-2'.
    // Heading 2 style: return command setting heading level 2.
    return setHeading(2);
  } else if (id === 'heading-3') {
    // Check if id is 'heading-3'.
    // Heading 3 style: return command setting heading level 3.
    return setHeading(3);
  } else if (id === 'heading-4') {
    // Check if id is 'heading-4'.
    // Heading 4 style: return command setting heading level 4.
    return setHeading(4);
  } else if (id === 'heading-5') {
    // Check if id is 'heading-5'.
    // Heading 5 style: return command setting heading level 5.
    return setHeading(5);
  } else if (id === 'heading-6') {
    // Check if id is 'heading-6'.
    // Heading 6 style: return command setting heading level 6.
    return setHeading(6);
  } else if (id === 'code-block') {
    // Check if id is 'code-block'.
    // Code block style: return command converting block to a codeBlock.
    return setCodeBlock();
  } else if (id === 'quote') {
    // Check if id is 'quote'.
    // A toggle and a style are different verbs, and the gallery's contract is that
    // picking an entry leaves you in that style rather than somewhere else.
    // Return a composed command that clears callout markers if present, preserves existing plain quotes,
    // or toggles into a blockquote if not already quoted.
    return (state, dispatch): boolean => {
      // Check if caret is in a callout and clear its alert marker paragraph.
      // The caret is in a callout, and "Quote" is the callout minus its marker, so the marker is all that has to go.
      if (clearCallout()(state, dispatch)) {
        // Callout marker cleared: the block is now a plain blockquote.
        return true;
      } else if (isBlockActive(state, 'blockquote')) {
        // Check if the block is already a plain blockquote.
        // The block is already a plain quote, and toggleBlockquote would take the quote away,
        // which is the opposite of picking the style you are already in.
        return false;
      } else {
        // Block is not currently inside a blockquote: wrap it in a blockquote container.
        return toggleBlockquote()(state, dispatch);
      }
    };
  } else {
    // An id with no command behind it cannot be applied, and returning a command that
    // always reports false is better than guessing.
    return (): boolean => false;
  }
}
/**
 * The word used only to ask whether a callout could be placed where the caret is.
 *
 * A custom callout's word is the user's and is asked for at the point of use, so there is no single
 * command to dry run. Placement does not depend on the word, though, so any valid one answers the
 * question. It is never written: the command is run without a dispatch, which makes it a report.
 */
const PLACEMENT_PROBE_WORD: string = 'NOTE';

/**
 * Reports whether a gallery entry could be applied where the caret is.
 *
 * @purpose Answers the gallery's enabled/disabled question for one entry without changing the document.
 * @inputs id: StyleId - The gallery entry to ask about. state: EditorState - The state the caret is in.
 * @outputs boolean - True when picking the entry would do something, false when it would not.
 * @dataflow id -> probe command (custom callout) or commandForStyle -> dry run against state -> boolean.
 * @controlflow Branch on the custom-callout entry, which has no command of its own -> otherwise dry run its command.
 *
 * Every entry but one is its command, and a command run without a dispatch reports rather than edits.
 * The exception is the custom callout, whose command cannot exist until the user has given a word --
 * so it is asked the only question that does not depend on one: can a callout go here at all.
 */
export function canApplyStyle(id: StyleId, state: EditorState): boolean {
  // Check whether this is the entry that has no command of its own.
  if (id === 'callout-custom') {
    // Custom callout: probe placement with a valid word, which is never written because there is no dispatch.
    return setCalloutWord(PLACEMENT_PROBE_WORD)(state);
  } else {
    // Every other entry: its own command can answer for it.
    return commandForStyle(id)(state);
  }
}
