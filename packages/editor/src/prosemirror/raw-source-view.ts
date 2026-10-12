/**
 * @file raw-source-view.ts
 * @purpose ProseMirror NodeView that edits a raw HTML node's source in an embedded CodeMirror editor with highlighting (FR-7.9).
 * @inputs unknownBlock/unknownInline nodes, the outer EditorView, getPos.
 * @outputs RawSourceView and createRawSourceNodeViews.
 * @functions
 *   - RawSourceView: the node view.
 *   - createRawSourceNodeViews: node view constructors keyed by node name.
 * @dataflow CodeMirror edit -> setNodeMarkup on the outer document; outer update -> CodeMirror doc.
 * @controlflow Construct -> edit/sync -> leave on edge keys -> destroy.
 * @version 2
 * @date 2026-09-16
 */
import { EditorState as CodeState, type Extension } from '@codemirror/state';
import { EditorView as CodeView, keymap, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { syntaxHighlighting } from '@codemirror/language';
import { classHighlighter } from '@lezer/highlight';
import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view';
import { rawSourceOf, withRawValue } from './raw-source.js';
import { unknownNodeText } from './reference-links.js';
import { atEdge, isHistoryKey } from './raw-source-keys.js';

export class RawSourceView implements NodeView {
  readonly dom: HTMLElement;
  private node: PMNode;
  private readonly code: CodeView | null;
  private syncing: boolean = false;
  constructor(node: PMNode, private readonly outer: EditorView, private readonly getPos: () => number | undefined, inline: boolean) {
    this.node = node;
    const source = rawSourceOf(node.attrs['node']);
    this.dom = document.createElement(inline ? 'span' : 'div');
    if (source === null) {
      // Not a source-only node, so it stays rendered as it was.
      this.dom.className = inline ? 'kdoc-unknown-inline' : 'kdoc-unknown-block';
      // Raw value, a readable definition line, or the placeholder, as the schema renders it.
      this.dom.textContent = unknownNodeText(node.attrs['node'], inline);
      this.code = null;
      return;
    } else {
      // A source-only node, so it renders an embedded editor for its raw HTML.
      this.dom.className = inline ? 'kdoc-raw-inline' : 'kdoc-raw-block';
      this.dom.setAttribute('data-raw-language', source.language ?? 'text');
      if (!inline) {
        const label = document.createElement('span');
        label.className = 'kdoc-raw-label';
        label.contentEditable = 'false';
        label.textContent = source.label;
        this.dom.append(label);
      } else {
        // Inline nodes have no visible label.
      }
      const extensions: Extension[] = [];
      if (source.language === 'html') {
        extensions.push(html());
      } else {
        // HTML highlighting is not requested, so only generic syntax highlighting applies.
      }
      extensions.push(syntaxHighlighting(classHighlighter));
      if (!inline) {
        extensions.push(CodeView.lineWrapping);
      } else {
        // Inline editing keeps the source on a single line.
      }
      extensions.push(keymap.of([
        { key: 'Escape', run: (): boolean => this.leave(1) },
        { key: 'ArrowUp', run: (v: CodeView): boolean => this.atVerticalEdge(v, -1) && this.leave(-1) },
        { key: 'ArrowDown', run: (v: CodeView): boolean => this.atVerticalEdge(v, 1) && this.leave(1) },
        { key: 'ArrowLeft', run: (v: CodeView): boolean => atEdge(v.state, -1, 'char') && this.leave(-1) },
        { key: 'ArrowRight', run: (v: CodeView): boolean => atEdge(v.state, 1, 'char') && this.leave(1) },
      ]));
      // CodeMirror's own editing keys -- Home, End, word motion, Select All -- after the edge keys above, so an
      // arrow at the widget's edge leaves it and any other arrow moves the caret as normal. Without this the
      // widget had no Home or End at all. It carries no undo keys; undo stays with the document.
      extensions.push(keymap.of(defaultKeymap));
      extensions.push(CodeView.domEventHandlers({
        keydown: (event: KeyboardEvent): boolean => {
          // Undo belongs to the document's single history; every widget edit is already a document edit.
          if (isHistoryKey(event)) {
            const handled = this.outer.someProp('handleKeyDown', (f) => f(this.outer, event)) === true;
            if (handled) {
              event.preventDefault();
            } else {
              // The history key was recognised but not consumed by the document.
            }
            return handled;
          } else {
            // Any other key is the embedded editor's own.
            return false;
          }
        },
      }));
      extensions.push(CodeView.updateListener.of((update: ViewUpdate): void => {
        this.onCodeUpdate(update);
      }));
      this.code = new CodeView({ parent: this.dom, state: CodeState.create({ doc: source.text, extensions }) });
    }
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) {
      // A different node type needs its own view rather than an in-place update.
      return false;
    } else {
      const source = rawSourceOf(node.attrs['node']);
      if ((source === null) !== (this.code === null)) {
        // The source-ness changed, so the view kind must change too.
        return false;
      } else {
        this.node = node;
        if (this.code !== null && source !== null && source.text !== this.code.state.doc.toString()) {
          this.syncing = true;
          try {
            this.code.dispatch({ changes: { from: 0, to: this.code.state.doc.length, insert: source.text } });
          } finally {
            this.syncing = false;
          }
        } else {
          // The rendered kind is unchanged and the text matches, so nothing needs syncing.
        }
        return true;
      }
    }
  }
  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode');
    this.code?.focus();
  }
  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode');
  }
  stopEvent(event: Event): boolean {
    return this.code !== null && event.target instanceof Node && this.code.dom.contains(event.target);
  }
  ignoreMutation(): boolean {
    return true;
  }
  destroy(): void {
    this.code?.destroy();
  }
  /**
   * @purpose True when an up or down arrow would move past the widget's first or last visual row.
   * @inputs view - the embedded editor; dir - -1 for up, 1 for down.
   * @outputs boolean.
   * @dataflow document-line edge + caret and edge coordinates -> boolean.
   * @controlflow Not on the first/last document line -> false; no layout -> document lines decide; else compare rows.
   *
   * Block widgets wrap long lines, so one document line can span several rows on screen. Counting document lines
   * alone made ArrowDown on the first row of a wrapped line leave the widget and skip the rest of it -- found by
   * pressing it in the running app. The caret's own row is compared with the row holding the text's start or end.
   */
  private atVerticalEdge(view: CodeView, dir: -1 | 1): boolean {
    // Check whether the caret is even on the first or last document line.
    if (!atEdge(view.state, dir, 'line')) {
      // It is not: the arrow stays inside.
      return false;
    } else {
      // It is: now check the visual row, since wrapping can put more rows beyond it.
    }
    const head: number = view.state.selection.main.head;
    const here = measureAt(view, head);
    const edge = measureAt(view, dir < 0 ? 0 : view.state.doc.length);
    // Check whether the view has layout to measure rows with.
    if (here === null || edge === null) {
      // No layout (a headless test, a hidden pane): document lines are the best answer available.
      return true;
    } else {
      // Measured: on the outer row only when the caret's row lines up with the edge row.
      return dir < 0 ? here.top <= edge.top + 1 : here.bottom >= edge.bottom - 1;
    }
  }

  private leave(dir: -1 | 1): boolean {
    const pos = this.getPos();
    if (pos === undefined) {
      // The node has no stable position, so it cannot be navigated away from.
      return false;
    } else {
      const target = dir < 0 ? pos : pos + this.node.nodeSize;
      const selection = TextSelection.near(this.outer.state.doc.resolve(target), dir);
      this.outer.dispatch(this.outer.state.tr.setSelection(selection).scrollIntoView());
      this.outer.focus();
      return true;
    }
  }
  private onCodeUpdate(update: ViewUpdate): void {
    if (!update.docChanged || this.syncing) {
      // Nothing changed, or an update is already in flight from the outer document.
      return;
    } else {
      const pos = this.getPos();
      if (pos === undefined) {
        // The node has no stable position, so its source cannot be written back.
        return;
      } else {
        const attrs = { ...this.node.attrs, node: withRawValue(this.node.attrs['node'], update.state.doc.toString()) };
        this.outer.dispatch(this.outer.state.tr.setNodeMarkup(pos, undefined, attrs));
        // Written through immediately so the Source pane, the outline and a save all see it.
      }
    }
  }
}

