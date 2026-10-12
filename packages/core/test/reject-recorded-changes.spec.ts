/**
 * @file reject-recorded-changes.spec.ts
 * @purpose Regression tests: rejecting every tracked change recorded over a sequence of edits gives back the starting text, including after front matter (the kdoc_id the store adds) is put above the changes.
 * @inputs literal texts and edit sequences.
 * @outputs vitest assertions.
 * @functions
 *   - record: Applies an edit sequence under a recorder and returns the final snapshot plus all tracked changes.
 * @dataflow start text -> session edits under a recorder -> changes -> applyDecisions(reject).
 * @controlflow one case per sequence, each checked plain and with front matter.
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { DocumentSession, applyDecisions, createChangeRecorder } from '../src/index.js';
import type { TrackedChange } from '../src/index.js';

const FRONT_MATTER = '---\nkdoc_id: 01HZY3G6Q2K8V4M5N6P7R8S9TA\n---\n\n';

// Applies each edit to a document session under a change recorder, collecting every tracked change.
// @purpose Drive an edit sequence through the recorder so its output can be replayed via applyDecisions.
// @inputs start - initial document text; edits - ordered list of applied text edits.
// @returns { final: string; changes: TrackedChange[] } - resulting snapshot text and all recorded changes.
// @dataflow start text -> DocumentSession.applyText under recorder -> onRecord callback collects changes -> snapshot.text returned as final.
// @controlflow Create session, enable tracking, iterate edits advancing the clock each step, destroy recorder, return collected results.
function record(start: string, edits: readonly string[]): { final: string; changes: TrackedChange[] } {
  const session = new DocumentSession(start);
  session.focusPane('source');
  const changes: TrackedChange[] = [];
  let next = 0;
  let clock = Date.parse('2026-09-16T08:00:00Z');
  const recorder = createChangeRecorder({
    session,
    author: () => 'Ada',
    newId: () => `c${next++}`,
    now: () => new Date(clock),
    onRecord: (recorded) => {
      changes.push(...recorded);
    },
  });
  recorder.setTracking(true);
  for (const edit of edits) {
    clock += 1_000;
    session.applyText(edit);
  }
  recorder.destroy();
  return { final: session.snapshot.text, changes };
}

const CASES: readonly (readonly [string, string, readonly string[]])[] = [
  ['forward delete twice', 'abcd efgh', ['acd efgh', 'ad efgh']],
  ['backspace twice', 'abcd efgh', ['abd efgh', 'ad efgh']],
  ['type then delete elsewhere', 'one two three', ['one twoX three', 'one twoX thee']],
  ['insert twice at one place', 'one two', ['one Xtwo', 'one XYtwo']],
  ['type a word then delete inside it', 'one two', ['one abc two', 'one ac two']],
];

describe('rejecting recorded changes', () => {
  for (const [name, start, edits] of CASES) {
    // newest-first undoing rebuilds the text each older change was anchored in, even with front matter added above.
    it(`gives back the starting text: ${name}`, () => {
      const { final, changes } = record(start, edits);
      expect(applyDecisions(final, changes, 'reject')).toBe(start);
      expect(applyDecisions(FRONT_MATTER + final, changes, 'reject')).toBe(FRONT_MATTER + start);
    });
  }
});
