/**
 * @file comment-note-plugin.ts
 * @purpose ProseMirror decoration layer that renders a comment's text inline in the WYSIWYG pane, for FR-10.4's inline display mode. Each note is drawn as a widget decoration because its text does not live in the document — a widget is the only decoration capable of rendering characters the file does not contain, using the same reasoning the tracked-change deletion widget rests on.
 *   Manages comment-note decorations: rebuilding them from planned note positions on each plan arrival and mapping them across ordinary edits so a note stays beside its text while the user types.
 * @inputs ProseMirror transactions (carrying CommentNoteMeta with document positions), EditorState instances, an EditorView for dispatching updates, and arrays of mapped document note points.
 * @outputs ProseMirror Plugin instance carrying a DecorationSet, the CSS class name 'kdoc-comment-note', the inline-note stylesheet COMMENT_NOTE_STYLES, and the commentNotePluginKey identifying its state.
 * @functions
 *   - createCommentNotePlugin: Instantiates the ProseMirror plugin managing inline comment-note decorations.
 *   - setCommentNotes: Attaches updated note metadata to a transaction's metadata under commentNotePluginKey for dispatch by the caller's view.
 *   - buildNotes: Constructs one widget decoration per planned note (module-private, not exported).
 *   - noteDom: Builds the DOM node that renders a single inline note (module-private, not exported).
 * @dataflow Transaction meta (CommentNoteMeta.notes[]) -> plugin apply handler rebuilds via buildNotes; otherwise maps existing set across tr.mapping -> props.decorations returns the DecorationSet.
 * @controlflow Initialize empty DecorationSet -> apply receives transaction: rebuild when CommentNoteMeta present, map otherwise -> readers read decorations from plugin state.
 * @notes This is a deliberately separate plugin rather than an extra decoration inside another plugin. The note's text is not part of the document, so it cannot be represented as a mark or node decoration — only a widget can render characters absent from the file. Keeping this its own plugin isolates that one job and keeps each plugin's metadata contract narrow.
 * @notes Positions are document positions, not source offsets: the shell has already mapped each note's offset through the offset mapper before calling setCommentNotes. This plugin performs no remapping of its own — it only draws at the given position. Passing raw source offsets would paint notes at meaningless coordinates.
 * @version 1
 * @date 2026-09-11
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

/**
 * Plugin key uniquely identifying the comment-note plugin and its state in an EditorState.
 */
export const commentNotePluginKey: PluginKey<DecorationSet> = new PluginKey<DecorationSet>('commentNote');

/**
 * Base CSS class name applied to inline comment-note widget decorations (FR-10.4).
 */
export const PM_COMMENT_NOTE_CLASS: string = 'kdoc-comment-note';

/**
 * Inline stylesheet for comment-note widgets, matching the Source pane's note styling.
 * `user-select: none` keeps the note out of a selection the reader makes over the text it annotates — copying a paragraph must not copy the commentary on it.
 */
export const COMMENT_NOTE_STYLES: string = `
.kdoc-comment-note {
  margin-left: 0.5em;
  padding: 0 0.35em;
  border-radius: 3px;
  font-size: 0.85em;
  background: color-mix(in srgb, var(--kdoc-color-accent, #0969da) 12%, transparent);
  color: var(--kdoc-color-text-muted, #57606a);
  white-space: nowrap;
  user-select: none;
}
`;

/**
 * A single comment note to be drawn inline in the WYSIWYG pane (FR-10.4).
 */
export interface CommentNotePoint {
  /** Identifier of the thread this note belongs to, used as the decoration's stable key. */
  readonly threadId: string;
  /** Document position the note is drawn after. */
  readonly pos: number;
  /** Display name of the note's author. */
  readonly author: string;
  /** Free-text body of the note, rendered verbatim (never parsed as markup). */
  readonly body: string;
}

/**
 * Metadata carried on a transaction's plugin slot requesting a rebuild of the inline comment notes.
 */
export interface CommentNoteMeta {
  /** Document positions, already mapped by the caller, one per planned note. */
  readonly notes: readonly CommentNotePoint[];
}

/**
 * Creates the ProseMirror plugin that manages and renders inline comment notes (FR-10.4).
 *
 * @purpose Instantiates the ProseMirror plugin responsible for painting resolved-comment text inline, rebuilding it from planned note positions on each plan arrival, and mapping it across ordinary edits so a note stays beside its text while typing.
 * @inputs None.
 * @outputs Plugin<DecorationSet> - Configured ProseMirror Plugin whose state is directly the DecorationSet of active inline notes.
 * @dataflow Transactions -> apply() state handler -> DecorationSet -> props.decorations returns it to the view.
 * @controlflow Configure Plugin with commentNotePluginKey -> state field handles init (empty set) and apply (rebuild on meta, map otherwise) -> props exports decorations from plugin state.
 */