/**
 * @purpose Screen coordinates of a position, or null where the view cannot measure layout.
 * @inputs view - the embedded editor; pos - a document offset.
 * @outputs The coordinates, or null.
 * @dataflow view.coordsAtPos -> coordinates, or null on a missing layout API.
 * @controlflow Try to measure; a TypeError means no layout API and yields null; any other error propagates.
 *
 * CodeMirror measures through Range.getClientRects, which a headless DOM such as jsdom does not implement, and it
 * throws a TypeError there rather than returning null. That one failure means "no layout", so it is answered with
 * null; anything else is a real fault and is rethrown rather than swallowed.
 */
function measureAt(view: CodeView, pos: number): { readonly top: number; readonly bottom: number } | null {
  try {
    return view.coordsAtPos(pos);
  } catch (caught: unknown) {
    // Check whether this is the missing-layout-API failure.
    if (caught instanceof TypeError) {
      // No layout to measure: let the caller fall back to document lines.
      return null;
    } else {
      // Some other fault: not ours to hide.
      throw caught;
    }
  }
}

export function createRawSourceNodeViews(): { readonly unknownBlock: NodeViewConstructor; readonly unknownInline: NodeViewConstructor } {
  return {
    unknownBlock: (node: PMNode, view: EditorView, getPos: () => number | undefined): NodeView => new RawSourceView(node, view, getPos, false),
    unknownInline: (node: PMNode, view: EditorView, getPos: () => number | undefined): NodeView => new RawSourceView(node, view, getPos, true),
  };
}
