// @vitest-environment jsdom

/**
 * @file command-palette.spec.ts
 * @purpose Vitest test suite for K-Doc's command palette modal dialog and central command registry (@k-doc/app).
 *   Validates command catalogue construction, fuzzy subsequence filtering, DOM list rendering, keyboard navigation,
 *   active selection tracking, caret-dependent applicability reflection, command execution, and lifecycle teardown under jsdom.
 * @inputs Markdown test fixtures, DocumentSession instances, ProseMirrorBinding views, synthetic DOM click/input/keydown events, and live KdocCommand definitions.
 * @outputs Vitest assertions verifying command metadata, uniqueness, filtering stability, ARIA combobox attributes (aria-activedescendant, aria-disabled, role), modal dialog visibility, and command execution callbacks.
 * @functions
 *   - mountRegistry: Creates a DOM mount container, initializes a DocumentSession and ProseMirrorBinding, and constructs a command registry with spy recorders.
 *   - mountPalette: Instantiates and attaches a CommandPalette controller with recorded lifecycle teardown.
 *   - paletteInput: Queries the command palette search input element (.kdoc-command-palette-input), throwing a clear error if missing.
 *   - paletteOptions: Queries all command palette option elements (.kdoc-command-palette-option) narrowed to HTMLElement.
 * @dataflow Markdown fixtures -> DocumentSession & ProseMirrorBinding -> buildCommandRegistry -> installCommandPalette -> DOM input/keydown events -> filtered options & action execution.
 * @controlflow Mount DOM elements & controllers -> execute test assertions across command registry, filterCommands subsequence matching, and palette DOM lifecycle -> tear down active palettes, bindings, and mounts in afterEach.
 * @version 15
 * @date 2026-10-06
 */

import { describe, expect, it, afterEach } from 'vitest';
import { DocumentSession } from '@k-doc/core';
import { ProseMirrorBinding } from '@k-doc/editor';
import { installCommandPalette, type CommandPalette } from '../src/shell/command-palette.js';
import { buildCommandRegistry, filterCommands, type KdocCommand } from '../src/shell/command-registry.js';

let activeMounts: HTMLElement[] = [];
let activeBindings: ProseMirrorBinding[] = [];
let activePalettes: CommandPalette[] = [];

afterEach(() => {
  for (let i = 0; i < activePalettes.length; i++) {
    const palette = activePalettes[i];
    // Check if palette controller is defined under strict indexing.
    if (palette !== undefined) {
      // Destroy active palette controller.
      palette.destroy();
    } else {
      // Undefined palette controller.
    }
  }
  activePalettes = [];

  for (let i = 0; i < activeBindings.length; i++) {
    const binding = activeBindings[i];
    // Check if editor binding is defined under strict indexing.
    if (binding !== undefined) {
      // Destroy active ProseMirror binding.
      binding.destroy();
    } else {
      // Undefined binding.
    }
  }
  activeBindings = [];

  for (let i = 0; i < activeMounts.length; i++) {
    const mount = activeMounts[i];
    // Check if mount element is defined and attached to parent DOM node.
    if (mount !== undefined && mount.parentNode !== null) {
      // Detach mount element from document body.
      mount.parentNode.removeChild(mount);
    } else {
      // Mount already detached or undefined.
    }
  }
  activeMounts = [];

  // Detach any lingering dialog elements attached to document.body.
  const lingeringDialogs = document.body.querySelectorAll('dialog.kdoc-command-palette-dialog');
  for (let i = 0; i < lingeringDialogs.length; i++) {
    const dialog = lingeringDialogs[i];
    // Check if dialog element is defined and attached to parent DOM node.
    if (dialog !== undefined && dialog.parentNode !== null) {
      // Detach dialog element from document body.
      dialog.parentNode.removeChild(dialog);
    } else {
      // Dialog already detached or undefined.
    }
  }
});

