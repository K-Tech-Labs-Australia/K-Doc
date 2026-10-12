/**
 * @file graph-dialog.ts
 * @purpose Implements installGraphDialog, a native <dialog> modal (FR-6.15) in which a reader sees which notes link to which. The dialog works nothing out: the graph, its layout and every shape come from @k-doc/core, so this file only owns DOM construction, rendering driven by working state, focus management and lifecycle teardown.
 * @inputs GraphDialogOptions containing the Document context plus graph(), documentPath() and openNote() provider callbacks; a per-instance id counter shared with ribbon-dialog.ts for unique aria-labelledby references.
 * @outputs A GraphDialog controller exposing open, close, isOpen and destroy alongside GRAPH_DIALOG_STYLES, a static stylesheet reusing the border/radius/elevated tokens from ribbon-dialog.ts plus graph-specific shape styling capped at 58vh.
 * @functions
 *   - installGraphDialog: Constructs and mounts the native dialog element, wires scope/close buttons and the cancel handler, builds render helpers bound to working state, and returns the GraphDialog controller.
 *   - shownGraph: Resolves which graph to draw for the current scope from options.graph() or a neighbourhood around the on-screen note.
 *   - clear: Empties an element of every child node in place.
 *   - render: Rebuilds the figure and count line from working state into DOM shapes via @k-doc/core drawing helpers.
 * @dataflow options.graph()/documentPath() -> shownGraph() -> graphDrawing(graph, layoutGraph(), path) -> SVG lines/circles/text appended to figure; scope button clicks reassign scope then render(); node clicks call openNote then close().
 * @controlflow Mount dialog at install time (build once) -> open resets scope and shows modal -> scope/action buttons drive render() -> destroy tears down listeners and DOM node idempotently.
 * @version 3
 * @date 2026-10-04
 */

import { graphDrawing, graphNeighbourhood, layoutGraph, GRAPH_VIEW_SIZE, type VaultGraph } from '@k-doc/core';

const SVG_NS = 'http://www.w3.org/2000/svg';   // the namespace every shape element is made in
const NEIGHBOUR_DEPTH = 1;                     // how far "Around this note" reaches

export type GraphScope = 'vault' | 'note';

export interface GraphDialogOptions {
  readonly doc: Document;
  /** The whole vault's graph. */
  readonly graph: () => VaultGraph;
  /** The note on screen, or null when it has never been saved. */
  readonly documentPath: () => string | null;
  /** Opens one note by its path. */
  readonly openNote: (path: string) => void;
}

export interface GraphDialog {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  destroy(): void;
}

