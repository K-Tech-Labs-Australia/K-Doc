/**
 * @file ribbon-editing.ts
 * @purpose Provides the four pure edit operations a reader performs on a ribbon arrangement (FR-14.17): moving or removing a command within a group, appending a command to a group, and moving an entire group within its tab. Each function returns a new layout without mutating its input so the dialog that calls them holds no logic of its own.
 * @inputs A readonly array of RibbonTabSetting (the current ribbon arrangement) plus navigation indices (tabIndex, groupIndex, commandIndex), a signed movement delta, or a commandId to append; every index is validated before use.
 * @outputs A new readonly RibbonTabSetting[] reflecting the edit; when an index names nothing or an argument is invalid the original layout is returned unchanged rather than throwing.
 * @functions
 *   - moveCommand: Moves one command within its group by delta places (-1 up, +1 down).
 *   - removeCommand: Drops one command from its group.
 *   - addCommand: Appends a new command to the end of a group.
 *   - moveGroup: Moves an entire group within its tab by delta places using the same rules as moveCommand.
 *   - groupAt: Resolves the RibbonGroupSetting at a given tab and group index, or undefined when out of range.
 *   - withGroup: Returns a copy of layout with one group replaced in place while preserving tab identity.
 *   - replaceTab: Returns a copy of layout with one tab replaced in place by its indices.
 * @dataflow Navigation indices → groupAt resolves the owning element (tab, then group) → each edit builds fresh arrays from copies of that element's contents → withGroup/replaceTab splice them back into new top-level arrays via map.
 * @controlflow Each entry point resolves its target through a helper or direct read, validates every index and argument against range bounds before mutating, applies the change only to copied structures when valid, and otherwise returns the input unchanged; no branch throws.
 * @version 1
 * @date 2026-09-18
 */

import type { RibbonGroupSetting, RibbonTabSetting } from '@k-doc/config';

/**
 * @purpose Moves a single command within its group by delta places (-1 up, +1 down), returning a new layout.
 * @inputs layout - the current ribbon arrangement; tabIndex, groupIndex, commandIndex - indices locating the target command; delta - signed number of places to shift the command.
 * @outputs A new readonly RibbonTabSetting[] with the command repositioned, or the original layout when any index names nothing or the move would leave valid bounds.
 * @dataflow Indices → groupAt resolves the owning group → range checks validate source and target slots against both ends of the command list → a copied commands array swaps the two entries → withGroup rebuilds the tab and returns it.
 * @controlflow Resolve the group; return early when undefined, then reject any out-of-range slot before performing the swap on copies, otherwise fall through to build the new layout.
 */
export function moveCommand(
  layout: readonly RibbonTabSetting[],
  tabIndex: number,
  groupIndex: number,
  commandIndex: number,
  delta: number,
): readonly RibbonTabSetting[] {
  // Resolve the owning group; a tab or group that does not exist cannot be edited.
  const group = groupAt(layout, tabIndex, groupIndex);

  if (group === undefined) {
    // The named tab or group is out of range: there is nothing to move, so return unchanged.
    return layout;
  } else {
    // Both indices name a real group; continue validating the command slot within it.
  }

  // Where the command would land. A slot off either end reads as undefined below, which is the bounds check.
  const target = commandIndex + delta;

  // Copy so the original group's commands array is never mutated before reordering.
  const commands = [...group.commands];
  const moved = commands[commandIndex];
  const displaced = commands[target];

  if (moved === undefined || displaced === undefined) {
    // Either the command or the place it would go is off the end of the group: a move out of range is not a
    // move, so return unchanged. This is the only bounds check the swap needs, and the one the type demands.
    return layout;
  } else {
    // Both entries are defined; swap them into the copied array without touching the original.
  }

  commands[commandIndex] = displaced;
  commands[target] = moved;

  // Rebuild the group and tab with the reordered command list, preserving the group title.
  return withGroup(layout, tabIndex, groupIndex, { title: group.title, commands });
}

/**
 * @purpose Drops a single command from its group and returns a new layout without mutating the input.
 * @inputs layout - the current ribbon arrangement; tabIndex, groupIndex, commandIndex - indices locating the command to remove.
 * @outputs A new readonly RibbonTabSetting[] with the target command filtered out, or the original layout when any index names nothing.
 * @dataflow Indices → groupAt resolves the owning group → range check validates the slot against both ends of the list → filter builds a fresh commands array excluding that index → withGroup rebuilds the tab and returns it.
 * @controlflow Resolve the group; return early when undefined, then reject an out-of-range commandIndex before filtering, otherwise fall through to build the new layout.
 */
