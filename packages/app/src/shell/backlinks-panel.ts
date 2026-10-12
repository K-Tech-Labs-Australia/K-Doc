/**
 * @file backlinks-panel.ts
 * @purpose Implements BacklinksPanel, the right-sidebar panel for K-Doc listing every place in the vault that links to the note currently on screen, quoting the line each reference sits on.
 *   Renders a count line followed by source notes grouped in first-appearance order with clickable context lines, handling un-opened vault, unsaved note, and empty-reference states with full lifecycle cleanup.
 * @inputs BacklinksPanelOptions containing Document context, vault status accessor, on-screen note path accessor, backlinks accessor, and openNote callback.
 * @outputs BacklinksPanel controller exposing mounted element, refresh, and destroy lifecycle methods, alongside BACKLINKS_PANEL_STYLES CSS stylesheet definition.
 * @functions
 *   - installBacklinksPanel: Instantiates and mounts the backlinks panel hierarchy, binds a single delegated click listener with AbortController, performs initial refresh, and returns the BacklinksPanel controller.
 *   - createSourceButton: Builds an accessible button representing a source note with title span, relative path span, data-path, tooltip, and click navigation.
 *   - createContextButton: Builds an accessible button representing a single reference line with its context text (em dash when empty), data-path to the source note, and click navigation.
 *   - handleBodyClick: Handles delegated clicks inside the body by opening the closest button carrying a data-path attribute.
 *   - refresh: Rebuilds the backlinks panel body DOM to reflect vault status, on-screen note path, and grouped references via replaceChildren.
 *   - destroy: Idempotently tears down the event listener via AbortController and clears DOM children.
 * @dataflow options accessors (hasVault, documentPath, backlinks) -> state evaluation -> grouping by first-appearance path -> DOM node construction -> replaceChildren update on kdoc-backlinks-body; body click delegated to options.openNote.
 * @controlflow Initialize root container and stable body DOM -> attach single delegated listener -> perform initial refresh -> return BacklinksPanel controller.
 * @version 3
 * @date 2026-10-04
 */

/** One reference to the current note, as the panel needs to draw it. */
export interface BacklinkRow {
  /** Path of the note the reference came from. */
  readonly path: string;
  /** That note's path relative to the vault root. */
  readonly relative: string;
  /** That note's title. */
  readonly title: string;
  /** The line the reference sits on, trimmed. */
  readonly context: string;
}

export interface BacklinksPanelOptions {
  readonly doc: Document;
  /** True when a vault folder is open. */
  readonly hasVault: () => boolean;
  /** The path of the note on screen, or null when it has never been saved. */
  readonly documentPath: () => string | null;
  /** Every reference to the current note, in vault order. */
  readonly backlinks: () => readonly BacklinkRow[];
  /** Opens one note by its path. */
  readonly openNote: (path: string) => void;
}

export interface BacklinksPanel {
  readonly element: HTMLElement;
  refresh(): void;
  destroy(): void;
}

/**
 * Static stylesheet for the backlinks panel, defining vertical panel layout,
 * scrollable body, count line, source-note buttons with nested context-line
 * buttons, and empty state readouts using authoritative K-Doc design tokens.
 */
