/**
 * @file view-mode-setting.spec.ts
 * @purpose Verifies the Default view setting: its default, and how settings saved before 0.3 are read.
 * @inputs Settings JSON strings passed to parseSettings.
 * @outputs Vitest assertions.
 * @functions
 *   - (tests only)
 * @dataflow JSON text -> parseSettings -> settings.editor.defaultViewMode and problems.
 * @controlflow Each case parses its own text; no shared state.
 * @version 1
 * @date 2026-10-13
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from '../src/index.js';

describe('the Default view setting', () => {
  it('defaults to Split', () => {
    expect(DEFAULT_SETTINGS.editor.defaultViewMode).toBe('split');
    expect(parseSettings('{}').settings.editor.defaultViewMode).toBe('split');
  });

  it('reads the old WYSIWYG and Preview values as the K-Doc view, without a warning', () => {
    for (const old of ['wysiwyg', 'preview']) {
      const result = parseSettings(JSON.stringify({ editor: { defaultViewMode: old } }));
      expect(result.settings.editor.defaultViewMode).toBe('kdoc');
      expect(result.problems.filter((problem) => problem.path === 'editor.defaultViewMode')).toEqual([]);
    }
  });

  it('still warns about a value it does not know and falls back to Split', () => {
    const result = parseSettings(JSON.stringify({ editor: { defaultViewMode: 'presentation' } }));
    expect(result.settings.editor.defaultViewMode).toBe('split');
    expect(result.problems.some((problem) => problem.path === 'editor.defaultViewMode')).toBe(true);
  });
});
