/**
 * @file navigator.spec.ts
 * @purpose Tests createNavigator's back/forward jump behavior including unreachable locations, pending shows, and error recovery.
 * @inputs Fake editor with mutable caret/shown/unreachable; Navigator callbacks wired to the fake editor.
 * @outputs Test assertions verifying navigation stack state and editor side effects.
 * @functions
 *   - at: Builds a NavLocation for a tab id, offset, and optional path.
 *   - fake: Wires a FakeEditor to a navigator with configurable unreachable tabs.
 * @dataflow recordJump/back/forward calls → show callback pushes to editor.shown and updates editor.caret → assertions read back state.
 * @controlflow Each test sets up a fake, drives navigation events, then asserts caret/shown/state equality.
 * @version 1
 * @date 2026-09-15
 */

import { describe, it, expect } from 'vitest';
import { EMPTY_NAV_STATE, createNavigator, type NavLocation, type Navigator } from '../src/shell/navigation-history.js';

// Builds a location in tab `tabId` at `offset`; `path` is null for an unsaved document.
function at(tabId: string, offset: number, path: string | null = null): NavLocation {
  return { tabId, path, offset };
}

interface FakeEditor {
  caret: NavLocation | null;
  readonly shown: NavLocation[];
  readonly unreachable: ReadonlySet<string>;
}

// Builds a FakeEditor and Navigator pair for testing createNavigator.
// @purpose Provides an in-memory editor whose show() records shown locations, updates caret, and can mark tabs unreachable.
// @inputs unreachable - tab ids that should cause show() to return false without updating the caret.
// @outputs A tuple of the fake editor and a navigator bound to it.
// @dataflow Tab id strings → Set(unreachable) → consulted inside show() to decide success or failure.
// @controlflow Construct editor with initial caret at t1:0; return both handles for test use.
function fake(unreachable: readonly string[] = []): { readonly editor: FakeEditor; readonly navigator: Navigator } {
  const editor: FakeEditor = { caret: at('t1', 0), shown: [], unreachable: new Set(unreachable) };
  const navigator = createNavigator({
    current: (): NavLocation | null => editor.caret,
    show: async (location: NavLocation): Promise<boolean> => {
      editor.shown.push(location);
      // If the target tab is unreachable, refuse to navigate away from the current caret.
      if (editor.unreachable.has(location.tabId)) {
        return false;
      } else {
        // Otherwise record the location as shown and move the caret there.
        editor.caret = location;
        return true;
      }
    },
  });
  return { editor, navigator };
}

describe('createNavigator', (): void => {
  it('goes back to where a jump started and forward again', async (): Promise<void> => {
    const { editor, navigator } = fake();
    navigator.recordJump();
    editor.caret = at('t2', 40, 'b.md');
    expect(await navigator.back()).toBe(true);
    expect(editor.caret).toEqual(at('t1', 0));
    expect(await navigator.forward()).toBe(true);
    expect(editor.caret).toEqual(at('t2', 40, 'b.md'));
    expect(await navigator.forward()).toBe(false);
  });
  it('records nothing while no document is open', (): void => {
    const { editor, navigator } = fake();
    editor.caret = null;
    navigator.recordJump();
    expect(navigator.state).toEqual(EMPTY_NAV_STATE);
  });
  it('drops unreachable locations and shows the next one', async (): Promise<void> => {
    const { editor, navigator } = fake(['gone']);
    navigator.recordJump();
    editor.caret = at('gone', 5);
    navigator.recordJump();
    editor.caret = at('t3', 9);
    expect(await navigator.back()).toBe(true);
    expect(editor.shown).toEqual([at('gone', 5), at('t1', 0)]);
    expect(editor.caret).toEqual(at('t1', 0));
    expect(navigator.state).toEqual({ back: [], forward: [at('t3', 9)] });
  });
  it('reports false when every location is unreachable', async (): Promise<void> => {
    const { editor, navigator } = fake(['t1']);
    navigator.recordJump();
    editor.caret = at('t2', 3);
    expect(await navigator.back()).toBe(false);
    expect(editor.caret).toEqual(at('t2', 3));
  });
  it('ignores a second press while a location is still opening', async (): Promise<void> => {
    const pending: ((value: boolean) => void)[] = [];
    let caret: NavLocation | null = at('t1', 1);
    const shows: NavLocation[] = [];
    const navigator = createNavigator({
      current: (): NavLocation | null => caret,
      show: (location: NavLocation): Promise<boolean> => {
        shows.push(location);
        return new Promise<boolean>((resolve) => {
          pending.push((value: boolean): void => {
            caret = location;
            resolve(value);
          });
        });
      },
    });
    navigator.recordJump();
    caret = at('t1', 2);
    navigator.recordJump();
    caret = at('t2', 0);
    const first = navigator.back();
    expect(await navigator.back()).toBe(false);
    pending[0]?.(true);
    expect(await first).toBe(true);
    expect(shows).toEqual([at('t1', 2)]);
    const third = navigator.back();
    pending[1]?.(true);
    expect(await third).toBe(true);
    expect(shows).toEqual([at('t1', 2), at('t1', 1)]);
  });
  it('frees the navigator when showing throws', async (): Promise<void> => {
    let fail = true;
    let caret: NavLocation | null = at('t1', 1);
    const navigator = createNavigator({
      current: (): NavLocation | null => caret,
      show: async (location: NavLocation): Promise<boolean> => {
        // If failure is enabled, abort navigation by throwing before updating the caret.
        if (fail) {
          throw new Error('boom');
        } else {
          // Otherwise commit the location and report success.
          caret = location;
          return true;
        }
      },
    });
    navigator.recordJump();
    caret = at('t1', 2);
    navigator.recordJump();
    caret = at('t1', 3);
    await expect(navigator.back()).rejects.toThrow('boom');
    fail = false;
    expect(await navigator.back()).toBe(true);
    expect(caret).toEqual(at('t1', 1));
  });
});