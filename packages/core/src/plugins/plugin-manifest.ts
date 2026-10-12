/**
 * @file plugin-manifest.ts
 * @purpose Declares the shape of a plugin folder's self-description and reads its plugin.json before K-Doc runs any code (FR-14.18).
 * @inputs A plugin folder name (`id`) and the raw text of its `plugin.json`.
 * @outputs The PluginManifest interface, isPluginId, parsePluginManifest and pluginProblem helpers plus PLUGIN_MAIN.
 * @functions
 *   - MAX_TEXT: longest allowed length for a name or description field.
 *   - ID_PATTERN: regular expression describing an acceptable plugin id.
 *   - PLUGIN_MAIN: the single file a plugin's code must live in.
 *   - PluginManifest: describes what one plugin folder says about itself.
 *   - PluginManifestResult: either a manifest or a human-readable reason it could not be read.
 *   - isPluginId: reports whether a name may serve as a plugin id.
 *   - parsePluginManifest: reads and validates a plugin.json, refusing anything unverifiable.
 *   - pluginProblem: formats one failure message in the single shared shape.
 * @dataflow Folder name + raw JSON text -> validation branches -> PluginManifest or problem string -> host menu/report.
 * @controlflow Validate id shape -> parse JSON -> accept only plain objects -> coerce each field with a fallback or refuse -> return manifest on success, problem otherwise.
 * @version 1
 * @date 2026-09-18
 */

/** The longest a name or description may be. A manifest is read into menus, not into a document. */
const MAX_TEXT = 200;

/** What a plugin's id may be made of: lower-case letters, digits and hyphens, starting with a letter. */
const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/** The file a plugin's code must be in. A manifest cannot name another, because a name can be a path. */
export const PLUGIN_MAIN = 'main.js';

/** What a plugin folder says about itself. */
export interface PluginManifest {
  /** The folder's own name, which is also how the plugin's commands are named. */
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
}

/** What reading a manifest produced: one or the other, never both. */
export interface PluginManifestResult {
  readonly manifest: PluginManifest | null;
  /** Why it could not be read, in words a reader can act on. */
  readonly problem: string | null;
}

/** A plugin.json's fields as parsed from JSON, each optional and of unknown concrete type until validated. */
type RawManifest = Record<string, unknown>;

/** The version reported when a plugin never stated one. */
const DEFAULT_VERSION = '0.0.0';

/** The description reported when a plugin never stated one. */
const DEFAULT_DESCRIPTION = '';

/** Says whether a name can be a plugin's id (FR-14.18).
 * @inputs value - The candidate folder or command name to test.
 * @outputs boolean - True when `value` matches the allowed id shape, false otherwise.
 * @dataflow Candidate string -> ID_PATTERN regex match -> pass/fail result.
 * @controlflow Run a single regular-expression test and return its outcome; no branching inside. */
export function isPluginId(value: string): boolean {
  // A name with a dot, slash or backslash fails here, so nothing that could climb out of the plugins folder is ever passed to the host.
  return ID_PATTERN.test(value);
}

/** Writes one plugin problem the same way everywhere.
 * @inputs id - The offending plugin's folder name.
 * @inputs reason - A single sentence describing why reading failed, without a doubled full stop.
 * @outputs string - `Plugin "<id>": ${reason}`, ready for the host to report verbatim.
 * @dataflow Plugin id and free-text reason -> prefixed message template -> problem string.
 * @controlflow Concatenate the fixed prefix with the supplied reason in one step; no branching. */
export function pluginProblem(id: string, reason: string): string {
  return `Plugin "${id}": ${reason}`;
}

/** Reads a plugin.json, refusing anything it cannot vouch for (FR-14.18).
 * @inputs id - The plugin folder's own name, also the fallback when fields are missing.
 * @inputs json - The raw text of the folder's `plugin.json`.
 * @outputs PluginManifestResult - A manifest on success or a single actionable problem string otherwise.
 * @dataflow Folder name + JSON text -> id check -> parse -> object check -> per-field coercion -> manifest or problem.
 * @controlflow Refuse bad ids first, then malformed JSON and non-objects, then coerce each field with fallback-or-refuse before returning the manifest on success. */
