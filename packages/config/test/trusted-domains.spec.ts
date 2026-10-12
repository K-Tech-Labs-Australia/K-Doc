/**
 * @file trusted-domains.spec.ts
 * @purpose Tests the general.trustedDomains setting: default, cleaning, and rejection (FR-8.13).
 * @version 1
 * @date 2026-09-13
 */

import { describe, expect, it } from 'vitest';
import type { LoadedSettings } from '../src/index.js';
import { DEFAULT_SETTINGS, parseSettings } from '../src/index.js';

describe('DEFAULT_SETTINGS.general.trustedDomains', () => {
  it('defaults to an empty, frozen array', (): void => {
    // The default trusted domains list must start empty so no site is whitelisted by accident.
    expect(DEFAULT_SETTINGS.general.trustedDomains).toEqual([]);
    // A frozen default prevents accidental mutation of the shared settings across parses.
    expect(Object.isFrozen(DEFAULT_SETTINGS.general.trustedDomains)).toBe(true);
  });
});

describe('trustedDomains cleaning', () => {
  it('trims, lower-cases, and de-duplicates entries keeping first-seen order', (): void => {
    // The file mixes casing, surrounding whitespace, and a duplicate of the first host.
    const parsed: LoadedSettings = parseSettings(
      '{"general":{"trustedDomains":["Example.com", " docs.rs ", "example.com"]}}',
    );
    // Assert cleaned result is trimmed, lower-cased, de-duplicated, in first-seen order.
    expect(parsed.settings.general.trustedDomains).toEqual([
      'example.com',
      'docs.rs',
    ]);
    // A well-formed list must not raise any validation problem for that path.
    const problem = parsed.problems.find(
      (item) => item.path === 'general.trustedDomains',
    );
    expect(problem).toBeUndefined();
  });
});

describe('trustedDomains dropping unusable entries', () => {
  it('drops non-string and blank entries without reporting a problem', (): void => {
    // The list mixes a valid host with numbers, an empty string, whitespace, and null.
    const parsed: LoadedSettings = parseSettings(
      '{"general":{"trustedDomains":["ok.org", 42, "", "   ", null]}}',
    );
    // Assert only the single usable string survives cleaning.
    expect(parsed.settings.general.trustedDomains).toEqual(['ok.org']);
    // Silently dropping junk must not surface as a validation problem for that path.
    const problem = parsed.problems.find(
      (item) => item.path === 'general.trustedDomains',
    );
    expect(problem).toBeUndefined();
  });
});

describe('trustedDomains non-array fallback', () => {
  it('falls back to an empty array and reports exactly one warning when the value is not an array', (): void => {
    // The value is a bare string instead of an array, so it cannot be used as-is.
    const parsed: LoadedSettings = parseSettings(
      '{"general":{"trustedDomains":"example.com"}}',
    );
    // Assert the invalid value degrades to the empty default rather than crashing.
    expect(parsed.settings.general.trustedDomains).toEqual([]);
    // Collect every problem reported at this path to count them precisely.
    const problems = parsed.problems.filter(
      (item) => item.path === 'general.trustedDomains',
    );
    // Assert exactly one problem is raised for the malformed value.
    expect(problems.length).toBe(1);
    // Assert that single problem is a warning, not an error.
    expect(problems[0]?.severity).toBe('warning');
  });
});

describe('trustedDomains missing key', () => {
  it('keeps the default empty array when the file omits the key', (): void => {
    // An absent key is not an error and must leave the setting at its default.
    const parsed: LoadedSettings = parseSettings('{}');
    // Assert the omitted key retains the default empty array.
    expect(parsed.settings.general.trustedDomains).toEqual([]);
  });
});

describe('trustedDomains unknown-key handling', () => {
  it('is not reported as an unknown key because it is a known setting', (): void => {
    // A file that sets trustedDomains must treat it as a recognized field.
    const parsed: LoadedSettings = parseSettings(
      '{"general":{"trustedDomains":["example.com"]}}',
    );
    // Assert the parser does not forward this known key into unknownKeys by dotted path.
    expect(parsed.unknownKeys['general.trustedDomains']).toBeUndefined();
  });
});
