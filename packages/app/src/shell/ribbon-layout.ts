/**
 * @file ribbon-layout.ts
 * @purpose Converts between the authoritative RIBBON_LAYOUT and the reader's own tab/group settings (FR-14.17), so an on-screen layout can seed the settings dialog and a saved setting can be resolved back into what the ribbon draws, dropping anything K-Doc does not have.
 * @inputs RibbonTabSpec[] layouts from ./ribbon.js; user-held RibbonTabSetting[]; command registry entries exposing ids for extraction.
 * @outputs readonly RibbonTabSetting[] describing how to seed settings; readonly RibbonTabSpec[] describing what the ribbon actually draws; ReadonlySet<string> of known command ids.
 * @functions
 *   - ribbonLayoutSetting: Turns an authoritative layout into the shape settings hold, seeding a saved setting from what is on screen.
 *   - resolveRibbonLayout: Resolves a user-held setting back into a drawable RibbonTabSpec[], dropping unknown tabs and commands and falling back to RIBBON_LAYOUT when nothing survives.
 *   - knownCommandIds: Derives the set of command ids a layout may name from the registry, so those ids are not written down twice.
 * @dataflow Registry commands -> knownCommandIds -> resolveRibbonLayout's `known` set; RIBBON_LAYOUT or saved RibbonTabSetting[] -> ribbonLayoutSetting/resolveRibbonLayout -> settings shape / drawable spec.
 * @controlflow Map layout to setting on seed; filter, deduplicate and drop unknowns on resolve, returning RIBBON_LAYOUT as fallback when the built tabs are empty.
 * @version 1
 * @date 2026-09-18
 */

import type { RibbonTabSetting } from '@k-doc/config';
import {
  RIBBON_LAYOUT,
  type RibbonTab,
  type RibbonGroup,
  type RibbonTabSpec,
} from './ribbon.js';

export type { RibbonGroupSetting, RibbonTabSetting } from '@k-doc/config';
/** The tabs a layout may name. Anything else is dropped: a tab K-Doc does not draw cannot be filled. */
export const RIBBON_TABS: readonly RibbonTab[] = ['Home', 'Insert', 'View'];

/**
 * @purpose Turns an authoritative layout into the shape settings hold, so the reader can be handed the one they are looking at as a starting point rather than a blank field.
 * @inputs layout - The authoritative RibbonTabSpec[] to convert (typically RIBBON_LAYOUT).
 * @outputs readonly RibbonTabSetting[] - One entry per tab, each with its groups and command ids copied by value.
 * @dataflow Each spec.tab -> setting.tab; each group.title/commands -> a RibbonGroupSetting whose commands array is a fresh copy.
 * @controlflow Map over layout in order; for each tab map its groups into settings shape; return the assembled list.
 */
export function ribbonLayoutSetting(
  layout: readonly RibbonTabSpec[],
): readonly RibbonTabSetting[] {
  return layout.map((spec) => ({
    tab: spec.tab,
    groups: spec.groups.map((group) => ({
      title: group.title,
      commands: [...group.commandIds],
    })),
  }));
}

/**
 * @purpose Resolves a user-held setting back into what the ribbon actually draws, dropping tabs and commands K-Doc does not have so a layout written for another build still works.
 * @inputs setting - The reader's saved RibbonTabSetting[]; known - The set of command ids K-Doc can currently draw (from the registry).
 * @outputs readonly RibbonTabSpec[] - The drawable layout, or RIBBON_LAYOUT when nothing survives filtering.
 * @dataflow Each entry.tab -> lookup in RIBBON_TABS; each group.commands -> filtered by `known` and deduplicated -> a RibbonGroup holding only kept ids.
 * @controlflow Return RIBBON_LAYOUT when setting is empty; otherwise build tabs, skipping unknown entries, groups with an empty trimmed title, groups left with no commands, and tabs without any groups; fall back to RIBBON_LAYOUT if the result is still empty.
 */
export function resolveRibbonLayout(
  setting: readonly RibbonTabSetting[],
  known: ReadonlySet<string>,
): readonly RibbonTabSpec[] {
  // An empty arrangement means none was saved. It needs no guard of its own: nothing survives the loop below
  // and the fallback at the end of this function returns K-Doc's own layout, which is the same answer.
  const tabs: RibbonTabSpec[] = [];

  for (let entryIdx = 0; entryIdx < setting.length; entryIdx++) {
    const entry = setting[entryIdx];
    if (entry === undefined) {
      // Setting index missing under noUncheckedIndexedAccess: skip.
      continue;
    } else {
      // Setting present.
    }

    // Match the entry's tab name against a tab K-Doc actually draws; an unknown tab cannot be filled in.
    const knownTab = RIBBON_TABS.find((tab) => tab === entry.tab);
    if (knownTab !== undefined) {
      // Entry names a real, drawable tab: build its groups from the setting.

      const groups: RibbonGroup[] = [];

      for (let groupIdx = 0; groupIdx < entry.groups.length; groupIdx++) {
        const group = entry.groups[groupIdx];
        if (group === undefined) {
          // Group index missing under noUncheckedIndexedAccess: skip.
          continue;
        } else {
          // Group present.
        }

        // Keep only ids K-Doc has, in the order written, dropping duplicates within this group.
        const seen = new Set<string>();
        const keptIds: string[] = [];

        for (let cmdIdx = 0; cmdIdx < group.commands.length; cmdIdx++) {
          const id = group.commands[cmdIdx];
          if (id === undefined) {
            // Command index missing under noUncheckedIndexedAccess: skip.
            continue;
          } else {
            // Command id present.
          }

          if (!known.has(id)) {
            // Command not in the registry: drop it rather than drawing a dead button.
            continue;
          } else {
            // Command is known to K-Doc.
          }

          if (seen.has(id)) {
            // Duplicate within this group: skip, since a button drawn twice is a mistake, not a choice.
            continue;
          } else {
            // First occurrence of this id in the group.
          }

          seen.add(id);
          keptIds.push(id);
        }

        if (group.title.trim().length === 0) {
          // Group has no heading after trimming whitespace: skip it.
          continue;
        } else {
          // Group retains a heading.
        }

        if (keptIds.length === 0) {
          // No commands survived filtering for this group: skip it.
          continue;
        } else {
          // Group has at least one command to render.
        }

        groups.push({ title: group.title, commandIds: keptIds });
      }

      if (groups.length === 0) {
        // Tab produced no valid groups: skip the tab entirely.
        continue;
      } else {
        // Tab has at least one group to render.
        tabs.push({ tab: knownTab, groups });
      }
    } else {
      // Entry names a tab K-Doc does not draw: drop this entry rather than leaving an empty panel.
    }
  }

  if (tabs.length === 0) {
    // No tab survived filtering: fall back to RIBBON_LAYOUT so the reader is never left with an empty ribbon.
    return RIBBON_LAYOUT;
  } else {
    // At least one tab was built from settings.
    return tabs;
  }
}

/**
 * @purpose Derives the set of command ids a layout may name from the registry, so those ids are not written down twice.
 * @inputs commands - The registry entries exposing an id; each contributes its id to the returned set.
 * @outputs ReadonlySet<string> - Unique command ids drawn by the current build.
 * @dataflow Each command.id -> added into a Set, which de-duplicates automatically as it is populated.
 * @controlflow Map every command's id and construct a Set from the resulting array; return the set.
 */
export function knownCommandIds(
  commands: readonly { readonly id: string }[],
): ReadonlySet<string> {
  return new Set(commands.map((command) => command.id));
}