/**
 * Instantiates a DocumentSession, ProseMirrorBinding, and builds a command registry with spy recorders.
 *
 * @purpose Allocates a mount DOM container, initializes session and editor binding, and returns live commands with callback spy recorder.
 * @inputs markdown - Raw Markdown source string used to initialize the document session.
 * @outputs Object containing readonly commands array and recorded dependency calls array.
 * @dataflow markdown -> DocumentSession -> ProseMirrorBinding -> buildCommandRegistry -> return harness record.
 * @controlflow Create mount div -> append to body -> initialize session and focus wysiwyg pane -> create ProseMirrorBinding -> build command registry with recording dependency closures -> register for teardown -> return record.
 */
function mountRegistry(markdown: string): { commands: readonly KdocCommand[]; calls: string[] } {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  activeMounts.push(mount);

  const session = new DocumentSession(markdown);
  session.focusPane('wysiwyg');

  const binding = new ProseMirrorBinding({ session, mount });
  activeBindings.push(binding);

  const calls: string[] = [];
  const commands = buildCommandRegistry({
    view: binding.view,
    newDocument: (): void => {
      calls.push('newDocument');
    },
    closeDocument: (): void => {
      calls.push('closeDocument');
    },
    nextDocument: (): void => {
      calls.push('nextDocument');
    },
    openDocument: (): void => {
      calls.push('openDocument');
    },
    saveDocument: (): void => {
      calls.push('saveDocument');
    },
    saveDocumentAs: (): void => {
      calls.push('saveDocumentAs');
    },
    exportHtml: (): void => {
      calls.push('exportHtml');
    },
    printDocument: (): void => {
      calls.push('printDocument');
    },
    zoomIn: (): void => {
      calls.push('zoomIn');
    },
    zoomOut: (): void => {
      calls.push('zoomOut');
    },
    zoomReset: (): void => {
      calls.push('zoomReset');
    },
    openSettings: (): void => {
      calls.push('openSettings');
    },
    openKeyboardShortcuts: (): void => {
      calls.push('openKeyboardShortcuts');
    },
    openAbout: (): void => {
      calls.push('openAbout');
    },
    goBack: (): void => {
      calls.push('goBack');
    },
    goForward: (): void => {
      calls.push('goForward');
    },
    cycleRibbon: (): void => {
      calls.push('cycleRibbon');
    },
    customiseRibbon: (): void => {
      calls.push('customiseRibbon');
    },
    showGraph: (): void => {
      calls.push('showGraph');
    },
    openVault: (): void => {
      calls.push('openVault');
    },
    openDocumentBeside: (): void => {
      calls.push('openDocumentBeside');
    },
    exportThroughPlugin: (): void => {
      calls.push('exportThroughPlugin');
    },
    reloadPlugins: (): void => {
      calls.push('reloadPlugins');
    },
    setViewMode: (): void => {
      calls.push('setViewMode');
    },
    toggleTheme: (): void => {
      calls.push('toggleTheme');
    },
    toggleOutline: (): void => {
      calls.push('toggleOutline');
    },
    toggleSyncScroll: (): void => {
      calls.push('toggleSyncScroll');
    },
    toggleStatusBar: (): void => {
      calls.push('toggleStatusBar');
    },
    openFind: (): void => {
      calls.push('openFind');
    },
    pageSetup: (): void => {},
    pasteSpecial: (): void => {},
    quickOpen: (): void => {
      // Not exercised here.
    },
    setColumnWidth: (): void => {
      // Not exercised here.
    },
    toggleFold: (): void => {},
    toggleRightPanel: (): void => {},
    openReplacements: (): void => {},
    openSnippets: (): void => {},
    splitAtHeading: (): void => {},
    mergeDocument: (): void => {},
    takeSnapshot: (): void => {},
    convertToReferenceLinks: (): void => {},
    showLinkDefinitions: (): void => {},
    showVersionHistory: (): void => {},
    compareDocuments: (): void => {},
    gitStageFile: (): void => {},
    gitCommitFile: (): void => {},
    toggleFocusParagraph: (): void => {},
    toggleFocusSentence: (): void => {},
    toggleTypewriter: (): void => {},
    toggleZen: (): void => {},
    startPresentation: (): void => {},
    checkGrammar: (): void => {},
    exportDocx: (): void => {},
    exportMarkdown: (): void => {},
    chooseExportTheme: (): void => {},
    reportUnusedAttachments: (): void => {},
    alignBlocks: (): void => {},
    exportThroughPandoc: (): void => {},
    openExportThemeFolder: (): void => {},
    chooseAppTheme: (): void => {},
    openAppThemeFolder: (): void => {},
    chooseSpellingLanguage: (): void => {},
    importDocument: (): void => {},
    bundleAnnotations: (): void => {},
    toggleSecondaryPane: (): void => {},
    unlockDocument: (): void => {},
    cycleDocumentWidth: (): void => {},
    cycleDocumentDensity: (): void => {},
    clearDocumentDisplay: (): void => {},
    foldAllHeadings: (): void => {},
    unfoldAll: (): void => {},
    insertTableOfContents: (): void => {
      // Not exercised here.
    },
    goTo: (): void => {
      // Not exercised here.
    },
    openRecent: (): void => {
      // Recorded only so the registry can be built; this suite does not open the recent list.
    },
    saveACopy: (): void => {},
    renameDocument: (): void => {},
    revealDocument: (): void => {},
    openStylesGallery: (): void => {
      // Recorded only so the registry can be built; this suite does not open the gallery.
    },
    openListPicker: (): void => {
      // Recorded only so the registry can be built; this suite does not open the gallery.
    },
    openLink: (): void => {
      calls.push('openLink');
    },
    undo: (): void => {
      calls.push('undo');
    },
    redo: (): void => {
      calls.push('redo');
    },
    checkSpelling: (): void => {
      calls.push('checkSpelling');
    },
    toggleSpellCheck: (): void => {
      calls.push('toggleSpellCheck');
    },
    insertImage: (): void => {
      calls.push('insertImage');
    },
    insertTable: (): void => {
      calls.push('insertTable');
    },
    setCodeLanguage: (): void => {
      calls.push('setCodeLanguage');
    },
    showStatistics: (): void => {
      calls.push('showStatistics');
    },
    pasteAsPlainText: (): void => {
      calls.push('pasteAsPlainText');
    },
    copyAsMarkdown: (): void => {
      calls.push('copyAsMarkdown');
    },
    copyAsHtml: (): void => {
      calls.push('copyAsHtml');
    },
    openCommandPalette: (): void => {
      calls.push('openCommandPalette');
    },
    cycleViewMode: (): void => {
      calls.push('cycleViewMode');
    },
    toggleSidebar: (): void => {
      calls.push('toggleSidebar');
    },
    openReplace: (): void => {
      calls.push('openReplace');
    },
    findInVault: (): void => {
      calls.push('findInVault');
    },
    newComment: (): void => {
      calls.push('newComment');
    },
    toggleTrackChanges: (): void => {
      calls.push('toggleTrackChanges');
    },
  });

  return { commands, calls };
}