export function removeCommand(
  layout: readonly RibbonTabSetting[],
  tabIndex: number,
  groupIndex: number,
  commandIndex: number,
): readonly RibbonTabSetting[] {
  // Resolve the owning group; a tab or group that does not exist cannot be edited.
  const group = groupAt(layout, tabIndex, groupIndex);

  if (group === undefined) {
    // The named tab or group is out of range: there is nothing to remove, so return unchanged.
    return layout;
  } else {
    // Both indices name a real group; continue validating the command slot within it.
  }

  // Reject an index that names no command in this group before filtering anything out.
  if (commandIndex < 0 || commandIndex >= group.commands.length) {
    // The source slot is off either end: there is nothing to remove, so return unchanged.
    return layout;
  } else {
    // The slot is in bounds; proceed to build the filtered command list on a new array.
  }

  // Build a fresh array excluding exactly the target index so the original group stays untouched.
  const commands = group.commands.filter((_command: string, index: number) => index !== commandIndex);

  return withGroup(layout, tabIndex, groupIndex, { title: group.title, commands });
}

/**
 * @purpose Appends a new command to the end of a group and returns a new layout without mutating the input.
 * @inputs layout - the current ribbon arrangement; tabIndex, groupIndex - indices locating the target group; commandId - identifier of the command to append.
 * @outputs A new readonly RibbonTabSetting[] with the appended command, or the original layout when any index names nothing or the id is empty after trimming or already present in the group.
 * @dataflow Indices → groupAt resolves the owning group → validation rejects an empty-after-trim or duplicate id → a copied commands array appends the new id at the end → withGroup rebuilds the tab and returns it.
 * @controlflow Resolve the group; return early when undefined, then reject a blank or already-present commandId before appending, otherwise fall through to build the new layout.
 */
export function addCommand(
  layout: readonly RibbonTabSetting[],
  tabIndex: number,
  groupIndex: number,
  commandId: string,
): readonly RibbonTabSetting[] {
  // Resolve the owning group; a tab or group that does not exist cannot be edited.
  const group = groupAt(layout, tabIndex, groupIndex);

  if (group === undefined) {
    // The named tab or group is out of range: there is nothing to add, so return unchanged.
    return layout;
  } else {
    // Both indices name a real group; continue validating the command id before appending.
  }

  // Reject an empty-after-trim id and any id already present in this group (a duplicated button).
  if (commandId.trim() === '' || group.commands.includes(commandId)) {
    // The id is blank or already exists: adding it would be a mistake, so return unchanged.
    return layout;
  } else {
    // The id is usable and new; proceed to append it onto a copy of the command list.
  }

  // Copy then append so the original group's commands array is never mutated in place.
  const commands = [...group.commands, commandId];

  return withGroup(layout, tabIndex, groupIndex, { title: group.title, commands });
}

/**
 * @purpose Moves an entire group within its tab by delta places (-1 up, +1 down), returning a new layout using the same rules as moveCommand.
 * @inputs layout - the current ribbon arrangement; tabIndex, groupIndex - indices locating the target group; delta - signed number of places to shift the group.
 * @outputs A new readonly RibbonTabSetting[] with the group repositioned, or the original layout when any index names nothing or the move would leave valid bounds.
 * @dataflow Indices → direct read resolves the owning tab → range checks validate source and target slots against both ends of the groups list → a copied groups array swaps the two entries → replaceTab rebuilds the top-level array and returns it.
 * @controlflow Resolve the tab; return early when undefined, then reject any out-of-range slot before performing the swap on copies, otherwise fall through to build the new layout.
 */
export function moveGroup(
  layout: readonly RibbonTabSetting[],
  tabIndex: number,
  groupIndex: number,
  delta: number,
): readonly RibbonTabSetting[] {
  // Read the owning tab directly; an out-of-range index resolves to undefined and cannot be edited.
  const tab = layout[tabIndex];

  if (tab === undefined) {
    // The named tab is out of range: there is nothing to move, so return unchanged.
    return layout;
  } else {
    // The tab exists; continue validating the group slot within its groups list.
  }

  // Where the group would land. A slot off either end reads as undefined below, which is the bounds check.
  const target = groupIndex + delta;

  // Copy so the original tab's groups array is never mutated before reordering.
  const groups = [...tab.groups];
  const moved = groups[groupIndex];
  const displaced = groups[target];

  if (moved === undefined || displaced === undefined) {
    // Either the group or the place it would go is off the end of the tab: a move out of range is not a move,
    // so return unchanged. This is the only bounds check the swap needs, and the one the type demands.
    return layout;
  } else {
    // Both entries are defined; swap them into the copied array without touching the original.
  }

  groups[groupIndex] = displaced;
  groups[target] = moved;

  // Rebuild the top-level array with the reordered group list, preserving tab identity via its name.
  return replaceTab(layout, tabIndex, { tab: tab.tab, groups });
}

