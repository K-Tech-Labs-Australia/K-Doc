/**
 * @file presets.ts
 * @purpose Declares the keymap command catalogue and the Word/VS Code/Typora/Obsidian binding presets for K-Doc.
 * @inputs None; this module is pure data plus a resolver consumed by the keymap UI.
 * @outputs KEYMAP_COMMANDS, WORD_BINDINGS, PRESET_OVERRIDES, UNBOUND_SHORTCUT_EXPLANATIONS, and presetBindings().
 * @functions
 *   - presetBindings: Merges Word's defaults with a preset's overrides to resolve its final binding table.
 * @dataflow No runtime data; static tables are read by the keymap settings screen which renders each command's chord.
 * @controlflow Module load defines types and constants in declaration order; presetBindings() is invoked on demand per preset.
 * @version 3
 * @date 2026-09-18
 */

export type KeymapScope = 'global' | 'document' | 'editor';
/** global: works anywhere. document: works unless typing in a form field. editor: only while the K-Doc pane has focus. */
export interface KeymapCommandSpec { readonly id: string; readonly scope: KeymapScope; }
export type KeymapPresetId = 'word' | 'vscode' | 'typora' | 'obsidian';
export const KEYMAP_PRESET_IDS: readonly KeymapPresetId[] = ['word', 'vscode', 'typora', 'obsidian'];
export const KEYMAP_PRESET_LABELS: Readonly<Record<KeymapPresetId, string>> = { word: 'Word', vscode: 'VS Code', typora: 'Typora', obsidian: 'Obsidian' };
export type KeyBindings = Readonly<Record<string, readonly string[]>>;

export const KEYMAP_COMMANDS: readonly KeymapCommandSpec[] = [
  { id: 'file:new', scope: 'global' },
  { id: 'file:open', scope: 'global' },
  { id: 'file:close', scope: 'global' },
  { id: 'file:next', scope: 'global' },
  { id: 'file:save', scope: 'global' },
  { id: 'file:save-as', scope: 'global' },
  { id: 'file:quick-open', scope: 'global' },
  { id: 'file:rename', scope: 'global' },
  { id: 'file:print', scope: 'global' },
  { id: 'edit:undo', scope: 'document' },
  { id: 'edit:redo', scope: 'document' },
  { id: 'edit:paste-special', scope: 'document' },
  { id: 'format:bold', scope: 'editor' },
  { id: 'format:italic', scope: 'editor' },
  { id: 'format:strikethrough', scope: 'editor' },
  { id: 'format:inline-code', scope: 'editor' },
  { id: 'format:code-block', scope: 'editor' },
  { id: 'format:highlight', scope: 'editor' },
  { id: 'format:subscript', scope: 'editor' },
  { id: 'format:superscript', scope: 'editor' },
  { id: 'format:clear-formatting', scope: 'editor' },
  { id: 'format:format-painter', scope: 'editor' },
  { id: 'format:heading-1', scope: 'editor' },
  { id: 'format:heading-2', scope: 'editor' },
  { id: 'format:heading-3', scope: 'editor' },
  { id: 'format:heading-4', scope: 'editor' },
  { id: 'format:heading-5', scope: 'editor' },
  { id: 'format:heading-6', scope: 'editor' },
  { id: 'format:normal-text', scope: 'editor' },
  { id: 'format:blockquote', scope: 'editor' },
  { id: 'format:bullet-list', scope: 'editor' },
  { id: 'format:numbered-list', scope: 'editor' },
  { id: 'format:task-list', scope: 'editor' },
  // Tab and Shift+Tab indent inside a list and are not remappable, because a list is the one place the
  // key already means this. These are the indentation the spec gives for everywhere else.
  { id: 'format:indent', scope: 'editor' },
  { id: 'format:outdent', scope: 'editor' },
  { id: 'format:move-block-up', scope: 'editor' },
  { id: 'format:move-block-down', scope: 'editor' },
  { id: 'format:promote-heading', scope: 'editor' },
  { id: 'format:demote-heading', scope: 'editor' },
  { id: 'insert:link', scope: 'editor' },
  { id: 'insert:table', scope: 'editor' },
  { id: 'insert:horizontal-rule', scope: 'editor' },
  { id: 'insert:image', scope: 'document' },
  { id: 'find:open', scope: 'global' },
  { id: 'find:replace', scope: 'global' },
  { id: 'find:in-vault', scope: 'global' },
  { id: 'find:go-to', scope: 'global' },
  // Document scope: a text field keeps Alt+Left and Alt+Right, which move by word on macOS.
  { id: 'nav:back', scope: 'document' },
  { id: 'nav:forward', scope: 'document' },
  { id: 'view:command-palette', scope: 'global' },
  { id: 'view:cycle-view-mode', scope: 'global' },
  { id: 'view:toggle-sidebar', scope: 'global' },
  { id: 'view:toggle-right-panel', scope: 'global' },
  { id: 'view:zoom-in', scope: 'global' },
  { id: 'view:zoom-out', scope: 'global' },
  { id: 'view:zoom-reset', scope: 'global' },
  { id: 'view:settings', scope: 'global' },
  { id: 'view:ribbon', scope: 'global' },
  { id: 'help:user-guide', scope: 'global' },
  { id: 'review:new-comment', scope: 'global' },
  { id: 'review:toggle-track-changes', scope: 'global' },
  { id: 'spell:check', scope: 'global' },
];

