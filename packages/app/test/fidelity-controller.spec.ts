/**
 * @file fidelity-controller.spec.ts
 * @purpose Verifies createFidelityController, describeFinding, and previewSpan — the controller that runs the Fidelity Check (FR-4.5) on save and feeds the Problems panel.
 * @inputs STAR/DASH sample documents, a toggleable enabled flag via harness(), and SessionChange reasons emitted by fakeSession to advance snapshots.
 * @outputs No runtime values; assertions via expect() verify controller behavior against reports and problems().
 * @functions
 *   - fakeSession: Builds a faked DocumentSession whose snapshot can be advanced by emit() to drive controller changes.
 *   - harness: Wraps createFidelityController with a toggleable enabled gate and a collector for reported findings.
 * @dataflow Constants → fakeSession snapshots → controller.attach/saved → FidelityTracker check → onReport into reports → expect assertions.
 * @controlflow Describe blocks group cases; each case fakes a session, attaches, emits changes, saves, then asserts on reports/problems.
 * @version 1
 * @date 2026-09-14
 */

import { describe, expect, it } from 'vitest';
import type { DocumentSession, FidelityFinding, SessionChange } from '@k-doc/core';
import { createFidelityController, describeFinding, previewSpan, FIDELITY_PREVIEW_CHARS } from '../src/shell/fidelity-controller.js';

/** A bullet list document using asterisk markers. */
const STAR = '* a\n* b\n\nText\n';

/** The same document reformatted with dash markers on save. */
const DASH = '- a\n- b\n\nText\n';

/**
 * @purpose Builds a minimal DocumentSession whose snapshot can be mutated via emit() so tests drive session changes deterministically.
 * @inputs savedText — the merge-base text the tracker starts from; text — the initial buffer text.
 * @outputs { session, emit, listenerCount } — a faked session plus helpers to fire changes and count subscribers.
 * @dataflow savedText/text → snapshot object read by controller.attach via session.snapshot; emit() updates the snapshot and notifies listeners.
 * @controlflow Initialize snapshot/listeners → build session with getter + subscribe → return methods that mutate the snapshot and dispatch to listeners.
 */
function fakeSession(
  savedText: string,
  text: string,
): {
  session: DocumentSession;
  emit: (reason: SessionChange['reason'], nextText: string, pane?: 'wysiwyg' | 'source') => void;
  listenerCount: () => number;
} {
  // The mutable snapshot the controller reads; focusedPane defaults to the WYSIWYG editor.
  let snapshot = { text, savedText, focusedPane: 'wysiwyg' as 'wysiwyg' | 'source' };
  // Active subscribers pushed by subscribe() and removed by their returned teardown.
  const listeners: Array<(change: SessionChange) => void> = [];

  // Only the two members the controller reads (snapshot, subscribe) are faked; the rest is structurally ignored via cast.
  const session = {
    get snapshot() {
      return snapshot;
    },
    subscribe(listener: (change: SessionChange) => void) {
      listeners.push(listener);
      return (): void => {
        // Locate the listener's index so it can be removed on teardown.
        const i = listeners.indexOf(listener);
        if (i >= 0) {
          // Found: remove exactly this listener from the active set.
          listeners.splice(i, 1);
        } else {
          // Not present (already removed or never added): nothing to do.
        }
      };
    },
  } as unknown as DocumentSession;

  function emit(
    reason: SessionChange['reason'],
    nextText: string,
    pane: 'wysiwyg' | 'source' = 'wysiwyg',
  ): void {
    // Advance the snapshot to reflect the new text and focused pane.
    snapshot = { ...snapshot, text: nextText, focusedPane: pane };

    // Iterate a copy so a listener may unsubscribe during dispatch without disturbing the loop.
    for (const listener of [...listeners]) {
      listener({ snapshot, reason, replacedRanges: [] } as unknown as SessionChange);
    }
  }

  function listenerCount(): number {
    return listeners.length;
  }

  return { session, emit, listenerCount };
}

/**
 * @purpose Wraps createFidelityController with a mutable enabled flag and a collector for reported findings.
 * @inputs enabled — initial on/off state of the fidelity check (defaults true).
 * @outputs { controller, reports, setEnabled } — the controller, every report it emitted in order, and a setter to toggle the gate.
 * @dataflow `on` → options.enabled() gates each save; onReport pushes findings into reports for assertions.
 * @controlflow Hold `on` state → build controller with enabled reading `on` and onReport collecting → return handle.
 */
function harness(enabled: boolean = true): {
  controller: ReturnType<typeof createFidelityController>;
  reports: Array<readonly FidelityFinding[]>;
  setEnabled: (v: boolean) => void;
} {
  // The gate state read by options.enabled() at each save.
  let on = enabled;
  // Every report emitted, in save order, for per-save assertions.
  const reports: Array<readonly FidelityFinding[]> = [];
  const controller = createFidelityController({
    enabled: () => on,
    onReport: (f) => {
      // Record the findings so tests can assert what each save reported.
      reports.push(f);
    },
  });

  function setEnabled(v: boolean): void {
    on = v;
  }

  return { controller, reports, setEnabled };
}

