/**
 * @file code-copy-plugin.ts
 * @purpose ProseMirror plugin providing a copy button widget on code blocks in the K-Doc pane (FR-8.8).
 *   The button is a widget, so it is not part of the document: it must never end up in the text a copy
 *   produces, which would be a copy button that copies itself.
 *   It is deliberately a separate plugin from the highlighter. Copying works for every fence, highlighted or
 *   not, because it has nothing to do with the grammar — tying the two together would mean a bash block lost
 *   its copy button for the unrelated reason that K-Doc ships no bash parser.
 * @inputs ProseMirror EditorState instances, Transactions, and codeBlock document nodes.
 * @outputs ProseMirror Plugin managing a DecorationSet of copy button widget decorations, keyed by codeCopyPluginKey.
 * @functions
 *   - createCodeCopyPlugin: Instantiates the ProseMirror plugin providing copy button widget decorations for code blocks.
 * @dataflow Document codeBlock nodes -> extract text content -> create widget decorations with copyButton factory -> DecorationSet -> view.
 * @controlflow Initialize decorations on plugin init -> on transaction apply: return existing mapped decorations if doc unchanged, rebuild decorations if doc changed -> props.decorations exposes DecorationSet.
 * @version 1
 * @date 2026-09-11
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorState, Transaction } from 'prosemirror-state';

/**
 * Plugin key uniquely identifying the code block copy button plugin and its state in an EditorState.
 */
export const codeCopyPluginKey: PluginKey<DecorationSet> = new PluginKey<DecorationSet>('codeCopyPlugin');

/**
 * CSS class name applied to code block copy buttons (FR-8.8).
 */
export const CODE_COPY_CLASS: string = 'kdoc-code-copy';

/**
 * CSS stylesheet defining relative positioning on code block containers and hover/focus reveal styles for the copy button.
 */
export const CODE_COPY_STYLES: string = `
pre {
  position: relative;
}

.kdoc-code-copy {
  position: absolute;
  top: 4px;
  right: 4px;
  opacity: 0;
  transition: opacity 120ms;
  font-size: 11px;
  padding: 2px 6px;
  border: 1px solid var(--kdoc-color-border, #d0d7de);
  border-radius: 3px;
  background: var(--kdoc-color-background, #ffffff);
  color: var(--kdoc-color-text, #1f2328);
  cursor: pointer;
  /* The button lives inside the <pre>, so without this its label joins the block's DOM text and a
     native selection drag over the code would carry "Copy" into the clipboard -- a copy button that
     copies itself. ProseMirror's own copy serialises the document rather than the DOM and was never
     affected; this is for the selection the browser makes on its own. */
  user-select: none;
  -webkit-user-select: none;
}

/* The button appears on hover and on keyboard focus, because a control that only appears under a pointer cannot be reached without one. */
pre:hover .kdoc-code-copy,
.kdoc-code-copy:focus-visible {
  opacity: 1;
}
`;

/**
 * Constructs the DOM button element for copying code block contents to the clipboard.
 *
 * @purpose Creates a non-editable button widget that writes the code block's text content to the system clipboard upon user interaction.
 * @inputs
 *   - doc: Document - The DOM Document in which the button element is created.
 *   - text: string - The text content of the code block to copy.
 * @outputs HTMLElement - The configured HTMLButtonElement widget.
 * @dataflow text -> click event -> navigator.clipboard.writeText -> temporary textContent feedback update.
 * @controlflow Create button element -> set attributes and class -> register click event listener (preventDefault, stopPropagation, writeText, update label to 'Copied', schedule reset to 'Copy' after 1200ms) -> return button.
 */
