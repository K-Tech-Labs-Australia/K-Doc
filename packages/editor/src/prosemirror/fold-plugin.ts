/**
 * @file fold-plugin.ts
 * @purpose ProseMirror plugin implementing FR-8.29 folding of heading sections and list subtrees in the K-Doc pane. Fold state lives in an externally owned FoldStore (not plugin state) because the shell rebuilds EditorState on external changes; the plugin only renders decorations from the document plus the store, and exposes a toggle widget per fold target.
 * @inputs ProseMirror EditorState/Transaction/doc nodes, a FoldStore instance, user click/mousedown events, and the kdocFold decoration set.
 * @outputs Plugin<DecorationSet> managing kdocFold decorations; exported FoldStore interface, foldPluginKey, CSS class constants, ProseMirrorFoldTarget type, toggle command, and FOLD_STYLES stylesheet.
 * @functions
 *   - headingLevel: Reads a heading node's level attribute with a default of 1 when absent or non-numeric.
 *   - proseMirrorFoldTargets: Scans the document for foldable heading sections and listItem subtrees, returning their keys, positions, and body ranges.
 *   - foldTargetAt: Returns the innermost fold target whose range contains a given position.
 *   - hiddenFoldTargetAt: Returns the outermost folded target that currently hides a given position.
 *   - toggleButton: Builds a non-editable widget button that toggles a target's fold state through the store.
 *   - buildDecorations: Assembles the DecorationSet of toggle widgets and fold/hide node decorations for the document.
 *   - createFoldPlugin: Instantiates the ProseMirror plugin wiring decoration rebuilds and store subscriptions to the view.
 *   - toggleFoldCommand: Command that toggles the fold target under the caret.
 * @dataflow FoldStore state + doc nodes -> proseMirrorFoldTargets -> buildDecorations -> DecorationSet -> view props.decorations; user events -> toggleButton -> store.toggle -> store.subscribe listener -> transaction -> rebuild decorations.
 * @controlflow Init builds decorations from doc+store -> on apply: rebuild when doc changed or fold meta set -> props exposes decoration set -> view subscribes to store (rebuild + caret rescue) and updates (auto-unfold jumps into hidden content) -> destroy unsubscribes.
 * @version 1
 * @date 2026-09-16
 */

import { Plugin, PluginKey, Selection } from 'prosemirror-state';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorView } from 'prosemirror-view';
import { foldKeys } from '@k-doc/core';
import type { FoldKind } from '@k-doc/core';

/**
 * Contract for the mutable fold state owned by the shell. Kept outside plugin state so it survives
 * the EditorState rebuilds the shell performs on external changes (outline edits, find-and-replace).
 */
export interface FoldStore {
  isFolded(key: string): boolean;
  setFolded(key: string, folded: boolean): void;
  toggle(key: string): void;
  subscribe(listener: () => void): () => void;
}

/**
 * Plugin key uniquely identifying the fold plugin and its DecorationSet state in an EditorState.
 */
export const foldPluginKey: PluginKey<DecorationSet> = new PluginKey<DecorationSet>('kdocFold');

/**
 * CSS class name applied to the per-target toggle widget button (FR-8.29).
 */
export const FOLD_TOGGLE_CLASS: string = 'kdoc-fold-toggle';

/**
 * CSS class name hiding a fold target's body once folded (FR-8.29).
 */
export const FOLD_HIDDEN_CLASS: string = 'kdoc-fold-hidden';

/**
 * CSS class name applied to the folded container node so its trailing ellipsis can be styled (FR-8.29).
 */
export const FOLDED_CLASS: string = 'kdoc-folded';

/**
 * A single foldable region of the document: a top-level heading section or a listItem subtree.
 * Positions are in document order and follow ProseMirror's half-open conventions where noted.
 */
export interface ProseMirrorFoldTarget {
  readonly key: string; // Stable identifier derived from kind + text via @k-doc/core foldKeys.
  readonly kind: FoldKind; // 'heading' for a section, 'listItem' for a list item subtree.
  readonly pos: number; // Position immediately before the heading or listItem node.
  readonly end: number; // Heading: bodyTo (start of next section); listItem: pos + node.nodeSize.
  readonly bodyFrom: number; // Where the foldable body starts.
  readonly bodyTo: number; // Where it ends; equal to bodyFrom when there is nothing to fold.
}

/**
 * Intermediate, pre-key representation of a fold target produced while scanning the document.
 */
interface RawFoldTarget {
  kind: FoldKind;
  text: string;
  pos: number;
  end: number;
  bodyFrom: number;
  bodyTo: number;
}

