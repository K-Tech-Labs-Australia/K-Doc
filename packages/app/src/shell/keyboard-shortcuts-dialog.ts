/**
 * @file keyboard-shortcuts-dialog.ts
 * @purpose Renders the Keyboard Shortcuts dialog (FR-14.16): a searchable, remappable list of commands with preset selection, chord recording, conflict detection, and per-command reset.
 * @inputs Dialog options carrying the document, live keyboard settings, command labels, and change/recording callbacks; user input into search, preset selection, button clicks, and key presses while recording.
 * @outputs A native <dialog> appended to document.body exposing open/close/isOpen/destroy; emits updated KeyboardSettings via onChange and recording state via onRecording.
 * @functions
 *   - el: Creates a typed element with a class name and optional text content.
 *   - button: Creates an aria-labeled <button> of the given class and label.
 *   - say: Writes live-region status text and toggles its warning colour.
 *   - change: Publishes new settings to the app and redraws this dialog.
 *   - stopRecording: Ends any active chord recording and notifies the app.
 *   - renderRow: Builds a single command row with name, chords, and actions.
 *   - draw: Rebuilds the list from current settings and syncs every control.
 *   - onRecordKey: Handles key presses while recording or claiming a conflicting chord.
 *   - open: Shows the dialog and resets it to a clean state.
 *   - close: Hides the dialog and stops any active recording.
 * @dataflow options.keyboard() → shortcutRows() → rendered rows; user events → model mutators (recordChord/takeChord/removeChord/resetCommand/choosePreset/resetAll) → change() → options.onChange().
 * @controlflow open() shows the dialog and focuses search; key presses are captured on the dialog while recording; each mutation calls change() which redraws; close()/destroy() tear down listeners.
 * @version 3
 * @date 2026-10-04
 */

import { KEYMAP_PRESET_IDS, KEYMAP_PRESET_LABELS, chordFromEvent, formatChord, type KeyboardSettings } from '@k-doc/config';
import { choosePreset, conflictSummary, recordChord, removeChord, resetAll, resetCommand, shortcutRows, takeChord, type CommandLabel, type ShortcutRow } from './keyboard-shortcuts-model.js';

export interface KeyboardShortcutsDialogOptions {
  readonly doc: Document;
  readonly keyboard: () => KeyboardSettings;
  readonly labels: () => readonly CommandLabel[];
  /** Told the complete new keyboard settings after every change. */
  readonly onChange: (next: KeyboardSettings) => void;
  /** Told when recording starts and stops, so the app's own shortcuts stand aside while a key is being chosen. */
  readonly onRecording: (recording: boolean) => void;
}

export interface KeyboardShortcutsDialog { open(): void; close(): void; readonly isOpen: boolean; destroy(): void; }