export const BACKLINKS_PANEL_STYLES: string = `
.kdoc-backlinks-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
  background: var(--kdoc-chrome-base);
  color: var(--kdoc-chrome-text);
  border-radius: var(--kdoc-radius-lg);
  box-shadow: none;
}

.kdoc-backlinks-panel[hidden] {
  display: none !important;
}

.kdoc-backlinks-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 0;
  scrollbar-width: thin;
  scrollbar-color: var(--kdoc-chrome-raised) var(--kdoc-chrome-base);
}

.kdoc-backlinks-body::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.kdoc-backlinks-body::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

.kdoc-backlinks-body::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-backlinks-empty {
  font-size: 13px;
  color: var(--kdoc-chrome-text-muted);
  padding: 8px 12px;
  font-style: italic;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-backlinks-count {
  font-size: 12px;
  font-family: monospace;
  font-variant-numeric: tabular-nums;
  color: var(--kdoc-chrome-text-muted);
  padding: 6px 12px;
}

.kdoc-backlinks-source {
  width: calc(100% - 8px);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-md);
  margin: 1px 4px;
  background: transparent;
  color: var(--kdoc-chrome-text);
  font: inherit;
  font-size: 13px;
  padding: 4px 12px;
  box-sizing: border-box;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.kdoc-backlinks-source:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-backlinks-source:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-backlinks-title {
  font-size: 13px;
  color: var(--kdoc-chrome-text);
}

.kdoc-backlinks-path {
  font-size: 11px;
  color: var(--kdoc-chrome-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kdoc-backlinks-context {
  width: calc(100% - 8px);
  display: flex;
  align-items: center;
  text-align: left;
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-md);
  margin: 1px 4px;
  background: transparent;
  font: inherit;
  font-size: 12px;
  padding: 2px 12px 2px 24px;
  box-sizing: border-box;
  color: var(--kdoc-chrome-text-muted);
  cursor: pointer;
  white-space: normal;
  transition: background 0.15s ease, color 0.15s ease;
}

.kdoc-backlinks-context:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-backlinks-context:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border-radius: var(--kdoc-radius-md);
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-backlinks-panel * {
    transition: none !important;
  }
}
`;

/**
 * Creates an accessible button element representing a single source note that references the current note.
 *
 * @purpose Builds a source-note button with title span, relative path span, data-path, hover tooltip, and click navigation to the source note.
 * @inputs path - The source note's absolute path, stored on data-path and used for navigation.
 * @inputs sampleRow - A BacklinkRow from this group supplying the shared title and relative path for the source button.
 * @inputs doc - Document context used for DOM element creation.
 * @outputs HTMLButtonElement - The configured source-note button element.
 * @dataflow sampleRow title and relative -> spans inside button; path -> data-path and tooltip, which the body's delegated listener reads on a click.
 * @controlflow Create button -> set type, class, data-path, and title -> create title span -> create path span -> return button.
 */
function createSourceButton(
  path: string,
  sampleRow: BacklinkRow,
  doc: Document,
): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'kdoc-backlinks-source';
  button.setAttribute('data-path', path);
  // Title attribute of the relative path for tooltip readability on hover.
  button.title = sampleRow.relative;

  const titleSpan = doc.createElement('span');
  titleSpan.className = 'kdoc-backlinks-title';
  titleSpan.textContent = sampleRow.title;

  const pathSpan = doc.createElement('span');
  pathSpan.className = 'kdoc-backlinks-path';
  pathSpan.textContent = sampleRow.relative;

  button.appendChild(titleSpan);
  button.appendChild(pathSpan);

  return button;
}

/**
 * Creates an accessible button element representing a single reference line within a source note.
 *
 * @purpose Builds a context-line button whose label is the quoted reference line (an em dash when unreadable), with data-path to the source note and click navigation.
 * @inputs path - The source note's absolute path, stored on data-path and used for navigation.
 * @inputs row - BacklinkRow supplying the quoted context line for this reference.
 * @inputs doc - Document context used for DOM element creation.
 * @outputs HTMLButtonElement - The configured context-line button element.
 * @dataflow row.context -> button textContent (em dash when empty); path -> data-path, which the body's delegated listener reads on a click.
 * @controlflow Create button -> set type, class, and data-path -> set textContent from context or em dash -> return button.
 */
function createContextButton(
  path: string,
  row: BacklinkRow,
  doc: Document,
): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'kdoc-backlinks-context';
  // data-path is the source note's path so clicking a context line navigates to where the reference lives.
  button.setAttribute('data-path', path);

  // Check whether the reference has a readable line of context.
  if (row.context === '') {
    // No readable line: label with an em dash (U+2014, written as an ASCII escape) so the reference is still counted and shown rather than dropped.
    button.textContent = '\u2014';
  } else {
    // Readable line present: show it trimmed so the user can recognise which reference they meant to click.
    button.textContent = row.context;
  }

  return button;
}

