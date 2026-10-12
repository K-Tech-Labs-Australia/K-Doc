/**
 * @file ribbon-setting.ts
 * @purpose Defines the shape of a user-arranged ribbon layout and reads that shape out of raw settings data, tolerating malformed input by dropping only the offending tab or group.
 * @inputs value - The unknown payload read from the settings file where a ribbon layout was stored.
 * @outputs RibbonSettingResult - The tabs understood during parsing plus a flag indicating whether any entry had to be skipped.
 * @functions parseRibbonSetting: Reads an array of ribbon tabs out of arbitrary data, skipping malformed entries rather than failing the whole read.
 *   readTab: Validates and reads one tab object into a RibbonTabSetting, or returns null when it is unusable.
 *   readGroup: Validates and reads one group object into a RibbonGroupSetting, or returns null when it is unusable.
 *   isObject: Type guard that narrows unknown to Record<string, unknown> for non-null objects excluding arrays.
 * @dataflow Settings file → parseRibbonSetting iterates the array → readTab/readGroup validate each entry → valid entries collected into RibbonTabSetting[] with a skipped flag set on any failure.
 * @controlflow Guard against non-array input early; otherwise iterate every entry, reading each tab and flipping skipped when one fails to parse; return the accumulated tabs plus the skip flag.
 * @version 1
 * @date 2026-09-18
 */

/** One ribbon group as settings hold it: a heading and the commands under it, by id (FR-14.17). */
export interface RibbonGroupSetting {
  readonly title: string;
  readonly commands: readonly string[];
}

/** One ribbon tab as settings hold it (FR-14.17). */
export interface RibbonTabSetting {
  readonly tab: string;
  readonly groups: readonly RibbonGroupSetting[];
}

/** What reading a layout produced: the tabs that were understood, and whether anything was left out. */
export interface RibbonSettingResult {
  readonly tabs: readonly RibbonTabSetting[];
  readonly skipped: boolean;
}