export function parsePluginManifest(id: string, json: string): PluginManifestResult {
  // A folder name that is not one K-Doc will load must be refused outright, naming it so a reader can rename the folder.
  if (!isPluginId(id)) {
    return { manifest: null, problem: pluginProblem(id, `folder name "${id}" is not one K-Doc will load.`) };
  } else {
    // A name K-Doc will load: read what the folder says about itself.
  }

  // Parse in a narrow catch so only malformed JSON becomes a readable-JSON problem; other throwers stay out of this branch.
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    // A SyntaxError from the parser means the manifest is not valid JSON; report it with the parser's own message.
    return { manifest: null, problem: pluginProblem(id, `manifest is not readable JSON. ${error instanceof Error ? error.message : String(error)}`) };
  }

  // The parsed value must be a plain object; anything else (a string, number, boolean or literal null) has no named fields to read.
  if (typeof parsed !== 'object' || parsed === null) {
    return { manifest: null, problem: pluginProblem(id, 'manifest is not a JSON object.') };
  } else {
    // Some kind of object: it still must not be an array.
  }

  // A JSON array parses to an Array rather than an object; it has no named fields, so refuse that too.
  if (Array.isArray(parsed)) {
    return { manifest: null, problem: pluginProblem(id, 'manifest is not a JSON object.') };
  } else {
    // A plain object, which is what a manifest is.
  }

  // Both guards passed, so parsed holds a plain object; read its fields through string-keyed access.
  const raw = parsed as RawManifest;

  // `name` falls back to the id when unnamed, since an unnamed plugin is not broken - it simply has no name
  // of its own. `version` and `description` fall back to their own defaults, being metadata, not identity.
  const name = readText(raw, id, 'name', id);
  const version = readText(raw, id, 'version', DEFAULT_VERSION);
  const description = readText(raw, id, 'description', DEFAULT_DESCRIPTION);

  // Check whether any of the three could not be read; the first reason is the one worth reporting.
  const refused = [name, version, description].find((field) => field.problem !== null);

  if (refused !== undefined) {
    return { manifest: null, problem: refused.problem };
  } else {
    // All three read: assemble the manifest below.
  }

  return {
    manifest: { id, name: name.text, version: version.text, description: description.text },
    problem: null,
  };
}

/** What reading one field of a manifest produced: the text to use, or why it could not be used. */
interface TextField {
  readonly text: string;
  readonly problem: string | null;
}

/**
 * Reads one text field of a manifest, falling back when it is absent and refusing when it is unusable.
 *
 * @purpose Gives the three text fields of a manifest one treatment, so they cannot drift apart (FR-14.18).
 * @inputs raw - the parsed manifest; id - the plugin's own name, for the problem message; field - which field to read; fallback - what to use when it was never stated.
 * @outputs TextField - the trimmed text, or a problem naming the field and what was wrong with it.
 * @dataflow raw[field] -> type and length checks -> trimmed text or a problem string.
 * @controlflow An absent or blank field falls back rather than refusing, because a plugin that did not fill a field in is not broken; one that filled it in with something unusable is.
 */
function readText(raw: RawManifest, id: string, field: string, fallback: string): TextField {
  // Read the raw value; an absent key reads as undefined under noUncheckedIndexedAccess.
  const value = raw[field];

  // Check whether the field was stated at all.
  if (value === undefined) {
    // Never stated: fall back rather than refusing.
    return { text: fallback, problem: null };
  } else {
    // Stated: it has to be text K-Doc can put in a menu.
  }

  // Check whether what was stated is text at all.
  if (typeof value !== 'string') {
    // A number, an object or an array: refuse it rather than describing it to the reader.
    return { text: fallback, problem: pluginProblem(id, `${field} is not a string.`) };
  } else {
    // Text: trim it before judging whether anything is left.
  }

  const trimmed = value.trim();

  // Check whether anything survived the trim, and whether it is short enough to read.
  if (trimmed.length === 0) {
    // Only whitespace: as good as never stated, so fall back.
    return { text: fallback, problem: null };
  } else if (trimmed.length > MAX_TEXT) {
    // Longer than a menu can hold: refuse rather than quietly cutting a plugin's own words.
    return { text: fallback, problem: pluginProblem(id, `${field} is longer than ${MAX_TEXT} characters.`) };
  } else {
    // Usable as written.
    return { text: trimmed, problem: null };
  }
}
