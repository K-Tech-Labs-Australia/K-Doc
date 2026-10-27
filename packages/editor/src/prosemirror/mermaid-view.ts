/**
 * @file mermaid-view.ts
 * @purpose ProseMirror node view for code blocks that renders Mermaid diagrams with live editing, debounced rendering, and caret focus tracking.
 * @inputs ProseMirror EditorState instances, Transactions, codeBlock document nodes, and CodeBlockViewOptions containing diagram renderer and debounce configurations.
 * @outputs Mermaid node views, PlainCodeBlockView fallback instances, Mermaid focus decoration plugin, and CSS styling rules.
 * @functions
 *   - mermaidBlockAt: Locates the document range of the Mermaid code block encompassing the current selection, if any.
 *   - createMermaidFocusPlugin: Creates a ProseMirror plugin that decorates the active Mermaid block with an editing class.
 *   - createCodeBlockNodeView: Creates a NodeViewConstructor rendering Mermaid blocks as interactive diagrams and other blocks as plain code.
 * @dataflow Document codeBlock nodes & user input -> MermaidView / PlainCodeBlockView -> DiagramRenderer.render -> SVG data URI -> img.src; selection changes -> createMermaidFocusPlugin -> MERMAID_EDITING_CLASS decoration.
 * @controlflow Mount node view -> schedule initial render on visibility/intersection -> debounce redraw on text edit -> update preview and error state; track caret position via plugin to toggle editing mode.
 * @version 1
 * @date 2026-10-28
 */

