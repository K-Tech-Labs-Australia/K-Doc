/**
 * @file change-marks.ts
 * @purpose CodeMirror 6 decorations for tracked plan changes in K-Doc's Source pane (FR-11.1, FR-11.6): a state field holding a DecorationSet of insertion marks and deletion widgets, an effect that replaces it with a freshly computed authoritative plan, and the theme rules that colour those marks — so every change reads identically whether painted here or by the ProseMirror plugin in the WYSIWYG pane.
 * @inputs setChangeSpansEffect carries readonly ChangeSpan[] (source offsets from the plan); EditorView when dispatching; document length derived at build time to drop stale spans.
 * @outputs a DecorationSet of change marks on editor state, two CSS class constants consumed by the theme, and extensions embeddable in the Source pane's extension list.
 * @functions
 *   - setChangeSpansEffect: StateEffect replacing the current span set with an authoritative plan.
 *   - changeMarksField: StateField holding the DecorationSet of insertion marks and deletion widgets across editor transactions.
 *   - buildChangeMarks: Assembles a DecorationSet from validated spans for a document length (module-level helper).
 *   - DeletionWidget: WidgetType rendering removed text that no longer lives in the document as a zero-width widget.
 *   - changeMarks: Extension composing just the state field for embedding in a pane's extension list.
 *   - changeSpanTheme: Extension providing CSS rules colouring insert and delete marks to match the WYSIWYG plugin.
 *   - setChangeSpansIn: Dispatches the span effect on behalf of callers who need not know about it.
 * @dataflow plan source offsets -> setChangeSpansEffect.of(spans) -> changeMarksField rebuilds DecorationSet via buildChangeMarks -> EditorView.decorations reads it and paints insertion marks (in-document) and deletion widgets (out-of-document).
 * @controlflow create returns an empty set; update replaces the set on a span effect (the authoritative plan wins, no merge) or maps changes otherwise so typed edits keep ranges steady until the debounced re-plan arrives again — briefly approximate beats briefly absent. Insertions paint as marks because their characters are in the document; deletions paint as widgets because they were removed and live only in the overlay.
 * @note ChangeSpan offsets are source offsets — exactly what a CodeMirror document is indexed by — so this Source pane can paint the plan directly with no translation; the WYSIWYG pane cannot because ProseMirror positions differ from source offsets (markup characters are absent from its tree) and that mapping does not exist yet. An insertion's characters remain in the document and therefore render as a mark, while a deletion's were removed and live only in the overlay, so it renders as a widget at a zero-width point — text the document does not contain.
 * @version 1
 * @date 2026-09-07
 */

