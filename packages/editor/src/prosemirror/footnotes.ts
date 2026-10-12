/**
 * @file footnotes.ts
 * @purpose WYSIWYG footnote support for K-Doc's editor: an Insert Footnote command (FR-8.x), click navigation between a
 *   reference and its note, the definition node view that renders a non-editable label outside the editable body, and the
 *   stylesheet those pieces depend on. Like insert-commands.ts, every command is a pure function over EditorState/Transaction
 *   returning false instead of throwing so the editor never breaks on a click handler; structural transactions are tagged with
 *   kdocStructural to opt out of undo coalescing exactly as commands.ts and insert-commands.ts do. The navigation plugin and node
 *   view touch the DOM, but the label/insert logic does not, keeping them headless-testable.
 * @inputs ProseMirror EditorState instances (for the command), an EditorView plus user events (for navigation), and a PMNode doc
 *   (to compute the next footnote number). The kdocSchema must expose `footnoteReference` (inline atom) and `footnoteDefinition`
 *   (block, content 'block+'), both carrying `identifier: string` and `label: string | null`.
 * @outputs ProseMirror Command functions (insertFootnote), a navigation Plugin (createFootnoteNavigationPlugin), the definition
 *   node view constructor (createFootnoteDefinitionView), the stylesheet constant (FOOTNOTE_STYLES), plus read helpers
 *   (nextFootnoteLabel, findFootnote).
 * @functions
 *   - nextFootnoteLabel: Returns the next footnote number as a string by scanning for the highest numeric identifier.
 *   - insertFootnote: Command inserting an inline reference and appending its definition at end of document.
 *   - findFootnote: Locates the absolute position of a note node matching a type and identifier, else null.
 *   - jumpTo: Moves the selection to a note (into its body when inside, just before it otherwise) and scrolls into view.
 *   - createFootnoteNavigationPlugin: Plugin wiring click navigation between references and definitions.
 *   - FootnoteDefinitionView: NodeView rendering a fixed label plus an editable content region for a definition node.
 *   - createFootnoteDefinitionView: Builds the ProseMirror NodeViewConstructor for footnote definitions.
 * @dataflow EditorState -> command execution -> Transaction with reference + appended definition and kdocStructural meta -> dispatch callback; user event -> findFootnote lookup -> jumpTo selection update.
 * @controlflow Resolve schema types (return false if absent) -> verify the selection can host a reference atom -> build nodes, append the definition at doc end, set caret inside it, tag structural, and dispatch; navigation branches on click target to choose direction then applies one selection transaction.
 * @version 1
 * @date 2026-10-08
 */

import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView, NodeView, NodeViewConstructor, ViewMutationRecord } from 'prosemirror-view';

/**
 * The next footnote number as a string. Footnotes are numbered in the order they were added; an identifier such as `intro` is
 * not numeric and therefore never advances this counter (a named note like [^intro] does not take a number).
 *
 * @purpose Scans every descendant for footnote nodes whose identifier is purely digits, then returns one past that maximum.
 * @inputs doc: PMNode - The document to scan; only `footnoteReference` and `footnoteDefinition` nodes are considered.
 * @outputs string - The next label as a decimal string (e.g. '1' for an empty document).
 * @dataflow Walk descendants -> collect numeric identifiers -> take the maximum -> add one -> stringify.
 * @controlflow Visit each node, updating `highest` when a footnote carries a digit-only identifier; return highest + 1 after traversal.
 */
export function nextFootnoteLabel(doc: PMNode): string {
  let highest = 0;
  // Walk every descendant so both references and definitions contribute to the running maximum.
  doc.descendants((node) => {
    if (node.type.name === 'footnoteReference' || node.type.name === 'footnoteDefinition') {
      const id = node.attrs.identifier;
      // Only a purely-numeric identifier counts toward numbering, so named notes like [^intro] are ignored.
      if (typeof id === 'string' && /^\d+$/.test(id)) {
        highest = Math.max(highest, Number(id));
      } else {
        // Identifier is absent or non-numeric: leave `highest` unchanged for this node.
      }
    }
    return true;
  });
  return String(highest + 1);
}

/**
 * @purpose Creates a command that inserts an inline footnote reference at the caret and appends its definition to the end of the document.
 *   The reference is placed where the selection currently is (when the parent's content model permits) and the note body follows it, so
 *   references stay in place while their definitions accumulate sequentially; the transaction is tagged structural to keep it out of undo coalescing.
 * @inputs None — the command reads only from EditorState at call time.
 * @outputs Command - A ProseMirror command returning false when `footnoteReference`, `footnoteDefinition`, or `paragraph` is absent from the schema,
 *   or when the selection cannot host a reference atom (e.g. inside a code block); otherwise inserting the pair and dispatching a structural transaction.
 * @dataflow Resolve node types -> validate canReplaceWith at $from -> compute next label -> replaceSelectionWith(reference) -> append definitionType(identifier, paragraph()) at doc end -> set caret into that paragraph.
 * @controlflow Return false on missing schema or inapplicable selection (dry-run returns true when applicable); branch on dispatch to build/apply the transaction and return true.
 */