/**
 * A top-level child of the document captured with its absolute position for heading-section scanning.
 */
interface DocChild {
  node: ProseMirrorNode;
  pos: number;
}

/**
 * @purpose Reads a heading node's level attribute, defaulting to 1 when the attribute is missing or not numeric.
 * @inputs node - The ProseMirrorNode inspected; expected to be a 'heading' node with an optional `level` attr.
 * @outputs number - The heading level in [1, 6], falling back to 1 for malformed attributes.
 * @dataflow node.attrs['level'] -> typeof guard -> numeric level or default of 1.
 * @controlflow Check the attribute is a number; return it when true, otherwise return the default of 1.
 */
function headingLevel(node: ProseMirrorNode): number {
  // Fall back to level 1 when the heading carries no numeric level attribute (e.g. schema drift).
  return typeof node.attrs['level'] === 'number' ? node.attrs['level'] : 1;
}

/**
 * @purpose Scans the document for every foldable heading section and listItem subtree, computing each target's key, position range, and foldable body.
 * @inputs doc - The ProseMirrorNode document to scan.
 * @outputs ProseMirrorFoldTarget[] - One entry per fold target, sorted by ascending start position with a stable key from the core module.
 * @dataflow doc.forEach top-level children -> heading sections; doc.descendants -> listItems -> raw targets -> foldKeys -> mapped targets.
 * @controlflow Collect top-level children -> for each heading bound its body by the next equal/higher heading -> descend for all listItems -> sort by pos -> assign keys via foldKeys -> return.
 */
export function proseMirrorFoldTargets(doc: ProseMirrorNode): ProseMirrorFoldTarget[] {
  const raw: RawFoldTarget[] = [];
  const children: DocChild[] = [];
  doc.forEach((node, offset) => children.push({ node, pos: offset }));

  for (let i = 0; i < children.length; i += 1) {
    const c = children[i];
    // Skip an index that resolved to undefined under noUncheckedIndexedAccess.
    if (c === undefined) {
      continue;
    } else {
      // A real child: see whether it opens a section.
    }

    if (c.node.type.name === 'heading') {
      // Top-level heading: this node opens a section whose body runs until the next equal/higher heading.
      const level: number = headingLevel(c.node);
      const bodyFrom: number = c.pos + c.node.nodeSize;
      let bodyTo: number = doc.content.size;

      for (let j = i + 1; j < children.length; j += 1) {
        const n = children[j];
        // Stop at the next heading of equal or higher level, which bounds this section's foldable body.
        if (n !== undefined && n.node.type.name === 'heading' && headingLevel(n.node) <= level) {
          bodyTo = n.pos;
          break;
        } else {
          // Lower-level sibling: the section continues past it, so keep scanning for a closer bound.
        }
      }

      raw.push({ kind: 'heading', text: c.node.textContent, pos: c.pos, end: bodyTo, bodyFrom, bodyTo });
    } else {
      // Not a top-level heading node: nothing to fold here, so skip to the next child.
    }
  }

  doc.descendants((node, pos) => {
    if (node.type.name === 'listItem') {
      // A listItem's foldable body is everything after its first child (the label/textblock).
      const first = node.firstChild;
      const bodyFrom: number = first === null ? pos + 1 : pos + 1 + first.nodeSize;
      raw.push({ kind: 'listItem', text: first === null ? '' : first.textContent, pos, end: pos + node.nodeSize, bodyFrom, bodyTo: pos + node.nodeSize - 1 });
    } else {
      // Not a listItem: keep descending so nested listItems deeper in the tree are also captured.
    }
    return true;
  });

  raw.sort((a, b) => a.pos - b.pos);
  const keys: string[] = foldKeys(raw.map((r) => ({ kind: r.kind, text: r.text })));
  return raw.map((r, i) => ({ key: keys[i] ?? '', kind: r.kind, pos: r.pos, end: r.end, bodyFrom: r.bodyFrom, bodyTo: r.bodyTo }));
}

/**
 * @purpose Returns the innermost fold target whose foldable range contains a given document position.
 * @inputs doc - The ProseMirrorNode document to search; pos - Cursor/document position in document order.
 * @outputs ProseMirrorFoldTarget | null - The matching target, or null when none contains pos with a non-empty body.
 * @dataflow proseMirrorFoldTargets(doc) -> filter by range and foldable body -> select largest start pos.
 * @controlflow Iterate targets -> keep those with bodyTo > bodyFrom and pos in [pos, end) -> among them keep the one with the greatest pos (innermost).
 */
