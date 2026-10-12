/**
 * @file styles-gallery.ts
 * @purpose Implements StylesGallery, a Word-style gallery for choosing block styles where each entry is rendered in its style (FR-8.5).
 *   Renders an absolutely-positioned panel on doc.body without taking focus from the editor, maintaining selection and edit lock.
 * @inputs StylesGalleryOptions containing Document and Window context references, and an onPick callback for chosen style id.
 * @outputs StylesGallery controller instance exposing openAt, close, isOpen, setCurrent, setEnabled, and destroy lifecycle methods, alongside STYLES_GALLERY_STYLES CSS definition and STYLE_ENTRIES metadata.
 * @functions
 *   - installStylesGallery: Constructs the styles gallery listbox, wires hover, click, and keyboard listeners, and returns the StylesGallery controller.
 * @dataflow User hover/keyboard navigation -> highlightedId closure state -> update entry hover class -> click/Enter -> onPick(id) -> close().
 * @controlflow Mount absolutely-positioned listbox container with grouped entries to document body -> openAt positions, clamps, and highlights initial entry -> mouseenter, keydown, and outside-click manage selection and dismissal -> entry pick invokes onPick and closes.
 * @version 3
 * @date 2026-10-04
 */

/**
 * Identifiers for selectable block styles in the styles gallery.
 */
export type StyleId =
  | 'normal'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'quote'
  | 'code-block'
  | 'callout-note'
  | 'callout-tip'
  | 'callout-important'
  | 'callout-warning'
  | 'callout-caution'
  | 'callout-custom';

/**
 * Metadata defining a selectable style entry within the styles gallery.
 */
export interface StyleEntry {
  readonly id: StyleId;
  readonly label: string;
  readonly group: 'Text' | 'Headings' | 'Blocks' | 'Callouts';
  readonly sample: string;
}

/**
 * The standard style entries displayed in the styles gallery, ordered by group.
 */
export const STYLE_ENTRIES: readonly StyleEntry[] = [
  { id: 'normal', label: 'Normal', group: 'Text', sample: 'Normal text' },
  { id: 'heading-1', label: 'Heading 1', group: 'Headings', sample: 'Heading 1' },
  { id: 'heading-2', label: 'Heading 2', group: 'Headings', sample: 'Heading 2' },
  { id: 'heading-3', label: 'Heading 3', group: 'Headings', sample: 'Heading 3' },
  { id: 'heading-4', label: 'Heading 4', group: 'Headings', sample: 'Heading 4' },
  { id: 'heading-5', label: 'Heading 5', group: 'Headings', sample: 'Heading 5' },
  { id: 'heading-6', label: 'Heading 6', group: 'Headings', sample: 'Heading 6' },
  { id: 'quote', label: 'Quote', group: 'Blocks', sample: 'Quoted text' },
  { id: 'code-block', label: 'Code Block', group: 'Blocks', sample: 'const x = 1;' },
  { id: 'callout-note', label: 'Note', group: 'Callouts', sample: 'Note' },
  { id: 'callout-tip', label: 'Tip', group: 'Callouts', sample: 'Tip' },
  { id: 'callout-important', label: 'Important', group: 'Callouts', sample: 'Important' },
  { id: 'callout-warning', label: 'Warning', group: 'Callouts', sample: 'Warning' },
  { id: 'callout-caution', label: 'Caution', group: 'Callouts', sample: 'Caution' },
  // The entry the user has to be asked about. Its sample says so rather than showing a word K-Doc
  // would have picked, because the whole point of the entry is that the word is theirs.
  { id: 'callout-custom', label: 'Custom\u2026', group: 'Callouts', sample: 'Your own word\u2026' },
];

/**
 * Configuration options supplied to installStylesGallery.
 */
export interface StylesGalleryOptions {
  readonly doc: Document;
  readonly win: Window;
  readonly onPick: (id: StyleId) => void;
}

/**
 * Controller interface managing the lifecycle and visibility of the styles gallery.
 */
export interface StylesGallery {
  /** Opens the styles gallery at the given viewport coordinates, clamped to fit on screen. */
  openAt(x: number, y: number): void;
  /** Closes the styles gallery and removes temporary outside-click listeners. */
  close(): void;
  /** True when the styles gallery is currently visible and not destroyed. */
  readonly isOpen: boolean;
  /** Marks the entry matching the block under the caret, or clears the mark when none matches. */
  setCurrent(id: StyleId | null): void;
  /** Greys an entry whose command cannot apply where the caret is. */
  setEnabled(id: StyleId, enabled: boolean): void;
  /** Cleans up all DOM elements and listeners idempotently. */
  destroy(): void;
}

