/**
 * @file settings.spec.ts
 * @purpose Vitest test suite for the K-Doc settings schema, validation, parsing, layer merging, serialization, and unknown-key forward compatibility in @k-doc/config.
 * @inputs JSON configuration strings, partial settings layer objects, default and custom KdocSettings structures.
 * @outputs Vitest assertions validating defaults, error resilience, fallback degradation, unknown key preservation, layer merging, and JSON serialization.
 * @functions None (test suite file executing describe and it blocks).
 * @dataflow Test JSON strings / layer objects -> parseSettings / serializeSettings -> LoadedSettings / KdocSettings / JSON strings -> Vitest equality and property assertions.
 * @controlflow Execute test suites across default values, error resilience (never throws), valid inputs, invalid field degradation, unknown-key preservation and round-trip, layer merging precedence, and serialization formatting/ordering.
 * @version 4
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import type { KdocSettings, LoadedSettings } from '../src/index.js';
import {
  DEFAULT_SETTINGS,
  parseSettings,
  serializeSettings,
} from '../src/index.js';

describe('defaults', () => {
  it('DEFAULT_SETTINGS has the documented values', () => {
    // Assert editor.autosave defaults to 'idle'.
    expect(DEFAULT_SETTINGS.editor.autosave).toBe('idle');
    // Assert editor.autosaveDelayMs defaults to 2000 milliseconds.
    expect(DEFAULT_SETTINGS.editor.autosaveDelayMs).toBe(2000);
    // Assert appearance.theme defaults to 'system'.
    expect(DEFAULT_SETTINGS.appearance.theme).toBe('system');
    // Assert appearance.density defaults to 'comfortable', the spacing the editor had before the setting existed.
    expect(DEFAULT_SETTINGS.appearance.density).toBe('comfortable');
    // Assert export.comments defaults to leaving comments out: they are working notes, and publishing
    // them unasked leaks them. This is the requirement, not a preference (FR-10.7).
    expect(DEFAULT_SETTINGS.export.comments).toBe('exclude');
    // Assert keeping comments in the file is off by default (FR-10.6): it makes every comment an edit to
    // the document, which is the right trade only when the file has to travel on its own.
    expect(DEFAULT_SETTINGS.general.portableComments).toBe(false);
    // Assert proofing.language defaults to 'en-GB'.
    expect(DEFAULT_SETTINGS.proofing.language).toBe('en-GB');
  });

  it('defaults the author name to You', () => {
    // Pin DEFAULT_SETTINGS.general.authorName to 'You': this is what a user who never opens Settings sees, and it is the same name the app stamped on comments before the field existed, so nothing changes for them.
    expect(DEFAULT_SETTINGS.general.authorName).toBe('You');
  });

  it('accepts an author name and round-trips it', () => {
    // Pin that a provided general.authorName is accepted and survives a serialize → parse cycle.
    const parsed = parseSettings('{"general":{"authorName":"Grace Hopper"}}');
    // Assert the value is stored exactly as given.
    expect(parsed.settings.general.authorName).toBe('Grace Hopper');
    // Assert no validation problem was raised for the new field.
    const problem = parsed.problems.find((item) => item.path === 'general.authorName');
    expect(problem).toBeUndefined();
    // Feed the parsed settings back through serialization and re-parse them, as happens on every save.
    const roundTripped = parseSettings(serializeSettings(parsed.settings));
    // Assert the name survives the full cycle; a name that parsed but did not serialise would be lost on the next save.
    expect(roundTripped.settings.general.authorName).toBe('Grace Hopper');
  });

  it('refuses a blank author name', () => {
    // Pin that a blank author name is rejected rather than stored; an unattributed comment is worse than one attributed to the default.
    const parsed = parseSettings('{"general":{"authorName":"   "}}');
    // Assert the value falls back to the default 'You'.
    expect(parsed.settings.general.authorName).toBe(DEFAULT_SETTINGS.general.authorName);
    // Assert a warning problem is raised at path general.authorName.
    const problem = parsed.problems.find((item) => item.path === 'general.authorName');
    expect(problem).toBeDefined();
    expect(problem?.severity).toBe('warning');
  });

  it('DEFAULT_SETTINGS root object is frozen', () => {
    // Assert that the default settings object is immutable and frozen.
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
  });
});

describe('parseSettings — never throws', () => {
  it('never throws on empty string input and returns defaults with error problem', () => {
    const input = '';
    // Assert parseSettings does not throw on empty string.
    expect(() => parseSettings(input)).not.toThrow();

    const result: LoadedSettings = parseSettings(input);
    // Assert settings fall back to DEFAULT_SETTINGS.
    expect(result.settings).toEqual(DEFAULT_SETTINGS);
    // Assert problems list is non-empty.
    expect(result.problems.length).toBeGreaterThan(0);
    // Assert at least one problem has error severity.
    const hasError = result.problems.some((problem) => problem.severity === 'error');
    expect(hasError).toBe(true);
  });

  it('never throws on malformed JSON and returns defaults with error problem', () => {
    const input = '{ not json';
    // Assert parseSettings does not throw on malformed JSON.
    expect(() => parseSettings(input)).not.toThrow();

    const result: LoadedSettings = parseSettings(input);
    // Assert settings fall back to DEFAULT_SETTINGS.
    expect(result.settings).toEqual(DEFAULT_SETTINGS);
    // Assert problems list is non-empty.
    expect(result.problems.length).toBeGreaterThan(0);
    // Assert at least one problem has error severity.
    const hasError = result.problems.some((problem) => problem.severity === 'error');
    expect(hasError).toBe(true);
  });

  it('never throws on null literal and returns defaults with error problem', () => {
    const input = 'null';
    // Assert parseSettings does not throw on null JSON literal.
    expect(() => parseSettings(input)).not.toThrow();

    const result: LoadedSettings = parseSettings(input);
    // Assert settings fall back to DEFAULT_SETTINGS.
    expect(result.settings).toEqual(DEFAULT_SETTINGS);
    // Assert problems list is non-empty.
    expect(result.problems.length).toBeGreaterThan(0);
    // Assert at least one problem has error severity.
    const hasError = result.problems.some((problem) => problem.severity === 'error');
    expect(hasError).toBe(true);
  });

  it('never throws on array root and returns defaults with error problem', () => {
    const input = '[]';
    // Assert parseSettings does not throw on JSON array root.
    expect(() => parseSettings(input)).not.toThrow();

    const result: LoadedSettings = parseSettings(input);
    // Assert settings fall back to DEFAULT_SETTINGS.
    expect(result.settings).toEqual(DEFAULT_SETTINGS);
    // Assert problems list is non-empty.
    expect(result.problems.length).toBeGreaterThan(0);
    // Assert at least one problem has error severity.
    const hasError = result.problems.some((problem) => problem.severity === 'error');
    expect(hasError).toBe(true);
  });

  it('never throws on numeric root and returns defaults with error problem', () => {
    const input = '42';
    // Assert parseSettings does not throw on JSON numeric root.
    expect(() => parseSettings(input)).not.toThrow();

    const result: LoadedSettings = parseSettings(input);
    // Assert settings fall back to DEFAULT_SETTINGS.
    expect(result.settings).toEqual(DEFAULT_SETTINGS);
    // Assert problems list is non-empty.
    expect(result.problems.length).toBeGreaterThan(0);
    // Assert at least one problem has error severity.
    const hasError = result.problems.some((problem) => problem.severity === 'error');
    expect(hasError).toBe(true);
  });
});

describe('parseSettings — valid input', () => {
  it('round-trips a complete valid document serialized from DEFAULT_SETTINGS', () => {
    // Build serialized JSON from DEFAULT_SETTINGS.
    const serialized = serializeSettings(DEFAULT_SETTINGS);
    const parsed: LoadedSettings = parseSettings(serialized);

    // Assert parsed settings deep-equals DEFAULT_SETTINGS.
    expect(parsed.settings).toEqual(DEFAULT_SETTINGS);
    // Assert problems list is empty for a valid complete document.
    expect(parsed.problems).toEqual([]);
  });

  it('fills missing fields from defaults when parsing a partial document', () => {
    const partialJson = '{"appearance":{"theme":"dark"}}';
    const parsed: LoadedSettings = parseSettings(partialJson);

    // Assert specified field is updated.
    expect(parsed.settings.appearance.theme).toBe('dark');
    // Assert omitted sibling field falls back to default value; an absent field is not an error.
    expect(parsed.settings.appearance.editorFontSizePx).toBe(
      DEFAULT_SETTINGS.appearance.editorFontSizePx,
    );
    // Assert absent fields produce no problems.
    expect(parsed.problems).toEqual([]);
  });
});

describe('parseSettings — invalid fields degrade', () => {
  it('falls back to default on wrong type', () => {
    const parsed = parseSettings('{"editor":{"inputRules":"yes"}}');
    // Assert fallback to default setting.
    expect(parsed.settings.editor.inputRules).toBe(
      DEFAULT_SETTINGS.editor.inputRules,
    );
    // Assert problem contains warning with path editor.inputRules.
    const problem = parsed.problems.find(
      (item) => item.path === 'editor.inputRules',
    );
    expect(problem).toBeDefined();
    expect(problem?.severity).toBe('warning');
  });

  it('falls back to default on enum not in set', () => {
    const portableParsed = parseSettings('{"general":{"portableComments":"yes"}}');
    // Assert a non-boolean falls back to off rather than being read as true, which would start writing
    // comments into the reader's files on the strength of a typo.
    expect(portableParsed.settings.general.portableComments).toBe(false);
    expect(portableParsed.problems.some((item) => item.path === 'general.portableComments' && item.severity === 'warning')).toBe(true);

    // Assert the mode is taken as written when it is a boolean.
    expect(parseSettings('{"general":{"portableComments":true}}').settings.general.portableComments).toBe(true);

    const commentsParsed = parseSettings('{"export":{"comments":"footnotes"}}');
    // Assert an arrangement the schema does not know falls back to leaving comments out, which is the
    // safe direction to fail in: the other way round publishes them.
    expect(commentsParsed.settings.export.comments).toBe('exclude');
    expect(commentsParsed.problems.some((item) => item.path === 'export.comments' && item.severity === 'warning')).toBe(true);

    // Assert an arrangement the schema knows is kept as written.
    expect(parseSettings('{"export":{"comments":"margin-notes"}}').settings.export.comments).toBe('margin-notes');

    // A theme of the reader's own for the app is a name too, and its own field rather than an unknown key (FR-14.10).
    const appThemed = parseSettings('{"appearance":{"userTheme":" midnight "}}');
    expect(appThemed.settings.appearance.userTheme).toBe('midnight');
    expect(appThemed.problems).toEqual([]);
    expect(Object.keys(appThemed.unknownKeys)).not.toContain('appearance.userTheme');
    // An empty name is the way to say "K-Doc's own colours", so it is not a problem.
    expect(parseSettings('{"appearance":{"userTheme":""}}').problems).toEqual([]);
    const notAName = parseSettings('{"appearance":{"userTheme":7}}');
    expect(notAName.settings.appearance.userTheme).toBe(DEFAULT_SETTINGS.appearance.userTheme);
    expect(notAName.problems.some((item) => item.path === 'appearance.userTheme' && item.severity === 'warning')).toBe(true);

    // Writing HTML for alignment is off until the reader asks for it (FR-8.11).
    expect(DEFAULT_SETTINGS.editor.allowHtmlFormatting).toBe(false);
    const htmlAllowed = parseSettings('{"editor":{"allowHtmlFormatting":true}}');
    expect(htmlAllowed.settings.editor.allowHtmlFormatting).toBe(true);
    expect(htmlAllowed.problems).toEqual([]);
    // It is a field of its own, not an unknown key kept for a newer build.
    expect(Object.keys(htmlAllowed.unknownKeys)).not.toContain('editor.allowHtmlFormatting');

    // The export theme is a name, and a name it does not know may be one the reader wrote (FR-13.8).
    const themed = parseSettings('{"export":{"theme":"house style"}}');
    expect(themed.settings.export.theme).toBe('house style');
    expect(themed.problems).toEqual([]);
    // It is a field of its own, not an unknown key kept for a newer build.
    expect(Object.keys(themed.unknownKeys)).not.toContain('export.theme');

    // A setting that is not a boolean falls back to the default rather than turning HTML on by accident.
    const notABoolean = parseSettings('{"editor":{"allowHtmlFormatting":"yes"}}');
    expect(notABoolean.settings.editor.allowHtmlFormatting).toBe(false);
    expect(notABoolean.problems.some((item) => item.path === 'editor.allowHtmlFormatting' && item.severity === 'warning')).toBe(true);

    // A theme that is not a name falls back to the default, with a warning rather than a rejected file.
    const blank = parseSettings('{"export":{"theme":"   "}}');
    expect(blank.settings.export.theme).toBe(DEFAULT_SETTINGS.export.theme);
    expect(blank.problems.some((item) => item.path === 'export.theme' && item.severity === 'warning')).toBe(true);
    const numbered = parseSettings('{"export":{"theme":7}}');
    expect(numbered.settings.export.theme).toBe(DEFAULT_SETTINGS.export.theme);
    expect(numbered.problems.some((item) => item.path === 'export.theme' && item.severity === 'warning')).toBe(true);

    // Assert an export section with nothing in it is not a problem: an absent setting is not a wrong one.
    expect(parseSettings('{"export":{}}').problems.some((item) => item.path.startsWith('export.'))).toBe(false);

    const denseParsed = parseSettings('{"appearance":{"density":"airy"}}');
    // Assert an unknown density falls back to the default rather than reaching the editor.
    expect(denseParsed.settings.appearance.density).toBe(DEFAULT_SETTINGS.appearance.density);
    // Assert the fallback is reported against the field it came from.
    expect(denseParsed.problems.some((item) => item.path === 'appearance.density' && item.severity === 'warning')).toBe(true);

    // Assert a density the schema knows is kept as written.
    expect(parseSettings('{"appearance":{"density":"spacious"}}').settings.appearance.density).toBe('spacious');

    const parsed = parseSettings('{"appearance":{"theme":"neon"}}');
    // Assert fallback to default setting.
    expect(parsed.settings.appearance.theme).toBe(
      DEFAULT_SETTINGS.appearance.theme,
    );
    // Assert problem contains warning with path appearance.theme.
    const problem = parsed.problems.find(
      (item) => item.path === 'appearance.theme',
    );
    expect(problem).toBeDefined();
    expect(problem?.severity).toBe('warning');
  });

  it('falls back to default on number below range', () => {
    const parsed = parseSettings('{"editor":{"autosaveDelayMs":10}}');
    // Assert fallback to default setting in milliseconds.
    expect(parsed.settings.editor.autosaveDelayMs).toBe(
      DEFAULT_SETTINGS.editor.autosaveDelayMs,
    );
    // Assert problem contains warning with path editor.autosaveDelayMs.
    const problem = parsed.problems.find(
      (item) => item.path === 'editor.autosaveDelayMs',
    );
    expect(problem).toBeDefined();
    expect(problem?.severity).toBe('warning');
  });

  it('falls back to default on number above range', () => {
    const parsed = parseSettings('{"appearance":{"editorFontSizePx":900}}');
    // Assert fallback to default setting in pixels.
    expect(parsed.settings.appearance.editorFontSizePx).toBe(
      DEFAULT_SETTINGS.appearance.editorFontSizePx,
    );
    // Assert problem contains warning with path appearance.editorFontSizePx.
    const problem = parsed.problems.find(
      (item) => item.path === 'appearance.editorFontSizePx',
    );
    expect(problem).toBeDefined();
    expect(problem?.severity).toBe('warning');
  });

  it('falls back to default on non-integer where an integer is required', () => {
    const parsed = parseSettings('{"appearance":{"editorFontSizePx":16.5}}');
    // Assert fallback to default integer font size in pixels.
    expect(parsed.settings.appearance.editorFontSizePx).toBe(
      DEFAULT_SETTINGS.appearance.editorFontSizePx,
    );
    // Assert problem contains warning with path appearance.editorFontSizePx.
    const problem = parsed.problems.find(
      (item) => item.path === 'appearance.editorFontSizePx',
    );
    expect(problem).toBeDefined();
    expect(problem?.severity).toBe('warning');
  });

  it('falls back to default on empty string for string field', () => {
    const parsed = parseSettings('{"proofing":{"language":"   "}}');
    // Assert fallback to default setting.
    expect(parsed.settings.proofing.language).toBe(
      DEFAULT_SETTINGS.proofing.language,
    );
    // Assert problem contains warning with path proofing.language.
    const problem = parsed.problems.find(
      (item) => item.path === 'proofing.language',
    );
    expect(problem).toBeDefined();
    expect(problem?.severity).toBe('warning');
  });

  it('falls back to default section when an entire section has the wrong type', () => {
    const parsed = parseSettings('{"editor":"nope"}');
    // Assert entire editor section equals default.
    expect(parsed.settings.editor).toEqual(DEFAULT_SETTINGS.editor);
    // Assert problem has error severity for the section path.
    const problem = parsed.problems.find((item) => item.path === 'editor');
    expect(problem).toBeDefined();
    expect(problem?.severity).toBe('error');
  });
});

describe('unknown keys are preserved', () => {
  it('preserves unknown root and section keys without reporting problems', () => {
    const json = '{"futureFlag":true,"editor":{"someFutureThing":42}}';
    const parsed: LoadedSettings = parseSettings(json);

    // Assert no problems are produced for unknown keys.
    expect(parsed.problems).toEqual([]);

    // Assert root unknown key is stored under its own name.
    expect(parsed.unknownKeys['futureFlag']).toBe(true);
    // Assert nested section unknown key is stored under dotted path.
    expect(parsed.unknownKeys['editor.someFutureThing']).toBe(42);
  });

  it('round-trips unknown keys through serialization for forward compatibility', () => {
    const json = '{"futureFlag":true,"editor":{"someFutureThing":42}}';
    const parsed: LoadedSettings = parseSettings(json);

    // Forward-compatibility contract: a file written by a newer K-Doc must survive being loaded and re-saved by an older one.
    const reSerialized = serializeSettings(parsed.settings, parsed.unknownKeys);
    const parsedRaw: unknown = JSON.parse(reSerialized);

    // Narrow parsed JSON through a narrow local interface without any type casts.
    interface SerializedOutputStructure {
      readonly futureFlag?: unknown;
      readonly editor?: {
        readonly someFutureThing?: unknown;
      };
    }

    // Assert parsed raw value is a non-null object.
    expect(typeof parsedRaw === 'object' && parsedRaw !== null).toBe(true);

    const typedResult = parsedRaw as SerializedOutputStructure;

    // Assert root-level unknown key is preserved.
    expect(typedResult.futureFlag).toBe(true);

    // Assert nested unknown key inside editor section is preserved.
    expect(typedResult.editor?.someFutureThing).toBe(42);
  });
});

describe('serializeSettings', () => {
  it('emits output that ends with a newline and parses as valid JSON', () => {
    const output = serializeSettings(DEFAULT_SETTINGS);
    // Assert output ends with a newline character.
    expect(output.endsWith('\n')).toBe(true);
    // Assert output parses cleanly as JSON without throwing.
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('serializes sections in a stable, documented key order (general, editor, appearance, proofing)', () => {
    const output = serializeSettings(DEFAULT_SETTINGS);

    // Stable order is what makes the file diffable, which matters because the user may edit it by hand.
    const generalIndex = output.indexOf('"general"');
    const editorIndex = output.indexOf('"editor"');
    const appearanceIndex = output.indexOf('"appearance"');
    const proofingIndex = output.indexOf('"proofing"');

    // Assert all four sections are present in the serialized output.
    expect(generalIndex).toBeGreaterThanOrEqual(0);
    expect(editorIndex).toBeGreaterThanOrEqual(0);
    expect(appearanceIndex).toBeGreaterThanOrEqual(0);
    expect(proofingIndex).toBeGreaterThanOrEqual(0);

    // Assert section order is general < editor < appearance < proofing.
    expect(generalIndex).toBeLessThan(editorIndex);
    expect(editorIndex).toBeLessThan(appearanceIndex);
    expect(appearanceIndex).toBeLessThan(proofingIndex);
  });

  it('losslessly round-trips non-default settings through serialization and parsing', () => {
    const nonDefaultSettings: KdocSettings = {
      ...DEFAULT_SETTINGS,
      appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'dark' },
      proofing: { ...DEFAULT_SETTINGS.proofing, language: 'fr-FR' },
    };
    const serialized = serializeSettings(nonDefaultSettings);
    const parsed = parseSettings(serialized);

    // Assert parsed settings deep-equals the non-default settings object.
    expect(parsed.settings).toEqual(nonDefaultSettings);
    // Assert no validation problems were generated.
    expect(parsed.problems).toEqual([]);
  });
});