// A tab or group entry must be a plain object to read any fields from it. Arrays are excluded because
// they are objects in JavaScript but carry no named keys, and null is rejected so its properties cannot
// be dereferenced without throwing. This guard narrows unknown down to Record<string, unknown> for the rest
// of each reader. Excluding arrays is belt and braces: a mutant that let them through survived the suite,
// because an array read out of a settings file carries none of the named fields either way, so every such
// entry is refused for want of a name rather than for being an array.
function isObject(value: unknown): value is Record<string, unknown> {
  // Reject primitives (including undefined) and arrays; keep only genuine non-null objects.
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads an array of ribbon tabs out of arbitrary settings data, skipping malformed entries rather than refusing the whole read.
 * @purpose Iterates whatever the settings file held and turns each tab-shaped entry into a RibbonTabSetting, recording whether anything had to be skipped.
 * @inputs value - The unknown payload stored under the ribbon layout key in the settings file.
 * @returns A RibbonSettingResult holding every understood tab plus a flag set when any entry was malformed.
 * @dataflow Raw settings array → per-entry readTab validation → collected tabs and accumulated skip flag returned to caller.
 * @controlflow Reject non-array input up front; otherwise loop each entry, reading its tab and flipping skipped on the first failure before returning.
 */
export function parseRibbonSetting(value: unknown): RibbonSettingResult {
  // The settings file must have stored an array of tabs; anything else means no layout was written at all.
  if (!Array.isArray(value)) {
    // value is not an array (object, string, number, null, etc.): there are zero tabs to read and the caller should know input was skipped.
    return { tabs: [], skipped: true };
  } else {
    // value is a real array; proceed to validate each of its entries one by one.
  }

  const tabs: RibbonTabSetting[] = [];
  let skipped = false;

  for (const entry of value as readonly unknown[]) {
    // Read the current entry into a tab, treating any malformed input as skippable rather than fatal.
    const tab = readTab(entry);
    if (tab === null) {
      // This entry could not be parsed: record that something was skipped but keep every previously valid tab intact.
      skipped = true;
    } else {
      // The entry is a well-formed tab: append it to the result set.
      tabs.push(tab);
    }
  }

  return { tabs, skipped };
}

/**
 * Reads one ribbon tab out of an unknown settings entry into a RibbonTabSetting, or returns null when it cannot be trusted.
 * @purpose Validates that an entry is a tab-shaped object with a non-empty name and a fully readable group list before returning it.
 * @inputs entry - The raw value stored under one position in the layout array of the settings file.
 * @returns A populated RibbonTabSetting when every field validates, or null if any part of the tab is malformed.
 * @dataflow Raw unknown → trimmed tab name string + each group read via readGroup → assembled RibbonTabSetting returned to caller.
 * @controlflow Reject non-object entries and blank names; then validate groups with an early-return guard so a single bad group fails the whole tab before returning.
 */
function readTab(entry: unknown): RibbonTabSetting | null {
  // A tab must be a plain object; arrays, primitives, and null carry no named fields worth reading.
  if (!isObject(entry)) {
    // entry is not an object (null, primitive, or array): there are no keys to read from it.
    return null;
  } else {
    // entry narrows to Record<string, unknown>; continue validating its individual fields.
  }

  const tab = extractTabName(entry);
  if (!tab) {
    // The "tab" field is missing, not a string, or blank after trimming: the group has no heading to show.
    return null;
  } else {
    // tab holds a non-empty trimmed string; keep it for the result.
  }

  const groups = extractGroups(entry);
  if (groups === null) {
    // The "groups" field is missing, wrong type, or contains any malformed group: reject the whole tab rather than drawing half of what was written.
    return null;
  } else {
    // Every entry validated and trimmed; assemble the final tab object.
    return { tab, groups };
  }
}

/**
 * Reads one ribbon group out of an unknown settings entry into a RibbonGroupSetting, or returns null when it cannot be trusted.
 * @purpose Validates that an entry is a group-shaped object with a non-empty title and a fully readable command list before returning it.
 * @inputs entry - The raw value stored under one group key inside a tab in the layout array of the settings file.
 * @returns A populated RibbonGroupSetting when every field validates, or null if any part of the group is malformed.
 * @dataflow Raw unknown → trimmed title string + each command read via extractCommands → new array of commands assembled into the result.
 * @controlflow Reject non-object entries and blank titles; then validate commands with an early-return guard so a single bad command fails the whole group before returning.
 */
function readGroup(entry: unknown): RibbonGroupSetting | null {
  // A group must be a plain object; arrays, primitives, and null carry no named fields worth reading.
  if (!isObject(entry)) {
    // entry is not an object (null, primitive, or array): there are no keys to read from it.
    return null;
  } else {
    // entry narrows to Record<string, unknown>; continue validating its individual fields.
  }

  const title = extractTitle(entry);
  if (!title) {
    // The "title" field is missing, not a string, or blank after trimming: the group has no heading to show.
    return null;
  } else {
    // title holds a non-empty trimmed string; keep it for the result.
  }

  const commands = extractCommands(entry);
  if (commands === null) {
    // The "commands" field is missing, wrong type, or contains any blank/non-string entry: reject the whole group rather than drawing half of what was written.
    return null;
  } else {
    // Every command validated and trimmed; assemble the final group object.
    return { title, commands };
  }
}

// Pulls the "tab" field out of a tab entry and trims it to a usable heading. Returns an empty string when the
// field is absent or not a plain string so that readTab can treat all malformed cases uniformly via one check.
function extractTabName(entry: Record<string, unknown>): string {
  // The "tab" value may be any type in settings; only accept genuine strings and coerce everything else to blank.
  if (typeof entry.tab === 'string') {
    // A real string was provided: trim surrounding whitespace so a name of spaces is treated as missing.
    return entry.tab.trim();
  } else {
    // The field is absent or not a string; signal emptiness with an empty string for the caller to reject.
    return '';
  }
}

// Pulls the "title" field out of a group entry and trims it to a usable heading, using the same convention as extractTabName.
function extractTitle(entry: Record<string, unknown>): string {
  // The "title" value may be any type in settings; only accept genuine strings and coerce everything else to blank.
  if (typeof entry.title === 'string') {
    // A real string was provided: trim surrounding whitespace so a title of spaces is treated as missing.
    return entry.title.trim();
  } else {
    // The field is absent or not a string; signal emptiness with an empty string for the caller to reject.
    return '';
  }
}

// Reads and validates the "groups" array from a tab entry, returning null if it is missing, wrong-typed, or holds any malformed group.
function extractGroups(entry: Record<string, unknown>): RibbonGroupSetting[] | null {
  // The "groups" value may be any type in settings; only accept genuine arrays and reject everything else outright.
  if (!Array.isArray(entry.groups)) {
    // groups is missing or not an array (object, string, number, etc.): a tab without a group list cannot be drawn.
    return null;
  } else {
    // entry.groups narrows to unknown[]; validate each element in turn before returning the collected result.
  }

  const groups: RibbonGroupSetting[] = [];

  for (const group of entry.groups) {
    // Read one group from its raw value, treating a malformed entry as fatal so it fails the whole tab rather than half-drawing it.
    const parsed = readGroup(group);
    if (parsed === null) {
      // This group failed validation: abort with null so no partially-built tab is returned to the caller.
      return null;
    } else {
      // The group validated cleanly: append it and continue scanning remaining groups.
      groups.push(parsed);
    }
  }

  return groups;
}

// Reads and validates the "commands" array from a group entry, returning null if it is missing, wrong-typed, or holds any blank/non-string command.
function extractCommands(entry: Record<string, unknown>): readonly string[] | null {
  // The "commands" value may be any type in settings; only accept genuine arrays and reject everything else outright.
  if (!Array.isArray(entry.commands)) {
    // commands is missing or not an array (object, string, number, etc.): a group with no command list cannot draw anything.
    return null;
  } else {
    // entry.commands narrows to unknown[]; validate each element in turn before returning the collected result.
  }

  const commands: string[] = [];

  for (const command of entry.commands) {
    // Each command must be a non-empty string after trimming so blank entries cannot slip into the drawn ribbon.
    if (typeof command !== 'string' || command.trim().length === 0) {
      // A command is missing, not a string, or blank after trimming: reject the whole group rather than drawing half of what was written.
      return null;
    } else {
      // The command is a non-empty string: keep its trimmed form in a fresh array so callers get an immutable copy.
      commands.push(command.trim());
    }
  }

  return commands;
}