// Note: jsdom implements <dialog> but showModal may be missing in some versions;
// the palette already falls back to setting open, so the tests exercise whichever path jsdom provides.

/**
 * Installs a CommandPalette instance using the provided commands, registering it for afterEach teardown.
 *
 * @purpose Sets up a CommandPalette controller wired to document and recorded in activePalettes for lifecycle teardown.
 * @inputs commands - Readonly array of KdocCommand instances provided to the palette.
 * @outputs CommandPalette - The installed command palette controller.
 * @dataflow commands -> installCommandPalette -> activePalettes.push -> return controller.
 * @controlflow Install palette with document and commands provider -> record in activePalettes array -> return controller instance.
 */
function mountPalette(commands: readonly KdocCommand[]): CommandPalette {
  const palette = installCommandPalette({ doc: document, commands: () => commands });
  activePalettes.push(palette);
  return palette;
}

/**
 * Queries the command palette search input element from document, throwing a clear error if missing.
 *
 * @purpose Locates the command palette input element, failing fast with a descriptive error if missing.
 * @inputs void.
 * @outputs HTMLInputElement - The matching input DOM element.
 * @dataflow document.querySelector -> null check -> return HTMLInputElement.
 * @controlflow Query input with .kdoc-command-palette-input selector -> check if null -> if null throw Error -> return input element.
 */
function paletteInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('.kdoc-command-palette-input');
  // Check if the command palette input element exists in the DOM.
  if (input === null) {
    // Input element missing: fail fast with clear descriptive error.
    throw new Error('Command palette input element (.kdoc-command-palette-input) not found in document');
  } else {
    // Input element found: return element.
  }
  return input;
}

/**
 * Queries all command palette option elements from document, narrowing each entry to HTMLElement.
 *
 * @purpose Returns an array of HTMLElement option elements currently rendered in the command palette.
 * @inputs void.
 * @outputs HTMLElement[] - Array of matching option elements.
 * @dataflow document.querySelectorAll -> Array.from -> validate each HTMLElement -> return array.
 * @controlflow Query all .kdoc-command-palette-option elements -> convert to array -> check each element is an HTMLElement -> return array.
 */
function paletteOptions(): HTMLElement[] {
  const elements = Array.from(document.querySelectorAll('.kdoc-command-palette-option'));
  const options: HTMLElement[] = [];
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    // Check if element is defined and is an instance of HTMLElement.
    if (el !== undefined && el instanceof HTMLElement) {
      // Element is a valid HTMLElement option: record in collection.
      options.push(el);
    } else {
      // Element missing or not an HTMLElement: fail fast with clear error.
      throw new Error('Command palette option element is not an HTMLElement or is undefined');
    }
  }
  return options;
}

describe('the registry', () => {
  it('contains a Bold command whose id is format:bold and shortcut is Ctrl+B', () => {
    const { commands } = mountRegistry('Sample text.\n');
    const boldCmd = commands.find((cmd) => cmd.id === 'format:bold');
    // Check if format:bold command exists in the registry.
    if (boldCmd === undefined) {
      // Bold command missing: fail fast.
      throw new Error('format:bold command not found in registry');
    } else {
      // Bold command found: assert id and shortcut.
    }
    expect(boldCmd.id).toBe('format:bold');
    expect(boldCmd.shortcut).toBe('Ctrl+B');
  });

  it('registers the commands the keymap dispatches', () => {
    // The shell's keymap runs these by id, so each must exist in the registry.
    const { commands } = mountRegistry('Sample text.\n');
    const ids = commands.map((command) => command.id);
    for (const id of ['find:replace', 'find:in-vault', 'view:command-palette', 'view:cycle-view-mode', 'view:toggle-sidebar', 'review:new-comment', 'review:toggle-track-changes']) {
      expect(ids).toContain(id);
    }
  });

  it('ensures every command has a non-empty id and label, and no two commands share an id', () => {
    const { commands } = mountRegistry('Sample text.\n');
    const ids = new Set<string>();

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      // Check if command at current index is defined under strict indexing.
      if (cmd === undefined) {
        // Command undefined: skip iteration.
        continue;
      } else {
        // Command defined: verify non-empty id and label.
      }
      expect(cmd.id.trim().length).toBeGreaterThan(0);
      expect(cmd.label.trim().length).toBeGreaterThan(0);
      ids.add(cmd.id);
    }

    // A duplicate id would make a later entry unreachable from anything that looks commands up by id.
    expect(ids.size).toBe(commands.length);
  });

  it('reports isEnabled() === false for table commands when caret is not in a table', () => {
    const { commands } = mountRegistry('Plain paragraph outside table.\n');
    const deleteRowCmd = commands.find((cmd) => cmd.id === 'table:delete-row');
    // Check if table:delete-row command exists in the registry.
    if (deleteRowCmd === undefined) {
      // Command missing: fail fast.
      throw new Error('table:delete-row command not found in registry');
    } else {
      // Command present: verify disabled state.
    }

    // This is what greys them out in the palette rather than letting the user pick a command that silently does nothing.
    expect(deleteRowCmd.isEnabled()).toBe(false);
  });

  it('reports isEnabled() === true for format:bold in a plain paragraph', () => {
    const { commands } = mountRegistry('Plain paragraph text.\n');
    const boldCmd = commands.find((cmd) => cmd.id === 'format:bold');
    // Check if format:bold command exists in the registry.
    if (boldCmd === undefined) {
      // Command missing: fail fast.
      throw new Error('format:bold command not found in registry');
    } else {
      // Command present: verify enabled state.
    }

    expect(boldCmd.isEnabled()).toBe(true);
  });

  it('calls setViewMode dependency when running view:split', () => {
    const { commands, calls } = mountRegistry('Sample text.\n');
    const splitCmd = commands.find((cmd) => cmd.id === 'view:split');
    // Check if view:split command exists in the registry.
    if (splitCmd === undefined) {
      // Command missing: fail fast.
      throw new Error('view:split command not found in registry');
    } else {
      // Command present: run and verify calls.
    }

    const result = splitCmd.run();
    expect(result).toBe(true);
    expect(calls).toContain('setViewMode');
  });
});

