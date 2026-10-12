// @vitest-environment jsdom

/**
 * @file settings-dialog.spec.ts
 * @purpose Vitest test suite for K-Doc's SettingsDialog modal component and SettingsStore persistence (FR-14.14, FR-14.15).
 *   Validates modal lifecycle, fieldset section structure, accessible label-to-control associations, schema-defined input types,
 *   immutable settings updates, numeric input boundary and NaN rejection, search query filtering, loop-free programmatic synchronization,
 *   and non-throwing storage persistence.
 * @inputs Synthetic DOM click, change, and input events; KdocSettings configuration layers; localStorage read and write states.
 * @outputs Vitest assertions verifying DOM presence, element visibility attributes, form control configurations, settings immutability, and store persistence.
 * @functions
 *   - mountDialog: Installs a SettingsDialog instance with DEFAULT_SETTINGS, tracks it for lifecycle teardown, and accumulates onChange emissions.
 *   - control: Queries an element by ID from the document with fail-fast missing element error handling instead of non-null assertions.
 *   - findControlByLabel: Locates an accessible control element by matching visible label text and resolving the htmlFor target element.
 *   - findFieldsetByLegend: Locates a settings section fieldset by matching its child legend text content.
 * @dataflow Synthetic DOM events -> SettingsDialog / SettingsStore -> onChange callbacks & localStorage -> Vitest assertions.
 * @controlflow Mount DOM elements & controllers -> execute test assertions across dialog sections, schema types, immutability, input validation, search filtering, loop suppression, and store persistence -> destroy controllers and detach DOM nodes in afterEach.
 * @version 2
 * @date 2026-10-03
 */

import { describe, expect, it, afterEach } from 'vitest';
import { DEFAULT_SETTINGS, type KdocSettings } from '@k-doc/config';
import { installSettingsDialog, type SettingsDialog } from '../src/shell/settings-dialog.js';
import { createSettingsStore, SETTINGS_FILE_NAME } from '../src/files/settings-store.js';

let activeDialogs: SettingsDialog[] = [];

afterEach((): void => {
  // Destroy all active dialog instances to clean up listeners and DOM elements.
  for (let i = 0; i < activeDialogs.length; i++) {
    const dialog = activeDialogs[i];
    // Check if dialog controller exists under strict indexing.
    if (dialog !== undefined) {
      dialog.destroy();
    } else {
      // Skip undefined dialog reference.
    }
  }
  activeDialogs = [];

  // Detach any lingering dialog elements attached to document.body.
  const lingeringDialogs = document.body.querySelectorAll<HTMLDialogElement>(
    'dialog.kdoc-settings-dialog',
  );
  for (let i = 0; i < lingeringDialogs.length; i++) {
    const d = lingeringDialogs[i];
    // Check if dialog node is defined and currently attached to a parent node.
    if (d !== undefined && d.parentNode !== null) {
      d.parentNode.removeChild(d);
    } else {
      // Dialog already detached.
    }
  }

  // Clear localStorage between test runs to avoid cross-test pollution.
  localStorage.clear();
});

/**
 * Installs a SettingsDialog instance with default settings, registers it for lifecycle teardown, and collects changes.
 *
 * @purpose Allocates and mounts a SettingsDialog controller into document.body with default settings and a change recorder.
 * @inputs void.
 * @outputs { dialog: SettingsDialog; changes: KdocSettings[] } - Controller and accumulated change array.
 * @dataflow DEFAULT_SETTINGS -> installSettingsDialog -> push dialog to activeDialogs -> record onChange updates -> return { dialog, changes }.
 * @controlflow Initialize changes array -> call installSettingsDialog with document, DEFAULT_SETTINGS, and onChange -> track dialog in activeDialogs -> return dialog and changes.
 */
function mountDialog(): { dialog: SettingsDialog; changes: KdocSettings[] } {
  const changes: KdocSettings[] = [];
  const dialog = installSettingsDialog({
    doc: document,
    initial: DEFAULT_SETTINGS,
    onChange: (next: KdocSettings): void => {
      changes.push(next);
    },
  });
  activeDialogs.push(dialog);
  return { dialog, changes };
}

