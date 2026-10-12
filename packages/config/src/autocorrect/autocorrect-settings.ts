/**
 * @file autocorrect-settings.ts
 * @purpose The "autocorrect" settings section (FR-7.8): one switch per smart substitution plus the user's replacement table, parsed and serialized on its own like the keyboard section.
 * @inputs The raw JSON value of the "autocorrect" section; problem and unknown-key accumulators.
 * @outputs AutocorrectSettings, AutocorrectProblem[], preserved unknown keys, a serializable object.
 * @functions
 *   - describe: Human-readable label for an unknown value used in messages.
 *   - isRecord: Type guard narrowing a value to a plain object record.
 *   - isValidReplacementKey: Validates a replacement search key (no whitespace).
 *   - isValidReplacementValue: Validates a replacement value length.
 *   - parseAutocorrectSection: Parses and validates the raw section into frozen settings.
 *   - serializeAutocorrectSection: Serializes settings back to a plain, sorted object.
 * @dataflow Raw JSON → validated frozen settings → sorted plain serializable object.
 * @controlflow Defaults for an absent section; error for a non-object; per-field warnings otherwise.
 * @version 1
 * @date 2026-09-16
 */

export interface AutocorrectSettings {
  readonly smartQuotes: boolean;
  readonly dashes: boolean;
  readonly ellipsis: boolean;
  readonly ordinals: boolean;
  readonly capitalizeSentences: boolean;
  readonly replaceText: boolean;
  readonly replacements: Readonly<Record<string, string>>;
}

// A local problem type is used here to avoid a module cycle with schema.ts.
export interface AutocorrectProblem {
  readonly path: string;
  readonly message: string;
  readonly severity: 'warning' | 'error';
}

export const MAX_REPLACEMENT_LENGTH = 200;

// Ordinals and sentence capitals are off by default because they change what the user typed the most.
// The default table is a few symbols and common misspellings only.
export const DEFAULT_AUTOCORRECT_REPLACEMENTS: Readonly<Record<string, string>> = Object.freeze({
  '(c)': '©',
  '(r)': '®',
  '(tm)': '™',
  adn: 'and',
  recieve: 'receive',
  seperate: 'separate',
  teh: 'the',
});

export const DEFAULT_AUTOCORRECT_SETTINGS: AutocorrectSettings = Object.freeze({
  smartQuotes: true,
  dashes: true,
  ellipsis: true,
  ordinals: false,
  capitalizeSentences: false,
  replaceText: true,
  // A user's table replaces the defaults entirely when present, so a default can be deleted.
  replacements: DEFAULT_AUTOCORRECT_REPLACEMENTS,
});

const BOOLEAN_FIELDS = ['smartQuotes', 'dashes', 'ellipsis', 'ordinals', 'capitalizeSentences', 'replaceText'] as const;
type BooleanField = (typeof BOOLEAN_FIELDS)[number];

const AUTOCORRECT_FIELDS: ReadonlySet<string> = new Set<string>([...BOOLEAN_FIELDS, 'replacements']);

/**
 * @purpose Returns a human-readable description of an unknown value for use in problem messages.
 * @inputs value - Any value whose type needs to be described.
 * @outputs string - The word "null", "an array", the JSON-stringified string, or the raw typeof.
 * @dataflow Raw unknown value → type checks → descriptive string.
 * @controlflow Check null first, then array, then string, then fall back to typeof.
 */
function describe(value: unknown): string {
  // null → label it explicitly so callers can distinguish it from other types.
  if (value === null) {
    return 'null';
  } else if (Array.isArray(value)) {
    // array → report the container type rather than its contents.
    return 'an array';
  } else if (typeof value === 'string') {
    // string → quote it so quotes and control characters are visible in messages.
    return JSON.stringify(value);
  } else {
    // everything else → fall back to the raw type name.
    return typeof value;
  }
}

/**
 * @purpose Type guard that narrows a value to a plain object record.
 * @inputs value - Any value to test.
 * @outputs boolean - True when value is a non-null, non-array object.
 * @dataflow Raw unknown value → typeof and array checks → boolean predicate.
 * @controlflow Single expression: reject null and arrays, accept other objects.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @purpose Validates that a replacement key is usable as an autocorrect trigger.
 * @inputs key - The candidate search text.
 * @outputs boolean - True when the key is 1–200 characters with no whitespace.
 * @dataflow Raw key string → length and whitespace checks → boolean.
 * @controlflow Single expression combining length bounds and a whitespace test.
 */
export function isValidReplacementKey(key: string): boolean {
  // A key cannot contain whitespace because a space is what triggers the replacement.
  return key.length > 0 && key.length <= MAX_REPLACEMENT_LENGTH && !/\s/.test(key);
}

/**
 * @purpose Validates that a replacement value fits the length limit.
 * @inputs value - The candidate replacement text.
 * @outputs boolean - True when the value is 1–200 characters long.
 * @dataflow Raw value string → length checks → boolean.
 * @controlflow Single expression combining lower and upper length bounds.
 */
export function isValidReplacementValue(value: string): boolean {
  return value.length > 0 && value.length <= MAX_REPLACEMENT_LENGTH;
}