describe('filterCommands', () => {
  it('returns the whole list for an empty query or a whitespace-only query', () => {
    const { commands } = mountRegistry('Sample text.\n');
    const emptyResult = filterCommands(commands, '');
    expect(emptyResult.length).toBe(commands.length);

    const whitespaceResult = filterCommands(commands, '   \t  ');
    expect(whitespaceResult.length).toBe(commands.length);
  });

  it('matches the Bold command when querying "bold"', () => {
    const { commands } = mountRegistry('Sample text.\n');
    const results = filterCommands(commands, 'bold');
    const boldFound = results.some((cmd) => cmd.id === 'format:bold');
    expect(boldFound).toBe(true);
  });

  it('matches Heading 2 when querying "hed 2" by skipping query whitespace', () => {
    const { commands } = mountRegistry('Sample text.\n');
    const results = filterCommands(commands, 'hed 2');
    const heading2Found = results.some((cmd) => cmd.id === 'format:heading-2');
    expect(heading2Found).toBe(true);
  });

  it('matches nothing when querying "zzzz"', () => {
    const { commands } = mountRegistry('Sample text.\n');
    const results = filterCommands(commands, 'zzzz');
    expect(results.length).toBe(0);
  });

  it('preserves registry order in filtered results', () => {
    const { commands } = mountRegistry('Sample text.\n');
    const results = filterCommands(commands, 'format');
    expect(results.length).toBeGreaterThan(1);

    const resultIds = results.map((cmd) => cmd.id);
    const resultIdSet = new Set(resultIds);
    const expectedIds = commands.filter((cmd) => resultIdSet.has(cmd.id)).map((cmd) => cmd.id);

    // A palette which reshuffles as you type moves the entry you were aiming for out from under the cursor.
    expect(resultIds).toEqual(expectedIds);
  });
});