/**
 * @purpose Resolves the RibbonGroupSetting located at a given tab and group index, or undefined when either index is out of range.
 * @inputs layout - the current ribbon arrangement; tabIndex, groupIndex - indices locating the desired group.
 * @outputs The matching RibbonGroupSetting, or undefined when the tab does not exist or the group index exceeds its bounds.
 * @dataflow Indices → direct read of layout[tabIndex] yields a tab | undefined under noUncheckedIndexedAccess → if present, return tab.groups[groupIndex], which is itself RibbonGroupSetting | undefined.
 * @controlflow Two sequential indexed reads with an implicit optional result: the function returns whatever the second index resolves to without branching, so both out-of-range reads surface as undefined rather than throwing.
 */
function groupAt(
  layout: readonly RibbonTabSetting[],
  tabIndex: number,
  groupIndex: number,
): RibbonGroupSetting | undefined {
  // Read the owning tab; an out-of-range index resolves to undefined under noUncheckedIndexedAccess.
  const tab = layout[tabIndex];

  if (tab === undefined) {
    // The named tab does not exist: propagate undefined so the caller treats it as uneditable.
    return undefined;
  } else {
    // The tab exists; resolve and return its group at the requested index, also possibly undefined.
  }

  return tab.groups[groupIndex];
}

/**
 * @purpose Returns a copy of layout with one group replaced in place while preserving that tab's identity (its name).
 * @inputs layout - the current ribbon arrangement; tabIndex, groupIndex - indices locating the group to replace; group - the new RibbonGroupSetting value to substitute.
 * @outputs A new readonly RibbonTabSetting[] identical to layout except at tabIndex, whose groups array has the target slot replaced by group.
 * @dataflow Indices → direct read resolves the owning tab (or undefined) → map rebuilds each group, substituting group only where index matches → replaceTab splices the rebuilt tab into a fresh top-level array and returns it.
 * @controlflow Resolve the tab; return early when undefined so an out-of-range edit leaves layout untouched, otherwise build new arrays for both groups and the top level via map before returning through replaceTab.
 */
function withGroup(
  layout: readonly RibbonTabSetting[],
  tabIndex: number,
  groupIndex: number,
  group: RibbonGroupSetting,
): readonly RibbonTabSetting[] {
  // Read the owning tab; an out-of-range index resolves to undefined and cannot be edited.
  const tab = layout[tabIndex];

  if (tab === undefined) {
    // The named tab does not exist: there is no group slot to replace, so return unchanged.
    return layout;
  } else {
    // The tab exists; rebuild its groups array with the target slot substituted in place.
  }

  // Rebuild every group via map; only the matching index receives the replacement, the rest keep their own reference.
  const groups = tab.groups.map((existing: RibbonGroupSetting, index: number) => (index === groupIndex ? group : existing));

  return replaceTab(layout, tabIndex, { tab: tab.tab, groups });
}

/**
 * @purpose Returns a copy of layout with one tab replaced in place by its indices.
 * @inputs layout - the current ribbon arrangement; tabIndex - index locating the tab to replace; tab - the new RibbonTabSetting value to substitute.
 * @outputs A new readonly RibbonTabSetting[] identical to layout except at tabIndex, which is now the provided tab value.
 * @dataflow Indices → map rebuilds each entry, substituting tab only where index matches → returns that fresh top-level array as the result.
 * @controlflow No early return: every element passes through a single indexed comparison and either keeps its original reference or takes the replacement, so layout is never mutated in place.
 */
function replaceTab(
  layout: readonly RibbonTabSetting[],
  tabIndex: number,
  tab: RibbonTabSetting,
): readonly RibbonTabSetting[] {
  // Rebuild every entry via map; only the matching index receives the new tab value.
  return layout.map((existing: RibbonTabSetting, index: number) => (index === tabIndex ? tab : existing));
}
