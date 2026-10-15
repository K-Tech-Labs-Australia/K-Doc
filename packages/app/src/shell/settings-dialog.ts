/**
 * @file settings-dialog.ts
 * @purpose Implements SettingsDialog, an accessible modal dialog using the native HTMLDialogElement for inspecting and configuring K-Doc editor settings (FR-14.14).
 * @inputs SettingsDialogOptions containing the Document context, initial KdocSettings configuration object, and onChange change listener callback.
 * @outputs SettingsDialog controller instance exposing open, close, isOpen, setSettings, and destroy lifecycle methods, alongside SETTINGS_DIALOG_STYLES CSS stylesheet definition.
 * @functions
 *   - installSettingsDialog: Constructs, styles, and mounts the native modal settings dialog into the document body, wiring fieldsets, controls, search filtering, and lifecycle methods.
 * @dataflow User interaction on controls -> updateSetting immutable copy -> options.onChange(nextSettings); external setSettings(next) -> binder synchronization.
 * @controlflow Mount native dialog to document body -> build search bar, body fieldsets, and footer close button -> wire input/change listeners with AbortController signal -> return SettingsDialog controller.
 * @version 18
 * @date 2026-10-06
 */

import type {
  KdocSettings,
  ThemeMode,
  AutosaveMode,
  ViewMode,
  SplitOrientation,
  ReadingWidth,
  Density,
  CommentExport,
} from '@k-doc/config';
import { HISTORY_LIMITS } from '@k-doc/config';
import { UI_THEME_IDS, UI_THEMES, type UiThemeId } from '@k-doc/config';
import { createIcon } from './icons.js';

export interface SettingsDialogOptions {
  readonly doc: Document;
  readonly initial: KdocSettings;
  /** Called on every change with the complete new settings object. */
  readonly onChange: (next: KdocSettings) => void;
  /** Opens the autocorrect replacement table (FR-7.8); without it the Editor section has no button for it. */
  readonly openReplacements?: () => void;
  /** Opens the snippets editor (FR-7.10); without it the Editor section has no button for it. */
  readonly openSnippets?: () => void;
}

export interface SettingsDialog {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  /** Replace the displayed values, e.g. after loading from disk. */
  setSettings(next: KdocSettings): void;
  destroy(): void;
}

/**
 * Static stylesheet for the settings modal dialog, styling the modal container, header,
 * search input, scrollable body, fieldsets, legends, rows, controls, empty state, and footer
 * using exclusively authoritative K-Doc design tokens from command-palette and link-dialog.
 */
export const SETTINGS_DIALOG_STYLES: string = `
dialog.kdoc-settings-dialog {
  position: fixed;
  top: 10vh;
  margin: 0 auto;
  border: 0;
  border-radius: var(--kdoc-radius-xl);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  padding: 0;
  width: 560px;
  max-width: calc(100% - 32px);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
  font-size: 14px;
  box-shadow: 0 1px 3px var(--kdoc-chrome-shadow-deeper), 0 4px 8px 3px var(--kdoc-chrome-shadow-dark);
}

/* Ensure closed dialogs never remain visible when display: flex is applied. */
dialog.kdoc-settings-dialog:not([open]) {
  display: none;
}

dialog.kdoc-settings-dialog::backdrop {
  background: var(--kdoc-chrome-shadow-deeper);
}

.kdoc-settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px 20px;
  border-bottom: 1px solid var(--kdoc-chrome-glass-edge);
  border-radius: var(--kdoc-radius-xl) var(--kdoc-radius-xl) 0 0;
  flex-shrink: 0;
}

.kdoc-settings-heading {
  margin: 0;
  font-size: 26px;
  font-weight: 500;
  color: var(--kdoc-chrome-text);
}

.kdoc-settings-close-icon {
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
  color: var(--kdoc-chrome-text-muted);
  font-size: 18px;
  line-height: 1;
  width: 32px;
  height: 32px;
  padding: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  transition: box-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.kdoc-settings-close-icon:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-settings-close-icon:active,
.kdoc-settings-close-icon[aria-pressed="true"] {
  box-shadow: none;
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
  color: var(--kdoc-chrome-accent);
}

.kdoc-settings-close-icon:disabled {
  box-shadow: none;
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
  cursor: not-allowed;
}

.kdoc-settings-close-icon:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-settings-search-bar {
  padding: 12px 20px;
  border-bottom: 1px solid var(--kdoc-chrome-glass-edge);
  flex-shrink: 0;
}

.kdoc-settings-search-input {
  width: 100%;
  min-height: 48px;
  height: 48px;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-pill);
  background: var(--kdoc-chrome-recessed);
  box-shadow: none;
  color: var(--kdoc-chrome-text);
  padding: 0 16px;
  font: inherit;
  font-size: 14px;
  box-sizing: border-box;
}

.kdoc-settings-search-input:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-settings-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  border-radius: var(--kdoc-radius-lg);
}

.kdoc-settings-fieldset {
  margin: 0 0 12px;
  padding: 6px 18px;
  border: 0;
  border-radius: var(--kdoc-radius-lg);
  background: var(--kdoc-chrome-container-low);
  box-shadow: none;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.kdoc-settings-fieldset[hidden] {
  display: none;
}

.kdoc-settings-legend {
  font-size: 13px;
  font-weight: 750;
  color: var(--kdoc-chrome-tertiary);
  padding: 12px 0 4px;
}

.kdoc-settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 52px;
  padding: 4px 0;
  box-sizing: border-box;
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-settings-row + .kdoc-settings-row {
  border-top: 1px solid var(--kdoc-chrome-glass-edge);
}

.kdoc-settings-control-select option {
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
}

.kdoc-settings-row[hidden] {
  display: none;
}

.kdoc-settings-label {
  font-size: 14px;
  color: var(--kdoc-chrome-text);
  user-select: none;
  flex: 1 1 auto;
}

.kdoc-settings-control-input,
.kdoc-settings-control-select {
  min-height: 40px;
  height: 40px;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-md);
  background: transparent;
  box-shadow: none;
  color: var(--kdoc-chrome-text);
  padding: 0 14px;
  font: inherit;
  font-size: 14px;
  box-sizing: border-box;
  max-width: 220px;
  width: 100%;
}

.kdoc-settings-control-input:focus-visible,
.kdoc-settings-control-select:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border: 2px solid var(--kdoc-chrome-accent);
}

.kdoc-switch {
  position: relative;
  width: 52px;
  height: 32px;
  display: inline-flex;
  flex-shrink: 0;
}
.kdoc-settings-control-checkbox {
  appearance: none;
  -webkit-appearance: none;
  margin: 0;
  width: 52px;
  height: 32px;
  border-radius: var(--kdoc-radius-pill);
  border: 2px solid var(--kdoc-chrome-edge);
  background: var(--kdoc-chrome-recessed);
  cursor: pointer;
  box-sizing: border-box;
  transition: background-color 150ms ease, border-color 150ms ease;
}
.kdoc-settings-control-checkbox:checked {
  background: var(--kdoc-chrome-accent);
  border-color: var(--kdoc-chrome-accent);
}
.kdoc-settings-control-checkbox:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}
.kdoc-switch-handle {
  position: absolute;
  left: 8px;
  top: 8px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--kdoc-chrome-edge);
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: left 150ms ease, top 150ms ease, width 150ms ease, height 150ms ease, background-color 150ms ease;
}
.kdoc-switch-handle svg {
  display: none;
  color: var(--kdoc-chrome-accent);
}
.kdoc-settings-control-checkbox:checked + .kdoc-switch-handle {
  left: 24px;
  top: 4px;
  width: 24px;
  height: 24px;
  background: var(--kdoc-chrome-on-accent);
}
.kdoc-settings-control-checkbox:checked + .kdoc-switch-handle svg {
  display: block;
}

.kdoc-settings-empty {
  padding: 24px 16px;
  font-size: 14px;
  font-style: italic;
  color: var(--kdoc-chrome-text-muted);
  text-align: center;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-settings-empty[hidden] {
  display: none;
}

.kdoc-settings-footer {
  display: flex;
  justify-content: flex-end;
  padding: 12px 20px;
  border-top: 1px solid var(--kdoc-chrome-glass-edge);
  background: transparent;
  border-radius: 0 0 var(--kdoc-radius-xl) var(--kdoc-radius-xl);
  flex-shrink: 0;
}

.kdoc-settings-button {
  min-width: 0;
  min-height: 0;
  height: 40px;
  padding: 0 20px;
  border-radius: var(--kdoc-radius-pill);
  font: inherit;
  font-size: 14px;
  font-weight: 550;
  cursor: pointer;
  box-sizing: border-box;
  border: 1px solid var(--kdoc-chrome-edge);
  background: transparent;
  box-shadow: none;
  color: var(--kdoc-chrome-text);
  transition: box-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.kdoc-settings-button:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-settings-button:active,
.kdoc-settings-button[aria-pressed="true"] {
  box-shadow: none;
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
  color: var(--kdoc-chrome-accent);
}

.kdoc-settings-button:disabled {
  box-shadow: none;
  opacity: 0.38;
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
  cursor: not-allowed;
}

.kdoc-settings-button:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-settings-button.kdoc-settings-close {
  background: var(--kdoc-chrome-accent);
  color: var(--kdoc-chrome-on-accent);
  border-color: var(--kdoc-chrome-accent);
}

@media (prefers-reduced-motion: reduce) {
  dialog.kdoc-settings-dialog,
  dialog.kdoc-settings-dialog * {
    transition: none !important;
    animation: none !important;
  }
  .kdoc-switch-handle,
  .kdoc-settings-control-checkbox {
    transition: none !important;
  }
}

.kdoc-settings-body::-webkit-scrollbar { width: 8px; }
.kdoc-settings-body::-webkit-scrollbar-track { background: var(--kdoc-chrome-base); border-radius: var(--kdoc-radius-pill); }
.kdoc-settings-body::-webkit-scrollbar-thumb { background: var(--kdoc-chrome-raised); border-radius: var(--kdoc-radius-pill); }
`;

