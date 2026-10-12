/**
 * @file link-definitions-panel.ts
 * @purpose Renders K-Doc's right-sidebar Link Definitions panel (FR-8.16): a scrollable list of the document's reference-link definitions plus a button that rewrites inline links as reference links.
 * @inputs options.doc - Owning Document used to create DOM nodes; options.definitions() - Factory returning current definition rows; options.reveal(offset) - Scroll a definition into view in the editor; options.convert() - Rewrite inline links.
 * @outputs LinkDefinitionsPanel - Handle exposing the panel element and refresh()/destroy() lifecycle methods.
 * @functions
 *   - usesText: Formats a use count into singular/plural caption text.
 *   - installLinkDefinitionsPanel: Builds, wires, and mounts the panel; returns its handle.
 * @dataflow options.definitions() → mapped <li>/<button> rows → rendered inside the panel's <ul>; click events route to options.reveal or options.convert.
 * @controlflow Create controller/element/header/list/empty → attach convert listener → refresh() builds initial rows → return handle; refresh() rebuilds rows on demand, destroy() aborts the signal and empties children.
 * @version 3
 * @date 2026-10-04
 */

/** A single reference-link definition row as reported by the document model. */
export interface LinkDefinitionRow {
  readonly label: string;
  readonly url: string;
  readonly title: string | null;
  readonly start: number;
  readonly uses: number;
  readonly duplicate: boolean;
}

/** Configuration and callbacks accepted by installLinkDefinitionsPanel. */
export interface LinkDefinitionsPanelOptions {
  readonly doc: Document;
  readonly definitions: () => readonly LinkDefinitionRow[];
  /** Scroll the definition at the given character offset into view in the editor. */
  readonly reveal: (offset: number) => void;
  /** Rewrite the document's inline links as reference links using these definitions. */
  readonly convert: () => void;
}

/** Public handle returned by installLinkDefinitionsPanel. */
export interface LinkDefinitionsPanel {
  readonly element: HTMLElement;
  refresh(): void;
  destroy(): void;
}

/**
 * Styles for the Link Definitions panel. Consumed by the host stylesheet loader, not injected here.
 * @purpose Centralizes the panel's visual rules under a single exported constant.
 */
export const LINK_DEFINITIONS_PANEL_STYLES: string = `
.kdoc-link-definitions-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
  background: var(--kdoc-chrome-base);
  color: var(--kdoc-chrome-text);
}

.kdoc-link-definitions-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--kdoc-chrome-glass-edge);
}

.kdoc-link-definitions-count {
  color: var(--kdoc-chrome-text-muted);
  font-size: 12px;
  font-family: monospace;
  font-variant-numeric: tabular-nums;
}

.kdoc-link-definitions-convert {
  font: inherit;
  font-size: 12px;
  padding: 4px 10px;
  border: 1px solid var(--kdoc-chrome-glass-edge);
  border-radius: var(--kdoc-radius-md);
  background: var(--kdoc-chrome-raised);
  color: var(--kdoc-chrome-text);
  box-shadow: var(--kdoc-elevation-raised);
  cursor: pointer;
  transition: background 120ms ease, box-shadow 120ms ease, border-color 120ms ease, transform 120ms ease;
}

.kdoc-link-definitions-convert:hover,
.kdoc-link-definitions-convert:focus-visible {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  border-color: var(--kdoc-chrome-accent);
  box-shadow: none;
  outline: none;
}

.kdoc-link-definitions-convert:active {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
  box-shadow: none;
  transform: translateY(1px);
}

.kdoc-link-definitions-list {
  list-style: none;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.kdoc-link-definitions-list::-webkit-scrollbar {
  width: 8px;
}

.kdoc-link-definitions-list::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

.kdoc-link-definitions-list::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-link-definition {
  display: block;
  width: 100%;
  text-align: left;
  font: inherit;
  padding: 6px 12px;
  margin: 1px 0;
  border: none;
  border-radius: var(--kdoc-radius-md);
  background: transparent;
  color: var(--kdoc-chrome-text);
  cursor: pointer;
  transition: background 120ms ease, box-shadow 120ms ease;
}

.kdoc-link-definition:hover,
.kdoc-link-definition:focus-visible {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  outline: none;
}

.kdoc-link-definition:active {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
  box-shadow: none;
}

.kdoc-link-definition-label {
  font-weight: 600;
  font-family: monospace;
}

.kdoc-link-definition-url {
  display: block;
  color: var(--kdoc-chrome-text-muted);
  font-size: 12px;
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kdoc-link-definition-badge {
  margin-left: 6px;
  font-size: 11px;
  font-family: monospace;
  font-variant-numeric: tabular-nums;
  color: var(--kdoc-chrome-text-muted);
  padding: 1px 4px;
  border-radius: var(--kdoc-radius-pill);
}

.kdoc-link-definition-badge[data-kind="unused"],
.kdoc-link-definition-badge[data-kind="duplicate"] {
  color: var(--kdoc-emissive-amber);
}

.kdoc-link-definitions-empty {
  padding: 12px;
  color: var(--kdoc-chrome-text-muted);
  font-style: italic;
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-link-definitions-convert,
  .kdoc-link-definition {
    transition: none;
  }
}
`;