/**
 * Queries an element by ID from the document, throwing a clear Error naming the id when missing rather than using a non-null assertion.
 *
 * @purpose Retrieves an element by DOM ID with fail-fast missing element error handling.
 * @inputs id - string - The DOM element ID to locate.
 * @outputs HTMLElement - The matched DOM element.
 * @dataflow id -> document.getElementById -> null check -> return HTMLElement.
 * @controlflow Query element with document.getElementById -> check if null -> if null throw Error naming id -> return element.
 */
function control(id: string): HTMLElement {
  const element = document.getElementById(id);
  // Check if an element matching the given id exists in the document.
  if (element === null) {
    // Branch: Element missing; throw descriptive Error naming the missing id.
    throw new Error(`Control element with id "${id}" not found`);
  } else {
    // Branch: Element found; return element.
  }
  return element;
}

/**
 * Finds a control element by locating its associated <label> element matching the given text and following its htmlFor attribute.
 *
 * Finding controls through their label is deliberate: it tests the accessible association at the same time,
 * and a control whose label is not wired to it would fail here rather than silently ship.
 *
 * @purpose Locates an accessible control by matching its visible label text and following the htmlFor target attribute.
 * @inputs text - string - The exact label text to find.
 * @outputs HTMLElement - The control element linked via the label's htmlFor attribute.
 * @dataflow text -> match label textContent -> read htmlFor -> control(targetId) -> return HTMLElement.
 * @controlflow Query all label elements -> find label matching text -> check if label found -> if missing throw Error -> check htmlFor attribute -> if missing throw Error -> delegate to control(targetId) -> return control.
 */
function findControlByLabel(text: string): HTMLElement {
  const labels = Array.from(document.querySelectorAll('label'));
  let matchedLabel: HTMLLabelElement | undefined;

  for (let i = 0; i < labels.length; i++) {
    const candidate = labels[i];
    // Check if candidate exists under strict indexed access.
    if (candidate !== undefined && candidate.textContent?.trim() === text) {
      matchedLabel = candidate;
      break;
    } else {
      // Continue searching next candidate label.
    }
  }

  // Check if a matching label was found.
  if (matchedLabel === undefined) {
    throw new Error(`Label with text "${text}" not found`);
  } else {
    // Label found: proceed to resolve target control.
  }

  const targetId = matchedLabel.htmlFor;
  // Check if the label specifies a valid htmlFor attribute.
  if (!targetId || targetId.trim().length === 0) {
    throw new Error(`Label with text "${text}" does not have a valid htmlFor attribute`);
  } else {
    // Target ID is present; delegate resolution to control().
  }

  return control(targetId);
}

/**
 * Locates a fieldset section element by matching its child legend text.
 *
 * @purpose Finds a fieldset corresponding to a specific settings section name.
 * @inputs text - string - The exact legend text to match (e.g. 'General', 'Appearance').
 * @outputs HTMLFieldSetElement - The matched fieldset element.
 * @dataflow text -> querySelectorAll fieldsets -> match legend textContent -> return HTMLFieldSetElement.
 * @controlflow Iterate over all fieldset elements -> check child legend text -> if matches return fieldset -> if none match throw Error.
 */
function findFieldsetByLegend(text: string): HTMLFieldSetElement {
  const fieldsets = Array.from(
    document.querySelectorAll<HTMLFieldSetElement>('fieldset.kdoc-settings-fieldset'),
  );

  for (let i = 0; i < fieldsets.length; i++) {
    const fs = fieldsets[i];
    // Check if fieldset exists under strict indexing.
    if (fs !== undefined) {
      const legend = fs.querySelector('legend');
      // Check if child legend matches the requested text.
      if (legend !== null && legend.textContent?.trim() === text) {
        return fs;
      } else {
        // Legend text does not match: continue searching.
      }
    } else {
      // Skip undefined fieldset under strict index.
    }
  }

  throw new Error(`Fieldset with legend "${text}" not found`);
}

