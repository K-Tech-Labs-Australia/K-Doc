/**
 * @file navigation-history.spec.ts
 * @purpose Unit tests for the editor navigation history module (sameLocation, recordJump, stepBack, stepForward).
 * @inputs Vitest test runner; the navigation-history implementation under ../src/shell/navigation-history.js.
 * @outputs Test results asserting stack behavior, limit trimming, and null handling for navigation steps.
 * @functions
 *   - at: Builds a NavLocation fixture with tabId, offset, and optional path.
 *   - sameLocation describe block: Verifies location equality rules across tabs and offsets.
 *   - recordJump describe block: Verifies back-stack push, forward clearing, repeat skipping, and limit trimming.
 *   - stepBack/stepForward describe block: Verifies stack movement, current-location parking, and null returns.
 * @dataflow Test fixtures (NavLocation) → navigation-history functions → resulting NavState → Vitest assertions.
 * @controlflow Each test constructs inputs, invokes a navigation function, and asserts the returned state or target.
 * @version 1
 * @date 2026-09-15
 */

import { describe, it, expect } from 'vitest';
import { EMPTY_NAV_STATE, NAV_HISTORY_LIMIT, recordJump, sameLocation, stepBack, stepForward, type NavLocation, type NavState } from '../src/shell/navigation-history.js';

/**
 * Builds a NavLocation fixture for navigation tests.
 * @purpose Creates a minimal location object with the given tab, offset, and optional path.
 * @inputs tabId - Identifier of the editor tab the location belongs to.
 *   offset - Zero-based caret line offset within the document.
 *   path - Optional document path; null represents an unsaved document.
 * @outputs NavLocation - A fully populated location fixture used across assertions.
 * @dataflow Provided primitives → NavLocation object literal → caller.
 * @controlflow No branching; constructs and returns a single object.
 */
function at(tabId: string, offset: number, path: string | null = null): NavLocation {
  return { tabId, path, offset };
}

describe('sameLocation', (): void => {
  it('needs the same offset', (): void => {
    expect(sameLocation(at('t1', 1), at('t1', 2))).toBe(false);
    expect(sameLocation(at('t1', 2), at('t1', 2))).toBe(true);
  });
  it('matches the same saved path in another tab', (): void => {
    expect(sameLocation(at('t1', 5, 'a.md'), at('t2', 5, 'a.md'))).toBe(true);
    expect(sameLocation(at('t1', 5, 'a.md'), at('t2', 5, 'b.md'))).toBe(false);
  });
  it('never matches two unsaved documents in different tabs', (): void => {
    expect(sameLocation(at('t1', 5), at('t2', 5))).toBe(false);
  });
});

describe('recordJump', (): void => {
  it('pushes onto the back stack and clears forward', (): void => {
    const state = recordJump({ back: [at('t1', 1)], forward: [at('t1', 9)] }, at('t1', 4));
    expect(state).toEqual({ back: [at('t1', 1), at('t1', 4)], forward: [] });
  });
  it('skips a repeat of the newest entry', (): void => {
    const once = recordJump(EMPTY_NAV_STATE, at('t1', 4));
    expect(recordJump(once, at('t1', 4)).back).toEqual([at('t1', 4)]);
  });
  it('keeps only the newest entries beyond the limit', (): void => {
    let state: NavState = EMPTY_NAV_STATE;
    for (let i = 0; i < NAV_HISTORY_LIMIT + 5; i += 1) {
      state = recordJump(state, at('t1', i));
    }
    expect(state.back).toHaveLength(NAV_HISTORY_LIMIT);
    expect(state.back[0]).toEqual(at('t1', 5));
    expect(state.back[NAV_HISTORY_LIMIT - 1]).toEqual(at('t1', NAV_HISTORY_LIMIT + 4));
  });
  it('keeps exactly the limit without dropping any', (): void => {
    let state: NavState = EMPTY_NAV_STATE;
    for (let i = 0; i < NAV_HISTORY_LIMIT; i += 1) {
      state = recordJump(state, at('t1', i));
    }
    expect(state.back).toHaveLength(NAV_HISTORY_LIMIT);
    expect(state.back[0]).toEqual(at('t1', 0));
  });
});

describe('stepBack and stepForward', (): void => {
  it('return null with nothing to step to', (): void => {
    expect(stepBack(EMPTY_NAV_STATE, at('t1', 0))).toBeNull();
    expect(stepForward(EMPTY_NAV_STATE, at('t1', 0))).toBeNull();
  });
  it('move between the stacks, parking the current location', (): void => {
    const recorded = recordJump(recordJump(EMPTY_NAV_STATE, at('t1', 1)), at('t1', 2));
    const back = stepBack(recorded, at('t1', 3));
    expect(back).toEqual({ state: { back: [at('t1', 1)], forward: [at('t1', 3)] }, target: at('t1', 2) });
    const forward = stepForward({ back: [at('t1', 1)], forward: [at('t1', 3)] }, at('t1', 2));
    expect(forward).toEqual({ state: { back: [at('t1', 1), at('t1', 2)], forward: [] }, target: at('t1', 3) });
  });
  it('step to an entry even where the caret already seems to be', (): void => {
    const state: NavState = { back: [at('t1', 1), at('t1', 2)], forward: [] };
    expect(stepBack(state, at('t1', 2))).toEqual({ state: { back: [at('t1', 1)], forward: [at('t1', 2)] }, target: at('t1', 2) });
  });
  it('step without parking when nothing is open', (): void => {
    expect(stepBack({ back: [at('t1', 1)], forward: [at('t1', 7)] }, null)).toEqual({ state: { back: [], forward: [at('t1', 7)] }, target: at('t1', 1) });
    expect(stepForward({ back: [], forward: [at('t1', 7)] }, null)).toEqual({ state: { back: [], forward: [] }, target: at('t1', 7) });
  });
});