export function insertFootnote(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const referenceType = state.schema.nodes['footnoteReference'];
    const definitionType = state.schema.nodes['footnoteDefinition'];
    const paragraphType = state.schema.nodes['paragraph'];
    // If any required node type is missing from the schema, there is nothing to insert.
    if (referenceType === undefined || definitionType === undefined || paragraphType === undefined) {
      return false;
    } else {
      // All three node types resolved: continue validating applicability at the current selection.
    }

    const { $from } = state.selection;
    // canReplaceWith asks whether the parent's content model allows replacing the selected range with a single reference atom, which is false in contexts that forbid inline nodes (e.g. inside a code block).
    if (!$from.parent.canReplaceWith($from.index(), $from.indexAfter(), referenceType)) {
      return false;
    } else {
      // The selection can host a reference: continue building the transaction when dispatch is supplied.
    }

    // A dry-run query (no dispatch) means "is this applicable?"; applicability was just established above.
    if (dispatch === undefined) {
      return true;
    } else {
      // Dispatch present: proceed to construct and apply the transaction.
    }

    const label = nextFootnoteLabel(state.doc);
    // The reference carries both identifier (the stable key linking it to its definition) and a display label.
    const tr = state.tr.replaceSelectionWith(referenceType.create({ identifier: label, label }), false);
    // A definition is a block containing one empty paragraph; the caret will be placed inside that paragraph after insertion.
    const definition = definitionType.create({ identifier: label, label }, paragraphType.create());
    const end = tr.doc.content.size;
    // Append the new definition at the very end of the document so notes accumulate sequentially after their references.
    tr.insert(end, definition);
    // Place the caret inside the new note's empty paragraph: `end + 2` descends from doc into the definition and then its paragraph.
    tr.setSelection(TextSelection.create(tr.doc, end + 2));
    tr.scrollIntoView();
    tr.setMeta('kdocStructural', true);
    dispatch(tr);
    return true;
  };
}

/**
 * @purpose Locates the absolute document position of a footnote node matching a given type and identifier.
 *   Used by navigation to resolve a reference's `identifier` to its definition (and vice versa) so clicks can jump between them.
 * @inputs doc: PMNode - The document to search within. typeName: 'footnoteReference' | 'footnoteDefinition' - Which node kind to match. identifier: string - The exact identifier value to find.
 * @outputs number | null - The absolute position of the matching node, or null when no such node exists in the document.
 * @dataflow Walk descendants with positions -> compare type name and identifier -> capture first match's position.
 * @controlflow Visit nodes depth-first; return false from the visitor to stop early once found; otherwise scan the whole tree and fall through to null.
 */
function findFootnote(doc: PMNode, typeName: 'footnoteReference' | 'footnoteDefinition', identifier: string): number | null {
  let found: number | null = null;
  // Walk descendants with their positions so a match can be jumped to by absolute position rather than re-resolved later.
  doc.descendants((node, pos) => {
    if (found !== null) {
      // Already located the target: stop traversing further nodes.
      return false;
    } else {
      // Target not yet found: keep scanning this node's subtree unless it is a match below.
    }

    if (node.type.name === typeName && node.attrs.identifier === identifier) {
      // Exact type and identifier match: record the position and stop searching.
      found = pos;
      return false;
    } else {
      // Not the target node: continue to the next descendant.
      return true;
    }
  });
  return found;
}

/**
 * @purpose Moves the editor selection to a note and scrolls it into view, entering its body when jumping from a reference (inside) or stopping just before it when jumping back to a reference.
 *   The asymmetry keeps references readable: arriving at a definition places the caret inside so the user can edit; returning to a reference leaves the caret outside so typing does not corrupt the atom.
 * @inputs view: EditorView - The editor whose selection is being moved. pos: number - The absolute position of the target note node (its start). inside: boolean - True when jumping into a definition's body, false when stopping at a reference.
 * @outputs void - Mutates the view's state via dispatch and focuses the editor; returns nothing to inspect.
 * @dataflow Resolve target position -> build selection transaction with scrollIntoView -> dispatch -> focus the DOM.
 * @controlflow Choose inside vs before offset, clamp inside offsets to doc end, then apply one selection transaction and focus.
 */
function jumpTo(view: EditorView, pos: number, inside: boolean): void {
  // Inside a note its first paragraph begins two levels deep; at a reference stop just before it so the atom is not selected for editing.
  const target = inside ? Math.min(pos + 2, view.state.doc.content.size) : pos;
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(target))).scrollIntoView());
  view.focus();
}