export function foldTargetAt(doc: ProseMirrorNode, pos: number): ProseMirrorFoldTarget | null {
  const targets = proseMirrorFoldTargets(doc);
  let best: ProseMirrorFoldTarget | null = null;

  for (let i = 0; i < targets.length; i += 1) {
    const t = targets[i];
    // A candidate must have a foldable body and contain pos within its half-open [pos, end) range.
    if (t !== undefined && t.bodyTo > t.bodyFrom && t.pos <= pos && pos < t.end) {
      // Targets come sorted by position, so each later match starts inside the previous one: the last is innermost.
      best = t;
    } else {
      // Candidate does not contain pos or has no foldable body: skip it.
    }
  }

  return best;
}

/**
 * @purpose Returns the outermost folded target that currently hides a given document position.
 * @inputs doc - The ProseMirrorNode document to search; store - FoldStore consulted for each target's folded state; pos - Cursor/document position.
 * @outputs ProseMirrorFoldTarget | null - The first (outermost) folded target hiding pos, or null.
 * @dataflow proseMirrorFoldTargets(doc) -> isFolded(key) + range check per target -> return first match.
 * @controlflow Iterate targets in ascending pos order -> return the first whose key is folded and whose hidden body contains pos; else scan all and return null.
 */
export function hiddenFoldTargetAt(doc: ProseMirrorNode, store: FoldStore, pos: number): ProseMirrorFoldTarget | null {
  const targets = proseMirrorFoldTargets(doc);

  for (let i = 0; i < targets.length; i += 1) {
    const t = targets[i];
    // Targets are sorted by ascending pos, so the first match is the outermost folded target.
    if (t !== undefined && store.isFolded(t.key) && pos > t.bodyFrom && pos < t.bodyTo) {
      return t;
    } else {
      // Target is not folded or does not hide pos: keep scanning for an outer match.
    }
  }

  return null;
}

/**
 * @purpose Builds a non-editable widget button that toggles a single fold target's state through the store.
 * @inputs ownerDocument - DOM Document used to create the element (kept off the global so the plugin is document-agnostic); target - The fold target this button controls; folded - Whether the section is currently folded; store - FoldStore receiving toggle requests.
 * @outputs HTMLElement - An HTMLButtonElement widget styled as a fold control with correct ARIA and event wiring.
 * @dataflow target + folded -> label, aria-expanded, glyph -> click/mousedown listeners -> store.toggle / caret-preserving preventDefault.
 * @controlflow Create button -> set type/class/contenteditable/aria-expanded -> compute label by kind+folded -> set textContent glyph -> attach mousedown (preventDefault) and click (preventDefault, stopPropagation, toggle) -> return button.
 */
function toggleButton(ownerDocument: Document, target: ProseMirrorFoldTarget, folded: boolean, store: FoldStore): HTMLElement {
  const button: HTMLButtonElement = ownerDocument.createElement('button');
  button.type = 'button';
  button.className = FOLD_TOGGLE_CLASS;
  button.setAttribute('contenteditable', 'false');
  // aria-expanded is inverted because a folded section exposes an "unfold" control that opens it.
  button.setAttribute('aria-expanded', folded ? 'false' : 'true');

  const label: string = target.kind === 'heading'
    ? (folded ? 'Unfold section' : 'Fold section')
    : (folded ? 'Unfold list item' : 'Fold list item');
  button.setAttribute('aria-label', label);
  button.title = label;
  // ▸ points into the hidden body when folded, ▾ reveals it when open.
  button.textContent = folded ? '▸' : '▾';

  // A mousedown reaching the editor would move the caret into the heading/listItem being toggled.
  button.addEventListener('mousedown', (event: MouseEvent): void => {
    event.preventDefault();
  });

  // Toggle fold state through the store; the plugin's store listener redraws the decorations.
  button.addEventListener('click', (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    store.toggle(target.key);
  });

  return button;
}

/**
 * @purpose Assembles the DecorationSet of per-target toggle widgets and fold/hide node decorations for the document given current store state.
 * @inputs doc - The ProseMirrorNode document to decorate; store - FoldStore providing each target's folded state.
 * @outputs DecorationSet - Widget decorations before each foldable heading/listItem plus node decorations marking folded/hidden ranges.
 * @dataflow proseMirrorFoldTargets(doc) + store.isFolded -> widget + (folded ? folded-class + hidden-range decorations) -> DecorationSet.create.
 * @controlflow For each target with a body -> attach toggle widget at anchor -> if folded mark the whole node folded and hide its body siblings/children -> return created set.
 */
