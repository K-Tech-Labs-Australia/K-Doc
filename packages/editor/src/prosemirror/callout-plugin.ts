/**
 * @file callout-plugin.ts
 * @purpose Renders a blockquote carrying a [!NOTE] marker as a coloured, icon-bearing panel (FR-8.5).
 *
 *   The callout is styling over a plain blockquote, applied as node decorations rather than as a schema
 *   node. The document keeps the [!NOTE] line the file on disk has, and the pane makes it look like a title.
 *
 *   The marker line is decorated, not hidden. A marker that is invisible in the WYSIWYG pane but present in
 *   the Source pane is a difference between the two views of one document that the user can see the effect of
 *   and not the cause — they would delete the word they can see and wonder why the colour stayed.
 *
 *   The marker is decorated **inline**, over its own characters, rather than as a node decoration over the
 *   paragraph. `> [!NOTE]` followed by `> body` is a single paragraph, so a node decoration would give the body
 *   the marker's styling as well — and the compact form is the shape a GFM file usually arrives in.
 *
 *   An alert word K-Doc does not colour still gets a panel, in a neutral accent. `[!QUESTION]` is somebody else's
 *   extension or the user's own, and rendering it as an ordinary quote would make K-Doc the only reader that
 *   disagrees about what it is.
 *
 * @inputs ProseMirror EditorState instances, Transactions, and document nodes (blockquotes and paragraphs).
 * @outputs ProseMirror Plugin managing a DecorationSet of callout decorations, calloutPluginKey, CSS class names, calloutClassFor helper, and CALLOUT_STYLES stylesheet.
 * @functions
 *   - calloutClassFor: Resolves the CSS modifier class name corresponding to a specific callout kind.
 *   - createCalloutPlugin: Instantiates the ProseMirror plugin that creates and maintains callout node decorations.
 *   - buildDecorations: Scans the document for blockquotes with callout markers and constructs node decorations (module-private).
 * @dataflow Document nodes -> descendants traversal -> identify blockquote and parse marker paragraph -> construct node decorations -> DecorationSet -> view.
 * @controlflow Initialize decorations on plugin init -> on transaction apply: return existing mapped decorations if doc unchanged, rebuild decorations if doc changed -> props.decorations exposes active DecorationSet.
 * @version 2
 * @date 2026-09-11
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorState, Transaction } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { parseAlertMarker, type CalloutKind } from './callout.js';

/**
 * Plugin key uniquely identifying the callout decoration plugin and its state in an EditorState.
 */
export const calloutPluginKey: PluginKey<DecorationSet> = new PluginKey<DecorationSet>('calloutPlugin');

/**
 * Base CSS class name applied to callout blockquote container node decorations (FR-8.5).
 */
export const CALLOUT_CLASS: string = 'kdoc-callout';

/** Class on a callout whose alert word is not one of the five K-Doc colours. */
export const CALLOUT_CUSTOM_CLASS = 'kdoc-callout-custom';

/**
 * CSS class name applied to callout title marker paragraph node decorations (FR-8.5).
 */
export const CALLOUT_MARKER_CLASS: string = 'kdoc-callout-marker';

/**
 * Resolves the CSS modifier class name corresponding to a specific callout kind.
 *
 * @purpose Maps a CalloutKind variant to its corresponding CSS modifier class name.
 * @inputs kind: CalloutKind - The callout variant ('note', 'tip', 'important', 'warning', 'caution').
 * @outputs string - The CSS class string 'kdoc-callout-${kind}'.
 * @dataflow kind -> template literal interpolation -> CSS class name string.
 * @controlflow Constructs and returns the formatted class string directly.
 */
export function calloutClassFor(kind: CalloutKind): string {
  return `kdoc-callout-${kind}`;
}

/**
 * CSS stylesheet defining panel and marker styling for GitHub-style callouts (FR-8.5).
 *
 * The accent is carried on a single custom property (--kdoc-callout-accent) so the panel rule is written
 * once and each kind only says what colour it is; and color-mix gives the tint from the same accent
 * rather than five hand-picked pale colours that would drift out of step with it.
 */
export const CALLOUT_STYLES: string = `
/* Scoped to the pane's own blockquote rule rather than written as a bare class: the shell styles a
   blockquote as '.ProseMirror blockquote', which outranks a lone class and would keep its grey rule on
   every callout -- the tint would arrive and the accent bar would not. */
.ProseMirror blockquote.kdoc-callout {
  border-left: 4px solid var(--kdoc-callout-accent, #8c959f);
  border-radius: 0 4px 4px 0;
  padding: 8px 12px;
  margin: 8px 0;
  background: color-mix(in srgb, var(--kdoc-callout-accent, #8c959f) 8%, transparent);
}

.kdoc-callout-note { --kdoc-callout-accent: #0969da; }
.kdoc-callout-tip { --kdoc-callout-accent: #1a7f37; }
.kdoc-callout-important { --kdoc-callout-accent: #8250df; }
.kdoc-callout-warning { --kdoc-callout-accent: #9a6700; }
.kdoc-callout-caution { --kdoc-callout-accent: #cf222e; }

/* An unknown word gets the neutral grey the panel rule already falls back to, said
   explicitly rather than left to the fallback so the rule reads the same as the five
   beside it — and that a guessed colour would be asserting a meaning the author did not give. */
.kdoc-callout-custom { --kdoc-callout-accent: #8c959f; }

.kdoc-callout-marker {
  color: var(--kdoc-callout-accent, #8c959f);
  font-weight: 600;
  letter-spacing: 0.02em;
}
`;

