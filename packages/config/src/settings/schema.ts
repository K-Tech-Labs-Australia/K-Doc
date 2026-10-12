/**
 * @file schema.ts
 * @purpose Settings schema, default configuration, validator, loader, and serializer for K-Doc (FR-14.14, FR-14.15).
 * @inputs Raw JSON settings text, partial settings layers, canonical KdocSettings objects, and preserved unknown keys.
 * @outputs LoadedSettings with validated configuration, problem diagnostics, and preserved unknown keys; frozen KdocSettings; serialized JSON string.
 * @functions
 *   - parseSettings: Safely parses and validates JSON settings without throwing, falling back to defaults and collecting diagnostics.
 *   - mergeSettingsLayers: Merges hierarchical partial settings layers over DEFAULT_SETTINGS with section-level shallow merging.
 *   - serializeSettings: Serializes settings and preserved unknown keys to diffable, human-readable JSON with stable key ordering.
 * @dataflow Raw JSON string → narrow parse → validate sections & fields → fallback to defaults on error → LoadedSettings with preserved unknown keys.
 * @controlflow Parse JSON → validate root → validate general, editor, appearance, proofing sections → collect unknown keys → return frozen LoadedSettings.
 * @version 18
 * @date 2026-10-06
 *
 * PRINCIPLES:
 * 1. A malformed settings file must never prevent the app from launching.
 *    `parseSettings` NEVER throws — not on invalid JSON, not on wrong types, not on out-of-range numbers.
 *    It degrades to the default for the offending field and reports a problem.
 *    This mirrors the parser's treatment of malformed front matter.
 * 2. Unknown keys are preserved, never dropped.
 *    A settings file written by a newer K-Doc must survive being loaded and re-saved by an older one.
 *    Silently discarding a key the user set is the same class of failure as silently dropping a Markdown construct (FR-4.4).
 */

import { DEFAULT_KEYBOARD_SETTINGS, parseKeyboardSection, serializeKeyboardSection, type KeyboardSettings, type KeyboardProblem } from '../keymap/keyboard-settings.js';
import { DEFAULT_AUTOCORRECT_SETTINGS, parseAutocorrectSection, serializeAutocorrectSection, type AutocorrectSettings, type AutocorrectProblem } from '../autocorrect/autocorrect-settings.js';
import { DEFAULT_SNIPPET_SETTINGS, parseSnippetSection, serializeSnippetSection, type SnippetSettings, type SnippetProblem } from '../snippets/snippet-settings.js';
import { DEFAULT_HISTORY_SETTINGS, parseHistorySection, serializeHistorySection, type HistorySettings, type HistoryProblem } from '../history/history-settings.js';
import { DEFAULT_EXPORT_SETTINGS, parseExportSection, serializeExportSection, type ExportSettings, type ExportProblem } from '../export/export-settings.js';

import { parseRibbonSetting, type RibbonTabSetting } from './ribbon-setting.js';
import type { RecentFile } from './recent-files.js';
import { DEFAULT_UI_THEME, UI_THEME_IDS, isUiThemeId, type UiThemeId } from '../theme/ui-themes.js';

export type { RecentFile } from './recent-files.js';
export type { RibbonGroupSetting, RibbonTabSetting } from './ribbon-setting.js';

export type ThemeMode = 'light' | 'dark' | 'system';
export type AutosaveMode = 'off' | 'on-blur' | 'interval' | 'idle';
export type ViewMode = 'wysiwyg' | 'source' | 'split' | 'preview';
export type SplitOrientation = 'vertical' | 'horizontal';
export type ReadingWidth = 'narrow' | 'medium' | 'wide' | 'full';

/** How much space sits between blocks: compact packs them, spacious opens them up (FR-14.13). */
export type Density = 'compact' | 'comfortable' | 'spacious';
export type ProblemSeverity = 'warning' | 'error';

export interface GeneralSettings {
  readonly restoreSessionOnLaunch: boolean;
  readonly confirmExternalLinks: boolean;
  /**
   * Keep the document's comments written into the file itself, as HTML comments (FR-10.6).
   *
   * Off by default: it makes every comment an edit to the document, which is the right trade only when
   * the file has to travel on its own.
   */
  readonly portableComments: boolean;
  // Developer mode turns on diagnostics meant for people working on K-Doc itself,
  // currently the Fidelity Check that reports on save any byte change to regions that were not edited (FR-4.5). It is off by default.
  readonly developerMode: boolean;
  // Web domains whose links open without asking, added when the user picks "Always trust" in the
  // confirmation. Stored lower-case; a link to a subdomain is not covered by its parent's entry.
  readonly trustedDomains: readonly string[];
  // Name stamped on comments and tracked changes. Defaults to 'You' so that a user who never opens
  // Settings sees exactly what they saw before this field existed.
  readonly authorName: string;
  // Folder a pasted or dragged image is written into, resolved against the document's own folder unless it is absolute (FR-6.14).
  // Empty is accepted and means the document's own folder, so only the type is validated here.
  readonly attachmentsFolder: string;
  // Template an attachment is named by, with tokens {name}, {doc}, {date} and {time} (FR-6.14).
  // Empty is accepted and means the default template '{name}-{date}', so only the type is validated here.
  readonly attachmentNameTemplate: string;
  // Files the user has opened, newest first, with pinned ones ahead of the rest. It lives in settings
  // rather than in the session because a recent-files list that did not survive a restart would be a
  // list of what you did since launch, which the user already knows.
  readonly recentFiles: readonly RecentFile[];
}

export interface EditorSettings {
  readonly defaultViewMode: ViewMode;
  readonly splitOrientation: SplitOrientation;
  readonly revealSyntaxMarkers: boolean;
  readonly smartSubstitutions: boolean;
  readonly inputRules: boolean;
  readonly autosave: AutosaveMode;
  readonly autosaveDelayMs: number;
  /**
   * Whether K-Doc may write HTML to express something Markdown cannot, currently block alignment (FR-8.11).
   *
   * Off by default: an aligned block is a `<div align="...">` wrapper in the file, which is Markdown in name
   * only -- it stops being alignment anywhere the HTML is stripped, so the reader has to ask for it.
   */
  readonly allowHtmlFormatting: boolean;
}

export interface AppearanceSettings {
  readonly theme: ThemeMode;
  /** Which built-in UI theme paints the app; `theme` then picks its light or dark variant. */
  readonly uiTheme: UiThemeId;
  readonly editorFontFamily: string;
  readonly monospaceFontFamily: string;
  readonly editorFontSizePx: number;
  readonly lineHeight: number;
  readonly readingWidth: ReadingWidth;
  /** A theme of the reader's own, by name, applied over K-Doc's own colours; empty for none (FR-14.10). */
  readonly userTheme: string;
  /**
   * The ribbon the reader arranged: which tabs hold which groups of which commands (FR-14.17).
   * Empty means K-Doc's own ribbon, which is also what an unreadable arrangement falls back to.
   */
  readonly ribbon: readonly RibbonTabSetting[];
  readonly density: Density;
}

export interface ProofingSettings {
  readonly spellCheck: boolean;
  /** The language a document is checked in when nothing else names one (FR-12.3). */
  readonly language: string;
  /**
   * Whether to guess a document's language from its text when neither its front matter nor the reader names one
   * (FR-12.3). On by default: a guess only changes which dictionary is used, and the status bar says it was a guess.
   */
  readonly detectLanguage: boolean;
  /**
   * The address of a LanguageTool-compatible grammar service, or empty for none (FR-12.4).
   *
   * Empty by default, and empty is the only state in which nothing can be sent: checking grammar means
   * sending the document's text to whatever this names, so the reader has to name it themselves. There
   * is no built-in service and no default address to fall back on.
   */
  readonly grammarEndpoint: string;
}