export const KEYBOARD_SHORTCUTS_STYLES: string = `
dialog.kdoc-shortcuts-dialog {
  width: min(720px, 92vw);
  max-height: 80vh;
  padding: 0;
  border: 0;
  border-radius: var(--kdoc-radius-xl);
  background: var(--kdoc-chrome-glass-tint);
  color: var(--kdoc-chrome-text);
  box-shadow: 0 1px 3px var(--kdoc-chrome-shadow-deeper), 0 4px 8px 3px var(--kdoc-chrome-shadow-dark);
}

dialog.kdoc-shortcuts-dialog::backdrop {
  background: var(--kdoc-chrome-shadow-deeper);
}

.kdoc-shortcuts-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  max-height: 80vh;
  box-sizing: border-box;
}

.kdoc-shortcuts-heading {
  margin: 0;
  font-size: 22px;
  font-weight: 500;
  color: var(--kdoc-chrome-text);
}

.kdoc-shortcuts-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.kdoc-shortcuts-search {
  flex: 1 1 12em;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-md);
  background: transparent;
  color: var(--kdoc-chrome-text);
  font: inherit;
  box-shadow: none;
}

.kdoc-shortcuts-preset {
  padding: 5px 8px;
  border: 0;
  border-radius: var(--kdoc-radius-md);
  background: var(--kdoc-chrome-base);
  color: var(--kdoc-chrome-text);
  font: inherit;
  box-shadow: none;
}

.kdoc-shortcuts-button {
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-pill);
  background: transparent;
  color: var(--kdoc-chrome-text);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 10px;
  cursor: pointer;
  box-shadow: none;
  transition: box-shadow 0.15s ease, text-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.kdoc-shortcuts-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-shortcuts-button:active:not(:disabled) {
  box-shadow: none;
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
}

.kdoc-shortcuts-button:disabled {
  box-shadow: none;
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
  cursor: not-allowed;
}

.kdoc-shortcuts-button:focus-visible,
.kdoc-shortcuts-search:focus-visible,
.kdoc-shortcuts-preset:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
}

.kdoc-shortcuts-status {
  min-height: 18px;
  font-size: 12px;
  color: var(--kdoc-chrome-text-muted);
  font-variant-numeric: tabular-nums;
}

.kdoc-shortcuts-status[data-state="warning"] {
  color: var(--kdoc-emissive-amber);
}

.kdoc-shortcuts-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid var(--kdoc-chrome-glass-edge);
  border-radius: var(--kdoc-radius-md);
  background: var(--kdoc-chrome-base);
  box-shadow: none;
  padding: 4px 8px;
}

.kdoc-shortcuts-list::-webkit-scrollbar {
  width: 8px;
}

.kdoc-shortcuts-list::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

.kdoc-shortcuts-list::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-shortcuts-row {
  display: grid;
  grid-template-columns: minmax(8em, 1fr) minmax(10em, 1.4fr) auto;
  gap: 8px;
  align-items: center;
  padding: 6px 4px;
  border-bottom: 1px solid var(--kdoc-chrome-glass-edge);
}

.kdoc-shortcuts-row:last-child {
  border-bottom: none;
}

.kdoc-shortcuts-row[data-recording="true"] {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-sm);
  outline: 1px solid var(--kdoc-chrome-accent);
}

.kdoc-shortcuts-name {
  font-size: 13px;
  color: var(--kdoc-chrome-text);
  font-weight: 500;
}

.kdoc-shortcuts-category {
  display: block;
  font-size: 11px;
  color: var(--kdoc-chrome-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.kdoc-shortcuts-chords {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  font-size: 12px;
}

.kdoc-shortcuts-chord {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 4px 2px 6px;
  border: 1px solid var(--kdoc-chrome-glass-edge);
  border-radius: var(--kdoc-radius-sm);
  background: var(--kdoc-chrome-raised);
  color: var(--kdoc-chrome-text);
  font-family: monospace;
  font-variant-numeric: tabular-nums;
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-shortcuts-chord[data-conflict="true"] {
  border-color: var(--kdoc-emissive-red);
  color: var(--kdoc-emissive-red);
  box-shadow: 0 0 4px var(--kdoc-emissive-red);
}

.kdoc-shortcuts-chord-remove {
  border: none;
  background: transparent;
  color: var(--kdoc-chrome-text-muted);
  cursor: pointer;
  font: inherit;
  padding: 0 4px;
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-shortcuts-chord-remove:hover {
  color: var(--kdoc-emissive-red);
}

.kdoc-shortcuts-none {
  color: var(--kdoc-chrome-text-muted);
  font-style: italic;
}

.kdoc-shortcuts-actions {
  display: flex;
  gap: 4px;
}

@media (prefers-reduced-motion: reduce) {
  dialog.kdoc-shortcuts-dialog,
  dialog.kdoc-shortcuts-dialog * {
    transition: none !important;
    animation: none !important;
  }
}
`;

/**
 * @purpose Builds the Keyboard Shortcuts dialog, appends it to the document body and wires its controls.
 * @inputs options - Document, live settings and labels, and the change and recording callbacks.
 * @outputs KeyboardShortcutsDialog - open, close, isOpen and destroy.
 * @dataflow Settings → model rows → DOM; control events → model edits → options.onChange.
 * @controlflow Build the DOM once; each event mutates settings or recording state and redraws the list.
 */
