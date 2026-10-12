/**
 * @file tags-panel.ts
 * @purpose Implements TagsPanel, the tags navigation panel for K-Doc's left sidebar (FR-14.6) listing vault tags and their associated notes.
 *   Renders vault tags with count badges and allows toggling an accordion-style note list directly beneath any selected tag.
 *   Handles un-opened vault, empty tag vault, empty note query, and multi-note states with full lifecycle cleanup.
 * @inputs TagsPanelOptions containing Document context, tag list accessor, tagged note query function, vault status accessor, and openNote callback.
 * @outputs TagsPanel controller exposing mounted element, refresh, and destroy lifecycle methods, alongside TAGS_PANEL_STYLES CSS stylesheet definition.
 * @functions
 *   - installTagsPanel: Instantiates and mounts the tags panel hierarchy, binds tag and note listeners with AbortController, and returns the TagsPanel controller.
 *   - createTagButton: Builds an accessible button element representing a single tag row with name span, count span, and ARIA toggle state.
 *   - createNoteButton: Builds an accessible button element representing a single tagged note with title and relative path tooltip.
 *   - handleTagToggle: Handles click toggle for a tag row, and restores focus to the button that replaced it.
 *   - refresh: Rebuilds the tags panel body DOM to reflect current vault status, tag counts, and selected tag note lists.
 *   - destroy: Idempotently tears down all event listeners via AbortController and clears DOM children.
 * @dataflow TagsPanelOptions accessors (hasVault, tags, notesTagged) -> state evaluation -> tag selection reconciliation -> DOM node construction -> replaceChildren update on kdoc-tags-body.
 * @controlflow Initialize root container and stable body DOM -> attach listener signals -> perform initial refresh -> return TagsPanel controller.
 * @version 3
 * @date 2026-10-04
 */

/** A tag and how many notes carry it. */
export interface TagRow {
  readonly tag: string;
  readonly count: number;
}

/** One note as the panel needs to draw it. */
export interface TaggedNote {
  readonly path: string;
  readonly relative: string;
  readonly title: string;
}

export interface TagsPanelOptions {
  readonly doc: Document;
  /** Every tag in the vault with its note count, ordered by count then name. */
  readonly tags: () => readonly TagRow[];
  /** The notes carrying a tag, or any tag nested under it. */
  readonly notesTagged: (tag: string) => readonly TaggedNote[];
  /** True when a vault is open. */
  readonly hasVault: () => boolean;
  /** Opens one note by its path. */
  readonly openNote: (path: string) => void;
}

export interface TagsPanel {
  readonly element: HTMLElement;
  refresh(): void;
  destroy(): void;
}

/**
 * Static stylesheet for the tags panel, defining vertical panel layout,
 * scrollable body, full-width tag toggle buttons, nested note buttons,
 * and empty state readouts using authoritative K-Doc design tokens.
 */
export const TAGS_PANEL_STYLES: string = `
.kdoc-tags-panel {
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

.kdoc-tags-panel[hidden] {
  display: none !important;
}

.kdoc-tags-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding: 4px 0;
  scrollbar-width: thin;
  scrollbar-color: var(--kdoc-chrome-raised) var(--kdoc-chrome-base);
}

.kdoc-tags-body::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.kdoc-tags-body::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

.kdoc-tags-body::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-tags-empty {
  font-size: 13px;
  color: var(--kdoc-chrome-text-muted);
  padding: 8px 12px;
  font-style: italic;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-tags-tag {
  width: calc(100% - 8px);
  min-height: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-md);
  margin: 1px 4px;
  background: transparent;
  color: var(--kdoc-chrome-text);
  font: inherit;
  font-size: 13px;
  line-height: 28px;
  padding: 0 12px;
  box-sizing: border-box;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, text-shadow 0.15s ease;
}

.kdoc-tags-tag:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-tags-tag:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-tags-tag.kdoc-tags-selected,
.kdoc-tags-tag[aria-pressed="true"] {
  background: var(--kdoc-chrome-accent);
  box-shadow: none;
  color: var(--kdoc-chrome-on-accent);
  font-weight: 700;
  border-radius: var(--kdoc-radius-md);
  border-color: var(--kdoc-chrome-accent);
}

.kdoc-tags-name {
  flex: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  margin-right: 8px;
  text-align: left;
}

.kdoc-tags-count {
  font-size: 11px;
  font-family: monospace;
  font-variant-numeric: tabular-nums;
  color: var(--kdoc-chrome-text-muted);
  flex-shrink: 0;
  font-weight: 400;
}

.kdoc-tags-notes {
  display: flex;
  flex-direction: column;
  padding-left: 12px;
}

.kdoc-tags-note {
  width: calc(100% - 8px);
  min-height: 28px;
  height: 28px;
  display: block;
  text-align: left;
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-md);
  margin: 1px 4px;
  background: transparent;
  color: var(--kdoc-chrome-text);
  font: inherit;
  font-size: 13px;
  line-height: 28px;
  padding: 0 12px;
  box-sizing: border-box;
  cursor: pointer;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  transition: background 0.15s ease, color 0.15s ease;
}

.kdoc-tags-note:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-tags-note:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border-radius: var(--kdoc-radius-md);
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-tags-panel * {
    transition: none !important;
  }
}
`;

