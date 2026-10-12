/**
 * @file metadata-panel.ts
 * @purpose Implements MetadataPanel, the metadata surface for K-Doc's right sidebar (FR-14.7) reporting what is known about the document on screen: where it lives, its front-matter fields, and its statistics. Renders three static sections -- File, Front matter, Statistics -- with no interactive controls and full lifecycle cleanup via AbortController.
 * @inputs MetadataPanelOptions containing Document context, path accessor, parsed front-matter accessor, and statistics accessor.
 * @outputs MetadataPanel controller exposing mounted element, refresh, and destroy lifecycle methods, alongside METADATA_PANEL_STYLES CSS stylesheet definition and formatFieldValue value formatter.
 * @functions
 *   - installMetadataPanel: Instantiates and mounts the metadata panel hierarchy, binds lifecycle methods with AbortController, and returns the MetadataPanel controller.
 *   - formatFieldValue: Formats a single front-matter value as one readable line.
 *   - buildRow: Builds a single metadata row element with key/value spans and data-key attribute.
 *   - buildSection: Builds a metadata section containing an h3 heading followed by its rows or empty readouts.
 *   - buildEmptyLine: Builds a kdoc-metadata-empty readout div for empty states.
 *   - renderFileSection: Renders the File section from the document path accessor.
 *   - renderFrontMatterSection: Renders the Front matter section from the front-matter accessor.
 *   - renderStatisticsSection: Renders the Statistics section from the statistics accessor.
 *   - refresh: Rebuilds the metadata panel body DOM to reflect current document state.
 *   - destroy: Idempotently tears down the AbortController and clears DOM children.
 * @dataflow MetadataPanelOptions accessors (documentPath, frontMatter, statistics) -> section evaluation -> DOM node construction -> replaceChildren update on kdoc-metadata-body.
 * @controlflow Initialize root container and stable body DOM -> perform initial refresh -> return MetadataPanel controller.
 * @version 3
 * @date 2026-10-04
 */

/** The document statistics the panel reports. Mirrors DocumentStatistics from @k-doc/core. */
export interface MetadataStatistics {
  readonly words: number;
  readonly charactersWithSpaces: number;
  readonly charactersWithoutSpaces: number;
  readonly paragraphs: number;
  readonly sentences: number;
  readonly readingMinutes: number;
}

export interface MetadataPanelOptions {
  readonly doc: Document;
  /** The document's path on disk, or null when it has never been saved. */
  readonly documentPath: () => string | null;
  /** The parsed front-matter fields, or null when the document has no front matter. */
  readonly frontMatter: () => Readonly<Record<string, unknown>> | null;
  /** Counts for the document as it currently stands. */
  readonly statistics: () => MetadataStatistics;
}

export interface MetadataPanel {
  readonly element: HTMLElement;
  refresh(): void;
  destroy(): void;
}

/**
 * Static stylesheet for the metadata panel, defining vertical panel layout,
 * scrollable body, section headings, key/value rows, and empty state readouts
 * using authoritative K-Doc design tokens.
 */
export const METADATA_PANEL_STYLES: string = `
.kdoc-metadata-panel {
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

.kdoc-metadata-panel[hidden] {
  display: none !important;
}

.kdoc-metadata-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 0;
  scrollbar-width: thin;
  scrollbar-color: var(--kdoc-chrome-raised) var(--kdoc-chrome-base);
}

.kdoc-metadata-body::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.kdoc-metadata-body::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

.kdoc-metadata-body::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-metadata-empty {
  font-size: 12px;
  color: var(--kdoc-chrome-text-muted);
  font-style: italic;
  padding: 4px 12px;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-metadata-section {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-lg);
  box-shadow: var(--kdoc-elevation-raised);
  padding: 12px 14px;
  margin: 12px 8px;
  box-sizing: border-box;
}

.kdoc-metadata-heading {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--kdoc-chrome-text-muted);
  padding: 0 0 6px 0;
  margin: 0;
  font-weight: 600;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-metadata-row {
  display: flex;
  gap: 8px;
  padding: 3px 0;
  font-size: 12px;
  align-items: baseline;
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-metadata-key {
  flex: 0 0 40%;
  color: var(--kdoc-chrome-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kdoc-metadata-value {
  flex: 1 1 auto;
  color: var(--kdoc-chrome-text);
  font-family: monospace;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-metadata-panel * {
    transition: none !important;
  }
}
`;

