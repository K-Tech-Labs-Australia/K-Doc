/**
 * @file navigation-history.ts
 * @purpose Implements browser-like back/forward navigation history for note locations: a pure, side-effect-free state machine plus an async navigator that drives actual screen shows.
 * @inputs NavLocation values describing caret positions; NavigatorDeps callbacks that read the current caret and show a target location.
 * @outputs Immutable NavState stacks (back/forward); a Navigator object exposing recordJump/back/forward/state for UI wiring.
 * @functions
 *   - sameLocation: Determines whether two locations refer to the same place.
 *   - pushCapped: Appends a location to a stack, dropping duplicates and capping length.
 *   - recordJump: Records the pre-jump caret on the back stack and clears forward history.
 *   - step: Pops one reachable target from a stack, parking current on the opposite stack.
 *   - stepBack: Advances navigation toward older entries.
 *   - stepForward: Advances navigation toward newer entries.
 *   - createNavigator: Wires pure state to NavigatorDeps into an async Navigator.
 *   - go: Drives one back/forward attempt through the async show dependency.
 * @dataflow UI events → recordJump/back/forward → immutable NavState transitions → deps.show renders the resolved location.
 * @controlflow recordJump pushes onto back; stepBack/stepForward pop from a stack and push current onto the other; createNavigator loops until a show resolves true or history is exhausted.
 * @version 2
 * @date 2026-09-15
 */

export interface NavLocation {
  /** The tab the location was in. */
  readonly tabId: string;
  /** The note's path, or null for an unsaved document; lets a location be reached again after its tab closes. */
  readonly path: string | null;
  /** Caret offset into the Markdown source. */
  readonly offset: number;
}

export interface NavState {
  readonly back: readonly NavLocation[];
  readonly forward: readonly NavLocation[];
}

/** Oldest entries are dropped beyond this many steps each way. */
export const NAV_HISTORY_LIMIT = 50;

export const EMPTY_NAV_STATE: NavState = { back: [], forward: [] };

export interface NavStep {
  readonly state: NavState;
  readonly target: NavLocation;
}

/**
 * Determines whether two locations refer to the same place.
 * @purpose Reports equality of two NavLocations by caret offset and document identity.
 * @inputs a - first location to compare. b - second location to compare.
 * @outputs boolean - true when both offsets match and the locations resolve to the same tab or saved path.
 * @dataflow Two NavLocation values → offset comparison then tab/path comparison → single boolean result.
 * @controlflow Early-return false on mismatched offsets; otherwise return the combined tab-or-path identity test.
 */
export function sameLocation(a: NavLocation, b: NavLocation): boolean {
  // Offsets differ: even identical documents at different carets are not the same place.
  if (a.offset !== b.offset) {
    // The caret positions do not match; the locations cannot be equal.
    return false;
  } else {
    // Offsets match; compare document identity — the same tab, or the same saved path when both resolve to a file.
    return a.tabId === b.tabId || (a.path !== null && a.path === b.path);
  }
}

/**
 * Appends a location to a stack while preventing duplicates and bounding its length.
 * @purpose Pushes a new entry onto a history stack unless it repeats the current top, then caps the stack size.
 * @inputs stack - the immutable source stack being extended. location - the candidate entry to append.
 * @outputs readonly NavLocation[] - the resulting stack: unchanged when `location` duplicates the top, otherwise appended and capped.
 * @dataflow Source stack + candidate → top comparison → either original or extended-then-capped stack.
 * @controlflow Read the top entry; early-return unchanged on a matching top; otherwise append and slice to the limit.
 */
function pushCapped(stack: readonly NavLocation[], location: NavLocation): readonly NavLocation[] {
  const top = stack[stack.length - 1];
  // A repeat of the newest entry adds nothing.
  if (top !== undefined && sameLocation(top, location)) {
    // The stack already ends at this exact location; keep it unchanged to avoid duplicate entries.
    return stack;
  } else {
    // A genuinely new entry: append it below and cap the length in the return expression.
    const next = [...stack, location];
    // Drop the oldest entries when the stack grows past the limit.
    return next.length > NAV_HISTORY_LIMIT ? next.slice(next.length - NAV_HISTORY_LIMIT) : next;
  }
}

