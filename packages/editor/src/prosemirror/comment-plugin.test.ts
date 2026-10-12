/**
 * @file comment-plugin.test.ts
 * @purpose Vitest suite for K-Doc's comment decoration plugin (FR-10.1). Verifies span-to-decoration conversion, overlapping and duplicate threads, active-thread selection, position mapping across edits, out-of-bounds guards, and the readers' tolerance of an absent plugin.
 * @inputs EditorState instances built on kdocSchema, CommentSpan fixtures, and ProseMirror transactions.
 * @outputs Vitest assertions over commentsAt, activeThreadId, and the plugin's DecorationSet.
 * @functions
 *   - createTestDoc: Helper creating a standard ProseMirror document with a single paragraph.
 *   - createTestState: Helper creating an EditorState on kdocSchema, test doc, and optional comment plugin.
 *   - span: Factory building a CommentSpan fixture from a thread id, range, state and confidence.
 *   - applySpans: Applies a set of CommentSpan fixtures to a transaction via setCommentSpans.
 *   - decorationCount: Counts active comment decorations in an EditorState's DecorationSet.
 * @dataflow CommentSpan fixtures -> setCommentSpans / setActiveThread -> state.apply -> commentsAt / activeThreadId / decoration counts -> expect assertions.
 * @controlflow Absent-plugin fallbacks -> span painting -> overlap and de-duplication -> selection without movement -> mapping across an edit -> bounds guards -> combined metadata -> stylesheet constants.
 * @version 1
 * @date 2026-09-07
 */

import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import type { CommentSpan } from '@k-doc/core';
import { kdocSchema } from './schema.js';
import {
  createCommentPlugin,
  setCommentSpans,
  setActiveThread,
  commentsAt,
  activeThreadId,
  commentPluginKey,
  COMMENT_DECORATION_CLASS,
  COMMENT_RESOLVED_CLASS,
  COMMENT_ACTIVE_CLASS,
  COMMENT_STYLES,
} from './comment-plugin.js';

/**
 * Creates a standard ProseMirror test document node containing a single paragraph of text.
 *
 * @purpose Constructs a real ProseMirror Node tree using kdocSchema for deterministic test document structure.
 * @inputs text: string - The text content to populate inside the paragraph.
 * @outputs ProseMirrorNode - The root doc node containing the paragraph.
 * @dataflow text -> kdocSchema.text -> kdocSchema.node('paragraph') -> kdocSchema.node('doc').
 * @controlflow Wrap text in paragraph node -> wrap paragraph in doc node -> return doc.
 */
function createTestDoc(text: string): ProseMirrorNode {
  // Build the document tree from the given text and return it as a Node.
  return kdocSchema.node('doc', null, [
    kdocSchema.node('paragraph', null, [kdocSchema.text(text)]),
  ]);
}

/**
 * Creates an EditorState initialized with kdocSchema and the given document text, optionally including the comment plugin.
 *
 * @purpose Helper building a real EditorState on kdocSchema, optionally with createCommentPlugin().
 * @inputs
 *   - text: string - The text string for the test paragraph.
 *   - withPlugin: boolean - Whether to install the comment plugin in this state.
 * @outputs EditorState - The configured ProseMirror EditorState.
 * @dataflow text + withPlugin -> createTestDoc -> EditorState.create.
 * @controlflow Build doc -> check withPlugin -> configure plugins array -> return EditorState.create.
 */
function createTestState(text: string, withPlugin: boolean): EditorState {
  const doc = createTestDoc(text);

  // Check whether the comment plugin should be installed on this test state.
  if (withPlugin) {
    // Plugin requested: install createCommentPlugin().
    return EditorState.create({
      doc,
      schema: kdocSchema,
      plugins: [createCommentPlugin()],
    });
  } else {
    // Plugin not requested: create state without comment plugin.
    return EditorState.create({
      doc,
      schema: kdocSchema,
      plugins: [],
    });
  }
}

