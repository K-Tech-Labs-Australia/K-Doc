/**
 * @file structure.ts
 * @purpose Pure ProseMirror editing commands for block movement (FR-8.27) and heading level changes (FR-8.28), operating without DOM dependencies.
 *   Every structural command tags its transaction with the kdocStructural meta to opt the edit out of undo coalescing in ProseMirrorBinding.
 *   These commands are pure functions over EditorState and Transaction, requiring no DOM, enabling direct headless Node testing.
 * @inputs ProseMirror EditorState instances, optional dispatch callbacks, and transaction metadata.
 * @outputs TopBlock descriptor records, heading level numbers, and ProseMirror Command functions returning boolean applicability.
 * @functions
 *   - topBlockAt: Resolves the top-level block node containing the selection caret, operating strictly at the document root.
 *   - moveBlockUp: Creates a command swapping the caret's top-level block with its preceding sibling.
 *   - moveBlockDown: Creates a command swapping the caret's top-level block with its following sibling.
 *   - headingLevelAt: Returns the 1..6 level of the top-level heading enclosing the caret, or null if not in a heading.
 *   - promoteHeading: Creates a command promoting the active heading to a higher importance level (H3 -> H2).
 *   - demoteHeading: Creates a command demoting the active heading to a lower importance level (H2 -> H3).
 * @dataflow EditorState -> topBlockAt / headingLevelAt queries -> Transaction mutation with kdocStructural meta -> dispatch callback.
 * @controlflow Guard caret position and document boundaries -> verify applicability -> apply structural transform or attribute update -> dispatch tagged transaction.
 * @version 1
 * @date 2026-09-05
 */

import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';

export interface TopBlock {
  readonly index: number;
  readonly node: ProseMirrorNode;
  /** Position immediately before the block. */
  readonly pos: number;
}

/**
 * Finds the top-level block containing the caret — the direct child of the document.
 *
 * @purpose Resolves the top-level block node containing the selection caret, operating strictly at the document root.
 *   This deliberately works at the top level only. Moving a nested list item is a different operation with
 *   different rules — it has to stay inside its list and carry its children — and conflating the two into one
 *   command would produce something that behaves differently depending on where the caret happens to be.
 *   Nested list-item movement is therefore not implemented here.
 * @inputs state: EditorState - The current ProseMirror editor state.
 * @outputs TopBlock | null - Object containing the top-level block's index, ProseMirror node, and document start position, or null if selection is on doc.
 * @dataflow state.selection.$from -> resolve depth 0 index -> doc.child(index) -> { index, node, pos }.
 * @controlflow Check if $from.depth === 0 (return null if selection is on doc) -> guard doc child index bounds -> compute pos via $from.before(1) -> return TopBlock record.
 */
export function topBlockAt(state: EditorState): TopBlock | null {
  const { $from } = state.selection;

  // Check if the selection is at depth 0, which means it rests directly on the document node itself.
  if ($from.depth === 0) {
    // Selection is on the root doc node with no enclosing child block: return null.
    return null;
  } else {
    // Selection is inside at least one enclosing node (depth >= 1): resolve the top-level child.
  }

  // Moving a nested list item is a different operation with different rules — it has to stay inside its list
  // and carry its children — and conflating the two into one command would produce something that behaves differently
  // depending on where the caret happens to be. Nested list-item movement is therefore not implemented here; this
  // deliberately works at the top level only.
  const index = $from.index(0);

  // Check if the resolved top-level child index is within valid bounds of the document's children.
  if (index < 0 || index >= state.doc.childCount) {
    // Child index is out of bounds: return null to guard against out-of-range child access.
    return null;
  } else {
    // Child index is within valid range [0, doc.childCount - 1]: proceed to retrieve the node.
  }

  const node = state.doc.child(index);
  const pos = $from.before(1);

  return { index, node, pos };
}