function buildDecorations(doc: ProseMirrorNode, store: FoldStore): DecorationSet {
  const decorations: Decoration[] = [];

  for (const t of proseMirrorFoldTargets(doc)) {
    // A target with no foldable body has nothing to hide and gets no control.
    if (t.bodyTo <= t.bodyFrom) {
      continue;
    } else {
      // Something to fold: give it a control.
    }

    const node: ProseMirrorNode | null = doc.nodeAt(t.pos);
    // The position must resolve to the target's own node, otherwise there is nothing to decorate.
    if (node === null) {
      continue;
    } else {
      // The node is there to decorate.
    }

    const folded: boolean = store.isFolded(t.key);

    // Anchor the toggle widget before the heading text or, for a listItem, before its first textblock's content.
    const anchor: number | null = t.kind === 'heading'
      ? t.pos + 1
      : (node.firstChild !== null && node.firstChild.isTextblock ? t.pos + 2 : null);

    if (anchor !== null) {
      // side: -1 anchors the button before the first character so it does not drift as content is edited.
      // key encodes folded state so ProseMirror rebuilds the widget when the fold toggles.
      decorations.push(
        Decoration.widget(anchor, (view) => toggleButton(view.dom.ownerDocument, t, folded, store), {
          side: -1,
          key: `kdoc-fold:${t.key}:${folded ? 'folded' : 'open'}`,
          ignoreSelection: true,
        }),
      );
    } else {
      // No valid anchor for the toggle widget (e.g. a listItem whose first child is not a textblock).
    }

    if (folded) {
      decorations.push(Decoration.node(t.pos, t.pos + node.nodeSize, { class: FOLDED_CLASS }));

      if (t.kind === 'heading') {
        // A heading's body spans top-level siblings up to the next section; hide each sibling in that range.
        doc.forEach((child, offset) => {
          if (offset >= t.bodyFrom && offset < t.bodyTo) {
            decorations.push(Decoration.node(offset, offset + child.nodeSize, { class: FOLD_HIDDEN_CLASS }));
          } else {
            // Sibling outside the foldable body range: leave it visible.
          }
        });
      } else {
        // A listItem's body is its own children; hide every child after the first (the first holds the label).
        node.forEach((child, offset, index) => {
          if (index > 0) {
            const from: number = t.pos + 1 + offset;
            decorations.push(Decoration.node(from, from + child.nodeSize, { class: FOLD_HIDDEN_CLASS }));
          } else {
            // First child carries the visible label/content and must stay shown.
          }
        });
      }
    } else {
      // Section is open: only the toggle widget was added above; nothing is hidden.
    }
  }

  return DecorationSet.create(doc, decorations);
}

/**
 * @purpose Instantiates the ProseMirror plugin that renders fold decorations and keeps them in sync with the external FoldStore.
 * @inputs store - The FoldStore whose state drives which targets are folded; owned by the shell so it survives EditorState rebuilds.
 * @outputs Plugin<DecorationSet> - Plugin managing the kdocFold decoration set, rebuilding on doc/fold changes and rescuing the caret from hidden content.
 * @dataflow Store mutations -> subscribe listener -> transaction (fold meta) -> apply rebuild -> props.decorations -> view; view updates -> auto-unfold jumps into folded sections.
 * @controlflow init builds decorations -> apply rebuilds when doc changed or fold meta set else returns prior state -> props exposes the set -> view subscribes to store and on update defers unfolding a jumped-into section via queueMicrotask -> destroy unsubscribes.
 */