import { NodeSelection, Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import type { EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorView, NodeView, NodeViewConstructor, ViewMutationRecord } from 'prosemirror-view';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { isMermaidLanguage, svgToDataUri } from '../diagrams/mermaid-renderer.js';
import type { DiagramRenderer, DiagramTheme } from '../diagrams/mermaid-renderer.js';

/** Class name applied to the active Mermaid block node view while editing. */
export const MERMAID_EDITING_CLASS = 'kdoc-mermaid-editing';

/** Class name applied to the Mermaid block container when diagram rendering fails. */
export const MERMAID_INVALID_CLASS = 'kdoc-mermaid-invalid';

/** Debounce pause in milliseconds after the last keystroke before redrawing the diagram. */
export const MERMAID_DEBOUNCE_MS = 300; // pause after the last keystroke before redrawing

/** Root margin string for IntersectionObserver to render diagrams before scrolling into view (NFR-1). */
export const MERMAID_ROOT_MARGIN = '400px 0px'; // draw a diagram this far before it scrolls into view (NFR-1)

/** PluginKey for the Mermaid focus decoration plugin. */
export const mermaidFocusPluginKey: PluginKey<DecorationSet> = new PluginKey<DecorationSet>('mermaidFocus');

/** Configuration options for the code block node view constructor. */
export interface CodeBlockViewOptions {
  readonly render: DiagramRenderer;
  readonly debounceMs?: number;
}

/**
 * Finds the document span of the Mermaid code block encompassing the current selection.
 *
 * @purpose Identifies if the current EditorState selection targets or resides within a Mermaid code block.
 * @inputs state - The ProseMirror EditorState to inspect.
 * @outputs { readonly from: number; readonly to: number } | null - Node boundary range if active, null otherwise.
 * @dataflow state.selection -> NodeSelection check / $from.parent inspection -> boundary calculations -> range or null.
 * @controlflow If NodeSelection on Mermaid codeBlock, return its range; if text selection inside Mermaid codeBlock and within bounds, return its node range; otherwise return null.
 */
export function mermaidBlockAt(state: EditorState): { readonly from: number; readonly to: number } | null {
  const sel = state.selection;

  // Check if the selection is a node selection directly targeting a node.
  if (sel instanceof NodeSelection) {
    const node = sel.node;
    // Check if the selected node is a code block configured with Mermaid syntax.
    if (node.type.name === 'codeBlock' && isMermaidLanguage(node.attrs.language)) {
      return { from: sel.from, to: sel.to };
    } else {
      // Selected node is not a Mermaid code block.
      return null;
    }
  } else {
    // Selection is not a NodeSelection; inspect the text/caret selection context.
  }

  const $from = sel.$from;
  const parent = $from.parent;

  // Check if the selection's parent container is a code block configured with Mermaid syntax.
  if (parent.type.name !== 'codeBlock' || !isMermaidLanguage(parent.attrs.language)) {
    return null;
  } else {
    // Selection parent is a Mermaid code block; determine its document boundaries.
  }

  const from = $from.before();
  const to = from + parent.nodeSize;

  // Check if the selection extends beyond the end of the code block.
  // A selection that runs out of the block does not open it.
  if (sel.to > to - 1) {
    return null;
  } else {
    // Selection is contained entirely within the Mermaid code block.
    return { from, to };
  }
}

/**
 * Computes the node decoration marking the active Mermaid code block for editing.
 *
 * A node decoration's class lands on the node view's outer element, so the stylesheet alone decides whether the code shows.
 *
 * @purpose Builds a DecorationSet containing a node decoration if the caret or selection resides in a Mermaid block.
 * @inputs state - The current ProseMirror EditorState.
 * @outputs DecorationSet - Set containing the node decoration with MERMAID_EDITING_CLASS, or empty DecorationSet.
 * @dataflow EditorState -> mermaidBlockAt -> Decoration.node -> DecorationSet.
 * @controlflow Locate active Mermaid block -> if present, create node decoration covering its span; otherwise return DecorationSet.empty.
 */
function buildDecorations(state: EditorState): DecorationSet {
  const block = mermaidBlockAt(state);
  // Check if the current selection is inside or selecting a Mermaid block.
  if (block === null) {
    // No active Mermaid block: return empty decoration set.
    return DecorationSet.empty;
  } else {
    // Active Mermaid block found: create node decoration applying the editing class to its outer element.
    return DecorationSet.create(state.doc, [
      Decoration.node(block.from, block.to, { class: MERMAID_EDITING_CLASS }),
    ]);
  }
}

/**
 * Creates the ProseMirror plugin that tracks caret focus and marks the active Mermaid block.
 *
 * @purpose Instantiates a plugin that adds MERMAID_EDITING_CLASS to the active Mermaid block node view.
 * @inputs None.
 * @outputs Plugin<DecorationSet> - Configured ProseMirror plugin instance.
 * @dataflow Transactions modifying doc or selection -> apply rebuilds DecorationSet -> props.decorations exposes it.
 * @controlflow Init builds decorations for initial state -> apply rebuilds if docChanged or selectionSet; otherwise retains old -> props.decorations retrieves state.
 */
export function createMermaidFocusPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: mermaidFocusPluginKey,
    state: {
      init(_config: unknown, state: EditorState): DecorationSet {
        // Build initial decorations for the active Mermaid block from starting state.
        return buildDecorations(state);
      },
      apply(tr, old, _oldState, newState): DecorationSet {
        // Check if the document content or selection changed in this transaction.
        if (tr.docChanged || tr.selectionSet) {
          // Document or selection changed: recompute decorations for the new state.
          return buildDecorations(newState);
        } else {
          // Neither document nor selection changed: preserve existing decorations.
          return old;
        }
      },
    },
    props: {
      decorations(state: EditorState): DecorationSet {
        // Retrieve decorations from plugin state or fall back to empty set.
        return mermaidFocusPluginKey.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}

/**
 * Extracts and sanitizes the language identifier from a code block node.
 *
 * @purpose Retrieves the language attribute string from a ProseMirror node, falling back to an empty string.
 * @inputs node - The ProseMirror code block node to inspect.
 * @outputs string - The language string if present, or an empty string.
 * @dataflow node.attrs.language -> string validation -> string output.
 * @controlflow Check if language attribute is a string; return attribute if true, empty string otherwise.
 */
function languageOf(node: ProseMirrorNode): string {
  // Check if the language attribute is a valid string.
  if (typeof node.attrs.language === 'string') {
    return node.attrs.language;
  } else {
    // Return empty string when language attribute is null or not a string.
    return '';
  }
}

/**
 * NodeView implementation for non-Mermaid code blocks.
 *
 * Renders the same DOM tree that the schema's toDOM specifies (pre > code), ensuring
 * standard code blocks behave and render identically to default ProseMirror blocks.
 */
class PlainCodeBlockView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  private node: ProseMirrorNode;

  /**
   * Initializes a PlainCodeBlockView DOM structure.
   *
   * @purpose Creates a standard pre/code DOM hierarchy for non-Mermaid code blocks.
   * @inputs node - The code block ProseMirrorNode being rendered.
   * @inputs doc - DOM Document used to instantiate pre and code elements.
   * @outputs void.
   * @dataflow node attrs -> pre[data-language] attribute; code element -> pre child -> contentDOM.
   * @controlflow Create pre element -> set data-language attribute -> create code element -> append code to pre -> assign fields.
   */
  constructor(node: ProseMirrorNode, doc: Document) {
    this.node = node;
    const pre = doc.createElement('pre');
    pre.setAttribute('data-language', languageOf(node));
    const code = doc.createElement('code');
    pre.append(code);
    this.dom = pre;
    this.contentDOM = code;
  }

  /**
   * Updates the code block node view if the incoming node is compatible.
   *
   * @purpose Updates data-language if the node remains a plain code block; rejects update if language switched to Mermaid or type changed.
   * @inputs next - The updated ProseMirrorNode.
   * @outputs boolean - True if the update was handled successfully, false if the node view must be rebuilt.
   * @dataflow next node -> type and language check -> update this.node and pre attribute -> boolean.
   * @controlflow Check type match and non-Mermaid language; if incompatible return false; otherwise update node and attribute, return true.
   */
  update(next: ProseMirrorNode): boolean {
    // Check if the next node has a different type or has been changed to Mermaid language.
    if (next.type !== this.node.type || isMermaidLanguage(next.attrs.language)) {
      // Rebuild the node view if type changed or it transitioned into a Mermaid diagram.
      return false;
    } else {
      // Retain this node view, update node reference and data-language attribute.
      this.node = next;
      this.dom.setAttribute('data-language', languageOf(next));
      return true;
    }
  }
}

/**
 * NodeView implementation for Mermaid diagram code blocks.
 *
 * Renders an editable pre/code section alongside an interactive SVG preview and error display.
 * Diagram rendering is debounced and synchronized with theme mutations and viewport visibility.
 */
class MermaidView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  private readonly pre: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly image: HTMLImageElement;
  private readonly status: HTMLElement;
  private readonly error: HTMLElement;
  private node: ProseMirrorNode;
  private readonly options: CodeBlockViewOptions;
  private source: string;
  private drawnSource: string | null = null;
  private drawnTheme: DiagramTheme | null = null;
  private visible: boolean;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private destroyed = false;
  private readonly intersection: IntersectionObserver | null = null;
  private readonly themeWatch: MutationObserver | null = null;

  /**
   * Initializes the MermaidView DOM components, gesture listeners, and viewport observers.
   *
   * @purpose Constructs the composite DOM hierarchy for Mermaid diagram display and wires interaction events.
   * @inputs node - The Mermaid codeBlock ProseMirrorNode.
   * @inputs view - The parent ProseMirror EditorView.
   * @inputs getPos - Position accessor function returning the document start position of this node.
   * @inputs options - Configuration options containing diagram renderer and debounce settings.
   * @outputs void.
   * @dataflow node.textContent -> this.source; DOM elements constructed and appended -> event listeners registered -> initial draw scheduled.
   * @controlflow Construct DOM elements -> attach mousedown handler to preview and error -> initialize IntersectionObserver or fallback -> initialize MutationObserver for theme -> schedule initial draw.
   */
  constructor(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
    options: CodeBlockViewOptions,
  ) {
    this.node = node;
    this.options = options;

    const doc = view.dom.ownerDocument;
    const win = doc.defaultView;

    const dom = doc.createElement('div');
    dom.className = 'kdoc-mermaid';
    dom.setAttribute('data-language', 'mermaid');
    this.dom = dom;

    const pre = doc.createElement('pre');
    pre.setAttribute('data-language', languageOf(node));
    this.pre = pre;

    const code = doc.createElement('code');
    pre.append(code);
    this.contentDOM = code;

    const preview = doc.createElement('div');
    preview.className = 'kdoc-mermaid-preview';
    preview.setAttribute('contenteditable', 'false');
    this.preview = preview;

    const image = doc.createElement('img');
    image.className = 'kdoc-mermaid-image';
    image.alt = 'Mermaid diagram';
    image.draggable = false;
    this.image = image;

    const status = doc.createElement('span');
    status.className = 'kdoc-mermaid-status';
    status.textContent = 'Drawing diagram…';
    this.status = status;

    preview.append(image, status);

    const error = doc.createElement('div');
    error.className = 'kdoc-mermaid-error';
    error.setAttribute('contenteditable', 'false');
    error.hidden = true;
    this.error = error;

    dom.append(pre, preview, error);

    this.source = node.textContent;

    // Clicking the diagram puts the caret at the start of its code, which opens it for editing.
    const onPress = (event: MouseEvent): void => {
      // Check if the primary mouse button was clicked.
      if (event.button !== 0) {
        return;
      } else {
        // Primary button was clicked; proceed with focusing the diagram source.
      }

      event.preventDefault();
      const pos = getPos();

      // Check if the node position is defined in the current document.
      if (pos === undefined) {
        return;
      } else {
        // Node position is valid: dispatch selection transaction and focus view.
      }

      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)));
      view.focus();
    };

    preview.addEventListener('mousedown', onPress);
    error.addEventListener('mousedown', onPress);

    // Check if IntersectionObserver is supported in the current window context.
    if (win !== null && win.IntersectionObserver !== undefined) {
      this.visible = false;
      this.intersection = new win.IntersectionObserver(
        (entries: IntersectionObserverEntry[]): void => {
          this.visible = entries.some((e: IntersectionObserverEntry): boolean => e.isIntersecting);
          // Check if the diagram element is intersecting the root margin.
          if (this.visible) {
            this.schedule(0);
          } else {
            // Element is not visible; do not schedule rendering.
          }
        },
        { rootMargin: MERMAID_ROOT_MARGIN },
      );
      this.intersection.observe(dom);
    } else {
      // No observer (tests, old engines): draw straight away.
      this.visible = true;
      this.intersection = null;
      this.schedule(0);
    }

    // Check if MutationObserver is supported in the current window context.
    if (win !== null && win.MutationObserver !== undefined) {
      this.themeWatch = new win.MutationObserver((): void => {
        this.schedule(0);
      });
      this.themeWatch.observe(doc.documentElement, {
        attributes: true,
        attributeFilter: ['data-kdoc-theme'],
      });
    } else {
      // MutationObserver unavailable: theme changes are not tracked dynamically.
      this.themeWatch = null;
    }
  }

  /**
   * Resolves the active theme ('light' or 'dark') from the root document element.
   *
   * @purpose Reads the 'data-kdoc-theme' dataset attribute from documentElement.
   * @inputs None.
   * @outputs DiagramTheme - 'dark' if data-kdoc-theme equals 'dark', otherwise 'light'.
   * @dataflow documentElement.dataset.kdocTheme -> comparison -> DiagramTheme.
   * @controlflow Check if data-kdoc-theme attribute is 'dark'; return 'dark' if true, 'light' otherwise.
   */
  private theme(): DiagramTheme {
    // Check if the root HTML element specifies the dark theme dataset attribute.
    if (this.dom.ownerDocument.documentElement.dataset.kdocTheme === 'dark') {
      return 'dark';
    } else {
      return 'light';
    }
  }

  /**
   * Schedules or reschedules rendering of the Mermaid diagram after a delay.
   *
   * @purpose Debounces diagram redraws, clearing any active pending timer.
   * @inputs delay - Number of milliseconds to wait before invoking draw().
   * @outputs void.
   * @dataflow delay -> setTimeout -> async this.draw().
   * @controlflow Clear existing timer -> check visibility and destroyed state -> set new setTimeout timer.
   */
  private schedule(delay: number): void {
    // Check if an existing draw timer is active.
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    } else {
      // No active timer to cancel.
    }

    // Check if the diagram is currently invisible or if the view has been destroyed.
    if (!this.visible || this.destroyed) {
      return;
    } else {
      // Diagram is visible and active: schedule drawing after the specified delay.
      this.timer = setTimeout((): void => {
        this.timer = null;
        void this.draw();
      }, delay);
    }
  }

  /**
   * Asynchronously renders the diagram syntax into SVG and updates the DOM.
   *
   * @purpose Invokes options.render, updating the image element on success or error display on failure.
   * @inputs None.
   * @outputs Promise<void>.
   * @dataflow this.source & this.theme() -> options.render -> svgToDataUri -> image.src / error.textContent.
   * @controlflow Check cache of drawn source and theme -> increment generation -> await render -> check destroyed and generation mismatch -> update image or error element.
   */
  private async draw(): Promise<void> {
    const src = this.source;
    const th = this.theme();

    // Check if the diagram source and theme are identical to the last rendered output.
    if (src === this.drawnSource && th === this.drawnTheme) {
      // Nothing changed since the last drawing; do not re-render.
      return;
    } else {
      // Source or theme changed; proceed with rendering.
    }

    this.generation += 1;
    const gen = this.generation;

    const result = await this.options.render(src, th);

    // Check if the view was destroyed or if a newer drawing generation has started.
    if (this.destroyed || gen !== this.generation) {
      // A newer drawing has started, or the block is gone; drop stale render result.
      return;
    } else {
      // Render result corresponds to the current generation.
    }

    this.drawnSource = src;
    this.drawnTheme = th;
    this.status.hidden = true;

    // Check if the diagram renderer successfully produced SVG output.
    if (result.ok) {
      this.image.src = svgToDataUri(result.svg);
      this.error.hidden = true;
      this.error.textContent = '';
      this.dom.classList.remove(MERMAID_INVALID_CLASS);
    } else {
      // Rendering failed: show error message and mark outer container as invalid.
      // The last good picture, if any, stays above the message.
      this.error.textContent = result.message;
      this.error.hidden = false;
      this.dom.classList.add(MERMAID_INVALID_CLASS);
    }
  }

  /**
   * Handles incoming node updates from ProseMirror.
   *
   * @purpose Re-renders diagram if text changed; returns false if node type or language no longer matches Mermaid.
   * @inputs next - The updated ProseMirrorNode.
   * @outputs boolean - True if node update was accepted, false if node view must be rebuilt.
   * @dataflow next.textContent -> comparison with this.source -> schedule debounce redraw.
   * @controlflow Verify node type and Mermaid language; update data-language; if text changed, schedule debounced draw.
   */
  update(next: ProseMirrorNode): boolean {
    // Check if the node type changed or if the code block language is no longer Mermaid.
    if (next.type !== this.node.type || !isMermaidLanguage(next.attrs.language)) {
      // Stops being a diagram: ProseMirror rebuilds it as plain code block.
      return false;
    } else {
      // Node remains a Mermaid code block.
    }

    this.node = next;
    this.pre.setAttribute('data-language', languageOf(next));
    const text = next.textContent;

    // Check if the text content of the code block has changed.
    if (text !== this.source) {
      this.source = text;
      this.schedule(this.options.debounceMs ?? MERMAID_DEBOUNCE_MS);
    } else {
      // Text content unchanged (e.g. attribute or selection update only).
    }

    return true;
  }

  /**
   * Determines whether ProseMirror should ignore DOM mutations inside this node view.
   *
   * @purpose Passes through mutations inside contentDOM; ignores mutations in preview and error elements.
   * @inputs mutation - ViewMutationRecord describing the DOM modification.
   * @outputs boolean - True if ProseMirror should ignore the mutation, false otherwise.
   * @dataflow mutation.type & mutation.target -> contentDOM containment check -> boolean.
   * @controlflow If mutation is a selection, return false; otherwise return whether target is outside contentDOM.
   */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    // Check if the mutation is a selection change.
    if (mutation.type === 'selection') {
      return false;
    } else {
      // For DOM structure/content mutations, ignore if they occurred outside contentDOM.
      return !this.contentDOM.contains(mutation.target);
    }
  }

  /**
   * Intercepts DOM events to prevent ProseMirror from handling events within preview or error elements.
   *
   * @purpose Keeps clicks and interactions within preview or error widgets from triggering default ProseMirror actions.
   * @inputs event - DOM Event dispatched within the node view.
   * @outputs boolean - True if the event should be stopped from reaching ProseMirror, false otherwise.
   * @dataflow event.target -> node check & containment in preview or error -> boolean.
   * @controlflow Check if target is a DOM Node and contained within preview or error containers.
   */
  stopEvent(event: Event): boolean {
    const target = event.target;
    // Check if the event target is a DOM Node contained within either the preview or error container.
    if (target instanceof Node && (this.preview.contains(target) || this.error.contains(target))) {
      return true;
    } else {
      return false;
    }
  }

  /**
   * Cleans up observers, timers, and event listeners when the node view is destroyed.
   *
   * @purpose Cancels pending debounced render timers and disconnects all DOM observers.
   * @inputs None.
   * @outputs void.
   * @dataflow None.
   * @controlflow Set destroyed flag -> clear timer if active -> disconnect intersection and theme observers.
   */
  destroy(): void {
    this.destroyed = true;

    // Check if a debounce timer is currently active.
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    } else {
      // No active timer to cancel.
    }

    // Check if the intersection observer was instantiated.
    if (this.intersection !== null) {
      this.intersection.disconnect();
    } else {
      // No intersection observer to disconnect.
    }

    // Check if the theme mutation observer was instantiated.
    if (this.themeWatch !== null) {
      this.themeWatch.disconnect();
    } else {
      // No theme mutation observer to disconnect.
    }
  }
}

