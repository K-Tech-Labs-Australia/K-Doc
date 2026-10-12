/**
 * @file developer-mode.spec.ts
 * @purpose Developer mode is off by default, read from the settings file when a boolean, and warned about and ignored otherwise; it gates the Fidelity Check, FR-4.5.
 * @inputs Raw JSON strings representing the user's settings file (e.g. '{}' or '{"general":{"developerMode":true}}').
 * @outputs Assertions on DEFAULT_SETTINGS.general.developerMode, parseSettings results (settings, problems, unknownKeys), and serializeSettings round-trip output.
 * @functions
 *   - describe('general.developerMode'): Groups the developer-mode behavior tests.
 *   - it('is off by default'): Asserts the default value is false.
 *   - it('is off when the file does not mention it'): Asserts omission leaves it false with no problems.
 *   - it('reads true from the file'): Asserts a boolean true in the file is honored and known-key clean.
 *   - it('reads false from the file'): Asserts a boolean false in the file is honored.
 *   - it('warns about a non-boolean and keeps it off'): Asserts a non-boolean yields one warning and stays false.
 *   - it('survives a save and reload'): Asserts serializeSettings then parseSettings round-trips true.
 * @dataflow JSON string → parseSettings → LoadedSettings (settings.general.developerMode, problems, unknownKeys) → assertions; settings → serializeSettings → JSON string → parseSettings → assertion.
 * @controlflow Mount describe block → run each it in order: default check, omission check, true read, false read, non-boolean warning, save/reload round-trip.
 * @version 1
 * @date 2026-09-14
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings, serializeSettings } from '../src/index.js';

describe('general.developerMode', () => {
  it('is off by default', (): void => {
    // The setting must start disabled so no user enables it without intent.
    expect(DEFAULT_SETTINGS.general.developerMode).toBe(false);
  });

  it('is off when the file does not mention it', (): void => {
    // An empty settings object omits developerMode, so it must remain at its default.
    expect(parseSettings('{}').settings.general.developerMode).toBe(false);
    // A well-formed empty file must not raise any validation problems.
    expect(parseSettings('{}').problems).toEqual([]);
  });

  it('reads true from the file', (): void => {
    // The file explicitly enables developerMode as a boolean true.
    const loaded = parseSettings('{"general":{"developerMode":true}}');
    // A valid boolean must be honored and kept on.
    expect(loaded.settings.general.developerMode).toBe(true);
    // No validation problems should accompany a well-formed value.
    expect(loaded.problems).toEqual([]);
    // developerMode is a known key, so it must not appear in unknownKeys.
    expect(Object.keys(loaded.unknownKeys)).toEqual([]);
  });

  it('reads false from the file', (): void => {
    // The file explicitly disables developerMode as a boolean false.
    const loaded = parseSettings('{"general":{"developerMode":false}}');
    // A valid boolean false must be honored and kept off.
    expect(loaded.settings.general.developerMode).toBe(false);
  });

  it('warns about a non-boolean and keeps it off', (): void => {
    // The file provides developerMode as the string "yes" instead of a boolean.
    const loaded = parseSettings('{"general":{"developerMode":"yes"}}');
    // An unusable value must fall back to the disabled default rather than crash.
    expect(loaded.settings.general.developerMode).toBe(false);
    // Exactly one problem must be reported for the malformed value.
    expect(loaded.problems).toHaveLength(1);
    // The problem must point at the developerMode path.
    expect(loaded.problems[0]?.path).toBe('general.developerMode');
    // A type mismatch is a warning, not a hard error.
    expect(loaded.problems[0]?.severity).toBe('warning');
  });

  it('survives a save and reload', (): void => {
    // Serialize the parsed settings back to text, then parse that text again.
    const text = serializeSettings(parseSettings('{"general":{"developerMode":true}}').settings);
    // The round-trip must preserve the enabled developerMode value.
    expect(parseSettings(text).settings.general.developerMode).toBe(true);
  });
});
