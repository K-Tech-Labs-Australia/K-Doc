/**
 * @file plugin-protocol.spec.ts
 * @purpose Exercises readRegistration and readPluginMessage against FR-14.18 so that every value a plugin worker says is checked before it crosses into the host, where null means "refuse" rather than an exception.
 * @inputs Raw values shaped like what a plugin worker would hand back: registrations of each point plus ready/answer/failed messages.
 * @outputs No runtime output; vitest records pass/fail for each boundary case so a bad registration or message fails the suite instead of loading half-way into K-Doc.
 * @functions
 *   - command: builds one valid command registration with whatever the caller overrides, so every test starts from something correct and changes only one thing.
 *   - describe/it/expect: vitest harness that runs each case in isolation.
 * @dataflow Test input object -> readRegistration or readPluginMessage reader -> validated union member or null -> expect assertion recording pass/fail.
 * @controlflow For each test, build the raw value with command (or a literal), run it through one reader, and assert either an exact match or that the answer is null; nothing throws because every reader answers null on unrecognised input.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';

import { readPluginMessage, readRegistration } from '../src/plugins/plugin-protocol.js';

/** Builds one valid command registration with whatever the caller wants changed.
 * @purpose Starting from something that already reads back correctly is what makes each test about the single field it overrides rather than a new bug elsewhere in the reader.
 * @inputs extra - A partial override applied last, so any key here replaces the matching default (id, label or point).
 * @outputs Record<string, unknown> - The command object with defaults filled and only the requested keys replaced.
 * @dataflow Default command fields -> spread of caller overrides -> single merged record handed to a reader.
 * @controlflow Always returns an object; later spreads win over earlier ones so one override cannot leave two conflicting values for the same key. */
function command(extra: Record<string, unknown>): Record<string, unknown> {
  return { point: 'command', id: 'go', label: 'Go', ...extra };
}

/** The valid syntax registration reused by tests that change only its tag or pattern.
 * @purpose Holding the one known-good syntax in a constant lets each test spread it and touch just the field under review, mirroring how command works for commands.
 * @inputs none - A fixed, already-valid object read back unchanged by test 4.
 * @outputs Record<string, unknown> - The full valid syntax record ready to be overridden with `...syntax`.
 * @dataflow Fixed literal -> spread source for tests 12 and 14 which replace one of its fields.
 * @controlflow Defined once at module scope so every test that needs a starting point reads the identical object. */
const syntax = { point: 'syntax', id: 'mark', pattern: '@@[a-z]+', tag: 'mark', className: 'plugin-mark' };

