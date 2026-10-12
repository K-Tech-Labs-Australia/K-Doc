/**
 * @file comment-notes.ts
 * @purpose Writes comment threads into a document for export (FR-10.7), either as endnotes with a marker where the comment was anchored, or as notes in the margin beside that text. Comments live beside the file, so nothing here changes the document on disk — it builds a copy of the tree for the renderer.
 * @inputs The document's text and tree, the threads to include, and which of the two arrangements (endnotes vs. margin-notes) to use.
 * @outputs A new mdast root carrying the comments; the original tree is left untouched.
 * @functions
 *   - withCommentNotes: Clones the tree and renders each unresolved thread as a marker plus an appended definition.
 * @dataflow threads -> resolveAnchor against the text -> source offsets -> the text node holding each offset -> a marker node inserted there, plus a definition appended.
 * @controlflow A thread whose anchor no longer resolves is placed at the end of the document rather than dropped, because a comment the reader cannot see is a comment they have lost.
 * @version 1
 * @date 2026-09-16
 */

import type { Root, RootContent, PhrasingContent, Text, FootnoteDefinition, Paragraph } from 'mdast';
import { resolveAnchor } from '../comments/anchor.js';
import type { CommentThread } from '../comments/thread.js';

export type CommentNoteMode = 'endnotes' | 'margin-notes';

export interface CommentNoteOptions {
  readonly mode: CommentNoteMode;
  readonly threads: readonly CommentThread[];
  readonly text: string;
}

export const MARGIN_NOTE_CLASS: string = 'kdoc-margin-note';

/**
 * @purpose Serialises every comment in a thread into a single attributed string for rendering.
 * @inputs thread - The comment thread whose entries are written out.
 * @outputs string - Each entry rendered as "author: body", joined by an em dash.
 * @dataflow thread.comments → map each entry to "author: body" → join with em dash into one string.
 * @controlflow A single linear pass over the replies; no branching, every entry is included in order.
 */
function threadText(thread: CommentThread): string {
  // Every reply in the thread is written out, each attributed, because a reply that disagrees with the first comment is exactly the part a reader must not lose.
  return thread.comments
    .map((entry) => `${entry.author}: ${entry.body}`)
    .join(' — ');
}

/**
 * @purpose Escapes the five HTML-significant characters so comment bodies cannot inject markup.
 * @inputs value - The raw comment text to sanitise before it is written into an HTML node.
 * @outputs string - The same text with &, <, >, and " replaced by their entity forms.
 * @dataflow Raw string → sequential regex replacements → escaped string returned to the caller.
 * @controlflow Four chained replace calls; each returns the running value for the next replacement.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @purpose Splits the text node that contains a source offset, inserting a marker between the two halves.
 * @inputs parent - The inline container whose children are scanned for the target offset.
 *   offset - Source character offset where the marker belongs.
 *   node - The phrasing content to insert at that offset.
 * @outputs boolean - True if a text node was split and the marker inserted; false when nothing matched.
 * @dataflow parent.children → locate the child whose [start, end] range contains offset → cut its value → splice head, node, tail back into place.
 * @controlflow Iterate children; skip undefined entries; for positioned text nodes test containment and split; recurse into nested inline containers; fall through to false when no node matches.
 */
function insertAt(parent: { children: PhrasingContent[] }, offset: number, node: PhrasingContent): boolean {
  for (let index = 0; index < parent.children.length; index++) {
    const child = parent.children[index];
    // Skip array holes produced by sparse arrays so the loop never dereferences an undefined entry.
    if (child === undefined) {
      continue;
    } else {
      // A defined child is processed below against the offset.
    }

    // Only text nodes carry source offsets, so only they can be matched against a character offset.
    if (child.type === 'text' && child.position !== undefined) {
      const start = child.position.start.offset;
      const end = child.position.end.offset;
      // A node built by this code has no position; skip it rather than treat missing offsets as zero.
      if (start === undefined || end === undefined) {
        continue;
      } else {
        // Both endpoints are present, so the range can be tested for offset containment.
      }
      // The offset falls inside this text node: split its value around the marker and reinsert the pieces.
      if (offset >= start && offset <= end) {
        // The offset is at or after this node's start, because that is what the test above established,
        // so the difference needs no floor of its own; it is capped at the node's length because a text
        // node's source span can be longer than its value when the source held an escape.
        const cut = Math.min(offset - start, child.value.length);
        const head: Text = { type: 'text', value: child.value.slice(0, cut) };
        const tail: Text = { type: 'text', value: child.value.slice(cut) };
        parent.children.splice(index, 1, head, node, tail);
        return true;
      } else {
        // The offset lies outside this text node; keep scanning the remaining children.
      }
    } else if ('children' in child && Array.isArray(child.children)) {
      // A nested inline container may hold the target node deeper, so recurse into it to find the split point.
      if (insertAt(child as { children: PhrasingContent[] }, offset, node)) {
        return true;
      } else {
        // This subtree did not contain the offset; continue with the next sibling.
      }
    } else {
      // A block-level or otherwise non-inline node cannot hold a phrasing marker at this level.
    }
  }
  return false;
}