import { StateEffect, StateField } from '@codemirror/state';
import type { Extension, Transaction, Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { authorHue, type ChangeSpan } from '@k-doc/core';

/** The CSS class applied to every inserted-range mark in the Source pane (FR-11.1). */
export const CM_CHANGE_INSERT_CLASS: string = 'kdoc-cm-change-insert';

/** The CSS class applied to every deletion widget in the Source pane (FR-11.6). */
export const CM_CHANGE_DELETE_CLASS: string = 'kdoc-cm-change-delete';

/**
 * @purpose Carries a freshly computed ChangeSpan[] into editor state so the change field can rebuild its DecorationSet from scratch.
 * @inputs spans - the authoritative, source-offset ranges produced by the plan for the current document snapshot.
 * @outputs A StateEffect instance whose payload is readonly ChangeSpan[].
 * @dataflow Caller builds spans via the plan -> setChangeSpansEffect.of(spans) produces an effect applied inside a dispatch's effects array.
 * @controlflow Pure definition with no branching; the effect only takes meaning when changeMarksField.update inspects tr.effects for it below.
 */
export const setChangeSpansEffect = StateEffect.define<readonly ChangeSpan[]>();

/**
 * @purpose Holds the DecorationSet of insertion marks and deletion widgets and keeps it in sync with editor transactions (FR-11.1, FR-11.6).
 * @inputs create receives a fresh EditorState; update receives the previous set plus each applied Transaction, including span effects.
 * @outputs A DecorationSet: empty on creation, rebuilt from an incoming plan effect, or change-mapped for ordinary edits.
 * @dataflow StateEffect payload spans -> buildChangeMarks(spans, docLength) produces a DecorationSet -> EditorView.decorations reads it to paint marks and widgets.
 * @controlflow On create return the empty set; on update branch: a span effect triggers an authoritative rebuild (the plan wins over any stale mark), every other transaction maps its changes over the existing set so typed edits keep ranges steady until the debounced re-plan arrives again.
 */
export const changeMarksField = StateField.define<DecorationSet>({
  create(): DecorationSet {
    return Decoration.none;
  },

  update(value: DecorationSet, tr: Transaction): DecorationSet {
    for (const effect of tr.effects) {
      if (effect.is(setChangeSpansEffect)) {
        // Branch: an authoritative plan arrived — rebuild from scratch rather than merge, because the new plan is a complete statement of what exists and any mark left over from the previous set would otherwise linger as a phantom change.
        return buildChangeMarks(effect.value, tr.state.doc.length);
      } else {
        // Branch: some other effect. Keep scanning rather than returning here: a transaction can carry
        // several effects, and returning on the first non-matching one would let a span effect behind it
        // go unseen -- the plan would be dropped silently and the marks would simply stop updating.
      }
    }

    // No span effect in this transaction: map the existing marks across its changes so an inserted range or
    // deletion widget stays put while the user types, since the authoritative re-plan only arrives on a debounce.
    // Briefly approximate beats briefly absent.
    return value.map(tr.changes);
  },

  provide: (field) => EditorView.decorations.from(field),
});

/**
 * @purpose Assembles a DecorationSet of insertion marks and deletion widgets from authoritative spans for a document of `docLength`.
 * @inputs spans - the source-offset ranges to paint; docLength - the current document length used to drop stale or out-of-range spans.
 * @outputs A finished DecorationSet whose insertion marks carry class, change-id attribute, and author hue styling, and whose deletion widgets render removed text at zero-width points.
 * @dataflow Each span -> validated against bounds -> an insertion mark or a deletion widget appended to a range array -> Decoration.set(ranges, true) sorts and yields the set.
 * @controlflow Drop spans that run past the document end or start before offset 0 (the plan is computed from a snapshot and the document can have moved on), skip zero-width insertions, then mark each insertion over its character extent while placing each deletion widget at its start with side -1; Decoration.set sorts rather than RangeSetBuilder so shared offsets between an insertion and a deletion do not throw.
 */
function buildChangeMarks(spans: readonly ChangeSpan[], docLength: number): DecorationSet {
  const ranges: Range<Decoration>[] = [];

  for (const span of spans) {
    if (span.end > docLength || span.start < 0) {
      // Branch: this anchor lies outside the current document — either past its end or before offset 0 — so drop it rather than clamp, because the plan was computed from an earlier snapshot and clamping would paint a change over characters that never belonged to it.
      continue;
    }

    // An insertion's characters are still in the document, so it paints as a mark over its own range.
    if (span.kind === 'insert') {
      // A zero-width insertion has no characters to mark, so there is nothing to paint.
      if (span.start >= span.end) {
        // Degenerate range: skip rather than emit a mark covering nothing.
        continue;
      } else {
        // A range with width: mark it, tagged with the change id so a click can recover the owner.
        ranges.push(
          Decoration.mark({
            class: CM_CHANGE_INSERT_CLASS,
            attributes: {
              'data-change-id': span.changeId,
              style: `--kdoc-author-hue: ${authorHue(span.author)}`,
            },
          }).range(span.start, span.end),
        );
      }
    } else {
      // A deletion's characters are NOT in the document -- they were removed and live only in the
      // overlay -- so there is no range to mark. It paints as a widget at the zero-width seam, with
      // side -1 placing the removed text before whatever now occupies that offset, which is where it
      // used to sit.
      ranges.push(
        Decoration.widget({
          widget: new DeletionWidget(span.text, span.changeId, span.author),
          side: -1,
        }).range(span.start),
      );
    }
  }

  // Decoration.set(ranges, true) sorts for us rather than hand-sorting: a deletion widget and an insertion mark can share an offset (the deletion sits at the point its text was removed, adjacent to what now fills that gap), and RangeSetBuilder would throw on that ordering while Decoration.set resolves it.
  return Decoration.set(ranges, true);
}

/**
 * @purpose Renders a deleted run of plan text as an out-of-document widget so removed characters stay visible (FR-11.6).
 * @inputs text - the exact removed characters to display; changeId - identifies which change this deletion belongs to; author - the change's author, used to derive the shared hue.
 * @outputs An HTMLElement span carrying CM_CHANGE_DELETE_CLASS, a data-change-id attribute, and an inline --kdoc-author-hue custom property for theming.
 * @dataflow DeletionWidget fields -> toDOM builds a span whose textContent is the raw removed run and whose style injects the author hue consumed by changeSpanTheme styling.
 * @controlflow Pure construction; eq compares all three fields so CodeMirror reuses an identical node across redraws, and ignoreEvent returns false because widgets are decorative rather than interactive (FR-11.6).
 */
class DeletionWidget extends WidgetType {
  constructor(
    private readonly text: string,
    private readonly changeId: string,
    private readonly author: string,
  ) {
    super();
  }

  override eq(other: DeletionWidget): boolean {
    // A deletion is identical to another only when its text, owning change, and author all match; without a correct eq CodeMirror rebuilds the node on every redraw and the strike-through flickers while the user types.
    return (
      this.text === other.text &&
      this.changeId === other.changeId &&
      this.author === other.author
    );
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span'); // The widget is not part of the document, so a plain element suffices and it renders between characters without occupying an offset — which is what makes the deletion visible at all (FR-11.6).
    span.className = CM_CHANGE_DELETE_CLASS; // styling comes from changeSpanTheme keyed on this class to match the WYSIWYG plugin exactly.
    span.setAttribute('data-change-id', this.changeId); // lets a click recover which change owns this removed run.
    span.style.setProperty('--kdoc-author-hue', String(authorHue(this.author))); // injects the author's hue so insert and delete share one colour per change (FR-11.6).
    span.textContent = this.text; // textContent is used rather than innerHTML because the deleted run is arbitrary document text that must never be parsed as markup, which would risk both rendering errors and injection (FR-11.6).
    return span;
  }

  override ignoreEvent(): boolean {
    // Deletion widgets are decorative removed-text markers, not interactive handles, so CodeMirror ignores all events on them (FR-11.6).
    return false;
  }
}

/**
 * @purpose Exposes just the change-marks state field as an Extension so it can be composed into a pane's extension list (FR-11.1, FR-11.6).
 * @inputs void — the field carries its own logic and needs no host configuration to function.
 * @outputs readonly Extension[] containing only changeMarksField, ready to spread alongside markdown() and keymaps in a pane setup.
 * @dataflow None — this is a pure passthrough returning an extension descriptor; the state field does all work when mounted.
 * @controlflow Returns a one-element array literal with no branching or state transition.
 */
export function changeMarks(): Extension {
  return [changeMarksField];
}

/**
 * @purpose Provides CSS rules that colour insert and delete marks in the Source pane so they match the WYSIWYG plugin exactly (FR-11.1, FR-11.6).
 * @inputs void — theme variables (--kdoc-author-hue) are expected to be defined on a host element or :root by the surrounding design tokens; each rule injects its own hue inline via --kdoc-author-hue set on the node (see DeletionWidget and buildChangeMarks).
 * @outputs an Extension wrapping EditorView.theme with two selector rules keyed by the exported class constants.
 * @dataflow None — pure descriptor; CodeMirror injects the CSS into the document head when the extension mounts and applies it to every mark or widget carrying these classes.
 * @controlflow Returns a single theme-extension object literal built from two rule entries, no branching or state transition.
 */
export function changeSpanTheme(): Extension {
  return EditorView.theme({
    // Insertions: underline tinted by author hue — only the hue is inherited here (via --kdoc-author-hue) while saturation and lightness belong to this theme so every pane reads identically, matching the ProseMirror plugin's stylesheet exactly.
    ['.' + CM_CHANGE_INSERT_CLASS]: {
      textDecoration: 'underline',
      textDecorationColor: 'hsl(var(--kdoc-author-hue) 65% 45%)',
      textUnderlineOffset: '2px',
    },

    // Deletions: struck-through and faded by author hue for the same reason — only the hue is inherited while saturation and lightness come from this theme, matching the ProseMirror plugin's stylesheet so a change reads identically in either pane. userSelect: none keeps the widget's out-of-document text off any selection so characters the file does not contain never reach the clipboard (FR-11.6).
    ['.' + CM_CHANGE_DELETE_CLASS]: {
      textDecoration: 'line-through',
      color: 'hsl(var(--kdoc-author-hue) 65% 45%)',
      opacity: '0.7',
      userSelect: 'none',
    },
  });
}

/**
 * @purpose Dispatches a span effect onto an editor view so callers paint changes without knowing about the effect itself (FR-11.1, FR-11.6).
 * @inputs view - the live EditorView to dispatch on; spans - the authoritative ChangeSpan[] source-offset ranges from the plan.
 * @outputs void — the new set is applied as a side effect of the dispatched transaction, not returned.
 * @dataflow Caller's computed spans -> setChangeSpansEffect.of(spans) wrapped in view.dispatch -> changeMarksField.update rebuilds the DecorationSet and re-renders marks and widgets.
 * @controlflow A single dispatch call with no branching; wraps the effect so callers never import StateEffect or reference changeMarksField directly, keeping decoration plumbing out of feature code (FR-11.6).
 */
export function setChangeSpansIn(view: EditorView, spans: readonly ChangeSpan[]): void {
  view.dispatch({ effects: setChangeSpansEffect.of(spans) });
}
