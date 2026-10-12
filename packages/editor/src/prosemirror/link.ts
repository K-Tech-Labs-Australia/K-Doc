/**
 * @file link.ts
 * @purpose Pure ProseMirror range queries and commands for the K-Doc `link` mark, providing
 *   contiguous-range detection (`linkAt`, `activeLink`), applicability testing (`canLink`), and
 *   apply/update/remove command factories (`setLink`, `removeLink`). Every structural transaction is
 *   tagged with the kdocStructural meta so the session opts it out of undo coalescing in ProseMirrorBinding.
 *   These functions operate solely on EditorState and Transaction, requiring no DOM, which enables direct
 *   headless Node testing (a package-wide test asserts that no `document.`/`window.` identifier appears here).
 * @inputs ProseMirror EditorState instances, a document position for `linkAt`, and LinkAttrs target specifications.
 * @outputs LinkRange / LinkRange | null query results, boolean applicability flags, and Command factories.
 * @functions
 *   - linkAt: Returns the contiguous link range covering a document position, or null when none is present.
 *   - activeLink: Returns the link range under the current selection, or null when no link is active.
 *   - canLink: Reports whether a link could currently be applied or edited at the selection.
 *   - setLink: Creates a command applying or updating the link mark on the target range.
 *   - removeLink: Creates a command stripping the link mark from the target range.
 *   (also exports LinkAttrs and LinkRange, value-less interfaces describing link data and ranges.)
 * @dataflow EditorState -> range query / command execution -> LinkRange result or tagged Transaction via dispatch.
 * @controlflow Resolve link MarkType from schema -> locate contiguous equal-mark run -> build/apply transaction with kdocStructural meta.
 * @version 1
 * @date 2026-09-05
 */

import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { Mark, MarkType, Node as ProseMirrorNode } from 'prosemirror-model';
import { trimRange } from './range.js';

/**
 * The attribute set describing a resolved hyperlink: its target URI and optional title.
 */
export interface LinkAttrs {
  readonly href: string;
  readonly title: string | null;
}

/**
 * A contiguous run of the `link` mark spanning document positions [from, to) with resolved attributes.
 */
export interface LinkRange {
  readonly from: number;
  readonly to: number;
  readonly attrs: LinkAttrs;
}

/**
 * @purpose Returns the full contiguous range of the `link` mark covering a document position, or null when none is present.
 * @inputs
 *   - state: EditorState - The current ProseMirror editor state whose schema carries the link mark.
 *   - pos: number - A document position to test for membership in a link run.
 * @outputs LinkRange | null - The contiguous link range covering `pos`, or null when no link is present there.
 * @dataflow Resolves $pos -> finds the marked child at `pos` -> expands left/right over equal marks -> accumulates node sizes into [from, to).
 * @controlflow Resolve MarkType (null if missing) -> require textblock parent (null otherwise) -> resolve boundary index -> find marked child (null if absent) -> expand run -> compute positions -> return range.
 */
