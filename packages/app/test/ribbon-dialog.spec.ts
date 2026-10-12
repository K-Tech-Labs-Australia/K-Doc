// @vitest-environment jsdom
/**
 * @file ribbon-dialog.spec.ts
 * @purpose Exercises installRibbonDialog, a native <dialog> modal for rearranging the customisable ribbon (FR-14.17), under jsdom via vitest; covers open/close lifecycle, tab switching, command removal/reordering/unknown display, add controls, apply/cancel/reset semantics and teardown.
 * @inputs The installRibbonDialog controller plus module-scoped fakes for KdocCommand catalogue and RibbonTabSetting layout wired through mount().
 * @outputs DOM assertions over dialog.kdoc-ribbon-dialog structure; the `applied` variable capturing what onApply received across apply/cancel/reset scenarios.
 * @functions
 *   - fakeCommand: Builds a minimal KdocCommand with default Format category and always-on behaviour.
 *   - mount: Resets module state, installs the dialog against fakes, records it for afterEach teardown and returns the controller.
 *   - buttonsNamed: Returns every button whose trimmed textContent equals the given label.
 *   - rowText: Returns the trimmed text of each command-row span in document order.
 *   - firstSelect: Returns the first select element or throws so a broken test fails loudly.
 * @dataflow mount() installs dialog -> open() renders working layout -> click handlers mutate working via pure edits -> render rebuilds DOM -> assertions read resulting textContent/classes; apply/cancel/reset drive onApply and isOpen state.
 * @controlflow Each it mounts fresh, opens the modal, drives button/select interactions, then asserts DOM or applied state; afterEach destroys any live controller to isolate tests.
 * @version 1
 * @date 2026-09-18
 */

import { afterEach, describe, expect, it } from 'vitest';
import { installRibbonDialog, type RibbonDialog } from '../src/shell/ribbon-dialog.js';
import type { KdocCommand } from '../src/shell/command-registry.js';
import type { RibbonTabSetting } from '@k-doc/config';

function fakeCommand(id: string, label: string): KdocCommand {
  // A minimal command with the default Format category and always-on behaviour for layout fakes.
  return { id, label, category: 'Format', shortcut: '', run: (): boolean => true, isEnabled: (): boolean => true };
}

const COMMANDS: readonly KdocCommand[] = [
  fakeCommand('format:bold', 'Bold'),
  fakeCommand('format:italic', 'Italic'),
  fakeCommand('format:code', 'Code'),
];

const LAYOUT: readonly RibbonTabSetting[] = [
  { tab: 'Home', groups: [{ title: 'Text', commands: ['format:bold', 'format:italic'] }] },
  { tab: 'Insert', groups: [{ title: 'Blocks', commands: ['format:code'] }] },
];

// The arrangement onApply receives; null means the host has not been asked to apply yet.
let applied: readonly RibbonTabSetting[] | null = null;
// The live controller so afterEach can tear it down and tests can open/inspect it.
let active: RibbonDialog | null = null;
// The layout read by layout() on each open(); reassigned per test before opening.
let current: readonly RibbonTabSetting[] = LAYOUT;

function mount(): RibbonDialog {
  // Reset shared state, install against the fakes, and record the controller for teardown.
  applied = null;
  current = LAYOUT;
  active = installRibbonDialog({
    doc: document,
    layout: () => current,
    commands: () => COMMANDS,
    onApply: (layout): void => {
      // Capture the settled arrangement for assertions.
      applied = layout;
    },
  });
  return active;
}

afterEach((): void => {
  // Tear down any live controller so tests stay isolated and DOM does not leak between them.
  if (active !== null) {
    active.destroy();
    active = null;
  } else {
    // No live controller: nothing to tear down this test.
  }
});

function buttonsNamed(text: string): HTMLButtonElement[] {
  // Every button whose trimmed textContent equals the given label, narrowed from the generic node list.
  return Array.from(document.querySelectorAll('button')).filter(
    (element): element is HTMLButtonElement =>
      element instanceof HTMLButtonElement && element.textContent?.trim() === text,
  );
}