/**
 * Creates a ProseMirror NodeViewConstructor that renders code blocks.
 *
 * Code blocks tagged as 'mermaid' render via MermaidView with live preview and debounced drawing.
 * All other code blocks render via PlainCodeBlockView, preserving standard pre/code behavior.
 *
 * @purpose Factory creating a codeBlock NodeViewConstructor tailored to diagram and standard code blocks.
 * @inputs options - CodeBlockViewOptions containing the diagram render function and optional debounce duration.
 * @outputs NodeViewConstructor - ProseMirror NodeView factory function.
 * @dataflow options -> NodeViewConstructor closure -> node.attrs.language check -> MermaidView or PlainCodeBlockView.
 * @controlflow Return NodeViewConstructor closure; when invoked by ProseMirror, inspect node language: instantiate MermaidView for Mermaid, PlainCodeBlockView otherwise.
 */
export function createCodeBlockNodeView(options: CodeBlockViewOptions): NodeViewConstructor {
  return (
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
  ): NodeView => {
    // Check if the code block language identifier matches Mermaid syntax.
    if (isMermaidLanguage(node.attrs.language)) {
      return new MermaidView(node, view, getPos, options);
    } else {
      return new PlainCodeBlockView(node, view.dom.ownerDocument);
    }
  };
}

