/**
 * @file comment-notes.ts
 * @purpose Shows a comment's text inline in the K-Doc Source pane (FR-10.4): a state field holding a DecorationSet of inline note widgets, an effect that replaces it with a freshly computed set of notes, and the theme rules that style them. Margin mode puts the comment in a column at the edge — the default and what a reviewer usually wants — while inline puts the text where the comment is about, which is what someone reading a document rather than reviewing it wants; the two answer different questions and the toggle exists because neither is right for both. This file implements only inline.
 * @inputs setCommentNotesEffect carries readonly CommentNote[] (threadId, source offset drawn after the commented range, author, body); EditorView when dispatching; document length derived at build time to drop stale or out-of-range notes.
 * @outputs a DecorationSet of inline note widgets on editor state, one CSS class constant consumed by the theme, and extensions embeddable in the Source pane's extension list.
 * @functions
 *   - setCommentNotesEffect: StateEffect replacing the current note set with a freshly computed one.
 *   - commentNotesField: StateField holding the DecorationSet of inline note widgets across editor transactions.
 *   - buildNotes: Assembles a DecorationSet from validated notes for a document length (module-level helper).
 *   - NoteWidget: WidgetType rendering a comment's text that does not live in the document as an out-of-document widget.
 *   - commentNotes: Extension composing just the state field for embedding in a pane's extension list.
 *   - commentNoteTheme: Extension providing CSS rules styling inline notes to read as annotations about the text.
 *   - setCommentNotesIn: Dispatches the note effect on behalf of callers who need not know about it.
 * @dataflow plan source offsets -> setCommentNotesEffect.of(notes) -> commentNotesField rebuilds DecorationSet via buildNotes -> EditorView.decorations reads it and paints each note as an out-of-document widget after its commented range.
 * @controlflow create returns an empty set; update replaces the set on a note effect (the fresh notes win, no merge) or maps changes otherwise so typed edits keep ranges steady until the next set arrives — briefly approximate beats briefly absent. Every note paints as a widget because its text is not in the document and must never become part of it.
 * @note Margin mode puts the comment in a column at the edge (the default, what a reviewer wants) while inline puts the text where the comment is about (what a reader wants); this file implements only inline. The note is a widget, not a mark: its text is not in the document and the document must not acquire it, so a widget — the only decoration that can draw characters the file does not contain — is used rather than a mark.
 * @version 1
 * @date 2026-09-11
 */

import { StateEffect, StateField } from '@codemirror/state';
import type { Extension, Transaction } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';

/** One comment rendered inline, drawn after the range it annotates (FR-10.4). */
export interface CommentNote {
  readonly threadId: string;
  /** Source offset the note is drawn after -- the end of the commented range. */
  readonly offset: number;
  readonly author: string;
  readonly body: string;
}

/** The CSS class applied to every inline comment-note widget in the Source pane (FR-10.4). */
export const CM_COMMENT_NOTE_CLASS: string = 'kdoc-cm-comment-note';

/**
 * @purpose Carries a freshly computed CommentNote[] into editor state so the note field can rebuild its DecorationSet from scratch (FR-10.4).
 * @inputs notes - the authoritative set of inline notes to show, each with a source offset drawn after its commented range.
 * @outputs A StateEffect instance whose payload is readonly CommentNote[].
 * @dataflow Caller builds notes -> setCommentNotesEffect.of(notes) produces an effect applied inside a dispatch's effects array.
 * @controlflow Pure definition with no branching; the effect only takes meaning when commentNotesField.update inspects tr.effects for it below.
 */
export const setCommentNotesEffect = StateEffect.define<readonly CommentNote[]>();

/**
 * @purpose Holds the DecorationSet of inline note widgets and keeps it in sync with editor transactions (FR-10.4).
 * @inputs create receives a fresh EditorState; update receives the previous set plus each applied Transaction, including note effects.
 * @outputs A DecorationSet: empty on creation, rebuilt from an incoming notes effect, or change-mapped for ordinary edits.
 * @dataflow StateEffect payload notes -> buildNotes(notes, docLength) produces a DecorationSet -> EditorView.decorations reads it to paint each note as an out-of-document widget.
 * @controlflow On create return the empty set; on update branch: a notes effect triggers an authoritative rebuild (the fresh notes win over any stale annotation), every other transaction maps its changes over the existing set so typed edits keep ranges steady until the next set arrives again.
 */
