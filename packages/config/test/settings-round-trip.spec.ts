/**
 * @file settings-round-trip.spec.ts
 * @purpose A settings file written and read back keeps every field; serializeSettings lists fields by hand, and general.trustedDomains was once left out, so "Always trust" was forgotten on restart.
 * @inputs The CHANGED fixture (every settings field differs from DEFAULT_SETTINGS) plus a minimal trusted-domains JSON string.
 * @outputs Assertions that parseSettings(serializeSettings(...)) round-trips every field with no problems and deep-equals the input.
 * @functions
 *   - describe('settings round trip'): Groups the full-settings round-trip tests.
 *   - it('changes every field from its default'): Guards that the CHANGED fixture actually differs from DEFAULT_SETTINGS on every key.
 *   - it('keeps every field through a save and reload'): Asserts serializeSettings then parseSettings deep-equals CHANGED with no problems.
 *   - it('keeps trusted domains through a save and reload'): Regression guard for general.trustedDomains once being dropped by the serializer.
 * @dataflow CHANGED fixture → serializeSettings → JSON string → parseSettings → LoadedSettings (settings, problems) → assertions; minimal trusted-domains JSON → parseSettings → serializeSettings → parseSettings → assertion.
 * @controlflow Mount describe block → run each it in order: fixture meaningfulness check, full round-trip, trusted-domains regression.
 * @version 8
 * @date 2026-10-06
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings, serializeSettings, type KdocSettings } from '../src/index.js';

// A settings object in which every field differs from DEFAULT_SETTINGS, so a serializer that omits any field fails this test.
const CHANGED: KdocSettings = {
  general: {
    restoreSessionOnLaunch: !DEFAULT_SETTINGS.general.restoreSessionOnLaunch,
    confirmExternalLinks: !DEFAULT_SETTINGS.general.confirmExternalLinks,
    portableComments: !DEFAULT_SETTINGS.general.portableComments,
    developerMode: !DEFAULT_SETTINGS.general.developerMode,
    trustedDomains: ['example.com', 'docs.rs'],
    authorName: 'Round Trip',
    attachmentsFolder: 'media',
    attachmentNameTemplate: '{doc}-{name}-{time}',
    recentFiles: [{ path: 'C:/notes/a.md', pinned: true, openedAt: 1700000000000 }],
  },
  editor: {
    // Picks a view mode unlike the default (flips source↔kdoc).
    defaultViewMode: DEFAULT_SETTINGS.editor.defaultViewMode === 'source' ? 'kdoc' : 'source',
    // Picks a split orientation unlike the default (flips horizontal↔vertical).
    splitOrientation: DEFAULT_SETTINGS.editor.splitOrientation === 'horizontal' ? 'vertical' : 'horizontal',
    smartSubstitutions: !DEFAULT_SETTINGS.editor.smartSubstitutions,
    inputRules: !DEFAULT_SETTINGS.editor.inputRules,
    // Picks an autosave mode unlike the default (flips interval↔idle).
    autosave: DEFAULT_SETTINGS.editor.autosave === 'interval' ? 'idle' : 'interval',
    autosaveDelayMs: DEFAULT_SETTINGS.editor.autosaveDelayMs + 1000,
    allowHtmlFormatting: !DEFAULT_SETTINGS.editor.allowHtmlFormatting,
  },
  appearance: {
    // Picks a theme unlike the default (flips dark↔light).
    theme: DEFAULT_SETTINGS.appearance.theme === 'dark' ? 'light' : 'dark',
    // A built-in UI theme unlike the default K-Doc palette.
    uiTheme: 'nord',
    editorFontFamily: 'Georgia',
    monospaceFontFamily: 'Consolas',
    editorFontSizePx: DEFAULT_SETTINGS.appearance.editorFontSizePx + 2,
    // Picks a line height unlike the default (flips 1.8↔1.4).
    lineHeight: DEFAULT_SETTINGS.appearance.lineHeight === 1.8 ? 1.4 : 1.8,
    // Picks a reading width unlike the default (flips wide↔narrow).
    readingWidth: DEFAULT_SETTINGS.appearance.readingWidth === 'wide' ? 'narrow' : 'wide',
    // Picks a density unlike the default (flips compact↔spacious).
    density: DEFAULT_SETTINGS.appearance.density === 'compact' ? 'spacious' : 'compact',
    // A theme of the reader's own, unlike the default of none.
    userTheme: 'house style',
    ribbon: [{ tab: 'Home', groups: [{ title: 'Text', commands: ['format:bold'] }] }],
  },
  proofing: {
    spellCheck: !DEFAULT_SETTINGS.proofing.spellCheck,
    // Picks a language unlike the default (flips fr↔de).
    language: DEFAULT_SETTINGS.proofing.language === 'fr' ? 'de' : 'fr',
    detectLanguage: !DEFAULT_SETTINGS.proofing.detectLanguage,
    grammarEndpoint: 'http://localhost:8081/v2/check',
  },
  keyboard: {
    preset: 'typora',
    bindings: { 'format:bold': ['Ctrl+Alt+B'], 'format:italic': [] },
  },
  autocorrect: {
    smartQuotes: !DEFAULT_SETTINGS.autocorrect.smartQuotes,
    dashes: !DEFAULT_SETTINGS.autocorrect.dashes,
    ellipsis: !DEFAULT_SETTINGS.autocorrect.ellipsis,
    ordinals: !DEFAULT_SETTINGS.autocorrect.ordinals,
    capitalizeSentences: !DEFAULT_SETTINGS.autocorrect.capitalizeSentences,
    replaceText: !DEFAULT_SETTINGS.autocorrect.replaceText,
    replacements: { hte: 'the' },
  },
  history: {
    snapshotOnSave: !DEFAULT_SETTINGS.history.snapshotOnSave,
    snapshotMinutes: 5,
    keepAllHours: 12,
    keepHourlyDays: 3,
    keepDailyDays: 30,
  },
  export: {
    // Picks a comment arrangement unlike the default (flips endnotes↔margin-notes only if the default
    // ever stops being 'exclude', which it should not).
    comments: DEFAULT_SETTINGS.export.comments === 'endnotes' ? 'margin-notes' : 'endnotes',
    // Picks an export theme unlike the default.
    theme: DEFAULT_SETTINGS.export.theme === 'serif' ? 'compact' : 'serif',
  },
  snippets: {
    enabled: !DEFAULT_SETTINGS.snippets.enabled,
    items: { sig: 'Regards,\n$1' },
  },
};

describe('settings round trip', () => {
  it('changes every field from its default', (): void => {
    // Walk every section and every key so this fixture is proven to differ from the defaults on all of them.
    for (const section of ['general', 'editor', 'appearance', 'proofing', 'keyboard', 'autocorrect', 'snippets', 'history'] as const) {
      for (const key of Object.keys(DEFAULT_SETTINGS[section])) {
        // The serialized value in CHANGED must differ from the default's serialized value at this path.
        expect(JSON.stringify((CHANGED[section] as unknown as Record<string, unknown>)[key]), `${section}.${key}`).not.toBe(
          JSON.stringify((DEFAULT_SETTINGS[section] as unknown as Record<string, unknown>)[key])
        );
      }
      // CHANGED must expose exactly the same set of keys as DEFAULT_SETTINGS for this section.
      expect(Object.keys(CHANGED[section]).sort()).toEqual(Object.keys(DEFAULT_SETTINGS[section]).sort());
    }
  });

  it('keeps every field through a save and reload', (): void => {
    // Serialize the fully-changed settings, then parse the text back into a fresh object.
    const loaded = parseSettings(serializeSettings(CHANGED));
    // The serializer must not report any problems for a well-formed settings object.
    expect(loaded.problems).toEqual([]);
    // Every field must survive the round trip unchanged.
    expect(loaded.settings).toEqual(CHANGED);
  });

  it('keeps an export setting a newer build wrote (FR-10.7)', () => {
    // A field this build does not know must survive being loaded and saved by it, or opening the file
    // in an older build would quietly delete a setting the newer one relies on.
    const parsed = parseSettings('{"export":{"comments":"endnotes","flavour":"portable"}}');
    const reloaded = parseSettings(serializeSettings(parsed.settings, parsed.unknownKeys));

    expect(reloaded.settings.export.comments).toBe('endnotes');
    expect(serializeSettings(parsed.settings, parsed.unknownKeys)).toContain('"flavour": "portable"');
  });

  it('keeps trusted domains through a save and reload', (): void => {
    // Build settings from a minimal file that only sets general.trustedDomains.
    const text = serializeSettings(parseSettings('{"general":{"trustedDomains":["example.com"]}}').settings);
    // The previously-forgotten trustedDomains field must survive the round trip (regression guard).
    expect(parseSettings(text).settings.general.trustedDomains).toEqual(['example.com']);
  });
});
