/**
 * @file snippet-settings.spec.ts
 * @purpose Unit tests for the snippet settings parsing, validation, and serialization logic.
 * @inputs Snippet configuration objects (valid, malformed, partial) consumed by parse/serialize helpers; expected constants.
 * @outputs Boolean/object assertions on parsed settings, recorded SnippetProblem paths/severities, serialized output ordering.
 * @functions
 *   - isValidSnippetPrefix: Validates snippet prefix characters and length limits.
 *   - parseSnippetSection: Parses raw config into validated SnippetSettings, recording problems.
 *   - serializeSnippetSection: Serializes settings back to a stable, sorted object for writing.
 * @dataflow Raw config object → parseSnippetSection/isValidSnippetPrefix → validated settings or problems → serializeSnippetSection → written object.
 * @controlflow describe mounts the suite → each it exercises one behavior path → expect asserts outcomes → problems arrays compared.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import {
  isValidSnippetPrefix,
  parseSnippetSection,
  serializeSnippetSection,
  DEFAULT_SNIPPET_SETTINGS,
  MAX_SNIPPET_BODY_LENGTH,
  MAX_SNIPPET_PREFIX_LENGTH,
} from '../src/snippets/snippet-settings.js';
import type { SnippetProblem } from '../src/snippets/snippet-settings.js';

describe('snippet settings', () => {
  // Verifies that a missing or non-object section falls back to defaults and records one error.
  it('uses the defaults when the section is absent or not an object', () => {
    const problems: SnippetProblem[] = [];
    expect(parseSnippetSection(undefined, problems, {})).toBe(DEFAULT_SNIPPET_SETTINGS);
    expect(parseSnippetSection('x', problems, {})).toBe(DEFAULT_SNIPPET_SETTINGS);
    expect(problems.map((problem) => [problem.path, problem.severity])).toEqual([['snippets', 'error']]);
  });

  // Confirms the enabled switch is read and a wrong type yields a warning while defaulting to true.
  it('reads the switch and warns about a wrong type', () => {
    const problems: SnippetProblem[] = [];
    expect(parseSnippetSection({ enabled: false }, problems, {}).enabled).toBe(false);
    expect(parseSnippetSection({ enabled: 'no' }, problems, {}).enabled).toBe(true);
    expect(problems.map((problem) => problem.path)).toEqual(['snippets.enabled']);
  });

  // Checks that valid snippets are kept while malformed entries are dropped and reported.
  it('replaces the defaults with the user snippets and drops bad ones', () => {
    const problems: SnippetProblem[] = [];
    const settings = parseSnippetSection({ items: { sig: 'Regards', 'two words': 'x', empty: '', num: 1, long: 'y'.repeat(MAX_SNIPPET_BODY_LENGTH + 1) } }, problems, {});
    expect(settings.items).toEqual({ sig: 'Regards' });
    expect(problems.map((problem) => problem.path)).toEqual(['snippets.items.two words', 'snippets.items.empty', 'snippets.items.num', 'snippets.items.long']);
  });

  // Ensures unknown keys are preserved for forward compatibility with newer config versions.
  it('keeps unknown fields for a newer version', () => {
    const unknownKeys: Record<string, unknown> = {};
    parseSnippetSection({ future: 2 }, [], unknownKeys);
    expect(unknownKeys).toEqual({ 'snippets.future': 2 });
  });

  // Validates prefix rules: no spaces, non-empty, and within the maximum length boundary.
  it('accepts prefixes without spaces up to the limit', () => {
    expect(isValidSnippetPrefix('sig')).toBe(true);
    expect(isValidSnippetPrefix('a b')).toBe(false);
    expect(isValidSnippetPrefix('')).toBe(false);
    expect(isValidSnippetPrefix('p'.repeat(MAX_SNIPPET_PREFIX_LENGTH))).toBe(true);
    expect(isValidSnippetPrefix('p'.repeat(MAX_SNIPPET_PREFIX_LENGTH + 1))).toBe(false);
  });

  // Confirms serialized output orders snippet keys alphabetically.
  it('writes the snippets sorted', () => {
    const written = serializeSnippetSection({ enabled: true, items: { zz: 'z', aa: 'a' } });
    expect(Object.keys(written['items'] as Record<string, string>)).toEqual(['aa', 'zz']);
  });
});