/**
 * Scans the document for blockquotes with callout markers and constructs node decorations for the panel and marker.
 *
 * @purpose Traverses the document tree, identifies blockquotes whose first child paragraph contains a valid callout marker, and emits node decorations for the container and marker.
 * @inputs state: EditorState - The ProseMirror editor state whose document is traversed.
 * @outputs DecorationSet - The decoration set containing container and marker node decorations.
 * @dataflow state.doc -> descendants traversal -> blockquote check -> firstChild paragraph marker parse -> Decoration.node creation -> DecorationSet.create.
 * @controlflow Traverse document nodes via descendants -> skip non-blockquote nodes while continuing descent -> inspect firstChild of blockquote -> if not paragraph, continue descent -> parse callout marker from textContent -> if null, continue descent -> otherwise push panel decoration and marker decoration, then continue descent -> create and return DecorationSet.
 */
function buildDecorations(state: EditorState): DecorationSet {
  const decorations: Decoration[] = [];

  state.doc.descendants((node: ProseMirrorNode, pos: number): boolean => {
    // Check if the current node is not a blockquote.
    if (node.type.name !== 'blockquote') {
      // Keep descending: a callout can sit inside another container such as a list item.
      return true;
    } else {
      // Current node is a blockquote: inspect its first child block.
      const first = node.firstChild;

      // Check whether the first child is absent or its type name is not 'paragraph'.
      if (first === null || first.type.name !== 'paragraph') {
        // A quote whose first block is a list or a code fence is an ordinary quote;
        // descending into it may still find a nested callout.
        return true;
      } else {
        // First child is a paragraph: parse its text content for a GitHub-style alert marker.
        const marker = parseAlertMarker(first.textContent);

        // Check whether the first paragraph text contains an alert marker.
        if (marker === null) {
          // First paragraph does not contain an alert marker: keep descending in case of nested blockquotes.
          return true;
        } else {
          let panelClass: string;
          // Check whether the alert marker's word is not one of the five K-Doc colours.
          if (marker.kind === null) {
            // Unrecognized alert word: apply base callout class with custom neutral class.
            panelClass = `${CALLOUT_CLASS} ${CALLOUT_CUSTOM_CLASS}`;
          } else {
            // Recognized alert kind: apply base callout class with kind-specific modifier class.
            panelClass = `${CALLOUT_CLASS} ${calloutClassFor(marker.kind)}`;
          }

          // Valid callout marker detected: decorate the blockquote panel with container styling and accent color.
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              class: panelClass,
            }),
          );

          // pos + 2 is the first character of the paragraph's text — one step into the blockquote and
          // one into the paragraph — and an inline decoration is what keeps a compact alert's body out of the
          // marker's styling.
          const markerFrom = pos + 2;
          decorations.push(
            Decoration.inline(markerFrom, markerFrom + marker.length, { class: CALLOUT_MARKER_CLASS }),
          );

          // Return true so a callout nested inside this one is still found.
          return true;
        }
      }
    }
  });

  return DecorationSet.create(state.doc, decorations);
}

/**
 * Creates the ProseMirror plugin that renders GitHub-style callouts as colored panels (FR-8.5).
 *
 * @purpose Instantiates and configures the ProseMirror plugin that manages decoration sets for callout blockquotes.
 * @inputs None.
 * @outputs Plugin<DecorationSet> - Configured ProseMirror plugin instance managing callout node decorations.
 * @dataflow Document changes and transactions -> apply() updates or maps DecorationSet -> decorations() returns active DecorationSet to view.
 * @controlflow Configure Plugin with calloutPluginKey -> state.init builds initial decorations -> state.apply maps decorations if doc unchanged or rebuilds if doc changed -> props.decorations exposes active decorations from state.
 */
export function createCalloutPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: calloutPluginKey,
    state: {
      init(_config: unknown, state: EditorState): DecorationSet {
        // Build initial callout decorations from the initial document state.
        return buildDecorations(state);
      },
      apply(
        tr: Transaction,
        value: DecorationSet,
        _old: EditorState,
        newState: EditorState,
      ): DecorationSet {
        // Check whether the document content was modified by this transaction.
        // A callout is decided by the text of its first line, so only a document change can alter it.
        if (!tr.docChanged) {
          // Document did not change: map existing decorations across transaction mapping.
          return value.map(tr.mapping, tr.doc);
        } else {
          // Document changed: rebuild callout decorations against the new editor state.
          return buildDecorations(newState);
        }
      },
    },
    props: {
      decorations(state: EditorState): DecorationSet {
        // Return active decoration set from plugin state, defaulting to an empty set when state is uninitialized.
        return calloutPluginKey.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}
