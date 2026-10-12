/**
 * @file ribbon-dialog.ts
 * @purpose Implements installRibbonDialog, a native <dialog> modal (FR-14.17) in which a reader rearranges the customisable ribbon by reordering groups and commands within each tab. The dialog holds no editing logic of its own: every change is delegated to the pure operations exported from ribbon-editing.ts, so this file only owns DOM construction, rendering driven by working state, focus management, and lifecycle teardown.
 * @inputs RibbonDialogOptions containing the Document context plus layout(), commands() and onApply() provider callbacks; a per-instance id counter shared with confirm-dialog.ts for unique aria-labelledby references.
 * @outputs A RibbonDialog controller exposing open, close, isOpen and destroy alongside RIBBON_DIALOG_STYLES, a static stylesheet reusing the border/radius/elevated tokens from confirm-dialog.ts plus a 50vh scrollable groups region.
 * @functions
 *   - installRibbonDialog: Constructs and mounts the native dialog element, wires reset/cancel/apply buttons and the cancel handler, builds render helpers bound to working state, and returns the RibbonDialog controller.
 *   - commandLabel: Resolves a command id against commands() for display text or falls back to the raw id.
 *   - isKnown: Reports whether commands() holds a given command id.
 *   - render: Rebuilds the tab strip and group/command listings from working state into tabsRow and groupsBox.
 * @dataflow options.layout()/commands() -> working/activeTab state -> render() builds DOM in tabsRow/groupsBox -> user button clicks -> ribbon-editing.ts pure edits produce new working arrays -> render() again; apply/cancel/reset resolve the settled arrangement or dismiss.
 * @controlflow Mount dialog at install time (build once) -> open copies layout into working and shows modal -> click handlers reassign working then call render -> apply snapshots working, closes, calls onApply with close-first ordering matching confirm-dialog.ts -> destroy tears down listeners and DOM node idempotently.
 * @version 3
 * @date 2026-10-04
 */

import type { RibbonTabSetting } from '@k-doc/config';
import type { KdocCommand } from './command-registry.js';
import { addCommand, moveCommand, moveGroup, removeCommand } from './ribbon-editing.js';

export interface RibbonDialogOptions {
  readonly doc: Document;
  /** The arrangement to open with. */
  readonly layout: () => readonly RibbonTabSetting[];
  /** Every command that can be put on the ribbon. */
  readonly commands: () => readonly KdocCommand[];
  /** Called with the arrangement the reader settled on; an empty array means K-Doc's own ribbon. */
  readonly onApply: (layout: readonly RibbonTabSetting[]) => void;
}

export interface RibbonDialog {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  destroy(): void;
}

/**
 * Static stylesheet for the customise ribbon modal dialog, styling the backdrop, container, heading,
 * description, tab strip, group/command listings and action buttons using exclusively authoritative
 * K-Doc design tokens borrowed from confirm-dialog.ts. The groups region is capped at 50vh with a
 * vertical scrollbar so long ribbons stay reachable without growing past the viewport.
 */