describe('SettingsDialog and SettingsStore', (): void => {
  describe('the sections that exist', (): void => {
    it('renders exactly five fieldsets with legends General, Editor, Appearance, Proofing, and Export', (): void => {
      mountDialog();
      const fieldsets = Array.from(
        document.querySelectorAll<HTMLFieldSetElement>('fieldset.kdoc-settings-fieldset'),
      );

      // Verify that exactly five fieldset sections are rendered.
      expect(fieldsets.length).toBe(5);

      const expectedLegends = ['General', 'Editor', 'Appearance', 'Proofing', 'Export'];
      const actualLegends = fieldsets.map((fieldset): string | null => {
        const legend = fieldset.querySelector('legend');
        // Check if legend element is present.
        if (legend !== null) {
          return legend.textContent;
        } else {
          return null;
        }
      });

      expect(actualLegends).toEqual(expectedLegends);
    });

    it('ensures no fieldset is empty, containing at least one row element', (): void => {
      mountDialog();
      const fieldsets = Array.from(
        document.querySelectorAll<HTMLFieldSetElement>('fieldset.kdoc-settings-fieldset'),
      );

      // FR-14.14 also names Markdown Style, Files & Links, Review, Export, Shortcuts, Plugins and Advanced,
      // and those are deliberately absent because there are no settings behind them yet — an empty settings tab
      // is a promise the application does not keep.
      for (let i = 0; i < fieldsets.length; i++) {
        const fieldset = fieldsets[i];
        // Check if fieldset exists under strict indexing.
        if (fieldset !== undefined) {
          const rows = fieldset.querySelectorAll('.kdoc-settings-row');
          expect(rows.length).toBeGreaterThan(0);
        } else {
          // Skip undefined entry.
        }
      }
    });
  });

  describe('the replacement table row', (): void => {
    // The Editor section offers the replacement table only when the host can open it.
    it('opens the table from the Editor section when the host supplies an opener', (): void => {
      let opened = 0;
      const dialog = installSettingsDialog({
        doc: document,
        initial: DEFAULT_SETTINGS,
        onChange: (): void => {
          // Not exercised here.
        },
        openReplacements: (): void => {
          opened += 1;
        },
      });
      activeDialogs.push(dialog);
      const edit = [...document.querySelectorAll<HTMLButtonElement>('button.kdoc-settings-button')].find((button) => button.textContent === 'Edit…');
      edit?.click();
      expect(opened).toBe(1);
    });

    // Without an opener there is no button that would do nothing.
    it('leaves the row out without an opener', (): void => {
      mountDialog();
      const labels = [...document.querySelectorAll('label')].map((label) => label.textContent);
      expect(labels).not.toContain('Replacement table');
      expect(labels).not.toContain('Snippet list');
    });

    // The snippet list has its own row and opener.
    it('opens the snippet list from its own row', (): void => {
      let opened = 0;
      activeDialogs.push(installSettingsDialog({
        doc: document,
        initial: DEFAULT_SETTINGS,
        onChange: (): void => {
          // Not exercised here.
        },
        openSnippets: (): void => {
          opened += 1;
        },
      }));
      const label = [...document.querySelectorAll<HTMLLabelElement>('label')].find((l) => l.textContent === 'Snippet list');
      document.getElementById(label?.htmlFor ?? '')?.click();
      expect(opened).toBe(1);
    });
  });

  describe('control types follow the schema', (): void => {
    it('verifies the Theme control is a select with options system, light, and dark', (): void => {
      mountDialog();
      const themeControl = findControlByLabel('Theme');

      expect(themeControl.tagName.toLowerCase()).toBe('select');
      const selectElement = themeControl as HTMLSelectElement;
      const optionValues = Array.from(selectElement.options).map((opt): string => opt.value);
      expect(optionValues).toEqual(['system', 'light', 'dark']);
    });

    it('verifies the Spell check control is a checkbox input', (): void => {
      mountDialog();
      const spellCheckControl = findControlByLabel('Spell check');

      expect(spellCheckControl.tagName.toLowerCase()).toBe('input');
      const inputElement = spellCheckControl as HTMLInputElement;
      expect(inputElement.type).toBe('checkbox');
    });

    it('draws the Spell check control as a switch with a tick handle', (): void => {
      // Pins the Material switch: the checkbox keeps its type, gains role="switch", and sits in a track beside a decorative handle holding the tick icon.
      mountDialog();
      const inputElement = findControlByLabel('Spell check') as HTMLInputElement;
      expect(inputElement.type).toBe('checkbox');
      expect(inputElement.getAttribute('role')).toBe('switch');
      expect(inputElement.parentElement?.classList.contains('kdoc-switch')).toBe(true);
      const handle = inputElement.nextElementSibling;
      expect(handle?.classList.contains('kdoc-switch-handle')).toBe(true);
      expect(handle?.getAttribute('aria-hidden')).toBe('true');
      expect(handle?.querySelector('svg.kdoc-icon')).not.toBeNull();
    });

    it('verifies the Editor font size (px) control is number input with min 8 and max 72', (): void => {
      mountDialog();
      const fontSizeControl = findControlByLabel('Editor font size (px)');

      expect(fontSizeControl.tagName.toLowerCase()).toBe('input');
      const inputElement = fontSizeControl as HTMLInputElement;
      expect(inputElement.type).toBe('number');
      expect(inputElement.min).toBe('8');
      expect(inputElement.max).toBe('72');
    });

    it('verifies the Line height control is number input with min 1 and max 3', (): void => {
      mountDialog();
      const lineHeightControl = findControlByLabel('Line height');

      expect(lineHeightControl.tagName.toLowerCase()).toBe('input');
      const inputElement = lineHeightControl as HTMLInputElement;
      expect(inputElement.type).toBe('number');
      expect(inputElement.min).toBe('1');
      expect(inputElement.max).toBe('3');
    });

    it('verifies the Editor font family control is a text input', (): void => {
      mountDialog();
      const fontControl = findControlByLabel('Editor font family');

      expect(fontControl.tagName.toLowerCase()).toBe('input');
      const inputElement = fontControl as HTMLInputElement;
      expect(inputElement.type).toBe('text');
    });
  });

  describe('changes are immutable and complete', (): void => {
    it('toggles spell check, fires onChange once with flipped value, preserving original object', (): void => {
      const { changes } = mountDialog();
      const spellCheckControl = findControlByLabel('Spell check') as HTMLInputElement;

      const initialSpellCheck = DEFAULT_SETTINGS.proofing.spellCheck;
      expect(spellCheckControl.checked).toBe(initialSpellCheck);

      // Toggle the checkbox state and dispatch a change event.
      spellCheckControl.checked = !initialSpellCheck;
      spellCheckControl.dispatchEvent(new Event('change'));

      // Verify onChange was called exactly once.
      expect(changes.length).toBe(1);

      const latestChange = changes[0];
      // Check if latest change is defined under strict indexing.
      if (latestChange === undefined) {
        throw new Error('Expected at least one change to be recorded');
      } else {
        // Valid change object recorded.
      }

      // Assert proofing.spellCheck is flipped.
      expect(latestChange.proofing.spellCheck).toBe(!initialSpellCheck);

      // Assert other sections are untouched.
      expect(latestChange.general).toEqual(DEFAULT_SETTINGS.general);
      expect(latestChange.editor).toEqual(DEFAULT_SETTINGS.editor);
      expect(latestChange.appearance).toEqual(DEFAULT_SETTINGS.appearance);
      expect(latestChange.proofing.language).toBe(DEFAULT_SETTINGS.proofing.language);

      // The settings object is treated as immutable so a caller can compare old and new
      // by reference to decide what needs re-applying.
      expect(DEFAULT_SETTINGS.proofing.spellCheck).toBe(initialSpellCheck);
    });

    it('changing the theme select fires onChange with the new theme', (): void => {
      const { changes } = mountDialog();
      const themeSelect = findControlByLabel('Theme') as HTMLSelectElement;

      expect(themeSelect.value).toBe(DEFAULT_SETTINGS.appearance.theme);

      // Change select to 'dark' and dispatch change event.
      themeSelect.value = 'dark';
      themeSelect.dispatchEvent(new Event('change'));

      expect(changes.length).toBe(1);

      const latestChange = changes[0];
      // Check if latest change is defined under strict indexing.
      if (latestChange === undefined) {
        throw new Error('Expected at least one change to be recorded');
      } else {
        // Valid change object recorded.
      }

      expect(latestChange.appearance.theme).toBe('dark');
    });
  });

  describe('number inputs reject bad input', (): void => {
    it('rejects empty input without firing onChange and restores previous value', (): void => {
      const { changes } = mountDialog();
      const fontSizeInput = findControlByLabel('Editor font size (px)') as HTMLInputElement;

      const previousValue = String(DEFAULT_SETTINGS.appearance.editorFontSizePx);
      expect(fontSizeInput.value).toBe(previousValue);

      // An empty number input reads as NaN, which would silently corrupt the settings file.
      fontSizeInput.value = '';
      fontSizeInput.dispatchEvent(new Event('change'));

      expect(changes.length).toBe(0);
      expect(fontSizeInput.value).toBe(previousValue);
    });

    it('rejects values exceeding maximum bound without firing onChange and restores previous value', (): void => {
      const { changes } = mountDialog();
      const fontSizeInput = findControlByLabel('Editor font size (px)') as HTMLInputElement;

      const previousValue = String(DEFAULT_SETTINGS.appearance.editorFontSizePx);

      // Setting value to 999 exceeds maximum bound (72).
      fontSizeInput.value = '999';
      fontSizeInput.dispatchEvent(new Event('change'));

      expect(changes.length).toBe(0);
      expect(fontSizeInput.value).toBe(previousValue);
    });

    it('accepts valid in-bounds numeric input and fires onChange', (): void => {
      const { changes } = mountDialog();
      const fontSizeInput = findControlByLabel('Editor font size (px)') as HTMLInputElement;

      fontSizeInput.value = '20';
      fontSizeInput.dispatchEvent(new Event('change'));

      expect(changes.length).toBe(1);

      const latestChange = changes[0];
      // Check if latest change is defined under strict indexing.
      if (latestChange === undefined) {
        throw new Error('Expected at least one change to be recorded');
      } else {
        // Valid change recorded.
      }

      expect(latestChange.appearance.editorFontSizePx).toBe(20);
    });
  });

  describe('search filtering', (): void => {
    it('filters rows and fieldsets by search query and restores them when cleared', (): void => {
      mountDialog();
      const searchInput = document.querySelector<HTMLInputElement>(
        'input.kdoc-settings-search-input',
      );
      // Check if search input was found in the mounted dialog.
      if (searchInput === null) {
        throw new Error('Search input element not found in dialog');
      } else {
        // Search input found.
      }

      const appearanceFieldset = findFieldsetByLegend('Appearance');
      const proofingFieldset = findFieldsetByLegend('Proofing');
      const generalFieldset = findFieldsetByLegend('General');
      const editorFieldset = findFieldsetByLegend('Editor');

      // Type 'theme' into search input and dispatch input event.
      searchInput.value = 'theme';
      searchInput.dispatchEvent(new Event('input'));

      // A section left visible with no visible rows reads as a bug, which is why
      // the fieldset is hidden rather than just its rows.
      expect(appearanceFieldset.hidden).toBe(false);
      expect(proofingFieldset.hidden).toBe(true);
      expect(generalFieldset.hidden).toBe(true);
      expect(editorFieldset.hidden).toBe(true);

      const allRows = Array.from(document.querySelectorAll<HTMLElement>('.kdoc-settings-row'));
      for (let i = 0; i < allRows.length; i++) {
        const row = allRows[i];
        // Check if row exists under strict indexing.
        if (row !== undefined) {
          const label = row.querySelector('label');
          const labelText =
            label !== null && label.textContent !== null ? label.textContent.toLowerCase() : '';
          // Check if the label contains 'theme'.
          if (labelText.includes('theme')) {
            expect(row.hidden).toBe(false);
          } else {
            expect(row.hidden).toBe(true);
          }
        } else {
          // Skip undefined entry.
        }
      }

      // Clearing the search restores every fieldset and row.
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input'));

      const allFieldsets = Array.from(
        document.querySelectorAll<HTMLFieldSetElement>('fieldset.kdoc-settings-fieldset'),
      );
      for (let i = 0; i < allFieldsets.length; i++) {
        const fieldset = allFieldsets[i];
        // Check if fieldset exists under strict indexing.
        if (fieldset !== undefined) {
          expect(fieldset.hidden).toBe(false);
        } else {
          // Skip undefined entry.
        }
      }

      for (let i = 0; i < allRows.length; i++) {
        const row = allRows[i];
        // Check if row exists under strict indexing.
        if (row !== undefined) {
          expect(row.hidden).toBe(false);
        } else {
          // Skip undefined entry.
        }
      }
    });
  });

  describe('setSettings does not loop', (): void => {
    it('updates displayed control values without firing onChange', (): void => {
      const { dialog, changes } = mountDialog();

      const modifiedSettings: KdocSettings = {
        ...DEFAULT_SETTINGS,
        appearance: {
          ...DEFAULT_SETTINGS.appearance,
          theme: 'dark',
          editorFontSizePx: 24,
        },
        proofing: {
          ...DEFAULT_SETTINGS.proofing,
          spellCheck: false,
        },
      };

      // Firing during a programmatic update would loop between the dialog and its owner.
      dialog.setSettings(modifiedSettings);

      const themeSelect = findControlByLabel('Theme') as HTMLSelectElement;
      const fontSizeInput = findControlByLabel('Editor font size (px)') as HTMLInputElement;
      const spellCheckInput = findControlByLabel('Spell check') as HTMLInputElement;

      expect(themeSelect.value).toBe('dark');
      expect(fontSizeInput.value).toBe('24');
      expect(spellCheckInput.checked).toBe(false);

      // Verify no onChange was fired during programmatic synchronization.
      expect(changes.length).toBe(0);
    });
  });

  describe('the settings store', (): void => {
    it('declares SETTINGS_FILE_NAME as settings.json matching the Rust backend', (): void => {
      // The Rust side asserts the same constant, so a rename on one side is caught by the other.
      expect(SETTINGS_FILE_NAME).toBe('settings.json');
    });

    it('reports available as true in jsdom via the localStorage fallback', (): void => {
      const store = createSettingsStore(window);
      expect(store.available).toBe(true);
    });

    it('returns defaults with no problems on a fresh store', async (): Promise<void> => {
      localStorage.clear();
      const store = createSettingsStore(window);

      // A missing file is the normal first-run case, not a problem worth reporting.
      const loaded = await store.load();
      expect(loaded.settings).toEqual(DEFAULT_SETTINGS);
      expect(loaded.problems).toEqual([]);
    });

    it('round-trips modified settings through save and load matching what was saved', async (): Promise<void> => {
      localStorage.clear();
      const store = createSettingsStore(window);

      // Change one field first so the test is not comparing defaults to defaults.
      const modifiedSettings: KdocSettings = {
        ...DEFAULT_SETTINGS,
        appearance: {
          ...DEFAULT_SETTINGS.appearance,
          theme: 'dark',
        },
      };

      await store.save(modifiedSettings);
      const loaded = await store.load();

      expect(loaded.settings).toEqual(modifiedSettings);
    });

    it('never rejects on corrupt data and resolves gracefully to defaults', async (): Promise<void> => {
      localStorage.clear();
      const store = createSettingsStore(window);

      // Settings are a convenience and an editor that refuses to open because a preferences file
      // is malformed has turned a cosmetic problem into a total one.
      localStorage.setItem('kdoc.settings', '{ invalid JSON corrupted content %%%');

      // Assert load() resolves rather than throwing.
      await expect(store.load()).resolves.toBeDefined();

      const loaded = await store.load();
      expect(loaded.settings).toEqual(DEFAULT_SETTINGS);
    });
  });
});