/**
 * Constructs a CommentSpan fixture with the given thread id, range, mark state, and confidence.
 *
 * @purpose Builds a readonly CommentSpan record matching the shape exported from @k-doc/core for use in tests.
 * @inputs
 *   - threadId: string - The identifier of the comment thread owning this span.
 *   - start: number - Inclusive start offset of the marked range within the document.
 *   - end: number - Exclusive end offset of the marked range within the document.
 *   - state: 'open' | 'resolved' - Whether the owning thread is open or resolved at decoration time.
 *   - confidence: number - Resolution confidence score between 0 and 1 (drives opacity).
 * @outputs CommentSpan - A fully populated comment span fixture.
 * @dataflow threadId + start + end + state + confidence -> object literal -> CommentSpan.
 * @controlflow Assemble fields in one expression -> return the constructed span.
 */
function span(
  threadId: string,
  start: number,
  end: number,
  state: 'open' | 'resolved',
  confidence: number,
): CommentSpan {
  // Build a comment span fixture with all required fields populated from the inputs.
  return { threadId, start, end, state, confidence };
}

/**
 * Applies a set of comment spans to an editor state via a single transaction and returns the resulting state.
 *
 * @purpose Wraps setCommentSpans on state.tr followed by state.apply so tests can advance one step with real metadata merging.
 * @inputs
 *   - state: EditorState - The current editor state whose transaction will carry the spans.
 *   - spans: readonly CommentSpan[] - The comment spans to attach and apply.
 * @outputs EditorState - The new editor state after applying the span-carrying transaction.
 * @dataflow state.tr -> setCommentSpans(tr, spans) -> state.apply -> updated EditorState.
 * @controlflow Create base transaction -> attach spans via metadata -> commit through apply -> return applied state.
 */
function applySpans(state: EditorState, spans: readonly CommentSpan[]): EditorState {
  // Attach the comment spans to a fresh transaction and commit it into a new editor state.
  return state.apply(setCommentSpans(state.tr, spans));
}

/**
 * Returns the number of inline decorations currently tracked by the comment plugin in an editor state.
 *
 * @purpose Reads the decoration set through commentPluginKey.getState and counts its entries, tolerating an absent plugin.
 * @inputs state: EditorState - The editor state whose comment decorations should be counted.
 * @outputs number - The count of decorations present on the plugin's DecorationSet (0 when no plugin is installed).
 * @dataflow commentPluginKey.getState(state) -> optional decorations.find() -> length or 0 fallback.
 * @controlflow Read plugin state -> if present return decoration count; otherwise fall back to zero.
 */
function decorationCount(state: EditorState): number {
  // Count decorations when the plugin is installed, falling back to zero when it is absent.
  const pluginState = commentPluginKey.getState(state);

  // Check whether the comment plugin state exists on this editor state.
  if (pluginState !== undefined) {
    // Plugin present: count its inline decorations via find() with no predicate arguments.
    return pluginState.decorations.find().length;
  } else {
    // Plugin absent: report zero decorations rather than throwing at an uninstalled key.
    return 0;
  }
}

