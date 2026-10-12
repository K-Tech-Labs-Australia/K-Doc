/**
 * @file plugin-manifest.spec.ts
 * @purpose Exercises the plugin id, manifest reader and formatting helpers so their behaviour is locked in before K-Doc reads any plugin.json (FR-14.18).
 * @inputs The public exports of ../src/plugins/plugin-manifest.js plus hand-written JSON strings and folder ids used as test inputs.
 * @outputs Boolean assertions on isPluginId; PluginManifestResult shape checks on parsePluginManifest; an exact string match on pluginProblem; the PLUGIN_MAIN value.
 * @functions
 *   - describe('isPluginId'): proves which names are and are not valid plugin ids.
 *   - describe('parsePluginManifest'): proves whole reads, fallbacks, trimming and every refusal path.
 *   - describe('pluginProblem'): proves the single shared problem format.
 *   - describe('PLUGIN_MAIN'): proves the one file a plugin's code lives in.
 * @dataflow Each test calls an exported helper with fixed inputs then asserts on its return value; nothing flows between tests.
 * @controlflow Every describe opens, runs its it blocks top to bottom and closes; each assertion is independent so order never matters.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';

import { isPluginId, parsePluginManifest, pluginProblem, PLUGIN_MAIN } from '../src/plugins/plugin-manifest.js';

describe('isPluginId', () => {
  // A plain word of allowed characters reads as a valid id.
  it('accepts "word-count"', () => {
    expect(isPluginId('word-count')).toBe(true);
  });

  // A single lowercase letter is the shortest possible id.
  it('accepts "a"', () => {
    expect(isPluginId('a')).toBe(true);
  });

  // A leading letter followed by a digit reads as an id.
  it('accepts "p2"', () => {
    expect(isPluginId('p2')).toBe(true);
  });

  // Hyphens between letters read as an id.
  it('accepts "a-b-c"', () => {
    expect(isPluginId('a-b-c')).toBe(true);
  });

  // An empty string has no starting letter, so it is not an id.
  it('rejects the empty string', () => {
    expect(isPluginId('')).toBe(false);
  });

  // An uppercase first letter falls outside the allowed pattern.
  it('rejects "A"', () => {
    expect(isPluginId('A')).toBe(false);
  });

  // A leading digit is not a legal id start.
  it('rejects "2a"', () => {
    expect(isPluginId('2a')).toBe(false);
  });

  // An interior space breaks the allowed character run.
  it('rejects "a b"', () => {
    expect(isPluginId('a b')).toBe(false);
  });

  // A dot could open a nested path, so it is refused.
  it('rejects "a.b"', () => {
    expect(isPluginId('a.b')).toBe(false);
  });

  // A forward slash climbs out of the plugins folder and must never be an id.
  it('rejects "a/b"', () => {
    expect(isPluginId('a/b')).toBe(false);
  });

  // A backslash is a path separator on some hosts, so this one is refused too.
  it('rejects the backslashed name', () => {
    const withBackslash = 'a' + String.fromCharCode(92) + 'b';
    expect(isPluginId(withBackslash)).toBe(false);
  });

  // Two dots carry no letter to start an id.
  it('rejects ".."', () => {
    expect(isPluginId('..')).toBe(false);
  });

  // An underscore is not one of the allowed characters.
  it('rejects "a_b"', () => {
    expect(isPluginId('a_b')).toBe(false);
  });

  // A punctuation mark other than a hyphen breaks the pattern.
  it('rejects "a!"', () => {
    expect(isPluginId('a!')).toBe(false);
  });
});

describe('parsePluginManifest', () => {
  // Every field of a well-formed manifest is read and no problem is reported.
  it('reads a whole manifest under its id', () => {
    const result = parsePluginManifest('word-count', '{"name":"Word Count","version":"1.2.0","description":"Counts."}');

    expect(result.manifest).not.toBeNull();
    expect(result.problem).toBeNull();
    expect(result.manifest?.id).toBe('word-count');
    expect(result.manifest?.name).toBe('Word Count');
    expect(result.manifest?.version).toBe('1.2.0');
    expect(result.manifest?.description).toBe('Counts.');
  });

  // A folder name K-Doc will never load is refused outright, naming that folder.
  it('refuses a folder name K-Doc will not read', () => {
    const result = parsePluginManifest('Bad Name', '{}');

    expect(result.manifest).toBeNull();
    expect(result.problem).not.toBeNull();
    expect(result.problem).toContain('Bad Name');
  });

  // Text that is not valid JSON is refused with a readable-JSON message.
  it('refuses text that is not JSON', () => {
    const result = parsePluginManifest('word-count', 'not json');

    expect(result.manifest).toBeNull();
    expect(result.problem).toContain('readable JSON');
  });

  // A quoted string parses to a value with no named fields, so it is refused.
  it('refuses the manifest "hello"', () => {
    const result = parsePluginManifest('word-count', '"hello"');

    expect(result.manifest).toBeNull();
    expect(result.problem).not.toBeNull();
  });

  // A bare number parses to a non-object and is refused.
  it('refuses the manifest 7', () => {
    const result = parsePluginManifest('word-count', '7');

    expect(result.manifest).toBeNull();
    expect(result.problem).not.toBeNull();
  });

  // The literal null parses to a non-object and is refused.
  it('refuses the manifest null', () => {
    const result = parsePluginManifest('word-count', 'null');

    expect(result.manifest).toBeNull();
    expect(result.problem).not.toBeNull();
  });

  // An array parses to an object shape but has no named fields, so it is refused.
  it('refuses the manifest []', () => {
    const result = parsePluginManifest('word-count', '[]');

    expect(result.manifest).toBeNull();
    expect(result.problem).not.toBeNull();
  });

  // A plugin that never named itself is called by its folder name with default metadata.
  it('calls an unnamed plugin by its folder', () => {
    const result = parsePluginManifest('word-count', '{}');

    expect(result.manifest).not.toBeNull();
    expect(result.problem).toBeNull();
    expect(result.manifest?.name).toBe('word-count');
    expect(result.manifest?.version).toBe('0.0.0');
    expect(result.manifest?.description).toBe('');
  });

  // A name of only whitespace counts as unnamed and falls back to the folder id.
  it('treats a spaces-only name as unnamed', () => {
    const result = parsePluginManifest('word-count', '{"name":"   "}');

    expect(result.manifest).not.toBeNull();
    expect(result.problem).toBeNull();
    expect(result.manifest?.name).toBe('word-count');
  });

  // A name given as a non-string is refused, naming the offending field.
  it('refuses a name that is not text', () => {
    const result = parsePluginManifest('word-count', '{"name":7}');

    expect(result.manifest).toBeNull();
    expect(result.problem).toContain('name');
    expect(result.problem).not.toBeNull();
  });

  // A name longer than the limit is refused, naming both field and limit.
  it('refuses a name longer than 200 characters', () => {
    const tooLong = JSON.stringify({ name: 'x'.repeat(201) });
    const result = parsePluginManifest('word-count', tooLong);

    expect(result.manifest).toBeNull();
    expect(result.problem).toContain('name');
    expect(result.problem).toContain('200');
  });

  // A name of exactly the limit is kept unchanged.
  it('keeps a name of exactly 200 characters', () => {
    const exact = JSON.stringify({ name: 'x'.repeat(200) });
    const result = parsePluginManifest('word-count', exact);

    expect(result.manifest).not.toBeNull();
    expect(result.problem).toBeNull();
    expect(result.manifest?.name).toBe('x'.repeat(200));
  });

  // Whitespace around every stated field is trimmed before it reaches the host.
  it('trims every field', () => {
    const result = parsePluginManifest('word-count', '{"name":"  Word Count  ","version":" 1.0 ","description":" Counts. "}');

    expect(result.manifest).not.toBeNull();
    expect(result.problem).toBeNull();
    expect(result.manifest?.name).toBe('Word Count');
    expect(result.manifest?.version).toBe('1.0');
    expect(result.manifest?.description).toBe('Counts.');
  });

  // When several fields are wrong, only the first one read is reported.
  it('reports the first field that is wrong', () => {
    const result = parsePluginManifest('word-count', '{"name":7,"version":8}');

    expect(result.manifest).toBeNull();
    expect(result.problem).toContain('name');
    expect(result.problem).not.toContain('version');
  });
});

describe('pluginProblem', () => {
  // Every problem is written in the single shared shape, prefix and reason joined once.
  it('writes a problem as Plugin "<id>": <reason>', () => {
    expect(pluginProblem('a', 'went wrong.')).toBe('Plugin "a": went wrong.');
  });
});

describe('PLUGIN_MAIN', () => {
  // The one file a plugin's code must live in is named main.js.
  it('names the single code file as main.js', () => {
    expect(PLUGIN_MAIN).toBe('main.js');
  });
});