export interface KdocSettings {
  readonly general: GeneralSettings;
  readonly editor: EditorSettings;
  readonly appearance: AppearanceSettings;
  readonly proofing: ProofingSettings;
  readonly keyboard: KeyboardSettings;
  /** Smart substitutions and the replacement table (FR-7.8); editor.smartSubstitutions switches them all. */
  readonly autocorrect: AutocorrectSettings;
  /** Snippets that a prefix plus Tab expands in WYSIWYG (FR-7.10). */
  readonly snippets: SnippetSettings;
  /** When local snapshots are taken and how long they are kept (FR-11.8). */
  readonly history: HistorySettings;
  readonly export: ExportSettings;
}

export interface SettingsProblem {
  readonly path: string;
  readonly message: string;
  readonly severity: ProblemSeverity;
}

export interface LoadedSettings {
  readonly settings: KdocSettings;
  readonly problems: readonly SettingsProblem[];
  readonly unknownKeys: Readonly<Record<string, unknown>>;
}

/** Allowed values for ThemeMode. */
const THEME_MODES: readonly ThemeMode[] = Object.freeze<readonly ThemeMode[]>([
  'light',
  'dark',
  'system',
]);

/** Allowed values for AutosaveMode. */
const AUTOSAVE_MODES: readonly AutosaveMode[] = Object.freeze<readonly AutosaveMode[]>([
  'off',
  'on-blur',
  'interval',
  'idle',
]);

/** Allowed values for ViewMode. */
const VIEW_MODES: readonly ViewMode[] = Object.freeze<readonly ViewMode[]>([
  'wysiwyg',
  'source',
  'split',
  'preview',
]);

/** Allowed values for SplitOrientation. */
const SPLIT_ORIENTATIONS: readonly SplitOrientation[] = Object.freeze<readonly SplitOrientation[]>([
  'vertical',
  'horizontal',
]);

/** Allowed values for Density. */
const DENSITIES: readonly Density[] = Object.freeze<readonly Density[]>(['compact', 'comfortable', 'spacious']);

/** Allowed values for ReadingWidth. */
const READING_WIDTHS: readonly ReadingWidth[] = Object.freeze<readonly ReadingWidth[]>([
  'narrow',
  'medium',
  'wide',
  'full',
]);

/** Known top-level section names in KdocSettings. */
const KNOWN_SECTIONS: ReadonlySet<string> = new Set<string>([
  'general',
  'editor',
  'appearance',
  'proofing',
  'keyboard',
  'autocorrect',
  'snippets',
  'history',
  'export',
]);

/** Known field names for GeneralSettings. */
const GENERAL_FIELDS: ReadonlySet<string> = new Set<string>([
  'restoreSessionOnLaunch',
  'confirmExternalLinks',
  'portableComments',
  'developerMode',
  'trustedDomains',
  'authorName',
  'attachmentsFolder',
  'attachmentNameTemplate',
  'recentFiles',
]);

/** Known field names for EditorSettings. */
const EDITOR_FIELDS: ReadonlySet<string> = new Set<string>([
  'defaultViewMode',
  'splitOrientation',
  'revealSyntaxMarkers',
  'smartSubstitutions',
  'inputRules',
  'autosave',
  'autosaveDelayMs',
  'allowHtmlFormatting',
]);

/** Known field names for AppearanceSettings. */
const APPEARANCE_FIELDS: ReadonlySet<string> = new Set<string>([
  'theme',
  'uiTheme',
  'editorFontFamily',
  'monospaceFontFamily',
  'editorFontSizePx',
  'lineHeight',
  'readingWidth',
  'density',
  'userTheme',
  'ribbon',
]);

/** Known field names for ProofingSettings. */
const PROOFING_FIELDS: ReadonlySet<string> = new Set<string>([
  'spellCheck',
  'language',
  'detectLanguage',
  'grammarEndpoint',
]);

/** Minimum allowed value for autosaveDelayMs in milliseconds. */
const AUTOSAVE_DELAY_MIN_MS = 200;

/** Maximum allowed value for autosaveDelayMs in milliseconds. */
const AUTOSAVE_DELAY_MAX_MS = 60000;

/** Minimum allowed editor font size in pixels. */
const EDITOR_FONT_SIZE_MIN_PX = 8;

/** Maximum allowed editor font size in pixels. */
const EDITOR_FONT_SIZE_MAX_PX = 72;

/** Minimum allowed line height ratio. */
const LINE_HEIGHT_MIN = 1.0;

/** Maximum allowed line height ratio. */
const LINE_HEIGHT_MAX = 3.0;

/**
 * Default K-Doc settings configuration.
 * All sections and fields are frozen to enforce immutability across callers.
 */
export const DEFAULT_SETTINGS: KdocSettings = Object.freeze<KdocSettings>({
  general: Object.freeze<GeneralSettings>({
    restoreSessionOnLaunch: true,
    confirmExternalLinks: true,
    portableComments: false,
    developerMode: false,
    trustedDomains: Object.freeze([]),
    authorName: 'You',
    attachmentsFolder: 'attachments',
    attachmentNameTemplate: '{name}-{date}',
    recentFiles: Object.freeze([]),
  }),
  editor: Object.freeze<EditorSettings>({
    defaultViewMode: 'wysiwyg',
    splitOrientation: 'vertical',
    revealSyntaxMarkers: true,
    smartSubstitutions: true,
    inputRules: true,
    autosave: 'idle',
    autosaveDelayMs: 2000,
    allowHtmlFormatting: false,
  }),
  appearance: Object.freeze<AppearanceSettings>({
    theme: 'system',
    uiTheme: DEFAULT_UI_THEME,
    editorFontFamily: 'Segoe UI',
    monospaceFontFamily: 'Cascadia Mono',
    editorFontSizePx: 16,
    lineHeight: 1.6,
    readingWidth: 'medium',
    density: 'comfortable',
    userTheme: '',
    ribbon: Object.freeze<readonly RibbonTabSetting[]>([]),
  }),
  proofing: Object.freeze<ProofingSettings>({
    spellCheck: true,
    language: 'en-GB',
    detectLanguage: true,
    // No service, which is the only setting under which nothing can leave the machine (FR-12.4).
    grammarEndpoint: '',
  }),
  keyboard: DEFAULT_KEYBOARD_SETTINGS,
  autocorrect: DEFAULT_AUTOCORRECT_SETTINGS,
  snippets: DEFAULT_SNIPPET_SETTINGS,
  history: DEFAULT_HISTORY_SETTINGS,
  export: DEFAULT_EXPORT_SETTINGS,
});

/**
 * Checks whether an unknown value is a non-null, non-array plain JSON object.
 *
 * @purpose Determines whether an unknown value is a valid JSON record object.
 * @inputs value - The unknown value to check.
 * @outputs boolean - True if value is a non-null, non-array object.
 * @dataflow Value → type guard check → boolean result.
 * @controlflow Check typeof is 'object' → check not null → check not Array.isArray → return boolean.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  // Check if value is of type object, is not null, and is not an array.
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return true;
  } else {
    return false;
  }
}

/**
 * Type guard checking whether a value is a member of a given readonly string set.
 *
 * @purpose Validates that an unknown value belongs to an allowed set of literal union values.
 * @inputs value - The unknown value to test.
 * @inputs allowed - The readonly array of permitted string literal values.
 * @outputs boolean - True if value is a string and present in allowed list.
 * @dataflow Value + allowed array → string check + inclusion test → boolean type assertion.
 * @controlflow Verify typeof value is 'string' → test inclusion in allowed array → return result.
 */
function isMemberOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  // Check if value is a string and exists in the allowed set.
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return true;
  } else {
    return false;
  }
}