function copyButton(doc: Document, text: string): HTMLElement {
  const button: HTMLButtonElement = doc.createElement('button');
  button.type = 'button';
  button.className = CODE_COPY_CLASS;
  button.textContent = 'Copy';
  button.setAttribute('contenteditable', 'false');
  button.setAttribute('aria-label', 'Copy code');

  button.addEventListener('click', (event: MouseEvent): void => {
    // The button sits inside an editable node and a click reaching the editor would put the caret inside the code.
    event.preventDefault();
    event.stopPropagation();

    // Write code block text to clipboard and update button label.
    // The label is the only feedback there is: a copy that says nothing is indistinguishable from a copy that failed.
    void navigator.clipboard.writeText(text);
    button.textContent = 'Copied';

    setTimeout((): void => {
      button.textContent = 'Copy';
    }, 1200);
  });

  return button;
}

/**
 * Scans the document for code blocks and builds a DecorationSet of copy button widget decorations.
 *
 * @purpose Traverses all nodes in the document, identifies code blocks, and creates widget decorations anchored before their first text character.
 * @inputs
 *   - state: EditorState - The ProseMirror EditorState whose document is scanned for code blocks.
 * @outputs DecorationSet - The complete set of copy button widget decorations for all code blocks in the document.
 * @dataflow state.doc -> descendants traversal -> filter codeBlock nodes -> extract textContent -> instantiate widget decorations with copyButton -> DecorationSet.create.
 * @controlflow Traverse doc nodes via descendants -> return true for non-codeBlock nodes to descend -> for codeBlock, push widget decoration and return false -> return DecorationSet.
 */
function buildDecorations(state: EditorState): DecorationSet {
  const decorations: Decoration[] = [];

  state.doc.descendants((node, pos) => {
    // Check if the current node is not a code block.
    if (node.type.name !== 'codeBlock') {
      // Not a code block: return true to continue descending into child nodes.
      return true;
    } else {
      // Node is a code block: capture its text content for the clipboard payload.
      const text: string = node.textContent;

      // The owning Document is taken from the view rather than the global because the plugin has no business assuming the editor lives in the same document the module was loaded into.
      // side: -1 anchors the button before the first character so it does not drift as the code is edited.
      // key: a stable key lets ProseMirror reuse the node rather than rebuilding a button that is identical every time.
      decorations.push(
        Decoration.widget(
          pos + 1,
          (view) => copyButton(view.dom.ownerDocument, text),
          { side: -1, key: 'kdoc-code-copy' },
        ),
      );

      // Return false because a code block's children are text and there is nothing inside worth walking.
      return false;
    }
  });

  return DecorationSet.create(state.doc, decorations);
}

/**
 * Creates the ProseMirror plugin that attaches a copy button widget to each code block (FR-8.8).
 *
 * @purpose Instantiates and configures the ProseMirror plugin that generates and maintains copy button widget decorations for code blocks.
 * @inputs None.
 * @outputs Plugin<DecorationSet> - Configured ProseMirror plugin instance managing code block copy button widgets.
 * @dataflow Dispatched transactions -> apply() updates or maps DecorationSet -> decorations() returns active DecorationSet to view.
 * @controlflow Instantiate Plugin with codeCopyPluginKey -> state.init builds initial decorations -> state.apply maps existing decorations if doc unchanged or rebuilds if doc changed -> props.decorations retrieves state decorations.
 */
export function createCodeCopyPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: codeCopyPluginKey,
    state: {
      init(_config: unknown, state: EditorState): DecorationSet {
        // Build initial copy button widget decorations from the initial document state.
        return buildDecorations(state);
      },
      apply(tr: Transaction, value: DecorationSet, _old: EditorState, newState: EditorState): DecorationSet {
        // Check whether the document content was modified by this transaction.
        if (!tr.docChanged) {
          // Document did not change: map existing decorations across transaction mapping.
          return value.map(tr.mapping, tr.doc);
        } else {
          // Document changed: rebuild decorations because the button's text is the block's content so it goes stale the moment the code changes.
          return buildDecorations(newState);
        }
      },
    },
    props: {
      decorations(state: EditorState): DecorationSet {
        // Return active decoration set from plugin state, defaulting to empty set when state is uninitialized.
        return codeCopyPluginKey.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}
