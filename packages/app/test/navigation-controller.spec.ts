/**
 * @file navigation-controller.spec.ts
 * @purpose Exercises createNavigationController's Quick Open, Go To, and breadcrumb behaviour against a mocked editor shell.
 * @inputs Mocked DocumentSession, window animation-frame stubs, picker dialogs, and dependency callbacks assembled by setup().
 * @outputs Vitest describe/it blocks asserting picker prompts, reveal offsets, breadcrumb paths, and teardown no-ops.
 * @functions
 *   - setup: Wire mutable mock state into createNavigationController and return test-driving helpers.
 *   - openQuickOpen suite: Assert picker prompt contents and picked-path opening behaviour.
 *   - openGoTo suite: Assert WYSIWYG heading reveal, Source line reveal, and cancel/error paths.
 *   - breadcrumbs suite: Assert caret-path refresh, frame coalescing, edit propagation, and destroy teardown.
 * @dataflow setup() mock state → createNavigationController options → controller actions → recorded side effects in state arrays.
 * @controlflow Each test drives one action, flushes queued animation frames when required, then asserts on recorded state.
 * @version 1
 * @date 2026-09-13
 */

import { describe, expect, it } from 'vitest';
import { DocumentSession, type OutlineEntry } from '@k-doc/core';
import { createNavigationController, type NavigationControllerOptions } from '../src/shell/navigation-controller.js';
import type { PickerItem } from '../src/shell/fuzzy-score.js';

/**
 * @purpose Wire mock state into createNavigationController and return test-driving helpers.
 * @inputs source - Document markdown for the mocked session; overrides - optional NavigationControllerOptions replacements.
 * @outputs { state, controller, flush, lastPath } - Mutable mock state, the controller, a frame flusher, and a path reader.
 * @dataflow source → new DocumentSession → options object (spreading overrides) → createNavigationController closure over mutable state.
 * @controlflow Build mocks, construct the controller with them, then return accessors for test bodies to mutate and drive.
 */
function setup(source: string, overrides: Partial<NavigationControllerOptions> = {}) {
  const session = new DocumentSession(source);
  const state = {
    session,
    caret: 0,
    sourceFocused: false,
    answer: null as string | null,
    quick: null as { items: readonly PickerItem[]; onPick: (item: PickerItem) => void } | null,
    goTo: null as { items: readonly PickerItem[]; onPick: (item: PickerItem) => void } | null,
    paths: [] as (readonly OutlineEntry[])[],
    frames: new Map<number, () => void>(),
    nextFrame: 1,
    cancelled: [] as number[],
    messages: [] as string[],
    opened: [] as string[],
    revealedSource: [] as number[],
    revealed: [] as number[],
  };
  const win = {
    requestAnimationFrame: (cb: () => void): number => { const id = state.nextFrame++; state.frames.set(id, cb); return id; },
    cancelAnimationFrame: (id: number): void => { state.cancelled.push(id); state.frames.delete(id); },
  } as unknown as Window;
  // @purpose Build a picker-dialog mock bound to one of the two slots so prompts are captured in state.
  const picker = (slot: 'quick' | 'goTo') => ({ open: (items: readonly PickerItem[], onPick: (item: PickerItem) => void): void => { state[slot] = { items, onPick }; }, close: (): void => {}, isOpen: false, destroy: (): void => {} });
  const controller = createNavigationController({
    session: () => state.session, win, quickOpen: picker('quick'), goTo: picker('goTo'),
    breadcrumbs: { element: {} as HTMLElement, update: (path: readonly OutlineEntry[]): void => { state.paths.push(path); }, destroy: () => {} },
    notes: () => [], recentPaths: () => [], openPaths: () => [], currentPath: () => null,
    openPath: (p: string): void => { state.opened.push(p); }, sourceFocused: () => state.sourceFocused,
    askLine: async () => state.answer, caretOffset: () => state.caret,
    revealSourceOffset: (o) => { state.revealedSource.push(o); }, revealOffset: (o) => { state.revealed.push(o); },
    showMessage: (m) => { state.messages.push(m); },
    ...overrides,
  });
  // @purpose Run all queued animation-frame callbacks once, clearing the queue so refreshes coalesce per frame.
  // @inputs none.
  // @outputs void.
  // @dataflow state.frames → snapshot of callbacks → clear map → invoke each callback in insertion order.
  // @controlflow Copy current callbacks, empty the map, then execute them synchronously.
  const flush = (): void => { const cbs = [...state.frames.values()]; state.frames.clear(); cbs.forEach((cb) => cb()); };
  // @purpose Return the most recently recorded breadcrumb path as heading texts for assertions.
  // @inputs none.
  // @outputs string[] - Text of the last update() call's entries, or [] when no refresh has run.
  // @dataflow state.paths (final entry) → map each OutlineEntry to its text field.
  // @controlflow Index the final paths entry (defaulting to []) and map every entry to its text.
  const lastPath = (): string[] => (state.paths[state.paths.length - 1] ?? []).map((e) => e.text);
  return { state, controller, flush, lastPath };
}

