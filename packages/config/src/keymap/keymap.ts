/**
 * @file keymap.ts
 * @purpose Resolves the bindings in effect from a preset plus user overrides and detects chords bound to multiple commands.
 * @inputs Preset id selecting the default binding set; user KeyBindings overrides keyed by command id.
 * @outputs ResolvedKeymap with per-command chords, chord→command mapping, and any conflicts.
 * @functions
 *   - scopeOf: Returns the scope a command belongs to, or null when its id is unknown.
 *   - resolveKeymap: Merges preset bindings with overrides into a resolved keymap and reports conflicts.
 *   - withBinding: Produces new overrides for a single command's chord change, dropping it when unchanged.
 *   - withoutChord: Removes a chord from every command except the keeper to resolve a conflict.
 * @dataflow Preset + overrides → per-command chord normalization → precedence-ordered claim assignment → conflict collection → ResolvedKeymap.
 * @controlflow Compute base bindings → normalize each command's chords → order commands by override precedence → assign first claimant per chord → collect multi-claimant conflicts.
 * @version 1
 * @date 2026-09-15
 */

import { normalizeChord } from './chords.js';
import { KEYMAP_COMMANDS, presetBindings, type KeyBindings, type KeymapPresetId, type KeymapScope } from './presets.js';

export interface KeymapConflict {
  readonly chord: string;
  /** Every command bound to the chord, the one that gets it first. */
  readonly commands: readonly string[];
}

export interface ResolvedKeymap {
  /** Every remappable command's chords, in KEYMAP_COMMANDS order; a command with none maps to []. */
  readonly bindings: ReadonlyMap<string, readonly string[]>;
  /** Which command a chord runs. */
  readonly commandForChord: ReadonlyMap<string, string>;
  readonly conflicts: readonly KeymapConflict[];
}

/**
 * @purpose Returns the KeymapScope a command belongs to, or null when its id is unknown.
 * @inputs commandId - The command identifier to look up in KEYMAP_COMMANDS.
 * @outputs KeymapScope | null - The scope of the matching command, or null if no command matches.
 * @dataflow commandId → KEYMAP_COMMANDS lookup → optional scope value via nullish coalescing.
 * @controlflow Find the command by id; return its scope when present and null otherwise.
 */
export function scopeOf(commandId: string): KeymapScope | null {
  return KEYMAP_COMMANDS.find((c) => c.id === commandId)?.scope ?? null;
}

/**
 * @purpose Merges a preset's default bindings with user overrides into a resolved keymap and reports chords bound to multiple commands.
 * @inputs preset - The preset id selecting the default binding set. overrides - User changes keyed by command id, each a list of chord strings.
 * @outputs ResolvedKeymap - Per-command chords in KEYMAP_COMMANDS order, a chord→command map giving the first claimant, and any conflicts.
 * @dataflow Preset + overrides → normalized per-command chords → precedence-ordered claim assignment → conflict collection.
 * @controlflow For each command build its canonical chord list; order commands so overrides precede defaults; assign the first command per chord; record every chord with more than one claimant as a conflict.
 */
export function resolveKeymap(preset: KeymapPresetId, overrides: KeyBindings): ResolvedKeymap {
  const base = presetBindings(preset);
  const bindings = new Map<string, readonly string[]>();
  for (const { id } of KEYMAP_COMMANDS) {
    // Prefer the user's override, then the preset default, falling back to no chords.
    const chosen = overrides[id] ?? base[id] ?? [];
    // Chords are compared canonically; one that cannot be read is dropped, and a repeat of the same chord is kept once.
    const chords: string[] = [];
    for (const text of chosen) {
      const chord = normalizeChord(text);
      if (chord !== null && !chords.includes(chord)) {
        // Readable and not yet seen: accept the canonical chord.
        chords.push(chord);
      } else {
        // Unreadable or repeated chord: skip it so it never occupies a slot.
      }
    }
    bindings.set(id, chords);
  }
  // A command the user bound themselves claims its chords before preset bindings do, so a deliberate choice is never lost to a default.
  const order = [...KEYMAP_COMMANDS.filter((c) => overrides[c.id] !== undefined), ...KEYMAP_COMMANDS.filter((c) => overrides[c.id] === undefined)].map((c) => c.id);
  const commandForChord = new Map<string, string>();
  const claimants = new Map<string, string[]>();
  for (const id of order) {
    for (const chord of bindings.get(id) ?? []) {
      const list = claimants.get(chord);
      if (list === undefined) {
        // First command to hold this chord becomes the sole claimant and the canonical mapping.
        claimants.set(chord, [id]);
        commandForChord.set(chord, id);
      } else {
        // Another command already holds it: record this one as a competing claimant.
        list.push(id);
      }
    }
  }
  const conflicts: KeymapConflict[] = [];
  for (const [chord, commands] of claimants) {
    if (commands.length > 1) {
      // More than one command claims this chord: it is a conflict.
      conflicts.push({ chord, commands });
    } else {
      // Exactly one claimant: no conflict to record.
    }
  }
  return { bindings, commandForChord, conflicts };
}

/**
 * @purpose Returns new overrides reflecting a single command's chord change, removing the override when it matches the preset defaults.
 * @inputs preset - The active preset used to determine the command's default bindings. overrides - Current user overrides. commandId - The command being edited. chords - The desired chords for that command.
 * @outputs KeyBindings - A new overrides object with the command updated, or unchanged when it reverts to defaults.
 * @dataflow Preset defaults + requested chords → equality check → override added or removed in a copy of the current overrides.
 * @controlflow Compare requested chords against preset defaults; delete the override when identical so the command reverts to defaults, otherwise store a fresh copy of the chords.
 */
export function withBinding(preset: KeymapPresetId, overrides: KeyBindings, commandId: string, chords: readonly string[]): KeyBindings {
  const base = presetBindings(preset)[commandId] ?? [];
  const next: Record<string, readonly string[]> = { ...overrides };
  // Chords match the preset defaults only when both lists share length and every element is equal in order.
  const same = base.length === chords.length && base.every((chord, index) => chord === chords[index]);
  if (same) {
    // Requested chords match the preset defaults: drop the override so the command reverts to them.
    delete next[commandId];
  } else {
    // Chords differ from defaults: store a copy as the new override.
    next[commandId] = [...chords];
  }
  return next;
}

/**
 * @purpose Removes a chord from every command except one, producing overrides that resolve a conflict in favour of the kept command.
 * @inputs preset - The active preset used to interpret each command's bindings. overrides - Current user overrides. chord - The chord to strip. keep - The command whose binding must survive.
 * @outputs KeyBindings - Overrides with the chord removed from every conflicting command other than keep.
 * @dataflow Resolved keymap → per-command chord scan → withBinding edits for commands holding the chord → merged override set.
 * @controlflow Resolve the current keymap; iterate its bindings and, for each command that is not the keeper yet holds the chord, rebuild its chords without it via withBinding; skip the keeper and non-holders unchanged.
 */
export function withoutChord(preset: KeymapPresetId, overrides: KeyBindings, chord: string, keep: string): KeyBindings {
  const resolved = resolveKeymap(preset, overrides);
  let next = overrides;
  for (const [id, chords] of resolved.bindings) {
    if (id !== keep && chords.includes(chord)) {
      // Not the keeper and still holds the chord: rebuild its bindings without it.
      next = withBinding(preset, next, id, chords.filter((c) => c !== chord));
    } else {
      // Keeper or a command that does not hold the chord: leave its bindings untouched.
    }
  }
  return next;
}
