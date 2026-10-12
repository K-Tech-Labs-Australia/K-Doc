/**
 * @file session-saved-text.spec.ts
 * @purpose Verifies DocumentSession's savedText option: a remounted tab keeps its unsaved state because the session compares against the carried saved text rather than its starting text.
 * @inputs Markdown strings and DocumentSession options.
 * @outputs Vitest pass/fail results.
 * @functions
 *   - (describe) DocumentSession savedText option: construction, editing back, markSaved, reset, empty baseline.
 * @dataflow text + savedText -> DocumentSession -> snapshot.dirty / snapshot.savedText -> assertions.
 * @controlflow Each case builds its own session, optionally edits, saves or resets, then asserts.
 * @version 1
 * @date 2026-09-14
 */

import { describe, expect, it } from 'vitest';
import { DocumentSession } from '../src/index.js';

describe('DocumentSession savedText option', () => {
  it('starts clean when no saved text is given', () => {
    // Proves that with no options the starting text is treated as the saved baseline.
    const session = new DocumentSession('# A\n');
    expect(session.snapshot.dirty).toBe(false);
    expect(session.snapshot.savedText).toBe('# A\n');
  });

  it('starts clean when savedText is explicitly undefined', () => {
    // Proves that an explicit undefined savedText behaves like omission.
    const session = new DocumentSession('# A\n', { savedText: undefined });
    expect(session.snapshot.dirty).toBe(false);
    expect(session.snapshot.savedText).toBe('# A\n');
  });

  it('starts dirty when the saved text differs from the starting text', () => {
    // Proves that a carried saved text shorter than the current text marks the session dirty.
    const session = new DocumentSession('# A edited\n', { savedText: '# A\n' });
    expect(session.snapshot.dirty).toBe(true);
    expect(session.snapshot.savedText).toBe('# A\n');
    expect(session.snapshot.text).toBe('# A edited\n');
  });

  it('starts clean when the saved text equals the starting text', () => {
    // Proves that a carried saved text equal to the current text reads as clean.
    const session = new DocumentSession('# A\n', { savedText: '# A\n' });
    expect(session.snapshot.dirty).toBe(false);
  });

  it('editing back to the saved text reads clean', () => {
    // Proves that editing the text back to the carried baseline clears the dirty flag.
    const session = new DocumentSession('# A edited\n', { savedText: '# A\n' });
    session.focusPane('source');
    session.applyText('# A\n');
    expect(session.snapshot.dirty).toBe(false);
  });

  it('markSaved replaces the carried baseline', () => {
    // Proves that markSaved records the current text as the new saved baseline.
    const session = new DocumentSession('# A edited\n', { savedText: '# A\n' });
    session.markSaved();
    expect(session.snapshot.dirty).toBe(false);
    expect(session.snapshot.savedText).toBe('# A edited\n');
  });

  it('reset replaces the carried baseline', () => {
    // Proves that reset swaps in new content and treats it as saved.
    const session = new DocumentSession('# A edited\n', { savedText: '# A\n' });
    session.reset('# B\n');
    expect(session.snapshot.dirty).toBe(false);
    expect(session.snapshot.savedText).toBe('# B\n');
    expect(session.snapshot.text).toBe('# B\n');
  });

  it('an empty saved text is honoured rather than treated as absent', () => {
    // Proves that an empty baseline is a real value (?? not ||), so any non-empty text reads dirty.
    const session = new DocumentSession('# A\n', { savedText: '' });
    expect(session.snapshot.dirty).toBe(true);
    expect(session.snapshot.savedText).toBe('');
  });
});