/**
 * Creates an accessible button element representing a single tag row.
 *
 * @purpose Builds a tag button with name span, count span, ARIA selection state, and click toggle listener.
 * @inputs row - TagRow containing tag string and note count.
 * @inputs isSelected - Boolean indicating whether this tag is currently selected.
 * @inputs doc - Document context used for DOM element creation.
 * @inputs onToggle - Callback function invoked when the tag button is clicked.
 * @inputs signal - AbortSignal used to remove the click event listener on destroy.
 * @outputs HTMLButtonElement - The configured tag button element.
 * @dataflow TagRow data -> button element with spans and attributes -> click event dispatches onToggle(row.tag).
 * @controlflow Create button -> set attributes (type, data-tag, aria-pressed, className) -> create name span with '#' prefix -> create count span -> attach click listener -> return button.
 */
function createTagButton(
  row: TagRow,
  isSelected: boolean,
  doc: Document,
  onToggle: (tag: string) => void,
  signal: AbortSignal,
): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.setAttribute('data-tag', row.tag);

  // Check if this tag is currently selected.
  if (isSelected) {
    // When selected: button gains aria-pressed="true" and the class kdoc-tags-selected.
    button.setAttribute('aria-pressed', 'true');
    button.className = 'kdoc-tags-tag kdoc-tags-selected';
  } else {
    // Every other row has aria-pressed="false" and standard tag class.
    button.setAttribute('aria-pressed', 'false');
    button.className = 'kdoc-tags-tag';
  }

  // Prepend '#' to the tag name: the panel shows a tag the way the document writes it,
  // so what the user reads here is what they would type to find it.
  const nameSpan = doc.createElement('span');
  nameSpan.className = 'kdoc-tags-name';
  nameSpan.textContent = `#${row.tag}`;

  const countSpan = doc.createElement('span');
  countSpan.className = 'kdoc-tags-count';
  countSpan.textContent = String(row.count);

  button.appendChild(nameSpan);
  button.appendChild(countSpan);

  button.addEventListener(
    'click',
    (): void => {
      onToggle(row.tag);
    },
    { signal },
  );

  return button;
}

/**
 * Creates an accessible button element representing a tagged note.
 *
 * @purpose Builds a note button with click navigation, title display, relative path hover tooltip, and path metadata.
 * @inputs note - TaggedNote containing path, relative path, and note title.
 * @inputs doc - Document context used for DOM element creation.
 * @inputs options - TagsPanelOptions providing openNote navigation callback.
 * @inputs signal - AbortSignal used to remove the click event listener on destroy.
 * @outputs HTMLButtonElement - The configured note button element.
 * @dataflow TaggedNote metadata -> button element with textContent, title, and data-path -> click dispatches options.openNote.
 * @controlflow Create button -> set type, class, textContent, data-path, and title attributes -> attach click listener -> return button.
 */
function createNoteButton(
  note: TaggedNote,
  doc: Document,
  options: TagsPanelOptions,
  signal: AbortSignal,
): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'kdoc-tags-note';
  button.textContent = note.title;
  button.setAttribute('data-path', note.path);
  // Title attribute of its relative path for tooltip readability on hover.
  button.title = note.relative;

  button.addEventListener(
    'click',
    (): void => {
      options.openNote(note.path);
    },
    { signal },
  );

  return button;
}

