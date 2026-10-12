/**
 * @file history-settings.ts
 * @purpose The "history" settings section (FR-11.8): when local snapshots are taken and how long they are kept, parsed and serialized on its own like the snippets section.
 * @inputs the raw JSON value of the section.
 * @outputs HistorySettings, problems, preserved unknown keys, a serializable object.
 * @functions
 *   - parseHistorySection: Validate a raw history settings object into frozen HistorySettings, recording problems and preserving unknown keys.
 *   - serializeHistorySection: Convert frozen HistorySettings back into a plain serializable object.
 *   - describe: Return a human-readable type description for an unknown value.
 *   - isRecord: Type guard that reports whether a value is a non-null, non-array object.
 *   - parseWholeNumber: Validate and coerce a single numeric field within the section.
 * @dataflow raw JSON -> validated frozen settings; settings -> plain object.
 * @controlflow defaults for an absent section, error for a non-object, per-field warnings.
 * @version 1
 * @date 2026-09-16
 */

export interface HistorySettings {
  /** Take a snapshot after every successful save. */
  readonly snapshotOnSave: boolean;
  /** Take a snapshot of an open saved document this often, 0 for never (minutes). */
  readonly snapshotMinutes: number;
  /** Every snapshot younger than this many hours is kept. */
  readonly keepAllHours: number;
  /** Up to this many days the newest snapshot of each hour is kept. */
  readonly keepHourlyDays: number;
  /** Up to this many days the newest of each day is kept, older ones are deleted. */
  readonly keepDailyDays: number;
}

export interface HistoryProblem {
  /** JSON path of the offending field, e.g. "history.snapshotMinutes". */
  readonly path: string;
  /** Human-readable description of what was wrong with the value. */
  readonly message: string;
  /** Whether the problem should be surfaced as a warning or an error. */
  readonly severity: 'warning' | 'error';
}

/** The largest accepted value of each number field: a day of minutes, a year of hours, ten years of hourly days, a hundred years of daily days. */
export const HISTORY_LIMITS: Readonly<Record<'snapshotMinutes' | 'keepAllHours' | 'keepHourlyDays' | 'keepDailyDays', number>> = Object.freeze({
  snapshotMinutes: 1440,
  keepAllHours: 8760,
  keepHourlyDays: 3650,
  keepDailyDays: 36500,
});

/** The values used when a field is absent or invalid. */
export const DEFAULT_HISTORY_SETTINGS: HistorySettings = Object.freeze({
  snapshotOnSave: true,
  snapshotMinutes: 10,
  keepAllHours: 24,
  keepHourlyDays: 7,
  keepDailyDays: 90,
});

/** The set of keys this section understands; anything else is preserved as an unknown key. */
const HISTORY_FIELDS: ReadonlySet<string> = new Set<string>(['snapshotOnSave', 'snapshotMinutes', 'keepAllHours', 'keepHourlyDays', 'keepDailyDays']);

/** A numeric field name that has a documented upper bound in HISTORY_LIMITS. */
type HistoryNumberField = keyof typeof HISTORY_LIMITS;

/** describe returns a short, human-readable description of an unknown value for use in problem messages. */
function describe(value: unknown): string {
  // Distinguish null from arrays, strings, and every other type so messages read naturally.
  if (value === null) {
    return 'null';
  } else if (Array.isArray(value)) {
    return 'an array';
  } else if (typeof value === 'string') {
    return JSON.stringify(value);
  } else {
    return typeof value;
  }
}

/** isRecord reports whether value is a plain object rather than null or an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  // A record must be a non-null object that is not an array.
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** parseWholeNumber validates and coerces a single numeric field within the section. */
function parseWholeNumber(section: Record<string, unknown>, field: HistoryNumberField, problems: HistoryProblem[]): number {
  // Read the raw value and its documented upper bound for this field.
  const raw = section[field];
  const max = HISTORY_LIMITS[field];
  // Absent fields keep the default so callers need not supply every key.
  if (raw === undefined) {
    return DEFAULT_HISTORY_SETTINGS[field];
  } else if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= max) {
    // A whole number within [0, max] is accepted as-is.
    return raw;
  } else {
    // Anything else warns and keeps the default so a bad value cannot crash parsing.
    problems.push({ path: `history.${field}`, message: `Invalid value ${describe(raw)} for "history.${field}". Expected a whole number from 0 to ${max}.`, severity: 'warning' });
    return DEFAULT_HISTORY_SETTINGS[field];
  }
}

/** parseHistorySection validates a raw history settings object into frozen HistorySettings. */
export function parseHistorySection(value: unknown, problems: HistoryProblem[], unknownKeys: Record<string, unknown>): HistorySettings {
  // An absent section falls back to the defaults without recording any problem.
  if (value === undefined) {
    return DEFAULT_HISTORY_SETTINGS;
  } else if (!isRecord(value)) {
    // A non-object section is a hard error and yields the defaults.
    problems.push({ path: 'history', message: `Expected section "history" to be a JSON object, but received ${describe(value)}.`, severity: 'error' });
    return DEFAULT_HISTORY_SETTINGS;
  } else {
    // A valid object proceeds to per-field validation below.
  }

  // Route each top-level key either to unknown-key preservation or to field parsing.
  for (const key of Object.keys(value)) {
    // Keys this section does not recognize are preserved so a newer version can read them.
    if (!HISTORY_FIELDS.has(key)) {
      unknownKeys[`history.${key}`] = value[key];
    } else {
      // Recognized keys are handled by the per-field validators below; nothing to do here.
    }
  }

  // snapshotOnSave defaults to true and is only overridden by an explicit boolean.
  let snapshotOnSave = DEFAULT_HISTORY_SETTINGS.snapshotOnSave;
  const rawOnSave = value['snapshotOnSave'];
  // Absent snapshotOnSave keeps the default.
  if (rawOnSave === undefined) {
    // Absent: keep the default.
  } else if (typeof rawOnSave === 'boolean') {
    // An explicit boolean is accepted as-is.
    snapshotOnSave = rawOnSave;
  } else {
    // A non-boolean warns and keeps the default.
    problems.push({ path: 'history.snapshotOnSave', message: `Invalid value ${describe(rawOnSave)} for "history.snapshotOnSave". Expected true or false.`, severity: 'warning' });
  }

  // Assemble the frozen settings, validating each numeric field via parseWholeNumber.
  return Object.freeze({
    snapshotOnSave,
    snapshotMinutes: parseWholeNumber(value, 'snapshotMinutes', problems),
    keepAllHours: parseWholeNumber(value, 'keepAllHours', problems),
    keepHourlyDays: parseWholeNumber(value, 'keepHourlyDays', problems),
    keepDailyDays: parseWholeNumber(value, 'keepDailyDays', problems),
  });
}

/** serializeHistorySection converts frozen HistorySettings back into a plain serializable object. */
export function serializeHistorySection(settings: HistorySettings): Record<string, unknown> {
  // Rebuild a plain object with every known field so it can be written back to storage.
  return {
    snapshotOnSave: settings.snapshotOnSave,
    snapshotMinutes: settings.snapshotMinutes,
    keepAllHours: settings.keepAllHours,
    keepHourlyDays: settings.keepHourlyDays,
    keepDailyDays: settings.keepDailyDays,
  };
}