/**
 * Static stylesheet for the Word-style styles gallery, rendering preview styles,
 * group headers, hover/active outlines, and elevation with K-Doc design tokens.
 */
export const STYLES_GALLERY_STYLES: string = `
.kdoc-styles-gallery {
  position: absolute;
  z-index: 1000;
  border: 1px solid var(--kdoc-chrome-glass-edge);
  border-radius: var(--kdoc-radius-xl);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  padding: 8px;
  box-sizing: border-box;
  box-shadow: 0 1px 2px var(--kdoc-chrome-shadow-deeper), 0 2px 6px 2px var(--kdoc-chrome-shadow-dark);
  min-width: 220px;
  max-height: 60vh;
  overflow-y: auto;
  user-select: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  scrollbar-width: thin;
  scrollbar-color: var(--kdoc-chrome-raised) var(--kdoc-chrome-base);
}

.kdoc-styles-gallery::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.kdoc-styles-gallery::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

.kdoc-styles-gallery::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-styles-gallery[hidden] {
  display: none !important;
}

.kdoc-styles-gallery-group-label {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--kdoc-chrome-text-muted);
  letter-spacing: 0.05em;
  padding: 6px 4px 2px 4px;
  font-weight: 600;
  user-select: none;
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-styles-gallery-entry {
  padding: 4px 8px;
  border-radius: var(--kdoc-radius-md);
  margin: 1px 2px;
  cursor: pointer;
  box-sizing: border-box;
  outline: none;
  border: 1px solid transparent;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, text-shadow 0.15s ease;
}

.kdoc-styles-gallery-entry.kdoc-styles-gallery-entry-hover:not(.kdoc-styles-gallery-entry-disabled) {
  background: var(--kdoc-chrome-raised);
}

.kdoc-styles-gallery-entry.kdoc-styles-gallery-entry-current {
  background: var(--kdoc-chrome-selected);
  box-shadow: none;
  outline: 2px solid var(--kdoc-chrome-accent);
  outline-offset: -1px;
  color: var(--kdoc-chrome-on-selected);
  font-weight: 700;
}

.kdoc-styles-gallery-entry.kdoc-styles-gallery-entry-disabled {
  opacity: 0.4;
  cursor: default;
}

.kdoc-styles-gallery-preview {
  display: block;
  line-height: 1.4;
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-styles-preview-normal {
  font-size: 14px;
  font-weight: 400;
  color: var(--kdoc-chrome-text);
}

.kdoc-styles-preview-heading-1 {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--kdoc-chrome-text);
}

.kdoc-styles-preview-heading-2 {
  font-size: 19px;
  font-weight: 600;
  line-height: 1.25;
  color: var(--kdoc-chrome-text);
}

.kdoc-styles-preview-heading-3 {
  font-size: 17px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--kdoc-chrome-text);
}

.kdoc-styles-preview-heading-4 {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--kdoc-chrome-text);
  opacity: 0.9;
}

.kdoc-styles-preview-heading-5 {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-styles-preview-heading-6 {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--kdoc-chrome-text-muted);
  opacity: 0.8;
}

.kdoc-styles-preview-quote {
  border-left: 3px solid var(--kdoc-chrome-glass-edge);
  padding-left: 8px;
  font-style: italic;
  color: var(--kdoc-chrome-text-muted);
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-styles-preview-code-block {
  font-family: monospace;
  font-size: 12px;
  background: var(--kdoc-chrome-base);
  box-shadow: none;
  color: var(--kdoc-chrome-text);
  padding: 4px 6px;
  border-radius: var(--kdoc-radius-sm);
}

/*
 * Shared styling for GitHub-style callout previews.
 * Uses var(--kdoc-callout-accent) for the 3px left border and font styling, matching the editor's callout plugin.
 */

.kdoc-styles-preview-callout-note,
.kdoc-styles-preview-callout-tip,
.kdoc-styles-preview-callout-important,
.kdoc-styles-preview-callout-warning,
.kdoc-styles-preview-callout-caution {
  border-left: 3px solid var(--kdoc-callout-accent);
  padding-left: 8px;
  font-weight: 600;
  color: var(--kdoc-callout-accent);
  border-radius: var(--kdoc-radius-sm);
}

/*
 * Per-callout accent tokens matching the editor's callout plugin colors,
 * ensuring visual agreement between the gallery preview and rendered blocks.
 */

.kdoc-styles-preview-callout-note {
  --kdoc-callout-accent: var(--kdoc-chrome-accent);
}

.kdoc-styles-preview-callout-tip {
  --kdoc-callout-accent: var(--kdoc-emissive-green);
}

.kdoc-styles-preview-callout-important {
  --kdoc-callout-accent: var(--kdoc-emissive-magenta);
}

.kdoc-styles-preview-callout-warning {
  --kdoc-callout-accent: var(--kdoc-emissive-amber);
}

.kdoc-styles-preview-callout-caution {
  --kdoc-callout-accent: var(--kdoc-emissive-red);
}

/*
 * The custom entry is drawn in the same neutral grey the editor gives an unknown alert word, so the
 * preview and the block it makes agree -- a colour here would promise one the callout will not have.
 */

.kdoc-styles-preview-callout-custom {
  --kdoc-callout-accent: var(--kdoc-chrome-text-muted);
  font-style: italic;
  border-radius: var(--kdoc-radius-sm);
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-styles-gallery * {
    transition: none !important;
  }
}
`;