export function createFoldPlugin(store: FoldStore): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: foldPluginKey,
    state: {
      init(_config: unknown, state: EditorState): DecorationSet {
        // Build initial decorations from the starting document and store.
        return buildDecorations(state.doc, store);
      },
      apply(tr: Transaction, value: DecorationSet, _oldState: EditorState, newState: EditorState): DecorationSet {
        // Rebuild when the document changed or a fold toggled via the store; otherwise keep the prior set (no doc positions moved).
        return tr.docChanged || tr.getMeta(foldPluginKey) === true ? buildDecorations(newState.doc, store) : value;
      },
    },
    props: {
      decorations(state: EditorState): DecorationSet {
        // Expose the plugin's decoration set to the view, defaulting to empty when uninitialized.
        return foldPluginKey.getState(state) ?? DecorationSet.empty;
      },
    },
    view(view: EditorView) {
      const unsubscribe = store.subscribe((): void => {
        const tr = view.state.tr.setMeta(foldPluginKey, true).setMeta('addToHistory', false);
        // A fold that swallows the caret moves it to the end of the line that stays visible, so typing never lands in hidden text.
        const hidden: ProseMirrorFoldTarget | null = hiddenFoldTargetAt(tr.doc, store, tr.selection.head);
        if (hidden !== null) {
          tr.setSelection(Selection.near(tr.doc.resolve(hidden.bodyFrom - 1), -1));
        } else {
          // Caret is not inside a folded section: leave the selection untouched.
        }
        view.dispatch(tr);
      });

      return {
        update(currentView: EditorView, previous: EditorState): void {
          const current = currentView.state;
          if (current.selection.eq(previous.selection) && current.doc.eq(previous.doc)) {
            // Nothing moved: skip so a stale folded section is not unfolded by an unrelated selection change.
            return;
          } else {
            // Selection or document changed: check whether the caret jumped into hidden content.
          }

          const hidden: ProseMirrorFoldTarget | null = hiddenFoldTargetAt(current.doc, store, current.selection.head);
          if (hidden !== null) {
            // Defer the unfold: this runs inside a view update, and dispatching there is forbidden, so schedule it on the microtask queue.
            const target = hidden;
            queueMicrotask((): void => {
              store.setFolded(target.key, false);
            });
          } else {
            // Caret is in visible content: no unfold needed.
          }
        },
        destroy(): void {
          unsubscribe();
        },
      };
    },
  });
}

/**
 * @purpose Command that toggles the fold target under the caret, delegating state changes to the FoldStore.
 * @inputs state - Current EditorState; dispatch - Optional transaction sink (present when run through a ProseMirror command chain).
 * @outputs boolean - True when a foldable target existed under the caret and was toggled, false otherwise.
 * @dataflow state.selection.head -> foldTargetAt(doc, head) -> store.toggle(key) -> plugin store listener redraws decorations.
 * @controlflow Find target at caret -> return false if none -> dispatch present ? toggle via store : no-op -> return true.
 */
export function toggleFoldCommand(store: FoldStore): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const target = foldTargetAt(state.doc, state.selection.head);
    // No foldable section under the caret: the command does nothing.
    if (target === null) {
      return false;
    } else {
      // A target: toggle it when asked to act.
    }

    if (dispatch !== undefined) {
      // Toggle through the store; the plugin's store listener redraws the decorations.
      store.toggle(target.key);
    } else {
      // Dispatch is absent (preview-only call): report success without mutating state.
    }
    return true;
  };
}

/**
 * @purpose CSS stylesheet defining relative positioning on heading/listItem containers and hover/focus reveal styles for the fold toggle widget, plus hidden-body and folded-ellipsis styling (FR-8.29).
 * @inputs None.
 * @outputs string - A CSS template literal consumed by the editor shell's style injection.
 * @dataflow Static rule strings -> single stylesheet constant exported to the shell.
 * @controlflow No logic: a constant template literal of declarative rules.
 */
export const FOLD_STYLES: string = `
.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6, .ProseMirror li { position: relative; }

.kdoc-fold-toggle { position: absolute; left: -1.5em; top: 0; width: 1.2em; padding: 0; border: none; background: transparent; color: var(--kdoc-color-text-muted); font: inherit; line-height: inherit; cursor: pointer; opacity: 0; transition: opacity 120ms; user-select: none; -webkit-user-select: none; }

li > :first-child > .kdoc-fold-toggle { left: -2.6em; }

.ProseMirror h1:hover > .kdoc-fold-toggle,
.ProseMirror h2:hover > .kdoc-fold-toggle,
.ProseMirror h3:hover > .kdoc-fold-toggle,
.ProseMirror h4:hover > .kdoc-fold-toggle,
.ProseMirror h5:hover > .kdoc-fold-toggle,
.ProseMirror h6:hover > .kdoc-fold-toggle,
.ProseMirror li:hover > :first-child > .kdoc-fold-toggle,
.kdoc-fold-toggle:focus-visible,
.kdoc-folded > .kdoc-fold-toggle,
.kdoc-folded > :first-child > .kdoc-fold-toggle { opacity: 1; }

.kdoc-fold-hidden { display: none !important; }

h1.kdoc-folded::after, h2.kdoc-folded::after, h3.kdoc-folded::after, h4.kdoc-folded::after, h5.kdoc-folded::after, h6.kdoc-folded::after, li.kdoc-folded > :first-child::after { content: ' …'; color: var(--kdoc-color-text-muted); }
`;