/** Static stylesheet for the graph modal dialog, styling backdrop, container, scope toggle, figure and SVG shapes using K-Doc design tokens borrowed from ribbon-dialog.ts. */
export const GRAPH_DIALOG_STYLES: string = `
dialog.kdoc-graph-dialog {
  border: 0;
  border-radius: var(--kdoc-radius-xl);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  padding: 20px 24px;
  max-width: 860px;
  width: calc(100% - 32px);
  box-sizing: border-box;
  box-shadow: 0 1px 3px var(--kdoc-chrome-shadow-deeper), 0 4px 8px 3px var(--kdoc-chrome-shadow-dark);
}

dialog.kdoc-graph-dialog::backdrop {
  background: var(--kdoc-chrome-shadow-deeper);
}

.kdoc-graph-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.kdoc-graph-dialog-head {
  display: flex;
  gap: 6px;
  padding: 4px;
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-lg);
  box-shadow: none;
}

.kdoc-graph-dialog-scope {
  border: 1px solid transparent;
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
  padding: 6px 12px;
  border-radius: var(--kdoc-radius-md);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  transition: box-shadow 0.15s ease, text-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.kdoc-graph-dialog-scope:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-graph-dialog-scope:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-graph-dialog-scope.is-active,
.kdoc-graph-dialog-scope[aria-pressed="true"] {
  font-weight: 700;
  background: var(--kdoc-chrome-accent);
  box-shadow: none;
  color: var(--kdoc-chrome-on-accent);
  border-color: var(--kdoc-chrome-accent);
}

.kdoc-graph-dialog-figure {
  width: 100%;
  max-width: 58vh;
  aspect-ratio: 1 / 1;
  margin: 0 auto;
  border-radius: var(--kdoc-radius-lg);
  overflow: hidden;
}

.kdoc-graph-dialog-figure svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}

.kdoc-graph-edge {
  stroke: var(--kdoc-chrome-glass-edge);
}

.kdoc-graph-node {
  fill: var(--kdoc-chrome-accent);
  cursor: pointer;
}

.kdoc-graph-node.is-current {
  fill: var(--kdoc-chrome-text);
}

.kdoc-graph-label {
  fill: var(--kdoc-chrome-text);
  font-size: 26px;
  pointer-events: none;
}

.kdoc-graph-dialog-count {
  color: var(--kdoc-chrome-text-muted);
  font-variant-numeric: tabular-nums;
  margin: 0;
}

.kdoc-graph-dialog-actions {
  display: flex;
  justify-content: flex-end;
}

.kdoc-dialog-heading {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 500;
  color: var(--kdoc-chrome-text);
}

.kdoc-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.kdoc-dialog-button {
  min-width: 64px;
  height: 36px;
  padding: 0 18px;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-pill);
  background: transparent;
  color: var(--kdoc-chrome-text);
  font: inherit;
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
  box-sizing: border-box;
  box-shadow: none;
  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;
}

.kdoc-dialog-button:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-dialog-button:active {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
}

.kdoc-dialog-button:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-dialog-button:disabled {
  border-style: dashed;
  color: var(--kdoc-chrome-text-muted);
  background: transparent;
  cursor: not-allowed;
}

.kdoc-dialog-button.kdoc-dialog-button-primary,
.kdoc-dialog-button.kdoc-dialog-button-save,
.kdoc-dialog-button.kdoc-dialog-apply {
  border-color: var(--kdoc-chrome-accent);
  background: var(--kdoc-chrome-accent);
  color: var(--kdoc-chrome-on-accent);
}

.kdoc-dialog-button.kdoc-dialog-button-primary:hover,
.kdoc-dialog-button.kdoc-dialog-button-save:hover,
.kdoc-dialog-button.kdoc-dialog-apply:hover,
.kdoc-dialog-button.kdoc-dialog-button-primary:active,
.kdoc-dialog-button.kdoc-dialog-button-save:active,
.kdoc-dialog-button.kdoc-dialog-apply:active {
  background: color-mix(in srgb, var(--kdoc-chrome-accent) 88%, var(--kdoc-chrome-text));
}

.kdoc-dialog-button.kdoc-dialog-button-primary:disabled,
.kdoc-dialog-button.kdoc-dialog-apply:disabled {
  border-color: var(--kdoc-chrome-edge);
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-dialog-button.kdoc-dialog-button-discard {
  color: var(--kdoc-emissive-red);
}

.kdoc-dialog-button:active,
.kdoc-dialog-button[aria-pressed="true"] {
  box-shadow: none;
  color: var(--kdoc-chrome-on-accent);
  background: var(--kdoc-chrome-accent);
  border-color: var(--kdoc-chrome-accent);
  font-weight: 700;
  border-radius: var(--kdoc-radius-md);
}

@media (prefers-reduced-motion: reduce) {
  dialog.kdoc-graph-dialog,
  dialog.kdoc-graph-dialog * {
    transition: none !important;
    animation: none !important;
  }
}
`;

/** Monotonically increasing counter ensuring unique DOM element IDs across multiple graph dialog instances. */
let nextGraphDialogId = 0;

/**
 * Empties an element of every child node in place so a container can be rebuilt from scratch.
 *
 * @purpose Removes all descendants of element one at a time until it has no children left, matching the clear pattern used throughout ribbon-dialog.ts.
 * @inputs element - The DOM node whose children should all be removed.
 * @outputs void - leaves element with no child nodes after returning.
 * @dataflow element.firstChild -> removeChild loop -> element reaped of every descendant.
 * @controlflow While a first child exists, detach it; stop once the container is empty so stale shapes never linger between renders.
 */
