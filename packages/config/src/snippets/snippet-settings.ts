/**
 * @file snippet-settings.ts
 * @purpose The "snippets" settings section (FR-7.10): a switch and the user's snippets, each a prefix that expands with Tab into a body with tab stops, parsed and serialized on its own like the autocorrect section.
 * @inputs the raw JSON value of the section;
 * @outputs SnippetSettings, problems, preserved unknown keys, a serializable object;
 * @functions
 *   - describe: Classifies an unknown value into a human-readable type descriptor for diagnostics.
 *   - isRecord: Narrows an unknown value to a plain record (non-null, non-array object).
 *   - isValidSnippetPrefix: Validates that a snippet prefix is usable as the word typed before Tab.
 *   - isValidSnippetBody: Validates that a snippet body has acceptable length.
 *   - parseSnippetSection: Validates and normalizes the raw "snippets" section into frozen settings.
 *   - serializeSnippetSection: Converts validated settings back into a plain, sortable object for storage.
 * @dataflow raw JSON -> validated frozen settings; settings -> sorted plain object;
 * @controlflow defaults for an absent section, error for a non-object, per-field warnings;
 * @version 1
 * @date 2026-09-16
 */

export interface SnippetSettings {
  readonly enabled: boolean;
  readonly items: Readonly<Record<string, string>>;
}

export interface SnippetProblem {
  readonly path: string;
  readonly message: string;
  readonly severity: 'warning' | 'error';
}

export const MAX_SNIPPET_PREFIX_LENGTH = 40;
export const MAX_SNIPPET_BODY_LENGTH = 5000;

// A final cursor after a table or quote sits after a blank line: on the next line it would be read as another table row
// or as more of the quote. The alert marker is its own paragraph, the shape the Callout command makes.
export const DEFAULT_SNIPPETS: Readonly<Record<string, string>> = Object.freeze({
  code: '```${1:language}\n$2\n```\n$0',
  img: '![${1:alt text}](${2:image.png})$0',
  link: '[${1:text}](${2:https://})$0',
  note: '> [!NOTE]\n>\n> ${1:Note}\n\n$0',
  table: '| ${1:Column} | ${2:Column} |\n| --- | --- |\n| $3 | $4 |\n\n$0',
  task: '- [ ] ${1:Task}$0',
  today: '$DATE$0',
});

export const DEFAULT_SNIPPET_SETTINGS: SnippetSettings = Object.freeze({
  enabled: true,
  items: DEFAULT_SNIPPETS,
});

const SNIPPET_FIELDS: ReadonlySet<string> = new Set<string>(['enabled', 'items']);

function describe(value: unknown): string {
  // Classify null first so it is reported distinctly from other falsy or object values.
  if (value === null) {
    return 'null';
  } else if (Array.isArray(value)) {
    // Arrays are not valid records, so report them as such in diagnostics.
    return 'an array';
  } else if (typeof value === 'string') {
    // Quote the string so its exact contents are visible inside a larger message.
    return JSON.stringify(value);
  } else {
    // Fallback for numbers, booleans, and other types: use the generic JS type name.
    return typeof value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isValidSnippetPrefix(prefix: string): boolean {
  // A prefix must be non-empty, within the length limit, and contain no whitespace because it is the word typed before Tab.
  return prefix.length > 0 && prefix.length <= MAX_SNIPPET_PREFIX_LENGTH && !/\s/.test(prefix);
}

export function isValidSnippetBody(body: string): boolean {
  // A body must be non-empty and within the length limit.
  return body.length > 0 && body.length <= MAX_SNIPPET_BODY_LENGTH;
}

export function parseSnippetSection(value: unknown, problems: SnippetProblem[], unknownKeys: Record<string, unknown>): SnippetSettings {
  // An absent section falls back to the built-in defaults without recording any problem.
  if (value === undefined) {
    return DEFAULT_SNIPPET_SETTINGS;
  } else if (!isRecord(value)) {
    // A non-object section is a hard error: reject it and fall back to defaults.
    problems.push({ path: 'snippets', message: `Expected section "snippets" to be a JSON object, but received ${describe(value)}.`, severity: 'error' });
    return DEFAULT_SNIPPET_SETTINGS;
  } else {
    // A valid record proceeds to per-field validation below.
  }

  for (const key of Object.keys(value)) {
    // Preserve any unrecognized key so a newer version can read it, rather than silently dropping data.
    if (!SNIPPET_FIELDS.has(key)) {
      unknownKeys[`snippets.${key}`] = value[key];
    } else {
      // Recognized keys are handled individually below.
    }
  }

  let enabled = DEFAULT_SNIPPET_SETTINGS.enabled;
  const rawEnabled = value['enabled'];
  // An absent switch keeps the default on/off state.
  if (rawEnabled === undefined) {
    // Absent: keep the default.
  } else if (typeof rawEnabled === 'boolean') {
    // A proper boolean is accepted directly.
    enabled = rawEnabled;
  } else {
    // Any non-boolean value is a warning and leaves the default in place.
    problems.push({ path: 'snippets.enabled', message: `Invalid value ${describe(rawEnabled)} for "snippets.enabled". Expected true or false.`, severity: 'warning' });
  }

  let items: Readonly<Record<string, string>> = DEFAULT_SNIPPET_SETTINGS.items;
  const rawItems = value['items'];
  // An absent items map keeps the default snippets intact.
  if (rawItems === undefined) {
    // Absent: keep the default snippets.
  } else if (!isRecord(rawItems)) {
    // A non-object items map is a warning and leaves the defaults in place.
    problems.push({ path: 'snippets.items', message: `Expected "snippets.items" to be a JSON object, but received ${describe(rawItems)}.`, severity: 'warning' });
  } else {
    // A valid record replaces the defaults entirely: any default not present here is effectively deleted.
    const kept: Record<string, string> = {};
    for (const [prefix, body] of Object.entries(rawItems)) {
      // Accept only entries with a well-formed prefix and a well-formed string body; otherwise warn and drop them.
      if (isValidSnippetPrefix(prefix) && typeof body === 'string' && isValidSnippetBody(body)) {
        kept[prefix] = body;
      } else {
        problems.push({ path: `snippets.items.${prefix}`, message: `Ignored the snippet ${JSON.stringify(prefix)}: a prefix must be 1 to ${MAX_SNIPPET_PREFIX_LENGTH} characters with no spaces, and a body 1 to ${MAX_SNIPPET_BODY_LENGTH} characters.`, severity: 'warning' });
      }
    }
    items = Object.freeze(kept);
  }

  return Object.freeze({ enabled, items });
}

export function serializeSnippetSection(settings: SnippetSettings): Record<string, unknown> {
  const items: Record<string, string> = {};
  // Write keys in sorted order so the serialized file diffs cleanly across edits.
  for (const prefix of Object.keys(settings.items).sort()) {
    items[prefix] = settings.items[prefix] ?? '';
  }
  return { enabled: settings.enabled, items };
}