describe('readRegistration', () => {
  // Test 1 proves one fully valid command round-trips to exactly its three fields.
  it('reads a command back unchanged', () => {
    expect(readRegistration(command({}))).toEqual({ point: 'command', id: 'go', label: 'Go' });
  });

  // Test 2 proves the panel point reads back with only its own two fields.
  it('reads a panel back unchanged', () => {
    expect(
      readRegistration({ point: 'panel', id: 'counts', title: 'Counts' }),
    ).toEqual({ point: 'panel', id: 'counts', title: 'Counts' });
  });

  // Test 3 proves the export point reads back with all four of its fields intact.
  it('reads an export back unchanged', () => {
    expect(
      readRegistration({ point: 'export', id: 'csv', name: 'CSV', extension: 'csv' }),
    ).toEqual({ point: 'export', id: 'csv', name: 'CSV', extension: 'csv' });
  });

  // Test 4 proves the syntax point reads back with all five of its fields intact.
  it('reads a syntax back unchanged', () => {
    expect(
      readRegistration({ ...syntax }),
    ).toEqual({ point: 'syntax', id: 'mark', pattern: '@@[a-z]+', tag: 'mark', className: 'plugin-mark' });
  });

  // Test 5 proves anything that is not an object answers null instead of throwing.
  it('reads every non-object as nothing', () => {
    expect(readRegistration(null)).toBeNull();
    expect(readRegistration(undefined)).toBeNull();
    expect(readRegistration(7)).toBeNull();
    expect(readRegistration('command')).toBeNull();
    expect(readRegistration([])).toBeNull();
  });

  // Test 6 proves a point K-Doc has never heard of answers null before any field is read.
  it('reads an unknown point as nothing', () => {
    expect(readRegistration(command({ point: 'wizardry' }))).toBeNull();
  });

  // Test 7 proves each id that is not a plain word fails the same guard K-Doc uses for folder and file names.
  it('reads every non-word id as nothing', () => {
    expect(readRegistration(command({ id: 'Go' }))).toBeNull();
    expect(readRegistration(command({ id: 'a/b' }))).toBeNull();
    expect(readRegistration(command({ id: '' }))).toBeNull();
    expect(readRegistration(command({ id: 'a.b' }))).toBeNull();
    expect(readRegistration(command({ id: 7 }))).toBeNull();
  });

  // Test 8 proves a label that is blank, too long or not text answers null rather than reaching a menu.
  it('reads every bad label as nothing', () => {
    expect(readRegistration(command({ label: '  ' }))).toBeNull();
    expect(readRegistration(command({ label: 'x'.repeat(81) }))).toBeNull();
    expect(readRegistration(command({ label: 7 }))).toBeNull();
  });

  // Test 9 proves a label of exactly the maximum length still reads, so the boundary is inclusive.
  it('reads a label at the exact limit', () => {
    const result = readRegistration(command({ label: 'x'.repeat(80) }));

    // Narrowed before reading the label, because only a command registration carries one.
    expect(result?.point).toBe('command');
    if (result !== null && result.point === 'command') {
      expect(result.label).toBe('x'.repeat(80));
    } else {
      // Not a command: the assertion above has already failed.
    }
  });

  // Test 10 proves surrounding whitespace is trimmed away so menus never show stray spaces.
  it('trims a label before reading it', () => {
    const result = readRegistration(command({ label: '  Go  ' }));

    // Narrowed before reading the label, because only a command registration carries one.
    expect(result?.point).toBe('command');
    if (result !== null && result.point === 'command') {
      expect(result.label).toBe('Go');
    } else {
      // Not a command: the assertion above has already failed.
    }
  });

  // Test 11 proves each extension that is not a plain word fails the filename-safety guard.
  it('reads every non-word extension as nothing', () => {
    const base = { point: 'export', id: 'csv', name: 'CSV', extension: '' };
    expect(readRegistration({ ...base, extension: 'CSV' })).toBeNull();
    expect(readRegistration({ ...base, extension: 'c v' })).toBeNull();
    expect(readRegistration({ ...base, extension: 'c.v' })).toBeNull();
    expect(readRegistration({ ...base, extension: '' })).toBeNull();
    expect(readRegistration({ ...base, extension: 'abcdefghijklm' })).toBeNull();
  });

  // Test 12 proves a tag that can run or load answers null; this is the point of the list:
  // a plugin chooses from what K-Doc will draw, it does not name an element.
  it('reads every runnable or loadable tag as nothing', () => {
    expect(readRegistration({ ...syntax, tag: 'script' })).toBeNull();
    expect(readRegistration({ ...syntax, tag: 'iframe' })).toBeNull();
    expect(readRegistration({ ...syntax, tag: 'img' })).toBeNull();
    expect(readRegistration({ ...syntax, tag: 'div' })).toBeNull();
    expect(readRegistration({ ...syntax, tag: 'SPAN' })).toBeNull();
    expect(readRegistration({ ...syntax, tag: 7 })).toBeNull();
  });

  // Test 13 proves each class name that is not a plain word fails the attribute-escape guard.
  it('reads every non-word class name as nothing', () => {
    const quote = String.fromCharCode(34);
    expect(readRegistration({ ...syntax, className: 'Plugin' })).toBeNull();
    expect(readRegistration({ ...syntax, className: 'a b' })).toBeNull();
    expect(readRegistration({ ...syntax, className: `a${quote}b` })).toBeNull();
    expect(readRegistration({ ...syntax, className: '' })).toBeNull();
  });

  // Test 14 proves a pattern that will not compile answers null, because one that throws would throw in the middle of drawing a document.
  it('reads an uncompilable pattern as nothing', () => {
    expect(readRegistration({ ...syntax, pattern: '([a-z' })).toBeNull();
  });

  // Test 15 proves a pattern longer than the limit answers null before it is ever compiled against a document.
  it('reads an over-long pattern as nothing', () => {
    expect(readRegistration({ ...syntax, pattern: 'x'.repeat(201) })).toBeNull();
  });
});