/**
 * Formats a single front-matter value as one readable line.
 *
 * @purpose Reduces an arbitrary front-matter value to a compact, human-readable string for display in a metadata row.
 * @inputs value - The unknown front-matter value to format.
 * @outputs string - The single-line readable representation of the value.
 * @dataflow value -> type-based narrowing (null, undefined, string, number/boolean, array, object) -> formatted string.
 * @controlflow Check null -> return 'null'; check undefined -> return ''; check string -> return itself; check number/boolean -> String(value); check array -> join formatted elements or '(empty)'; else JSON.stringify with try/catch fallback to '(unreadable)'.
 */
export function formatFieldValue(value: unknown): string {
  // Check whether the value is null.
  if (value === null) {
    // null renders as the literal string 'null'.
    return 'null';
  } else {
    // Not null: continue narrowing toward a printable representation.
  }

  // Check whether the value is undefined.
  if (value === undefined) {
    // undefined renders as an empty string.
    return '';
  } else {
    // Not undefined: continue narrowing.
  }

  // Check whether the value is a string.
  if (typeof value === 'string') {
    // A string is shown itself, unchanged and unquoted.
    return value;
  } else {
    // Not a string: continue narrowing.
  }

  // Check whether the value is a number or boolean.
  if (typeof value === 'number' || typeof value === 'boolean') {
    // A number or boolean renders via String(value).
    return String(value);
  } else {
    // Neither number nor boolean: fall through to array and object handling.
  }

  // Check whether the value is an array.
  if (Array.isArray(value)) {
    // An array renders each element formatted, joined with ', '.
    if (value.length === 0) {
      // Empty array renders as '(empty)' rather than a blank line.
      return '(empty)';
    } else {
      // Non-empty array: format every element and join them so common values like tags stay readable.
      const parts = value.map((element): string => formatFieldValue(element));
      return parts.join(', ');
    }
  } else {
    // Not an array: fall through to generic object handling.
  }

  // Any other object renders as JSON, falling back to '(unreadable)' when it cannot be serialized.
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      // JSON.stringify returned undefined (e.g. a toJSON that yields undefined): treat as unreadable.
      return '(unreadable)';
    } else {
      // Successfully serialized: return the JSON text.
      return serialized;
    }
  } catch {
    // JSON.stringify threw (circular structure): the field cannot be printed without taking the panel down with it.
    return '(unreadable)';
  }
}


/**
 * Installs the metadata panel into an owned DOM hierarchy, configuring path, front-matter, and statistics rendering, and resource cleanup lifecycles.
 *
 * @purpose Creates the metadata panel container and stable body, binds lifecycle methods, and returns the MetadataPanel controller.
 * @inputs options - MetadataPanelOptions providing Document context, path accessor, front-matter accessor, and statistics accessor.
 * @outputs MetadataPanel - Controller interface exposing mounted element, refresh, and destroy methods.
 * @dataflow options accessors (documentPath, frontMatter, statistics) -> section evaluation -> DOM node construction -> replaceChildren on kdoc-metadata-body.
 * @controlflow Initialize root container and stable body DOM -> initialize destroyed flag and AbortController -> execute initial refresh -> return MetadataPanel controller interface.
 */