/**
 * @purpose Parses and validates a raw autocorrect section into frozen settings.
 * @inputs value - The raw JSON value of the "autocorrect" section; problems and unknownKeys accumulators.
 * @outputs AutocorrectSettings - Validated, frozen settings (defaults when invalid).
 * @dataflow Raw JSON → field-by-field validation → frozen settings object.
 * @controlflow Absent → defaults; non-object → error + defaults; otherwise validate each known field and preserve unknowns.
 */
export function parseAutocorrectSection(
  value: unknown,
  problems: AutocorrectProblem[],
  unknownKeys: Record<string, unknown>,
): AutocorrectSettings {
  if (value === undefined) {
    // Absent section → return the defaults unchanged.
    return DEFAULT_AUTOCORRECT_SETTINGS;
  } else if (!isRecord(value)) {
    // Present but not an object → report a hard error and fall back to defaults.
    problems.push({ path: 'autocorrect', message: `Expected section "autocorrect" to be a JSON object, but received ${describe(value)}.`, severity: 'error' });
    return DEFAULT_AUTOCORRECT_SETTINGS;
  } else {
    // Valid object → fall through and validate its fields below.
  }

  for (const key of Object.keys(value)) {
    if (!AUTOCORRECT_FIELDS.has(key)) {
      // Unknown field → preserve it so a newer version's field survives an older reader.
      unknownKeys[`autocorrect.${key}`] = value[key];
    } else {
      // Known field → handled by the per-field validation below.
    }
  }

  const flags: Record<BooleanField, boolean> = {
    smartQuotes: DEFAULT_AUTOCORRECT_SETTINGS.smartQuotes,
    dashes: DEFAULT_AUTOCORRECT_SETTINGS.dashes,
    ellipsis: DEFAULT_AUTOCORRECT_SETTINGS.ellipsis,
    ordinals: DEFAULT_AUTOCORRECT_SETTINGS.ordinals,
    capitalizeSentences: DEFAULT_AUTOCORRECT_SETTINGS.capitalizeSentences,
    replaceText: DEFAULT_AUTOCORRECT_SETTINGS.replaceText,
  };
  for (const field of BOOLEAN_FIELDS) {
    const raw = value[field];
    if (raw === undefined) {
      // Absent: keep the default.
    } else if (typeof raw === 'boolean') {
      // Correct type → accept it as-is.
      flags[field] = raw;
    } else {
      // Wrong type → warn but leave the default in place.
      problems.push({ path: `autocorrect.${field}`, message: `Invalid value ${describe(raw)} for "autocorrect.${field}". Expected true or false.`, severity: 'warning' });
    }
  }

  let replacements: Readonly<Record<string, string>> = DEFAULT_AUTOCORRECT_SETTINGS.replacements;
  const rawReplacements = value['replacements'];
  if (rawReplacements === undefined) {
    // Absent: keep the default table.
  } else if (!isRecord(rawReplacements)) {
    // Present but not an object → warn and keep the defaults.
    problems.push({ path: 'autocorrect.replacements', message: `Expected "autocorrect.replacements" to be a JSON object, but received ${describe(rawReplacements)}.`, severity: 'warning' });
  } else {
    // Present as an object → validate and keep only the well-formed entries.
    const kept: Record<string, string> = {};
    for (const [from, to] of Object.entries(rawReplacements)) {
      if (isValidReplacementKey(from) && typeof to === 'string' && isValidReplacementValue(to)) {
        // Well-formed entry → keep it.
        kept[from] = to;
      } else {
        // Malformed entry → warn and drop it so a single bad pair does not break the table.
        problems.push({ path: `autocorrect.replacements.${from}`, message: `Ignored the replacement for ${JSON.stringify(from)}: the text to replace must be 1 to ${MAX_REPLACEMENT_LENGTH} characters with no spaces, and the replacement 1 to ${MAX_REPLACEMENT_LENGTH} characters.`, severity: 'warning' });
      }
    }
    replacements = Object.freeze(kept);
  }

  return Object.freeze({ ...flags, replacements });
}

/**
 * @purpose Serializes validated settings back into a plain, sorted JSON-able object.
 * @inputs settings - The frozen AutocorrectSettings to serialize.
 * @outputs Record<string, unknown> - A plain object with all fields and sorted replacements.
 * @dataflow Frozen settings → ordered replacement map → plain serializable object.
 * @controlflow Build a sorted replacements map, then assemble the full field set.
 */
export function serializeAutocorrectSection(settings: AutocorrectSettings): Record<string, unknown> {
  const replacements: Record<string, string> = {};
  // Write entries in sorted key order so the file diffs cleanly (FR-14.15).
  for (const from of Object.keys(settings.replacements).sort()) {
    replacements[from] = settings.replacements[from] ?? '';
  }
  return {
    smartQuotes: settings.smartQuotes,
    dashes: settings.dashes,
    ellipsis: settings.ellipsis,
    ordinals: settings.ordinals,
    capitalizeSentences: settings.capitalizeSentences,
    replaceText: settings.replaceText,
    replacements,
  };
}
