/**
 * @file keyboard-settings.ts
 * @purpose Parses and validates the "keyboard" section of settings.json (FR-14.16) and serializes it back, kept apart from schema.ts so that file does not grow.
 * @inputs Raw JSON value for the "keyboard" section; a mutable problem list to append diagnostics to; a mutable record to preserve unknown keys.
 * @outputs KeyboardSettings on success or fallback defaults; appended KeyboardProblem diagnostics; preserved `keyboard.*` unknown keys.
 * @functions
 *   - parseKeyboardSection: Validates the raw keyboard section without throwing, falling back to defaults and collecting diagnostics.
 *   - serializeKeyboardSection: Serializes keyboard settings into a plain object with command ids sorted for diff stability (FR-14.15).
 *   - describe: Returns a short human-readable category name for an unknown value in problem messages.
 *   - isRecord: Type guard reporting whether an unknown value is a non-null, non-array JSON object.
 * @dataflow Raw keyboard section → narrow type checks → validate preset and bindings → fallback to defaults on error → frozen KeyboardSettings with diagnostics and preserved keys.
 * @controlflow Return defaults if undefined → reject non-objects with an error → collect unknown keys → validate preset → validate each binding list → freeze and return.
 * @version 1
 * @date 2026-09-15
 */

import { normalizeChord } from './chords.js';
import { KEYMAP_PRESET_IDS, type KeymapPresetId } from './presets.js';

/**
 * The user's keyboard configuration: the active preset plus their own command-to-chord bindings.
 */
export interface KeyboardSettings {
  readonly preset: KeymapPresetId;
  /** The user's own bindings by command id; an empty list unbinds the command. */
  readonly bindings: Readonly<Record<string, readonly string[]>>;
}

/**
 * A single diagnostic produced while validating the keyboard section.
 * Defined locally (not imported from schema.ts) to avoid a module cycle.
 */
export interface KeyboardProblem {
  readonly path: string;
  readonly message: string;
  readonly severity: 'warning' | 'error';
}

/** Default keyboard settings used whenever the section is missing or invalid. */
export const DEFAULT_KEYBOARD_SETTINGS: KeyboardSettings = Object.freeze({
  preset: 'word',
  bindings: Object.freeze({}),
});

/** Known field names inside the "keyboard" section. */
const KEYBOARD_FIELDS: ReadonlySet<string> = new Set(['preset', 'bindings']);

/**
 * Describes an unknown value for use in problem messages.
 *
 * @purpose Renders a short, human-readable category name for an arbitrary received value.
 * @inputs value - The unknown value to describe.
 * @outputs string - A label such as "null", "an array", a quoted string, or a type name.
 * @dataflow Value → type inspection → diagnostic label string.
 * @controlflow Check null → check array → check string → fall back to the type name.
 */
function describe(value: unknown): string {
  // Check whether the value is null; report it by name so callers never see a generic "object".
  if (value === null) {
    return 'null';
  } else if (Array.isArray(value)) {
    // The value is an array; report only that it is an array, not its contents.
    return 'an array';
  } else if (typeof value === 'string') {
    // The value is a string; quote it so the reader sees exactly what was received.
    return JSON.stringify(value);
  } else {
    // Any other primitive or function/symbol: report its type name.
    return typeof value;
  }
}

/**
 * Type guard reporting whether an unknown value is a plain JSON object.
 *
 * @purpose Determines whether an unknown value is a usable JSON record (non-null, non-array object).
 * @inputs value - The unknown value to test.
 * @outputs boolean - True if value is a non-null, non-array object.
 * @dataflow Value → type guard check → boolean result.
 * @controlflow Check typeof is 'object' → check not null → check not Array.isArray → return boolean.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  // Check whether the value is a non-null object that is not an array.
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return true;
  } else {
    // Not a usable JSON object: a primitive, null, or an array.
    return false;
  }
}

/**
 * Parses and validates the "keyboard" section of settings.json (FR-14.16).
 *
 * Never throws on malformed input. Degrades to DEFAULT_KEYBOARD_SETTINGS on error and reports problems.
 * Unknown fields are preserved under dotted paths so a newer version's field survives an older loader.
 * Command ids the app does not know are kept as written for the same reason.
 *
 * @purpose Validates the raw keyboard section without throwing, falling back to defaults and collecting diagnostics.
 * @inputs value - The raw JSON value of the "keyboard" section.
 * @inputs problems - Mutable list that receives a KeyboardProblem for every invalid field or value.
 * @inputs unknownKeys - Mutable record receiving preserved `keyboard.<key>` entries for forward compatibility.
 * @outputs KeyboardSettings - Validated settings, or DEFAULT_KEYBOARD_SETTINGS when the section is unusable.
 * @dataflow Raw value → type checks → validate preset and bindings → fallback to defaults on error → frozen KeyboardSettings.
 * @controlflow Return defaults if undefined → reject non-objects with an error → collect unknown keys → validate preset → validate each binding list → freeze and return.
 */
