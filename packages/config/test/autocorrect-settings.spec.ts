/**
 * @file autocorrect-settings.spec.ts
 * @purpose Unit tests for parsing, serializing, and merging the autocorrect settings layer.
 * @inputs JSON strings and partial settings objects consumed by parse/serialize/merge helpers.
 * @outputs Assertions on parsed structures, problem lists, serialized output, and merged layers.
 * @functions
 *   - describe: Groups all autocorrect-settings tests under a single suite.
 *   - it: Executes individual test cases asserting parser, serializer, validator, and merge behavior.
 * @dataflow Test fixtures → parseAutocorrectSection/parseSettings → assertions on results.
 * @controlflow Suite mounts → each it() runs in isolation → expect() validates behavior → suite completes.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { parseSettings, serializeSettings, DEFAULT_SETTINGS } from '../src/index.js';
import {
  isValidReplacementKey,
  parseAutocorrectSection,
  serializeAutocorrectSection,
  DEFAULT_AUTOCORRECT_SETTINGS,
  MAX_REPLACEMENT_LENGTH,
} from '../src/autocorrect/autocorrect-settings.js';
import type { AutocorrectProblem } from '../src/autocorrect/autocorrect-settings.js';

describe('autocorrect settings', () => {
  // Asserts that an absent section yields the defaults and produces no validation problems.
  it('uses the defaults when the section is absent', () => {
    const problems: AutocorrectProblem[] = [];
    expect(parseAutocorrectSection(undefined, problems, {})).toBe(DEFAULT_AUTOCORRECT_SETTINGS);
    expect(problems).toEqual([]);
    expect(DEFAULT_SETTINGS.autocorrect).toBe(DEFAULT_AUTOCORRECT_SETTINGS);
  });

  // Asserts that a non-object section is rejected and reported as an error at the autocorrect path.
  it('rejects a section that is not an object', () => {
    const problems: AutocorrectProblem[] = [];
    expect(parseAutocorrectSection([], problems, {})).toBe(DEFAULT_AUTOCORRECT_SETTINGS);
    expect(problems.map((problem) => [problem.path, problem.severity])).toEqual([['autocorrect', 'error']]);
  });

  // Asserts each boolean switch is read and a non-boolean value raises a typed validation warning.
  it('reads each switch and warns about a wrong type', () => {
    const problems: AutocorrectProblem[] = [];
    const settings = parseAutocorrectSection({ smartQuotes: false, dashes: false, ellipsis: false, ordinals: true, capitalizeSentences: true, replaceText: 'yes' }, problems, {});
    expect([settings.smartQuotes, settings.dashes, settings.ellipsis, settings.ordinals, settings.capitalizeSentences, settings.replaceText]).toEqual([false, false, false, true, true, true]);
    expect(problems.map((problem) => problem.path)).toEqual(['autocorrect.replaceText']);
  });

  // Asserts the default table is replaced by valid user entries while malformed ones are dropped and reported.
  it('replaces the default table with the user table and drops bad entries', () => {
    const problems: AutocorrectProblem[] = [];
    const settings = parseAutocorrectSection({ replacements: { hte: 'the', 'two words': 'x', empty: '', num: 3, long: 'y'.repeat(MAX_REPLACEMENT_LENGTH + 1) } }, problems, {});
    expect(settings.replacements).toEqual({ hte: 'the' });
    expect(problems.map((problem) => problem.path)).toEqual(['autocorrect.replacements.two words', 'autocorrect.replacements.empty', 'autocorrect.replacements.num', 'autocorrect.replacements.long']);
  });

  // Asserts a non-object table is ignored and the default table is retained with an error reported.
  it('keeps the default table when the table is not an object', () => {
    const problems: AutocorrectProblem[] = [];
    expect(parseAutocorrectSection({ replacements: ['teh'] }, problems, {}).replacements).toBe(DEFAULT_AUTOCORRECT_SETTINGS.replacements);
    expect(problems.map((problem) => problem.path)).toEqual(['autocorrect.replacements']);
  });

  // Asserts unrecognized keys are preserved verbatim under the autocorrect path for forward compatibility.
  it('keeps unknown fields for a newer version', () => {
    const unknownKeys: Record<string, unknown> = {};
    parseAutocorrectSection({ future: 1 }, [], unknownKeys);
    expect(unknownKeys).toEqual({ 'autocorrect.future': 1 });
  });

  // Asserts replacement keys must be non-empty, space-free, and within the maximum length limit.
  it('accepts keys without spaces up to the length limit', () => {
    expect(isValidReplacementKey('(tm)')).toBe(true);
    expect(isValidReplacementKey('')).toBe(false);
    expect(isValidReplacementKey('a b')).toBe(false);
    expect(isValidReplacementKey('k'.repeat(MAX_REPLACEMENT_LENGTH))).toBe(true);
    expect(isValidReplacementKey('k'.repeat(MAX_REPLACEMENT_LENGTH + 1))).toBe(false);
  });

  // Asserts serialized output orders replacement keys in ascending alphabetical order.
  it('writes the table sorted', () => {
    const written = serializeAutocorrectSection({ ...DEFAULT_AUTOCORRECT_SETTINGS, replacements: { zz: 'z', aa: 'a' } });
    expect(Object.keys(written['replacements'] as Record<string, string>)).toEqual(['aa', 'zz']);
  });

  // Asserts settings survive a full parse → serialize → reparse cycle while preserving unknown keys.
  it('round-trips through the settings file', () => {
    const loaded = parseSettings(JSON.stringify({ autocorrect: { ordinals: true, replacements: { hte: 'the' }, future: true } }));
    expect(loaded.settings.autocorrect.ordinals).toBe(true);
    const again = parseSettings(serializeSettings(loaded.settings, loaded.unknownKeys));
    expect(again.settings.autocorrect).toEqual(loaded.settings.autocorrect);
    expect(again.unknownKeys['autocorrect.future']).toBe(true);
  });
});
