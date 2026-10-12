/**
 * @file export-settings.ts
 * @purpose The export settings section (FR-10.7): whether comments are written into an exported or printed document, and how.
 * @inputs the parsed `export` object from the settings file.
 * @outputs an ExportSettings, the problems found reading it, and the object to write back.
 * @functions
 *   - parseExportSection: Reads the export section, validating comments against COMMENT_EXPORTS.
 *   - serializeExportSection: Writes every field of ExportSettings back to JSON.
 * @dataflow settings JSON -> parseExportSection -> ExportSettings -> the renderer; ExportSettings -> serializeExportSection -> settings JSON.
 * @controlflow a value the schema does not know falls back to the default and is reported, so one bad field never rejects the file.
 * @version 2
 * @date 2026-09-18
 */

/**
 * @purpose How comments are rendered in an exported or printed document.
 * @inputs None; the type of ExportSettings.comments, chosen by the user in settings.
 * @outputs None; a literal tag carried through parse, render, and serialize.
 * @dataflow None; a string constant selected once and reused on every export.
 * @controlflow None; one of three fixed values: 'exclude' (default), 'endnotes', or 'margin-notes'.
 */
export type CommentExport = 'exclude' | 'endnotes' | 'margin-notes';

/**
 * @purpose The persisted export configuration, currently only how comments are handled.
 * @inputs Produced by parseExportSection from the parsed `export` object.
 * @outputs Consumed by the renderer to decide comment placement; written back by serializeExportSection.
 * @dataflow settings JSON -> parseExportSection -> ExportSettings -> the renderer; ExportSettings -> serializeExportSection -> settings JSON.
 * @controlflow One field today, exposed as a section so export can grow later (themes, flavours) without changing the file shape.
 */
export interface ExportSettings {
  readonly comments: CommentExport;
  /** The stylesheet an HTML or PDF export is written with (FR-13.8): one K-Doc ships, or one in the reader's themes folder. */
  readonly theme: string;
}

/**
 * @purpose A single validation issue found while reading the export section.
 * @inputs Filled by parseExportSection when a value is missing, invalid, or unknown.
 * @outputs Returned to the caller via the problems array for reporting to the user.
 * @dataflow parseExportSection -> ExportProblem[] -> settings UI diagnostics.
 * @controlflow Each entry records where (path) what (message) and how serious (severity).
 */
export interface ExportProblem {
  readonly path: string;
  readonly message: string;
  readonly severity: 'warning' | 'error';
}

/**
 * @purpose The set of CommentExport values the schema accepts.
 * @inputs None; a module-level constant consulted by parseExportSection.
 * @outputs None; membership tested to decide whether an incoming value is valid.
 * @dataflow COMMENT_EXPORTS -> parseExportSection -> boolean deciding accept-or-report.
 * @controlflow Any value outside this list is reported as a warning and falls back to the default.
 */
export const COMMENT_EXPORTS: readonly CommentExport[] = Object.freeze<readonly CommentExport[]>([
  'exclude',
  'endnotes',
  'margin-notes',
]);

/**
 * @purpose The fallback export configuration used when a field is missing or invalid.
 * @inputs None; the module's canonical default, read by parseExportSection.
 * @outputs None; applied whenever value.comments is absent or not in COMMENT_EXPORTS.
 * @dataflow DEFAULT_EXPORT_SETTINGS -> parseExportSection -> ExportSettings.comments.
 * @controlflow Excluding comments by default is a requirement: comments are working notes and publishing them unasked leaks them.
 */
export const DEFAULT_EXPORT_SETTINGS: ExportSettings = Object.freeze({
  comments: 'exclude',
  theme: 'default',
});

/**
 * @purpose Reads the `export` section, validating each known field against its schema.
 * @inputs value - the raw parsed export object; problems - accumulator for reported issues; unknownKeys - map of unrecognized keys to preserve on round trip.
 * @outputs ExportSettings with validated fields, populated via problems and unknownKeys side channels.
 * @dataflow settings JSON -> parseExportSection -> ExportSettings -> the renderer.
 * @controlflow A non-object value is treated as absent (default returned); known keys are parsed, unknown keys deferred, invalid values reported and replaced by default so one bad field never rejects the file.
 */
export function parseExportSection(
  value: unknown,
  problems: ExportProblem[],
  unknownKeys: Record<string, unknown>,
): ExportSettings {
  let comments = DEFAULT_EXPORT_SETTINGS.comments;
  let theme = DEFAULT_EXPORT_SETTINGS.theme;

  // If value is not a usable object (string, number, list, or null), treat the section as absent.
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    // Not an object: return defaults without recording a problem, matching every other section.
    return { comments, theme };
  } else {
    // Intentionally empty: a valid object falls through to per-key parsing below.
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    // Route each key to its handling branch based on whether the schema knows it.
    if (key === 'comments' || key === 'theme') {
      // Both are parsed in their dedicated blocks below; nothing to do here yet.
    } else {
      // Unknown key: stash it so a newer build's setting survives an older one's round trip.
      unknownKeys[`export.${key}`] = record[key];
    }
  }

  const raw = record['comments'];
  // No comments key present: leave the default value untouched.
  if (raw === undefined) {
  } else if (COMMENT_EXPORTS.includes(raw as CommentExport)) {
    // Value is an accepted tag: adopt it directly.
    comments = raw as CommentExport;
  } else {
    // Present but unrecognized: report a warning and keep the default so one bad field never rejects the file.
    problems.push({
      path: 'export.comments',
      message: `Invalid value for "export.comments". Expected one of: ${COMMENT_EXPORTS.join(', ')}.`,
      severity: 'warning',
    });
  }

  const rawTheme = record['theme'];
  // No theme key present: leave the default value untouched.
  if (rawTheme === undefined) {
  } else if (typeof rawTheme === 'string' && rawTheme.trim().length > 0) {
    // A named theme: keep it as written, since a theme K-Doc does not know may be one the reader wrote.
    theme = rawTheme.trim();
  } else {
    // Present but not a name: report a warning and keep the default rather than rejecting the file.
    problems.push({
      path: 'export.theme',
      message: 'Invalid value for "export.theme". Expected the name of an export theme.',
      severity: 'warning',
    });
  }

  return { comments, theme };
}

/**
 * @purpose Writes every ExportSettings field back into a plain object for the settings file.
 * @inputs settings - the validated export configuration to persist.
 * @outputs A record with all fields listed explicitly so no setting is silently dropped on save.
 * @dataflow ExportSettings -> serializeExportSection -> settings JSON.
 * @controlflow Each field is enumerated by hand; omitting one here would forget it on the next save.
 */
export function serializeExportSection(settings: ExportSettings): Record<string, unknown> {
  return { comments: settings.comments, theme: settings.theme };
}