/**
 * @purpose Creates a plugin that lets the user click between a footnote reference and its definition in either direction.
 *   Clicking an inline reference jumps to its block definition; clicking a definition's non-editable label jumps back to the matching reference, so navigation is symmetric without requiring keyboard shortcuts.
 * @inputs None — configuration lives entirely inside the returned plugin's ProseMirror props.
 * @outputs Plugin - A ProseMirror plugin exposing handleClickOn (reference -> definition) and handleDOMEvents.mousedown (definition label -> reference).
 * @dataflow DOM/ProseMirror click event -> resolve identifier -> findFootnote lookup -> jumpTo with direction flag -> boolean result driving editor handling.
 * @controlflow Return false to let the default handler act when the target type or identifier is absent; otherwise perform the jump and return true to claim the event.
 */
export function createFootnoteNavigationPlugin(): Plugin {
  return new Plugin({
    props: {
      // Clicking an inline reference should navigate to its block definition so a reader can read the note in place.
      handleClickOn(view, _pos, node) {
        if (node.type.name !== 'footnoteReference') {
          // Not a footnote reference: let ProseMirror handle this click normally.
          return false;
        } else {
          // Footnote reference clicked: resolve its identifier and jump to the matching definition.
        }

        const identifier = node.attrs.identifier;
        if (typeof identifier !== 'string') {
          // Identifier is missing or non-string: there is no note to navigate to, so do not claim the click.
          return false;
        } else {
          // Valid string identifier: continue locating its definition.
        }

        const target = findFootnote(view.state.doc, 'footnoteDefinition', identifier);
        if (target === null) {
          // No matching definition exists in this document: leave the click unhandled rather than throwing.
          return false;
        } else {
          // Definition located: jump into its body and claim the event.
        }

        jumpTo(view, target, true);
        return true;
      },
      handleDOMEvents: {
        // A mousedown on the definition's label navigates back to the reference that produced it; using mousedown (rather than click) lets us preventDefault before ProseMirror moves the caret.
        mousedown(view, event) {
          const element = event.target instanceof Element ? event.target.closest('.kdoc-footnote-label') : null;
          if (element === null) {
            // The click did not originate on or inside a footnote label: let the default handler act.
            return false;
          } else {
            // Click landed on a definition label: read its identifier and jump back to the reference.
          }

          const identifier = element.getAttribute('data-footnote');
          if (identifier === null) {
            // The label carries no data-footnote attribute: nothing to navigate from, so do not claim the event.
            return false;
          } else {
            // Identifier present: locate its reference and jump back out of the note body.
          }

          const target = findFootnote(view.state.doc, 'footnoteReference', identifier);
          if (target === null) {
            // No matching reference exists in this document: leave the click unhandled rather than throwing.
            return false;
          } else {
            // Reference located: jump to it from outside and claim the event.
          }

          event.preventDefault();
          jumpTo(view, target, false);
          return true;
        },
      },
    },
  });
}

/**
 * The node view for a footnote definition, rendering a fixed (non-editable) label to the left of an editable body.
 *
 * ProseMirror renders every node through `spec.toDOM` unless a `nodeViews` entry exists; this class supplies that entry so a
 * definition is drawn as `<div.kdoc-footnote-definition>` containing a non-editable `<span.kdoc-footnote-label>` and an editable
 * `<div.kdoc-footnote-body>`. The label sits outside the content region, exactly as required by FR-8.x ("label outside the editable content").
 */