/**
 * usesText renders the usage-count caption shown beside a definition row.
 * @purpose Converts a use count into human-readable singular/plural text.
 * @inputs uses - Number of times this link definition has been referenced (always > 0 when called).
 * @outputs string - 'used once' for a single use, otherwise 'used N times'.
 * @dataflow Numeric count → ternary branch → formatted caption string.
 * @controlflow Returns the singular form when uses equals 1, else the plural form.
 */
function usesText(uses: number): string {
  // Singular grammar for exactly one reference; otherwise fall back to the plural phrasing.
  return uses === 1 ? 'used once' : `used ${uses} times`;
}

/**
 * installLinkDefinitionsPanel builds the Link Definitions panel (FR-8.16) and mounts it into a returned handle.
 * @purpose Constructs the sidebar panel that lists a document's reference-link definitions and offers an inline-to-reference conversion action.
 * @inputs options.doc - The owning Document used to create all DOM nodes.
 *   options.definitions - Factory returning the current link-definition rows for the document.
 *   options.reveal - Callback invoked with a character offset to scroll the definition into view in the editor.
 *   options.convert - Callback invoked to rewrite inline links as reference links.
 * @outputs LinkDefinitionsPanel - Object exposing the panel element plus refresh() and destroy() lifecycle methods.
 * @dataflow options.definitions() → row list → rendered <li>/<button> rows inside the panel's <ul>; click events route to options.reveal or options.convert.
 * @controlflow Create controller/element/header/list/empty → wire convert button click → build initial rows via refresh() → return handle; refresh() rebuilds rows on demand, destroy() aborts listeners and clears children.
 */