function clear(element: Element): void {
  // Detach children one at a time until none remain, since removing while iterating would skip siblings.
  while (element.firstChild !== null) {
    element.removeChild(element.firstChild);
  }
}

/**
 * Installs the modal graph dialog into the document body, wiring button actions and lifecycle controls.
 *
 * @purpose Constructs, styles, and mounts a native modal dialog element for inspecting which notes link to which without owning any drawing or layout logic of its own; every shape is delegated to @k-doc/core.
 * @inputs options - GraphDialogOptions containing the document context plus graph(), documentPath() and openNote() provider callbacks.
 * @outputs GraphDialog - Controller exposing open, close, isOpen and destroy lifecycle methods.
 * @dataflow options.graph()/documentPath() -> shownGraph() -> graphDrawing(graph, layoutGraph(), path) -> SVG shapes appended to figure -> scope/action button clicks drive render() or close().
 * @controlflow Create dialog DOM hierarchy once at install time -> configure role, aria attributes and heading -> bind scope/close buttons and cancel handler -> append stylesheet + mount body -> return GraphDialog controller with open/close/isOpen/destroy methods.
 */
export function installGraphDialog(options: GraphDialogOptions): GraphDialog {
  const doc = options.doc;
  const dialogId = ++nextGraphDialogId;
  const titleId = `kdoc-graph-title-${dialogId}`;

  let scope: GraphScope = 'vault'; // which graph to draw for the current render
  let returnFocus: HTMLElement | null = null; // what held focus before opening
  let destroyed = false;

  // Construct native <dialog> element.
  const dialog = doc.createElement('dialog');
  dialog.className = 'kdoc-graph-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', titleId);

  // Construct container for dialog content.
  const content = doc.createElement('div');
  content.className = 'kdoc-graph-dialog-content';

  const heading = doc.createElement('h3');
  heading.id = titleId;
  heading.textContent = 'Graph';
  content.appendChild(heading);

  // Construct the scope toggle carrying both selectable views of the graph.
  const head = doc.createElement('div');
  head.className = 'kdoc-graph-dialog-head';

  // A single array tracks every scope button alongside its matching GraphScope value for render().
  interface ScopeButton { readonly element: HTMLButtonElement; readonly scope: GraphScope; }
  const buttons: ScopeButton[] = [];

  // Build the "Whole vault" view toggle, which draws every note and link in one pass.
  const vaultButton = doc.createElement('button');
  vaultButton.type = 'button';
  vaultButton.textContent = 'Whole vault';
  vaultButton.className = 'kdoc-graph-dialog-scope';
  vaultButton.setAttribute('aria-label', 'Show the whole vault graph');
  vaultButton.addEventListener('click', (): void => {
    scope = 'vault';
    render();
  });
  buttons.push({ element: vaultButton, scope: 'vault' });
  head.appendChild(vaultButton);

  // Build the "Around this note" view toggle, which draws only a neighbourhood of the on-screen note.
  const noteButton = doc.createElement('button');
  noteButton.type = 'button';
  noteButton.textContent = 'Around this note';
  noteButton.className = 'kdoc-graph-dialog-scope';
  noteButton.setAttribute('aria-label', 'Show notes around the current note');
  noteButton.addEventListener('click', (): void => {
    scope = 'note';
    render();
  });
  buttons.push({ element: noteButton, scope: 'note' });
  head.appendChild(noteButton);

  content.appendChild(head);

  // Construct the figure that holds every edge and node shape for the current graph.
  const figure = doc.createElement('div');
  figure.className = 'kdoc-graph-dialog-figure';
  content.appendChild(figure);

  // Construct the tally line describing how many notes and links are currently shown.
  const count = doc.createElement('p');
  count.className = 'kdoc-graph-dialog-count';
  content.appendChild(count);

  // Construct dialog action buttons (Close only, matching a read-only inspection modal).
  const actions = doc.createElement('div');
  actions.className = 'kdoc-graph-dialog-actions';

  const closeButton = doc.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = 'Close';
  closeButton.className = 'kdoc-dialog-button';
  closeButton.setAttribute('aria-label', 'Close the graph dialog');
  closeButton.addEventListener('click', (): void => {
    close();
  });
  actions.appendChild(closeButton);

  content.appendChild(actions);
  dialog.appendChild(content);

  // Handle native Escape key dismiss event so focus is released through our own close() path.
  dialog.addEventListener('cancel', (event: Event): void => {
    // Suppress the default action and route dismissal through close(), mirroring ribbon-dialog.ts.
    event.preventDefault();
    close();
  });

  // Mount the dialog into the document body.
  doc.body.appendChild(dialog);

  /**
   * Resolves which graph to draw for the current scope from options.graph() or a neighbourhood around the on-screen note.
   *
   * @purpose Returns the whole vault's graph when in 'vault' scope, otherwise either an empty graph (nothing is on screen) or the neighbourhood of notes reachable within NEIGHBOUR_DEPTH of the on-screen note.
   * @inputs void - reads module-scoped scope state and options.provider callbacks only.
   * @outputs VaultGraph - The full vault graph, a zero-node graph when no note is open, or the requested neighbourhood.
   * @dataflow scope -> 'vault' returns options.graph(); 'note' reads options.documentPath() then either an empty { nodes: [], edges: [] } or graphNeighbourhood(graph, path, NEIGHBOUR_DEPTH).
   * @controlflow Branch on scope; when vault return the live graph immediately, otherwise read documentPath and branch again on null before returning the neighbourhood.
   */
  function shownGraph(): VaultGraph {
    // In whole-vault scope there is nothing to narrow: draw every note and link at once.
    if (scope === 'vault') {
      return options.graph();
    } else {
      // Around-this-note scope needs a single on-screen anchor, so read the current path below.
    }

    // Read the note currently on screen; null means no note has been saved and there is nothing to be around.
    const path = options.documentPath();

    // A mutant that removed this guard survived, because graphNeighbourhood reaches nothing from a note the
    // vault has not got either. It is not redundant: it is what makes the call below type-correct, since
    // graphNeighbourhood is given a path and null is not one.
    if (path === null) {
      // No note is open: return an empty graph so the figure shows a placeholder rather than floating nodes.
      return { nodes: [], edges: [] };
    } else {
      // A note is on screen: draw its neighbourhood below.
    }

    // Collect every node reachable within NEIGHBOUR_DEPTH of the anchor, including the anchor itself.
    return graphNeighbourhood(options.graph(), path, NEIGHBOUR_DEPTH);
  }

  /**
   * Rebuilds the figure and count line from working state into DOM shapes via @k-doc/core drawing helpers.
   *
   * @purpose Clears both containers, refreshes scope button highlighting, then either shows an empty-graph placeholder or draws edges as lines and nodes as clickable circles with labels; finally it writes a note/link tally into the count element.
   * @inputs void - reads module-scoped scope state only.
   * @outputs void - mutates the DOM of figure and count in place to reflect current graph drawing.
   * @dataflow scope -> is-active/aria-pressed on buttons -> shownGraph() -> empty check -> graphDrawing(graph, layoutGraph(), path) -> SVG lines/circles/titles/text appended to figure -> interpolated tally into count.textContent.
   * @controlflow Clear both containers; highlight the active scope button and dim the other; read the target graph and return early with a placeholder when it has no nodes, otherwise build every edge then node then label before writing the final count.
   */
  function render(): void {
    // Rebuild the figure from scratch on every call so stale shapes never persist between scopes or note changes.
    clear(figure);
    // The tally line is fully rewritten each time rather than appended to, so it must be cleared too.
    clear(count);

    // Refresh scope button highlighting: mark the active one and announce its pressed state to assistive tech.
    for (const button of buttons) {
      if (button.scope === scope) {
        // The matching scope is selected: style it as active and press it for screen readers.
        button.element.classList.add('is-active');
        button.element.setAttribute('aria-pressed', 'true');
      } else {
        // A different scope is not selected: strip the active styling and release its pressed state.
        button.element.classList.remove('is-active');
        button.element.setAttribute('aria-pressed', 'false');
      }
    }

    // Resolve which graph to draw for the current scope before deciding whether anything can be shown at all.
    const graph = shownGraph();

    if (graph.nodes.length === 0) {
      // There is nothing on screen: show an explanatory placeholder instead of a blank figure and stop here.
      const empty = doc.createElement('p');
      empty.textContent = 'No notes to show. Open a vault of notes that link to each other.';
      figure.appendChild(empty);
      return;
    } else {
      // Notes exist: draw the full graph below.
    }

    // Ask @k-doc/core for every shape, laying out this scope's graph and flagging the on-screen note as current.
    const drawing = graphDrawing(graph, layoutGraph(graph), options.documentPath());

    // Create the SVG canvas in the correct namespace so its shapes render rather than being parsed as HTML.
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${GRAPH_VIEW_SIZE} ${GRAPH_VIEW_SIZE}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'The notes of this vault and the links between them');
    figure.appendChild(svg);

    // Draw every link as a weighted line before its notes so circles sit on top of the edges.
    for (const edge of drawing.edges) {
      const line = doc.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', String(edge.x1));
      line.setAttribute('y1', String(edge.y1));
      line.setAttribute('x2', String(edge.x2));
      line.setAttribute('y2', String(edge.y2));
      // An SVG element's className is not a string, so set the class via setAttribute rather than .className.
      line.setAttribute('class', 'kdoc-graph-edge');
      line.setAttribute('stroke-width', String(edge.width));
      svg.appendChild(line);
    }

    // Draw every note as an accessible circle before its label so text sits beneath the shape it names.
    for (const node of drawing.nodes) {
      const circle = doc.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(node.x));
      circle.setAttribute('cy', String(node.y));
      circle.setAttribute('r', String(node.radius));
      // The on-screen note is drawn in text colour to stand out from every other node in the graph.
      if (node.current) {
        circle.setAttribute('class', 'kdoc-graph-node is-current');
      } else {
        circle.setAttribute('class', 'kdoc-graph-node');
      }
      // Make each note keyboard-focusable and announce its title so it behaves like a navigable control.
      circle.setAttribute('tabindex', '0');
      circle.setAttribute('role', 'button');
      circle.setAttribute('aria-label', node.title);

      // Add an SVG <title> child so hovering names the note in full through the browser's native tooltip.
      const title = doc.createElementNS(SVG_NS, 'title');
      title.textContent = node.title;
      circle.appendChild(title);

      // Opening a note navigates to it and dismisses the dialog so the reader lands on the note itself.
      circle.addEventListener('click', (): void => {
        options.openNote(node.path);
        close();
      });

      // Support keyboard activation (Enter or Space) mirroring the click path for assistive-technology users.
      circle.addEventListener('keydown', (event: Event): void => {
        if (event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' ')) {
          // A recognised activation key was pressed: prevent its default action and open the note instead.
          event.preventDefault();
          options.openNote(node.path);
          close();
        } else {
          // An unrelated key press is ignored so scrolling, focus movement and other shortcuts keep working.
        }
      });

      svg.appendChild(circle);
    }

    // Draw each note's label beneath its circle once every node has been placed at a fixed baseline.
    for (const node of drawing.nodes) {
      const label = doc.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', String(node.x));
      label.setAttribute('y', String(node.labelY));
      label.setAttribute('class', 'kdoc-graph-label');
      // Centre the text on its note so long and short labels stay visually aligned under their circles.
      label.setAttribute('text-anchor', 'middle');
      label.textContent = node.label;
      svg.appendChild(label);
    }

    // Write a human-readable tally, choosing singular or plural forms when a count is exactly one.
    const noteWord = drawing.nodes.length === 1 ? 'note' : 'notes';
    const linkWord = drawing.edges.length === 1 ? 'link' : 'links';
    count.textContent = `${drawing.nodes.length} ${noteWord}, ${drawing.edges.length} ${linkWord}`;
  }

  /**
   * Closes the graph dialog if currently open and returns focus to its prior holder.
   *
   * @purpose Dismisses the modal dialog in an idempotent manner across native and test environments, then restores DOM focus to whatever held it before open() so reading resumes where the reader left off.
   * @inputs void - reads module-scoped dialog and returnFocus state only.
   * @outputs void - closes the dialog element when open and refocuses returnFocus if captured.
   * @dataflow dialog.open -> native close()/open=false fallback -> returnFocus.focus() then null out holder.
   * @controlflow Check if dialog is currently open; invoke native close() or set open = false on hit, otherwise no-op; when a focus holder exists call its focus() and clear it, otherwise do nothing.
   */
  function close(): void {
    // Close the dialog only while it is actually open to avoid InvalidStateError from closing twice.
    if (dialog.open) {
      // Native showModal path: use the HTMLDialogElement.close() method when available.
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        // Fallback for test environments lacking showModal: clear the open flag directly.
        dialog.open = false;
      }
    } else {
      // Dialog is already closed: nothing to dismiss, no operation required.
    }

    // Return focus to whatever held it before opening so reading resumes where the reader left off.
    if (returnFocus !== null) {
      returnFocus.focus();
      returnFocus = null;
    } else {
      // No prior focus holder was captured: leave DOM focus wherever close() placed it.
    }
  }

  /**
   * Opens the graph dialog, resetting to whole-vault scope and showing it modally.
   *
   * @purpose Captures the currently focused element for later restoration, resets scope to 'vault', renders the current graph, then shows the modal (or open fallback) unless already destroyed.
   * @inputs void - reads module-scoped state only.
   * @outputs void - leaves the dialog visible with a freshly rendered graph when not destroyed.
   * @dataflow doc.activeElement -> returnFocus holder -> scope reset to 'vault' -> render() builds DOM -> showModal()/open=true fallback shows modal.
   * @controlflow Return immediately if destroyed; otherwise capture focus, reset scope, render, then branch on showModal availability before showing the dialog.
   */
  function open(): void {
    // A destroyed controller cannot reopen: bail out early to avoid resurrecting detached DOM.
    if (destroyed) {
      return;
    } else {
      // Active controller: proceed with opening below.
    }

    // Capture the currently focused element so close() can restore focus afterwards, tolerating non-element nodes.
    const activeElement = doc.activeElement;

    if (activeElement instanceof HTMLElement) {
      returnFocus = activeElement;
    } else {
      // No meaningful element held focus: there is nothing to refocus on close.
      returnFocus = null;
    }

    // Always open on the whole vault so repeated opens start from a stable, predictable scope.
    scope = 'vault';
    render();

    // Show modally when supported, falling back to a non-modal open flag for test environments without showModal.
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.open = true;
    }
  }

  /**
   * Destroys the graph dialog component, closing it and removing its DOM node from the document body.
   *
   * @purpose Idempotently tears down the controller by marking destroyed, dismissing any open modal via close(), and detaching the dialog element when still attached to a parent.
   * @inputs void - reads module-scoped state only.
   * @outputs void - leaves no visible dialog and marks the controller inert after first call.
   * @dataflow mark destroyed = true -> close() dismisses modal and restores focus -> detachedParent.removeChild(dialog) when present.
   * @controlflow Return immediately if already destroyed for idempotent teardown; otherwise set destroyed, close(), then remove from parent if one exists before returning the controller methods.
   */
  function destroy(): void {
    // Already torn down: return without side effects so repeated destroys stay safe.
    if (destroyed) {
      return;
    } else {
      // Active controller: mark destroyed and proceed with teardown below.
      destroyed = true;
    }

    close();

    const detachedParent = dialog.parentNode;
    if (detachedParent !== null) {
      detachedParent.removeChild(dialog);
    } else {
      // The dialog is already detached from the document: nothing to remove.
    }
  }

  return {
    open,
    close,
    /** Whether the dialog element is currently open. */
    get isOpen(): boolean {
      return dialog.open;
    },
    destroy,
  };
}
