/**
 * @file change-bars.ts
 * @purpose CodeMirror 6 gutter for Simple Markup-style change bars in K-Doc's Source pane (FR-11.4): a state field holding a RangeSet of identical margin markers, an effect that replaces it with a freshly computed authoritative plan of which lines changed, and the theme rules that colour those bars — so every line carrying a change reads as one clean bar beside the gutter without any edit text getting in the way of the prose.
 * @inputs setChangeBarsEffect carries readonly ChangeBar[] (lineStart offsets from the plan); EditorView when dispatching; document length derived at build time to drop stale bars whose offset has run past the end of the current document.
 * @outputs a RangeSet<GutterMarker> of change-bar markers on editor state, two CSS class constants consumed by the theme, and extensions embeddable in the Source pane's extension list.
 * @functions
 *   - setChangeBarsEffect: StateEffect replacing the current bar set with an authoritative plan.
 *   - changeBarsField: StateField holding the RangeSet of gutter markers across editor transactions.
 *   - buildBars: Assembles a RangeSet from validated bars for a document length (module-level helper).
 *   - BarMarker: GutterMarker rendering a single identical margin bar as an empty span.
 *   - changeBars: Extension composing the state field and its gutter for embedding in a pane's extension list.
 *   - changeBarTheme: Extension providing CSS rules colouring the bars to match the K-Doc plugin.
 *   - setChangeBarsIn: Dispatches the bar effect on behalf of callers who need not know about it.
 * @dataflow plan line offsets -> setChangeBarsEffect.of(bars) -> changeBarsField rebuilds RangeSet via buildBars -> gutter markers option reads it and paints one identical span per changed line in the margin.
 * @controlflow create returns an empty range set; update replaces the set on a bar effect (the authoritative plan wins, no merge) or maps changes otherwise so typed edits keep ranges steady until the debounced re-plan arrives again — briefly approximate beats briefly absent. Each bar paints as one identical marker because Simple Markup says only *something changed here*, deliberately not what.
 * @version 1
 * @date 2026-09-10
 */

import { StateEffect, StateField, RangeSet } from '@codemirror/state';
import type { Extension, Transaction } from '@codemirror/state';
import { gutter, GutterMarker, EditorView } from '@codemirror/view';
import type { ChangeBar } from '@k-doc/core';

/** The CSS class applied to every change-bar span in the Source pane (FR-11.4). */
export const CM_CHANGE_BAR_CLASS: string = 'kdoc-cm-change-bar';

/**
 * @purpose Carries a freshly computed ChangeBar[] into editor state so the bar field can rebuild its RangeSet from scratch.
 * @inputs bars - the authoritative lineStart offsets produced by the plan for the current document snapshot.
 * @outputs A StateEffect instance whose payload is readonly ChangeBar[].
 * @dataflow Caller builds bars via the plan -> setChangeBarsEffect.of(bars) produces an effect applied inside a dispatch's effects array.
 * @controlflow Pure definition with no branching; the effect only takes meaning when changeBarsField.update inspects tr.effects for it below.
 */
export const setChangeBarsEffect = StateEffect.define<readonly ChangeBar[]>();

/**
 * @purpose Holds the RangeSet of gutter markers and keeps it in sync with editor transactions (FR-11.4).
 * @inputs create receives a fresh EditorState; update receives the previous range set plus each applied Transaction, including bar effects.
 * @outputs A RangeSet<GutterMarker>: empty on creation, rebuilt from an incoming plan effect, or change-mapped for ordinary edits.
 * @dataflow StateEffect payload bars -> buildBars(bars, docLength) produces a RangeSet -> gutter markers option reads it to paint one identical bar per changed line.
 * @controlflow On create return the empty range set; on update branch: a bar effect triggers an authoritative rebuild (the plan wins over any stale marker), every other transaction maps its changes over the existing set so typed edits keep ranges steady until the debounced re-plan arrives again, and it never returns from the else because scanning must continue past a non-matching effect.
 */
export const changeBarsField = StateField.define<RangeSet<GutterMarker>>({
  create(): RangeSet<GutterMarker> {
    return RangeSet.empty;
  },

  update(value: RangeSet<GutterMarker>, tr: Transaction): RangeSet<GutterMarker> {
    for (const effect of tr.effects) {
      if (effect.is(setChangeBarsEffect)) {
        // Branch: an authoritative plan arrived — rebuild from scratch rather than merge, because the new plan is a complete statement of which lines changed and any marker left over from the previous set would otherwise linger as a phantom change.
        return buildBars(effect.value, tr.state.doc.length);
      } else {
        // Branch: some other effect. Keep scanning rather than returning here: a transaction can carry several effects, and stopping at the first non-matching one would let a bar effect behind it go unseen — the plan would be dropped silently and the bars would simply stop updating.
      }
    }

    // No bar effect in this transaction: map the existing markers across its changes so each bar stays put while the user types, since the authoritative re-plan only arrives on a debounce. Briefly approximate beats briefly absent.
    return value.map(tr.changes);
  },
});

/**
 * @purpose Assembles a RangeSet of gutter markers from authoritative bars for a document of `docLength`.
 * @inputs bars - the lineStart offsets to paint; docLength - the current document length used to drop stale or out-of-range bars.
 * @outputs A finished RangeSet<GutterMarker> whose every range is the shared identical BarMarker, sorted by offset.
 * @dataflow Each valid bar -> validated against bounds -> BAR.range(bar.lineStart) appended to a range array -> RangeSet.of(ranges, true) sorts and yields the set.
 * @controlflow Drop bars whose lineStart runs past the document end or starts before offset 0 (the plan was computed from an earlier snapshot and clamping would paint a bar over characters that never belonged to it), then mark each surviving bar at its start with RangeSet.of(ranges, true) which sorts rather than hand-sorting because the plan's bars are ordered by line index — the same order as offset here but one that need not stay that way.
 */
