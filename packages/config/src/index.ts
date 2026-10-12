/**
 * @file index.ts
 * @purpose The single public API surface of the @k-doc/config package. Nothing outside the package
 *   may import from a deeper path, so this barrel defines the whole contract.
 *
 *   @k-doc/config is headless — no DOM, no filesystem, no framework — because reading and writing
 *   the settings file belongs to the Rust host and applying theme variables belongs to the UI.
 *   `parseSettings` never throws and degrades a malformed file to defaults while reporting problems,
 *   so a corrupt settings file cannot stop the editor opening; unknown keys are preserved verbatim
 *   so a file written by a newer version survives an older one. The theme tokens are the documented
 *   contract user themes are written against, and `contrastRatio` makes WCAG AA a CI gate rather
 *   than an aspiration.
 *
 * @inputs Raw settings JSON strings, Partial<KdocSettings> configuration layers, ThemeTokens definitions, theme mode names, and hex/rgb colour strings.
 * @outputs Validated LoadedSettings structures, serialized JSON strings, merged KdocSettings objects, ThemeTokens, CSS variable strings, and WCAG contrast/luminance ratios.
 * @functions
 *   - parseSettings: Parses and validates a settings JSON string into LoadedSettings, falling back to defaults without throwing.
 *   - mergeSettingsLayers: Merges hierarchical settings layers left-to-right over defaults with section-level preservation.
 *   - serializeSettings: Serializes a KdocSettings object and optional unknown keys into stable, human-readable JSON.
 *   - relativeLuminance: Computes the WCAG relative luminance of an sRGB hex or rgb color string.
 *   - contrastRatio: Computes the WCAG contrast ratio between two color strings in an order-independent manner.
 *   - toCssVariables: Converts a ThemeTokens object into a CSS custom property declaration string.
 *   - resolveTheme: Resolves a complete ThemeTokens instance for a theme mode ('light', 'dark', 'system') given OS preference.
 *   - resolveUiTheme / uiThemeTokens / uiThemeSwatch / isUiThemeId: The built-in UI theme catalogue (ui-themes.ts).
 * @dataflow Settings JSON strings / partial layers / theme specifications -> parseSettings / mergeSettingsLayers / resolveTheme -> typed KdocSettings & ThemeTokens -> serializeSettings / toCssVariables / contrast calculations.
 * @controlflow Re-export barrel only; all execution is delegated to the submodules.
 * @version 7
 * @date 2026-10-06
 */

export type {
  ThemeMode,
  AutosaveMode,
  ViewMode,
  SplitOrientation,
  ReadingWidth,
  ProblemSeverity,
  GeneralSettings,
  EditorSettings,
  AppearanceSettings,
  ProofingSettings,
  KdocSettings,
  SettingsProblem,
  LoadedSettings,
} from './settings/schema.js';

export {
  RECENT_FILES_LIMIT,
  recordRecentFile,
  togglePinnedFile,
  forgetRecentFile,
  orderRecentFiles,
} from './settings/recent-files.js';
export type { RecentFile } from './settings/recent-files.js';
export type { RibbonGroupSetting, RibbonTabSetting } from './settings/ribbon-setting.js';

export {
  DEFAULT_SETTINGS,
  parseSettings,
  mergeSettingsLayers,
  serializeSettings,
} from './settings/schema.js';

export type {
  ThemeModeName,
  ThemeColors,
  ThemeTokens,
} from './theme/tokens.js';

export {
  LIGHT_THEME,
  DARK_THEME,
  CONTRAST_AA_NORMAL,
  CONTRAST_AA_LARGE,
  relativeLuminance,
  contrastRatio,
  toCssVariables,
  resolveTheme,
} from './theme/tokens.js';

export type { UiThemeId, UiTheme } from './theme/ui-themes.js';

export {
  DEFAULT_UI_THEME,
  UI_THEME_IDS,
  UI_THEMES,
  isUiThemeId,
  uiThemeTokens,
  resolveUiTheme,
  uiThemeSwatch,
} from './theme/ui-themes.js';

export type { KeyEventLike } from './keymap/chords.js';
export { normalizeChord, chordFromEvent, formatChord } from './keymap/chords.js';
export type { KeymapScope, KeymapCommandSpec, KeymapPresetId, KeyBindings } from './keymap/presets.js';
export {
  KEYMAP_PRESET_IDS,
  KEYMAP_PRESET_LABELS,
  KEYMAP_COMMANDS,
  WORD_BINDINGS,
  UNBOUND_SHORTCUT_EXPLANATIONS,
  presetBindings,
} from './keymap/presets.js';
export type { KeymapConflict, ResolvedKeymap } from './keymap/keymap.js';
export { scopeOf, resolveKeymap, withBinding, withoutChord } from './keymap/keymap.js';
export type { KeyboardSettings } from './keymap/keyboard-settings.js';
export { DEFAULT_KEYBOARD_SETTINGS } from './keymap/keyboard-settings.js';
export type { AutocorrectSettings } from './autocorrect/autocorrect-settings.js';
export type { Density } from './settings/schema.js';
export type { SnippetSettings } from './snippets/snippet-settings.js';
export type { HistorySettings } from './history/history-settings.js';
export { DEFAULT_HISTORY_SETTINGS, HISTORY_LIMITS, parseHistorySection, serializeHistorySection } from './history/history-settings.js';
export type { ExportSettings, CommentExport } from './export/export-settings.js';
export { COMMENT_EXPORTS, DEFAULT_EXPORT_SETTINGS, parseExportSection, serializeExportSection } from './export/export-settings.js';
export { DEFAULT_SNIPPET_SETTINGS, DEFAULT_SNIPPETS, MAX_SNIPPET_BODY_LENGTH, MAX_SNIPPET_PREFIX_LENGTH, isValidSnippetBody, isValidSnippetPrefix, parseSnippetSection, serializeSnippetSection } from './snippets/snippet-settings.js';
export { DEFAULT_AUTOCORRECT_SETTINGS, DEFAULT_AUTOCORRECT_REPLACEMENTS, MAX_REPLACEMENT_LENGTH, isValidReplacementKey, isValidReplacementValue } from './autocorrect/autocorrect-settings.js';