function rowText(): string[] {
  // The trimmed label of each command-row span in document order.
  return Array.from(document.querySelectorAll('.kdoc-ribbon-dialog-command span'))
    .map((span) => (span.textContent ?? '').trim())
    .filter((value) => value !== '');
}

function firstSelect(): HTMLSelectElement {
  // The first select element, throwing loudly if the structure broke so a test fails instead of passing silently.
  const select = document.querySelector('select');
  if (select instanceof HTMLSelectElement) {
    return select;
  } else {
    throw new Error('no select');
  }
}

describe('installRibbonDialog', () => {
  it('is closed until opened', () => {
    // The freshly installed dialog reports not open and the document holds exactly one modal element.
    mount();
    expect(active?.isOpen).toBe(false);
    expect(document.querySelectorAll('dialog.kdoc-ribbon-dialog').length).toBe(1);
  });

  it('shows the arrangement when opened', () => {
    // Opening reveals both tab buttons and the Home group's two commands in order.
    const dialog = mount();
    dialog.open();
    expect(dialog.isOpen).toBe(true);
    const tabTexts = Array.from(document.querySelectorAll('.kdoc-ribbon-dialog-tab')).map(
      (tab) => tab.textContent ?? '',
    );
    expect(tabTexts).toEqual(['Home', 'Insert']);
    expect(rowText()).toEqual(['Format Bold', 'Format Italic']);
  });

  it('shows a missing command by its id with unknown styling', () => {
    // A group referencing an absent build shows the raw id on a span carrying the unknown class.
    const dialog = mount();
    current = [{ tab: 'Home', groups: [{ title: 'Text', commands: ['format:bold', 'format:ghost'] }] }];
    dialog.open();
    expect(rowText()).toContain('format:ghost');
    const spans = Array.from(document.querySelectorAll('.kdoc-ribbon-dialog-command span')).map((span) => ({
      text: span.textContent ?? '',
      isUnknown: span.classList.contains('kdoc-ribbon-dialog-unknown'),
    }));
    expect(spans.find((entry) => entry.text === 'format:ghost')?.isUnknown).toBe(true);
  });

  it('shows a tab groups when its tab is clicked', () => {
    // Selecting the second tab swaps the command listing to that tab's single command.
    const dialog = mount();
    dialog.open();
    buttonsNamed('Insert')[0]?.click();
    expect(rowText()).toEqual(['Format Code']);
  });

  it('drops a row when Remove is clicked', () => {
    // Removing the first listed command leaves only its neighbour in that group.
    const dialog = mount();
    dialog.open();
    buttonsNamed('Remove')[0]?.click();
    expect(rowText()).toEqual(['Format Italic']);
  });

  it('moves a row down when Down is clicked', () => {
    // The first command's Down control swaps its order with the following command.
    const dialog = mount();
    dialog.open();
    const downButtons = Array.from(document.querySelectorAll('.kdoc-ribbon-dialog-command button')).filter(
      (element): element is HTMLButtonElement => element.textContent?.trim() === 'Down',
    );
    downButtons[0]?.click();
    expect(rowText()).toEqual(['Format Italic', 'Format Bold']);
  });

  it('offers only commands not already present in the select', () => {
    // The add control lists a placeholder plus exactly the one command this group does not hold.
    const dialog = mount();
    dialog.open();
    const options = Array.from(firstSelect().options).map((option) => option.textContent ?? '');
    expect(options).toEqual(['Add a command…', 'Format Code']);
  });

  it('adds the chosen command to the group', () => {
    // Selecting and adding Appends the selected command so it appears in the listing.
    const dialog = mount();
    dialog.open();
    firstSelect().value = 'format:code';
    buttonsNamed('Add')[0]?.click();
    expect(rowText()).toContain('Format Code');
  });

  it('adds nothing when the placeholder is chosen', () => {
    // Leaving the select on its placeholder and adding leaves the listing unchanged.
    const dialog = mount();
    dialog.open();
    const before = rowText();
    firstSelect().value = '';
    buttonsNamed('Add')[0]?.click();
    expect(rowText()).toEqual(before);
  });

  it('hands back the arrangement and closes on Apply', () => {
    // After removing a command, Apply returns the edited arrangement to the host and dismisses the modal.
    const dialog = mount();
    dialog.open();
    buttonsNamed('Remove')[0]?.click();
    buttonsNamed('Apply')[0]?.click();
    expect(applied).not.toBeNull();
    expect(applied?.[0]?.groups[0]?.commands.length).toBe(1);
    expect(dialog.isOpen).toBe(false);
  });

  it('hands back nothing on Cancel', () => {
    // Cancel discards edits: the host receives no arrangement and the modal closes.
    const dialog = mount();
    dialog.open();
    buttonsNamed('Remove')[0]?.click();
    buttonsNamed('Cancel')[0]?.click();
    expect(applied).toBeNull();
    expect(dialog.isOpen).toBe(false);
  });

  it('hands back an empty arrangement when K-Doc ribbon is chosen then Applied', () => {
    // Resetting to the built-in ribbon clears working so Apply returns an empty array signalling that choice.
    const dialog = mount();
    dialog.open();
    buttonsNamed("Use K-Doc's ribbon")[0]?.click();
    buttonsNamed('Apply')[0]?.click();
    expect(applied).toEqual([]);
  });

  it('restarts from the given layout on a second open', () => {
    // A cancelled edit is discarded so reopening starts again from the original arrangement.
    const dialog = mount();
    dialog.open();
    buttonsNamed('Remove')[0]?.click();
    buttonsNamed('Cancel')[0]?.click();
    dialog.open();
    expect(rowText()).toEqual(['Format Bold', 'Format Italic']);
  });

  it('removes the dialog from the document on destroy', () => {
    // Destroy detaches the modal element so no dialog.kdoc-ribbon-dialog remains.
    const dialog = mount();
    dialog.destroy();
    // Cleared so afterEach does not destroy the same dialog twice.
    active = null;
    expect(document.querySelector('dialog.kdoc-ribbon-dialog')).toBeNull();
  });

  it('reports when there are no tabs to arrange', () => {
    // An empty arrangement shows a placeholder in the groups region instead of an empty listing.
    const dialog = mount();
    current = [];
    dialog.open();
    expect(document.querySelector('.kdoc-ribbon-dialog-groups')?.textContent).toContain('No tabs to arrange.');
  });

  // It reopens on the first tab no matter which tab it was left open on last time.
  it('it opens on the first tab however it was left', () => {
    const dialog = mount();
    // Opening lands on the Home tab, showing its two commands as one row each.
    dialog.open();
    expect(rowText()).toEqual(['Format Bold', 'Format Italic']);
    // Switching to Insert shows only that group's single command.
    buttonsNamed('Insert')[0]?.click();
    expect(rowText()).toEqual(['Format Code']);
    // Leaving via Cancel and reopening returns to the first tab, not where it was left.
    buttonsNamed('Cancel')[0]?.click();
    dialog.open();
    expect(rowText()).toEqual(['Format Bold', 'Format Italic']);
  });

  // Switching tabs rebuilds the strip rather than appending another copy of it.
  it('switching tabs redraws the strip rather than adding to it', () => {
    const dialog = mount();
    // Both tabs are drawn from the first render onwards.
    dialog.open();
    expect(document.querySelectorAll('.kdoc-ribbon-dialog-tab').length).toBe(2);
    // Switching to Insert redraws the strip: still two buttons, not four.
    buttonsNamed('Insert')[0]?.click();
    expect(document.querySelectorAll('.kdoc-ribbon-dialog-tab').length).toBe(2);
  });

  // The group region is redrawn rather than appended to, so each command appears once per row.
  it('the group region is redrawn rather than added to', () => {
    const dialog = mount();
    dialog.open();
    // Collapsing the first Down control reflows the group instead of stacking another set of rows.
    buttonsNamed('Down')[0]?.click();
    expect(rowText().length).toBe(2);
  });
});