describe('openQuickOpen', () => {
  // Opening Quick Open presents vault notes and opens the picked path.
  it('opens the picker with the items and opens the picked path', () => {
    const { state, controller } = setup('# x\n', { notes: () => [{ path: '/v/a.md', relative: 'a.md', title: 'Alpha' }] });
    controller.openQuickOpen();
    expect(state.quick?.items.map((i) => i.id)).toEqual(['/v/a.md']);
    state.quick?.onPick(state.quick!.items[0] as PickerItem);
    expect(state.opened).toEqual(['/v/a.md']);
  });

  // With no candidates it explains instead of opening an empty picker.
  it('with nothing to list it explains instead of opening an empty picker', () => {
    const { state, controller } = setup('# x\n');
    controller.openQuickOpen();
    expect(state.quick).toBeNull();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toContain('vault');
  });
});

describe('openGoTo', () => {
  // In WYSIWYG Go To lists headings and reveals the chosen heading's start offset.
  it("in WYSIWYG it offers the headings and reveals the picked one's start", async () => {
    const source = '# Title\n\ntext\n\n## Section\n';
    const { state, controller } = setup(source);
    await controller.openGoTo();
    expect(state.goTo?.items.map((i) => i.label)).toEqual(['Title', 'Section']);
    state.goTo?.onPick(state.goTo!.items[1] as PickerItem);
    expect(state.revealed).toEqual([source.indexOf('## Section')]);
    expect(state.revealedSource).toEqual([]);
  });

  // Without headings it reports that there is nothing to go to.
  it('with no headings it says so', async () => {
    const { state, controller } = setup('plain\n');
    await controller.openGoTo();
    expect(state.goTo).toBeNull();
    expect(state.messages[0]).toContain('no headings');
  });

  // In Source Go To resolves a line:column target into a source offset.
  it('in Source it asks for a line and reveals that line and column', async () => {
    const { state, controller } = setup('a\nbb\nccc\n');
    state.sourceFocused = true;
    state.answer = '3:2';
    await controller.openGoTo();
    expect(state.revealedSource).toEqual([6]);
    expect(state.goTo).toBeNull();
  });

  // The line prompt receives the document's line count.
  it('the prompt is told how many lines there are', async () => {
    let asked = -1;
    const { state, controller } = setup('a\nb\n', { askLine: async (n: number) => { asked = n; return null; } });
    state.sourceFocused = true;
    await controller.openGoTo();
    expect(asked).toBe(3);
  });

  // A cancelled line prompt moves nothing and shows no message.
  it('a cancelled prompt does nothing', async () => {
    const { state, controller } = setup('a\nb\n');
    state.sourceFocused = true;
    await controller.openGoTo();
    expect(state.revealedSource).toEqual([]);
    expect(state.messages).toEqual([]);
  });

  // An unparseable answer is reported without moving the caret.
  it('an invalid answer is reported and moves nothing', async () => {
    const { state, controller } = setup('a\nb\n');
    state.sourceFocused = true;
    state.answer = 'abc';
    await controller.openGoTo();
    expect(state.revealedSource).toEqual([]);
    expect(state.messages[0]).toContain('"abc"');
  });
});

describe('breadcrumbs', () => {
  // Refresh renders the heading path under the current caret.
  it('refresh shows the path at the caret', () => {
    const source = '# A\n\n## B\n\nbody\n';
    const { state, controller, lastPath } = setup(source);
    state.caret = source.indexOf('body');
    controller.refreshBreadcrumbs();
    expect(lastPath()).toEqual(['A', 'B']);
  });

  // Scheduling coalesces multiple refreshes into a single per-frame update.
  it('schedule coalesces to one refresh per frame', () => {
    const { state, controller, flush } = setup('# x\n');
    controller.scheduleBreadcrumbs();
    controller.scheduleBreadcrumbs();
    controller.scheduleBreadcrumbs();
    expect(state.frames.size).toBe(1);
    expect(state.paths.length).toBe(0);
    flush();
    expect(state.paths.length).toBe(1);
    controller.scheduleBreadcrumbs();
    expect(state.frames.size).toBe(1);
  });

  // The outline rebuilds when the session's document changes via edits.
  it('the outline follows the session edits', () => {
    const first = '# A\n\nbody\n';
    const { state, controller, lastPath } = setup(first);
    state.caret = first.indexOf('body');
    controller.refreshBreadcrumbs();
    expect(lastPath()).toEqual(['A']);
    state.session.focusPane('source');
    state.session.applyText('# Renamed\n\nbody\n');
    state.caret = '# Renamed\n\nbody\n'.indexOf('body');
    controller.refreshBreadcrumbs();
    expect(lastPath()).toEqual(['Renamed']);
  });

  // A replaced session is picked up on the next use.
  it('it reads the session on every use, so a replaced session is picked up', () => {
    const { state, controller, lastPath } = setup('# Old\n\nbody\n');
    state.session = new DocumentSession('# New\n\nbody\n');
    state.caret = 9;
    controller.refreshBreadcrumbs();
    expect(lastPath()).toEqual(['New']);
  });

  // Destroy cancels pending work and turns every action into a no-op.
  it('destroy cancels a pending frame and stops further work', async () => {
    const { state, controller, flush } = setup('# x\n');
    controller.scheduleBreadcrumbs();
    controller.destroy();
    expect(state.cancelled.length).toBe(1);
    flush();
    controller.refreshBreadcrumbs();
    controller.openQuickOpen();
    await controller.openGoTo();
    expect(state.paths.length).toBe(0);
    expect(state.quick).toBeNull();
    expect(state.goTo).toBeNull();
  });
});