describe('readPluginMessage', () => {
  // Test 16 proves a ready message with no registrations reads back with an empty array.
  it('reads an empty ready unchanged', () => {
    const result = readPluginMessage({ kind: 'ready', registrations: [] });
    expect(result?.kind).toBe('ready');
    if (result && result.kind === 'ready') {
      expect(result.registrations).toEqual([]);
    }
  });

  // Test 17 proves two valid registrations read back as two, so a populated ready is not collapsed.
  it('reads a ready with two registrations', () => {
    const result = readPluginMessage({
      kind: 'ready',
      registrations: [command({}), command({ id: 'stop', label: 'Stop' })],
    });
    expect(result?.kind).toBe('ready');
    if (result && result.kind === 'ready') {
      expect(result.registrations.length).toBe(2);
    }
  });

  // Test 18 proves one bad registration costs the whole message, because half-loading it would hide that bug.
  it('reads a ready with one bad registration as nothing', () => {
    const result = readPluginMessage({ kind: 'ready', registrations: [command({}), 7] });
    expect(result).toBeNull();
  });

  // Test 19 proves registrations must be an array, so anything else answers null.
  it('reads a ready whose registrations are not an array as nothing', () => {
    const result = readPluginMessage({ kind: 'ready', registrations: 'none' });
    expect(result).toBeNull();
  });

  // Test 20 proves an answer with all its fields reads back exactly the same.
  it('reads a full answer unchanged', () => {
    const result = readPluginMessage({ kind: 'answer', call: 3, text: 'hi', message: null });
    expect(result).toEqual({ kind: 'answer', call: 3, text: 'hi', message: null });
  });

  // Test 21 proves an answer with neither text nor message is still a valid answer.
  it('reads an empty-text answer unchanged', () => {
    const result = readPluginMessage({ kind: 'answer', call: 5, text: null, message: null });
    expect(result).toEqual({ kind: 'answer', call: 5, text: null, message: null });
  });

  // Test 22 proves a call that is not a whole non-negative number answers null so replies cannot be matched back.
  it('reads every bad call as nothing', () => {
    expect(readPluginMessage({ kind: 'answer', call: -1, text: 'hi', message: null })).toBeNull();
    expect(readPluginMessage({ kind: 'answer', call: 1.5, text: 'hi', message: null })).toBeNull();
    expect(readPluginMessage({ kind: 'answer', call: '3', text: 'hi', message: null })).toBeNull();
    expect(readPluginMessage({ kind: 'answer', call: null, text: 'hi', message: null })).toBeNull();
  });

  // Test 23 proves an answer's text must be text or nothing, so a number cannot reach the document.
  it('reads an answer with non-text text as nothing', () => {
    const result = readPluginMessage({ kind: 'answer', call: 1, text: 7, message: null });
    expect(result).toBeNull();
  });

  // Test 24 proves an answer's status message must be short so it cannot overflow the status bar.
  it('reads a too-long message as nothing', () => {
    const result = readPluginMessage({ kind: 'answer', call: 1, text: null, message: 'x'.repeat(81) });
    expect(result).toBeNull();
  });

  // Test 25 proves a failure with both fields reads back exactly the same.
  it('reads a full failure unchanged', () => {
    const result = readPluginMessage({ kind: 'failed', call: 2, reason: 'it broke' });
    expect(result).toEqual({ kind: 'failed', call: 2, reason: 'it broke' });
  });

  // Test 26 proves a failure need not name a call and reads back with a null call.
  it('reads a failure without a call unchanged', () => {
    const result = readPluginMessage({ kind: 'failed', call: null, reason: 'it broke' });
    expect(result).toEqual({ kind: 'failed', call: null, reason: 'it broke' });
  });

  // Test 27 proves a failure must say why, so blank or non-text reasons answer null.
  it('reads every bad reason as nothing', () => {
    expect(readPluginMessage({ kind: 'failed', call: 1, reason: '' })).toBeNull();
    expect(readPluginMessage({ kind: 'failed', call: 1, reason: '   ' })).toBeNull();
    expect(readPluginMessage({ kind: 'failed', call: 1, reason: 7 })).toBeNull();
  });

  // Test 28 proves a kind K-Doc does not have answers null, including an object with no kind at all.
  it('reads every unknown kind as nothing', () => {
    expect(readPluginMessage({ kind: 'shrug' })).toBeNull();
    expect(readPluginMessage({})).toBeNull();
  });
});

describe('syntax patterns that could freeze rendering', () => {
  it('refuses a quantified group that itself contains a quantifier', () => {
    for (const pattern of ['(a+)+$', '(\\w+\\s?)*x', '(x|y+){2,}', '(a*)*b']) {
      expect(readRegistration({ ...syntax, pattern }), pattern).toBeNull();
    }
  });

  it('still accepts ordinary patterns, including a repeated group without an inner quantifier', () => {
    for (const pattern of ['@@[a-z]+', '(ab)+', '\\bTODO\\b', '#[A-Za-z0-9_]+']) {
      expect(readRegistration({ ...syntax, pattern }), pattern).not.toBeNull();
    }
  });
});