function buildBars(bars: readonly ChangeBar[], docLength: number): RangeSet<GutterMarker> {
  // A plan computed a moment ago can outrun the document as edits land on top of it, so only bars whose start offset still lies within [0, docLength] are kept; anything past the end or before offset 0 is dropped rather than clamped.
  const ranges = bars
    .filter((bar) => bar.lineStart >= 0 && bar.lineStart <= docLength)
    .map((bar) => BAR.range(bar.lineStart));

  // RangeSet.of(ranges, true) sorts for us rather than hand-sorting: sorting is delegated because the plan's bars are ordered by line index, which happens to be the same order as offset here but need not stay that way across a re-plan.
  return RangeSet.of(ranges, true);
}

/**
 * @purpose Renders a single identical change bar in the margin so Simple Markup says only *something changed here* without any edit text (FR-11.4).
 * @inputs void — the marker carries no per-line state; every line is painted by the one shared instance below.
 * @outputs An HTMLElement span carrying CM_CHANGE_BAR_CLASS with no text content, rendered in the gutter margin.
 * @dataflow None — toDOM builds a bare empty span whose styling comes entirely from changeBarTheme keyed on CM_CHANGE_BAR_CLASS.
 * @controlflow Pure construction; eq returns true for every comparison so CodeMirror treats any two bars as interchangeable and reuses a single DOM node across redraws instead of rebuilding one per line, which would waste work on every keystroke (FR-11.4).
 */
class BarMarker extends GutterMarker {
  override eq(): boolean {
    // Every bar is identical: return true so CodeMirror considers any two markers equal and reuses a single DOM node across redraws rather than rebuilding one per line, since the marker carries no per-line state (FR-11.4).
    return true;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span'); // The bar is purely decorative margin chrome, so a bare empty element suffices and it renders in the gutter without occupying any document offset.
    span.className = CM_CHANGE_BAR_CLASS; // styling comes from changeBarTheme keyed on this class (FR-11.4).
    return span; // No textContent: Simple Markup shows only that something changed here, deliberately not what.
  }
}

// One instance serves every line because the marker carries no per-line state — BAR.range() is called for each changed line and CodeMirror reuses this single node (FR-11.4).
const BAR = new BarMarker();

/**
 * @purpose Exposes just the change-bars state field as an Extension so it can be composed into a pane's extension list (FR-11.4).
 * @inputs void — the field carries its own logic and needs no host configuration to function.
 * @outputs readonly Extension[] containing only changeBarsField, ready to spread alongside markdown() and keymaps in a pane setup.
 * @dataflow None — this is a pure passthrough returning an extension descriptor; the state field does all work when mounted.
 * @controlflow Returns a one-element array literal with no branching or state transition.
 */
export function changeBars(): Extension {
  return [changeBarsField, gutter({ class: 'kdoc-cm-change-gutter', markers: (view) => view.state.field(changeBarsField) })];
}

/**
 * @purpose Provides CSS rules that colour the margin bars in the Source pane so they match the K-Doc plugin exactly (FR-11.4).
 * @inputs void — theme variables (--kdoc-author-hue) are expected to be defined on a host element or :root by the surrounding design tokens; each bar rule falls back to a neutral hue because it cannot know which author's change owns any given line.
 * @outputs an Extension wrapping EditorView.theme with two selector rules keyed by the gutter class and CM_CHANGE_BAR_CLASS.
 * @dataflow None — pure descriptor; CodeMirror injects the CSS into the document head when the extension mounts and applies it to every bar carrying this class.
 * @controlflow Returns a single theme-extension object literal built from two rule entries, no branching or state transition.
 */
export function changeBarTheme(): Extension {
  return EditorView.theme({
    // The gutter itself is a narrow column so only one thin bar shows beside each changed line; width keeps the margin tight and paddingLeft nudges bars off the document edge (FR-11.4).
    '.kdoc-cm-change-gutter': {
      width: '3px',
      paddingLeft: '2px',
    },

    // The bar itself is a full-height thin strip in the gutter margin; display:block and height:100% make it span the line's vertical extent (FR-11.4). It falls back to a neutral hue because a single line can carry changes from several authors, so picking one of them would be a claim Simple Markup is deliberately not making — only that something changed here.
    ['.' + CM_CHANGE_BAR_CLASS]: {
      display: 'block',
      width: '3px',
      height: '100%',
      background: 'hsl(var(--kdoc-author-hue, 210) 65% 45%)',
    },
  });
}

/**
 * @purpose Dispatches a bar effect onto an editor view so callers paint bars without knowing about the effect itself (FR-11.4).
 * @inputs view - the live EditorView to dispatch on; bars - the authoritative ChangeBar[] lineStart offsets from the plan.
 * @outputs void — the new set is applied as a side effect of the dispatched transaction, not returned.
 * @dataflow Caller's computed bars -> setChangeBarsEffect.of(bars) wrapped in view.dispatch -> changeBarsField.update rebuilds the RangeSet and re-renders one bar per changed line.
 * @controlflow A single dispatch call with no branching; wraps the effect so callers never import StateEffect or reference changeBarsField directly, keeping gutter plumbing out of feature code (FR-11.4).
 */
export function setChangeBarsIn(view: EditorView, bars: readonly ChangeBar[]): void {
  view.dispatch({ effects: setChangeBarsEffect.of(bars) });
}