/**
 * Formats a received value for diagnostic problem messages.
 *
 * @purpose Formats an arbitrary unknown value into a safe string representation for problem reporting.
 * @inputs value - The unknown value received from settings input.
 * @outputs string - Safe string representation of the value.
 * @dataflow Value → type inspection / serialization → diagnostic string.
 * @controlflow Inspect value type → serialize with JSON.stringify or fallback to String() → return string.
 */
function formatReceived(value: unknown): string {
  // Check if value is undefined to return explicit string identifier.
  if (value === undefined) {
    return 'undefined';
  }
  // Check if value is a function or symbol.
  if (typeof value === 'function' || typeof value === 'symbol') {
    return String(value);
  }
  const json = JSON.stringify(value);
  // Check if JSON serialization succeeded.
  if (json !== undefined) {
    return json;
  } else {
    return String(value);
  }
}

/**
 * Parses and validates a JSON settings string into a LoadedSettings structure.
 *
 * Never throws on malformed JSON, incorrect types, or out-of-range numbers.
 * Degrades gracefully to default values on validation errors and reports problems.
 * Unknown keys at the root or within sections are preserved for forward compatibility.
 *
 * @purpose Parses a raw settings JSON string into validated KdocSettings and diagnostics without throwing.
 * @inputs json - The raw JSON settings text to parse.
 * @outputs LoadedSettings - Result container holding validated settings, problem list, and preserved unknown keys.
 * @dataflow Raw JSON string → narrow try/catch parse → validate root structure → validate sections & fields → collect unknown keys → return LoadedSettings.
 * @controlflow JSON.parse in narrow try/catch → return defaults on syntax error → validate root object → validate general/editor/appearance/proofing sections → collect root and nested unknown keys → assemble and return frozen LoadedSettings.
 */