/**
 * Records the caret position taken before a jump and clears forward history.
 * @purpose Pushes the pre-jump location onto the back stack, discarding any forward entries as a browser does.
 * @inputs state - the current immutable navigation state. from - the location the caret occupied before jumping.
 * @outputs NavState - a new state with `from` appended to back and forward reset to empty.
 * @dataflow Current state + pre-jump location → pushCapped onto back, forward cleared → fresh NavState.
 * @controlflow No branching; build and return the new state object in one expression.
 */
export function recordJump(state: NavState, from: NavLocation): NavState {
  return { back: pushCapped(state.back, from), forward: [] };
}

/**
 * Pops the newest entry from a stack, parking the current caret on the opposite stack.
 * @purpose Advances navigation by one step, carrying the caret along. An entry equal to the caret is still a step: the caret
 *   the shell reads can lag the one on screen (the outline moves only the Source pane's caret), so skipping it would jump too far.
 * @inputs from - the stack to pop targets from. into - the stack to receive the parked current location. current - the caret's present location, or null when nothing is open.
 * @outputs { from; into; target } | null - the updated stacks plus the resolved target, or null when no step is available.
 * @dataflow Source stack + receiving stack + current → pop target and park current → rebuilt pair.
 * @controlflow Early-return null when the stack is empty; else build the result with a guarded park.
 */
function step(
  from: readonly NavLocation[],
  into: readonly NavLocation[],
  current: NavLocation | null,
): {
  readonly from: readonly NavLocation[];
  readonly into: readonly NavLocation[];
  readonly target: NavLocation;
} | null {
  const target = from[from.length - 1];
  // No more entries to step to: this direction is exhausted.
  if (target === undefined) {
    // The stack is empty; nothing to move to.
    return null;
  } else {
    // A valid target exists; park the current caret on the opposite stack, or leave it as-is when none is open.
    const parkedInto =
      // No document open: the receiving stack stays exactly as received.
      current === null ? into : pushCapped(into, current);
    return { from: from.slice(0, -1), into: parkedInto, target };
  }
}

/**
 * Advances navigation one step toward older entries.
 * @purpose Pops the most recent older location, parking the current caret on the forward stack.
 * @inputs state - the current immutable navigation state. current - the caret's present location, or null when nothing is open.
 * @outputs NavStep | null - the updated state and target to show, or null when no older entry exists.
 * @dataflow Back/forward stacks + current → step pops from back into forward → rebuilt NavStep.
 * @controlflow Delegate to step with back as source; early-return null when exhausted; else wrap the move in a NavStep.
 */
export function stepBack(state: NavState, current: NavLocation | null): NavStep | null {
  const moved = step(state.back, state.forward, current);
  // No older entry available: this direction is exhausted.
  if (moved === null) {
    // The back stack was empty or every entry matched the current caret; nothing to move to.
    return null;
  } else {
    // A step exists: rebuild state with the popped target moved onto the forward stack.
    return { state: { back: moved.from, forward: moved.into }, target: moved.target };
  }
}

/**
 * Advances navigation one step toward newer entries.
 * @purpose Pops the most recent newer location, parking the current caret on the back stack.
 * @inputs state - the current immutable navigation state. current - the caret's present location, or null when nothing is open.
 * @outputs NavStep | null - the updated state and target to show, or null when no newer entry exists.
 * @dataflow Forward/back stacks + current → step pops from forward into back → rebuilt NavStep.
 * @controlflow Delegate to step with forward as source; early-return null when exhausted; else wrap the move in a NavStep.
 */