/** Documented bounds for numeric settings fields defined in @k-doc/config schema. */
const AUTOSAVE_DELAY_MIN_MS = 200;
const AUTOSAVE_DELAY_MAX_MS = 60000;
const EDITOR_FONT_SIZE_MIN_PX = 8;
const EDITOR_FONT_SIZE_MAX_PX = 72;
const LINE_HEIGHT_MIN = 1.0;
const LINE_HEIGHT_MAX = 3.0;

/** Monotonically increasing counter ensuring unique DOM element IDs across multiple settings dialog instances. */
let nextSettingsDialogId: number = 0;

/**
 * Representation of a single settings row for DOM management and search filtering.
 */
interface SettingRow {
  readonly element: HTMLElement;
  readonly label: HTMLLabelElement;
}

/**
 * Representation of a settings fieldset section grouping rows under a legend.
 */
interface SettingSection {
  readonly fieldset: HTMLFieldSetElement;
  readonly rows: readonly SettingRow[];
}

/**
 * Binder interface for synchronizing control DOM values with a KdocSettings configuration object.
 */
interface ControlBinder {
  readonly sync: (settings: KdocSettings) => void;
}

/**
 * Installs the modal settings dialog into the document body, wiring fieldsets, controls, search filtering, and lifecycle methods.
 *
 * @purpose Constructs, styles, and mounts a native modal dialog element for managing all K-Doc preferences (FR-14.14).
 * @inputs options - SettingsDialogOptions containing document context, initial KdocSettings, and onChange callback.
 * @outputs SettingsDialog - Controller exposing open, close, isOpen, setSettings, and destroy lifecycle methods.
 * @dataflow options.initial -> DOM controls -> user modifications -> options.onChange(nextSettings).
 * @controlflow Create dialog DOM hierarchy -> build sections for General, Editor, Appearance, and Proofing -> wire input/change handlers -> return SettingsDialog controller.
 */