export const WORD_BINDINGS: KeyBindings = {
  'file:new': ['Ctrl+N'], 'file:open': ['Ctrl+O'], 'file:close': ['Ctrl+W'], 'file:next': ['Ctrl+Tab'], 'file:save': ['Ctrl+S'], 'file:save-as': ['Ctrl+Shift+S'], 'file:quick-open': ['Ctrl+Shift+O'], 'file:rename': ['F2'], 'file:print': ['Ctrl+P'],
  'edit:undo': ['Ctrl+Z'], 'edit:redo': ['Ctrl+Y', 'Ctrl+Shift+Z'], 'edit:paste-special': ['Ctrl+Alt+V'],
  'format:bold': ['Ctrl+B'], 'format:italic': ['Ctrl+I'], 'format:strikethrough': ['Ctrl+Shift+X'], 'format:inline-code': ['Ctrl+E'], 'format:code-block': ['Ctrl+Alt+C'], 'format:highlight': ['Ctrl+Alt+H'], 'format:subscript': ['Ctrl+='], 'format:superscript': ['Ctrl+Shift+='], 'format:clear-formatting': ['Ctrl+Space'], 'format:format-painter': ['Ctrl+Shift+C'],
  'format:heading-1': ['Ctrl+Alt+1'], 'format:heading-2': ['Ctrl+Alt+2'], 'format:heading-3': ['Ctrl+Alt+3'], 'format:heading-4': ['Ctrl+Alt+4'], 'format:heading-5': ['Ctrl+Alt+5'], 'format:heading-6': ['Ctrl+Alt+6'], 'format:normal-text': ['Ctrl+Alt+0'],
  'format:blockquote': ['Ctrl+Shift+Q'], 'format:bullet-list': ['Ctrl+Shift+8', 'Ctrl+Shift+L'], 'format:numbered-list': ['Ctrl+Shift+7'], 'format:task-list': ['Ctrl+Shift+9'],
  'format:indent': ['Ctrl+M', 'Ctrl+]'], 'format:outdent': ['Ctrl+Shift+M', 'Ctrl+['],
  'format:move-block-up': ['Alt+Up'], 'format:move-block-down': ['Alt+Down'], 'format:promote-heading': ['Ctrl+Alt+Left'], 'format:demote-heading': ['Ctrl+Alt+Right'],
  'insert:link': ['Ctrl+K'], 'insert:table': ['Ctrl+Alt+T'], 'insert:horizontal-rule': ['Ctrl+Shift+-'], 'insert:image': ['Ctrl+Shift+I'],
  'find:open': ['Ctrl+F'], 'find:replace': ['Ctrl+H'], 'find:in-vault': ['Ctrl+Shift+F'], 'find:go-to': ['Ctrl+G'],
  'nav:back': ['Alt+Left'], 'nav:forward': ['Alt+Right'],
  'view:command-palette': ['Ctrl+Shift+P'], 'view:cycle-view-mode': ['Ctrl+/'], 'view:toggle-sidebar': ['Ctrl+Shift+B'], 'view:toggle-right-panel': ['Ctrl+Shift+R'], 'view:zoom-in': ['Ctrl+Shift+.'], 'view:zoom-out': ['Ctrl+Shift+,', 'Ctrl+-'], 'view:zoom-reset': ['Ctrl+0'], 'view:settings': ['Ctrl+,'], 'view:ribbon': ['Ctrl+F1'], 'help:user-guide': ['F1'],
  'review:new-comment': ['Ctrl+Alt+M'], 'review:toggle-track-changes': ['Ctrl+Shift+E'], 'spell:check': ['F7'],
};