describe('createFidelityController', () => {
  it('reports a WYSIWYG edit that reformats an unedited block', () => {
    const { session, emit } = fakeSession(STAR, STAR);
    const { controller, reports } = harness();
    controller.attach(session);
    emit('edit', DASH, 'wysiwyg');
    controller.saved(DASH);

    expect(reports).toHaveLength(1);
    expect(reports[0]).toHaveLength(1);

    const problems = controller.problems(DASH);
    expect(problems).toEqual([
      {
        kind: 'fidelity',
        label: 'list block',
        detail: 'Changed on save though not edited: "* a\\n* b" became "- a\\n- b"',
        from: 0,
        to: 7,
      },
    ]);
  });

  it('does not report the same change typed in the Source pane', () => {
    const { session, emit } = fakeSession(STAR, STAR);
    const { controller, reports } = harness();
    controller.attach(session);
    emit('edit', DASH, 'source');
    controller.saved(DASH);

    expect(reports).toEqual([[]]);
    expect(controller.problems(DASH)).toEqual([]);
  });

  it('does not report a change applied as text by a tool', () => {
    const { session, emit } = fakeSession(STAR, STAR);
    const { controller, reports } = harness();
    controller.attach(session);
    emit('external', DASH);
    controller.saved(DASH);

    expect(reports).toEqual([[]]);
  });

  it('treats undo and redo as the user\'s', () => {
    const { session, emit } = fakeSession(STAR, STAR);
    const { controller, reports } = harness();
    controller.attach(session);
    emit('undo', DASH);
    controller.saved(DASH);
    emit('redo', STAR);
    controller.saved(STAR);

    expect(reports).toEqual([[], []]);
  });

  it('does nothing when disabled', () => {
    const { session, emit } = fakeSession(STAR, STAR);
    const { controller, reports } = harness(false);
    controller.attach(session);
    emit('edit', DASH);
    controller.saved(DASH);

    expect(reports).toEqual([]);
    expect(controller.problems(DASH)).toEqual([]);
  });

  it('withdraws findings once the text moves on', () => {
    const { session, emit } = fakeSession(STAR, STAR);
    const { controller } = harness();
    controller.attach(session);
    emit('edit', DASH, 'wysiwyg');
    controller.saved(DASH);

    expect(controller.problems(DASH + 'x')).toEqual([]);
    expect(controller.problems(DASH)).toHaveLength(1);
  });

  it('rebases on a reset', () => {
    const { session, emit } = fakeSession(STAR, STAR);
    const { controller, reports } = harness();
    controller.attach(session);
    emit('reset', DASH);
    controller.saved(DASH);

    expect(reports).toEqual([[]]);
  });

  it('judges edits after a reset against the reset text', () => {
    // A reset is a different document, so a later WYSIWYG edit is compared with it, not with the text before the reset
    const { session, emit } = fakeSession(STAR, STAR);
    const { controller, reports } = harness();
    controller.attach(session);
    emit('reset', DASH);
    emit('edit', '- a\n- b\n\nText edited\n', 'wysiwyg');
    controller.saved('- a\n- b\n\nText edited\n');
    expect(reports).toEqual([[]]);
  });

  it('ignores focus changes', () => {
    const { session, emit } = fakeSession(STAR, STAR);
    const { controller, reports } = harness();
    controller.attach(session);
    emit('focus', STAR);
    emit('edit', DASH);
    controller.saved(DASH);

    expect(reports[0]).toHaveLength(1);
  });

  it('makes the saved text the next baseline', () => {
    const { session, emit } = fakeSession(STAR, STAR);
    const { controller, reports } = harness();
    controller.attach(session);
    emit('edit', DASH, 'wysiwyg');
    controller.saved(DASH);

    controller.saved(DASH);

    expect(reports[1]).toEqual([]);
  });

  it('treats unsaved work a tab was mounted with as touched', () => {
    const { session } = fakeSession(STAR, DASH);
    const { controller, reports } = harness();
    controller.attach(session);
    controller.saved(DASH);

    expect(reports).toEqual([[]]);
  });

  it('replaces the previous session on attach', () => {
    const first = fakeSession(STAR, STAR);
    const second = fakeSession(STAR, STAR);
    const { controller } = harness();
    controller.attach(first.session);
    controller.attach(second.session);

    expect(first.listenerCount()).toBe(0);
    expect(second.listenerCount()).toBe(1);
  });

  it('stops listening and reporting after destroy', () => {
    const { session, listenerCount } = fakeSession(STAR, STAR);
    const { controller, reports } = harness();
    controller.attach(session);
    controller.destroy();

    expect(listenerCount()).toBe(0);
    controller.saved(DASH);
    expect(reports).toEqual([]);

    // Calling destroy a second time must be safe (idempotent teardown).
    expect(() => controller.destroy()).not.toThrow();
  });

  it('saved before attach does nothing', () => {
    const { controller, reports } = harness();
    controller.saved(DASH);

    expect(reports).toEqual([]);
  });
});

describe('previewSpan and describeFinding', () => {
  it('bounds long spans and serializes control escapes in previewSpan', () => {
    // A short span is serialized verbatim with its newline escape visible.
    expect(previewSpan('a\n')).toBe('"a\\n"');
    // An empty span serializes to quoted emptiness.
    expect(previewSpan('')).toBe('""');
    // One character over the budget truncates and appends a single ellipsis glyph.
    expect(
      previewSpan('x'.repeat(FIDELITY_PREVIEW_CHARS + 1)),
    ).toBe(JSON.stringify('x'.repeat(FIDELITY_PREVIEW_CHARS) + '…'));
    // Exactly at the budget is shown in full with no truncation.
    expect(previewSpan('x'.repeat(FIDELITY_PREVIEW_CHARS))).toBe(
      JSON.stringify('x'.repeat(FIDELITY_PREVIEW_CHARS)),
    );
  });

  it('maps a gap finding to its fidelity problem in describeFinding', () => {
    const problem = describeFinding({
      kind: 'gap',
      nodeType: 'gap',
      from: 4,
      to: 6,
      baseFrom: 4,
      baseTo: 7,
      before: '\n\n\n',
      after: '\n\n',
    });

    expect(problem.label).toBe('Blank space between blocks');
    expect(problem.kind).toBe('fidelity');
    expect(problem.from).toBe(4);
    expect(problem.to).toBe(6);
  });
});