/**
 * Installs the backlinks panel into an owned DOM hierarchy, configuring vault status rendering,
 * on-screen note path handling, grouped reference display, and resource cleanup lifecycles.
 *
 * @purpose Creates the backlinks panel container and stable body, binds a single delegated click listener, performs initial refresh, and returns the BacklinksPanel controller.
 * @inputs options - BacklinksPanelOptions providing Document context, vault status accessor, on-screen note path accessor, backlinks accessor, and note open callback.
 * @outputs BacklinksPanel - Controller interface exposing mounted element, refresh, and destroy methods.
 * @dataflow options accessors (hasVault, documentPath, backlinks) -> state evaluation -> grouping by first-appearance path -> DOM node construction -> replaceChildren on kdoc-backlinks-body.
 * @controlflow Initialize root container and stable body DOM -> attach single delegated listener -> perform initial refresh -> return BacklinksPanel controller interface.
 */
export function installBacklinksPanel(options: BacklinksPanelOptions): BacklinksPanel {
  const doc = options.doc;
  const abortController = new AbortController();
  const signal = abortController.signal;

  let destroyed: boolean = false;

  const rootElement = doc.createElement('div');
  rootElement.className = 'kdoc-backlinks-panel';

  // Build a stable <div class="kdoc-backlinks-body"> inside element once and only ever replace that body's children on refresh,
  // so the panel's own element identity survives across updates and the sidebar never mounts a second panel.
  const bodyElement = doc.createElement('div');
  bodyElement.className = 'kdoc-backlinks-body';
  rootElement.appendChild(bodyElement);

  /**
   * Handles clicks anywhere inside the panel body via event delegation.
   *
   * @purpose Finds the closest clickable button carrying a data-path attribute and opens that note.
   * @inputs event - The click event dispatched from within the body element.
   * @outputs void.
   * @dataflow event.target -> closest button[data-path] -> options.openNote(path).
   * @controlflow Resolve target -> find closest button[data-path] -> if found open its path; else ignore.
   */
  function handleBodyClick(event: Event): void {
    const rawTarget = event.target;

    // Check whether the click originated on a DOM element we can query for ancestors.
    if (!(rawTarget instanceof HTMLElement)) {
      // Target is not an element (e.g. text node or document): nothing to delegate from.
      return;
    } else {
      // Valid element target: proceed to locate the nearest clickable button.
    }

    const button = rawTarget.closest<HTMLButtonElement>('button[data-path]');

    // Check whether a clickable button was found in the ancestor chain of the click point.
    if (button === null) {
      // No data-path button under the click point: ignore the event entirely.
    } else {
      // A data-path button was found: read its path and open that note.
      const path = button.getAttribute('data-path');

      // Check whether the button still carries a usable path attribute.
      if (path === null) {
        // Button lost its data-path attribute unexpectedly: do not navigate to an unknown location.
      } else {
        // Path present: open the referenced note.
        options.openNote(path);
      }
    }
  }

  // One delegated click listener on the stable body, added with an AbortController signal so a single destroy() removes it.
  // The body is rebuilt on every refresh, so per-button listeners would be created and abandoned each time; delegation keeps exactly one live listener at all times.
  bodyElement.addEventListener('click', handleBodyClick, { signal });

  /**
   * Rebuilds the backlinks panel body DOM hierarchy to reflect the current vault and note state.
   *
   * @purpose Evaluates vault status, on-screen note path, and grouped references, updating body children via replaceChildren.
   * @inputs void.
   * @outputs void.
   * @dataflow options.hasVault(), options.documentPath(), options.backlinks() -> grouping by first-appearance path -> DOM node generation -> bodyElement.replaceChildren().
   * @controlflow Check destroyed guard -> check options.hasVault() -> if false render no folder open; else check documentPath() -> if null render save prompt; else check backlinks() -> if empty render nothing links here; else render count line and grouped rows -> update body.
   */
  function refresh(): void {
    // Check if the component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: skip rebuild so a stale render never resurrects after teardown.
      return;
    } else {
      // Active component: proceed to evaluate state and rebuild the body.
    }

    // Check whether a vault folder is currently open.
    if (!options.hasVault()) {
      const emptyLine = doc.createElement('div');
      emptyLine.className = 'kdoc-backlinks-empty';
      emptyLine.textContent = 'No folder open.';
      bodyElement.replaceChildren(emptyLine);
      return;
    } else {
      // A vault is open: proceed to check whether the on-screen note has a path.
    }

    // Check whether the note currently on screen has been saved (has a path).
    const documentPath: string | null = options.documentPath();
    if (documentPath === null) {
      const emptyLine = doc.createElement('div');
      emptyLine.className = 'kdoc-backlinks-empty';
      emptyLine.textContent = 'Save the note to see what links to it.';
      bodyElement.replaceChildren(emptyLine);
      return;
    } else {
      // The on-screen note has a path: references may exist, so proceed.
    }

    const rows: readonly BacklinkRow[] = options.backlinks();

    // Check whether any references to the current note currently exist.
    if (rows.length === 0) {
      const emptyLine = doc.createElement('div');
      emptyLine.className = 'kdoc-backlinks-empty';
      emptyLine.textContent = 'Nothing links here.';
      bodyElement.replaceChildren(emptyLine);
      return;
    } else {
      // References exist: build the count line and grouped rows.
    }

    // Group rows by source path in first-appearance order, preserving each group's row order. A Map preserves insertion order, so iteration yields paths in the order they first appear in rows().
    const groups: Map<string, BacklinkRow[]> = new Map();
    for (let i = 0; i < rows.length; i++) {
      const row: BacklinkRow | undefined = rows[i];
      // Guard against undefined under strict noUncheckedIndexedAccess.
      if (row === undefined) {
        // Undefined entry: skip.
        continue;
      } else {
        // Valid row: append to its source-path group, creating the group on first appearance with this row as its sample.
        const group: BacklinkRow[] | undefined = groups.get(row.path);
        // Check whether this source note has been seen before.
        if (group === undefined) {
          // First appearance: start its group here, which is also what fixes its position in the list.
          groups.set(row.path, [row]);
        } else {
          // Group already exists for this path: reuse it and append the row in order.
          group.push(row);
        }
      }
    }

    const children: HTMLElement[] = [];

    // Build the count line describing references and distinct source notes with correct singular/plural forms for all four combinations.
    const referenceCount: number = rows.length;
    const noteCount: number = groups.size;
    const referenceWord: string = referenceCount === 1 ? 'reference' : 'references';
    const noteWord: string = noteCount === 1 ? 'note' : 'notes';

    const countLine = doc.createElement('div');
    countLine.className = 'kdoc-backlinks-count';
    countLine.textContent = `${referenceCount} ${referenceWord} from ${noteCount} ${noteWord}`;
    children.push(countLine);

    // Render each source note group: a source button followed by its context buttons, in first-appearance order.
    for (const [path, groupRows] of groups) {
      // Check whether a sample row exists for this source note to drive the source button's title and path.
      const sampleRow: BacklinkRow | undefined = groupRows[0];
      if (sampleRow === undefined) {
        // No sample row available: nothing to render for this group; skip defensively.
        continue;
      } else {
        // Sample row present: build the source button and its context rows.
        const sourceButton = createSourceButton(path, sampleRow, doc);
        children.push(sourceButton);

        for (let j = 0; j < groupRows.length; j++) {
          const row: BacklinkRow | undefined = groupRows[j];
          // Guard against undefined under strict noUncheckedIndexedAccess.
          if (row === undefined) {
            // Undefined entry: skip.
            continue;
          } else {
            // Valid row: render its context button beneath the source note.
            const contextButton = createContextButton(path, row, doc);
            children.push(contextButton);
          }
        }
      }
    }

    bodyElement.replaceChildren(...children);
  }

  /**
   * Cleans up all backlinks panel resources, aborting the listener signal and clearing DOM nodes.
   *
   * @purpose Idempotently tears down the delegated event listener and empties the body children without disturbing the mounted root element.
   * @inputs void.
   * @outputs void.
   * @dataflow abortController.abort() -> clear DOM children -> reset state.
   * @controlflow Check destroyed flag (return early if true) -> mark destroyed -> abort listeners -> clear body children only, leaving the mounted root in place.
   */
  function destroy(): void {
    // Check if the component has already been destroyed.
    if (destroyed) {
      // Already destroyed: return immediately for idempotent teardown.
      return;
    } else {
      // Active component: mark destroyed and proceed with teardown.
      destroyed = true;
    }

    abortController.abort();
    // Clear only the body's children, never the root: the sidebar mounts a panel once, so replacing the root would leave a panel on screen showing nothing.
    bodyElement.replaceChildren();
  }

  // Execute initial refresh to render initial backlinks panel state.
  refresh();

  return {
    element: rootElement,
    refresh,
    destroy,
  };
}