describe('comment-plugin', () => {
  const sampleText = 'The quick brown fox';
  // Position mapping in ProseMirror doc:
  // Position 0 is before <doc>
  // Position 1 is before 'The...' inside <paragraph>
  // 'quick' is from character index 4 to 9 -> document positions 5 to 10

  it('tolerates the plugin being absent from state returning null / []', () => {
    const stateWithout = createTestState(sampleText, false);

    // commentsAt must return an empty array when the plugin is not installed.
    expect(commentsAt(stateWithout, 3)).toEqual([]);

    // activeThreadId must return null when the plugin is not installed.
    expect(activeThreadId(stateWithout)).toBeNull();
  });

  it('records spans via setCommentSpans and reports each thread at its own position', () => {
    const state = createTestState(sampleText, true);

    // Two non-overlapping comment spans: one over 'quick' (5..10) and one over 'brown' (11..16).
    const spans: readonly CommentSpan[] = [
      span('t1', 5, 10, 'open', 1),
      span('t2', 11, 16, 'resolved', 0.8),
    ];

    // Apply the spans so decorations are created against the document.
    const stateWithSpans = applySpans(state, spans);

    // A position inside the first comment (pos 7) reports only t1.
    expect(commentsAt(stateWithSpans, 7)).toEqual(['t1']);

    // A position inside the second comment (pos 13) reports only t2.
    expect(commentsAt(stateWithSpans, 13)).toEqual(['t2']);

    // A position outside any comment (pos 2 in 'The') reports nothing.
    expect(commentsAt(stateWithSpans, 2)).toEqual([]);
  });

  it('reports every overlapping thread at a shared position', () => {
    const state = createTestState(sampleText, true);

    // Two spans that overlap: t1 covers 2..12 and t2 covers the inner range 5..8.
    const spans: readonly CommentSpan[] = [
      span('t1', 2, 12, 'open', 1),
      span('t2', 5, 8, 'open', 1),
    ];

    // Apply the overlapping spans so both decorations are created.
    const stateWithSpans = applySpans(state, spans);

    // A position inside both ranges (pos 6) must report every covering thread id.
    const hitsAtSharedPos = commentsAt(stateWithSpans, 6);

    // Both threads cover pos 6 so the array contains each of them exactly once.
    expect(hitsAtSharedPos).toContain('t1');
    expect(hitsAtSharedPos).toContain('t2');

    // The whole reason commentsAt returns an array is that a click can land on more than one comment.
    expect(hitsAtSharedPos.length).toBe(2);
  });

  it('reports the same thread once even when several spans cover a position', () => {
    const state = createTestState(sampleText, true);

    // Two distinct spans that both carry the identical thread id and overlap over pos 6.
    const spans: readonly CommentSpan[] = [
      span('t1', 2, 12, 'open', 1),
      span('t1', 5, 8, 'resolved', 0.9),
    ];

    // Apply the duplicate-thread spans so both decorations are created against the document.
    const stateWithSpans = applySpans(state, spans);

    // A position inside both spans (pos 6) must de-duplicate to a single thread id.
    expect(commentsAt(stateWithSpans, 6)).toEqual(['t1']);
  });

  it('keeps decoration positions fixed when the active thread is selected', () => {
    const state = createTestState(sampleText, true);

    // Apply one comment span so a decoration exists before any selection change.
    const withSpans = applySpans(state, [span('t1', 5, 10, 'open', 1)]);

    // Record the decoration range from plugin state before selecting a thread.
    const beforeSelection = commentPluginKey.getState(withSpans);
    const beforeFrom = beforeSelection?.decorations.find()[0]?.from;
    const beforeTo = beforeSelection?.decorations.find()[0]?.to;

    // Selecting t1 must not move the decoration: apply setActiveThread on a fresh transaction.
    const afterSelect = withSpans.apply(setActiveThread(withSpans.tr, 't1'));

    // Read the decoration range again and confirm it is byte-for-byte unchanged by the selection change.
    const afterSelection = commentPluginKey.getState(afterSelect);
    const afterFrom = afterSelection?.decorations.find()[0]?.from;
    const afterTo = afterSelection?.decorations.find()[0]?.to;

    // The decoration from/to must be identical before and after selecting the thread (regression guard).
    expect(afterFrom).toBe(beforeFrom);
    expect(afterTo).toBe(beforeTo);

    // And the active thread id is now recorded in plugin state.
    expect(activeThreadId(afterSelect)).toBe('t1');
  });

  it('keeps a comment after its selection is cleared', () => {
    const state = createTestState(sampleText, true);

    // Apply one span and select the thread so there is an active selection to clear.
    const withSpansAndSelection = applySpans(state, [span('t1', 5, 10, 'open', 1)]);
    const selected = withSpansAndSelection.apply(setActiveThread(withSpansAndSelection.tr, 't1'));

    // Clear the active selection by dispatching setActiveThread(null) on a fresh transaction.
    const cleared = selected.apply(setActiveThread(selected.tr, null));

    // The active thread id must now be null after clearing the selection.
    expect(activeThreadId(cleared)).toBeNull();

    // But the comment itself survives being deselected and is still findable at its position.
    expect(commentsAt(cleared, 7)).toEqual(['t1']);
  });

  it('maps decorations across an unrelated edit instead of dropping them', () => {
    const state = createTestState(sampleText, true);

    // Apply one span over 'quick' (5..10) before the unrelated insertion.
    const withSpans = applySpans(state, [span('t1', 5, 10, 'open', 1)]);

    // Insert two characters at document position 1 without any plugin metadata attached to this transaction.
    const editTr = withSpans.tr.insertText('XX', 1);
    const mappedState = withSpans.apply(editTr);

    // The decoration must survive the keystroke and remain a single inline decoration.
    expect(decorationCount(mappedState)).toBe(1);

    // A position shifted by two (original pos 7 -> new pos 9) still lands inside the moved comment range.
    expect(commentsAt(mappedState, 9)).toEqual(['t1']);
  });

  it('drops a span past the end of a shrunk document rather than throwing', () => {
    const state = createTestState(sampleText, true);

    // Capture the current document content size to build an out-of-bounds span.
    const docSize = state.doc.content.size;

    // One in-bounds span over 'quick' (5..10) plus one whose end far exceeds the document length.
    const spans: readonly CommentSpan[] = [
      span('t1', 5, 10, 'open', 1),
      span('pastEnd', docSize + 5, docSize + 15, 'open', 1),
    ];

    // Applying the transaction must not throw and must drop only the out-of-bounds span.
    const applied = applySpans(state, spans);

    // Only the in-bounds comment survives as a decoration after the out-of-bounds one is dropped.
    expect(decorationCount(applied)).toBe(1);
  });

  it('drops a collapsed span rather than throwing', () => {
    const state = createTestState(sampleText, true);

    // A single span whose start equals end (start === end) so the range is empty.
    const spans: readonly CommentSpan[] = [span('collapsed', 5, 5, 'open', 1)];

    // Applying a transaction carrying only a collapsed span must not throw and leaves no decorations.
    const applied = applySpans(state, spans);

    // A collapsed span produces zero decorations because it has no range to paint.
    expect(decorationCount(applied)).toBe(0);
  });

  it('carries both comment spans and an active thread in one transaction', () => {
    const state = createTestState(sampleText, true);

    // Chain setActiveThread around setCommentSpans so a single transaction carries both payloads.
    const chainedTr = setActiveThread(
      setCommentSpans(state.tr, [span('t1', 5, 10, 'open', 1)]),
      't2',
    );

    // Apply the combined transaction and confirm neither setter discarded the other's data.
    const applied = state.apply(chainedTr);

    // The comment span is present as a decoration after applying both setters together.
    expect(decorationCount(applied)).toBe(1);
    expect(commentsAt(applied, 7)).toEqual(['t1']);

    // And the active thread id from setActiveThread survived alongside the spans.
    expect(activeThreadId(applied)).toBe('t2');
  });

  it('exports a stylesheet defining all three distinct comment states', () => {
    // Each of the three class names must be present in the shared stylesheet string.
    expect(COMMENT_STYLES).toContain(`.${COMMENT_DECORATION_CLASS}`);
    expect(COMMENT_STYLES).toContain(`.${COMMENT_RESOLVED_CLASS}`);
    expect(COMMENT_STYLES).toContain(`.${COMMENT_ACTIVE_CLASS}`);

    // The three visual states must be distinct class names so they never collide in CSS.
    expect(COMMENT_DECORATION_CLASS).not.toBe(COMMENT_RESOLVED_CLASS);
    expect(COMMENT_DECORATION_CLASS).not.toBe(COMMENT_ACTIVE_CLASS);
    expect(COMMENT_RESOLVED_CLASS).not.toBe(COMMENT_ACTIVE_CLASS);
  });
});