export const commentNotesField = StateField.define<DecorationSet>({
  create(): DecorationSet {
    return Decoration.none;
  },

  update(value: DecorationSet, tr: Transaction): DecorationSet {
    for (const effect of tr.effects) {
      if (effect.is(setCommentNotesEffect)) {
        // Branch: a fresh set of notes arrived — rebuild from scratch rather than merge, because the new set is a complete statement of what to show and any note left over from the previous set would otherwise linger as a stale annotation.
        return buildNotes(effect.value, tr.state.doc.length);
      } else {
        // Branch: some other effect. Keep scanning rather than returning here: a transaction can carry several effects, and returning on the first non-matching one would let a note effect behind it go unseen — the notes would be dropped silently and stop updating.
      }
    }

    // No note effect in this transaction: map the existing widgets across its changes so an inline note stays put while the user types, since the authoritative re-set only arrives on demand.
    return value.map(tr.changes);
  },

  provide: (field) => EditorView.decorations.from(field),
});

/**
 * @purpose Assembles a DecorationSet of inline note widgets from validated notes for a document of `docLength` (FR-10.4).
 * @inputs notes - the source-offset positions at which to draw each comment's text; docLength - the current document length used to drop stale or out-of-range notes.
 * @outputs A finished DecorationSet whose widgets render each note's text after its commented range as an out-of-document widget.
 * @dataflow Each note -> validated against bounds -> a widget drawn at its offset appended to a range array -> Decoration.set(ranges, true) sorts and yields the set.
 * @controlflow Drop notes whose offset lies outside the document (the plan was computed from a snapshot and the document can have moved on), then place each widget after its commented text with side 1; Decoration.set sorts rather than RangeSetBuilder so shared offsets never throw.
 */
function buildNotes(notes: readonly CommentNote[], docLength: number): DecorationSet {
  // Collect one widget per in-range note; a plan is computed from a snapshot taken a moment ago, so its offsets can outrun the current document and must be dropped rather than clamped.
  const ranges = notes.flatMap((note) => {
    if (note.offset < 0 || note.offset > docLength) {
      // Branch: this note's offset lies outside the current document — either before offset 0 or past its end — so drop it rather than clamp, because the plan was computed from an earlier snapshot and clamping would paint a note over characters that never belonged to it.
      return [];
    } else {
      // In range: collect a widget drawn after the commented range. side: 1 places the note *after* the commented text — side decides which way a decoration falls when something else sits at the same offset (FR-10.4).
      return [Decoration.widget({ widget: new NoteWidget(note.author, note.body), side: 1 }).range(note.offset)];
    }
  });

  // Decoration.set(ranges, true) sorts for us rather than hand-sorting: two notes can share an offset and RangeSetBuilder would throw on that ordering while Decoration.set resolves it.
  return Decoration.set(ranges, true);
}

/**
 * @purpose Stores a comment's author and body for inline rendering as a widget (FR-10.4).
 * @inputs author - the comment's author, shown before the body in the widget text.
 * @inputs body - the comment text to display inline.
 * @outputs void — fields are stored on the instance via constructor parameter properties.
 * @dataflow Caller-provided author and body -> stored as readonly instance fields consumed by toDOM.
 * @controlflow Pure storage with no branching; super() initialises WidgetType before the parameter properties are assigned.
 */
class NoteWidget extends WidgetType {
  constructor(
    private readonly author: string,
    private readonly body: string,
  ) {
    super();
  }

  /**
   * @purpose Reports whether another note is identical so CodeMirror can reuse its rendered node (FR-10.4).
   * @inputs other - the widget CodeMirror is comparing against for equality.
   * @outputs true when both author and body match, false otherwise.
   * @dataflow Compares this.author/this.body to other's fields; no transformation.
   * @controlflow Single conjunction of two field comparisons with no branching — two notes with the same text are interchangeable, so a correct eq keeps the node across redraws instead of rebuilding it on every render.
   */
  override eq(other: NoteWidget): boolean {
    return this.author === other.author && this.body === other.body;
  }