export function parseKeyboardSection(
  value: unknown,
  problems: KeyboardProblem[],
  unknownKeys: Record<string, unknown>,
): KeyboardSettings {
  // Check whether the whole section is absent; if so, keep every default and report nothing.
  if (value === undefined) {
    return DEFAULT_KEYBOARD_SETTINGS;
  } else {
    // The section is present: validate it below.
  }

  // Check whether the section is a JSON object at all; a non-object makes the entire section unusable.
  if (!isRecord(value)) {
    problems.push({
      path: 'keyboard',
      message: `Expected section "keyboard" to be a JSON object, but received ${describe(value)}.`,
      severity: 'error',
    });
    return DEFAULT_KEYBOARD_SETTINGS;
  } else {
    // The section is an object: read its fields below.
  }

  // Collect unknown fields for forward compatibility without reporting them (a newer version's field must survive).
  for (const key of Object.keys(value)) {
    // Check whether this key is one the current version knows about.
    if (!KEYBOARD_FIELDS.has(key)) {
      // Unknown field: preserve it under a dotted path so an older reader does not drop it.
      unknownKeys[`keyboard.${key}`] = value[key];
    } else {
      // Known field: parsed in the sections below, nothing to preserve here.
    }
  }

  let preset: KeymapPresetId = DEFAULT_KEYBOARD_SETTINGS.preset;
  const rawPreset = value['preset'];

  // Check whether a preset id was supplied and, if so, whether it is one of the known presets.
  if (rawPreset === undefined) {
    // No preset given: keep the default 'word'.
  } else if (typeof rawPreset === 'string' && (KEYMAP_PRESET_IDS as readonly string[]).includes(rawPreset)) {
    // Recognized preset id: select it from the known list.
    preset = KEYMAP_PRESET_IDS.find((id) => id === rawPreset) ?? preset;
  } else {
    // Missing or unrecognized preset id: warn and keep the default 'word'.
    problems.push({
      path: 'keyboard.preset',
      message: `Invalid value ${describe(rawPreset)} for "keyboard.preset". Expected one of: ${KEYMAP_PRESET_IDS.join(', ')}.`,
      severity: 'warning',
    });
  }

  const bindings: Record<string, readonly string[]> = {};
  const rawBindings = value['bindings'];

  // Check whether the user supplied explicit bindings at all.
  if (rawBindings === undefined) {
    // No bindings given: leave every command unbound (the empty map).
  } else if (!isRecord(rawBindings)) {
    // Bindings present but not an object: warn and keep the empty map.
    problems.push({
      path: 'keyboard.bindings',
      message: `Expected "keyboard.bindings" to be a JSON object, but received ${describe(rawBindings)}.`,
      severity: 'warning',
    });
  } else {
    // Bindings are an object of command id → list of shortcuts; validate each entry.
    for (const [command, chords] of Object.entries(rawBindings)) {
      // Check whether the value for this command id is a list of shortcuts.
      if (!Array.isArray(chords)) {
        problems.push({
          path: `keyboard.bindings.${command}`,
          message: `Expected "keyboard.bindings.${command}" to be a list of shortcuts, but received ${describe(chords)}.`,
          severity: 'warning',
        });
      } else {
        // The value is a list; keep the first well-formed occurrence of each normalized chord.
        const kept: string[] = [];
        for (const chord of chords as readonly unknown[]) {
          // Only string entries can be shortcuts; anything else normalizes to null and is dropped.
          const normal = typeof chord === 'string' ? normalizeChord(chord) : null;
          if (normal === null) {
            problems.push({
              path: `keyboard.bindings.${command}`,
              message: `Ignored ${describe(chord)} in "keyboard.bindings.${command}": it is not a shortcut K-Doc can use.`,
              severity: 'warning',
            });
          } else if (!kept.includes(normal)) {
            // First time this normalized chord appears: keep it.
            kept.push(normal);
          } else {
            // Duplicate of an already-kept chord: skip it.
          }
        }
        bindings[command] = Object.freeze(kept);
      }
    }
  }

  // Command ids the app does not know are kept as written so a newer version's command survives an older loader.
  return Object.freeze({ preset, bindings: Object.freeze(bindings) });
}

/**
 * Serializes keyboard settings back into a plain object for JSON output.
 *
 * Bindings are emitted with their command ids sorted so the resulting file diffs cleanly when edited by hand (FR-14.15).
 * An empty binding list is preserved as an empty array, which unbinds the command on reload.
 *
 * @purpose Serializes keyboard settings into a plain object with command ids sorted for diff stability.
 * @inputs keyboard - The validated KeyboardSettings to serialize.
 * @outputs Record<string, unknown> - A { preset, bindings } object ready for JSON.stringify.
 * @dataflow KeyboardSettings → copy bindings in sorted command-id order → assemble result object.
 * @controlflow Iterate sorted command ids → shallow-copy each shortcut list → return preset and bindings.
 */
export function serializeKeyboardSection(keyboard: KeyboardSettings): Record<string, unknown> {
  // Bindings are written sorted by command id so the file diffs cleanly when edited by hand (FR-14.15).
  const bindings: Record<string, readonly string[]> = {};
  for (const id of Object.keys(keyboard.bindings).sort()) {
    // Copy each command's shortcut list into sorted order; an empty list unbinds the command and is preserved as-is.
    bindings[id] = [...(keyboard.bindings[id] ?? [])];
  }

  return { preset: keyboard.preset, bindings };
}
