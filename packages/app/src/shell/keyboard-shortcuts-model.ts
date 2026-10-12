/**
 * @file keyboard-shortcuts-model.ts
 * @purpose Implements the pure data model behind the Keyboard Shortcuts dialog (FR-14.16): it reports which chords are in effect for every remappable command and mutates only the keyboard settings, never touching the DOM.
 * @inputs A KeyboardSettings value holding the active preset and user overrides; a label catalogue mapping command ids to human-readable names/categories; a free-text query; and per-command chord edits requested by the dialog.
 * @outputs Filtered ShortcutRow listings for the dialog, RecordOutcome results describing whether a recorded chord was added or rejected, new KeyboardSettings values after each edit, and a conflict summary string.
 * @functions
 *   - labelFor: Returns a CommandLabel for an id, synthesising one from the id when the catalogue lacks it (module-private helper).
 *   - shortcutRows: Builds the filtered list of ShortcutRow entries shown in the dialog for the given query.
 *   - recordChord: Records a chord for a command, reporting whether it was already bound or taken by another command.
 *   - takeChord: Grants a chord to a command by stripping it from whatever other command currently holds it.
 *   - removeChord: Removes one chord from a single command, reverting it to the preset when that empties its override.
 *   - resetCommand: Drops every user override for a single command, restoring preset defaults.
 *   - resetAll: Clears all user overrides while keeping the active preset.
 *   - choosePreset: Switches the active preset without touching the user's own bindings.
 *   - conflictSummary: Returns a human-readable warning about chords claimed by two commands, or '' when none exist.
 * @dataflow KeyboardSettings + labels + query → resolveKeymap → per-command chord normalisation and conflict detection → ShortcutRow rows; dialog edits → withBinding/withoutChord → new KeyboardSettings.
 * @controlflow Resolve the effective keymap once per call, then either enumerate every command for a filtered listing or apply one mutation through the config helpers; never invoke browser APIs.
 * @version 1
 * @date 2026-09-15
 */

import { KEYMAP_COMMANDS, formatChord, resolveKeymap, withBinding, withoutChord, type KeyboardSettings, type KeymapPresetId } from '@k-doc/config';

export interface CommandLabel { readonly id: string; readonly label: string; readonly category: string; }

export interface ShortcutRow {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  /** Canonical chords in effect. */
  readonly chords: readonly string[];
  /** True when the user's own bindings replace the preset's for this command. */
  readonly changed: boolean;
  /** Chords of this command that another command also claims. */
  readonly conflicts: readonly string[];
}

export type RecordOutcome =
  | { readonly kind: 'added'; readonly next: KeyboardSettings }
  | { readonly kind: 'already' }
  | { readonly kind: 'taken'; readonly by: string; readonly byLabel: string };

/**
 * @purpose Resolves a CommandLabel for a command id, synthesising one from the id when the catalogue does not contain it.
 * @inputs labels - The label catalogue supplied by the dialog. id - The command identifier to look up.
 * @outputs CommandLabel - The matching catalogue entry, or a synthetic { id, label: id, category: <first path segment of id> } otherwise.
 * @dataflow id → labels.find match → either the found label or a derived fallback object.
 * @controlflow Search for an exact id match; return it when present and otherwise derive label and category from the id itself.
 */
function labelFor(labels: readonly CommandLabel[], id: string): CommandLabel {
  const found = labels.find((entry) => entry.id === id);
  if (found !== undefined) {
    // A catalogue entry exists for this command: use it verbatim so labels and categories stay authoritative.
    return found;
  } else {
    // No catalogue entry: derive the label from the id itself and split the category on the first ':' path separator.
    return { id, label: id, category: id.slice(0, id.indexOf(':')) };
  }
}

/**
 * @purpose Builds the list of ShortcutRow entries shown in the Keyboard Shortcuts dialog for a free-text query.
 * @inputs keyboard - The active preset and user overrides defining which chords are in effect. labels - The label catalogue used to name each command. query - Free text; an empty string matches every command.
 * @outputs readonly ShortcutRow[] - One row per matching command, ordered by KEYMAP_COMMANDS, with effective chords, change state, and conflict chords.
 * @dataflow KeyboardSettings → resolveKeymap → per-command canonical chords + conflict set → filtered, mapped ShortcutRow list.
 * @controlflow Resolve the keymap once; for each command compute its haystack of searchable text, skip rows that do not match a non-empty query, otherwise push a row describing its chords and conflicts.
 */