export function installLinkDefinitionsPanel(options: LinkDefinitionsPanelOptions): LinkDefinitionsPanel {
  const { doc } = options;
  // Single controller owns every listener so a lone abort releases them all on teardown.
  const controller = new AbortController();
  const signal = controller.signal;

  const element = doc.createElement('div');
  element.className = 'kdoc-link-definitions-panel';

  const count = doc.createElement('span');
  count.className = 'kdoc-link-definitions-count';

  const convertButton = doc.createElement('button');
  convertButton.type = 'button';
  convertButton.className = 'kdoc-link-definitions-convert';
  convertButton.textContent = 'Convert inline links';
  convertButton.title = 'Rewrite inline links as reference links with definitions at the end';
  // The { signal } option detaches this listener automatically when destroy() aborts the controller.
  convertButton.addEventListener('click', () => {
    options.convert();
  }, { signal });

  const header = doc.createElement('div');
  header.className = 'kdoc-link-definitions-header';
  header.append(count, convertButton);

  const list = doc.createElement('ul');
  list.className = 'kdoc-link-definitions-list';
  list.setAttribute('aria-label', 'Link definitions');

  const empty = doc.createElement('div');
  empty.className = 'kdoc-link-definitions-empty';
  empty.textContent = 'No link definitions. Convert inline links to create them.';

  element.append(header, list, empty);

  let destroyed = false;

  // refresh rebuilds the rows from a fresh snapshot of options.definitions().
  // @purpose Re-renders the list of link-definition rows and updates the count/empty-state visibility.
  // @inputs (none) - Reads options.definitions() for the live row set.
  // @outputs void - Mutates the panel's DOM children in place.
  // @dataflow options.definitions() → mapped <li> items → list.replaceChildren().
  // @controlflow Early-returns if destroyed; otherwise computes count text, toggles empty-state visibility, maps rows to items, and replaces list children.
  function refresh(): void {
    // Guard: a destroyed panel must not mutate DOM after its listeners have been released.
    if (destroyed) {
      return;
    } else {
      // Still mounted: redraw.
    }

    const rows = options.definitions();

    // Count caption uses singular grammar for exactly one definition.
    count.textContent = rows.length === 1 ? '1 definition' : `${rows.length} definitions`;

    // Hide the empty-state prompt whenever at least one definition exists.
    empty.hidden = rows.length > 0;

    const items = rows.map((row) => {
      const item = doc.createElement('li');
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'kdoc-link-definition';
      // Record the definition's start offset for callers that need it; read back as string under noUncheckedIndexedAccess.
      button.dataset['start'] = String(row.start);

      const label = doc.createElement('span');
      label.className = 'kdoc-link-definition-label';
      label.textContent = `[${row.label}]`;

      const badge = doc.createElement('span');
      badge.className = 'kdoc-link-definition-badge';
      // Badge text depends on duplicate status first, then usage count.
      if (row.duplicate) {
        // Duplicate definition flagged with a warning-colored badge and an explicit "never used" note.
        badge.dataset['kind'] = 'duplicate';
        badge.textContent = 'duplicate, never used';
      } else if (row.uses === 0) {
        // Non-duplicate but unreferenced: mark as unused in the warning color.
        badge.dataset['kind'] = 'unused';
        badge.textContent = 'unused';
      } else {
        // Referenced at least once: show a singular/plural usage count via usesText().
        badge.dataset['kind'] = 'used';
        badge.textContent = usesText(row.uses);
      }

      const url = doc.createElement('span');
      url.className = 'kdoc-link-definition-url';
      // Append the title in quotes only when present; a null title renders the bare URL.
      url.textContent = row.title === null ? row.url : `${row.url} "${row.title}"`;
      url.title = url.textContent;

      button.append(label, badge, url);
      // Clicking a row reveals its definition in the editor; { signal } detaches it on destroy().
      button.addEventListener('click', () => {
        options.reveal(row.start);
      }, { signal });

      item.append(button);
      return item;
    });

    // Detached old rows: refresh() replaces children, so prior listeners remain attached to the now-detached buttons until destroy() aborts the signal. This is acceptable because detached buttons are garbage-collected once replaced.
    list.replaceChildren(...items);
  }

  // destroy tears down the panel and detaches all listeners.
  // @purpose Marks the panel destroyed, aborts the controller (releasing every listener), and clears its DOM.
  // @inputs (none)
  // @outputs void - Mutates internal state and removes children from the element.
  // @dataflow Internal destroyed flag + AbortController → listeners released → element emptied.
  // @controlflow Early-returns if already destroyed; otherwise sets destroyed, aborts controller, and replaces children with none.
  function destroy(): void {
    // Guard: idempotent teardown so a second call is a no-op.
    // A second call aborts an aborted controller and empties an empty element, both harmless.
    destroyed = true;
    // Aborting releases the convert listener and every row reveal listener registered with this signal.
    controller.abort();
    element.replaceChildren();
  }

  refresh();

  return { element, refresh, destroy };
}
