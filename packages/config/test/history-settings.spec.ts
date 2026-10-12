/**
 * @file history-settings.spec.ts
 * @purpose Tests parsing, validation, serialization, and round-tripping of the history settings module.
 * @inputs History section values (unknown), JSON strings for full settings load/serialize cycles.
 * @outputs Parsed HistoryProblem[] problems arrays, serialized history objects, loaded settings structures.
 * @functions
 *   - parse: Wraps parseHistorySection to return a normalized {settings, problems, unknown} result.
 *   - describe('history settings'): Groups all history-settings test cases under one suite.
 * @dataflow Test input value → parse() → parseHistorySection → settings/problems/unknown → expect assertions.
 * @controlflow Suite mounts → each it() runs an isolated parse or round-trip → assertions validate behavior; failures surface as vitest errors.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_HISTORY_SETTINGS, HISTORY_LIMITS, parseHistorySection, serializeHistorySection } from '../src/history/history-settings.js';
import type { HistoryProblem } from '../src/history/history-settings.js';
import { DEFAULT_SETTINGS, parseSettings, serializeSettings } from '../src/settings/schema.js';

// parse wraps parseHistorySection so each test gets a normalized result object with typed problems and unknown keys.
// @purpose Execute the history-section parser against an arbitrary value and bundle its outputs for assertion.
// @inputs value - The raw value under test passed to parseHistorySection.
// @outputs An object containing the parsed settings, the collected HistoryProblem[] array, and the unknown-keys map.
// @dataflow value → parseHistorySection(value, problems, unknown) → {settings, problems, unknown} result bundle.
// @controlflow Initialize empty problems/unknown arrays → invoke parser once → return the assembled result; no branching.
function parse(value: unknown): { settings: ReturnType<typeof parseHistorySection>; problems: HistoryProblem[]; unknown: Record<string, unknown> } {
  const problems: HistoryProblem[] = [];
  const unknown: Record<string, unknown> = {};
  return { settings: parseHistorySection(value, problems, unknown), problems, unknown };
}

describe('history settings', () => {
  // Asserts the default configuration values and that they are shared by DEFAULT_SETTINGS.history.
  it('defaults to snapshots on save every ten minutes, kept 24 hours, 7 days hourly, 90 days daily', () => {
    expect(DEFAULT_HISTORY_SETTINGS).toEqual({ snapshotOnSave: true, snapshotMinutes: 10, keepAllHours: 24, keepHourlyDays: 7, keepDailyDays: 90 });
    expect(DEFAULT_SETTINGS.history).toBe(DEFAULT_HISTORY_SETTINGS);
    expect(parse(undefined)).toEqual({ settings: DEFAULT_HISTORY_SETTINGS, problems: [], unknown: {} });
  });

  // Asserts non-object inputs are rejected with an error problem and a descriptive message.
  it('rejects a section that is not an object', () => {
    const result = parse([1]);
    expect(result.settings).toBe(DEFAULT_HISTORY_SETTINGS);
    expect(result.problems.map((problem) => [problem.path, problem.severity])).toEqual([['history', 'error']]);
    expect(parse('x').problems[0]?.message).toContain('"x"');
    expect(parse(null).problems[0]?.message).toContain('null');
  });

  // Asserts valid values including zero and the boundary limits are accepted with no problems.
  it('reads valid values, including zero and the limits', () => {
    const result = parse({ snapshotOnSave: false, snapshotMinutes: 0, keepAllHours: HISTORY_LIMITS.keepAllHours, keepHourlyDays: 0, keepDailyDays: HISTORY_LIMITS.keepDailyDays });
    expect(result.settings).toEqual({ snapshotOnSave: false, snapshotMinutes: 0, keepAllHours: 8760, keepHourlyDays: 0, keepDailyDays: 36500 });
    expect(result.problems).toEqual([]);
  });

  // Asserts each invalid value yields a warning and the default is retained for that field.
  it('warns and keeps the default for a bad value', () => {
    const result = parse({ snapshotOnSave: 'yes', snapshotMinutes: 1441, keepAllHours: -1, keepHourlyDays: 1.5, keepDailyDays: '90' });
    expect(result.settings).toEqual(DEFAULT_HISTORY_SETTINGS);
    expect(result.problems.map((problem) => [problem.path, problem.severity])).toEqual([
      ['history.snapshotOnSave', 'warning'],
      ['history.snapshotMinutes', 'warning'],
      ['history.keepAllHours', 'warning'],
      ['history.keepHourlyDays', 'warning'],
      ['history.keepDailyDays', 'warning'],
    ]);
    expect(result.problems[1]?.message).toBe('Invalid value number for "history.snapshotMinutes". Expected a whole number from 0 to 1440.');
  });

  // Asserts unknown keys are preserved and serialization emits every field.
  it('keeps unknown keys and serializes every field', () => {
    const result = parse({ future: 1, snapshotMinutes: 5 });
    expect(result.unknown).toEqual({ 'history.future': 1 });
    expect(serializeHistorySection(result.settings)).toEqual({ snapshotOnSave: true, snapshotMinutes: 5, keepAllHours: 24, keepHourlyDays: 7, keepDailyDays: 90 });
  });

  // Asserts a full load/serialize round-trip preserves both known and unknown history keys.
  it('round-trips through the settings file with its unknown keys', () => {
    const loaded = parseSettings(JSON.stringify({ history: { snapshotMinutes: 30, later: true } }));
    expect(loaded.settings.history.snapshotMinutes).toBe(30);
    const again = parseSettings(serializeSettings(loaded.settings, loaded.unknownKeys));
    expect(again.settings.history).toEqual(loaded.settings.history);
    expect(again.unknownKeys).toEqual({ 'history.later': true });
  });
});