export function linkAt(state: EditorState, pos: number): LinkRange | null {
  const $pos = state.doc.resolve(pos);
  // Resolve the document position so we can inspect the parent textblock and its children.

  const type: MarkType | undefined = state.schema.marks['link'];
  // Look up the link mark type; if it is absent from this schema there can be no link range.
  if (type === undefined) {
    // Link mark type missing from schema: cannot report a link range.
    return null;
  } else {
    // Link mark type present: continue resolving children.
  }

  const parent: ProseMirrorNode = $pos.parent;
  // The parent is the node that directly contains the position at `pos`.
  if (!parent.isTextblock) {
    // Parent is not a textblock (e.g. table cell, list item): links live only in textblocks here.
    return null;
  } else {
    // Parent is a textblock: proceed to scan its children for the mark.
  }

  let index = $pos.index();
  // Index of the child containing `pos`; may need adjustment when the caret sits on a boundary.

  if ($pos.textOffset === 0 && index > 0) {
    // Caret sits exactly at the start of child `index`, i.e. on the boundary between children index-1 and index.
    const previousChild: ProseMirrorNode | null = parent.maybeChild(index - 1);
    const currentChild: ProseMirrorNode | null = parent.maybeChild(index);
    // Resolve which boundary candidate actually carries the link mark, guarding both against undefined.
    const previousMark: Mark | undefined =
      previousChild !== null ? type.isInSet(previousChild.marks) : undefined;
    const currentMark: Mark | undefined =
      currentChild !== null ? type.isInSet(currentChild.marks) : undefined;

    // Prefer the child at `index` when it carries the mark; only step back to index-1 if that one does not.
    if (currentMark === undefined && previousMark !== undefined) {
      // Only the previous child carries the link mark: step back so a caret at a link's end still finds it.
      index = index - 1;
    } else {
      // Child at `index` carries the mark, or neither does: leave index unchanged (later guard rejects if wrong).
    }
  } else {
    // Caret is not on a left boundary (textOffset > 0 or index === 0): keep index as-is.
  }

  const child: ProseMirrorNode | null = parent.maybeChild(index);
  // The candidate child node at the resolved index.
  if (child === null || !type.isInSet(child.marks)) {
    // No child at this index, or it carries no link mark: there is no link covering `pos`.
    return null;
  } else {
    // Child exists and carries the link mark: capture it for range expansion.
  }

  const mark: Mark | undefined = type.isInSet(child.marks);
  // The link mark on the child, or undefined if absent; already known present by the guard above.
  if (mark === undefined) {
    // Mark unexpectedly absent despite isInSet check above: treat as no link.
    return null;
  } else {
    // Mark present: expand the run left and right over equal marks.
  }

  let start = index;
  // Leftmost child index of the contiguous equal-mark run.
  while (start > 0) {
    const previousChild: ProseMirrorNode | null = parent.maybeChild(start - 1);
    // The child immediately to the left of the current run start.
    const previousMark: Mark | undefined =
      previousChild === null ? undefined : type.isInSet(previousChild.marks);
    if (previousMark === undefined || !mark.eq(previousMark)) {
      // Previous child is missing or carries a different link mark: stop expanding left.
      break;
    } else {
      // Previous child carries an equal link mark: extend the run one child to the left.
      start -= 1;
    }
  }

  let end = index;
  // Rightmost child index of the contiguous equal-mark run.
  while (end < parent.childCount - 1) {
    const nextChild: ProseMirrorNode | null = parent.maybeChild(end + 1);
    // The child immediately to the right of the current run end.
    const nextMark: Mark | undefined =
      nextChild === null ? undefined : type.isInSet(nextChild.marks);
    if (nextMark === undefined || !mark.eq(nextMark)) {
      // Next child is missing or carries a different link mark: stop expanding right.
      break;
    } else {
      // Next child carries an equal link mark: extend the run one child to the right.
      end += 1;
    }
  }

  let from = $pos.start();
  // Document position at the very start of the parent textblock's content.
  for (let i = 0; i < start; i++) {
    const precedingChild: ProseMirrorNode | null = parent.maybeChild(i);
    // Accumulate the size of every child BEFORE the run — not from the run's own start, which would
    // leave `from` sitting at the block's opening position and strip the wrong characters.
    if (precedingChild !== null) {
      from += precedingChild.nodeSize;
    } else {
      // Missing preceding child: nothing to add.
    }
  }

  let to = from;
  // Document position at the end of the run, built by adding each run child's node size.
  for (let i = start; i <= end; i++) {
    const runChild: ProseMirrorNode | null = parent.maybeChild(i);
    // Add this run child's node size to advance `to` toward the run's end.
    if (runChild !== null) {
      to += runChild.nodeSize;
    } else {
      // Missing run child: skip its contribution.
    }
  }

  const href = typeof mark.attrs.href === 'string' ? mark.attrs.href : '';
  // Narrow the href attribute, which ProseMirror types as `any`, to a string or empty string.
  const title = typeof mark.attrs.title === 'string' ? mark.attrs.title : null;
  // Narrow the title attribute to a string or null, mirroring schema.ts toDOM narrowing.

  return { from, to, attrs: { href, title } };
  // Return the full contiguous link range with its resolved attributes.
}

/**
 * @purpose Returns the link range covering the current selection, or null when no link is active.
 * @inputs state: EditorState - The current ProseMirror editor state.
 * @outputs LinkRange | null - The active link range, or null when no link is under the selection.
 * @dataflow Resolves linkAt at selection.from -> falls back to pos+1 for non-empty selections -> returns first hit or null.
 * @controlflow Query linkAt(from) -> if present return it; else if selection non-empty query linkAt($from.pos + 1 bounded by to); else return null.
 */
export function activeLink(state: EditorState): LinkRange | null {
  const range = linkAt(state, state.selection.from);
  // Query the link range at the start of the selection.
  if (range !== null) {
    // A link covers the selection start: return it directly.
    return range;
  } else {
    // No link at the selection start: fall through to probe just past the cursor below.
  }

  const { $from, to } = state.selection;
  if (!state.selection.empty) {
    // Selection is a non-empty range whose start had no link: try the position just past $from,
    // clamped to the selection end, because a link may begin one character after the cursor.
    const probePos = Math.min($from.pos + 1, to);
    return linkAt(state, probePos);
  } else {
    // Selection is collapsed: no fallback applies, so there is no active link.
    return null;
  }
}