export function installMetadataPanel(options: MetadataPanelOptions): MetadataPanel {
  const doc = options.doc;
  const abortController = new AbortController();

  let destroyed: boolean = false;

  const rootElement = doc.createElement('div');
  rootElement.className = 'kdoc-metadata-panel';

  // Build a stable <div class="kdoc-metadata-body"> inside element once and only ever replace that body's children on refresh,
  // so the panel's own element identity survives across updates.
  const bodyElement = doc.createElement('div');
  bodyElement.className = 'kdoc-metadata-body';
  rootElement.appendChild(bodyElement);

  /**
   * Builds a single metadata row: key/value spans with data-key for test targeting.
   *
   * @purpose Creates a kdoc-metadata-row div containing a key span and value span, tagged with data-key so a test can find one without counting.
   * @inputs key - The row's label (also used as the data-key attribute value).
   * @inputs valueText - The display text for the value span.
   * @inputs valueTitle - Optional tooltip title mirrored onto the value span; omitted when undefined.
   * @outputs HTMLElement - The configured row element.
   * @dataflow key, valueText, and optional valueTitle -> spans with className and textContent -> div.row with data-key and optional title -> return row.
   * @controlflow Create div -> set class and data-key -> create key span -> create value span -> optionally set title -> append both spans -> return.
   */
  function buildRow(key: string, valueText: string, valueTitle?: string): HTMLElement {
    const row = doc.createElement('div');
    row.className = 'kdoc-metadata-row';
    row.setAttribute('data-key', key);

    const keySpan = doc.createElement('span');
    keySpan.className = 'kdoc-metadata-key';
    keySpan.textContent = key;

    const valueSpan = doc.createElement('span');
    valueSpan.className = 'kdoc-metadata-value';
    valueSpan.textContent = valueText;

    // Check whether a tooltip title was requested for the value span.
    if (valueTitle !== undefined) {
      // A title is provided: mirror it into the title attribute so an ellipsised value stays readable on hover.
      valueSpan.title = valueTitle;
    } else {
      // No tooltip requested: leave the title unset.
    }

    row.appendChild(keySpan);
    row.appendChild(valueSpan);

    return row;
  }

  /**
   * Builds a metadata section: h3 heading followed by its rows or empty readouts.
   *
   * @purpose Creates a kdoc-metadata-section containing an h3 heading as its first child, then the provided children in order.
   * @inputs heading - The section heading text rendered in the h3.
   * @inputs children - Row or empty-readout elements that make up the section body.
   * @outputs HTMLElement - The configured section element.
   * @dataflow heading and children -> section div with h3 first then each child -> return section.
   * @controlflow Create section div -> create h3 heading -> append heading -> iterate children appending each -> return.
   */
  function buildSection(heading: string, children: readonly HTMLElement[]): HTMLElement {
    const section = doc.createElement('section');
    section.className = 'kdoc-metadata-section';

    const headingElement = doc.createElement('h3');
    headingElement.className = 'kdoc-metadata-heading';
    headingElement.textContent = heading;

    // The heading is always the section's first child, followed by its rows or empty readouts.
    section.appendChild(headingElement);

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      // Guard against undefined under strict noUncheckedIndexedAccess.
      if (child === undefined) {
        continue;
      } else {
        section.appendChild(child);
      }
    }

    return section;
  }

  /**
   * Builds a kdoc-metadata-empty readout line.
   *
   * @purpose Creates a div.kdoc-metadata-empty with the given text for empty states such as no path or no front matter.
   * @inputs text - The exact message to display.
   * @outputs HTMLElement - The configured empty-readout element.
   * @dataflow text -> div.empty with className and textContent -> return.
   * @controlflow Create div -> set class and textContent -> return.
   */
  function buildEmptyLine(text: string): HTMLElement {
    const empty = doc.createElement('div');
    empty.className = 'kdoc-metadata-empty';
    empty.textContent = text;
    return empty;
  }

  /**
   * Renders the File section: document path (Name + Path rows) or a "Not saved yet." readout.
   *
   * @purpose Builds the File metadata section from options.documentPath().
   * @inputs void.
   * @outputs HTMLElement - The File section element.
   * @dataflow options.documentPath() -> path evaluation -> Name/Path rows or empty readout -> section.
   * @controlflow Check documentPath non-null -> if null render 'Not saved yet.'; else compute last path segment as Name and full Path row with tooltip -> build section.
   */
  function renderFileSection(): HTMLElement {
    const path = options.documentPath();

    // Check whether the document has a known on-disk path.
    if (path === null) {
      // Document never saved: show the empty readout.
      return buildSection('File', [buildEmptyLine('Not saved yet.')]);
    } else {
      // Document has a path: render Name and Path rows.
    }

    // Split on both / and \ and take the last non-empty piece as the display name, so trailing or doubled separators are ignored.
    const segments = path.split(/[/\\]/);
    let name = '';
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      // Guard against undefined under strict noUncheckedIndexedAccess.
      if (segment === undefined) {
        continue;
      } else {
        // Update the running name only on a non-empty segment, so trailing separators do not yield an empty name.
        if (segment.length > 0) {
          name = segment;
        } else {
          // Empty segment from a doubled or trailing separator: keep the previous non-empty piece.
        }
      }
    }

    const nameRow = buildRow('Name', name);
    // The Path row's value span also carries the full path as a title, since a long path is ellipsised and the tooltip is the only way to read the rest.
    const pathRow = buildRow('Path', path, path);

    return buildSection('File', [nameRow, pathRow]);
  }

  /**
   * Renders the Front matter section: one row per own front-matter field, or a "None." readout.
   *
   * @purpose Builds the Front matter section from options.frontMatter().
   * @inputs void.
   * @outputs HTMLElement - The Front matter section element.
   * @dataflow options.frontMatter() -> key enumeration via Object.keys -> per-key formatFieldValue rows or empty readout -> section.
   * @controlflow Check frontMatter non-null and has own keys -> if null/empty render 'None.'; else build one row per key in the object's own key order -> build section.
   */
  function renderFrontMatterSection(): HTMLElement {
    const fields = options.frontMatter();

    // Check whether the document carries any parsed front matter at all.
    if (fields === null) {
      // No front matter: show the empty readout.
      return buildSection('Front matter', [buildEmptyLine('None.')]);
    } else {
      // Front matter exists: check for own enumerable keys.
    }

    const keys = Object.keys(fields);

    // Check whether there is at least one front-matter field to show.
    if (keys.length === 0) {
      // Present but empty object: nothing to display.
      return buildSection('Front matter', [buildEmptyLine('None.')]);
    } else {
      // At least one field: render each in the object's own key order.
    }

    const rows: HTMLElement[] = [];
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      // Guard against undefined under strict noUncheckedIndexedAccess.
      if (key === undefined) {
        continue;
      } else {
        // Valid key: look up its value and format it for a single readable line.
        const value = fields[key];
        rows.push(buildRow(key, formatFieldValue(value)));
      }
    }

    return buildSection('Front matter', rows);
  }

  /**
   * Renders the Statistics section: word/character/sentence/paragraph counts and reading time.
   *
   * @purpose Builds the Statistics section from options.statistics().
   * @inputs void.
   * @outputs HTMLElement - The Statistics section element.
   * @dataflow options.statistics() -> per-metric formatting (toLocaleString for counts, 'N min' for reading time) -> six rows -> section.
   * @controlflow Read statistics -> build each of the six rows in fixed order with locale-formatted counts and special-cased reading time -> build section.
   */
  function renderStatisticsSection(): HTMLElement {
    const stats = options.statistics();

    // Reading time: 'Under a minute' at 0, 'N min' otherwise. A reading time of '0 min' would claim the document takes no time to read, which is not what a nearly-empty document means.
    let readingTime: string;
    if (stats.readingMinutes === 0) {
      // Zero minutes: the document reads in under a minute.
      readingTime = 'Under a minute';
    } else {
      // One or more minutes: render as 'N min'.
      readingTime = `${stats.readingMinutes} min`;
    }

    const rows: HTMLElement[] = [
      buildRow('Words', stats.words.toLocaleString('en-US')),
      buildRow('Characters', stats.charactersWithSpaces.toLocaleString('en-US')),
      buildRow('Characters (no spaces)', stats.charactersWithoutSpaces.toLocaleString('en-US')),
      buildRow('Sentences', stats.sentences.toLocaleString('en-US')),
      buildRow('Paragraphs', stats.paragraphs.toLocaleString('en-US')),
      buildRow('Reading time', readingTime),
    ];

    return buildSection('Statistics', rows);
  }

  /**
   * Rebuilds the metadata panel body DOM hierarchy to reflect the current document state.
   *
   * @purpose Evaluates path, front matter, and statistics accessors and rebuilds the three sections via replaceChildren.
   * @inputs void.
   * @outputs void.
   * @dataflow options.documentPath(), options.frontMatter(), options.statistics() -> section builders -> bodyElement.replaceChildren().
   * @controlflow Check destroyed guard -> build File, Front matter, Statistics sections in order -> update body.
   */
  function refresh(): void {
    // Check if the component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort refresh operation.
      return;
    } else {
      // Component is active: proceed with DOM reconstruction.
    }

    const sections: HTMLElement[] = [
      renderFileSection(),
      renderFrontMatterSection(),
      renderStatisticsSection(),
    ];

    bodyElement.replaceChildren(...sections);
  }

  /**
   * Cleans up all metadata panel resources, aborting the listener controller and clearing DOM nodes.
   *
   * @purpose Idempotently tears down the AbortController and empties container children.
   * @inputs void.
   * @outputs void.
   * @dataflow abortController.abort() -> clear DOM children -> reset state.
   * @controlflow Check destroyed flag (return early if true) -> mark destroyed -> abort controller -> clear body and root children.
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

    // This panel exposes no interactive controls, so it attaches no event listeners. The AbortController is still created and
    // aborted here purely to keep the teardown shape identical to its neighbour panels, so that adding a control later cannot
    // forget to tear itself down.
    abortController.abort();
    bodyElement.replaceChildren();
  }

  // Execute initial refresh to render initial metadata panel state.
  refresh();

  return {
    element: rootElement,
    refresh,
    destroy,
  };
}
