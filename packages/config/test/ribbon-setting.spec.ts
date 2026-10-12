/**
 * @file ribbon-setting.spec.ts
 * @purpose Verifies parsing of a user-written Ribbon arrangement (FR-14.17) and how parseSettings reads appearance.ribbon from JSON.
 * @inputs Parsed/JSON settings objects, raw non-array inputs, DEFAULT_SETTINGS, serializeSettings output.
 * @outputs Vitest assertions on parsed tabs/groups/commands, skipped flags, problems array, round-trip equality.
 * @functions (tests) parseRibbonSetting: whole arrangement; not-an-array; empty array; mixed good/bad tabs; bad groups; unusable group costs tab; bad commands; trimming; empty group kept; command copy. settings: default empty; read written; unreadable warns+keeps; non-array warns+empties; round trip.
 * @dataflow JSON/JS ribbon input → parseRibbonSetting / parseSettings → parsed structure + problems → expect assertions.
 * @controlflow describe blocks group unit tests for parseRibbonSetting and integration tests for appearance.ribbon in settings; each it() proves one behavior.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';

import { parseSettings, DEFAULT_SETTINGS, serializeSettings } from '../src/index.js';
import { parseRibbonSetting } from '../src/settings/ribbon-setting.js';

describe('parseRibbonSetting', () => {
  // Proves a whole arrangement reads into one tab with its group and commands in order.
  it('reads a whole arrangement: one tab, one group, ordered commands, skipped false', () => {
    const input = [
      {
        tab: 'Home',
        groups: [{ title: 'Text', commands: ['format:bold', 'format:italic'] }],
      },
    ];

    const result = parseRibbonSetting(input);

    expect(result.tabs).toHaveLength(1);
    expect(result.skipped).toBe(false);
    expect(result.tabs[0]?.tab).toBe('Home');
    expect(result.tabs[0]?.groups).toHaveLength(1);
    expect(result.tabs[0]?.groups[0]?.title).toBe('Text');
    expect(result.tabs[0]?.groups[0]?.commands).toEqual(['format:bold', 'format:italic']);
  });

  // Proves any non-array input is treated as unreadable and skipped.
  it('is not an array: an object, a string, null and undefined each read as nothing written', () => {
    expect(parseRibbonSetting({})).toEqual({ tabs: [], skipped: true });
    expect(parseRibbonSetting('Home')).toEqual({ tabs: [], skipped: true });
    expect(parseRibbonSetting(null)).toEqual({ tabs: [], skipped: true });
    expect(parseRibbonSetting(undefined)).toEqual({ tabs: [], skipped: true });
  });

  // Proves an explicit empty arrangement is valid (skipped false), not a broken write.
  it('an empty array reads as an empty arrangement with skipped false', () => {
    const result = parseRibbonSetting([]);

    expect(result.tabs).toHaveLength(0);
    expect(result.skipped).toBe(false);
  });

  // Proves only the usable tabs survive; a bad tab and a non-object both count as problems.
  it('keeps the tabs that read and leaves out the ones that do not', () => {
    const input = [
      { tab: 'Home', groups: [{ title: 'Text', commands: ['format:bold'] }] },
      7,
      { tab: '   ', groups: [] },
    ];

    const result = parseRibbonSetting(input);

    expect(result.tabs).toHaveLength(1);
    expect(result.skipped).toBe(true);
    expect(result.tabs[0]?.tab).toBe('Home');
  });

  // Proves a tab whose groups are not an array is dropped entirely.
  it('a tab whose groups are not an array is left out', () => {
    const input = [{ tab: 'Home', groups: 'Text' }];

    const result = parseRibbonSetting(input);

    expect(result.tabs).toHaveLength(0);
    expect(result.skipped).toBe(true);
  });

  // Proves one unusable group invalidates the whole tab (partial drawing is worse than none).
  it('one unusable group costs its whole tab', () => {
    const input = [
      {
        tab: 'Home',
        groups: [
          { title: 'Text', commands: ['format:bold'] },
          { title: '', commands: [] },
        ],
      },
    ];

    const result = parseRibbonSetting(input);

    expect(result.tabs).toHaveLength(0);
    expect(result.skipped).toBe(true);
  });

  // Proves a non-string command and a blank string each invalidate the tab.
  it('a command that is not a string costs the tab', () => {
    const input = [{ tab: 'Home', groups: [{ title: 'Text', commands: [3] }] }];

    const result = parseRibbonSetting(input);

    expect(result.tabs).toHaveLength(0);
    expect(result.skipped).toBe(true);
  });

  // Proves a blank (whitespace-only) command also invalidates the tab.
  it('a blank string command costs the tab', () => {
    const input = [{ tab: 'Home', groups: [{ title: 'Text', commands: ['  '] }] }];

    const result = parseRibbonSetting(input);

    expect(result.tabs).toHaveLength(0);
    expect(result.skipped).toBe(true);
  });

  // Proves names are trimmed on the way in.
  it('trims tab, group and command names', () => {
    const input = [
      {
        tab: '  Home  ',
        groups: [{ title: '  Text  ', commands: ['  format:bold  '] }],
      },
    ];

    const result = parseRibbonSetting(input);

    expect(result.tabs[0]?.tab).toBe('Home');
    expect(result.tabs[0]?.groups[0]?.title).toBe('Text');
    expect(result.tabs[0]?.groups[0]?.commands).toEqual(['format:bold']);
  });

  // Proves an empty group is a valid arrangement, not a mistake.
  it('a group with no commands at all is kept', () => {
    const input = [{ tab: 'Home', groups: [{ title: 'Text', commands: [] }] }];

    const result = parseRibbonSetting(input);

    expect(result.tabs).toHaveLength(1);
    expect(result.skipped).toBe(false);
    expect(result.tabs[0]?.groups[0]?.commands).toEqual([]);
  });

  // Proves the parsed commands array is a copy, not a live reference to the input.
  it('the commands array is a copy', () => {
    const commands = ['format:bold'];
    const input = [{ tab: 'Home', groups: [{ title: 'Text', commands }] }];

    const result = parseRibbonSetting(input);

    // Mutate the original after parsing; the parsed result must be unaffected.
    commands.push('format:italic');

    expect(commands).toEqual(['format:bold', 'format:italic']);
    expect(result.tabs[0]?.groups[0]?.commands).toEqual(['format:bold']);
  });
});

describe('appearance.ribbon in settings', () => {
  // Proves K-Doc ships with no arrangement of its own.
  it('ships with no arrangement of its own', () => {
    expect(DEFAULT_SETTINGS.appearance.ribbon).toHaveLength(0);
  });

  // Proves a written, valid arrangement is read cleanly with no problems.
  it('reads a written arrangement and reports no problems', () => {
    const json = JSON.stringify({ appearance: { ribbon: [{ tab: 'Insert', groups: [{ title: 'Blocks', commands: ['insert:table'] }] }] } });

    const result = parseSettings(json);

    expect(result.settings.appearance.ribbon).toHaveLength(1);
    expect(result.settings.appearance.ribbon[0]?.tab).toBe('Insert');
    expect(result.problems).toHaveLength(0);
  });

  // Proves an unreadable element warns once while the usable tab is still kept.
  it('an unreadable arrangement warns and keeps what read', () => {
    const json = JSON.stringify({ appearance: { ribbon: [{ tab: 'Home', groups: [] }, 7] } });

    const result = parseSettings(json);

    expect(result.settings.appearance.ribbon).toHaveLength(1);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.path).toBe('appearance.ribbon');
    expect(result.problems[0]?.severity).toBe('warning');
  });

  // Proves a non-array arrangement warns and leaves the ribbon empty.
  it('an arrangement that is not an array warns and leaves the ribbon empty', () => {
    const json = JSON.stringify({ appearance: { ribbon: 'Home' } });

    const result = parseSettings(json);

    expect(result.settings.appearance.ribbon).toHaveLength(0);
    expect(result.problems.some((problem) => problem.path === 'appearance.ribbon')).toBe(true);
  });

  // Proves an arrangement survives serialize → parse without losing its identity.
  it('survives a round trip through serializeSettings', () => {
    const ribbon = [{ tab: 'Home', groups: [{ title: 'Text', commands: ['format:bold'] }] }];
    const settingsObject = { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, ribbon } };

    const json = serializeSettings(settingsObject);
    const result = parseSettings(json);

    expect(result.settings.appearance.ribbon).toHaveLength(1);
    expect(result.settings.appearance.ribbon[0]?.tab).toBe('Home');
    expect(result.settings.appearance.ribbon[0]?.groups[0]?.title).toBe('Text');
    expect(result.settings.appearance.ribbon[0]?.groups[0]?.commands).toEqual(['format:bold']);
  });

  // A non-iterable groups field costs its tab instead of throwing when walked over it.
  it('a groups field that cannot be walked over costs its tab', () => {
    expect(parseRibbonSetting([{ tab: 'Home', groups: 7 }])).toEqual({ tabs: [], skipped: true });
    // A boolean is not iterable at all and must be refused the same way, never thrown over.
    expect(parseRibbonSetting([{ tab: 'Home', groups: true }])).toEqual({ tabs: [], skipped: true });
  });

  // A string commands field is not read as its individual letters when walked.
  it('a commands field that is one string is not read as its letters', () => {
    expect(parseRibbonSetting([{ tab: 'Home', groups: [{ title: 'Text', commands: 'format:bold' }] }])).toEqual({ tabs: [], skipped: true });
    // A number of commands is likewise unwalkable and must be refused rather than thrown over.
    expect(parseRibbonSetting([{ tab: 'Home', groups: [{ title: 'Text', commands: 7 }] }])).toEqual({ tabs: [], skipped: true });
  });

  // A stray space around the tab name and group title is trimmed independently of anything else.
  it('a tab name and a group title are trimmed on their own', () => {
    const result = parseRibbonSetting([{ tab: ' Home ', groups: [{ title: ' Text ', commands: ['format:bold'] }] }]);
    expect(result.tabs[0]?.tab).toBe('Home');
    // The group title is trimmed to exactly 'Text' with no surrounding whitespace.
    expect(result.tabs[0]?.groups[0]?.title).toBe('Text');
  });
});