/**
 * Creates a command that swaps the caret's top-level block with its previous sibling.
 *
 * @purpose Swaps the caret's top-level block with its preceding sibling in the document (FR-8.27).
 * @inputs void.
 * @outputs Command - A ProseMirror command returning false when unable to move up, or dispatching a structural transaction on success.
 * @dataflow state -> topBlockAt -> resolve preceding sibling -> tr.delete + tr.insert -> TextSelection.near -> dispatch(tr).
 * @controlflow Guard top block exists -> guard block is not first child (index === 0) -> guard sibling index -> dry-run check -> delete block and insert before sibling -> restore caret inside moved block -> tag kdocStructural -> dispatch.
 */
export function moveBlockUp(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const block = topBlockAt(state);

    // Check if the caret is currently inside a valid top-level block.
    if (block === null) {
      // Not inside a top-level block: command cannot apply.
      return false;
    } else {
      // Top-level block resolved: proceed to check boundary conditions.
    }

    // Check if the block is already the first child in the document.
    // Refusing at the boundary is right: silently doing nothing at the top of a document
    // is the correct response to "move this up".
    if (block.index === 0) {
      // Block is already at the very top of the document: cannot move further up.
      return false;
    } else {
      // Block has a preceding sibling: proceed to resolve the sibling node.
    }

    const siblingIndex = block.index - 1;

    // Check if preceding sibling index is within valid bounds of doc.childCount.
    if (siblingIndex < 0 || siblingIndex >= state.doc.childCount) {
      // Sibling index out of bounds: command cannot apply.
      return false;
    } else {
      // Sibling index is valid: retrieve preceding sibling node safely.
    }

    const sibling = state.doc.child(siblingIndex);

    // Compute the insert position before the delete.
    // The arithmetic holds because the delete removes content entirely after the target position
    // in the up case (and entirely before it in the down case), so in both directions the sibling's
    // size is the exact offset the block travels.
    const insertPos = block.pos - sibling.nodeSize;

    // Check if dispatch callback was provided by caller.
    if (dispatch !== undefined) {
      const tr = state.tr;
      // Delete the block from its current location.
      tr.delete(block.pos, block.pos + block.node.nodeSize);
      // Re-insert the block on the other side of its sibling.
      tr.insert(insertPos, block.node);

      // Restore the caret inside the moved block, at its new position plus one, via TextSelection.near.
      // A move which drops the caret somewhere else makes repeated Alt+Up impossible, which is how
      // the command is actually used.
      tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)));

      // Tag structural transaction to opt out of undo coalescing.
      tr.setMeta('kdocStructural', true);

      // Dispatch the structural transaction.
      dispatch(tr);
    } else {
      // Dry-run query: return true indicating moveBlockUp can apply to this block.
    }

    return true;
  };
}

/**
 * Creates a command that swaps the caret's top-level block with its next sibling.
 *
 * @purpose Swaps the caret's top-level block with its following sibling in the document (FR-8.27).
 * @inputs void.
 * @outputs Command - A ProseMirror command returning false when unable to move down, or dispatching a structural transaction on success.
 * @dataflow state -> topBlockAt -> resolve following sibling -> tr.delete + tr.insert -> TextSelection.near -> dispatch(tr).
 * @controlflow Guard top block exists -> guard block is not last child (index === childCount - 1) -> guard sibling index -> dry-run check -> delete block and insert after sibling -> restore caret inside moved block -> tag kdocStructural -> dispatch.
 */