/**
 * CSS stylesheet defining rendering styles for Mermaid diagram code blocks and live previews.
 */
export const MERMAID_VIEW_STYLES: string = `
.kdoc-mermaid {
  margin: 0 0 1em;
}

/* The code shows only while the caret is in the block; otherwise the diagram stands alone. */
.kdoc-mermaid:not(.kdoc-mermaid-editing) > pre {
  display: none;
}

.kdoc-mermaid > pre {
  margin-bottom: 0;
}

.kdoc-mermaid-preview {
  text-align: center;
  padding: 8px 0;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
}

.kdoc-mermaid-editing .kdoc-mermaid-preview {
  cursor: default;
  border: 1px dashed var(--kdoc-color-border, #d0d7de);
  border-top: none;
}

.kdoc-mermaid-image {
  max-width: 100%;
  height: auto;
}

.kdoc-mermaid-image:not([src]) {
  display: none;
}

.kdoc-mermaid-status {
  font-size: 12px;
  color: var(--kdoc-color-text-muted, #656d76);
}

.kdoc-mermaid-error {
  white-space: pre-wrap;
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  font-size: 12px;
  padding: 4px 8px;
  color: var(--kdoc-color-danger, #cf222e);
  cursor: pointer;
}

.kdoc-mermaid-error[hidden] {
  display: none;
}
`;