export function createCommentNotePlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: commentNotePluginKey,
    state: {
      init(): DecorationSet {
        // Initial editor state begins with no inline notes painted.
        return DecorationSet.empty;
      },
      apply(tr: Transaction, value: DecorationSet, _oldState: EditorState, newState: EditorState): DecorationSet {
        // Read the plan's note metadata off this transaction; undefined means "no new plan arrived".
        const meta = tr.getMeta(commentNotePluginKey) as CommentNoteMeta | undefined;

        // Case 1: a comment-note plan arrived on this transaction -> rebuild notes against the current document.
        if (meta !== undefined) {
          // Rebuild so each note is re-laid-out over the possibly-changed document from the freshly mapped positions.
          return buildNotes(newState, meta.notes);
        } else {
          // No new plan: map existing notes across this transaction's changes via tr.mapping.
          // Mapping rather than clearing keeps a note beside its text while the user types, since a re-plan only arrives on a debounce.
          return value.map(tr.mapping, tr.doc);
        }
      },
    },
    props: {
      decorations(state: EditorState): DecorationSet {
        const pluginState = commentNotePluginKey.getState(state);
        // Return the stored note set when present; fall back to an empty set if the plugin is absent from this state.
        return pluginState ?? DecorationSet.empty;
      },
    },
  });
}

/**
 * Constructs one widget decoration per planned comment note (FR-10.4).
 *
 * @purpose Maps each mapped document position to a widget decoration that renders the note's text after its annotated text, guarding every out-of-range or undefined read so a stale plan cannot throw.
 * @inputs
 *   - state: EditorState - The editor state whose document positions are resolved against; must reflect the current document so clamping is meaningful.
 *   - notes: readonly CommentNotePoint[] - Document note points (already mapped by the caller), one per planned note.
 * @outputs DecorationSet - A set of widget decorations, one per valid note, each rendering a span tagged with PM_COMMENT_NOTE_CLASS.
 * @dataflow notes -> guard undefined slot -> clamp to doc bounds -> build DOM via noteDom -> Decoration.widget per note -> DecorationSet.create(doc, ...).
 * @controlflow Iterate notes -> skip undefined slots -> clamp pos -> push widget decoration -> return created set.
 */
function buildNotes(state: EditorState, notes: readonly CommentNotePoint[]): DecorationSet {
  const decorations: Decoration[] = [];

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    // Guard against an out-of-range index under strict noUncheckedIndexedAccess: skip any undefined element.
    if (note === undefined) {
      // Undefined note slot: skip iteration.
      continue;
    } else {
      // Defined note slot: proceed to clamp its position and build its widget.
    }

    // Clamp the plan's document position into current document bounds [0, size] — a plan computed a moment ago can outrun the document, and a widget placed past the end throws inside ProseMirror. The lower bound is 0 here (not 1): a widget at the very start of the document is valid, so no note is silently dropped by forcing a minimum of 1.
    const clamped = Math.min(Math.max(note.pos, 0), state.doc.content.size);

    // Build the note's DOM via the factory closure; Decoration.widget defers its creation until ProseMirror needs it and caches it under the note's stable key (note.threadId).
    decorations.push(Decoration.widget(clamped, () => noteDom(note), { side: 1, key: note.threadId }));
  }

  return DecorationSet.create(state.doc, decorations);
}

/**
 * Builds the DOM node that renders a single inline comment note (FR-10.4).
 *
 * @purpose Constructs a self-contained <span> carrying the author and body text of one note, tagged for styling and thread lookup but hidden from selection and screen readers.
 * @inputs
 *   - note: CommentNotePoint - The note whose author, body, and thread id are rendered into the node.
 * @outputs HTMLElement - A detached <span> with class PM_COMMENT_NOTE_CLASS, textContent `${note.author}: ${note.body}`, data-thread-id set to note.threadId, and aria-hidden true.
 * @dataflow note.author + note.body -> span.textContent (verbatim) -> attributes applied -> returned node handed back to Decoration.widget's factory.
 * @controlflow Create span -> assign class -> set textContent verbatim -> attach data-thread-id and aria-hidden -> return node with no branching.
 */
function noteDom(note: CommentNotePoint): HTMLElement {
  const el = document.createElement('span');
  // Apply the shared inline-note styling via the exported class name so the widget matches COMMENT_NOTE_STYLES.
  el.className = PM_COMMENT_NOTE_CLASS;
  // textContent (not innerHTML) is used deliberately: note.body is arbitrary user text that must never be parsed as markup, which also prevents any injected HTML from executing.
  el.textContent = `${note.author}: ${note.body}`;
  // Tag the node with its thread id so a host can locate the originating thread without parsing visible text.
  el.setAttribute('data-thread-id', note.threadId);
  // aria-hidden keeps a screen reader from announcing the comment twice: the pane already reads it out, so the inline widget must be invisible to assistive tech.
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/**
 * Attaches updated comment-note metadata to a transaction's metadata under commentNotePluginKey for the caller's view to dispatch.
 *
 * @purpose Encapsulates metadata assignment so callers do not manipulate the plugin key or CommentNoteMeta shape directly, and guarantees the update rides on its own transaction (triggering an apply rebuild).
 * @inputs
 *   - view: EditorView - The live ProseMirror view whose state is dispatched.
 *   - meta: CommentNoteMeta - Document note points, already mapped by the caller, one per planned note.
 * @outputs void - No return value; the transaction is dispatched on the provided view as a side effect.
 * @dataflow meta -> tr.setMeta(commentNotePluginKey, meta) -> view.dispatch triggers apply rebuild.
 * @controlflow Wrap meta in a fresh transaction via view.state.tr -> dispatch to update editor state.
 */
export function setCommentNotes(view: EditorView, meta: CommentNoteMeta): void {
  // Dispatching on its own transaction carries the meta so apply() rebuilds the notes; a plain read would never paint anything.
  view.dispatch(view.state.tr.setMeta(commentNotePluginKey, meta));
}