export function shortcutRows(keyboard: KeyboardSettings, labels: readonly CommandLabel[], query: string): readonly ShortcutRow[] {
  const map = resolveKeymap(keyboard.preset, keyboard.bindings);
  const conflicted = new Set(map.conflicts.map((conflict) => conflict.chord));
  const needle = query.trim().toLowerCase();
  const rows: ShortcutRow[] = [];
  for (const { id } of KEYMAP_COMMANDS) {
    const chords = map.bindings.get(id) ?? [];
    const { label, category } = labelFor(labels, id);
    // A row matches when the query appears in its label, category, id, or any displayed chord.
    const haystack = [label, category, id, ...chords.map(formatChord)].join(' ').toLowerCase();
    // An empty query is found in every haystack, so it shows every row.
    if (!haystack.includes(needle)) {
      // The query is absent from this row: skip the command.
      continue;
    } else {
      // A match: keep the row and record its effective chords, change state, and conflict chords.
      rows.push({ id, label, category, chords, changed: keyboard.bindings[id] !== undefined, conflicts: chords.filter((chord) => conflicted.has(chord)) });
    }
  }
  return rows;
}

/**
 * @purpose Records a chord for a command and reports whether the chord was already bound to it or claimed by another command.
 * @inputs keyboard - The active preset and user overrides. labels - The label catalogue used to name the competing command when a conflict occurs. commandId - The command receiving the chord. chord - The chord string being recorded.
 * @outputs RecordOutcome - 'added' with new settings, 'already' if this command holds it, or 'taken' naming the current owner otherwise.
 * @dataflow KeyboardSettings → resolveKeymap → per-command chord set + chord→command map → outcome value describing the edit result.
 * @controlflow Reject when the command already holds the chord; reject with ownership when another command holds it; otherwise grant it via withBinding.
 */
export function recordChord(keyboard: KeyboardSettings, labels: readonly CommandLabel[], commandId: string, chord: string): RecordOutcome {
  const map = resolveKeymap(keyboard.preset, keyboard.bindings);
  const mine = map.bindings.get(commandId) ?? [];
  if (mine.includes(chord)) {
    // This command already holds the exact chord: there is nothing to change.
    return { kind: 'already' };
  } else {
    // The chord is not held by this command: find whoever currently claims it before deciding.
    const holder = map.commandForChord.get(chord);
    // The holder is never this command: a chord it holds was answered as 'already' above.
    if (holder !== undefined) {
      // A different command already owns the chord: report it as taken with the owner's label.
      return { kind: 'taken', by: holder, byLabel: labelFor(labels, holder).label };
    } else {
      // The chord is unclaimed: adopt it into a fresh override set.
      return { kind: 'added', next: { preset: keyboard.preset, bindings: withBinding(keyboard.preset, keyboard.bindings, commandId, [...mine, chord]) } };
    }
  }
}

/**
 * @purpose Grants `chord` to `commandId`, taking it away from whatever other command currently holds it.
 * @inputs keyboard - The active preset and user overrides. commandId - The command that should end up owning the chord. chord - The chord being transferred.
 * @outputs KeyboardSettings - A new settings value where only `commandId` retains the chord; every other claimant is stripped of it.
 * @dataflow KeyboardSettings → resolveKeymap (to learn current owners) → withBinding/withoutChord → merged override set without a DOM write.
 * @controlflow When this command already holds the chord, strip it from all others directly; otherwise first grant it to this command then strip it from every other claimant.
 */
export function takeChord(keyboard: KeyboardSettings, commandId: string, chord: string): KeyboardSettings {
  const mine = resolveKeymap(keyboard.preset, keyboard.bindings).bindings.get(commandId) ?? [];
  if (mine.includes(chord)) {
    // This command already holds the chord: strip it from every other claimant using the current overrides.
    return { preset: keyboard.preset, bindings: withoutChord(keyboard.preset, keyboard.bindings, chord, commandId) };
  } else {
    // This command does not yet hold the chord: grant it first, then strip it from all competing claimants.
    return { preset: keyboard.preset, bindings: withoutChord(keyboard.preset, withBinding(keyboard.preset, keyboard.bindings, commandId, [...mine, chord]), chord, commandId) };
  }
}