export const RIBBON_DIALOG_STYLES: string = `
dialog.kdoc-ribbon-dialog {
  border: 0;
  border-radius: var(--kdoc-radius-xl);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  padding: 20px 24px;
  max-width: 640px;
  width: calc(100% - 32px);
  box-sizing: border-box;
  box-shadow: 0 1px 3px var(--kdoc-chrome-shadow-deeper), 0 4px 8px 3px var(--kdoc-chrome-shadow-dark);
}

dialog.kdoc-ribbon-dialog::backdrop {
  background: var(--kdoc-chrome-shadow-deeper);
}

.kdoc-ribbon-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.kdoc-ribbon-dialog-tabs {
  display: flex;
  gap: 6px;
  padding: 4px;
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-lg);
  box-shadow: none;
}

.kdoc-ribbon-dialog-tab {
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-md);
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
  padding: 6px 12px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  box-sizing: border-box;
  transition: box-shadow 0.15s ease, text-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.kdoc-ribbon-dialog-tab:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-ribbon-dialog-tab:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-ribbon-dialog-tab.is-active,
.kdoc-ribbon-dialog-tab[aria-pressed="true"] {
  font-weight: 700;
  background: var(--kdoc-chrome-accent);
  box-shadow: none;
  color: var(--kdoc-chrome-on-accent);
  border-color: var(--kdoc-chrome-accent);
}

.kdoc-ribbon-dialog-groups {
  max-height: 50vh;
  overflow-y: auto;
  border-radius: var(--kdoc-radius-md);
  padding: 4px;
}

.kdoc-ribbon-dialog-group {
  margin-bottom: 12px;
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-lg);
  box-shadow: var(--kdoc-elevation-raised);
  padding: 12px;
}

.kdoc-ribbon-dialog-group-head,
.kdoc-ribbon-dialog-command {
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-ribbon-dialog-group-head {
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--kdoc-chrome-text);
}

.kdoc-ribbon-dialog-command,
.kdoc-ribbon-dialog-add {
  margin: 0 0 6px 16px;
}

.kdoc-ribbon-dialog-add {
  display: flex;
  gap: 8px;
}

.kdoc-ribbon-dialog-add select {
  min-height: 28px;
  height: 28px;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-md);
  background: transparent;
  box-shadow: none;
  color: var(--kdoc-chrome-text);
  padding: 2px 8px;
  font: inherit;
  font-size: 13px;
  box-sizing: border-box;
}

.kdoc-ribbon-dialog-add select:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-ribbon-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.kdoc-dialog-heading {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 500;
  color: var(--kdoc-chrome-text);
}

.kdoc-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.kdoc-dialog-button {
  min-width: 64px;
  height: 36px;
  padding: 0 18px;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-pill);
  background: transparent;
  color: var(--kdoc-chrome-text);
  font: inherit;
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
  box-sizing: border-box;
  box-shadow: none;
  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;
}

.kdoc-dialog-button:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-dialog-button:active {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
}

.kdoc-dialog-button:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-dialog-button:disabled {
  border-style: dashed;
  color: var(--kdoc-chrome-text-muted);
  background: transparent;
  cursor: not-allowed;
}

.kdoc-dialog-button.kdoc-dialog-button-primary,
.kdoc-dialog-button.kdoc-dialog-button-save,
.kdoc-dialog-button.kdoc-dialog-apply {
  border-color: var(--kdoc-chrome-accent);
  background: var(--kdoc-chrome-accent);
  color: var(--kdoc-chrome-on-accent);
}

.kdoc-dialog-button.kdoc-dialog-button-primary:hover,
.kdoc-dialog-button.kdoc-dialog-button-save:hover,
.kdoc-dialog-button.kdoc-dialog-apply:hover,
.kdoc-dialog-button.kdoc-dialog-button-primary:active,
.kdoc-dialog-button.kdoc-dialog-button-save:active,
.kdoc-dialog-button.kdoc-dialog-apply:active {
  background: color-mix(in srgb, var(--kdoc-chrome-accent) 88%, var(--kdoc-chrome-text));
}

.kdoc-dialog-button.kdoc-dialog-button-primary:disabled,
.kdoc-dialog-button.kdoc-dialog-apply:disabled {
  border-color: var(--kdoc-chrome-edge);
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
}

.kdoc-dialog-button.kdoc-dialog-button-discard {
  color: var(--kdoc-emissive-red);
}

.kdoc-dialog-button:active,
.kdoc-dialog-button[aria-pressed="true"] {
  box-shadow: none;
  color: var(--kdoc-chrome-on-accent);
  background: var(--kdoc-chrome-accent);
  border-color: var(--kdoc-chrome-accent);
  font-weight: 700;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-ribbon-dialog-command .kdoc-dialog-button,
.kdoc-ribbon-dialog-group-head .kdoc-dialog-button {
  min-width: 32px;
  padding: 2px 6px;
}

.kdoc-ribbon-dialog-unknown {
  color: var(--kdoc-chrome-text-muted);
  font-style: italic;
}

.kdoc-ribbon-dialog-groups::-webkit-scrollbar {
  width: 8px;
}

.kdoc-ribbon-dialog-groups::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

.kdoc-ribbon-dialog-groups::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

@media (prefers-reduced-motion: reduce) {
  dialog.kdoc-ribbon-dialog,
  dialog.kdoc-ribbon-dialog * {
    transition: none !important;
    animation: none !important;
  }
}
`;