/**
 * @purpose Reports whether a link could currently be applied or edited at the selection.
 * @inputs state: EditorState - The current ProseMirror editor state.
 * @outputs boolean - True if there is a non-empty selection or an active link; false for a plain collapsed caret.
 * @dataflow Tests selection.nonempty OR activeLink(state) !== null -> returns boolean.
 * @controlflow Check selection.empty -> if empty return activeLink !== null; if non-empty return true.
 */
export function canLink(state: EditorState): boolean {
  if (!state.selection.empty) {
    // Selection is a non-empty range: a link can always be applied to it.
    return true;
  } else {
    // Selection is collapsed: a link is only possible when one already exists under the caret.
    return activeLink(state) !== null;
  }
}

/**
 * @purpose Creates a command that applies or updates the link mark on the target range.
 * @inputs attrs: LinkAttrs - The href (required, non-empty after trimming) and optional title for the new link.
 * @outputs Command - A ProseMirror command returning false when it cannot apply, else applying/updating the link.
 * @dataflow Resolve link type -> validate href -> pick target range (active link or selection) -> dry-run or dispatch removeMark+addMark transaction.
 * @controlflow Resolve type (false if missing) -> trim href (false if empty) -> compute range (false if none) -> if dispatch, build tr and tag structural -> return true.
 */
export function setLink(attrs: LinkAttrs): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const type: MarkType | undefined = state.schema.marks['link'];
    // Look up the link mark type; a command over a schema without it cannot apply.
    if (type === undefined) {
      // Link mark type missing from schema: command cannot apply.
      return false;
    } else {
      // Link mark type resolved: proceed to validate and target the range.
    }

    if (attrs.href.trim() === '') {
      // No link target after trimming: a link with no destination is not a link.
      return false;
    } else {
      // Valid non-empty target: proceed to determine the target range.
    }

    const active = activeLink(state);
    // Determine whether a link already exists under the selection so it can be edited in place.
    let from: number;
    let to: number;
    if (active !== null) {
      // An existing link is active: rewrite its full contiguous range (edit-in-place semantics).
      from = active.from;
      to = active.to;
    } else if (!state.selection.empty) {
      // No active link but a non-empty selection: apply the new link across the selected text,
      // trimmed, because a double-click hands us the word plus its trailing space and `[word ](url)`
      // is what that produces verbatim.
      const trimmed = trimRange(state, state.selection.from, state.selection.to);
      from = trimmed.from;
      to = trimmed.to;
    } else {
      // Collapsed caret with no active link: nothing to attach the mark to.
      return false;
    }

    if (dispatch === undefined) {
      // Dry-run: report applicability without building a transaction, per ProseMirror convention.
      return true;
    } else {
      // Real edit requested: build and dispatch the transaction below.
    }

    const tr = state.tr
      .removeMark(from, to, type)
      .addMark(from, to, type.create({ href: attrs.href, title: attrs.title }))
      .setMeta('kdocStructural', true);
    // Remove any existing link first (so updating avoids overlapping marks), then add the new one.

    dispatch(tr);
    return true;
  };
}

/**
 * @purpose Creates a command that strips the link mark from the target range.
 * @inputs void.
 * @outputs Command - A ProseMirror command returning false when it cannot apply, else removing the link mark.
 * @dataflow Resolve link type -> pick target range (active link or selection) -> dry-run or dispatch removeMark transaction.
 * @controlflow Resolve type (false if missing) -> compute range (false if none) -> if dispatch, build tr and tag structural -> return true.
 */
export function removeLink(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const type: MarkType | undefined = state.schema.marks['link'];
    // Look up the link mark type; a command over a schema without it cannot apply.
    if (type === undefined) {
      // Link mark type missing from schema: command cannot apply.
      return false;
    } else {
      // Link mark type resolved: proceed to determine the target range.
    }

    const active = activeLink(state);
    let from: number;
    let to: number;
    if (active !== null) {
      // An existing link is active: strip it across its full contiguous range.
      from = active.from;
      to = active.to;
    } else if (!state.selection.empty) {
      // No active link but a non-empty selection: remove any link marks within the selection.
      from = state.selection.from;
      to = state.selection.to;
    } else {
      // Collapsed caret with no active link: nothing to strip.
      return false;
    }

    if (dispatch === undefined) {
      // Dry-run: report applicability without building a transaction, per ProseMirror convention.
      return true;
    } else {
      // Real edit requested: build and dispatch the transaction below.
    }

    const tr = state.tr.removeMark(from, to, type).setMeta('kdocStructural', true);
    // Remove the link mark across the target range and tag the transaction structural.
    dispatch(tr);
    return true;
  };
}