/**
 * @purpose Removes one chord from a single command, reverting that command to its preset defaults when the removal empties its override.
 * @inputs keyboard - The active preset and user overrides. commandId - The command whose chord should be removed. chord - The chord string to drop.
 * @outputs KeyboardSettings - New settings where the command's remaining chords are stored, or its override is dropped entirely when it matches the preset.
 * @dataflow KeyboardSettings → resolveKeymap → filtered chord list → withBinding (which drops the override on a default match) → new settings.
 * @controlflow Read this command's effective chords, drop the target chord from that list, and write the remainder back through withBinding.
 */
export function removeChord(keyboard: KeyboardSettings, commandId: string, chord: string): KeyboardSettings {
  const mine = resolveKeymap(keyboard.preset, keyboard.bindings).bindings.get(commandId) ?? [];
  return { preset: keyboard.preset, bindings: withBinding(keyboard.preset, keyboard.bindings, commandId, mine.filter((held) => held !== chord)) };
}

/**
 * @purpose Drops every user override for a single command so it reverts to its preset defaults.
 * @inputs keyboard - The active preset and user overrides. commandId - The command whose override should be removed.
 * @outputs KeyboardSettings - A new settings value with the command's entry deleted from bindings, preserving the preset.
 * @dataflow Current bindings → shallow copy with one key deleted → new settings object.
 * @controlflow Copy the overrides record and delete the target command's key in place; return the copy with the same preset.
 */
export function resetCommand(keyboard: KeyboardSettings, commandId: string): KeyboardSettings {
  const next: Record<string, readonly string[]> = { ...keyboard.bindings };
  delete next[commandId];
  return { preset: keyboard.preset, bindings: next };
}

/**
 * @purpose Clears all user overrides while keeping the active preset so every command returns to its preset defaults.
 * @inputs keyboard - The active preset and user overrides.
 * @outputs KeyboardSettings - A new settings value with an empty bindings record and the same preset.
 * @dataflow Current preset → fresh empty bindings record → new settings object.
 * @controlflow Discard all existing overrides and return a settings object carrying only the unchanged preset.
 */
export function resetAll(keyboard: KeyboardSettings): KeyboardSettings {
  return { preset: keyboard.preset, bindings: {} };
}

/**
 * @purpose Switches the active preset while keeping the user's own bindings, since they were chosen on purpose and should survive a preset change.
 * @inputs keyboard - The current preset and user overrides. preset - The target preset id to activate.
 * @outputs KeyboardSettings - A new settings value with the requested preset and the existing bindings preserved.
 * @dataflow Requested preset + existing bindings → new settings object.
 * @controlflow Replace only the preset field; leave the bindings record untouched so deliberate overrides persist across presets.
 */
export function choosePreset(keyboard: KeyboardSettings, preset: KeymapPresetId): KeyboardSettings {
  return { preset, bindings: keyboard.bindings };
}

/**
 * @purpose Returns a human-readable warning about chords claimed by two commands, or an empty string when there are no conflicts.
 * @inputs keyboard - The active preset and user overrides whose effective keymap is inspected for conflicts.
 * @outputs string - '' when there are none, a singular sentence for one conflict, or a plural sentence for many; the wording notes that self-set bindings win.
 * @dataflow KeyboardSettings → resolveKeymap → conflict count → worded summary string.
 * @controlflow Count conflicts and branch on zero, one, or many to select the appropriate phrasing.
 */
export function conflictSummary(keyboard: KeyboardSettings): string {
  const count = resolveKeymap(keyboard.preset, keyboard.bindings).conflicts.length;
  if (count === 0) {
    // No conflicts exist: return an empty string so the dialog can hide any warning area.
    return '';
  } else if (count === 1) {
    // Exactly one conflict: use singular phrasing and reference the single self-set binding.
    return '1 shortcut is claimed by two commands; the one you set yourself wins.';
  } else {
    // More than one conflict: use plural phrasing and reference all self-set bindings.
    return `${count} shortcuts are claimed by two commands; the ones you set yourself win.`;
  }
}