export function installKeyboardShortcutsDialog(options: KeyboardShortcutsDialogOptions): KeyboardShortcutsDialog {
  const doc = options.doc;
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  let destroyed = false;
  let rowsAbort: AbortController | null = null;
  let recording: string | null = null; // command id being recorded
  let pendingTake: { readonly commandId: string; readonly chord: string } | null = null; // a chord awaiting "use it here"

  // Create a typed element, assigning its class and optional text content.
  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string = ''): HTMLElementTagNameMap[K] {
    const e = doc.createElement(tag);
    e.className = className;
    if (text !== '') {
      // Non-empty text: set it directly.
      e.textContent = text;
    } else {
      // No text requested: leave the element empty.
    }
    return e;
  }

  // Build an aria-labeled <button> of the given class and label.
  function button(className: string, text: string, label: string): HTMLButtonElement {
    const b = el('button', className, text);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    return b;
  }

  const dialog = doc.createElement('dialog');
  dialog.className = 'kdoc-shortcuts-dialog';
  dialog.setAttribute('aria-labelledby', 'kdoc-shortcuts-heading');
  const body = el('div', 'kdoc-shortcuts-body');
  const heading = el('h2', 'kdoc-shortcuts-heading', 'Keyboard Shortcuts');
  heading.id = 'kdoc-shortcuts-heading';
  const bar = el('div', 'kdoc-shortcuts-bar');
  const search = el('input', 'kdoc-shortcuts-search');
  search.type = 'search';
  search.placeholder = 'Search commands or keys…';
  search.setAttribute('aria-label', 'Search shortcuts');
  const preset = el('select', 'kdoc-shortcuts-preset');
  preset.setAttribute('aria-label', 'Preset');
  for (const id of KEYMAP_PRESET_IDS) {
    // One option per preset, keyed by its id; every preset id has a label.
    const option = el('option', '', KEYMAP_PRESET_LABELS[id]);
    option.value = id;
    preset.append(option);
  }
  const resetAllButton = button('kdoc-shortcuts-button', 'Reset All', 'Reset all shortcuts to the preset');
  const closeButton = button('kdoc-shortcuts-button', 'Close', 'Close');
  bar.append(search, preset, resetAllButton, closeButton);
  const status = el('div', 'kdoc-shortcuts-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const conflicts = el('div', 'kdoc-shortcuts-status');
  conflicts.setAttribute('data-state', 'warning');
  conflicts.dataset['role'] = 'conflicts';
  const list = el('div', 'kdoc-shortcuts-list');
  list.setAttribute('role', 'list');
  body.append(heading, bar, status, conflicts, list);
  dialog.append(body);
  doc.body.append(dialog);

  // Write the live-region status text and toggle its warning colour.
  function say(text: string, warning: boolean): void {
    status.textContent = text;
    if (warning) {
      // Warning state: mark the element so CSS shows it in danger colour.
      status.setAttribute('data-state', 'warning');
    } else {
      // Normal state: clear any previous warning marker.
      status.removeAttribute('data-state');
    }
  }

  // Publish new settings to the app and redraw this dialog.
  function change(next: KeyboardSettings): void {
    options.onChange(next);
    draw();
  }

  // End any active chord recording and tell the app its shortcuts may resume.
  function stopRecording(): void {
    if (recording !== null) {
      // A command is being recorded: clear it and notify listeners.
      recording = null;
      pendingTake = null;
      options.onRecording(false);
    } else {
      // Nothing is being recorded: no state to clear.
    }
  }

  // Build a single command row: name, current chords, and action buttons.
  function renderRow(row: ShortcutRow, rowSignal: AbortSignal): HTMLElement {
    const item = el('div', 'kdoc-shortcuts-row');
    item.setAttribute('role', 'listitem');
    item.dataset['command'] = row.id;
    if (recording === row.id) {
      // This is the command currently being recorded: highlight its row.
      item.setAttribute('data-recording', 'true');
    } else {
      // Not recording this command: leave the marker absent.
    }
    const name = el('div', 'kdoc-shortcuts-name', row.label);
    name.append(el('span', 'kdoc-shortcuts-category', row.category));
    const chords = el('div', 'kdoc-shortcuts-chords');
    if (row.chords.length === 0) {
      // No shortcuts assigned: show a placeholder.
      chords.append(el('span', 'kdoc-shortcuts-none', 'None'));
    } else {
      // At least one chord exists: each is rendered below in the loop.
    }
    for (const chord of row.chords) {
      const chip = el('span', 'kdoc-shortcuts-chord', formatChord(chord));
      chip.dataset['chord'] = chord;
      if (row.conflicts.includes(chord)) {
        // This chord collides with another command: flag it in danger colour.
        chip.setAttribute('data-conflict', 'true');
        chip.title = 'Another command also uses this shortcut';
      } else {
        // No conflict on this chord: leave styling default.
      }
      const remove = button('kdoc-shortcuts-chord-remove', '×', `Remove ${formatChord(chord)} from ${row.label}`);
      remove.addEventListener('click', () => {
        stopRecording();
        change(removeChord(options.keyboard(), row.id, chord));
      }, { signal: rowSignal });
      chip.append(remove);
      chords.append(chip);
    }
    const actions = el('div', 'kdoc-shortcuts-actions');
    // Show "Press keys…" while recording this command so the user knows to press keys; otherwise offer to Add.
    const add = button('kdoc-shortcuts-button', recording === row.id ? 'Press keys…' : 'Add', `Add a shortcut to ${row.label}`);
    add.addEventListener('click', () => {
      if (recording === row.id) {
        // Clicking Add while recording this command cancels the recording.
        stopRecording();
        say('', false);
        draw();
      } else {
        // Start recording this command's shortcut.
        stopRecording();
        recording = row.id;
        options.onRecording(true);
        say(`Press the shortcut for ${row.label}, or Escape to cancel.`, false);
        draw();
      }
    }, { signal: rowSignal });
    const reset = button('kdoc-shortcuts-button', 'Reset', `Reset ${row.label} to the preset`);
    reset.disabled = !row.changed;
    reset.addEventListener('click', () => {
      stopRecording();
      change(resetCommand(options.keyboard(), row.id));
    }, { signal: rowSignal });
    actions.append(add, reset);
    item.append(name, chords, actions);
    return item;
  }

  // Rebuild the list from current settings and sync every control's state.
  // Only reached from open() and live listeners, both of which stop at destroy.
  function draw(): void {
    const keyboard = options.keyboard();
    preset.value = keyboard.preset;
    resetAllButton.disabled = Object.keys(keyboard.bindings).length === 0;
    if (rowsAbort !== null) {
      // A previous render's listeners are still attached: cancel them first.
      rowsAbort.abort();
    } else {
      // No prior render in flight: nothing to abort.
    }
    const controller = new AbortController();
    rowsAbort = controller;
    list.replaceChildren(
      ...shortcutRows(keyboard, options.labels(), search.value).map((row) => renderRow(row, controller.signal))
    );
    // Keep the recording row's Add button focused so the next key goes to the dialog.
    if (recording !== null) {
      list.querySelector<HTMLElement>(`[data-command="${recording}"] .kdoc-shortcuts-actions button`)?.focus();
    } else {
      // Not recording: no row needs focus retention.
    }
    // The conflict line has its own element so a message in the status line never hides it or goes stale.
    conflicts.textContent = conflictSummary(keyboard);
    conflicts.hidden = conflicts.textContent === '';
  }

  // Handle key presses while recording a shortcut or claiming a conflicting chord.
  function onRecordKey(event: KeyboardEvent): void {
    if (recording === null) {
      // Not recording: ignore all keys so normal shortcuts fire.
      return;
    } else {
      // Recording active: this handler owns the key press below.
    }
    if (pendingTake !== null) {
      // A conflicting chord awaits the user's Enter/Escape decision.
      event.preventDefault();
      event.stopPropagation();
      const take = pendingTake;
      if (event.key === 'Enter') {
        // Confirm: assign the conflicting chord to this command.
        stopRecording();
        say(
          `${formatChord(take.chord)} now runs ${options.labels().find((l) => l.id === take.commandId)?.label ?? take.commandId}.`,
          false
        );
        change(takeChord(options.keyboard(), take.commandId, take.chord));
      } else if (event.key === 'Escape') {
        // Decline: drop the pending claim and stop recording, leaving the chord where it was.
        stopRecording();
        say('', false);
        draw();
      } else {
        // Any other key: keep waiting for Enter or Escape.
      }
      return;
    } else {
      // No pending decision: fall through to normal chord handling.
    }
    event.preventDefault();
    event.stopPropagation();
    const commandId = recording;
    if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      // Bare Escape cancels the current recording.
      stopRecording();
      say('', false);
      draw();
      return;
    } else {
      // Not a canceling bare-Escape: fall through to chord handling.
    }
    const chord = chordFromEvent(event);
    if (event.key === 'Control' || event.key === 'Shift' || event.key === 'Alt' || event.key === 'Meta') {
      // Modifier pressed alone: hold and await the completing key.
      return;
    } else {
      // A real key followed a modifier: continue building the chord.
    }
    if (chord === null) {
      // Key is not recordable on its own without a modifier.
      say('Use Ctrl or Alt with a key, or a function key on its own.', true);
      return;
    } else {
      // A valid chord was produced: proceed to record it.
    }
    const keyboard = options.keyboard();
    const label = options.labels().find((l) => l.id === commandId)?.label ?? commandId;
    const outcome = recordChord(keyboard, options.labels(), commandId, chord);
    if (outcome.kind === 'already') {
      // The chord already belongs to this command: nothing to add.
      stopRecording();
      say(`${label} already uses ${formatChord(chord)}.`, false);
      draw();
    } else if (outcome.kind === 'added') {
      // The chord was newly added to this command.
      stopRecording();
      say(`${label}: ${formatChord(chord)} added.`, false);
      change(outcome.next);
    } else {
      // The chord conflicts with another command: defer the decision to the user.
      pendingTake = { commandId, chord };
      say(
        `${formatChord(chord)} is used by ${outcome.byLabel}. Press Enter to use it for ${label} instead, or Escape to keep it there.`,
        true
      );
    }
  }

  // Show the dialog, reset its state, and focus the search field.
  function open(): void {
    if (destroyed) {
      // Dialog has been destroyed: refuse to reopen.
      return;
    } else {
      // Live dialog: proceed to show it.
    }
    search.value = '';
    say('', false);
    draw();
    if (typeof dialog.showModal === 'function') {
      // Native modal supported: use showModal for a backdrop and focus trap.
      dialog.showModal();
    } else {
      // Fallback: open the dialog without modal semantics.
      dialog.setAttribute('open', '');
    }
    search.focus();
  }

  // Hide the dialog and stop any active recording.
  function close(): void {
    stopRecording();
    if (dialog.open) {
      // Dialog is currently open: close it via the supported method.
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        // Fallback: drop the open attribute without modal semantics.
        dialog.removeAttribute('open');
      }
    } else {
      // Dialog already closed: nothing to do.
    }
  }

  search.addEventListener('input', () => {
    stopRecording();
    draw();
  }, { signal });
  preset.addEventListener('change', () => {
    stopRecording();
    const chosen = KEYMAP_PRESET_IDS.find((id) => id === preset.value);
    if (chosen !== undefined) {
      // A known preset was selected: apply it.
      change(choosePreset(options.keyboard(), chosen));
    } else {
      // Unknown preset value: ignore the change.
    }
  }, { signal });
  resetAllButton.addEventListener('click', () => {
    stopRecording();
    change(resetAll(options.keyboard()));
  }, { signal });
  closeButton.addEventListener('click', close, { signal });
  // Capture phase inside the dialog, so a recorded key never reaches the dialog's own Escape-to-close.
  dialog.addEventListener('keydown', onRecordKey, { signal, capture: true });
  dialog.addEventListener('cancel', (event: Event) => {
    if (recording !== null) {
      // Recording in progress: suppress native cancel so it does not close mid-assignment.
      event.preventDefault();
    } else {
      // Not recording: allow the dialog to finish closing.
      stopRecording();
    }
  }, { signal });
  dialog.addEventListener('close', () => {
    // The dialog has finished closing: ensure no recording state lingers.
    stopRecording();
  }, { signal });

  return {
    open,
    close,
    get isOpen(): boolean {
      return dialog.open;
    },
    destroy(): void {
      // Safe to repeat: every step below is idempotent.
      destroyed = true;
      stopRecording();
      if (rowsAbort !== null) {
        // Cancel the last render's listeners before removing DOM.
        rowsAbort.abort();
      } else {
        // No pending render: nothing to abort.
      }
      lifetime.abort();
      dialog.remove();
    },
  };
}
