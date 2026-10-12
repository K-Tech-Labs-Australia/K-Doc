/**
 * @file outline-pane.ts
 * @purpose Implements OutlinePane, a Word-style navigation pane for K-Doc listing document headings with depth indentation and active section tracking.
 *   The outline pane inspects top-level document headings derived from the authoritative DocumentSession snapshot AST, rendering an accessible
 *   navigation list. Clicking a heading reveals its source text range in CodeMirror, while caret movements dynamically track the current section.
 *   DOM rebuilds are skipped when heading entries are unchanged to eliminate typing flicker and maintain user interaction state.
 * @inputs OutlinePaneOptions containing container HTMLElement, Document context, DocumentSession, revealRange callback, and caretOffset reader.
 * @outputs OutlinePane controller interface exposing isVisible, show, hide, toggle, refresh, and destroy lifecycle methods, alongside OUTLINE_PANE_STYLES CSS stylesheet definition.
 * @functions
 *   - installOutlinePane: Instantiates and mounts outline navigation pane into the container, binds click listeners, coordinates active heading tracking, and returns the OutlinePane controller.
 *   - areEntriesEqual: Compares previous and next OutlineEntry sequences by length, depth, text, and start offset to determine if a DOM rebuild is needed.
 *   - updateActiveRow: Evaluates the active heading index for the current caret offset and synchronizes aria-current attributes on row buttons.
 *   - rebuildDom: Reconstructs the pane's inner DOM hierarchy with either an unordered list of heading buttons or an empty state message.
 *   - refresh: Derives fresh outline entries from the session snapshot, rebuilding the DOM if entries changed or updating the active row if unchanged.
 *   - show: Reveals the outline pane container by resetting hidden to false.
 *   - hide: Hides the outline pane container by setting hidden to true.
 *   - toggle: Toggles outline pane visibility between shown and hidden states.
 *   - destroy: Tears down all event listeners via AbortController, clears container attributes, and empties child elements.
 * @dataflow DocumentSession snapshot AST -> buildOutline -> areEntriesEqual check -> DOM li/button hierarchy or updateActiveRow -> revealRange on click.
 * @controlflow Mount <nav> and heading -> attach event listeners with AbortController -> perform initial refresh -> return OutlinePane controller with visibility and lifecycle methods.
 * @version 4
 * @date 2026-10-03
 */

import type { DocumentSession, OutlineEntry } from '@k-doc/core';
import { buildOutline, activeOutlineIndex } from '@k-doc/core';

export interface OutlinePaneOptions {
  readonly container: HTMLElement;
  readonly doc: Document;
  readonly session: DocumentSession;
  /** Reveal [start, end) of the source text. The host owns pane visibility and scrolling. */
  readonly revealRange: (start: number, end: number) => void;
  /** The caret offset in the source text, used to highlight the section being edited. */
  readonly caretOffset: () => number;
  /** Reports a section reorder to the host; the pane applies nothing itself because the host owns the
   *  edit lock. The two indices are positions in the flat outline array. */
  readonly moveSection?: (fromIndex: number, toIndex: number) => void;
}

export interface OutlinePane {
  readonly isVisible: boolean;
  show(): void;
  hide(): void;
  toggle(): void;
  /** Rebuild the list from the session. Call when the document changed. */
  refresh(): void;
  destroy(): void;
}

/**
 * Static stylesheet for the outline navigation pane, defining fixed-width column layout,
 * depth-indented button rows, active-row visual indicators, and focus outlines using exclusively authoritative K-Doc design tokens.
 */