  /**
   * @purpose Builds the DOM node that renders the comment's text inline (FR-10.4).
   * @inputs void — author and body are read from this instance's stored fields.
   * @outputs An HTMLElement span carrying CM_COMMENT_NOTE_CLASS, the note text in textContent, and aria-hidden so it is not double-announced.
   * @dataflow Stored author and body -> a span whose className comes from CM_COMMENT_NOTE_CLASS and whose textContent is `${author}: ${body}` -> returned to CodeMirror for insertion into the editor.
   * @controlflow Pure construction with no branching; creates a span, styles it via class, sets its text, marks it aria-hidden, returns it.
   */
  override toDOM(): HTMLElement {
    const span = document.createElement('span'); // The note is not part of the document, so a plain element renders between characters without occupying an offset — which is what lets the comment's text appear at all (FR-10.4).
    span.className = CM_COMMENT_NOTE_CLASS; // styling comes from commentNoteTheme keyed on this class.
    span.textContent = `${this.author}: ${this.body}`; // textContent is used rather than innerHTML because the body is arbitrary user text that must never be parsed as markup, which would risk both rendering errors and injection (FR-10.4).
    span.setAttribute('aria-hidden', 'true'); // The comment is already announced by the pane's own UI, so marking it aria-hidden keeps a screen reader from reading the same note twice — once via the pane and once via the widget — which would be noise (FR-10.4).
    return span;
  }

  /**
   * @purpose Tells CodeMirror to ignore all events on the widget so it cannot move the caret (FR-10.4).
   * @inputs void — no event is received because this decides whether events are handled at all.
   * @outputs true, meaning every DOM event on the note is ignored by CodeMirror.
   * @dataflow None — pure predicate returning a constant.
   * @controlflow Returns true unconditionally: the note is not part of the document, so a click on it must not move the caret into an offset that does not exist in the file (FR-10.4).
   */
  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * @purpose Exposes just the note state field as an Extension so it can be composed into a pane's extension list (FR-10.4).
 * @inputs void — the field carries its own logic and needs no host configuration to function.
 * @outputs readonly Extension[] containing only commentNotesField, ready to spread alongside markdown() and keymaps in a pane setup.
 * @dataflow None — this is a pure passthrough returning an extension descriptor; the state field does all work when mounted.
 * @controlflow Returns a one-element array literal with no branching or state transition.
 */
export function commentNotes(): Extension {
  return [commentNotesField];
}

/**
 * @purpose Provides CSS rules that style inline notes in the Source pane so they read as annotations about the text (FR-10.4).
 * @inputs void — theme variables (--kdoc-color-accent, --kdoc-color-text-muted) are expected to be defined on a host element or :root by the surrounding design tokens; each rule is keyed by CM_COMMENT_NOTE_CLASS.
 * @outputs an Extension wrapping EditorView.theme with one selector rule keyed by the exported class constant.
 * @dataflow None — pure descriptor; CodeMirror injects the CSS into the document head when the extension mounts and applies it to every widget carrying CM_COMMENT_NOTE_CLASS.
 * @controlflow Returns a single theme-extension object literal built from one rule entry, no branching or state transition.
 */
export function commentNoteTheme(): Extension {
  return EditorView.theme({
    // Smaller and muted because a note is an annotation *about* the text rather than part of it, so it should read as secondary; nowrap keeps a note from reflowing the line it annotates — if it did, it would move the very thing it points at (FR-10.4).
    ['.' + CM_COMMENT_NOTE_CLASS]: {
      marginLeft: '0.5em',
      padding: '0 0.35em',
      borderRadius: '3px',
      fontSize: '0.85em',
      background: 'color-mix(in srgb, var(--kdoc-color-accent, #0969da) 12%, transparent)',
      color: 'var(--kdoc-color-text-muted, #57606a)',
      whiteSpace: 'nowrap',
    },
  });
}

/**
 * @purpose Dispatches a note effect onto an editor view so callers paint notes without knowing about the effect itself (FR-10.4).
 * @inputs view - the live EditorView to dispatch on; notes - the authoritative CommentNote[] source-offset set from the plan.
 * @outputs void — the new set is applied as a side effect of the dispatched transaction, not returned.
 * @dataflow Caller's computed notes -> setCommentNotesEffect.of(notes) wrapped in view.dispatch -> commentNotesField.update rebuilds the DecorationSet and re-renders the widgets.
 * @controlflow A single dispatch call with no branching; wraps the effect so callers never import StateEffect or reference commentNotesField directly, keeping decoration plumbing out of feature code.
 */
export function setCommentNotesIn(view: EditorView, notes: readonly CommentNote[]): void {
  view.dispatch({ effects: setCommentNotesEffect.of(notes) });
}
