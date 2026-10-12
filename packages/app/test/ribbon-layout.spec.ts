/**
 * @file ribbon-layout.spec.ts
 * @purpose Exercises the two pure modules behind K-Doc's customisable ribbon (FR-14.17): ribbon-layout.ts converts between the authoritative RIBBON_LAYOUT and reader settings, and ribbon-editing.ts performs the four non-mutating edit operations on a ribbon arrangement.
 * @inputs The HOME fixture layout, the KNOWN command-id set, imported RIBBON_LAYOUT/RIBBON_TABS, and the functions under test from ../src/shell/*.
 * @outputs No runtime output; assertions over returned layouts prove each contract of ribbonLayoutSetting, knownCommandIds, resolveRibbonLayout, moveCommand, removeCommand, addCommand and moveGroup.
 * @functions
 *   - describe: groups tests by module/function under test.
 *   - it: one focused assertion set per behaviour listed in the FR-14.17 blueprint.
 * @dataflow Fixture + imports → each `it` calls a pure function → expect reads the returned layout with safe index access → toBe/toEqual/not.toBe assert the contract.
 * @controlflow Module-scope fixtures declared once and never mutated; describe blocks run their it callbacks in declaration order, each returning after its assertions complete.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { RIBBON_LAYOUT } from '../src/shell/ribbon.js';
import { knownCommandIds, resolveRibbonLayout, ribbonLayoutSetting, RIBBON_TABS } from '../src/shell/ribbon-layout.js';
import { addCommand, moveCommand, moveGroup, removeCommand } from '../src/shell/ribbon-editing.js';
import type { RibbonTabSetting } from '@k-doc/config';

// The canonical single-tab arrangement every test reads from; declared once and never mutated.
const HOME: readonly RibbonTabSetting[] = [
  { tab: 'Home', groups: [{ title: 'Text', commands: ['format:bold', 'format:italic', 'format:code'] }, { title: 'Paragraph', commands: ['format:h1'] }] },
];

// The command ids K-Doc can currently draw, used as the `known` set for resolveRibbonLayout.
const KNOWN: ReadonlySet<string> = new Set<string>(['format:bold', 'format:italic', 'format:code', 'format:h1']);

describe('ribbonLayoutSetting', () => {
  // Proves a layout is turned into one setting per tab, with matching names and titles.
  it('produces one setting per tab whose first tab name and group title match the source layout', () => {
    const out = ribbonLayoutSetting(RIBBON_LAYOUT);

    expect(out.length).toBe(RIBBON_LAYOUT.length);
    expect(out[0]?.tab).toBe(RIBBON_LAYOUT[0]?.tab);
    expect(out[0]?.groups[0]?.title).toBe(RIBBON_LAYOUT[0]?.groups[0]?.title);
  });

  // Proves the commands are copied by value rather than shared with the source array.
  it('copies each group command list so values match but the array object is not shared', () => {
    const out = ribbonLayoutSetting(RIBBON_LAYOUT);

    expect(out[0]?.groups[0]?.commands).toEqual(RIBBON_LAYOUT[0]?.groups[0]?.commandIds);
    expect(out[0]?.groups[0]?.commands).not.toBe(RIBBON_LAYOUT[0]?.groups[0]?.commandIds);
  });
});

describe('what the dialog is seeded with', () => {
  // Proves the composition the shell opens the dialog with: an empty arrangement resolves to K-Doc's own
  // layout and comes back as an editable setting, so a reader who has never arranged the ribbon still
  // starts from the one they are looking at rather than from nothing.
  it("seeds an editable arrangement from K-Doc's own ribbon when none was saved", () => {
    const seeded = ribbonLayoutSetting(resolveRibbonLayout([], KNOWN));

    expect(seeded.length).toBe(RIBBON_LAYOUT.length);
    expect(seeded[0]?.tab).toBe(RIBBON_LAYOUT[0]?.tab);
    expect(seeded[0]?.groups[0]?.commands).toEqual(RIBBON_LAYOUT[0]?.groups[0]?.commandIds);
  });
});

describe('knownCommandIds', () => {
  // Proves ids are collected into a de-duplicating set of the expected size.
  it('collects every command id from the registry entries into a set of that size', () => {
    const set = knownCommandIds([{ id: 'a' }, { id: 'b' }]);

    expect(set.size).toBe(2);
    expect(set.has('a')).toBe(true);
    expect(set.has('b')).toBe(true);
  });

  // Proves an empty registry yields no command ids at all.
  it('returns an empty set when the registry is empty', () => {
    const set = knownCommandIds([]);

    expect(set.size).toBe(0);
  });
});

describe('resolveRibbonLayout', () => {
  // Proves an absent setting falls back to K-Doc's authoritative layout by identity.
  it('resolves an empty arrangement to RIBBON_LAYOUT itself', () => {
    expect(resolveRibbonLayout([], KNOWN)).toBe(RIBBON_LAYOUT);
  });

  // Proves a well-formed setting is drawn tab, group and command for command.
  it('draws HOME as one Home tab with two groups whose first holds all three commands', () => {
    const out = resolveRibbonLayout(HOME, KNOWN);

    expect(out.length).toBe(1);
    expect(out[0]?.tab).toBe('Home');
    expect(out[0]?.groups.length).toBe(2);
    expect(out[0]?.groups[0]?.commandIds.length).toBe(3);
  });

  // Proves an unknown id is dropped while its group survives with the known ids in order.
  it('drops an unknown command id but keeps its group, filtering to the surviving ids', () => {
    const slim = new Set<string>(['format:bold', 'format:code', 'format:h1']);
    const out = resolveRibbonLayout(HOME, slim);

    expect(out[0]?.groups[0]?.commandIds).toEqual(['format:bold', 'format:code']);
  });

  // Proves a tab K-Doc does not draw is dropped entirely.
  it('drops an arrangement naming a tab K-Doc does not draw, falling back to RIBBON_LAYOUT', () => {
    const fanfare: readonly RibbonTabSetting[] = [
      { tab: 'Fanfare', groups: [{ title: 'Odd', commands: ['format:bold'] }] },
    ];

    expect(resolveRibbonLayout(fanfare, KNOWN)).toBe(RIBBON_LAYOUT);
  });

  // Proves a command duplicated within one group is drawn only once.
  it('draws a duplicate command inside a single group exactly once', () => {
    const dupes: readonly RibbonTabSetting[] = [
      { tab: 'Home', groups: [{ title: 'Text', commands: ['format:bold', 'format:bold'] }] },
    ];
    const out = resolveRibbonLayout(dupes, KNOWN);

    expect(out[0]?.groups[0]?.commandIds.length).toBe(1);
  });

  // Proves a group with no title is dropped while its titled siblings remain.
  it('drops a group whose trimmed title is empty but keeps the groups that have one', () => {
    const blankTitle: readonly RibbonTabSetting[] = [
      { tab: 'Home', groups: [{ title: '', commands: ['format:bold'] }, { title: 'Text', commands: ['format:italic'] }] },
    ];
    const out = resolveRibbonLayout(blankTitle, KNOWN);

    expect(out[0]?.groups.length).toBe(1);
    expect(out[0]?.groups[0]?.title).toBe('Text');
  });

  // Proves a tab whose every group was dropped does not survive the resolve.
  it('drops a tab whose groups were all removed, falling back to RIBBON_LAYOUT', () => {
    const emptied: readonly RibbonTabSetting[] = [
      { tab: 'Home', groups: [{ title: '', commands: ['format:bold'] }] },
    ];

    expect(resolveRibbonLayout(emptied, KNOWN)).toBe(RIBBON_LAYOUT);
  });

  // Proves an arrangement of only fully-dropped tabs resolves to K-Doc's own layout.
  it('resolves an arrangement of only dropped tabs back to RIBBON_LAYOUT', () => {
    const allDropped: readonly RibbonTabSetting[] = [
      { tab: 'Home', groups: [{ title: '', commands: ['format:bold'] }] },
      { tab: 'Insert', groups: [{ title: '', commands: ['format:h1'] }] },
    ];

    expect(resolveRibbonLayout(allDropped, KNOWN)).toBe(RIBBON_LAYOUT);
  });

  // A group whose every command is unknown is dropped while its surviving siblings remain.
  it('a group whose every command is unknown is dropped, and its siblings are not', () => {
    const result = resolveRibbonLayout([{ tab: 'Home', groups: [{ title: 'Ghosts', commands: ['format:ghost'] }, { title: 'Text', commands: ['format:bold'] }] }], KNOWN);
    // Only the Text group survives, so there is exactly one tab holding exactly one group.
    expect(result.length).toBe(1);
    expect(result[0]?.groups.length).toBe(1);
    // The surviving group keeps its original title untouched by the drop.
    expect(result[0]?.groups[0]?.title).toBe('Text');
  });

  // An arrangement holding one good tab is not replaced with K-Doc's own default layout.
  it('an arrangement holding one good tab is not K-Doc\'s own', () => {
    const result = resolveRibbonLayout([{ tab: 'View', groups: [{ title: 'Panes', commands: ['format:bold'] }] }], KNOWN);
    // format:bold survives, so a fresh layout is produced rather than the shared fallback reference.
    expect(result).not.toBe(RIBBON_LAYOUT);
    // The surviving arrangement keeps its only tab named exactly as supplied.
    expect(result[0]?.tab).toBe('View');
  });

  // Proves RIBBON_TABS names exactly the three tabs K-Doc draws.
  it('names Home, Insert and View as the only drawable tabs', () => {
    expect(RIBBON_TABS.length).toBe(3);
    expect(RIBBON_TABS[0]).toBe('Home');
    expect(RIBBON_TABS[1]).toBe('Insert');
    expect(RIBBON_TABS[2]).toBe('View');
  });
});

describe('moveCommand', () => {
  // Proves a +1 delta swaps the target command with the one below it.
  it('moves a command down by one within its group', () => {
    const out = moveCommand(HOME, 0, 0, 0, 1);

    expect(out[0]?.groups[0]?.commands).toEqual(['format:italic', 'format:bold', 'format:code']);
  });

  // Proves a -1 delta swaps the target command with the one above it.
  it('moves a command up by one within its group', () => {
    const out = moveCommand(HOME, 0, 0, 2, -1);

    expect(out[0]?.groups[0]?.commands).toEqual(['format:bold', 'format:code', 'format:italic']);
  });

  // Proves a shift off the top of the group is rejected and returns the input unchanged.
  it('does not move a command that would leave the top of its group', () => {
    expect(moveCommand(HOME, 0, 0, 0, -1)).toBe(HOME);
  });

  // Proves a shift off the bottom of the group is rejected and returns the input unchanged.
  it('does not move a command that would leave the bottom of its group', () => {
    expect(moveCommand(HOME, 0, 0, 2, 1)).toBe(HOME);
  });

  // Proves an out-of-range tab index is treated as no-op.
  it('does not move when the tab index names nothing', () => {
    expect(moveCommand(HOME, 9, 0, 0, 1)).toBe(HOME);
  });

  // Proves an out-of-range group index is treated as no-op.
  it('does not move when the group index names nothing', () => {
    expect(moveCommand(HOME, 0, 9, 0, 1)).toBe(HOME);
  });

  // Proves an out-of-range command index is treated as no-op.
  it('does not move when the command index names nothing', () => {
    expect(moveCommand(HOME, 0, 0, 9, 1)).toBe(HOME);
  });

  // Proves the source layout's first group keeps its original commands and order after a move.
  it('leaves the input arrangement untouched by a valid move', () => {
    moveCommand(HOME, 0, 0, 0, 1);

    expect(HOME[0]?.groups[0]?.commands).toEqual(['format:bold', 'format:italic', 'format:code']);
  });

  // Proves the sibling group is not rebuilt and keeps its original array reference.
  it('preserves the untouched group as the same object after a move in another group', () => {
    const out = moveCommand(HOME, 0, 0, 0, 1);

    expect(out[0]?.groups[1]).toBe(HOME[0]?.groups[1]);
  });
});

describe('removeCommand', () => {
  // Proves removing a command drops exactly that one and keeps the rest in order.
  it('drops the single named command from its group', () => {
    const out = removeCommand(HOME, 0, 0, 1);

    expect(out[0]?.groups[0]?.commands).toEqual(['format:bold', 'format:code']);
  });

  // Proves an index that names no command removes nothing.
  it('removes nothing when the command index is out of range or negative', () => {
    expect(removeCommand(HOME, 0, 0, 9)).toBe(HOME);
    expect(removeCommand(HOME, 0, 0, -1)).toBe(HOME);
  });

  // Proves removing the last command leaves an empty group rather than dropping it.
  it('leaves a surviving but now-empty group when its final command is removed', () => {
    const out = removeCommand(HOME, 0, 1, 0);

    expect(out[0]?.groups.length).toBe(2);
    expect(out[0]?.groups[1]?.commands.length).toBe(0);
  });
});

describe('addCommand', () => {
  // Proves appending adds the new id at the end of the target group.
  it('appends a new command to the end of its group', () => {
    const out = addCommand(HOME, 0, 1, 'format:h2');

    expect(out[0]?.groups[1]?.commands).toEqual(['format:h1', 'format:h2']);
  });

  // Proves a command already present in the group is not added again.
  it('does not add a command that is already in the target group', () => {
    expect(addCommand(HOME, 0, 0, 'format:bold')).toBe(HOME);
  });

  // Proves a blank id adds nothing to the group.
  it('adds nothing when the supplied id is empty after trimming', () => {
    expect(addCommand(HOME, 0, 0, '   ')).toBe(HOME);
  });

  // Proves the same command may live in two different groups at once.
  it('allows a command to be added to another group while keeping it where it already was', () => {
    const out = addCommand(HOME, 0, 1, 'format:bold');

    expect(out[0]?.groups[0]?.commands).toEqual(['format:bold', 'format:italic', 'format:code']);
    expect(out[0]?.groups[1]?.commands).toEqual(['format:h1', 'format:bold']);
  });
});

describe('moveGroup', () => {
  // Proves a +1 delta swaps the target group with the one below it.
  it('moves a group down by one within its tab', () => {
    const out = moveGroup(HOME, 0, 0, 1);

    expect(out[0]?.groups.map((group) => group.title)).toEqual(['Paragraph', 'Text']);
  });

  // Proves a shift off either end of the groups list is rejected.
  it('does not move a group that would leave either end of its tab', () => {
    expect(moveGroup(HOME, 0, 0, -1)).toBe(HOME);
    expect(moveGroup(HOME, 0, 1, 1)).toBe(HOME);
  });

  // Proves an out-of-range tab index is treated as no-op.
  it('does not move a group when the tab index names nothing', () => {
    expect(moveGroup(HOME, 9, 0, 1)).toBe(HOME);
  });
});