describe('the palette', () => {
  it('renders one option per command on open() and reflects isOpen state across open() and close()', () => {
    const { commands } = mountRegistry('Sample text.\n');
    const palette = mountPalette(commands);

    expect(palette.isOpen).toBe(false);

    palette.open();
    expect(palette.isOpen).toBe(true);

    const options = paletteOptions();
    expect(options.length).toBe(commands.length);

    palette.close();
    expect(palette.isOpen).toBe(false);
  });

  it('filters rendered options when typing into the input', () => {
    const { commands } = mountRegistry('Sample text.\n');
    const palette = mountPalette(commands);
    palette.open();

    const input = paletteInput();
    input.value = 'bold';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const options = paletteOptions();
    // Matching is fuzzy, so labels holding b-o-l-d in order match too (Sort Column Descending); Bold must rank first.
    expect(options.length).toBeLessThan(commands.length);

    const firstOption = options[0];
    // Check if first filtered option exists under strict indexing.
    if (firstOption === undefined) {
      // Filtered option missing: fail fast.
      throw new Error('Expected filtered option for "bold" to be present');
    } else {
      // Option found: verify text content.
    }
    expect(firstOption.textContent).toContain('Bold');
  });

  it('activates the first option on open with matching aria-activedescendant', () => {
    const { commands } = mountRegistry('Sample text.\n');
    const palette = mountPalette(commands);
    palette.open();

    const input = paletteInput();
    const options = paletteOptions();
    expect(options.length).toBeGreaterThan(0);

    const firstOption = options[0];
    // Check if first option exists under strict indexing.
    if (firstOption === undefined) {
      // First option missing: fail fast.
      throw new Error('Expected first option to be present on palette open');
    } else {
      // First option found: assert aria-activedescendant matches option id.
    }
    expect(input.getAttribute('aria-activedescendant')).toBe(firstOption.id);
  });

  it('moves active option to the second option on ArrowDown keydown event', () => {
    const { commands } = mountRegistry('Sample text.\n');
    const palette = mountPalette(commands);
    palette.open();

    const input = paletteInput();
    const options = paletteOptions();
    expect(options.length).toBeGreaterThan(1);

    const secondOption = options[1];
    // Check if second option exists under strict indexing.
    if (secondOption === undefined) {
      // Second option missing: fail fast.
      throw new Error('Expected second option to be present on palette open');
    } else {
      // Second option found: dispatch keydown and verify active descendant update.
    }

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(input.getAttribute('aria-activedescendant')).toBe(secondOption.id);
  });

  it('renders aria-disabled="true" on options for disabled commands', () => {
    const { commands } = mountRegistry('Plain paragraph outside table.\n');
    const palette = mountPalette(commands);
    palette.open();

    const input = paletteInput();
    input.value = 'delete row';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const options = paletteOptions();
    expect(options.length).toBeGreaterThan(0);

    const option = options[0];
    // Check if option exists under strict indexing.
    if (option === undefined) {
      // Option missing: fail fast.
      throw new Error('Expected option for "delete row" to be present');
    } else {
      // Option found: assert aria-disabled attribute.
    }
    expect(option.getAttribute('aria-disabled')).toBe('true');
  });

  it('runs command and closes palette when clicking an enabled option', () => {
    const { commands, calls } = mountRegistry('Sample text.\n');
    const palette = mountPalette(commands);
    palette.open();

    const input = paletteInput();
    input.value = 'split';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const options = paletteOptions();
    expect(options.length).toBeGreaterThan(0);

    // The query is matched as a subsequence, so other commands whose text happens to spell "split"
    // are listed too. This test is about clicking an option, so it picks the Split command by name
    // rather than assuming which one the filter puts first.
    const option = options.find((candidate) => candidate.textContent?.includes('Split') === true);
    // Check if the Split option was among the filtered options.
    if (option === undefined) {
      // Option missing: fail fast.
      throw new Error('Expected option for "split" to be present');
    } else {
      // Option found: click option and verify execution and palette closure.
    }

    // The palette closes before running, because the editor commands focus the pane as their last act and K-Doc keys its edit lock on focus.
    option.click();
    expect(calls).toContain('setViewMode');
    expect(palette.isOpen).toBe(false);
  });

  it('handles destroy() idempotently without throwing', () => {
    const { commands } = mountRegistry('Sample text.\n');
    const palette = mountPalette(commands);
    palette.open();

    expect(() => {
      palette.destroy();
      palette.destroy();
    }).not.toThrow();
  });
});