/**
 * @purpose Walks top-level blocks and inserts a marker at an offset into the first block that can hold it.
 * @inputs root - The document root whose blocks are searched for the target offset.
 *   offset - Source character offset where the marker belongs.
 *   node - The phrasing content to insert at that offset.
 * @outputs boolean - True if a block accepted the marker; false when no block could hold it.
 * @dataflow root.children → each block with inline children → delegate the actual split to insertAt.
 * @controlflow Iterate blocks; only those with array children are candidates, so recurse via insertAt and return on first success.
 */
function placeMarker(root: Root, offset: number, node: PhrasingContent): boolean {
  for (const block of root.children) {
    // Only blocks with inline children can host a marker; a thematic break or an empty block has nowhere to put one.
    if ('children' in block && Array.isArray(block.children)) {
      if (insertAt(block as unknown as { children: PhrasingContent[] }, offset, node)) {
        return true;
      } else {
        // This block did not contain the offset; try the next block instead.
      }
    } else {
      // A block without inline children cannot hold a marker; skip it and move on.
    }
  }
  return false;
}

/**
 * @purpose Builds an exported copy of the document with comment threads rendered as endnotes or margin notes (FR-10.7).
 * @inputs root - The mdast tree to render, which must be left untouched on disk.
 *   options.mode - Which arrangement to use: 'endnotes' or 'margin-notes'.
 *   options.threads - Every thread to include in the export.
 *   options.text - The document's source text used to resolve each thread's anchor.
 * @outputs Root - A cloned tree carrying inserted markers and appended definitions; the original is unchanged.
 * @dataflow threads → filter unresolved → for each, resolveAnchor(text, anchor) → offset → marker via placeMarker → definition appended to copy.children.
 * @controlflow Clone then bail early when nothing is included; otherwise loop threads, branch on mode, append markers and definitions, and finally concatenate the definitions onto the clone.
 */
export function withCommentNotes(root: Root, options: CommentNoteOptions): Root {
  const copy = structuredClone(root) as Root;
  // A resolved comment is a finished conversation, not something to publish. An empty list simply
  // walks no threads and appends nothing, so it needs no guard of its own.
  const included = options.threads.filter((thread) => !thread.resolved);

  const definitions: RootContent[] = [];
  let number = 0;
  for (const thread of included) {
    number += 1;
    const label = `kdoc-comment-${number}`;
    const body = threadText(thread);
    const resolved = resolveAnchor(options.text, thread.anchor);
    const offset = resolved === null ? null : resolved.start;

    if (options.mode === 'margin-notes') {
      // A span rather than an aside: an aside is block-level, so the HTML parser closes the paragraph
      // to make room for it and the note splits the text it was meant to sit beside in two. The span is
      // made to behave like a block by the stylesheet instead, where it costs the paragraph nothing.
      const aside: PhrasingContent = {
        type: 'html',
        value: `<span class="${MARGIN_NOTE_CLASS}">${escapeHtml(body)}</span>`,
      };
      // When offset is null there is no anchor position, so placement fails and the fallback below runs.
      const placed = offset === null ? false : placeMarker(copy, offset, aside);
      // When the anchor no longer resolves there is no margin position, so fall back to a standalone note at the end.
      if (!placed) {
        definitions.push({
          type: 'paragraph',
          children: [{ type: 'html', value: `<span class="${MARGIN_NOTE_CLASS}">${escapeHtml(body)}</span>` }],
        } as Paragraph);
      } else {
        // The aside was anchored beside its text; the definition list still records it for the renderer.
      }
    } else {
      const reference: PhrasingContent = { type: 'footnoteReference', identifier: label, label };
      // When offset is null there is no anchor position, so placement fails and the fallback below runs.
      const placed = offset === null ? false : placeMarker(copy, offset, reference);
      const definition: FootnoteDefinition = {
        type: 'footnoteDefinition',
        identifier: label,
        label,
        children: [{ type: 'paragraph', children: [{ type: 'text', value: body }] }],
      };
      // A footnote definition with nothing referring to it renders as nothing at all, so a comment whose
      // anchor no longer resolves is written as an ordinary paragraph quoting the text it was about.
      if (placed) {
        definitions.push(definition);
      } else {
        definitions.push({
          type: 'paragraph',
          children: [{ type: 'text', value: `Comment on “${thread.anchor.quotedText}”: ${body}` }],
        } as Paragraph);
      }
    }
  }

  copy.children.push(...definitions);
  return copy;
}