export function moveBlockDown(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const block = topBlockAt(state);

    // Check if the caret is currently inside a valid top-level block.
    if (block === null) {
      // Not inside a top-level block: command cannot apply.
      return false;
    } else {
      // Top-level block resolved: proceed to check boundary conditions.
    }

    // Check if the block is already the last child in the document.
    // Refusing at the boundary is right: silently doing nothing at the bottom of a document
    // is the correct response to "move this down".
    if (block.index === state.doc.childCount - 1) {
      // Block is already at the very bottom of the document: cannot move further down.
      return false;
    } else {
      // Block has a following sibling: proceed to resolve the sibling node.
    }

    const siblingIndex = block.index + 1;

    // Check if following sibling index is within valid bounds of doc.childCount.
    if (siblingIndex < 0 || siblingIndex >= state.doc.childCount) {
      // Sibling index out of bounds: command cannot apply.
      return false;
    } else {
      // Sibling index is valid: retrieve following sibling node safely.
    }

    const sibling = state.doc.child(siblingIndex);

    // Compute the insert position before the delete.
    // The arithmetic holds because the delete removes content entirely before the target position
    // in the down case (and entirely after it in the up case), so in both directions the sibling's
    // size is the exact offset the block travels.
    const insertPos = block.pos + sibling.nodeSize;

    // Check if dispatch callback was provided by caller.
    if (dispatch !== undefined) {
      const tr = state.tr;
      // Delete the block from its current location.
      tr.delete(block.pos, block.pos + block.node.nodeSize);
      // Re-insert the block on the other side of its sibling.
      tr.insert(insertPos, block.node);

      // Restore the caret inside the moved block, at its new position plus one, via TextSelection.near.
      // A move which drops the caret somewhere else makes repeated Alt+Down impossible, which is how
      // the command is actually used.
      tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)));

      // Tag structural transaction to opt out of undo coalescing.
      tr.setMeta('kdocStructural', true);

      // Dispatch the structural transaction.
      dispatch(tr);
    } else {
      // Dry-run query: return true indicating moveBlockDown can apply to this block.
    }

    return true;
  };
}

/**
 * Returns the level of the heading the caret is in, or null when it is not in a heading.
 *
 * @purpose Resolves the 1..6 level of the top-level heading block containing the caret, or null if not in a heading.
 * @inputs state: EditorState - The current ProseMirror editor state.
 * @outputs number | null - The numeric heading level in range 1..6, or null if not in a valid heading.
 * @dataflow state -> topBlockAt -> check node.type.name === 'heading' -> read and validate node.attrs['level'] -> number | null.
 * @controlflow Resolve top block (return null if null) -> check node type is 'heading' (return null if not) -> validate level attr is integer in 1..6 (return null if malformed) -> return level.
 */
export function headingLevelAt(state: EditorState): number | null {
  const block = topBlockAt(state);

  // Check if a top-level block exists at the current selection.
  if (block === null) {
    // No top-level block found: selection is not inside a heading.
    return null;
  } else {
    // Top-level block found: verify if its node type is a heading.
  }

  // Check if the top-level block is a heading node type.
  if (block.node.type.name !== 'heading') {
    // Block is not a heading: return null.
    return null;
  } else {
    // Block is a heading: inspect the level attribute.
  }

  const rawLevel: unknown = block.node.attrs['level'];

  // Check if the level attribute is a valid integer between 1 and 6.
  // Attributes are loosely typed in ProseMirror, so a malformed or out-of-range level
  // should read as "not a heading I can change" rather than throwing.
  if (typeof rawLevel === 'number' && Number.isInteger(rawLevel) && rawLevel >= 1 && rawLevel <= 6) {
    // Attribute is a valid integer heading level 1..6: return the level.
    return rawLevel;
  } else {
    // Attribute is missing, not a number, or outside 1..6: return null rather than throwing.
    return null;
  }
}

/**
 * Creates a command that promotes the active heading to a higher importance level (H3 -> H2).
 *
 * @purpose Promotes the heading containing the caret by decrementing its level (FR-8.28).
 *   Promote makes the heading more important: level goes down (H3 -> H2).
 *   Do not carry the subtree. FR-8.28 calls that optional; it is not implemented here,
 *   and doing it would mean re-levelling every heading until the next one of equal or greater
 *   importance — a different command with a different undo story.
 * @inputs void.
 * @outputs Command - A ProseMirror command returning false when unable to promote, or updating heading level on dispatch.
 * @dataflow state -> headingLevelAt -> compute next level (currentLevel - 1) -> tr.setNodeMarkup -> dispatch(tr).
 * @controlflow Resolve heading level (return false if null) -> check level > 1 (return false if H1) -> resolve top block -> dry-run check -> setNodeMarkup with decremented level -> tag kdocStructural -> dispatch.
 */