export function parseSettings(json: string): LoadedSettings {
  let parsedRaw: unknown;

  // Attempt to parse the raw JSON string in a narrow try/catch block.
  // A corrupt or malformed settings file must never crash the application or prevent launch (Principle 1).
  try {
    parsedRaw = JSON.parse(json);
  } catch (error: unknown) {
    // Check if the caught error is an instance of Error to extract its message string.
    const errorMessage = error instanceof Error ? error.message : String(error);
    const parseProblem: SettingsProblem = Object.freeze({
      path: '',
      message: `Failed to parse settings JSON: ${errorMessage}`,
      severity: 'error',
    });
    return Object.freeze({
      settings: DEFAULT_SETTINGS,
      problems: Object.freeze([parseProblem]),
      unknownKeys: Object.freeze({}),
    });
  }

  // Verify that parsed JSON is a non-null, non-array plain object.
  if (!isPlainObject(parsedRaw)) {
    // Root is not a valid JSON object (e.g., primitive value or array); record root-level error and return defaults.
    const rootProblem: SettingsProblem = Object.freeze({
      path: '',
      message: 'Settings root must be a JSON object.',
      severity: 'error',
    });
    return Object.freeze({
      settings: DEFAULT_SETTINGS,
      problems: Object.freeze([rootProblem]),
      unknownKeys: Object.freeze({}),
    });
  }

  const rootObj = parsedRaw;
  const problems: SettingsProblem[] = [];
  const unknownKeys: Record<string, unknown> = {};

  // Collect root-level unknown keys for forward compatibility (Principle 2).
  for (const key of Object.keys(rootObj)) {
    // Check if the key is one of the four known configuration sections.
    if (!KNOWN_SECTIONS.has(key)) {
      // Unknown root key: preserve verbatim for forward compatibility.
      // No problem is recorded because forward compatibility is expected behaviour, not user error.
      const val = rootObj[key];
      // Check if value is defined before storing.
      if (val !== undefined) {
        unknownKeys[key] = val;
      }
    }
  }

  // =========================================================================
  // Section: general
  // =========================================================================
  let restoreSessionOnLaunch = DEFAULT_SETTINGS.general.restoreSessionOnLaunch;
  let confirmExternalLinks = DEFAULT_SETTINGS.general.confirmExternalLinks;
  let portableComments = DEFAULT_SETTINGS.general.portableComments;
  let developerMode = DEFAULT_SETTINGS.general.developerMode;
  let trustedDomains: readonly string[] = DEFAULT_SETTINGS.general.trustedDomains;
  let authorName = DEFAULT_SETTINGS.general.authorName;
  let attachmentsFolder = DEFAULT_SETTINGS.general.attachmentsFolder;
  let attachmentNameTemplate = DEFAULT_SETTINGS.general.attachmentNameTemplate;
  let recentFiles = DEFAULT_SETTINGS.general.recentFiles;

  // Check if 'general' section is present in parsed root object.
  if ('general' in rootObj) {
    const generalVal = rootObj.general;
    // Check if 'general' section is a plain object.
    if (isPlainObject(generalVal)) {
      // Collect unknown keys inside 'general' section for forward compatibility.
      for (const key of Object.keys(generalVal)) {
        // Check if key is a known field of GeneralSettings.
        if (!GENERAL_FIELDS.has(key)) {
          // Unknown field inside general: preserve under dotted key path.
          // No problem is recorded because forward compatibility is expected behaviour, not user error.
          const val = generalVal[key];
          // Check if value is defined before storing.
          if (val !== undefined) {
            unknownKeys[`general.${key}`] = val;
          }
        }
      }

      // Check if 'restoreSessionOnLaunch' is specified in general settings.
      if ('restoreSessionOnLaunch' in generalVal && generalVal.restoreSessionOnLaunch !== undefined) {
        const val = generalVal.restoreSessionOnLaunch;
        // Validate that 'restoreSessionOnLaunch' is a boolean.
        if (typeof val === 'boolean') {
          restoreSessionOnLaunch = val;
        } else {
          // Value is not a boolean: record a warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'general.restoreSessionOnLaunch',
              message: `Invalid value ${formatReceived(val)} for "general.restoreSessionOnLaunch". Expected boolean (true or false).`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'confirmExternalLinks' is specified in general settings.
      if ('confirmExternalLinks' in generalVal && generalVal.confirmExternalLinks !== undefined) {
        const val = generalVal.confirmExternalLinks;
        // Validate that 'confirmExternalLinks' is a boolean.
        if (typeof val === 'boolean') {
          confirmExternalLinks = val;
        } else {
          // Value is not a boolean: record a warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'general.confirmExternalLinks',
              message: `Invalid value ${formatReceived(val)} for "general.confirmExternalLinks". Expected boolean (true or false).`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'portableComments' is specified in general settings.
      if ('portableComments' in generalVal && generalVal.portableComments !== undefined) {
        const val = generalVal.portableComments;
        // Validate that 'portableComments' is a boolean.
        if (typeof val === 'boolean') {
          portableComments = val;
        } else {
          // Value is not a boolean: record a warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'general.portableComments',
              message: `Invalid value ${formatReceived(val)} for "general.portableComments". Expected boolean (true or false).`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'developerMode' is specified in general settings.
      if ('developerMode' in generalVal && generalVal.developerMode !== undefined) {
        const val = generalVal.developerMode;
        // Validate that 'developerMode' is a boolean.
        if (typeof val === 'boolean') {
          developerMode = val;
        } else {
          // Value is not a boolean: record a warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'general.developerMode',
              message: `Invalid value ${formatReceived(val)} for "general.developerMode". Expected boolean (true or false).`,
              severity: 'warning',
            }),
          );
        }
      } else {
        // Not specified: keep the default, which leaves the check off.
      }

      // Check if 'trustedDomains' is specified in general settings.
      if ('trustedDomains' in generalVal && generalVal.trustedDomains !== undefined) {
        const val = generalVal.trustedDomains;
        // Check that the value is an array before reading its entries.
        if (Array.isArray(val)) {
          // Keep well-formed entries only: one bad line in a hand-edited file costs that line, not the list.
          const kept: string[] = [];
          for (const entry of val as readonly unknown[]) {
            // Check that the entry is a non-empty string once trimmed.
            if (typeof entry === 'string' && entry.trim().length > 0) {
              const domain = entry.trim().toLowerCase();
              // Check whether this domain is already kept, so duplicates collapse.
              if (!kept.includes(domain)) {
                kept.push(domain);
              } else {
                // Duplicate: already kept.
              }
            } else {
              // Not a usable domain: dropped silently, as recentFiles drops a malformed entry.
            }
          }
          trustedDomains = Object.freeze(kept);
        } else {
          // Not an array: record a warning and fall back to the default.
          problems.push(
            Object.freeze({
              path: 'general.trustedDomains',
              message: `Invalid value ${formatReceived(val)} for "general.trustedDomains". Expected array of strings.`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'authorName' is specified in general settings. A blank name is refused rather than
      // accepted because an unattributed comment is worse than one attributed to the default 'You';
      // this field is the only thing standing between a reader and "who said this?".
      if ('authorName' in generalVal && generalVal.authorName !== undefined) {
        const val = generalVal.authorName;
        // Validate that 'authorName' is a non-empty string after trimming.
        if (typeof val === 'string' && val.trim().length > 0) {
          authorName = val;
        } else {
          // Empty or non-string value: record warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'general.authorName',
              message: `Invalid value ${formatReceived(val)} for "general.authorName". Expected non-empty string.`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'attachmentsFolder' is specified in general settings. An empty folder name is accepted and means the document's own folder, so only the type is validated here (FR-6.14).
      if ('attachmentsFolder' in generalVal && generalVal.attachmentsFolder !== undefined) {
        const val = generalVal.attachmentsFolder;
        // Check that the value is a string; an empty string is allowed and means the document's own folder.
        if (typeof val === 'string') {
          attachmentsFolder = val;
        } else {
          // Not a string: record warning problem and fall back to the default folder.
          problems.push(
            Object.freeze({
              path: 'general.attachmentsFolder',
              message: `Invalid value ${formatReceived(val)} for "general.attachmentsFolder". Expected string.`,
              severity: 'warning',
            }),
          );
        }
      } else {
        // Not specified: keep the default folder.
      }

      // Check if 'attachmentNameTemplate' is specified in general settings. An empty template is accepted and means the default '{name}-{date}', so only the type is validated here (FR-6.14).
      if ('attachmentNameTemplate' in generalVal && generalVal.attachmentNameTemplate !== undefined) {
        const val = generalVal.attachmentNameTemplate;
        // Check that the value is a string; an empty string is allowed and means the default template.
        if (typeof val === 'string') {
          attachmentNameTemplate = val;
        } else {
          // Not a string: record warning problem and fall back to the default template.
          problems.push(
            Object.freeze({
              path: 'general.attachmentNameTemplate',
              message: `Invalid value ${formatReceived(val)} for "general.attachmentNameTemplate". Expected string.`,
              severity: 'warning',
            }),
          );
        }
      } else {
        // Not specified: keep the default template.
      }

      // Check if 'recentFiles' is specified in general settings.
      if ('recentFiles' in generalVal && generalVal.recentFiles !== undefined) {
        const val = generalVal.recentFiles;
        // Check if received recentFiles value is an array.
        if (!Array.isArray(val)) {
          // Value is not an array: record warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'general.recentFiles',
              message: `Invalid value ${formatReceived(val)} for "general.recentFiles". Expected array.`,
              severity: 'warning',
            }),
          );
        } else {
          // Walk the array and keep only the entries that are well formed. A settings file is a file a
          // user can edit by hand, and one bad line in a list of ten should cost them that line rather
          // than the whole list. A missing entry is a menu item that is gone; a refused list is a menu
          // that is empty.
          const kept: RecentFile[] = [];
          for (let index = 0; index < val.length; index += 1) {
            const entry: unknown = val[index];
            // Check that the entry is a non-null object with a non-empty string path, boolean pinned status, and finite openedAt timestamp.
            if (
              typeof entry === 'object' &&
              entry !== null &&
              'path' in entry &&
              typeof entry.path === 'string' &&
              entry.path.trim().length > 0 &&
              'pinned' in entry &&
              typeof entry.pinned === 'boolean' &&
              'openedAt' in entry &&
              typeof entry.openedAt === 'number' &&
              Number.isFinite(entry.openedAt)
            ) {
              // Valid entry: freeze and retain in kept list.
              kept.push(
                Object.freeze({
                  path: entry.path,
                  pinned: entry.pinned,
                  openedAt: entry.openedAt,
                }),
              );
            } else {
              // Malformed entry: skip it and record warning problem saying entry was dropped.
              problems.push(
                Object.freeze({
                  path: `general.recentFiles[${index}]`,
                  message: `Invalid value ${formatReceived(entry)} for "general.recentFiles[${index}]". Entry was dropped.`,
                  severity: 'warning',
                }),
              );
            }
          }
          recentFiles = Object.freeze(kept);
        }
      }
    } else {
      // Section is present but not a plain object: record error problem and use entire section defaults.
      problems.push(
        Object.freeze({
          path: 'general',
          message: `Expected section "general" to be a JSON object, but received ${formatReceived(generalVal)}.`,
          severity: 'error',
        }),
      );
    }
  }

  // =========================================================================
  // Section: editor
  // =========================================================================
  let defaultViewMode = DEFAULT_SETTINGS.editor.defaultViewMode;
  let splitOrientation = DEFAULT_SETTINGS.editor.splitOrientation;
  let revealSyntaxMarkers = DEFAULT_SETTINGS.editor.revealSyntaxMarkers;
  let smartSubstitutions = DEFAULT_SETTINGS.editor.smartSubstitutions;
  let inputRules = DEFAULT_SETTINGS.editor.inputRules;
  let autosave = DEFAULT_SETTINGS.editor.autosave;
  let autosaveDelayMs = DEFAULT_SETTINGS.editor.autosaveDelayMs;
  let allowHtmlFormatting = DEFAULT_SETTINGS.editor.allowHtmlFormatting;

  // Check if 'editor' section is present in parsed root object.
  if ('editor' in rootObj) {
    const editorVal = rootObj.editor;
    // Check if 'editor' section is a plain object.
    if (isPlainObject(editorVal)) {
      // Collect unknown keys inside 'editor' section for forward compatibility.
      for (const key of Object.keys(editorVal)) {
        // Check if key is a known field of EditorSettings.
        if (!EDITOR_FIELDS.has(key)) {
          // Unknown field inside editor: preserve under dotted key path.
          // No problem is recorded because forward compatibility is expected behaviour, not user error.
          const val = editorVal[key];
          // Check if value is defined before storing.
          if (val !== undefined) {
            unknownKeys[`editor.${key}`] = val;
          }
        }
      }

      // Check if 'defaultViewMode' is specified in editor settings.
      if ('defaultViewMode' in editorVal && editorVal.defaultViewMode !== undefined) {
        const val = editorVal.defaultViewMode;
        // Check if received value is a member of VIEW_MODES.
        if (isMemberOf(val, VIEW_MODES)) {
          defaultViewMode = val;
        } else {
          // Invalid enum value: record warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'editor.defaultViewMode',
              message: `Invalid value ${formatReceived(val)} for "editor.defaultViewMode". Expected one of: ${VIEW_MODES.join(', ')}.`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'splitOrientation' is specified in editor settings.
      if ('splitOrientation' in editorVal && editorVal.splitOrientation !== undefined) {
        const val = editorVal.splitOrientation;
        // Check if received value is a member of SPLIT_ORIENTATIONS.
        if (isMemberOf(val, SPLIT_ORIENTATIONS)) {
          splitOrientation = val;
        } else {
          // Invalid enum value: record warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'editor.splitOrientation',
              message: `Invalid value ${formatReceived(val)} for "editor.splitOrientation". Expected one of: ${SPLIT_ORIENTATIONS.join(', ')}.`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'revealSyntaxMarkers' is specified in editor settings.
      if ('revealSyntaxMarkers' in editorVal && editorVal.revealSyntaxMarkers !== undefined) {
        const val = editorVal.revealSyntaxMarkers;
        // Validate that 'revealSyntaxMarkers' is a boolean.
        if (typeof val === 'boolean') {
          revealSyntaxMarkers = val;
        } else {
          // Value is not a boolean: record warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'editor.revealSyntaxMarkers',
              message: `Invalid value ${formatReceived(val)} for "editor.revealSyntaxMarkers". Expected boolean (true or false).`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'smartSubstitutions' is specified in editor settings.
      if ('smartSubstitutions' in editorVal && editorVal.smartSubstitutions !== undefined) {
        const val = editorVal.smartSubstitutions;
        // Validate that 'smartSubstitutions' is a boolean.
        if (typeof val === 'boolean') {
          smartSubstitutions = val;
        } else {
          // Value is not a boolean: record warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'editor.smartSubstitutions',
              message: `Invalid value ${formatReceived(val)} for "editor.smartSubstitutions". Expected boolean (true or false).`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'inputRules' is specified in editor settings.
      if ('inputRules' in editorVal && editorVal.inputRules !== undefined) {
        const val = editorVal.inputRules;
        // Validate that 'inputRules' is a boolean.
        if (typeof val === 'boolean') {
          inputRules = val;
        } else {
          // Value is not a boolean: record warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'editor.inputRules',
              message: `Invalid value ${formatReceived(val)} for "editor.inputRules". Expected boolean (true or false).`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'allowHtmlFormatting' is specified in editor settings (FR-8.11).
      if ('allowHtmlFormatting' in editorVal && editorVal.allowHtmlFormatting !== undefined) {
        const val = editorVal.allowHtmlFormatting;
        // Validate that 'allowHtmlFormatting' is a boolean.
        if (typeof val === 'boolean') {
          allowHtmlFormatting = val;
        } else {
          // Value is not a boolean: record warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'editor.allowHtmlFormatting',
              message: `Invalid value ${formatReceived(val)} for "editor.allowHtmlFormatting". Expected boolean (true or false).`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'autosave' is specified in editor settings.
      if ('autosave' in editorVal && editorVal.autosave !== undefined) {
        const val = editorVal.autosave;
        // Check if received value is a member of AUTOSAVE_MODES.
        if (isMemberOf(val, AUTOSAVE_MODES)) {
          autosave = val;
        } else {
          // Invalid enum value: record warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'editor.autosave',
              message: `Invalid value ${formatReceived(val)} for "editor.autosave". Expected one of: ${AUTOSAVE_MODES.join(', ')}.`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'autosaveDelayMs' is specified in editor settings.
      if ('autosaveDelayMs' in editorVal && editorVal.autosaveDelayMs !== undefined) {
        const val = editorVal.autosaveDelayMs;
        // Check if received value is an integer within the range [200, 60000].
        if (
          typeof val === 'number' &&
          Number.isInteger(val) &&
          val >= AUTOSAVE_DELAY_MIN_MS &&
          val <= AUTOSAVE_DELAY_MAX_MS
        ) {
          autosaveDelayMs = val;
        } else {
          // Out of range or non-integer: record warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'editor.autosaveDelayMs',
              message: `Invalid value ${formatReceived(val)} for "editor.autosaveDelayMs". Expected integer in range [${AUTOSAVE_DELAY_MIN_MS}, ${AUTOSAVE_DELAY_MAX_MS}].`,
              severity: 'warning',
            }),
          );
        }
      }
    } else {
      // Section is present but not a plain object: record error problem and use entire section defaults.
      problems.push(
        Object.freeze({
          path: 'editor',
          message: `Expected section "editor" to be a JSON object, but received ${formatReceived(editorVal)}.`,
          severity: 'error',
        }),
      );
    }
  }

  // =========================================================================
  // Section: appearance
  // =========================================================================
  let theme = DEFAULT_SETTINGS.appearance.theme;
  let uiTheme: UiThemeId = DEFAULT_SETTINGS.appearance.uiTheme;
  let editorFontFamily = DEFAULT_SETTINGS.appearance.editorFontFamily;
  let monospaceFontFamily = DEFAULT_SETTINGS.appearance.monospaceFontFamily;
  let editorFontSizePx = DEFAULT_SETTINGS.appearance.editorFontSizePx;
  let lineHeight = DEFAULT_SETTINGS.appearance.lineHeight;
  let readingWidth = DEFAULT_SETTINGS.appearance.readingWidth;
  let density = DEFAULT_SETTINGS.appearance.density;
  let userTheme = DEFAULT_SETTINGS.appearance.userTheme;
  let ribbon = DEFAULT_SETTINGS.appearance.ribbon;

  // Check if 'appearance' section is present in parsed root object.
  if ('appearance' in rootObj) {
    const appearanceVal = rootObj.appearance;
    // Check if 'appearance' section is a plain object.
    if (isPlainObject(appearanceVal)) {
      // Collect unknown keys inside 'appearance' section for forward compatibility.
      for (const key of Object.keys(appearanceVal)) {
        // Check if key is a known field of AppearanceSettings.
        if (!APPEARANCE_FIELDS.has(key)) {
          // Unknown field inside appearance: preserve under dotted key path.
          // No problem is recorded because forward compatibility is expected behaviour, not user error.
          const val = appearanceVal[key];
          // Check if value is defined before storing.
          if (val !== undefined) {
            unknownKeys[`appearance.${key}`] = val;
          }
        }
      }

      // Check if 'theme' is specified in appearance settings.
      if ('theme' in appearanceVal && appearanceVal.theme !== undefined) {
        const val = appearanceVal.theme;
        // Check if received value is a member of THEME_MODES.
        if (isMemberOf(val, THEME_MODES)) {
          theme = val;
        } else {
          // Invalid enum value: record warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'appearance.theme',
              message: `Invalid value ${formatReceived(val)} for "appearance.theme". Expected one of: ${THEME_MODES.join(', ')}.`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'uiTheme' is specified in appearance settings.
      if ('uiTheme' in appearanceVal && appearanceVal.uiTheme !== undefined) {
        const val = appearanceVal.uiTheme;
        // Only a known built-in theme id is accepted.
        if (isUiThemeId(val)) {
          uiTheme = val;
        } else {
          // Unknown theme (perhaps from a newer K-Doc): warn and keep K-Doc's own colours.
          problems.push(
            Object.freeze({
              path: 'appearance.uiTheme',
              message: `Invalid value ${formatReceived(val)} for "appearance.uiTheme". Expected one of: ${UI_THEME_IDS.join(', ')}.`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'editorFontFamily' is specified in appearance settings.
      if ('editorFontFamily' in appearanceVal && appearanceVal.editorFontFamily !== undefined) {
        const val = appearanceVal.editorFontFamily;
        // Validate that 'editorFontFamily' is a non-empty string after trimming.
        if (typeof val === 'string' && val.trim().length > 0) {
          editorFontFamily = val;
        } else {
          // Empty or non-string value: record warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'appearance.editorFontFamily',
              message: `Invalid value ${formatReceived(val)} for "appearance.editorFontFamily". Expected non-empty string.`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'monospaceFontFamily' is specified in appearance settings.
      if ('monospaceFontFamily' in appearanceVal && appearanceVal.monospaceFontFamily !== undefined) {
        const val = appearanceVal.monospaceFontFamily;
        // Validate that 'monospaceFontFamily' is a non-empty string after trimming.
        if (typeof val === 'string' && val.trim().length > 0) {
          monospaceFontFamily = val;
        } else {
          // Empty or non-string value: record warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'appearance.monospaceFontFamily',
              message: `Invalid value ${formatReceived(val)} for "appearance.monospaceFontFamily". Expected non-empty string.`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'editorFontSizePx' is specified in appearance settings.
      if ('editorFontSizePx' in appearanceVal && appearanceVal.editorFontSizePx !== undefined) {
        const val = appearanceVal.editorFontSizePx;
        // Check if received value is an integer within the range [8, 72].
        if (
          typeof val === 'number' &&
          Number.isInteger(val) &&
          val >= EDITOR_FONT_SIZE_MIN_PX &&
          val <= EDITOR_FONT_SIZE_MAX_PX
        ) {
          editorFontSizePx = val;
        } else {
          // Out of range or non-integer: record warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'appearance.editorFontSizePx',
              message: `Invalid value ${formatReceived(val)} for "appearance.editorFontSizePx". Expected integer in range [${EDITOR_FONT_SIZE_MIN_PX}, ${EDITOR_FONT_SIZE_MAX_PX}].`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'lineHeight' is specified in appearance settings.
      if ('lineHeight' in appearanceVal && appearanceVal.lineHeight !== undefined) {
        const val = appearanceVal.lineHeight;
        // Check if received value is a finite number within the range [1, 3].
        if (
          typeof val === 'number' &&
          Number.isFinite(val) &&
          val >= LINE_HEIGHT_MIN &&
          val <= LINE_HEIGHT_MAX
        ) {
          lineHeight = val;
        } else {
          // Out of range or non-finite: record warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'appearance.lineHeight',
              message: `Invalid value ${formatReceived(val)} for "appearance.lineHeight". Expected number in range [${LINE_HEIGHT_MIN}, ${LINE_HEIGHT_MAX}].`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'userTheme' is specified in appearance settings.
      if ('userTheme' in appearanceVal && appearanceVal.userTheme !== undefined) {
        const val = appearanceVal.userTheme;
        // Any string is a name, including an empty one, which means K-Doc's own colours (FR-14.10).
        if (typeof val === 'string') {
          userTheme = val.trim();
        } else {
          // Not a name: record warning problem and fall back to no theme of the reader's.
          problems.push(
            Object.freeze({
              path: 'appearance.userTheme',
              message: `Invalid value ${formatReceived(val)} for "appearance.userTheme". Expected the name of a theme, or "" for none.`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'ribbon' is specified in appearance settings.
      if ('ribbon' in appearanceVal && appearanceVal.ribbon !== undefined) {
        const val = appearanceVal.ribbon;
        const read = parseRibbonSetting(val);
        // A tab that could not be read is left out rather than refused, so one bad entry costs its own tab.
        if (read.skipped) {
          // Something was dropped: say so, and keep whatever did read.
          problems.push(
            Object.freeze({
              path: 'appearance.ribbon',
              message: `Invalid value ${formatReceived(val)} for "appearance.ribbon". Expected tabs of { tab, groups: [{ title, commands }] }; what could not be read was left out.`,
              severity: 'warning',
            }),
          );
        } else {
          // Every tab read cleanly.
        }
        ribbon = Object.freeze(read.tabs);
      }

      // Check if 'density' is specified in appearance settings.
      if ('density' in appearanceVal && appearanceVal.density !== undefined) {
        const val = appearanceVal.density;
        // Check if received value is a member of DENSITIES.
        if (isMemberOf(val, DENSITIES)) {
          density = val;
        } else {
          // Invalid enum value: record warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'appearance.density',
              message: `Invalid value ${formatReceived(val)} for "appearance.density". Expected one of: ${DENSITIES.join(', ')}.`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'readingWidth' is specified in appearance settings.
      if ('readingWidth' in appearanceVal && appearanceVal.readingWidth !== undefined) {
        const val = appearanceVal.readingWidth;
        // Check if received value is a member of READING_WIDTHS.
        if (isMemberOf(val, READING_WIDTHS)) {
          readingWidth = val;
        } else {
          // Invalid enum value: record warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'appearance.readingWidth',
              message: `Invalid value ${formatReceived(val)} for "appearance.readingWidth". Expected one of: ${READING_WIDTHS.join(', ')}.`,
              severity: 'warning',
            }),
          );
        }
      }
    } else {
      // Section is present but not a plain object: record error problem and use entire section defaults.
      problems.push(
        Object.freeze({
          path: 'appearance',
          message: `Expected section "appearance" to be a JSON object, but received ${formatReceived(appearanceVal)}.`,
          severity: 'error',
        }),
      );
    }
  }

  // =========================================================================
  // Section: proofing
  // =========================================================================
  let spellCheck = DEFAULT_SETTINGS.proofing.spellCheck;
  let language = DEFAULT_SETTINGS.proofing.language;
  let detectLanguage = DEFAULT_SETTINGS.proofing.detectLanguage;
  let grammarEndpoint = DEFAULT_SETTINGS.proofing.grammarEndpoint;

  // Check if 'proofing' section is present in parsed root object.
  if ('proofing' in rootObj) {
    const proofingVal = rootObj.proofing;
    // Check if 'proofing' section is a plain object.
    if (isPlainObject(proofingVal)) {
      // Collect unknown keys inside 'proofing' section for forward compatibility.
      for (const key of Object.keys(proofingVal)) {
        // Check if key is a known field of ProofingSettings.
        if (!PROOFING_FIELDS.has(key)) {
          // Unknown field inside proofing: preserve under dotted key path.
          // No problem is recorded because forward compatibility is expected behaviour, not user error.
          const val = proofingVal[key];
          // Check if value is defined before storing.
          if (val !== undefined) {
            unknownKeys[`proofing.${key}`] = val;
          }
        }
      }

      // Check if 'spellCheck' is specified in proofing settings.
      if ('spellCheck' in proofingVal && proofingVal.spellCheck !== undefined) {
        const val = proofingVal.spellCheck;
        // Validate that 'spellCheck' is a boolean.
        if (typeof val === 'boolean') {
          spellCheck = val;
        } else {
          // Value is not a boolean: record warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'proofing.spellCheck',
              message: `Invalid value ${formatReceived(val)} for "proofing.spellCheck". Expected boolean (true or false).`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'detectLanguage' is specified in proofing settings.
      if ('detectLanguage' in proofingVal && proofingVal.detectLanguage !== undefined) {
        const val = proofingVal.detectLanguage;
        // Validate that 'detectLanguage' is a boolean.
        if (typeof val === 'boolean') {
          detectLanguage = val;
        } else {
          // Value is not a boolean: record warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'proofing.detectLanguage',
              message: `Invalid value ${formatReceived(val)} for "proofing.detectLanguage". Expected boolean (true or false).`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'grammarEndpoint' is specified in proofing settings.
      if ('grammarEndpoint' in proofingVal && proofingVal.grammarEndpoint !== undefined) {
        const val = proofingVal.grammarEndpoint;
        // Validate that 'grammarEndpoint' is a string. Empty is allowed and means no service.
        if (typeof val === 'string') {
          grammarEndpoint = val.trim();
        } else {
          // Not a string: record warning problem and fall back to none, which sends nothing anywhere.
          problems.push(
            Object.freeze({
              path: 'proofing.grammarEndpoint',
              message: `Invalid value ${formatReceived(val)} for "proofing.grammarEndpoint". Expected a string.`,
              severity: 'warning',
            }),
          );
        }
      }

      // Check if 'language' is specified in proofing settings.
      if ('language' in proofingVal && proofingVal.language !== undefined) {
        const val = proofingVal.language;
        // Validate that 'language' is a non-empty string after trimming.
        if (typeof val === 'string' && val.trim().length > 0) {
          language = val;
        } else {
          // Empty or non-string value: record warning problem and fall back to default.
          problems.push(
            Object.freeze({
              path: 'proofing.language',
              message: `Invalid value ${formatReceived(val)} for "proofing.language". Expected non-empty string.`,
              severity: 'warning',
            }),
          );
        }
      }
    } else {
      // Section is present but not a plain object: record error problem and use entire section defaults.
      problems.push(
        Object.freeze({
          path: 'proofing',
          message: `Expected section "proofing" to be a JSON object, but received ${formatReceived(proofingVal)}.`,
          severity: 'error',
        }),
      );
    }
  }

  // =========================================================================
  // Section: keyboard
  // =========================================================================
  // The section parses itself (keymap/keyboard-settings.ts); its problems join the rest.
  const keyboardProblems: KeyboardProblem[] = [];
  const keyboard = parseKeyboardSection('keyboard' in rootObj ? rootObj.keyboard : undefined, keyboardProblems, unknownKeys);
  for (const problem of keyboardProblems) {
    problems.push(Object.freeze({ path: problem.path, message: problem.message, severity: problem.severity }));
  }

  // =========================================================================
  // Section: autocorrect
  // =========================================================================
  // The section parses itself (autocorrect/autocorrect-settings.ts); its problems join the rest.
  const autocorrectProblems: AutocorrectProblem[] = [];
  const autocorrect = parseAutocorrectSection('autocorrect' in rootObj ? rootObj.autocorrect : undefined, autocorrectProblems, unknownKeys);
  for (const problem of autocorrectProblems) {
    problems.push(Object.freeze({ path: problem.path, message: problem.message, severity: problem.severity }));
  }

  // =========================================================================
  // Section: snippets
  // =========================================================================
  // The section parses itself (snippets/snippet-settings.ts); its problems join the rest.
  const snippetProblems: SnippetProblem[] = [];
  const snippets = parseSnippetSection('snippets' in rootObj ? rootObj.snippets : undefined, snippetProblems, unknownKeys);
  for (const problem of snippetProblems) {
    problems.push(Object.freeze({ path: problem.path, message: problem.message, severity: problem.severity }));
  }

  // =========================================================================
  // Section: history
  // =========================================================================
  // The section parses itself (history/history-settings.ts); its problems join the rest.
  const historyProblems: HistoryProblem[] = [];
  const history = parseHistorySection('history' in rootObj ? rootObj.history : undefined, historyProblems, unknownKeys);
  for (const problem of historyProblems) {
    problems.push(Object.freeze({ path: problem.path, message: problem.message, severity: problem.severity }));
  }

  // =========================================================================
  // Section: export
  // =========================================================================
  // The section parses itself (export/export-settings.ts); its problems join the rest.
  const exportProblems: ExportProblem[] = [];
  const exportSettings = parseExportSection('export' in rootObj ? rootObj.export : undefined, exportProblems, unknownKeys);
  for (const problem of exportProblems) {
    problems.push(Object.freeze({ path: problem.path, message: problem.message, severity: problem.severity }));
  }

  // Freeze constructed settings and returned structure.
  const settings: KdocSettings = Object.freeze<KdocSettings>({
    general: Object.freeze<GeneralSettings>({
      restoreSessionOnLaunch,
      confirmExternalLinks,
      portableComments,
      developerMode,
      trustedDomains,
      authorName,
      attachmentsFolder,
      attachmentNameTemplate,
      recentFiles,
    }),
    editor: Object.freeze<EditorSettings>({
      defaultViewMode,
      splitOrientation,
      revealSyntaxMarkers,
      smartSubstitutions,
      inputRules,
      autosave,
      autosaveDelayMs,
      allowHtmlFormatting,
    }),
    appearance: Object.freeze<AppearanceSettings>({
      theme,
      uiTheme,
      editorFontFamily,
      monospaceFontFamily,
      editorFontSizePx,
      lineHeight,
      readingWidth,
      density,
      userTheme,
      ribbon,
    }),
    proofing: Object.freeze<ProofingSettings>({
      spellCheck,
      language,
      detectLanguage,
      grammarEndpoint,
    }),
    keyboard,
    autocorrect,
    snippets,
    history,
    export: exportSettings,
  });

  return Object.freeze<LoadedSettings>({
    settings,
    problems: Object.freeze<readonly SettingsProblem[]>(problems),
    unknownKeys: Object.freeze<Readonly<Record<string, unknown>>>(unknownKeys),
  });
}

/**
 * Merges multiple partial settings layers over DEFAULT_SETTINGS.
 *
 * Layer order is app defaults, then user settings, then per-vault overrides, and later layers win.
 * Performs a section-level shallow merge so that a layer supplying only a subset of section fields
 * does not wipe the remaining fields of that section.
 *
 * @purpose Merges hierarchical settings layers from base defaults up through vault overrides.
 * @inputs layers - Array of partial settings objects to merge left-to-right.
 * @outputs KdocSettings - Complete, frozen settings object with all layers applied.
 * @dataflow DEFAULT_SETTINGS → fold over layer array applying section-level merges → frozen KdocSettings.
 * @controlflow Start with DEFAULT_SETTINGS sections → loop through layers → merge each defined section over accumulator → freeze and return result.
 */
export function mergeSettingsLayers(layers: readonly Partial<KdocSettings>[]): KdocSettings {
  let general: GeneralSettings = DEFAULT_SETTINGS.general;
  let editor: EditorSettings = DEFAULT_SETTINGS.editor;
  let appearance: AppearanceSettings = DEFAULT_SETTINGS.appearance;
  let proofing: ProofingSettings = DEFAULT_SETTINGS.proofing;
  let keyboard: KeyboardSettings = DEFAULT_SETTINGS.keyboard;
  let autocorrect: AutocorrectSettings = DEFAULT_SETTINGS.autocorrect;
  let snippets: SnippetSettings = DEFAULT_SETTINGS.snippets;
  let history: HistorySettings = DEFAULT_SETTINGS.history;
  let exportSettings: ExportSettings = DEFAULT_SETTINGS.export;

  // Iterate left-to-right through layers (app defaults → user settings → per-vault overrides).
  for (const layer of layers) {
    // Check if layer is defined.
    if (!layer) {
      continue;
    }

    // Check if general section is provided in this layer.
    if (layer.general) {
      general = Object.freeze<GeneralSettings>({
        ...general,
        ...layer.general,
      });
    }

    // Check if editor section is provided in this layer.
    if (layer.editor) {
      editor = Object.freeze<EditorSettings>({
        ...editor,
        ...layer.editor,
      });
    }

    // Check if appearance section is provided in this layer.
    if (layer.appearance) {
      appearance = Object.freeze<AppearanceSettings>({
        ...appearance,
        ...layer.appearance,
      });
    }

    // Check if proofing section is provided in this layer.
    if (layer.proofing) {
      proofing = Object.freeze<ProofingSettings>({
        ...proofing,
        ...layer.proofing,
      });
    }

    // Check if keyboard section is provided in this layer.
    if (layer.keyboard) {
      // A layer's keyboard section replaces the preset and merges bindings command by command.
      keyboard = Object.freeze<KeyboardSettings>({ preset: layer.keyboard.preset, bindings: Object.freeze({ ...keyboard.bindings, ...layer.keyboard.bindings }) });
    } else {
      // No keyboard section in this layer: keep the accumulated one.
    }

    // Check if autocorrect section is provided in this layer.
    if (layer.autocorrect) {
      // A layer's autocorrect section replaces the accumulated one whole, table included, so a vault can remove an entry.
      autocorrect = layer.autocorrect;
    } else {
      // No autocorrect section in this layer: keep the accumulated one.
    }

    // Check if snippets section is provided in this layer.
    if (layer.snippets) {
      // A layer's snippets section replaces the accumulated one whole, so a vault can remove a snippet.
      snippets = layer.snippets;
    } else {
      // No snippets section in this layer: keep the accumulated one.
    }

    // Check if export section is provided in this layer.
    if (layer.export) {
      // A layer's export section replaces the accumulated one whole.
      exportSettings = layer.export;
    } else {
      // No export section in this layer: keep the accumulated one.
    }

    // Check if history section is provided in this layer.
    if (layer.history) {
      // A layer's history section replaces the accumulated one whole.
      history = layer.history;
    } else {
      // No history section in this layer: keep the accumulated one.
    }
  }

  return Object.freeze<KdocSettings>({
    general,
    editor,
    appearance,
    proofing,
    keyboard,
    autocorrect,
    snippets,
    history,
    export: exportSettings,
  });
}

/**
 * Serializes a KdocSettings object and optional preserved unknown keys into a deterministic JSON string.
 *
 * Emits human-readable JSON formatted with a 2-space indentation and a trailing newline.
 * Sections are written in fixed order (general, editor, appearance, proofing), and fields within
 * each section follow the canonical order declared in the specification interfaces.
 * Stable key ordering ensures diff stability when settings files are modified by hand or committed to version control (FR-14.15).
 * Unknown keys are re-attached: root-level keys at the root, and dotted keys (e.g. 'editor.flag') inside their respective section.
 *
 * @purpose Serializes settings to human-readable, diffable JSON with preserved unknown keys.
 * @inputs settings - The canonical KdocSettings configuration object to serialize.
 * @inputs unknownKeys - Optional record of preserved unknown keys to re-attach.
 * @outputs string - Formatted JSON string with trailing newline.
 * @dataflow Settings + unknownKeys → reconstruct ordered section objects with re-attached unknown keys → construct root object → JSON.stringify → append newline → string.
 * @controlflow Construct general section → construct editor section → construct appearance section → construct proofing section → attach root unknown keys → format to JSON with 2-space indent → append trailing newline.
 */
export function serializeSettings(
  settings: KdocSettings,
  unknownKeys?: Readonly<Record<string, unknown>>,
): string {
  // Construct the general section object with canonical field order.
  const generalObj: Record<string, unknown> = {
    restoreSessionOnLaunch: settings.general.restoreSessionOnLaunch,
    confirmExternalLinks: settings.general.confirmExternalLinks,
    portableComments: settings.general.portableComments,
    developerMode: settings.general.developerMode,
    // Leaving this out lost every "Always trust" choice the next time settings were saved and read back.
    trustedDomains: settings.general.trustedDomains,
    authorName: settings.general.authorName,
    attachmentsFolder: settings.general.attachmentsFolder,
    attachmentNameTemplate: settings.general.attachmentNameTemplate,
    // Rebuild each entry field by field rather than writing through, so a key that crept
    // into the in-memory object never reaches the file.
    recentFiles: settings.general.recentFiles.map((entry) => ({
      path: entry.path,
      pinned: entry.pinned,
      openedAt: entry.openedAt,
    })),
  };

  // Construct the editor section object with canonical field order.
  const editorObj: Record<string, unknown> = {
    defaultViewMode: settings.editor.defaultViewMode,
    splitOrientation: settings.editor.splitOrientation,
    revealSyntaxMarkers: settings.editor.revealSyntaxMarkers,
    smartSubstitutions: settings.editor.smartSubstitutions,
    inputRules: settings.editor.inputRules,
    autosave: settings.editor.autosave,
    autosaveDelayMs: settings.editor.autosaveDelayMs,
    allowHtmlFormatting: settings.editor.allowHtmlFormatting,
  };

  // Construct the appearance section object with canonical field order.
  const appearanceObj: Record<string, unknown> = {
    theme: settings.appearance.theme,
    uiTheme: settings.appearance.uiTheme,
    editorFontFamily: settings.appearance.editorFontFamily,
    monospaceFontFamily: settings.appearance.monospaceFontFamily,
    editorFontSizePx: settings.appearance.editorFontSizePx,
    lineHeight: settings.appearance.lineHeight,
    readingWidth: settings.appearance.readingWidth,
    density: settings.appearance.density,
    userTheme: settings.appearance.userTheme,
    ribbon: settings.appearance.ribbon,
  };

  // Construct the proofing section object with canonical field order.
  const proofingObj: Record<string, unknown> = {
    spellCheck: settings.proofing.spellCheck,
    language: settings.proofing.language,
    detectLanguage: settings.proofing.detectLanguage,
    grammarEndpoint: settings.proofing.grammarEndpoint,
  };

  // Rebuild the keyboard section through its own serializer (keymap/keyboard-settings.ts).
  const keyboardObj: Record<string, unknown> = serializeKeyboardSection(settings.keyboard);

  // Rebuild the autocorrect section through its own serializer (autocorrect/autocorrect-settings.ts).
  const autocorrectObj: Record<string, unknown> = serializeAutocorrectSection(settings.autocorrect);

  // Rebuild the snippets section through its own serializer (snippets/snippet-settings.ts).
  const snippetsObj: Record<string, unknown> = serializeSnippetSection(settings.snippets);

  // Rebuild the history section through its own serializer (history/history-settings.ts).
  const historyObj: Record<string, unknown> = serializeHistorySection(settings.history);

  // Rebuild the export section through its own serializer (export/export-settings.ts).
  const exportObj: Record<string, unknown> = serializeExportSection(settings.export);

  const rootUnknownKeys: Record<string, unknown> = {};

  // Check whether unknown keys were provided to re-attach.
  if (unknownKeys !== undefined) {
    // Iterate over all preserved unknown keys.
    for (const key of Object.keys(unknownKeys)) {
      const val = unknownKeys[key];
      // Check if key belongs to the general section via dotted path.
      if (key.startsWith('general.')) {
        const subKey = key.slice('general.'.length);
        generalObj[subKey] = val;
      } else if (key.startsWith('editor.')) {
        // Check if key belongs to the editor section via dotted path.
        const subKey = key.slice('editor.'.length);
        editorObj[subKey] = val;
      } else if (key.startsWith('appearance.')) {
        // Check if key belongs to the appearance section via dotted path.
        const subKey = key.slice('appearance.'.length);
        appearanceObj[subKey] = val;
      } else if (key.startsWith('proofing.')) {
        // Check if key belongs to the proofing section via dotted path.
        const subKey = key.slice('proofing.'.length);
        proofingObj[subKey] = val;
      } else if (key.startsWith('keyboard.')) {
        // Check if key belongs to the keyboard section via dotted path.
        const subKey = key.slice('keyboard.'.length);
        keyboardObj[subKey] = val;
      } else if (key.startsWith('autocorrect.')) {
        // Check if key belongs to the autocorrect section via dotted path.
        const subKey = key.slice('autocorrect.'.length);
        autocorrectObj[subKey] = val;
      } else if (key.startsWith('snippets.')) {
        // Check if key belongs to the snippets section via dotted path.
        const subKey = key.slice('snippets.'.length);
        snippetsObj[subKey] = val;
      } else if (key.startsWith('history.')) {
        // Check if key belongs to the history section via dotted path.
        const subKey = key.slice('history.'.length);
        historyObj[subKey] = val;
      } else if (key.startsWith('export.')) {
        // Check if key belongs to the export section via dotted path.
        const subKey = key.slice('export.'.length);
        exportObj[subKey] = val;
      } else {
        // Root-level unknown key: attach to root object.
        rootUnknownKeys[key] = val;
      }
    }
  }

  // Construct root object with canonical section order followed by root-level unknown keys.
  const rootObj: Record<string, unknown> = {
    general: generalObj,
    editor: editorObj,
    appearance: appearanceObj,
    proofing: proofingObj,
    keyboard: keyboardObj,
    autocorrect: autocorrectObj,
    snippets: snippetsObj,
    history: historyObj,
    export: exportObj,
    ...rootUnknownKeys,
  };

  // Stable key order is what makes the file diffable, which matters because FR-14.15 says the user may edit it by hand.
  return `${JSON.stringify(rootObj, null, 2)}\n`;
}