export function stepForward(state: NavState, current: NavLocation | null): NavStep | null {
  const moved = step(state.forward, state.back, current);
  // No newer entry available: this direction is exhausted.
  if (moved === null) {
    // The forward stack was empty or every entry matched the current caret; nothing to move to.
    return null;
  } else {
    // A step exists: rebuild state with the popped target moved onto the back stack.
    return { state: { back: moved.into, forward: moved.from }, target: moved.target };
  }
}

export interface NavigatorDeps {
  /** Where the caret is now, or null when no document is open. */
  current(): NavLocation | null;
  /** Shows a location; resolves false when it can no longer be reached (its tab closed and it has no path, or the file is gone). */
  show(location: NavLocation): Promise<boolean>;
}

export interface Navigator {
  /** Call just before a jump (a followed link, Go To, Quick Open...), while the caret is still where the jump starts. */
  recordJump(): void;
  /** Resolves true when a location was shown. */
  back(): Promise<boolean>;
  forward(): Promise<boolean>;
  readonly state: NavState;
}

/**
 * Wires pure navigation state to side-effecting dependencies as an async Navigator.
 * @purpose Bridges the immutable history machine with caret reading and location showing for real UI use.
 * @inputs deps - callbacks providing the current caret and showing a target location.
 * @outputs Navigator - an object exposing recordJump, back, forward, and the live state snapshot.
 * @dataflow UI events → createNavigator closures → pure state transitions → deps.show renders resolved locations.
 * @controlflow Hold mutable state and a busy flag; recordJump pushes onto back; back/forward loop through go until a show succeeds or history is exhausted.
 */
export function createNavigator(deps: NavigatorDeps): Navigator {
  let state: NavState = EMPTY_NAV_STATE;
  // True while a location is being shown: a second press during an async open would otherwise step twice from a stale caret.
  let busy = false;

  /**
   * Performs one back/forward navigation attempt through the async show dependency.
   * @purpose Steps through history in one direction, skipping unreachable entries until a location shows or history is exhausted.
   * @inputs direction - which way to travel ('back' toward older entries, 'forward' toward newer).
   * @outputs Promise<boolean> - resolves true when a location was shown, false when the attempt failed or was re-entrant.
   * @dataflow Direction + live state → stepBack/stepForward pops → deps.show renders target → loop until resolved.
   * @controlflow Guard on busy; claim busy; infinite-loop popping targets and skipping unreachable ones; release busy in finally.
   */
  async function go(direction: 'back' | 'forward'): Promise<boolean> {
    // Already mid-show: ignore the re-entrant press so one open cannot step twice from a stale caret.
    if (busy) {
      // A show is already in flight; drop this press rather than stepping again.
      return false;
    } else {
      // Clear to proceed: claim the busy flag before any await so concurrent presses queue behind it.
      busy = true;
      try {
        // Unreachable locations are dropped and the next one tried, so one closed tab does not block the rest of the history.
        for (;;) {
          const current = deps.current();
          // Choose the stack to pop from based on travel direction.
          const moved =
            direction === 'back' ? stepBack(state, current) : stepForward(state, current);
          // This direction is exhausted before reaching a reachable location.
          if (moved === null) {
            // No more entries to step to; this navigation attempt fails.
            return false;
          } else {
            // A target was found: commit the new state and attempt to show it.
            state = moved.state;
            if (await deps.show(moved.target)) {
              // The location displayed successfully; report success and unwind.
              return true;
            } else {
              // Unreachable: try the next one. `current` is not parked twice, because a repeat of the newest entry is skipped.
              continue;
            }
          }
        }
      } finally {
        // Release the busy flag whether the attempt succeeded, failed, or threw so a future press can proceed.
        busy = false;
      }
    }
  }

  return {
    recordJump(): void {
      const current = deps.current();
      // Record the pre-jump caret so a later Back can return here.
      if (current !== null) {
        // A document is open; push its location onto the back stack.
        state = recordJump(state, current);
      } else {
        /* Nothing open: there is no place to come back to, so leave history untouched. */
      }
    },
    back: (): Promise<boolean> => go('back'),
    forward: (): Promise<boolean> => go('forward'),
    get state(): NavState {
      return state;
    },
  };
}