export function promoteHeading(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const currentLevel = headingLevelAt(state);

    // Check if the selection is currently within a valid heading.
    if (currentLevel === null) {
      // Not inside a valid heading: promoteHeading cannot apply.
      return false;
    } else {
      // Inside a valid heading: proceed to check if already at maximum heading importance.
    }

    // Check if the heading is already at level 1 (H1).
    // Promote makes the heading more important: level goes down (H3 -> H2).
    // Comment this explicitly, because "promote" moving a number downwards is exactly
    // the kind of thing that gets inverted by a well-meaning later edit.
    if (currentLevel <= 1) {
      // Already at top-level H1: cannot promote further.
      return false;
    } else {
      // Heading level is > 1: promotion is possible.
    }

    const block = topBlockAt(state);

    // Check if top block is resolved to satisfy strict safety.
    if (block === null) {
      // Defensive guard: block could not be resolved: command cannot apply.
      return false;
    } else {
      // Block resolved: proceed to apply promotion.
    }

    // Promote makes the heading more important: level goes down (H3 -> H2).
    // Note: Do not carry the subtree. FR-8.28 calls that optional; it is not implemented here,
    // and doing it would mean re-levelling every heading until the next one of equal or greater
    // importance — a different command with a different undo story.
    const next = currentLevel - 1;

    // Check if dispatch callback was provided by caller.
    if (dispatch !== undefined) {
      const tr = state.tr;
      tr.setNodeMarkup(block.pos, undefined, { ...block.node.attrs, level: next });
      tr.setMeta('kdocStructural', true);
      dispatch(tr);
    } else {
      // Dry-run query: return true indicating promoteHeading can apply.
    }

    return true;
  };
}

/**
 * Creates a command that demotes the active heading to a lower importance level (H2 -> H3).
 *
 * @purpose Demotes the heading containing the caret by incrementing its level (FR-8.28).
 *   Demote makes the heading less important: level goes up (H2 -> H3).
 *   Do not carry the subtree. FR-8.28 calls that optional; it is not implemented here,
 *   and doing it would mean re-levelling every heading until the next one of equal or greater
 *   importance — a different command with a different undo story.
 * @inputs void.
 * @outputs Command - A ProseMirror command returning false when unable to demote, or updating heading level on dispatch.
 * @dataflow state -> headingLevelAt -> compute next level (currentLevel + 1) -> tr.setNodeMarkup -> dispatch(tr).
 * @controlflow Resolve heading level (return false if null) -> check level < 6 (return false if H6) -> resolve top block -> dry-run check -> setNodeMarkup with incremented level -> tag kdocStructural -> dispatch.
 */
export function demoteHeading(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const currentLevel = headingLevelAt(state);

    // Check if the selection is currently within a valid heading.
    if (currentLevel === null) {
      // Not inside a valid heading: demoteHeading cannot apply.
      return false;
    } else {
      // Inside a valid heading: proceed to check if already at minimum heading importance.
    }

    // Check if the heading is already at level 6 (H6).
    // Demote makes the heading less important: level goes up (H2 -> H3).
    // Comment this explicitly, because "promote" moving a number downwards is exactly
    // the kind of thing that gets inverted by a well-meaning later edit.
    if (currentLevel >= 6) {
      // Already at lowest-level H6: cannot demote further.
      return false;
    } else {
      // Heading level is < 6: demotion is possible.
    }

    const block = topBlockAt(state);

    // Check if top block is resolved to satisfy strict safety.
    if (block === null) {
      // Defensive guard: block could not be resolved: command cannot apply.
      return false;
    } else {
      // Block resolved: proceed to apply demotion.
    }

    // Demote makes the heading less important: level goes up (H2 -> H3).
    // Note: Do not carry the subtree. FR-8.28 calls that optional; it is not implemented here,
    // and doing it would mean re-levelling every heading until the next one of equal or greater
    // importance — a different command with a different undo story.
    const next = currentLevel + 1;

    // Check if dispatch callback was provided by caller.
    if (dispatch !== undefined) {
      const tr = state.tr;
      tr.setNodeMarkup(block.pos, undefined, { ...block.node.attrs, level: next });
      tr.setMeta('kdocStructural', true);
      dispatch(tr);
    } else {
      // Dry-run query: return true indicating demoteHeading can apply.
    }

    return true;
  };
}