export const OUTLINE_PANE_STYLES: string = `
.kdoc-outline {
  width: 220px;
  min-width: 220px;
  max-width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
  border-right: 1px solid var(--kdoc-chrome-glass-edge);
  border-radius: var(--kdoc-radius-lg);
  background: var(--kdoc-chrome-base);
  color: var(--kdoc-chrome-text);
  box-sizing: border-box;
  box-shadow: inset 1px 1px 0 var(--kdoc-chrome-highlight);
}

/* The UA stylesheet's [hidden] { display: none } loses to class rules specifying display: flex.
   An explicit [hidden] selector rule is mandatory so elements with hidden = true never stay visible. */
.kdoc-outline[hidden] {
  display: none !important;
}

.kdoc-outline-heading {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--kdoc-chrome-text-muted);
  padding: 10px 12px 6px 12px;
  margin: 0;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-outline-empty {
  font-size: 13px;
  color: var(--kdoc-chrome-text-muted);
  padding: 8px 12px;
  font-style: italic;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-outline-list {
  list-style: none;
  margin: 0;
  padding: 4px 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-outline-item {
  margin: 0;
  padding: 0;
  border-radius: var(--kdoc-radius-md);
  display: flex;
  align-items: center;
}

.kdoc-outline-button {
  width: 100%;
  min-height: 28px;
  height: 28px;
  display: block;
  text-align: left;
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-pill);
  background: transparent;
  color: var(--kdoc-chrome-text);
  font: inherit;
  font-size: 13px;
  line-height: 28px;
  padding: 0 8px;
  margin: 1px 4px;
  box-sizing: border-box;
  cursor: pointer;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, text-shadow 0.15s ease;
}

.kdoc-outline-button:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-outline-button:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-outline-button[aria-current="true"] {
  background: var(--kdoc-chrome-selected);
  color: var(--kdoc-chrome-on-selected);
  font-weight: 700;
  border-radius: var(--kdoc-radius-pill);
}

.kdoc-outline-button[aria-current="true"]:hover {
  background: var(--kdoc-chrome-selected);
  color: var(--kdoc-chrome-on-selected);
}

/* The twisty sits outside the row button rather than inside it, because a button inside a button is
   invalid HTML and every browser recovers from it differently. */
.kdoc-outline-item {
  display: flex;
  align-items: center;
}

.kdoc-outline-twisty {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: var(--kdoc-radius-sm);
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
  cursor: pointer;
  font-size: 10px;
  line-height: 1;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s ease;
}

.kdoc-outline-twisty:hover {
  color: var(--kdoc-chrome-text);
}

.kdoc-outline-twisty:focus-visible {
  outline: 2px solid var(--kdoc-chrome-accent);
  outline-offset: -1px;
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-outline::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.kdoc-outline::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-sunken);
}

.kdoc-outline::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-outline {
  scrollbar-width: thin;
  scrollbar-color: var(--kdoc-chrome-raised) var(--kdoc-chrome-base);
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-outline * {
    transition: none !important;
  }
}
`;

/**
 * Installs the document outline pane into the container element, configuring heading navigation,
 * depth indentation, active row highlighting, and visibility lifecycle controls.
 *
 * @purpose Instantiates the outline pane, mounts initial heading elements, and returns the OutlinePane controller.
 * @inputs options - OutlinePaneOptions configuring host container, document context, session, revealRange, and caretOffset.
 * @outputs OutlinePane - Controller interface exposing isVisible, show, hide, toggle, refresh, and destroy methods.
 * @dataflow Options -> DOM element configuration -> buildOutline -> DOM rendering -> OutlinePane controller returned.
 * @controlflow Configure container accessibility attributes -> create static heading -> execute initial refresh -> return OutlinePane controller interface.
 */