/** Monotonically increasing counter ensuring unique DOM element IDs across multiple ribbon dialog instances. */
let nextRibbonDialogId = 0;

/**
 * Installs the modal customise-ribbon dialog into the document body, wiring button actions and lifecycle controls.
 *
 * @purpose Constructs, styles, and mounts a native modal dialog element for rearranging the reader's own ribbon arrangement without owning any editing logic of its own.
 * @inputs options - RibbonDialogOptions containing the document context plus layout(), commands() and onApply() provider callbacks.
 * @outputs RibbonDialog - Controller exposing open, close, isOpen and destroy lifecycle methods.
 * @dataflow options.layout()/commands() -> working/activeTab state -> render() builds DOM in tabsRow/groupsBox -> user clicks produce new working arrays via ribbon-editing.ts -> apply snapshots working then closes before calling onApply.
 * @controlflow Create dialog DOM hierarchy once at install time -> configure role, aria attributes and heading -> bind reset/cancel/apply buttons and cancel handler -> append to document body -> return RibbonDialog controller with open/close/isOpen/destroy methods.
 */
export function installRibbonDialog(options: RibbonDialogOptions): RibbonDialog {
  const doc = options.doc;
  const dialogId = ++nextRibbonDialogId;
  const titleId = `kdoc-ribbon-title-${dialogId}`;

  let working: readonly RibbonTabSetting[] = []; // the copy being edited
  let activeTab = 0; // which tab's groups are shown
  let returnFocus: HTMLElement | null = null; // what held focus before opening
  let destroyed = false;

  // Construct native <dialog> element.
  const dialog = doc.createElement('dialog');
  dialog.className = 'kdoc-ribbon-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', titleId);

  // Construct container for dialog content.
  const content = doc.createElement('div');
  content.className = 'kdoc-ribbon-dialog-content';

  const heading = doc.createElement('h3');
  heading.id = titleId;
  heading.textContent = 'Customise Ribbon';
  content.appendChild(heading);

  const description = doc.createElement('p');
  description.textContent =
    'Choose which buttons appear on each tab. Your arrangement is saved with your settings.';
  content.appendChild(description);

  // Construct the per-tab strip that selects which group listing groupsBox shows.
  const tabsRow = doc.createElement('div');
  tabsRow.className = 'kdoc-ribbon-dialog-tabs';
  content.appendChild(tabsRow);

  // Construct the scrollable region holding the active tab's groups and commands.
  const groupsBox = doc.createElement('div');
  groupsBox.className = 'kdoc-ribbon-dialog-groups';
  content.appendChild(groupsBox);

  // Construct dialog action buttons (reset, cancel, apply in order).
  const actions = doc.createElement('div');
  actions.className = 'kdoc-ribbon-dialog-actions';

  const resetButton = doc.createElement('button');
  resetButton.type = 'button';
  resetButton.textContent = "Use K-Doc's ribbon";
  resetButton.className = 'kdoc-dialog-button';
  resetButton.setAttribute('aria-label', "Reset to K-Doc's ribbon");
  resetButton.addEventListener('click', (): void => {
    // Reset clears the working arrangement so Apply stores an empty list, which the shell reads as K-Doc's own ribbon.
    working = [];
    render();
  });
  actions.appendChild(resetButton);

  const cancelButton = doc.createElement('button');
  cancelButton.type = 'button';
  cancelButton.textContent = 'Cancel';
  cancelButton.className = 'kdoc-dialog-button';
  cancelButton.setAttribute('aria-label', 'Cancel changes to ribbon arrangement');
  cancelButton.addEventListener('click', (): void => {
    // Cancel discards the working arrangement without notifying the host.
    close();
  });
  actions.appendChild(cancelButton);

  const applyButton = doc.createElement('button');
  applyButton.type = 'button';
  applyButton.textContent = 'Apply';
  applyButton.className = 'kdoc-dialog-button';
  applyButton.setAttribute('aria-label', 'Apply the arranged ribbon and close dialog');
  applyButton.addEventListener('click', (): void => {
    // Snapshot before closing so a re-entrant render cannot overwrite the settled arrangement.
    const settled = working;
    // Close BEFORE notifying the host, not after: a native <dialog> restores focus to whatever held it
    // before showModal() when it closes, so closing afterwards silently undoes any focus the host sets in
    // its resolution path. The host's onApply call has to be the last thing that runs.
    close();
    options.onApply(settled);
  });
  actions.appendChild(applyButton);

  content.appendChild(actions);
  dialog.appendChild(content);

  // Handle native Escape key dismiss event so focus is released through our own close() path.
  dialog.addEventListener('cancel', (event: Event): void => {
    // Suppress the default action and route dismissal through close(), mirroring confirm-dialog.ts.
    event.preventDefault();
    close();
  });

  // Mount the dialog into the document body.
  doc.body.appendChild(dialog);

  /**
   * Resolves a command id to its display label, falling back to the raw id for commands this build lacks.
   *
   * @purpose Looks up an arrangement's command id in options.commands() and returns "category label", or the id itself when no command matches so unknown entries remain visible and removable.
   * @inputs id - The ribbon command identifier stored in a group's commands list.
   * @outputs string - The formatted display label, or the raw id when it is not present in the catalogue.
   * @dataflow options.commands() -> find matching KdocCommand by id -> interpolate category and label (or fall back to id).
   * @controlflow Search the command list for a match; return the interpolated label on hit, otherwise fall through returning the raw id unchanged.
   */
  function commandLabel(id: string): string {
    // Resolve the matching command from the live catalogue so display text tracks registry updates.
    const command = options.commands().find((candidate) => candidate.id === id);

    if (command !== undefined) {
      // The command exists in this build: show its category and label for a readable caption.
      return `${command.category} ${command.label}`;
    } else {
      // No matching command: surface the raw id so an arrangement referencing a removed command stays visible.
      return id;
    }
  }

  /**
   * Reports whether a command id is present in options.commands().
   *
   * @purpose Answers whether the catalogue holds a given ribbon command identifier, used to flag unknown entries for styling and tooltips.
   * @inputs id - The ribbon command identifier stored in a group's commands list.
   * @outputs boolean - True when at least one command matches the id, false otherwise.
   * @dataflow options.commands() -> some predicate comparing each candidate.id against id.
   * @controlflow Scan the command list; return true on the first match, otherwise fall through returning false after exhausting the catalogue.
   */
  function isKnown(id: string): boolean {
    // A single membership scan suffices since we only need presence, not the matching value.
    return options.commands().some((candidate) => candidate.id === id);
  }

  /**
   * Rebuilds the tab strip and group/command listings from working state into tabsRow and groupsBox.
   *
   * @purpose Clears both containers and re-renders every tab button plus, for the active tab, each group with its commands and an add-command control; when there are no tabs it shows a placeholder instead.
   * @inputs void - reads module-scoped working and activeTab state only.
   * @outputs void - mutates the DOM of tabsRow and groupsBox in place to reflect current state.
   * @dataflow working + activeTab -> per-tab buttons with is-active/aria-current -> per-group heads with up/down controls -> per-command rows with labels, unknown styling and move/remove controls -> add control listing available commands.
   * @controlflow Clear both containers; render a tab button for each entry in working (marking the active one); read working[activeTab] and return early with a placeholder when undefined, otherwise iterate groups then their commands building fresh DOM per row.
   */
  function render(): void {
    // Clear the tab strip before repopulating so stale buttons never linger between renders.
    while (tabsRow.firstChild !== null) {
      tabsRow.removeChild(tabsRow.firstChild);
    }

    // Clear the group/command region before repopulating for the same reason as the tab strip above.
    while (groupsBox.firstChild !== null) {
      groupsBox.removeChild(groupsBox.firstChild);
    }

    // Render one selectable tab button per entry in the working arrangement, tracking its index.
    for (let tabIndex = 0; tabIndex < working.length; tabIndex++) {
      const tab = working[tabIndex];
      // noUncheckedIndexedAccess: guard against a slot that resolved to nothing before rendering it.
      if (tab === undefined) {
        continue;
      } else {
        // The entry exists: build its tab button below.
      }

      const tabButton = doc.createElement('button');
      tabButton.type = 'button';
      tabButton.className = 'kdoc-ribbon-dialog-tab';
      tabButton.textContent = tab.tab;
      tabButton.setAttribute('aria-label', `Show ${tab.tab} tab`);

      // Mark the currently selected tab as active and announce it to assistive technology.
      if (tabIndex === activeTab) {
        tabButton.classList.add('is-active');
        tabButton.setAttribute('aria-current', 'true');
      } else {
        // Not the active tab: leave styling off and do not claim selection.
      }

      // Selecting a tab switches which group listing groupsBox shows, then re-renders to reflect it.
      tabButton.addEventListener('click', (): void => {
        activeTab = tabIndex;
        render();
      });

      tabsRow.appendChild(tabButton);
    }

    // Read the active tab's contents; an out-of-range index resolves to undefined and has nothing to arrange.
    const tab = working[activeTab];

    if (tab === undefined) {
      // No tabs exist yet: show a placeholder rather than an empty region so the intent is clear.
      const placeholder = doc.createElement('p');
      placeholder.textContent = 'No tabs to arrange.';
      groupsBox.appendChild(placeholder);
      return;
    } else {
      // The active tab exists: render its groups and commands below.
    }

    // Render one group block per entry in the active tab, tracking each group's index for move operations.
    for (let groupIndex = 0; groupIndex < tab.groups.length; groupIndex++) {
      const group = tab.groups[groupIndex];
      // noUncheckedIndexedAccess: guard against a slot that resolved to nothing before rendering it.
      if (group === undefined) {
        continue;
      } else {
        // The group exists: build its head and command rows below.
      }

      const groupEl = doc.createElement('div');
      groupEl.className = 'kdoc-ribbon-dialog-group';

      // Construct the group header row carrying the title plus up/down controls for reordering groups.
      const groupHead = doc.createElement('div');
      groupHead.className = 'kdoc-ribbon-dialog-group-head';

      const groupTitle = doc.createElement('span');
      groupTitle.textContent = group.title;
      groupHead.appendChild(groupTitle);

      // Build the "move group up" control, disabled semantics handled by ribbon-editing.ts returning unchanged at bounds.
      const moveGroupUpButton = doc.createElement('button');
      moveGroupUpButton.type = 'button';
      moveGroupUpButton.textContent = 'Up';
      moveGroupUpButton.className = 'kdoc-dialog-button';
      moveGroupUpButton.setAttribute('aria-label', 'Move group up');
      moveGroupUpButton.addEventListener('click', (): void => {
        // Reassign working to the new layout then re-render so the UI reflects the moved group.
        working = moveGroup(working, activeTab, groupIndex, -1);
        render();
      });
      groupHead.appendChild(moveGroupUpButton);

      // Build the "move group down" control mirroring the up button with a +1 delta toward later positions.
      const moveGroupDownButton = doc.createElement('button');
      moveGroupDownButton.type = 'button';
      moveGroupDownButton.textContent = 'Down';
      moveGroupDownButton.className = 'kdoc-dialog-button';
      moveGroupDownButton.setAttribute('aria-label', 'Move group down');
      moveGroupDownButton.addEventListener('click', (): void => {
        // Reassign working to the new layout then re-render so the UI reflects the moved group.
        working = moveGroup(working, activeTab, groupIndex, +1);
        render();
      });
      groupHead.appendChild(moveGroupDownButton);

      groupEl.appendChild(groupHead);

      // Render one command row per entry in the group, tracking each command's index for move/remove operations.
      for (let commandIndex = 0; commandIndex < group.commands.length; commandIndex++) {
        const commandId = group.commands[commandIndex];
        // noUncheckedIndexedAccess: guard against a slot that resolved to nothing before rendering it.
        if (commandId === undefined) {
          continue;
        } else {
          // The command id exists: build its row below.
        }

        const commandEl = doc.createElement('div');
        commandEl.className = 'kdoc-ribbon-dialog-command';

        const commandLabelSpan = doc.createElement('span');
        commandLabelSpan.textContent = commandLabel(commandId);

        // Flag commands absent from this build so the reader can still see and remove them.
        if (!isKnown(commandId)) {
          commandLabelSpan.classList.add('kdoc-ribbon-dialog-unknown');
          commandLabelSpan.setAttribute('title', 'This command is not in this version of K-Doc.');
        } else {
          // The command exists: no unknown styling or tooltip required.
        }

        commandEl.appendChild(commandLabelSpan);

        // Build the "move command up" control, delegating bounds enforcement to moveCommand's pure edit.
        const moveUpButton = doc.createElement('button');
        moveUpButton.type = 'button';
        moveUpButton.textContent = 'Up';
        moveUpButton.className = 'kdoc-dialog-button';
        moveUpButton.setAttribute('aria-label', `Move ${commandLabel(commandId)} up`);
        moveUpButton.addEventListener('click', (): void => {
          // Reassign working to the new layout then re-render so the UI reflects the moved command.
          working = moveCommand(working, activeTab, groupIndex, commandIndex, -1);
          render();
        });
        commandEl.appendChild(moveUpButton);

        // Build the "move command down" control mirroring up with a +1 delta toward later positions.
        const moveDownButton = doc.createElement('button');
        moveDownButton.type = 'button';
        moveDownButton.textContent = 'Down';
        moveDownButton.className = 'kdoc-dialog-button';
        moveDownButton.setAttribute('aria-label', `Move ${commandLabel(commandId)} down`);
        moveDownButton.addEventListener('click', (): void => {
          // Reassign working to the new layout then re-render so the UI reflects the moved command.
          working = moveCommand(working, activeTab, groupIndex, commandIndex, +1);
          render();
        });
        commandEl.appendChild(moveDownButton);

        // Build the "remove command" control delegating deletion to removeCommand's pure edit.
        const removeButton = doc.createElement('button');
        removeButton.type = 'button';
        removeButton.textContent = 'Remove';
        removeButton.className = 'kdoc-dialog-button';
        removeButton.setAttribute('aria-label', `Remove ${commandLabel(commandId)}`);
        removeButton.addEventListener('click', (): void => {
          // Reassign working to the new layout then re-render so the UI reflects the removed command.
          working = removeCommand(working, activeTab, groupIndex, commandIndex);
          render();
        });
        commandEl.appendChild(removeButton);

        groupEl.appendChild(commandEl);
      }

      // Build the add-command control listing commands not already present in this group.
      const addRow = doc.createElement('div');
      addRow.className = 'kdoc-ribbon-dialog-add';

      const select = doc.createElement('select');
      select.setAttribute('aria-label', `Add a command to ${group.title}`);

      // The first option is an empty placeholder prompting the reader to pick a command.
      const placeholderOption = doc.createElement('option');
      placeholderOption.value = '';
      placeholderOption.textContent = 'Add a command…';
      select.appendChild(placeholderOption);

      // Collect commands not already in this group, then sort by display label for stable alphabetical placement.
      const availableCommands: KdocCommand[] = options.commands().filter(
        (candidate) => !group.commands.includes(candidate.id),
      );

      // Sort by the text the reader actually reads, so the list reads alphabetically as it is shown.
      availableCommands.sort((first, second) =>
        `${first.category} ${first.label}`.localeCompare(`${second.category} ${second.label}`),
      );

      for (const command of availableCommands) {
        const option = doc.createElement('option');
        option.value = command.id;
        option.textContent = `${command.category} ${command.label}`;
        select.appendChild(option);
      }

      addRow.appendChild(select);

      // Build the "add" button that appends the selected command to this group.
      const addButton = doc.createElement('button');
      addButton.type = 'button';
      addButton.textContent = 'Add';
      addButton.className = 'kdoc-dialog-button';
      addButton.setAttribute('aria-label', `Add a command to ${group.title}`);
      addButton.addEventListener('click', (): void => {
        // Read the current selection; an empty value means the placeholder is chosen, so do nothing.
        const selectedId = select.value;

        // A mutant that removed this guard survived: addCommand refuses a blank id anyway. It stays because
        // it says why nothing happens, and because it spares the dialog a redraw that would change nothing.
        if (selectedId === '') {
          // Placeholder selected: there is no command to add, leave working untouched.
          return;
        } else {
          // A real command was chosen: append it via the pure edit then re-render.
        }

        working = addCommand(working, activeTab, groupIndex, selectedId);
        render();
      });
      addRow.appendChild(addButton);

      groupEl.appendChild(addRow);
      groupsBox.appendChild(groupEl);
    }
  }

  /**
   * Closes the ribbon dialog if currently open and returns focus to its prior holder.
   *
   * @purpose Dismisses the modal dialog in an idempotent manner across native and test environments, then restores DOM focus to whatever held it before open() so editing resumes where the reader left off.
   * @inputs void - reads module-scoped dialog and returnFocus state only.
   * @outputs void - closes the dialog element when open and refocuses returnFocus if captured.
   * @dataflow dialog.open -> native close()/open=false fallback -> returnFocus.focus() then null out holder.
   * @controlflow Check if dialog is currently open; invoke native close() or set open = false on hit, otherwise no-op; when a focus holder exists call its focus() and clear it, otherwise do nothing.
   */
  function close(): void {
    // Close the dialog only while it is actually open to avoid InvalidStateError from closing twice.
    if (dialog.open) {
      // Native showModal path: use the HTMLDialogElement.close() method when available.
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        // Fallback for test environments lacking showModal: clear the open flag directly.
        dialog.open = false;
      }
    } else {
      // Dialog is already closed: nothing to dismiss, no operation required.
    }

    // Return focus to whatever held it before opening so editing resumes where the reader left off.
    if (returnFocus !== null) {
      returnFocus.focus();
      returnFocus = null;
    } else {
      // No prior focus holder was captured: leave DOM focus wherever close() placed it.
    }
  }

  /**
   * Opens the ribbon dialog, copying the current layout into working state and showing it modally.
   *
   * @purpose Captures the currently focused element for later restoration, loads options.layout() as the starting arrangement, resets to the first tab, renders, then shows the modal (or open fallback) unless already destroyed.
   * @inputs void - reads module-scoped state and options.provider callbacks only.
   * @outputs void - leaves the dialog visible with a freshly rendered layout when not destroyed.
   * @dataflow doc.activeElement -> returnFocus holder -> options.layout() copy into working -> activeTab reset to 0 -> render() builds DOM -> showModal()/open=true fallback shows modal.
   * @controlflow Return immediately if destroyed; otherwise capture focus, load layout, reset tab, render, then branch on showModal availability before showing the dialog.
   */
  function open(): void {
    // A destroyed controller cannot reopen: bail out early to avoid resurrecting detached DOM.
    if (destroyed) {
      return;
    } else {
      // Active controller: proceed with opening below.
    }

    // Capture the currently focused element so close() can restore focus afterwards, tolerating non-element nodes.
    const activeElement = doc.activeElement;

    if (activeElement instanceof HTMLElement) {
      returnFocus = activeElement;
    } else {
      // No meaningful element held focus: there is nothing to refocus on close.
      returnFocus = null;
    }

    // Start editing from the latest arrangement rather than a stale captured copy so repeated opens stay fresh.
    working = options.layout();
    activeTab = 0;
    render();

    // Show modally when supported, falling back to a non-modal open flag for test environments without showModal.
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.open = true;
    }
  }

  /**
   * Destroys the ribbon dialog component, closing it and removing its DOM node from the document body.
   *
   * @purpose Idempotently tears down the controller by marking destroyed, dismissing any open modal via close(), and detaching the dialog element when still attached to a parent.
   * @inputs void - reads module-scoped state only.
   * @outputs void - leaves no visible dialog and marks the controller inert after first call.
   * @dataflow mark destroyed = true -> close() dismisses modal and restores focus -> detachedParent.removeChild(dialog) when present.
   * @controlflow Return immediately if already destroyed for idempotent teardown; otherwise set destroyed, close(), then remove from parent if one exists before returning the controller methods.
   */
  function destroy(): void {
    // Already torn down: return without side effects so repeated destroys stay safe.
    if (destroyed) {
      return;
    } else {
      // Active controller: mark destroyed and proceed with teardown below.
      destroyed = true;
    }

    close();

    const detachedParent = dialog.parentNode;
    if (detachedParent !== null) {
      detachedParent.removeChild(dialog);
    } else {
      // The dialog is already detached from the document: nothing to remove.
    }
  }

  return {
    open,
    close,
    /** Whether the dialog element is currently open. */
    get isOpen(): boolean {
      return dialog.open;
    },
    destroy,
  };
}