export function installSettingsDialog(options: SettingsDialogOptions): SettingsDialog {
  const doc = options.doc;
  const abortController = new AbortController();
  const signal = abortController.signal;

  const dialogId = ++nextSettingsDialogId;
  const searchInputId = `kdoc-settings-search-${dialogId}`;

  let destroyed: boolean = false;
  let currentSettings: KdocSettings = options.initial;
  let isSyncing: boolean = false;

  const binders: ControlBinder[] = [];

  // Construct native <dialog> element.
  const dialog = doc.createElement('dialog');
  dialog.className = 'kdoc-settings-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Settings');

  // Construct header containing title and close button.
  const header = doc.createElement('div');
  header.className = 'kdoc-settings-header';

  const heading = doc.createElement('h2');
  heading.className = 'kdoc-settings-heading';
  heading.textContent = 'Settings';
  header.appendChild(heading);

  const headerCloseButton = doc.createElement('button');
  headerCloseButton.type = 'button';
  headerCloseButton.className = 'kdoc-settings-close-icon';
  headerCloseButton.setAttribute('aria-label', 'Close settings');
  headerCloseButton.textContent = '×';
  headerCloseButton.addEventListener(
    'click',
    (): void => {
      close();
    },
    { signal },
  );
  header.appendChild(headerCloseButton);

  dialog.appendChild(header);

  // Construct search bar.
  const searchBar = doc.createElement('div');
  searchBar.className = 'kdoc-settings-search-bar';

  const searchInput = doc.createElement('input');
  searchInput.id = searchInputId;
  searchInput.type = 'search';
  searchInput.className = 'kdoc-settings-search-input';
  searchInput.placeholder = 'Search settings…';
  searchInput.setAttribute('aria-label', 'Search settings');
  searchInput.setAttribute('autocomplete', 'off');
  searchInput.setAttribute('spellcheck', 'false');
  searchBar.appendChild(searchInput);

  dialog.appendChild(searchBar);

  // Construct scrolling body.
  const body = doc.createElement('div');
  body.className = 'kdoc-settings-body';

  /**
   * Updates a single setting field, immutably replacing it in the settings object and firing onChange.
   *
   * @purpose Dispatches an immutable update to options.onChange whenever a user modifies a settings control.
   * @inputs section - The top-level settings section name ('general', 'editor', 'appearance', or 'proofing').
   * @inputs key - The field name within that section.
   * @inputs value - The validated new value for that field.
   * @outputs void.
   * @dataflow (section, key, value) -> shallow copy section -> shallow copy settings -> options.onChange(nextSettings).
   * @controlflow Check destroyed guard -> check isSyncing guard -> build new immutable settings object -> update currentSettings -> notify caller via options.onChange.
   */
  function updateSetting<S extends keyof KdocSettings, K extends keyof KdocSettings[S]>(
    section: S,
    key: K,
    value: KdocSettings[S][K],
  ): void {
    // Check if the component has been destroyed.
    if (destroyed) {
      // Branch: Component is destroyed; ignore updates.
      return;
    } else {
      // Branch: Component is active; proceed with setting update.
    }

    // Check if programmatic sync is currently in progress.
    if (isSyncing) {
      // Branch: Update was triggered programmatically during sync; suppress onChange.
      return;
    } else {
      // Branch: Update was triggered by user interaction; proceed.
    }

    // The settings object is treated as immutable so a caller can compare old and new
    // by reference to decide whether anything needs re-applying.
    const currentSection = currentSettings[section];
    const nextSection = {
      ...currentSection,
      [key]: value,
    };
    const nextSettings: KdocSettings = {
      ...currentSettings,
      [section]: nextSection,
    };

    currentSettings = nextSettings;
    options.onChange(nextSettings);
  }

  /**
   * Creates the row whose button opens the autocorrect replacement table, when the host supplied one.
   *
   * @purpose Offers the replacement table from the Editor section next to the switch that uses it (FR-7.8).
   * @inputs none - reads options.openReplacements.
   * @outputs SettingRow[] - one row, or none when there is nothing to open.
   * @dataflow options.openReplacements -> button click -> the host opens its dialog.
   * @controlflow Return no rows without an opener; otherwise build the label and button and wire the click.
   */
  function createReplacementsRow(): SettingRow[] {
    return createOpenerRow('autocorrect-replacements', 'Replacement table', options.openReplacements);
  }

  /**
   * Creates a row whose Edit… button opens a dialog the host owns, when the host supplied one.
   *
   * @purpose Offers a list editor from the section that uses it, such as the replacement table or the snippets (FR-7.8, FR-7.10).
   * @inputs idSuffix - Distinguishes the button id; labelText - The row label; opener - The host's opener, if any.
   * @outputs SettingRow[] - One row, or none when there is nothing to open.
   * @dataflow opener -> button click -> the host opens its dialog.
   * @controlflow Return no rows without an opener; otherwise build the label and button and wire the click.
   */
  function createOpenerRow(idSuffix: string, labelText: string, opener: (() => void) | undefined): SettingRow[] {
    // Check whether the host can open the replacement table.
    if (opener === undefined) {
      // No opener: leave the row out rather than show a button that does nothing.
      return [];
    } else {
      // An opener exists: build the row below.
    }
    const rowElement = doc.createElement('div');
    rowElement.className = 'kdoc-settings-row';
    const label = doc.createElement('label');
    const buttonId = `kdoc-setting-${dialogId}-${idSuffix}`;
    label.htmlFor = buttonId;
    label.className = 'kdoc-settings-label';
    label.textContent = labelText;
    const editButton = doc.createElement('button');
    editButton.id = buttonId;
    editButton.type = 'button';
    editButton.className = 'kdoc-settings-button';
    editButton.textContent = 'Edit…';
    editButton.addEventListener('click', (): void => {
      opener();
    });
    rowElement.append(label, editButton);
    return [{ element: rowElement, label }];
  }

  /**
   * Creates a settings row containing a label and a switch (a checkbox with role="switch").
   *
   * @purpose Constructs a labelled switch row for boolean settings fields and registers change listeners and sync binder.
   * @inputs fieldId - Unique DOM id for the control.
   * @inputs labelText - Human-readable label displayed alongside the switch.
   * @inputs initialChecked - Initial boolean state.
   * @inputs onValueChange - Callback invoked when the switch state changes.
   * @inputs syncValue - Selector extracting the current boolean from a KdocSettings object.
   * @outputs SettingRow - Constructed row containing DOM element and label reference.
   * @dataflow Initial state -> DOM switch -> user click/toggle -> onValueChange -> updateSetting -> onChange.
   * @controlflow Create row container -> create label -> create switch input inside its track with a tick handle -> attach change/input listeners -> register sync binder -> return SettingRow.
   */
  function createCheckboxRow(
    fieldId: string,
    labelText: string,
    initialChecked: boolean,
    onValueChange: (nextChecked: boolean) => void,
    syncValue: (s: KdocSettings) => boolean,
  ): SettingRow {
    const rowElement = doc.createElement('div');
    rowElement.className = 'kdoc-settings-row';

    const label = doc.createElement('label');
    label.htmlFor = fieldId;
    label.className = 'kdoc-settings-label';
    label.textContent = labelText;
    rowElement.appendChild(label);

    const checkbox = doc.createElement('input');
    checkbox.id = fieldId;
    checkbox.type = 'checkbox';
    checkbox.className = 'kdoc-settings-control-checkbox';
    checkbox.setAttribute('role', 'switch');
    checkbox.checked = initialChecked;

    const handleCheckbox = (): void => {
      // Check if programmatic sync is in progress.
      if (isSyncing) {
        return;
      } else {
        // User-initiated toggle.
      }

      const previousVal = syncValue(currentSettings);
      const nextVal = checkbox.checked;

      // Check if the toggle state is unchanged.
      if (nextVal === previousVal) {
        return;
      } else {
        // State modified: commit update.
      }

      onValueChange(nextVal);
    };

    checkbox.addEventListener('change', handleCheckbox, { signal });
    checkbox.addEventListener('input', handleCheckbox, { signal });

    // Material switch: the native checkbox is the track, and the handle beside it shows a tick when on.
    const switchTrack = doc.createElement('span');
    switchTrack.className = 'kdoc-switch';
    const switchHandle = doc.createElement('span');
    switchHandle.className = 'kdoc-switch-handle';
    switchHandle.setAttribute('aria-hidden', 'true');
    switchHandle.appendChild(createIcon(doc, 'tick', 16));
    switchTrack.append(checkbox, switchHandle);
    rowElement.appendChild(switchTrack);

    binders.push({
      sync: (s: KdocSettings): void => {
        checkbox.checked = syncValue(s);
      },
    });

    return {
      element: rowElement,
      label,
    };
  }

  /**
   * Creates a settings row containing a label and a select dropdown control.
   *
   * @purpose Constructs a labelled select row for union string settings fields and registers its change listeners and sync binder.
   * @inputs fieldId - Unique DOM id for the control.
   * @inputs labelText - Human-readable label displayed alongside the select.
   * @inputs optionsList - Array of value and label pairs to populate as select options.
   * @inputs initialValue - Initial selected option value.
   * @inputs onValueChange - Callback invoked when the user selects a different option.
   * @inputs syncValue - Selector extracting the current value from a KdocSettings object.
   * @outputs SettingRow - Constructed row containing DOM element and label reference.
   * @dataflow Initial value -> DOM select -> user selection -> onValueChange -> updateSetting -> onChange.
   * @controlflow Create row container -> create label -> create select and option elements -> attach change/input listeners -> register sync binder -> return SettingRow.
   */
  function createSelectRow<T extends string>(
    fieldId: string,
    labelText: string,
    optionsList: readonly { readonly value: T; readonly label: string }[],
    initialValue: T,
    onValueChange: (nextVal: T) => void,
    syncValue: (s: KdocSettings) => T,
  ): SettingRow {
    const rowElement = doc.createElement('div');
    rowElement.className = 'kdoc-settings-row';

    const label = doc.createElement('label');
    label.htmlFor = fieldId;
    label.className = 'kdoc-settings-label';
    label.textContent = labelText;
    rowElement.appendChild(label);

    const select = doc.createElement('select');
    select.id = fieldId;
    select.className = 'kdoc-settings-control-select';

    for (let i = 0; i < optionsList.length; i++) {
      const opt = optionsList[i];
      // Check if option definition is defined under strict indexing.
      if (opt !== undefined) {
        const optionElem = doc.createElement('option');
        optionElem.value = opt.value;
        optionElem.textContent = opt.label;
        select.appendChild(optionElem);
      } else {
        // Skip undefined option.
      }
    }

    select.value = initialValue;

    const handleSelect = (): void => {
      // Check if programmatic sync is in progress.
      if (isSyncing) {
        return;
      } else {
        // User-initiated selection change.
      }

      const nextVal = select.value as T;
      onValueChange(nextVal);
    };

    select.addEventListener('change', handleSelect, { signal });
    select.addEventListener('input', handleSelect, { signal });

    rowElement.appendChild(select);

    binders.push({
      sync: (s: KdocSettings): void => {
        select.value = syncValue(s);
      },
    });

    return {
      element: rowElement,
      label,
    };
  }

  /**
   * Creates a settings row containing a label and a numeric input control with bounds validation and NaN rejection.
   *
   * @purpose Constructs a labelled number input row enforcing min/max bounds and fallback on non-numeric or empty input.
   * @inputs fieldId - Unique DOM id for the control.
   * @inputs labelText - Human-readable label displayed alongside the number input.
   * @inputs min - Minimum allowed numeric value per schema specification.
   * @inputs max - Maximum allowed numeric value per schema specification.
   * @inputs step - Step increment attribute string.
   * @inputs isInteger - Whether the field requires integer values.
   * @inputs initialValue - Initial numeric value.
   * @inputs onValueChange - Callback invoked when a valid, in-bounds numeric value is committed.
   * @inputs syncValue - Selector extracting the current number from a KdocSettings object.
   * @outputs SettingRow - Constructed row containing DOM element and label reference.
   * @dataflow Initial number -> DOM input -> user input / change -> validate against NaN & bounds -> onValueChange -> updateSetting -> onChange.
   * @controlflow Create row container -> create label -> create number input with min/max/step attributes -> attach change/input validation listener -> register sync binder -> return SettingRow.
   */
  function createNumberRow(
    fieldId: string,
    labelText: string,
    min: number,
    max: number,
    step: string,
    isInteger: boolean,
    initialValue: number,
    onValueChange: (nextVal: number) => void,
    syncValue: (s: KdocSettings) => number,
  ): SettingRow {
    const rowElement = doc.createElement('div');
    rowElement.className = 'kdoc-settings-row';

    const label = doc.createElement('label');
    label.htmlFor = fieldId;
    label.className = 'kdoc-settings-label';
    label.textContent = labelText;
    rowElement.appendChild(label);

    const input = doc.createElement('input');
    input.id = fieldId;
    input.type = 'number';
    input.className = 'kdoc-settings-control-input';
    input.min = String(min);
    input.max = String(max);
    input.step = step;
    input.value = String(initialValue);

    const handleNumber = (): void => {
      // Check if programmatic sync is in progress.
      if (isSyncing) {
        return;
      } else {
        // User-initiated change.
      }

      const previousVal = syncValue(currentSettings);
      const raw = input.value.trim();

      // Check if the input value is empty or non-numeric.
      // An empty number input reads as NaN, which would silently corrupt the file.
      if (raw.length === 0) {
        input.value = String(previousVal);
        return;
      } else {
        // Input is not empty: parse as number.
      }

      const num = Number(raw);

      // Check if parsed number is NaN or not finite.
      // Number inputs must reject non-numeric input by falling back to the previous value.
      if (Number.isNaN(num) || !Number.isFinite(num)) {
        input.value = String(previousVal);
        return;
      } else {
        // Input is a finite number.
      }

      // Check if integer constraint applies and value is not an integer.
      if (isInteger && !Number.isInteger(num)) {
        input.value = String(previousVal);
        return;
      } else {
        // Integer check passed.
      }

      // Check if numeric value falls outside the schema's documented bounds.
      if (num < min || num > max) {
        input.value = String(previousVal);
        return;
      } else {
        // Value is within documented bounds.
      }

      // Check if the value is unchanged.
      if (num === previousVal) {
        return;
      } else {
        // Value is modified and valid: invoke onValueChange.
      }

      onValueChange(num);
    };

    input.addEventListener('change', handleNumber, { signal });
    input.addEventListener('input', handleNumber, { signal });

    rowElement.appendChild(input);

    binders.push({
      sync: (s: KdocSettings): void => {
        input.value = String(syncValue(s));
      },
    });

    return {
      element: rowElement,
      label,
    };
  }

  /**
   * Creates a settings row containing a label and a free text input control.
   *
   * @purpose Constructs a labelled text input row for free string settings fields and registers change listeners and sync binder.
   * @inputs fieldId - Unique DOM id for the control.
   * @inputs labelText - Human-readable label displayed alongside the text input.
   * @inputs initialValue - Initial text string value.
   * @inputs onValueChange - Callback invoked when text is modified.
   * @inputs syncValue - Selector extracting the current string from a KdocSettings object.
   * @outputs SettingRow - Constructed row containing DOM element and label reference.
   * @dataflow Initial string -> DOM input -> user typing -> onValueChange -> updateSetting -> onChange.
   * @controlflow Create row container -> create label -> create text input -> attach change/input listeners -> register sync binder -> return SettingRow.
   */
  function createTextRow(
    fieldId: string,
    labelText: string,
    initialValue: string,
    onValueChange: (nextVal: string) => void,
    syncValue: (s: KdocSettings) => string,
  ): SettingRow {
    const rowElement = doc.createElement('div');
    rowElement.className = 'kdoc-settings-row';

    const label = doc.createElement('label');
    label.htmlFor = fieldId;
    label.className = 'kdoc-settings-label';
    label.textContent = labelText;
    rowElement.appendChild(label);

    const input = doc.createElement('input');
    input.id = fieldId;
    input.type = 'text';
    input.className = 'kdoc-settings-control-input';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.value = initialValue;

    const handleText = (): void => {
      // Check if programmatic sync is in progress.
      if (isSyncing) {
        return;
      } else {
        // User-initiated change.
      }

      const previousVal = syncValue(currentSettings);
      const nextVal = input.value;

      // Check if the text value is unchanged.
      if (nextVal === previousVal) {
        return;
      } else {
        // Text is modified: commit update.
      }

      onValueChange(nextVal);
    };

    input.addEventListener('change', handleText, { signal });
    input.addEventListener('input', handleText, { signal });

    rowElement.appendChild(input);

    binders.push({
      sync: (s: KdocSettings): void => {
        input.value = syncValue(s);
      },
    });

    return {
      element: rowElement,
      label,
    };
  }

  // Four sections only: General, Editor, Appearance, Proofing — one per section that actually has settings behind it.
  // FR-14.14 also names Markdown Style, Files & Links, Review, Export, Shortcuts, Plugins and Advanced;
  // there are no settings behind those yet. Do not render empty sections:
  // an empty settings tab is a promise the application does not keep, and is worse than the section being absent.

  // =========================================================================
  // Section 1: General
  // =========================================================================
  const generalFieldset = doc.createElement('fieldset');
  generalFieldset.className = 'kdoc-settings-fieldset';
  const generalLegend = doc.createElement('legend');
  generalLegend.className = 'kdoc-settings-legend';
  generalLegend.textContent = 'General';
  generalFieldset.appendChild(generalLegend);

  const generalRows: SettingRow[] = [
    createCheckboxRow(
      `kdoc-setting-${dialogId}-general-portableComments`,
      'Keep comments in the file',
      currentSettings.general.portableComments,
      (v: boolean): void => {
        updateSetting('general', 'portableComments', v);
      },
      (s: KdocSettings): boolean => s.general.portableComments,
    ),
    createCheckboxRow(
      `kdoc-setting-${dialogId}-general-restoreSessionOnLaunch`,
      'Restore session on launch',
      currentSettings.general.restoreSessionOnLaunch,
      (v: boolean): void => {
        updateSetting('general', 'restoreSessionOnLaunch', v);
      },
      (s: KdocSettings): boolean => s.general.restoreSessionOnLaunch,
    ),
    createCheckboxRow(
      `kdoc-setting-${dialogId}-general-confirmExternalLinks`,
      'Confirm external links',
      currentSettings.general.confirmExternalLinks,
      (v: boolean): void => {
        updateSetting('general', 'confirmExternalLinks', v);
      },
      (s: KdocSettings): boolean => s.general.confirmExternalLinks,
    ),
    createCheckboxRow(
      `kdoc-setting-${dialogId}-general-developerMode`,
      'Developer mode (Fidelity Check on save)',
      currentSettings.general.developerMode,
      (v: boolean): void => {
        updateSetting('general', 'developerMode', v);
      },
      (s: KdocSettings): boolean => s.general.developerMode,
    ),
    createTextRow(
      `kdoc-setting-${dialogId}-general-authorName`,
      'Author name',
      currentSettings.general.authorName,
      (v: string): void => {
        updateSetting('general', 'authorName', v);
      },
      (s: KdocSettings): string => s.general.authorName,
    ),
    createTextRow(
      `kdoc-setting-${dialogId}-general-attachmentsFolder`,
      'Attachments folder',
      currentSettings.general.attachmentsFolder,
      (v: string): void => {
        updateSetting('general', 'attachmentsFolder', v);
      },
      (s: KdocSettings): string => s.general.attachmentsFolder,
    ),
    createTextRow(
      `kdoc-setting-${dialogId}-general-attachmentNameTemplate`,
      'Attachment name template',
      currentSettings.general.attachmentNameTemplate,
      (v: string): void => {
        updateSetting('general', 'attachmentNameTemplate', v);
      },
      (s: KdocSettings): string => s.general.attachmentNameTemplate,
    ),
  ];

  for (let i = 0; i < generalRows.length; i++) {
    const row = generalRows[i];
    // Check if row is defined under strict indexing.
    if (row !== undefined) {
      generalFieldset.appendChild(row.element);
    } else {
      // Skip undefined row.
    }
  }
  body.appendChild(generalFieldset);

  // =========================================================================
  // Section 2: Editor
  // =========================================================================
  const editorFieldset = doc.createElement('fieldset');
  editorFieldset.className = 'kdoc-settings-fieldset';
  const editorLegend = doc.createElement('legend');
  editorLegend.className = 'kdoc-settings-legend';
  editorLegend.textContent = 'Editor';
  editorFieldset.appendChild(editorLegend);

  const editorRows: SettingRow[] = [
    createSelectRow<ViewMode>(
      `kdoc-setting-${dialogId}-editor-defaultViewMode`,
      'Default view mode',
      [
        { value: 'kdoc', label: 'K-Doc' },
        { value: 'source', label: 'Source' },
        { value: 'split', label: 'Split' },
      ],
      currentSettings.editor.defaultViewMode,
      (v: ViewMode): void => {
        updateSetting('editor', 'defaultViewMode', v);
      },
      (s: KdocSettings): ViewMode => s.editor.defaultViewMode,
    ),
    createSelectRow<SplitOrientation>(
      `kdoc-setting-${dialogId}-editor-splitOrientation`,
      'Split orientation',
      [
        { value: 'vertical', label: 'Vertical' },
        { value: 'horizontal', label: 'Horizontal' },
      ],
      currentSettings.editor.splitOrientation,
      (v: SplitOrientation): void => {
        updateSetting('editor', 'splitOrientation', v);
      },
      (s: KdocSettings): SplitOrientation => s.editor.splitOrientation,
    ),
    createCheckboxRow(
      `kdoc-setting-${dialogId}-editor-smartSubstitutions`,
      'Smart substitutions',
      currentSettings.editor.smartSubstitutions,
      (v: boolean): void => {
        updateSetting('editor', 'smartSubstitutions', v);
      },
      (s: KdocSettings): boolean => s.editor.smartSubstitutions,
    ),
    createCheckboxRow(
      `kdoc-setting-${dialogId}-autocorrect-smartQuotes`,
      'Smart quotes',
      currentSettings.autocorrect.smartQuotes,
      (v: boolean): void => {
        updateSetting('autocorrect', 'smartQuotes', v);
      },
      (s: KdocSettings): boolean => s.autocorrect.smartQuotes,
    ),
    createCheckboxRow(
      `kdoc-setting-${dialogId}-autocorrect-dashes`,
      'Dashes (-- and spaced -)',
      currentSettings.autocorrect.dashes,
      (v: boolean): void => {
        updateSetting('autocorrect', 'dashes', v);
      },
      (s: KdocSettings): boolean => s.autocorrect.dashes,
    ),
    createCheckboxRow(
      `kdoc-setting-${dialogId}-autocorrect-ellipsis`,
      'Ellipsis (...)',
      currentSettings.autocorrect.ellipsis,
      (v: boolean): void => {
        updateSetting('autocorrect', 'ellipsis', v);
      },
      (s: KdocSettings): boolean => s.autocorrect.ellipsis,
    ),
    createCheckboxRow(
      `kdoc-setting-${dialogId}-autocorrect-ordinals`,
      'Ordinal superscripts (1st)',
      currentSettings.autocorrect.ordinals,
      (v: boolean): void => {
        updateSetting('autocorrect', 'ordinals', v);
      },
      (s: KdocSettings): boolean => s.autocorrect.ordinals,
    ),
    createCheckboxRow(
      `kdoc-setting-${dialogId}-autocorrect-capitalizeSentences`,
      'Capitalise sentences',
      currentSettings.autocorrect.capitalizeSentences,
      (v: boolean): void => {
        updateSetting('autocorrect', 'capitalizeSentences', v);
      },
      (s: KdocSettings): boolean => s.autocorrect.capitalizeSentences,
    ),
    createCheckboxRow(
      `kdoc-setting-${dialogId}-autocorrect-replaceText`,
      'Replace text as you type',
      currentSettings.autocorrect.replaceText,
      (v: boolean): void => {
        updateSetting('autocorrect', 'replaceText', v);
      },
      (s: KdocSettings): boolean => s.autocorrect.replaceText,
    ),
    ...createReplacementsRow(),
    createCheckboxRow(
      `kdoc-setting-${dialogId}-snippets-enabled`,
      'Snippets (prefix + Tab)',
      currentSettings.snippets.enabled,
      (v: boolean): void => {
        updateSetting('snippets', 'enabled', v);
      },
      (s: KdocSettings): boolean => s.snippets.enabled,
    ),
    ...createOpenerRow('snippets', 'Snippet list', options.openSnippets),
    createCheckboxRow(
      `kdoc-setting-${dialogId}-editor-allowHtmlFormatting`,
      'Allow HTML formatting',
      currentSettings.editor.allowHtmlFormatting,
      (v: boolean): void => {
        updateSetting('editor', 'allowHtmlFormatting', v);
      },
      (s: KdocSettings): boolean => s.editor.allowHtmlFormatting,
    ),
    createCheckboxRow(
      `kdoc-setting-${dialogId}-editor-inputRules`,
      'Input rules',
      currentSettings.editor.inputRules,
      (v: boolean): void => {
        updateSetting('editor', 'inputRules', v);
      },
      (s: KdocSettings): boolean => s.editor.inputRules,
    ),
    createSelectRow<AutosaveMode>(
      `kdoc-setting-${dialogId}-editor-autosave`,
      'Autosave',
      [
        { value: 'off', label: 'Off' },
        { value: 'on-blur', label: 'On blur' },
        { value: 'interval', label: 'Interval' },
        { value: 'idle', label: 'Idle' },
      ],
      currentSettings.editor.autosave,
      (v: AutosaveMode): void => {
        updateSetting('editor', 'autosave', v);
      },
      (s: KdocSettings): AutosaveMode => s.editor.autosave,
    ),
    createNumberRow(
      `kdoc-setting-${dialogId}-editor-autosaveDelayMs`,
      'Autosave delay (ms)',
      AUTOSAVE_DELAY_MIN_MS,
      AUTOSAVE_DELAY_MAX_MS,
      '1',
      true,
      currentSettings.editor.autosaveDelayMs,
      (v: number): void => {
        updateSetting('editor', 'autosaveDelayMs', v);
      },
      (s: KdocSettings): number => s.editor.autosaveDelayMs,
    ),
    createCheckboxRow(
      `kdoc-setting-${dialogId}-history-snapshotOnSave`,
      'Snapshot on save',
      currentSettings.history.snapshotOnSave,
      (v: boolean): void => {
        updateSetting('history', 'snapshotOnSave', v);
      },
      (s: KdocSettings): boolean => s.history.snapshotOnSave,
    ),
    createNumberRow(
      `kdoc-setting-${dialogId}-history-snapshotMinutes`,
      'Snapshot every (minutes, 0 = off)',
      0,
      HISTORY_LIMITS.snapshotMinutes,
      '1',
      true,
      currentSettings.history.snapshotMinutes,
      (v: number): void => {
        updateSetting('history', 'snapshotMinutes', v);
      },
      (s: KdocSettings): number => s.history.snapshotMinutes,
    ),
  ];

  for (let i = 0; i < editorRows.length; i++) {
    const row = editorRows[i];
    // Check if row is defined under strict indexing.
    if (row !== undefined) {
      editorFieldset.appendChild(row.element);
    } else {
      // Skip undefined row.
    }
  }
  body.appendChild(editorFieldset);

  // =========================================================================
  // Section 3: Appearance
  // =========================================================================
  const appearanceFieldset = doc.createElement('fieldset');
  appearanceFieldset.className = 'kdoc-settings-fieldset';
  const appearanceLegend = doc.createElement('legend');
  appearanceLegend.className = 'kdoc-settings-legend';
  appearanceLegend.textContent = 'Appearance';
  appearanceFieldset.appendChild(appearanceLegend);

  const appearanceRows: SettingRow[] = [
    createSelectRow<ThemeMode>(
      `kdoc-setting-${dialogId}-appearance-theme`,
      'Theme',
      [
        { value: 'system', label: 'System' },
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ],
      currentSettings.appearance.theme,
      (v: ThemeMode): void => {
        updateSetting('appearance', 'theme', v);
      },
      (s: KdocSettings): ThemeMode => s.appearance.theme,
    ),
    createSelectRow<UiThemeId>(
      `kdoc-setting-${dialogId}-appearance-uiTheme`,
      'Colour theme',
      UI_THEME_IDS.map((id: UiThemeId) => ({ value: id, label: UI_THEMES[id].label })),
      currentSettings.appearance.uiTheme,
      (v: UiThemeId): void => {
        updateSetting('appearance', 'uiTheme', v);
      },
      (s: KdocSettings): UiThemeId => s.appearance.uiTheme,
    ),
    createTextRow(
      `kdoc-setting-${dialogId}-appearance-editorFontFamily`,
      'Editor font family',
      currentSettings.appearance.editorFontFamily,
      (v: string): void => {
        updateSetting('appearance', 'editorFontFamily', v);
      },
      (s: KdocSettings): string => s.appearance.editorFontFamily,
    ),
    createTextRow(
      `kdoc-setting-${dialogId}-appearance-monospaceFontFamily`,
      'Monospace font family',
      currentSettings.appearance.monospaceFontFamily,
      (v: string): void => {
        updateSetting('appearance', 'monospaceFontFamily', v);
      },
      (s: KdocSettings): string => s.appearance.monospaceFontFamily,
    ),
    createNumberRow(
      `kdoc-setting-${dialogId}-appearance-editorFontSizePx`,
      'Editor font size (px)',
      EDITOR_FONT_SIZE_MIN_PX,
      EDITOR_FONT_SIZE_MAX_PX,
      '1',
      true,
      currentSettings.appearance.editorFontSizePx,
      (v: number): void => {
        updateSetting('appearance', 'editorFontSizePx', v);
      },
      (s: KdocSettings): number => s.appearance.editorFontSizePx,
    ),
    createNumberRow(
      `kdoc-setting-${dialogId}-appearance-lineHeight`,
      'Line height',
      LINE_HEIGHT_MIN,
      LINE_HEIGHT_MAX,
      '0.1',
      false,
      currentSettings.appearance.lineHeight,
      (v: number): void => {
        updateSetting('appearance', 'lineHeight', v);
      },
      (s: KdocSettings): number => s.appearance.lineHeight,
    ),
    createSelectRow<Density>(
      `kdoc-setting-${dialogId}-appearance-density`,
      'Display density',
      [
        { value: 'compact' as const, label: 'Compact' },
        { value: 'comfortable' as const, label: 'Comfortable' },
        { value: 'spacious' as const, label: 'Spacious' },
      ],
      currentSettings.appearance.density,
      (v: Density): void => {
        updateSetting('appearance', 'density', v);
      },
      (s: KdocSettings): Density => s.appearance.density,
    ),
    createSelectRow<ReadingWidth>(
      `kdoc-setting-${dialogId}-appearance-readingWidth`,
      'Reading width',
      [
        { value: 'narrow', label: 'Narrow' },
        { value: 'medium', label: 'Medium' },
        { value: 'wide', label: 'Wide' },
        { value: 'full', label: 'Full' },
      ],
      currentSettings.appearance.readingWidth,
      (v: ReadingWidth): void => {
        updateSetting('appearance', 'readingWidth', v);
      },
      (s: KdocSettings): ReadingWidth => s.appearance.readingWidth,
    ),
  ];

  for (let i = 0; i < appearanceRows.length; i++) {
    const row = appearanceRows[i];
    // Check if row is defined under strict indexing.
    if (row !== undefined) {
      appearanceFieldset.appendChild(row.element);
    } else {
      // Skip undefined row.
    }
  }
  body.appendChild(appearanceFieldset);

  // =========================================================================
  // Section 4: Proofing
  // =========================================================================
  const proofingFieldset = doc.createElement('fieldset');
  proofingFieldset.className = 'kdoc-settings-fieldset';
  const proofingLegend = doc.createElement('legend');
  proofingLegend.className = 'kdoc-settings-legend';
  proofingLegend.textContent = 'Proofing';
  proofingFieldset.appendChild(proofingLegend);

  const proofingRows: SettingRow[] = [
    createCheckboxRow(
      `kdoc-setting-${dialogId}-proofing-spellCheck`,
      'Spell check',
      currentSettings.proofing.spellCheck,
      (v: boolean): void => {
        updateSetting('proofing', 'spellCheck', v);
      },
      (s: KdocSettings): boolean => s.proofing.spellCheck,
    ),
    createTextRow(
      `kdoc-setting-${dialogId}-proofing-grammarEndpoint`,
      'Grammar service URL',
      currentSettings.proofing.grammarEndpoint,
      (v: string): void => {
        updateSetting('proofing', 'grammarEndpoint', v);
      },
      (s: KdocSettings): string => s.proofing.grammarEndpoint,
    ),
    createTextRow(
      `kdoc-setting-${dialogId}-proofing-language`,
      'Language',
      currentSettings.proofing.language,
      (v: string): void => {
        updateSetting('proofing', 'language', v);
      },
      (s: KdocSettings): string => s.proofing.language,
    ),
    createCheckboxRow(
      `kdoc-setting-${dialogId}-proofing-detectLanguage`,
      'Detect each document\'s language',
      currentSettings.proofing.detectLanguage,
      (v: boolean): void => {
        updateSetting('proofing', 'detectLanguage', v);
      },
      (s: KdocSettings): boolean => s.proofing.detectLanguage,
    ),
  ];

  for (let i = 0; i < proofingRows.length; i++) {
    const row = proofingRows[i];
    // Check if row is defined under strict indexing.
    if (row !== undefined) {
      proofingFieldset.appendChild(row.element);
    } else {
      // Skip undefined row.
    }
  }
  body.appendChild(proofingFieldset);

  // =========================================================================
  // Export section (FR-10.7).
  // =========================================================================
  const exportFieldset = doc.createElement('fieldset');
  exportFieldset.className = 'kdoc-settings-fieldset';
  const exportLegend = doc.createElement('legend');
  exportLegend.className = 'kdoc-settings-legend';
  exportLegend.textContent = 'Export';
  exportFieldset.appendChild(exportLegend);

  const exportRows: SettingRow[] = [
    createSelectRow<CommentExport>(
      `kdoc-setting-${dialogId}-export-comments`,
      'Comments in exports',
      [
        { value: 'exclude' as const, label: 'Leave out' },
        { value: 'endnotes' as const, label: 'As endnotes' },
        { value: 'margin-notes' as const, label: 'In the margin' },
      ],
      currentSettings.export.comments,
      // The theme is a name rather than a list, because the reader's own themes are files in a folder and can appear
      // or be renamed while the dialog is open; the Export Theme command offers whatever is there now (FR-13.8).
      (v: CommentExport): void => {
        updateSetting('export', 'comments', v);
      },
      (s: KdocSettings): CommentExport => s.export.comments,
    ),
    createTextRow(
      `kdoc-setting-${dialogId}-export-theme`,
      'Export theme',
      currentSettings.export.theme,
      (v: string): void => {
        updateSetting('export', 'theme', v);
      },
      (s: KdocSettings): string => s.export.theme,
    ),
  ];

  for (let i = 0; i < exportRows.length; i++) {
    const row = exportRows[i];
    // Check if row is defined under strict indexing.
    if (row !== undefined) {
      exportFieldset.appendChild(row.element);
    } else {
      // Skip undefined row.
    }
  }
  body.appendChild(exportFieldset);

  // Empty search state indicator.
  const emptyMessage = doc.createElement('div');
  emptyMessage.className = 'kdoc-settings-empty';
  emptyMessage.textContent = 'No settings found';
  emptyMessage.hidden = true;
  body.appendChild(emptyMessage);

  dialog.appendChild(body);

  // Construct footer with Close button.
  const footer = doc.createElement('div');
  footer.className = 'kdoc-settings-footer';

  const footerCloseButton = doc.createElement('button');
  footerCloseButton.type = 'button';
  footerCloseButton.className = 'kdoc-settings-button kdoc-settings-close';
  footerCloseButton.textContent = 'Close';
  footerCloseButton.addEventListener(
    'click',
    (): void => {
      close();
    },
    { signal },
  );
  footer.appendChild(footerCloseButton);

  dialog.appendChild(footer);

  const sections: readonly SettingSection[] = [
    { fieldset: generalFieldset, rows: generalRows },
    { fieldset: editorFieldset, rows: editorRows },
    { fieldset: appearanceFieldset, rows: appearanceRows },
    { fieldset: proofingFieldset, rows: proofingRows },
    { fieldset: exportFieldset, rows: exportRows },
  ];

  /**
   * Filters settings rows and fieldset sections based on user search query text.
   *
   * @purpose Hides rows whose label text does not match the search query case-insensitively, and hides whole fieldset sections when none of their rows match.
   * @inputs query - Search string to filter against.
   * @outputs void.
   * @dataflow query string -> case-insensitive comparison -> row.element.hidden & fieldset.hidden updates.
   * @controlflow Trim and lowercase query -> iterate sections -> for each row check label content against query -> update row.hidden -> count matching rows -> if count is zero hide fieldset; else show fieldset.
   */
  function filterRows(query: string): void {
    const normalizedQuery = query.trim().toLowerCase();
    let totalVisibleCount = 0;

    for (let s = 0; s < sections.length; s++) {
      const section = sections[s];
      // Check if section definition is defined under strict indexing.
      if (section === undefined) {
        continue;
      } else {
        // Valid section.
      }

      let sectionVisibleCount = 0;

      for (let r = 0; r < section.rows.length; r++) {
        const row = section.rows[r];
        // Check if row definition is defined under strict indexing.
        if (row === undefined) {
          continue;
        } else {
          // Valid row.
        }

        const labelText = row.label.textContent;
        // Check if label text exists.
        const labelStr = labelText !== null ? labelText : '';
        const matches =
          normalizedQuery.length === 0 || labelStr.toLowerCase().includes(normalizedQuery);

        // Check if label matches search query.
        if (matches) {
          row.element.hidden = false;
          sectionVisibleCount++;
          totalVisibleCount++;
        } else {
          row.element.hidden = true;
        }
      }

      // Check if section contains any visible matching rows.
      // A section left visible with no visible rows reads as a bug.
      if (sectionVisibleCount === 0) {
        section.fieldset.hidden = true;
      } else {
        section.fieldset.hidden = false;
      }
    }

    // Check if any matching rows remain visible across the entire dialog.
    if (totalVisibleCount === 0) {
      emptyMessage.hidden = false;
    } else {
      emptyMessage.hidden = true;
    }
  }

  // Filter rows on search input events.
  searchInput.addEventListener(
    'input',
    (): void => {
      filterRows(searchInput.value);
    },
    { signal },
  );

  // Handle native Escape key dismiss event without double-closing.
  dialog.addEventListener(
    'cancel',
    (event: Event): void => {
      event.preventDefault();
      close();
    },
    { signal },
  );

  // Mount native dialog to document body.
  doc.body.appendChild(dialog);

  /**
   * Opens the settings modal dialog, resetting search filter and focusing the search input.
   *
   * @purpose Displays the modal settings dialog with showModal() and initializes search focus.
   * @inputs void.
   * @outputs void.
   * @dataflow Reset search input -> filterRows('') -> dialog.showModal() -> searchInput.focus().
   * @controlflow Check destroyed guard -> clear search input value -> reset row filters -> open dialog modal -> focus search input.
   */
  function open(): void {
    // Check if component has been destroyed.
    if (destroyed) {
      return;
    } else {
      // Component is active; proceed with opening.
    }

    searchInput.value = '';
    filterRows('');

    // Check if dialog is already open to avoid InvalidStateError.
    if (dialog.open) {
      // Dialog already open: skip showModal.
    } else if (typeof dialog.showModal === 'function') {
      // Native showModal supported: open as modal dialog with backdrop and focus trap.
      dialog.showModal();
    } else {
      // Fallback for non-modal or jsdom test environments lacking showModal.
      dialog.open = true;
    }

    // Focus search input on open if focus method is supported.
    if (typeof searchInput.focus === 'function') {
      searchInput.focus();
    } else {
      // Focus not supported in current environment.
    }
  }

  /**
   * Closes the settings modal dialog.
   *
   * @purpose Closes the modal dialog element idempotently across environments.
   * @inputs void.
   * @outputs void.
   * @dataflow dialog.close() / dialog.open = false.
   * @controlflow Check destroyed guard -> check if dialog is open -> invoke dialog.close() or set open = false.
   */
  function close(): void {
    // Check if component has been destroyed.
    if (destroyed) {
      return;
    } else {
      // Component is active; proceed with closing.
    }

    // Check if dialog is currently open.
    if (dialog.open) {
      // Check if native close() method is supported.
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        // Fallback for test environments.
        dialog.open = false;
      }
    } else {
      // Dialog already closed: no operation required.
    }
  }

  /**
   * Replaces displayed values in all controls with next settings without firing onChange.
   *
   * @purpose Synchronizes controls with external settings updates (e.g. after loading from disk) without triggering infinite update loops.
   * @inputs next - The replacement KdocSettings configuration object.
   * @outputs void.
   * @dataflow next KdocSettings -> binder.sync() -> control displayed values.
   * @controlflow Check destroyed guard -> set currentSettings = next -> set isSyncing = true -> execute binder syncs -> reset isSyncing = false.
   */
  function setSettings(next: KdocSettings): void {
    // Check if component has been destroyed.
    if (destroyed) {
      return;
    } else {
      // Component is active; proceed with sync.
    }

    currentSettings = next;

    // Firing during a programmatic update would loop.
    isSyncing = true;
    try {
      for (let i = 0; i < binders.length; i++) {
        const binder = binders[i];
        // Check if binder is defined under strict indexing.
        if (binder !== undefined) {
          binder.sync(next);
        } else {
          // Skip undefined binder.
        }
      }
    } finally {
      isSyncing = false;
    }
  }

  /**
   * Tears down the settings dialog component, aborting listeners and removing DOM nodes.
   *
   * @purpose Idempotently cleans up event listeners, closes dialog, and removes element from document.
   * @inputs void.
   * @outputs void.
   * @dataflow abortController.abort() -> close() -> dialog.remove() -> mark destroyed = true.
   * @controlflow Check destroyed guard -> mark destroyed = true -> abort controller -> close dialog -> remove dialog element from DOM.
   */
  function destroy(): void {
    // Check if component has already been destroyed.
    if (destroyed) {
      return;
    } else {
      destroyed = true;
    }

    abortController.abort();
    close();
    dialog.remove();
  }

  return {
    open,
    close,
    get isOpen(): boolean {
      // Check if component is destroyed.
      if (destroyed) {
        return false;
      } else {
        return dialog.open;
      }
    },
    setSettings,
    destroy,
  };
}