/** Each preset is Word's table with these commands' bindings replaced (FR-20.2: presets differ only in this table). */
const PRESET_OVERRIDES: Readonly<Record<KeymapPresetId, KeyBindings>> = {
  word: {},
  vscode: { 'file:quick-open': ['Ctrl+P'], 'file:print': ['Ctrl+Alt+P'], 'view:toggle-sidebar': ['Ctrl+B'], 'format:bold': ['Ctrl+Shift+B'], 'edit:redo': ['Ctrl+Shift+Z', 'Ctrl+Y'], 'view:zoom-in': ['Ctrl+=', 'Ctrl+Shift+.'], 'view:zoom-out': ['Ctrl+-', 'Ctrl+Shift+,'], 'format:subscript': ['Ctrl+Alt+='], 'format:superscript': ['Ctrl+Alt+Shift+='] },
  typora: { 'format:heading-1': ['Ctrl+1'], 'format:heading-2': ['Ctrl+2'], 'format:heading-3': ['Ctrl+3'], 'format:heading-4': ['Ctrl+4'], 'format:heading-5': ['Ctrl+5'], 'format:heading-6': ['Ctrl+6'], 'format:normal-text': ['Ctrl+0'], 'view:zoom-reset': ['Ctrl+Shift+0'], 'format:inline-code': ['Ctrl+Shift+`'], 'format:code-block': ['Ctrl+Shift+K'], 'format:strikethrough': ['Alt+Shift+5'], 'format:numbered-list': ['Ctrl+Shift+['], 'format:bullet-list': ['Ctrl+Shift+]'], 'insert:table': ['Ctrl+T'], 'view:toggle-sidebar': ['Ctrl+Shift+L'], 'format:highlight': ['Ctrl+Shift+H'] },
  obsidian: { 'file:quick-open': ['Ctrl+O'], 'file:open': ['Ctrl+Shift+O'], 'view:command-palette': ['Ctrl+P'], 'file:print': ['Ctrl+Alt+P'], 'view:cycle-view-mode': ['Ctrl+E'], 'format:inline-code': [], 'format:task-list': ['Ctrl+L'], 'edit:redo': ['Ctrl+Shift+Z', 'Ctrl+Y'] },
};

/**
 * presetBindings resolves the final binding table for a single keymap preset.
 * @purpose Merges Word's default bindings with a preset's overrides so that only differing commands change (FR-20.2).
 * @inputs preset - The preset identifier whose bindings should be resolved, e.g. 'vscode'.
 * @outputs KeyBindings - A new record mapping every remappable command id to its chord list for the given preset.
 * @dataflow preset id → PRESET_OVERRIDES[preset] lookup → spread over WORD_BINDINGS (overrides win) → returned record.
 * @controlflow Look up the preset's override table, spread it after Word's defaults so overrides take precedence, return the merged result.
 */
export function presetBindings(preset: KeymapPresetId): KeyBindings {
  // Spread Word's defaults first so any command present in the preset's override table replaces its chord; commands absent from the override keep Word's value.
  return { ...WORD_BINDINGS, ...PRESET_OVERRIDES[preset] };
}

/**
 * Word shortcuts with no K-Doc equivalent, and the one line each shows when pressed while unbound (FR-20.1).
 */
export const UNBOUND_SHORTCUT_EXPLANATIONS: Readonly<Record<string, string>> = {
  'Ctrl+U': 'Markdown has no underline, so Ctrl+U does nothing. Bold or italic can stand in for it.',
  'Ctrl+J': 'Markdown has no justified text, so Ctrl+J does nothing. How a paragraph lines up is left to where it is read.',
  'Ctrl+1': 'Markdown has no line spacing, so Ctrl+1 does nothing. Set the spacing K-Doc shows in Settings > Appearance.',
  'Ctrl+2': 'Markdown has no line spacing, so Ctrl+2 does nothing. Set the spacing K-Doc shows in Settings > Appearance.',
  'Ctrl+5': 'Markdown has no line spacing, so Ctrl+5 does nothing. Set the spacing K-Doc shows in Settings > Appearance.',
};