/**
 * Installs the tags navigation panel into an owned DOM hierarchy, configuring vault status rendering,
 * tag list display, note list expansion upon tag selection, and resource cleanup lifecycles.
 *
 * @purpose Creates the tags panel container and stable body, binds lifecycle methods, and returns the TagsPanel controller.
 * @inputs options - TagsPanelOptions providing Document context, tag accessor, tagged notes query function, vault status accessor, and note open callback.
 * @outputs TagsPanel - Controller interface exposing mounted element, refresh, and destroy methods.
 * @dataflow options accessors (hasVault, tags, notesTagged) -> state evaluation -> tag selection reconciliation -> DOM node construction -> replaceChildren on kdoc-tags-body.
 * @controlflow Initialize root container and stable body DOM -> initialize state and AbortController -> execute initial refresh -> return TagsPanel controller interface.
 */
export function installTagsPanel(options: TagsPanelOptions): TagsPanel {
  const doc = options.doc;
  const abortController = new AbortController();
  const signal = abortController.signal;

  let destroyed: boolean = false;
  let selectedTag: string | null = null;

  const rootElement = doc.createElement('div');
  rootElement.className = 'kdoc-tags-panel';

  // Build a stable <div class="kdoc-tags-body"> inside element once and only ever replace that body's children on refresh,
  // so the panel's own element identity survives across updates.
  const bodyElement = doc.createElement('div');
  bodyElement.className = 'kdoc-tags-body';
  rootElement.appendChild(bodyElement);

  /**
   * Handles tag toggle selection when a tag row button is clicked.
   *
   * @purpose Toggles selection for the clicked tag (deselects if already selected, selects otherwise) and triggers a refresh.
   * @inputs tag - The tag string associated with the clicked button.
   * @outputs void.
   * @dataflow tag string -> update selectedTag state -> invoke refresh().
   * @controlflow Check if clicked tag equals current selectedTag -> if true set selectedTag to null; else set selectedTag to tag -> call refresh().
   */
  function handleTagToggle(tag: string): void {
    // Check if the clicked tag is already selected.
    if (selectedTag === tag) {
      // Clicking the selected tag again deselects it and removes the list.
      // A tag panel that could only ever open and never close would grow until it was unusable.
      selectedTag = null;
    } else {
      // Clicking an unselected tag selects it and expands its note list.
      // A tag panel that could only ever open and never close would grow until it was unusable.
      selectedTag = tag;
    }

    refresh();

    // refresh() replaces every child, so the button the user just pressed no longer exists -- a
    // keyboard user would be dropped back to the top of the document mid-gesture. Put focus on the
    // button that replaced it, which is the one they are still looking at.
    const replacement = bodyElement.querySelector<HTMLButtonElement>(
      'button.kdoc-tags-tag[data-tag="' + tag + '"]',
    );
    // Check whether a button for that tag survived the redraw.
    if (replacement === null) {
      // Gone -- the tag was dropped by the same refresh. There is nothing to focus, and guessing at a
      // neighbour would move the user somewhere they did not ask to be.
    } else {
      // Still there: hand focus back to it.
      replacement.focus();
    }
  }

  /**
   * Rebuilds the tags panel body DOM hierarchy to reflect the current vault and tag state.
   *
   * @purpose Evaluates vault status, manages selected tag lifecycle, and updates body children via replaceChildren.
   * @inputs void.
   * @outputs void.
   * @dataflow options.hasVault(), options.tags(), options.notesTagged() -> selection reconciliation -> DOM node generation -> bodyElement.replaceChildren().
   * @controlflow Check destroyed guard -> check options.hasVault() -> if false render no folder open; else check options.tags() -> if empty render no tags in vault; else validate selectedTag -> render tag rows and expanded notes -> update body.
   */
  function refresh(): void {
    // Check if the component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort refresh operation.
      return;
    } else {
      // Component is active: proceed with DOM reconstruction.
    }

    // Check whether a vault is currently open.
    if (!options.hasVault()) {
      // State 1: No vault open.
      selectedTag = null;

      const emptyLine = doc.createElement('div');
      emptyLine.className = 'kdoc-tags-empty';
      emptyLine.textContent = 'No folder open.';
      bodyElement.replaceChildren(emptyLine);
      return;
    } else {
      // Vault is open: proceed to check tags.
    }

    const tagRows = options.tags();

    // Check whether any tags exist in the vault.
    if (tagRows.length === 0) {
      // State 2: No tags in vault.
      // An empty list says nothing about whether the vault has no tags or the panel is broken.
      selectedTag = null;

      const emptyLine = doc.createElement('div');
      emptyLine.className = 'kdoc-tags-empty';
      emptyLine.textContent = 'No tags in this vault.';
      bodyElement.replaceChildren(emptyLine);
      return;
    } else {
      // State 3: Tags are present in the vault.
    }

    // Check if a tag was previously selected.
    if (selectedTag !== null) {
      let tagFound: boolean = false;

      // Iterate through current tag rows to verify if the selected tag is still present.
      for (let i = 0; i < tagRows.length; i++) {
        const row = tagRows[i];
        // Guard against undefined under strict noUncheckedIndexedAccess.
        if (row === undefined) {
          // Undefined row entry: skip.
          continue;
        } else {
          // Check if this row matches the selected tag.
          if (row.tag === selectedTag) {
            tagFound = true;
            break;
          } else {
            // Row tag does not match selected tag.
          }
        }
      }

      // Keep the selected tag across a refresh(), but drop it when it is no longer in tags().
      // A tag that no longer exists cannot stay selected, and silently showing its old note list would be showing something that is not there.
      if (!tagFound) {
        // Tag is no longer present in tags(): drop selection.
        selectedTag = null;
      } else {
        // Tag is still present: retain selection across refresh.
      }
    } else {
      // No tag was previously selected.
    }

    const children: HTMLElement[] = [];

    // Iterate through tag rows in order to render tag buttons and any expanded note lists.
    for (let i = 0; i < tagRows.length; i++) {
      const row = tagRows[i];
      // Guard against undefined under strict noUncheckedIndexedAccess.
      if (row === undefined) {
        // Undefined row entry: skip.
        continue;
      } else {
        // Valid tag row: proceed to render button.
      }

      const isSelected: boolean = selectedTag !== null && selectedTag === row.tag;
      const tagButton = createTagButton(row, isSelected, doc, handleTagToggle, signal);
      children.push(tagButton);

      // Check if this tag row is currently selected to display its note list.
      if (isSelected) {
        const notesContainer = doc.createElement('div');
        notesContainer.className = 'kdoc-tags-notes';

        const notes = options.notesTagged(row.tag);

        // Check if there are any notes carrying this tag.
        if (notes.length === 0) {
          // When a selected tag has no notes — which can happen after the index changes underneath —
          // show 'No notes with this tag.' in kdoc-tags-empty in that slot rather than an empty gap.
          const emptyNotes = doc.createElement('div');
          emptyNotes.className = 'kdoc-tags-empty';
          emptyNotes.textContent = 'No notes with this tag.';
          notesContainer.appendChild(emptyNotes);
        } else {
          // Iterate over tagged notes to render note buttons.
          for (let j = 0; j < notes.length; j++) {
            const note = notes[j];
            // Guard against undefined under strict noUncheckedIndexedAccess.
            if (note === undefined) {
              // Undefined note entry: skip.
              continue;
            } else {
              // Valid note entry: construct button and append to notes container.
            }

            notesContainer.appendChild(createNoteButton(note, doc, options, signal));
          }
        }

        children.push(notesContainer);
      } else {
        // Tag row is not selected: do not render note list.
      }
    }

    bodyElement.replaceChildren(...children);
  }

  /**
   * Cleans up all tags panel resources, aborting listener signals and clearing DOM nodes.
   *
   * @purpose Idempotently tears down event listeners and empties container children.
   * @inputs void.
   * @outputs void.
   * @dataflow abortController.abort() -> clear DOM children -> reset state.
   * @controlflow Check destroyed flag (return early if true) -> mark destroyed -> abort listeners -> clear body and root children.
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
    bodyElement.replaceChildren();
    rootElement.replaceChildren();
  }

  // Execute initial refresh to render initial tags panel state.
  refresh();

  return {
    element: rootElement,
    refresh,
    destroy,
  };
}