/** Internal tracking record mapping each DOM entry element to its metadata and enabled status. */
interface EntryRecord {
  readonly entry: StyleEntry;
  readonly el: HTMLDivElement;
  enabled: boolean;
}

/** Monotonically increasing counter ensuring unique DOM element IDs across multiple styles gallery instances. */
let nextStylesGalleryId: number = 0;

/** Ordered list of style groups for gallery sectioning. */
const STYLE_GROUPS: readonly ('Text' | 'Headings' | 'Blocks' | 'Callouts')[] = [
  'Text',
  'Headings',
  'Blocks',
  'Callouts',
] as const;

/**
 * Installs a Word-style styles gallery into the document body, configuring style previews, hover behavior, and keyboard navigation.
 *
 * @purpose Constructs, styles, and mounts an absolutely-positioned styles gallery overlay for choosing block styles.
 * @inputs options - StylesGalleryOptions containing Document, Window DOM contexts, and onPick callback.
 * @outputs StylesGallery - Controller exposing openAt, close, isOpen, setCurrent, setEnabled, and destroy lifecycle methods.
 * @dataflow options -> DOM hierarchy with preview elements -> openAt -> mouse/keyboard navigation -> setHighlight -> onPick(id) -> close().
 * @controlflow Create container and grouped entry elements once at construction -> append to doc.body -> bind mousedown preventDefault, entry mouseenter/click, and keyboard navigation -> return StylesGallery controller.
 */