export function installOutlinePane(options: OutlinePaneOptions): OutlinePane {
  const doc = options.doc;
  const abortController = new AbortController();
  const signal = abortController.signal;

  let destroyed: boolean = false;
  let currentEntries: readonly OutlineEntry[] = [];
  // The rebuild is skipped when the entries are unchanged, and on first install `currentEntries` is
  // already []. For a document with no headings the new entries are [] too, so the comparison says
  // "unchanged" and nothing is ever rendered -- not the empty-state row, not even the pane's own title.
  // This flag forces exactly one rebuild so the first render always happens.
  let hasRendered: boolean = false;
  let rowButtons: HTMLButtonElement[] = [];

  // Headings the user has collapsed, held by start offset rather than index: an index is a position in a
  // list that changes on every keystroke, whereas the offset survives an edit somewhere else entirely.
  const collapsed: Set<number> = new Set<number>();

  // The row currently being dragged, or null. Held here rather than on the DataTransfer because the pane
  // is the only thing that will ever read it and a drag inside one list has no business being pasteable.
  let dragIndex: number | null = null;

  // Configure container element as an accessible navigation region.
  options.container.classList.add('kdoc-outline');
  options.container.setAttribute('aria-label', 'Document outline');

  // Check if container tag is not semantic <nav> to provide explicit role fallback.
  if (options.container.tagName.toLowerCase() !== 'nav') {
    // Container is not a native <nav> element: assign explicit role="navigation" attribute.
    options.container.setAttribute('role', 'navigation');
  } else {
    // Container is a native <nav> element: navigation role is implicit.
  }

  // The container starts visible per specification.
  options.container.hidden = false;

  // Create persistent heading element for the outline pane.
  const headingElement = doc.createElement('h2');
  headingElement.className = 'kdoc-outline-heading';
  headingElement.textContent = 'Outline';

  /**
   * Compares two outline entry sequences to determine whether the DOM list requires rebuilding.
   *
   * @purpose Checks whether two OutlineEntry arrays match in length, depth, text, and start offset.
   * @inputs previous - The previously rendered sequence of OutlineEntry items.
   * @inputs next - The freshly extracted sequence of OutlineEntry items.
   * @outputs boolean - Returns true if all entries are identical in depth, text, and start offset; false otherwise.
   * @dataflow previous and next arrays -> element-by-element field comparison -> boolean equality result.
   * @controlflow Compare array lengths (return false if unequal) -> iterate indices with strict indexing guard -> compare depth, text, start (return false if any differ) -> return true if all match.
   */
  function areEntriesEqual(
    previous: readonly OutlineEntry[],
    next: readonly OutlineEntry[],
  ): boolean {
    // Check if entry counts differ between previous and next lists.
    if (previous.length !== next.length) {
      // Counts differ: list structure changed, rebuild required.
      return false;
    } else {
      // Counts match: proceed to element-by-element comparison.
    }

    for (let i = 0; i < previous.length; i++) {
      const prev = previous[i];
      const curr = next[i];

      // Guard against undefined under strict noUncheckedIndexedAccess.
      if (prev === undefined || curr === undefined) {
        // One or both entries are undefined: treat as mismatch.
        return false;
      } else {
        // Both entries are defined: compare structural fields.
      }

      // Compare depth, text, and start offset to detect any heading modifications.
      if (
        prev.depth !== curr.depth ||
        prev.text !== curr.text ||
        prev.start !== curr.start
      ) {
        // Heading attribute differs: entries changed, rebuild required.
        return false;
      } else {
        // Current entry attributes match: continue inspecting remaining entries.
      }
    }

    // All entries match in count, depth, text, and start offset: no rebuild required.
    return true;
  }

  /**
   * Updates the active row highlight based on the current caret position in the document.
   *
   * @purpose Evaluates the active heading index for the current caret offset and synchronizes aria-current attributes on row buttons.
   * @inputs void.
   * @outputs void.
   * @dataflow options.caretOffset() -> activeOutlineIndex -> rowButtons aria-current updates.
   * @controlflow Compute caret offset -> resolve active outline index -> iterate row buttons -> set aria-current="true" on matching button and remove from others.
   */
  function updateActiveRow(): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort active row update.
      return;
    } else {
      // Component is active: proceed with updating active row state.
    }

    // Check if there are no rendered row buttons (e.g. empty outline state).
    if (rowButtons.length === 0) {
      // No rows rendered: nothing to mark as active.
      return;
    } else {
      // Row buttons present: determine active section index.
    }

    const offset = options.caretOffset();
    const activeIndex = activeOutlineIndex(currentEntries, offset);

    for (let i = 0; i < rowButtons.length; i++) {
      const button = rowButtons[i];

      // Guard against undefined under strict noUncheckedIndexedAccess.
      if (button === undefined) {
        // Button at index is undefined: skip iteration.
        continue;
      } else {
        // Button at index is defined: compare with active index.
      }

      // Check if the current row button corresponds to the active heading section.
      if (i === activeIndex) {
        // Matches active section: mark with aria-current="true".
        button.setAttribute('aria-current', 'true');
      } else {
        // Does not match active section: remove aria-current attribute.
        button.removeAttribute('aria-current');
      }
    }
  }

  /**
   * Rebuilds the outline DOM hierarchy, rendering either the heading list or the empty state message.
   *
   * @purpose Empties and reconstructs the outline pane DOM tree based on current outline entries.
   * @inputs entries - The current readonly array of OutlineEntry items to render.
   * @outputs void.
   * @dataflow entries array -> li and button DOM elements creation -> options.container DOM update -> updateActiveRow.
   * @controlflow Clear existing row button references -> check if entries array is empty -> render empty state or render ul list of li and button elements -> append to container -> update active row highlight.
   */
  /** Determines whether a heading has any descendant headings beneath it in the outline.
   *
   * @purpose Returns true when the entry immediately after this one is deeper (more indented), meaning
   *   it belongs under this heading as a child section.
   * @inputs entries - The flat outline list to read; index - The flat-array position of the entry to test.
   * @outputs boolean - True if a deeper entry follows; false otherwise.
   * @dataflow entries[index + 1] -> depth comparison against entries[index] -> boolean result.
   * @controlflow Guard the next-index read (return false on undefined) -> compare depths -> return true when deeper, false when not.
   */
  function hasChildren(entries: readonly OutlineEntry[], index: number): boolean {
    // Guard against reading past the end of the flat outline array under strict noUncheckedIndexedAccess.
    if (entries[index + 1] === undefined) {
      // No following entry exists: this heading ends its group and cannot contain children.
      return false;
    } else {
      // A following entry exists: compare its depth to decide whether it nests under this one.
    }

    const current = entries[index];
    const next = entries[index + 1];

    // Guard against undefined under strict noUncheckedIndexedAccess for both reads now that bounds are known.
    if (current === undefined || next === undefined) {
      // Either entry is undefined: treat as having no children.
      return false;
    } else {
      // Both entries are defined: a child heading is any entry strictly deeper than its parent.
    }

    // A heading with nothing under it gets no chevron, because a control that cannot do anything is worse than no control.
    return next.depth > current.depth;
  }

  /** Determines whether an entry is hidden because some ancestor heading above it is collapsed.
   *
   * @purpose Walks backwards from the entry to find any ancestor whose start offset is in the collapsed set.
   * @inputs entries - The flat outline list to read; index - The flat-array position of the entry to test for visibility.
   * @outputs boolean - True if any ancestor is collapsed; false if every ancestor is open (or there are none).
   * @dataflow entries[index].depth -> backward walk comparing depths and testing start offsets against collapsed -> boolean result.
   * @controlflow Read own depth as the initial tracked depth -> iterate indices from index-1 down to 0 -> on each ancestor update tracked depth and test its start -> return true on first collapsed ancestor, false after the loop completes.
   */
  function isHidden(entries: readonly OutlineEntry[], index: number): boolean {
    // Seed the tracked depth with this entry's own depth so that siblings (equal depth) never count as
    // ancestors; only strictly shallower entries can nest under this one. Guarded for strict indexing.
    const target = entries[index];

    // Guard against an out-of-range index on the target entry itself under strict noUncheckedIndexedAccess.
    if (target === undefined) {
      // Target entry does not exist: nothing can hide it.
      return false;
    } else {
      // Target entry exists: begin the ancestor walk from just before it.
    }

    // Collapsing a grandparent must hide a grandchild even when the parent is expanded: the rows in
    // between are gone, so the question is whether *any* ancestor is closed, not just the nearest one.
    let trackedDepth = target.depth;

    for (let i = index - 1; i >= 0; i--) {
      const ancestor = entries[i];

      // Guard against undefined under strict noUncheckedIndexedAccess on each backward read.
      if (ancestor === undefined) {
        // Entry is undefined: skip this position rather than throwing.
        continue;
      } else {
        // Entry is defined: decide whether it is an ancestor of the target entry.
      }

      // An earlier entry is an ancestor only when its depth is strictly less than the tracked depth,
      // because equal or greater depths are siblings or descendants rather than parents.
      if (ancestor.depth < trackedDepth) {
        // This entry nests above the target: adopt it as the new shallowest ancestor and test whether
        // it is collapsed by comparing its start offset against the collapsed set.
        trackedDepth = ancestor.depth;

        if (collapsed.has(ancestor.start)) {
          // Ancestor is collapsed: this entry is hidden behind it.
          return true;
        } else {
          // Ancestor is open: keep walking toward earlier ancestors in case a grandparent is closed.
        }
      } else {
        // Entry is not an ancestor (sibling or deeper): leave the tracked depth unchanged and continue.
      }
    }

    // No collapsed ancestor was found on any path to the top of the outline.
    return false;
  }

  function rebuildDom(entries: readonly OutlineEntry[]): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort DOM reconstruction.
      return;
    } else {
      // Component is active: proceed with DOM reconstruction.
    }

    rowButtons = [];
    hasRendered = true;

    // Check if the entries list is empty.
    if (entries.length === 0) {
      // No headings present: display empty state message and omit list element.
      const emptyRow = doc.createElement('div');
      emptyRow.className = 'kdoc-outline-empty';
      emptyRow.textContent = 'No headings yet';
      options.container.replaceChildren(headingElement, emptyRow);
    } else {
      // Headings present: construct accessible unordered list of outline buttons.
      const list = doc.createElement('ul');
      list.className = 'kdoc-outline-list';

      for (const entry of entries) {
        // A collapsed section's rows are not hidden with CSS but simply not built, so keyboard navigation
        // and the active-row search never land on something invisible. Skip building them entirely here.
        if (isHidden(entries, entry.index)) {
          // Entry is hidden behind a collapsed ancestor: do not build its row at all.
          continue;
        } else {
          // Entry is visible: proceed to construct its row.
        }

        const item = doc.createElement('li');
        item.className = 'kdoc-outline-item';

        // A heading with children gets a twisty so the user can collapse it; a leaf has no chevron because
        // there is nothing to expand or collapse, and a control that cannot do anything is worse than none.
        if (hasChildren(entries, entry.index)) {
          const isOpen = !collapsed.has(entry.start);

          const twisty = doc.createElement('button');
          twisty.type = 'button';
          twisty.className = 'kdoc-outline-twisty';
          // Show a down-pointing chevron when open and a right-pointing one when collapsed, matching the
          // expanded state so assistive technology announces the current fold state correctly.
          twisty.textContent = isOpen ? '▾' : '▸';
          twisty.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
          twisty.setAttribute(
            'aria-label',
            `${isOpen ? 'Collapse' : 'Expand'} ${entry.text}`,
          );

          // The row is a jump target, so collapsing must not also navigate: stop propagation before touching
          // state to keep the click from falling through to the row's revealRange handler.
          twisty.addEventListener(
            'click',
            (event: MouseEvent): void => {
              event.stopPropagation();

              if (isOpen) {
                // Currently expanded: collapse by recording this heading's start offset in the set.
                collapsed.add(entry.start);
              } else {
                // Currently collapsed: expand by removing its start offset from the set.
                collapsed.delete(entry.start);
              }

              // The collapsed set changed, so rebuild the list to reflect the new visibility of descendants.
              rebuildDom(entries);
            },
            { signal },
          );

          item.appendChild(twisty);
        } else {
          // A leaf gets no chevron: nothing under this heading to expand or collapse.
        }

        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'kdoc-outline-button';
        button.textContent = entry.text;
        button.title = entry.text;
        button.setAttribute('aria-level', String(entry.depth));
        button.style.paddingInlineStart = `${(entry.depth - 1) * 12 + 8}px`;

        button.addEventListener(
          'click',
          (): void => {
            options.revealRange(entry.start, entry.end);
            // Clicking a row moves the caret but changes no text, so nothing else would refresh the
            // highlight: the user would navigate to a heading and watch a different row stay marked.
            updateActiveRow();
          },
          { signal },
        );

        item.appendChild(button);

        // Make the whole row draggable and register the drag lifecycle listeners below, all bound to the
        // pane's abort signal so they are removed together on destroy.
        item.draggable = true;

        item.addEventListener(
          'dragstart',
          (event: DragEvent): void => {
            dragIndex = entry.index;

            if (event.dataTransfer !== null) {
              // A data transfer object is available: declare a move operation and carry the heading text so
              // that some browsers refuse to begin a drag when no data was set.
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', entry.text);
            } else {
              // No data transfer object: nothing to configure, but the drag may still proceed in this browser.
            }
          },
          { signal },
        );

        item.addEventListener(
          'dragover',
          (event: DragEvent): void => {
            event.preventDefault();
            // Preventing the default is what makes this element a drop target at all — without it `drop`
            // never fires on this row.
            if (event.dataTransfer !== null) {
              // A data transfer object is available: mark the intended operation as a move.
              event.dataTransfer.dropEffect = 'move';
            } else {
              // No data transfer object: nothing to configure for the drop effect.
            }
          },
          { signal },
        );

        item.addEventListener(
          'drop',
          (event: DragEvent): void => {
            event.preventDefault();

            if (dragIndex !== null && dragIndex !== entry.index) {
              // A different row was dragged here and the host owns reordering: report the move. Dropping a
              // row on itself is not a move, so it is ignored by the guard above.
              options.moveSection?.(dragIndex, entry.index);
            } else {
              // Either nothing was dragged or the drop target is the source row: no reorder to perform.
            }
          },
          { signal },
        );

        item.addEventListener(
          'dragend',
          (): void => {
            // The drag finished (or was cancelled): clear the tracked source so a later drop is ignored.
            dragIndex = null;
          },
          { signal },
        );

        list.appendChild(item);
        rowButtons.push(button);
      }

      options.container.replaceChildren(headingElement, list);
    }

    updateActiveRow();
  }

  /**
   * Rebuilds the outline list from the session snapshot or updates the active row if headings are unchanged.
   *
   * @purpose Synchronizes the outline pane with current document state, skipping DOM rebuild when entries match previous state.
   * @inputs void.
   * @outputs void.
   * @dataflow options.session.snapshot.document -> buildOutline -> areEntriesEqual check -> rebuildDom or updateActiveRow.
   * @controlflow Check destroyed flag -> extract new outline entries -> compare with current entries -> if equal only update active row; if changed update current entries and rebuild DOM.
   */
  function refresh(): void {
    // Check if component has been destroyed.
    if (destroyed) {
      // Component is destroyed: abort refresh.
      return;
    } else {
      // Component is active: proceed with refresh.
    }

    const nextEntries = buildOutline(options.session.snapshot.document);

    // Check whether anything has been rendered yet and whether the entries match what is on screen.
    if (hasRendered && areEntriesEqual(currentEntries, nextEntries)) {
      // Entries are unchanged: update only the active row highlight to avoid flicker.
      updateActiveRow();
    } else {
      // Entries have changed: store new entries and rebuild the DOM.
      currentEntries = nextEntries;
      rebuildDom(currentEntries);
    }
  }

  /**
   * Reveals the outline pane container by setting hidden to false.
   *
   * @purpose Makes the outline pane visible.
   * @inputs void.
   * @outputs void.
   * @dataflow options.container.hidden update.
   * @controlflow Check destroyed guard -> set container hidden property to false.
   */
  function show(): void {
    // Check if component has been destroyed.
    if (destroyed) {
      // Component is destroyed: abort show.
      return;
    } else {
      // Component is active: reveal container element.
    }

    options.container.hidden = false;
  }

  /**
   * Hides the outline pane container by setting hidden to true.
   *
   * @purpose Hides the outline pane.
   * @inputs void.
   * @outputs void.
   * @dataflow options.container.hidden update.
   * @controlflow Check destroyed guard -> set container hidden property to true.
   */
  function hide(): void {
    // Check if component has been destroyed.
    if (destroyed) {
      // Component is destroyed: abort hide.
      return;
    } else {
      // Component is active: hide container element.
    }

    options.container.hidden = true;
  }

  /**
   * Toggles the visibility of the outline pane container.
   *
   * @purpose Switches between visible and hidden states of the outline pane.
   * @inputs void.
   * @outputs void.
   * @dataflow options.container.hidden state -> show() or hide() dispatch.
   * @controlflow Check destroyed guard -> branch on container.hidden -> call show() if hidden or hide() if visible.
   */
  function toggle(): void {
    // Check if component has been destroyed.
    if (destroyed) {
      // Component is destroyed: abort toggle.
      return;
    } else {
      // Component is active: evaluate current hidden state to toggle.
    }

    // Check if container is currently hidden to toggle visibility.
    if (options.container.hidden) {
      // Currently hidden: switch to visible state.
      show();
    } else {
      // Currently visible: switch to hidden state.
      hide();
    }
  }

  /**
   * Cleans up all resources, aborting listener signals and clearing the container DOM.
   *
   * @purpose Idempotently tears down event listeners, clears attributes, and empties container children.
   * @inputs void.
   * @outputs void.
   * @dataflow AbortController abort -> clear container children and class list -> reset internal state.
   * @controlflow Check destroyed flag (return early if true) -> set destroyed = true -> abort listener signals -> remove CSS class -> hide and empty container.
   */
  function destroy(): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Already destroyed: return immediately for idempotent teardown.
      return;
    } else {
      // Active component: mark destroyed and proceed with teardown.
      destroyed = true;
    }

    abortController.abort();
    options.container.classList.remove('kdoc-outline');
    options.container.hidden = true;
    options.container.replaceChildren();
    rowButtons = [];
    currentEntries = [];
    hasRendered = false;
  }

  // Execute initial refresh to render initial document outline.
  refresh();

  return {
    /**
     * @purpose Returns boolean indicating whether the outline pane is currently visible.
     * @inputs void.
     * @outputs boolean - True if the pane is active and not hidden; false otherwise.
     * @dataflow options.container.hidden state -> boolean.
     * @controlflow Check destroyed flag -> return false if destroyed or hidden, true otherwise.
     */
    get isVisible(): boolean {
      // Check if component is destroyed.
      if (destroyed) {
        // Destroyed component is not visible.
        return false;
      } else if (options.container.hidden) {
        // Hidden container is not visible.
        return false;
      } else {
        // Active and unhidden container is visible.
        return true;
      }
    },

    show,
    hide,
    toggle,
    refresh,
    destroy,
  };
}