class FootnoteDefinitionView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  private readonly label: HTMLElement;
  private node: PMNode;

  /**
   * @purpose Constructs the definition view, assembling the DOM skeleton (label + body) and rendering initial attributes.
   * @inputs node: PMNode - The footnoteDefinition node this view represents at construction time.
   * @outputs void - Initializes `dom`, `contentDOM`, and `label`; no return value is inspected by ProseMirror beyond these fields.
   * @dataflow document.createElement calls -> assemble label/body under dom -> render() copies attrs onto the DOM attributes.
   * @controlflow Assign node, create elements, set classes/contentEditable/title, append children in order, then render once.
   */
  constructor(node: PMNode) {
    this.node = node;
    const dom = document.createElement('div');
    dom.className = 'kdoc-footnote-definition';
    const label = document.createElement('span');
    label.className = 'kdoc-footnote-label';
    // The label is decorative navigation, not editable text: contentEditable=false keeps typing from corrupting it.
    label.contentEditable = 'false';
    label.title = 'Go to the reference';
    const contentDOM = document.createElement('div');
    contentDOM.className = 'kdoc-footnote-body';
    dom.append(label, contentDOM);
    this.dom = dom;
    this.label = label;
    this.contentDOM = contentDOM;
    this.render();
  }

  /**
   * @purpose Copies the node's identifier and display label onto both the label element (for rendering) and the root DOM element (so a mousedown can read them back).
   * @inputs None — reads from `this.node`, which is kept current by update().
   * @outputs void - Mutates textContent and data-footnote attributes on this.label and this.dom; no return value.
   * @dataflow node.attrs.identifier/label -> string coercion (non-string falls back to identifier) -> DOM attribute/text updates.
   * @controlflow Coerce each attr to string-or-identifier, then write label text first followed by the shared data-footnote key on both elements.
   */
  private render(): void {
    const identifier = typeof this.node.attrs.identifier === 'string' ? this.node.attrs.identifier : '';
    // The display label falls back to the identifier when it is not a string, so a note always shows something readable.
    const label = typeof this.node.attrs.label === 'string' ? this.node.attrs.label : identifier;
    this.label.textContent = label;
    // Both elements carry data-footnote so navigation can read the key from either side of the click target.
    this.label.setAttribute('data-footnote', identifier);
    this.dom.setAttribute('data-footnote', identifier);
  }

  /**
   * @purpose Updates the view when ProseMirror re-renders it, rejecting updates that change the node type (which would require a fresh view).
   * @inputs node: PMNode - The new version of the footnoteDefinition node after an edit.
   * @outputs boolean - True to keep this same NodeView instance, false to have ProseMirror tear it down and build another.
   * @dataflow Compare incoming type -> replace stored node -> re-render attributes on existing DOM.
   * @controlflow Return false immediately when the type changed; otherwise refresh `this.node` and call render(), returning true.
   */
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) {
      // The node's type changed, which this view cannot represent: signal ProseMirror to rebuild it elsewhere.
      return false;
    } else {
      // Same node type: keep this instance and refresh its attributes from the updated node.
    }

    this.node = node;
    this.render();
    return true;
  }

  /**
   * @purpose Tells ProseMirror to ignore DOM mutations that occur inside the editable body, so typing within a note does not force an unnecessary re-render of the whole definition (label included).
   * @inputs mutation: ViewMutationRecord - The recorded MutationRecord or selection change.
   * @outputs boolean - True when the mutation is outside the content region and should be ignored by ProseMirror's reconciliation, false for body mutations that must be reconciled.
   * @dataflow Inspect mutation.target -> compare against this.contentDOM containment.
   * @controlflow Return true (ignore) unless the target lives inside the editable body, which is returned as false to keep it in sync.
   */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    // Mutations originating within the editable body are expected typing; everything else (e.g. label attribute changes) can be ignored here.
    return !this.contentDOM.contains(mutation.target);
  }
}

/**
 * @purpose Builds a NodeViewConstructor that wraps FootnoteDefinitionView for ProseMirror's node view registry.
 * @inputs None — the returned constructor receives each footnoteDefinition node as its argument.
 * @outputs NodeViewConstructor - A factory `(node) => NodeView` constructing one FootnoteDefinitionView per definition node.
 * @dataflow Factory invocation with a PMNode -> new FootnoteDefinitionView(node) -> returned NodeView instance.
 * @controlflow Return the constructor directly; construction happens lazily when ProseMirror mounts each note.
 */
export function createFootnoteDefinitionView(): NodeViewConstructor {
  return (node: PMNode): NodeView => new FootnoteDefinitionView(node);
}

/**
 * Stylesheet for footnote references and definitions, keyed on the `.ProseMirror` root so it does not leak into other editors.
 *
 * The reference is a small superscript pointer; the definition lays out its fixed label beside an elastic body via flexbox with a left rule to visually group notes from their surrounding text.
 */
export const FOOTNOTE_STYLES: string = `
.ProseMirror sup.kdoc-footnote-reference { font-size: 0.75em; line-height: 0; vertical-align: super; color: var(--kdoc-color-accent); cursor: pointer; padding: 0 1px; }
.ProseMirror .kdoc-footnote-definition { display: flex; gap: 0.6em; margin: 0.4em 0; padding: 0.3em 0 0.3em 0.6em; border-left: 2px solid var(--kdoc-color-border); font-size: 0.92em; }
.ProseMirror .kdoc-footnote-label { flex: none; min-width: 1.5em; color: var(--kdoc-color-accent); font-weight: 600; cursor: pointer; user-select: none; }
.ProseMirror .kdoc-footnote-label::after { content: '.'; }
.ProseMirror .kdoc-footnote-body { flex: 1; min-width: 0; }
.ProseMirror .kdoc-footnote-body > :first-child { margin-top: 0; }
.ProseMirror .kdoc-footnote-body > :last-child { margin-bottom: 0; }
`;