export function installStylesGallery(options: StylesGalleryOptions): StylesGallery {
  const doc = options.doc;
  const win = options.win;
  const abortController = new AbortController();
  const signal = abortController.signal;

  const galleryId = ++nextStylesGalleryId;
  const galleryElementId = `kdoc-styles-gallery-${galleryId}`;

  let destroyed: boolean = false;
  let open: boolean = false;
  let highlightedId: StyleId | null = null;
  let currentId: StyleId | null = null;
  let openTimeoutId: ReturnType<typeof win.setTimeout> | null = null;

  // Construct container <div> element.
  const galleryEl = doc.createElement('div');
  galleryEl.id = galleryElementId;
  galleryEl.className = 'kdoc-styles-gallery';
  galleryEl.setAttribute('role', 'listbox');
  galleryEl.setAttribute('aria-label', 'Styles gallery');
  galleryEl.hidden = true;

  // Prevent default on mousedown so editor never loses focus.
  galleryEl.addEventListener(
    'mousedown',
    (event: MouseEvent): void => {
      event.preventDefault();
    },
    { signal },
  );

  const entries: EntryRecord[] = [];

  // Build group headers and entry elements once at construction.
  for (let gIdx = 0; gIdx < STYLE_GROUPS.length; gIdx++) {
    const groupName = STYLE_GROUPS[gIdx];
    // Check if groupName is defined under strict indexing.
    if (groupName === undefined) {
      // Skip undefined group.
      continue;
    } else {
      // Valid group: proceed with building its label and entries.
    }

    const groupLabelEl = doc.createElement('div');
    groupLabelEl.className = 'kdoc-styles-gallery-group-label';
    groupLabelEl.setAttribute('role', 'presentation');
    groupLabelEl.textContent = groupName;
    galleryEl.appendChild(groupLabelEl);

    for (let eIdx = 0; eIdx < STYLE_ENTRIES.length; eIdx++) {
      const entry = STYLE_ENTRIES[eIdx];
      // Check if entry is defined under strict indexing.
      if (entry === undefined) {
        // Skip undefined entry.
        continue;
      } else {
        // Valid entry.
      }

      // Check if this entry belongs to the current group.
      if (entry.group !== groupName) {
        // Entry belongs to a different group: skip for now.
        continue;
      } else {
        // Entry belongs to the current group: create its DOM elements.
      }

      const entryEl = doc.createElement('div');
      entryEl.id = `kdoc-styles-gallery-entry-${galleryId}-${entry.id}`;
      entryEl.className = 'kdoc-styles-gallery-entry';
      entryEl.setAttribute('role', 'option');
      entryEl.setAttribute('tabindex', '-1');
      entryEl.setAttribute('data-style-id', entry.id);
      entryEl.setAttribute('aria-label', entry.label);

      const previewEl = doc.createElement('div');
      previewEl.className = `kdoc-styles-gallery-preview kdoc-styles-preview-${entry.id}`;
      previewEl.textContent = entry.sample;
      entryEl.appendChild(previewEl);

      const record: EntryRecord = {
        entry,
        el: entryEl,
        enabled: true,
      };

      entryEl.addEventListener(
        'mouseenter',
        (): void => {
          // Check if component has been destroyed or gallery is not open.
          if (destroyed || !open) {
            // Component destroyed or gallery closed: ignore hover.
            return;
          } else {
            // Active and open.
          }

          // Check if this entry is enabled.
          if (!record.enabled) {
            // Entry is disabled: do not highlight.
            return;
          } else {
            // Entry is enabled: apply highlight.
            setHighlight(entry.id);
          }
        },
        { signal },
      );

      entryEl.addEventListener(
        'click',
        (): void => {
          // Check if component has been destroyed.
          if (destroyed) {
            // Component destroyed: ignore click.
            return;
          } else {
            // Component is active.
          }

          // Check if gallery is currently open.
          if (!open) {
            // Gallery is closed: ignore click.
            return;
          } else {
            // Gallery is open.
          }

          // Check if entry is enabled.
          if (!record.enabled) {
            // Entry is disabled: ignore click.
            return;
          } else {
            // Entry is enabled: dispatch selection and close gallery.
            options.onPick(entry.id);
            close();
          }
        },
        { signal },
      );

      galleryEl.appendChild(entryEl);
      entries.push(record);
    }
  }

  doc.body.appendChild(galleryEl);

  /**
   * Updates visual hover highlight across all gallery entries and scrolls the highlighted entry into view.
   *
   * @purpose Highlights a specific entry and removes highlight from all other entries.
   * @inputs targetId - The StyleId to highlight, or null to clear highlight.
   * @outputs void.
   * @dataflow targetId -> highlightedId -> toggle kdoc-styles-gallery-entry-hover -> optional scrollIntoView.
   * @controlflow Store targetId in closure -> iterate entries -> if entry matches targetId and is enabled, add hover class and scroll into view; else remove hover class.
   */
  function setHighlight(targetId: StyleId | null): void {
    highlightedId = targetId;

    for (let i = 0; i < entries.length; i++) {
      const item = entries[i];
      // Check if item exists under strict indexing.
      if (item === undefined) {
        // Skip undefined entry.
        continue;
      } else {
        // Valid entry record: check highlight status.
      }

      // Check if entry matches targetId and is enabled.
      if (item.entry.id === targetId && item.enabled) {
        // Highlight matching enabled entry.
        item.el.classList.add('kdoc-styles-gallery-entry-hover');

        // Check if scrollIntoView is available in the current environment.
        if (typeof item.el.scrollIntoView === 'function') {
          // scrollIntoView supported: scroll entry into view.
          item.el.scrollIntoView({ block: 'nearest' });
        } else {
          // scrollIntoView not available (e.g. jsdom test environment).
        }
      } else {
        // Remove highlight from non-matching or disabled entries.
        item.el.classList.remove('kdoc-styles-gallery-entry-hover');
      }
    }
  }

  /**
   * Marks the entry matching the block under the caret, or clears the mark when none matches.
   *
   * @purpose Toggles class kdoc-styles-gallery-entry-current and aria-selected on the matching entry.
   * @inputs id - The current StyleId, or null to clear.
   * @outputs void.
   * @dataflow id -> currentId -> iterate entries -> toggle current class and aria-selected attribute.
   * @controlflow Check if id is null -> if null, clear current class and aria-selected on all entries; else apply to matching entry and clear others.
   */
  function setCurrent(id: StyleId | null): void {
    currentId = id;

    // Check if id is null.
    if (id === null) {
      // Clear current state from all entries.
      for (let i = 0; i < entries.length; i++) {
        const item = entries[i];
        // Check if item exists under strict indexing.
        if (item === undefined) {
          // Skip undefined entry.
          continue;
        } else {
          // Valid entry record.
        }
        item.el.classList.remove('kdoc-styles-gallery-entry-current');
        item.el.removeAttribute('aria-selected');
      }
    } else {
      // Specific style id provided: apply current styling to matching entry.
      for (let i = 0; i < entries.length; i++) {
        const item = entries[i];
        // Check if item exists under strict indexing.
        if (item === undefined) {
          // Skip undefined entry.
          continue;
        } else {
          // Valid entry record.
        }

        // Check if entry matches target id.
        if (item.entry.id === id) {
          // Match found: mark current and set aria-selected.
          item.el.classList.add('kdoc-styles-gallery-entry-current');
          item.el.setAttribute('aria-selected', 'true');
        } else {
          // Mismatch: clear current styling and aria-selected.
          item.el.classList.remove('kdoc-styles-gallery-entry-current');
          item.el.removeAttribute('aria-selected');
        }
      }
    }
  }

  /**
   * Greys an entry whose command cannot apply where the caret is, updating disabled styling and accessibility attributes.
   *
   * @purpose Sets enabled state of a style entry and updates kdoc-styles-gallery-entry-disabled and aria-disabled.
   * @inputs id - The StyleId whose enabled status is being updated.
   * @inputs enabled - Boolean indicating whether the entry is enabled.
   * @outputs void.
   * @dataflow id & enabled -> entry record enabled property -> toggle disabled class, aria-disabled, and clear highlight if disabled.
   * @controlflow Iterate entries -> find matching id -> set enabled -> if enabled, remove disabled styling; else add disabled styling and clear hover if currently highlighted.
   */
  function setEnabled(id: StyleId, enabled: boolean): void {
    for (let i = 0; i < entries.length; i++) {
      const item = entries[i];
      // Check if item exists under strict indexing.
      if (item === undefined) {
        // Skip undefined entry.
        continue;
      } else {
        // Valid entry record.
      }

      // Check if entry matches target id.
      if (item.entry.id === id) {
        item.enabled = enabled;
        // Check if entry is being enabled or disabled.
        if (enabled) {
          // Enable entry: remove disabled class and aria attribute.
          item.el.classList.remove('kdoc-styles-gallery-entry-disabled');
          item.el.removeAttribute('aria-disabled');
        } else {
          // Disable entry: add disabled class and set aria-disabled.
          item.el.classList.add('kdoc-styles-gallery-entry-disabled');
          item.el.setAttribute('aria-disabled', 'true');

          // Check if newly disabled entry is currently highlighted.
          if (highlightedId === id) {
            // Clear highlight from disabled entry.
            setHighlight(null);
          } else {
            // Disabled entry was not highlighted.
          }
        }
      } else {
        // Non-matching entry: leave unchanged.
      }
    }
  }

  /**
   * Keyboard event listener managing gallery navigation, style picking, and dismissal.
   *
   * @purpose Intercepts ArrowDown, ArrowUp, Home, End, Enter, and Escape when gallery is open, navigating or confirming selection.
   * @inputs event - KeyboardEvent captured on document or container element.
   * @outputs void.
   * @dataflow event.key -> arrow/home/end moves -> setHighlight() | Enter -> onPick() & close() | Escape -> close().
   * @controlflow Check destroyed and open guards -> inspect event.key -> route ArrowDown/Up, Home, End to setHighlight on enabled entries -> route Enter to onPick and close -> route Escape to close.
   */
  function onKeyDown(event: KeyboardEvent): void {
    // Check if component has been destroyed or gallery is not open.
    if (destroyed || !open) {
      // Component destroyed or gallery closed: ignore keyboard event.
      return;
    } else {
      // Gallery is open: inspect event.
    }

    // Check if default has already been prevented by a preceding listener.
    if (event.defaultPrevented) {
      // Already handled: skip.
      return;
    } else {
      // Not yet handled: process key.
    }

    // Collect all currently enabled entries in gallery order.
    const enabledList: EntryRecord[] = [];
    for (let i = 0; i < entries.length; i++) {
      const item = entries[i];
      // Check if item exists under strict indexing.
      if (item === undefined) {
        // Skip undefined entry.
        continue;
      } else {
        // Valid entry record.
      }

      // Check if entry is enabled.
      if (item.enabled) {
        // Entry is enabled: include in keyboard navigation list.
        enabledList.push(item);
      } else {
        // Entry is disabled: exclude from keyboard navigation list.
      }
    }

    // Locate the index of the currently highlighted entry in enabledList.
    let currentIndex: number = -1;
    // Check if an entry is currently highlighted.
    if (highlightedId !== null) {
      for (let i = 0; i < enabledList.length; i++) {
        const item = enabledList[i];
        // Check if item exists under strict indexing.
        if (item === undefined) {
          // Skip undefined entry.
          continue;
        } else {
          // Valid entry.
        }

        // Check if entry id matches highlightedId.
        if (item.entry.id === highlightedId) {
          currentIndex = i;
          break;
        } else {
          // Not matching.
        }
      }
    } else {
      // No entry highlighted yet.
    }

    // Check if the pressed key is ArrowDown.
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      // Check if there are any enabled entries.
      if (enabledList.length === 0) {
        // No enabled entries: cannot navigate.
        return;
      } else {
        // Enabled entries exist.
      }

      let nextIndex = 0;
      // Check if an enabled entry is already highlighted.
      if (currentIndex >= 0) {
        // Move to the next enabled entry, stopping at the end without wrapping.
        nextIndex = Math.min(enabledList.length - 1, currentIndex + 1);
      } else {
        // Nothing highlighted: start at first enabled entry.
        nextIndex = 0;
      }

      const nextItem = enabledList[nextIndex];
      // Check if nextItem exists under strict indexing.
      if (nextItem !== undefined) {
        setHighlight(nextItem.entry.id);
      } else {
        // Fallback for undefined item.
      }
    } else if (event.key === 'ArrowUp') {
      // Check if the pressed key is ArrowUp.
      event.preventDefault();
      // Check if there are any enabled entries.
      if (enabledList.length === 0) {
        // No enabled entries: cannot navigate.
        return;
      } else {
        // Enabled entries exist.
      }

      let prevIndex = 0;
      // Check if an enabled entry is already highlighted.
      if (currentIndex >= 0) {
        // Move to the previous enabled entry, stopping at the start without wrapping.
        prevIndex = Math.max(0, currentIndex - 1);
      } else {
        // Nothing highlighted: start at first enabled entry.
        prevIndex = 0;
      }

      const prevItem = enabledList[prevIndex];
      // Check if prevItem exists under strict indexing.
      if (prevItem !== undefined) {
        setHighlight(prevItem.entry.id);
      } else {
        // Fallback for undefined item.
      }
    } else if (event.key === 'Home') {
      // Check if the pressed key is Home.
      event.preventDefault();
      // Check if there are any enabled entries.
      if (enabledList.length === 0) {
        // No enabled entries: cannot navigate.
        return;
      } else {
        // Enabled entries exist.
      }

      const firstItem = enabledList[0];
      // Check if firstItem exists under strict indexing.
      if (firstItem !== undefined) {
        setHighlight(firstItem.entry.id);
      } else {
        // Fallback for undefined item.
      }
    } else if (event.key === 'End') {
      // Check if the pressed key is End.
      event.preventDefault();
      // Check if there are any enabled entries.
      if (enabledList.length === 0) {
        // No enabled entries: cannot navigate.
        return;
      } else {
        // Enabled entries exist.
      }

      const lastIndex = enabledList.length - 1;
      const lastItem = enabledList[lastIndex];
      // Check if lastItem exists under strict indexing.
      if (lastItem !== undefined) {
        setHighlight(lastItem.entry.id);
      } else {
        // Fallback for undefined item.
      }
    } else if (event.key === 'Enter') {
      // Check if the pressed key is Enter.
      event.preventDefault();
      // Check if an entry is currently highlighted.
      if (highlightedId !== null) {
        let targetRecord: EntryRecord | undefined;
        for (let i = 0; i < entries.length; i++) {
          const item = entries[i];
          // Check if item exists under strict indexing.
          if (item === undefined) {
            // Skip undefined entry.
            continue;
          } else {
            // Valid entry.
          }

          // Check if item matches highlightedId.
          if (item.entry.id === highlightedId) {
            targetRecord = item;
            break;
          } else {
            // Continue search.
          }
        }

        // Check if target record exists and is enabled.
        if (targetRecord !== undefined && targetRecord.enabled) {
          options.onPick(targetRecord.entry.id);
          close();
        } else {
          // Target record is disabled or missing: ignore Enter.
        }
      } else {
        // No entry highlighted: ignore Enter.
      }
    } else if (event.key === 'Escape') {
      // Check if the pressed key is Escape.
      event.preventDefault();
      close();
    } else {
      // Other keys: allow standard handling.
    }
  }

  /**
   * Outside-click event listener closing the styles gallery when the user clicks anywhere outside the container.
   *
   * @purpose Detects outside clicks and dismisses the open styles gallery.
   * @inputs event - MouseEvent captured on document.
   * @outputs void.
   * @dataflow event.target -> container contains check -> close().
   * @controlflow Check destroyed and open guards -> inspect event.target -> if target outside galleryEl, close gallery.
   */
  function onDocClick(event: MouseEvent): void {
    // Check if component has been destroyed or gallery is not currently open.
    if (destroyed || !open) {
      // Component destroyed or gallery closed: ignore click.
      return;
    } else {
      // Gallery is open: inspect click target.
    }

    // Check if click target is outside the gallery container element.
    if (event.target instanceof Node && !galleryEl.contains(event.target)) {
      // Click occurred outside styles gallery container: dismiss gallery.
      close();
    } else {
      // Click occurred inside container: allow entry click listeners to handle.
    }
  }

  /**
   * Opens the styles gallery at the specified viewport coordinates, clamping the position to remain within the screen.
   *
   * @purpose Displays gallery, sets initial highlight, clamps coordinates against window boundaries, and attaches outside-click dismissal.
   * @inputs x - Viewport horizontal coordinate in pixels.
   * @inputs y - Viewport vertical coordinate in pixels.
   * @outputs void.
   * @dataflow (x, y) -> display -> highlight current or first enabled entry -> measure & clamp against win dimensions -> apply left/top styles -> schedule outside click.
   * @controlflow Check destroyed guard -> unhide element -> highlight current entry if enabled else first enabled entry -> measure offsetWidth/offsetHeight -> clamp to win.innerWidth/innerHeight -> set left and top -> schedule outside-click listener.
   */
  function openAt(x: number, y: number): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort open.
      return;
    } else {
      // Component is active: proceed with opening.
    }

    galleryEl.hidden = false;
    open = true;

    // Check if a current entry is set and whether it is enabled.
    let initialHighlight: StyleId | null = null;
    if (currentId !== null) {
      for (let i = 0; i < entries.length; i++) {
        const item = entries[i];
        // Check if item exists under strict indexing.
        if (item === undefined) {
          // Skip undefined entry.
          continue;
        } else {
          // Valid entry record.
        }

        // Check if entry matches currentId and is enabled.
        if (item.entry.id === currentId && item.enabled) {
          initialHighlight = item.entry.id;
          break;
        } else {
          // Not matching or not enabled.
        }
      }
    } else {
      // No current entry set.
    }

    // Check if an initial highlight from currentId was found.
    if (initialHighlight !== null) {
      setHighlight(initialHighlight);
    } else {
      // Current entry not set or disabled: find the first enabled entry.
      let firstEnabledId: StyleId | null = null;
      for (let i = 0; i < entries.length; i++) {
        const item = entries[i];
        // Check if item exists under strict indexing.
        if (item === undefined) {
          // Skip undefined entry.
          continue;
        } else {
          // Valid entry record.
        }

        // Check if entry is enabled.
        if (item.enabled) {
          firstEnabledId = item.entry.id;
          break;
        } else {
          // Entry disabled.
        }
      }
      setHighlight(firstEnabledId);
    }

    const galleryWidth = galleryEl.offsetWidth;
    const galleryHeight = galleryEl.offsetHeight;
    const viewportWidth = win.innerWidth;
    const viewportHeight = win.innerHeight;

    let clampedX = x;
    let clampedY = y;

    // Check if the gallery would extend past the right boundary of the viewport.
    if (clampedX + galleryWidth > viewportWidth) {
      // Shift gallery back horizontally so it fits within the viewport.
      clampedX = viewportWidth - galleryWidth;
    } else {
      // Gallery fits horizontally.
    }

    // Check if horizontal shift produced a negative coordinate.
    if (clampedX < 0) {
      // Clamp negative coordinate to zero to keep gallery on screen.
      clampedX = 0;
    } else {
      // Coordinate is within screen bounds.
    }

    // Check if the gallery would extend past the bottom boundary of the viewport.
    if (clampedY + galleryHeight > viewportHeight) {
      // Shift gallery back vertically so it fits within the viewport.
      clampedY = viewportHeight - galleryHeight;
    } else {
      // Gallery fits vertically.
    }

    // Check if vertical shift produced a negative coordinate.
    if (clampedY < 0) {
      // Clamp negative coordinate to zero to keep gallery on screen.
      clampedY = 0;
    } else {
      // Coordinate is within screen bounds.
    }

    galleryEl.style.left = `${clampedX}px`;
    galleryEl.style.top = `${clampedY}px`;

    // Check if any open timeout is already pending.
    if (openTimeoutId !== null) {
      win.clearTimeout(openTimeoutId);
      openTimeoutId = null;
    } else {
      // No pending timeout.
    }

    openTimeoutId = win.setTimeout((): void => {
      openTimeoutId = null;
      // Check if component has been destroyed or gallery was closed before timeout expired.
      if (destroyed || !open) {
        // Component destroyed or gallery closed: do not attach listener.
        return;
      } else {
        // Gallery still open: attach outside-click dismiss listener to document.
        doc.addEventListener('click', onDocClick, { signal });
      }
    }, 0);
  }

  /**
   * Closes the styles gallery, resets selection highlight, and removes outside-click event listeners.
   *
   * @purpose Hides the styles gallery element, resets hover highlight, and detaches outside-click listeners in an idempotent manner.
   * @inputs void.
   * @outputs void.
   * @dataflow open = false -> galleryEl.hidden = true -> cleanup listeners.
   * @controlflow Check destroyed guard -> if open, set open to false, hide element, clear timeouts, and remove doc click listener.
   */
  function close(): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort close.
      return;
    } else {
      // Component is active: proceed with closing.
    }

    // Check if any open timeout is pending.
    if (openTimeoutId !== null) {
      win.clearTimeout(openTimeoutId);
      openTimeoutId = null;
    } else {
      // No pending open timeout.
    }

    doc.removeEventListener('click', onDocClick);

    // Check if gallery is currently open.
    if (open) {
      open = false;
      galleryEl.hidden = true;
      setHighlight(null);
    } else {
      // Gallery already closed.
    }
  }

  /**
   * Tears down the styles gallery component, aborting listeners and removing DOM nodes.
   *
   * @purpose Idempotently cleans up event listeners, closes the gallery, and removes the gallery element from the document body.
   * @inputs void.
   * @outputs void.
   * @dataflow abortController.abort() -> close() -> galleryEl.remove() -> mark destroyed = true.
   * @controlflow Check destroyed guard (return if true) -> mark destroyed = true -> clear open timeout -> abort controller -> close gallery -> remove gallery element from DOM.
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

    // Check if any open timeout is pending.
    if (openTimeoutId !== null) {
      win.clearTimeout(openTimeoutId);
      openTimeoutId = null;
    } else {
      // No pending timeout.
    }

    abortController.abort();
    close();
    galleryEl.remove();
  }

  galleryEl.addEventListener('keydown', onKeyDown, { signal });
  doc.addEventListener('keydown', onKeyDown, { signal });

  return {
    openAt,
    close,
    /**
     * @purpose Returns boolean indicating whether the styles gallery is currently open.
     * @inputs void.
     * @outputs boolean - True if the gallery is open and component is not destroyed; false otherwise.
     * @dataflow open -> boolean.
     * @controlflow Check destroyed guard -> return false if destroyed; otherwise return open flag.
     */
    get isOpen(): boolean {
      // Check if component is destroyed.
      if (destroyed) {
        // Destroyed component is not open.
        return false;
      } else {
        // Return live open status of the styles gallery.
        return open;
      }
    },
    setCurrent,
    setEnabled,
    destroy,
  };
}
