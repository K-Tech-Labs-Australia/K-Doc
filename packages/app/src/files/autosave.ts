/**
 * @file autosave.ts
 * @purpose Implements the autosave controller for K-Doc (FR-6.2), executing pure timer and event-driven save coordination without performing direct file I/O.
 *   Operates over a save callback, coordinating off, onBlur, interval, and idle policies while ensuring untitled documents are never saved automatically.
 * @inputs AutosaveOptions containing DocumentSession, Window context, save callback, hasPath probe, and optional initial AutosavePolicy.
 * @outputs Autosave controller interface exposing policy getter, setPolicy, flush, and destroy lifecycle methods, alongside DEFAULT_AUTOSAVE_POLICY.
 * @functions
 *   - installAutosave: Instantiates and activates the autosave coordinator, binds session and window listeners, and returns the Autosave controller.
 *   - isTextChangingReason: Evaluates whether a session change reason represents a text modification requiring idle timer restart.
 * @dataflow Session changes / blur events / timer ticks -> shouldSave() validation -> options.save() invocation.
 * @controlflow Subscribe to DocumentSession -> arm initial policy -> on event/timer evaluate shouldSave() -> trigger save callback -> on teardown clear timers and abort listeners.
 * @version 1
 * @date 2026-09-05
 */

import type { DocumentSession } from '@k-doc/core';

export type AutosavePolicy =
  | { readonly kind: 'off' }
  | { readonly kind: 'onBlur' }
  | { readonly kind: 'interval'; readonly seconds: number }
  | { readonly kind: 'idle'; readonly seconds: number };

/**
 * Default autosave policy triggering after 2 seconds of inactivity (on-idle-2s per FR-6.2).
 * The spec names on-idle-2s as the default, and autosave deliberately does nothing until the
 * document has been saved at least once — silently creating a file the user never named is
 * worse than not saving.
 */
export const DEFAULT_AUTOSAVE_POLICY: AutosavePolicy = {
  kind: 'idle',
  seconds: 2,
};

export interface AutosaveOptions {
  readonly session: DocumentSession;
  readonly win: Window;
  /** Performs the save. Returning false means the save could not run and the timer should not clear dirty state. */
  readonly save: () => void;
  /** True once the document has a path on disk. Autosave never runs before this. */
  readonly hasPath: () => boolean;
  readonly policy?: AutosavePolicy;
}

export interface Autosave {
  /** Swap the policy at runtime; cancels anything the old policy scheduled. */
  setPolicy(policy: AutosavePolicy): void;
  readonly policy: AutosavePolicy;
  /** Force a save now if the document is dirty and has a path. Returns whether it saved. */
  flush(): boolean;
  destroy(): void;
}

/**
 * Conversion factor from seconds to milliseconds for window timer APIs.
 */
const MILLISECONDS_PER_SECOND: number = 1000;

/**
 * Helper determining whether a session change reason corresponds to a document text mutation.
 *
 * @purpose Evaluates whether a session change reason represents a text modification requiring idle timer restart.
 * @inputs reason - The session change reason string ('edit' | 'external' | 'undo' | 'redo' | 'focus' | 'reset').
 * @outputs boolean - True if the reason modifies document text; false otherwise.
 * @dataflow reason -> equality comparisons -> boolean result.
 * @controlflow Check if reason is 'edit', 'external', 'undo', or 'redo' -> return true -> else return false.
 */
function isTextChangingReason(reason: string): boolean {
  // Check if reason is one of the text-modifying change reasons.
  if (
    reason === 'edit' ||
    reason === 'external' ||
    reason === 'undo' ||
    reason === 'redo'
  ) {
    // Reason indicates text was modified: idle timer should restart.
    return true;
  } else {
    // Reason is 'focus' or 'reset': focus does not modify text, and reset reloads saved content.
    return false;
  }
}

/**
 * Installs and activates the autosave controller for a document session according to the configured policy.
 *
 * @purpose Coordinates autosave triggers (idle debounce, repeating interval, window blur) over an abstract save callback.
 * @inputs options - AutosaveOptions specifying session, window context, save callback, hasPath probe, and optional policy.
 * @outputs Autosave - Controller interface exposing policy getter, setPolicy, flush, and destroy lifecycle methods.
 * @dataflow options -> session subscriptions & window event bindings -> shouldSave() validation -> options.save().
 * @controlflow Resolve initial policy -> arm policy handlers -> subscribe to document session changes -> return controller interface.
 */
export function installAutosave(options: AutosaveOptions): Autosave {
  let destroyed: boolean = false;
  let policyAbortController: AbortController | null = null;
  let timerHandle: number | null = null;
  let isIntervalTimer: boolean = false;

  let currentPolicy: AutosavePolicy;
  // Check if an initial policy was provided in options.
  if (options.policy !== undefined) {
    // Use the caller-specified autosave policy.
    currentPolicy = options.policy;
  } else {
    // Fall back to the specification default policy (on-idle-2s).
    currentPolicy = DEFAULT_AUTOSAVE_POLICY;
  }

  /**
   * Cancels any currently pending timeout or repeating interval timer and resets handle state.
   *
   * @purpose Clears scheduled timer handles on options.win to prevent orphaned timers and racing saves.
   * @inputs void.
   * @outputs void.
   * @dataflow timerHandle -> options.win.clearTimeout / options.win.clearInterval -> null.
   * @controlflow Check if timerHandle is non-null -> if isIntervalTimer call clearInterval, else clearTimeout -> reset timerHandle and isIntervalTimer.
   */
  function clearTimer(): void {
    // Check if an active timer handle exists.
    // An unreplaced handle is how you end up with two timers racing to save the same document.
    if (timerHandle !== null) {
      // Check whether the active timer handle represents an interval or a timeout.
      if (isIntervalTimer) {
        // Clear repeating interval timer.
        options.win.clearInterval(timerHandle);
      } else {
        // Clear one-shot timeout timer.
        options.win.clearTimeout(timerHandle);
      }
      timerHandle = null;
      isIntervalTimer = false;
    } else {
      // No active timer handle to clear.
    }
  }

  /**
   * Evaluates whether all conditions required to execute an autosave are currently met.
   *
   * @purpose Verifies that the controller is active, the document has a path on disk, and uncommitted edits exist.
   * @inputs void.
   * @outputs boolean - True if the document has a path, is dirty, and controller is not destroyed; false otherwise.
   * @dataflow options.hasPath() and options.session.snapshot.dirty -> boolean predicate.
   * @controlflow Check destroyed guard -> check options.hasPath() -> check options.session.snapshot.dirty -> return true only when all three hold.
   */
  function shouldSave(): boolean {
    // Check if the autosave controller has been destroyed.
    if (destroyed) {
      // Controller is destroyed: prevent autosave.
      return false;
    } else {
      // Controller is active: verify file path prerequisites.
    }

    // Check if the document has a path on disk.
    // Autosave deliberately does nothing until the document has been saved at least once —
    // silently creating a file the user never named is worse than not saving.
    if (!options.hasPath()) {
      // Document lacks a file path: autosave never runs on untitled documents.
      return false;
    } else {
      // Document has a valid file path: verify dirty state.
    }

    // Check if the document session contains unsaved modifications.
    if (!options.session.snapshot.dirty) {
      // Document is clean: no save is required.
      return false;
    } else {
      // All save prerequisites are satisfied: controller is active, document has path, and is dirty.
      return true;
    }
  }

  /**
   * Fully tears down previous policy timers and listeners before arming the active policy.
   *
   * @purpose Cancels previous policy AbortController and timers, then sets up listeners and timers for currentPolicy.
   * @inputs void.
   * @outputs void.
   * @dataflow currentPolicy -> timer setup or DOM event listener registration on options.win.
   * @controlflow Abort previous AbortController -> clear active timer -> instantiate fresh AbortController -> branch on currentPolicy.kind.
   */
  function arm(): void {
    // Check if a previous policy AbortController exists to tear down.
    // Swapping policy without tearing down leaves an orphaned interval saving forever.
    if (policyAbortController !== null) {
      // Abort event listeners registered under the previous policy.
      policyAbortController.abort();
      policyAbortController = null;
    } else {
      // No prior AbortController to abort.
    }

    // Always clear any active timer handle before re-arming.
    // An unreplaced handle is how you end up with two timers racing to save the same document.
    clearTimer();

    // Check if the controller has been destroyed.
    if (destroyed) {
      // Controller is destroyed: abort arming.
      return;
    } else {
      // Controller is active: allocate a new AbortController for this policy's lifecycle.
      policyAbortController = new AbortController();
    }

    // Branch on the kind of the active autosave policy.
    if (currentPolicy.kind === 'off') {
      // 'off' policy: no timers and no window event listeners are scheduled.
    } else if (currentPolicy.kind === 'onBlur') {
      // 'onBlur' policy: attach a blur listener on options.win that saves when dirty.
      options.win.addEventListener(
        'blur',
        (): void => {
          // Check if all save conditions are satisfied on window blur.
          if (shouldSave()) {
            // Save conditions met: invoke save callback.
            options.save();
          } else {
            // Prerequisites not satisfied: skip save on blur.
          }
        },
        { signal: policyAbortController.signal },
      );
    } else if (currentPolicy.kind === 'interval') {
      // 'interval' policy: schedule a repeating setInterval that saves when dirty.
      const intervalMs = currentPolicy.seconds * MILLISECONDS_PER_SECOND;
      isIntervalTimer = true;
      timerHandle = options.win.setInterval((): void => {
        // Check if all save conditions are satisfied on interval tick.
        if (shouldSave()) {
          // Save conditions met: invoke save callback.
          options.save();
        } else {
          // Prerequisites not satisfied: skip save on this interval tick.
        }
      }, intervalMs);
    } else if (currentPolicy.kind === 'idle') {
      // 'idle' policy: timers are scheduled on-demand when text-changing session events arrive.
    } else {
      // Exhaustive fallback for any unhandled policy variant.
    }
  }

  /**
   * Forces an immediate save if the document is dirty, has a path on disk, and the controller is not destroyed.
   *
   * @purpose Manually flushes unsaved document changes to disk if save prerequisites are met.
   * @inputs void.
   * @outputs boolean - True if a save was initiated; false if saving was inhibited or unneeded.
   * @dataflow shouldSave() evaluation -> conditional options.save() invocation.
   * @controlflow Check shouldSave() -> if true call options.save() and return true -> otherwise return false.
   */
  function flush(): boolean {
    // Check if all prerequisites for saving are met.
    if (shouldSave()) {
      // Prerequisites satisfied: execute save callback and return true.
      options.save();
      return true;
    } else {
      // Prerequisites not met (e.g. clean, untitled, or destroyed): return false.
      return false;
    }
  }

  /**
   * Swaps the active autosave policy at runtime, cancelling anything scheduled by the old policy.
   *
   * @purpose Updates currentPolicy and fully tears down prior timers and listeners before arming the new policy.
   * @inputs policy - The new AutosavePolicy to activate.
   * @outputs void.
   * @dataflow policy -> currentPolicy update -> arm() re-initialization.
   * @controlflow Check destroyed guard -> assign currentPolicy -> call arm() to tear down and re-arm.
   */
  function setPolicy(policy: AutosavePolicy): void {
    // Check if controller has already been destroyed.
    if (destroyed) {
      // Controller is destroyed: ignore policy update.
      return;
    } else {
      // Controller is active: assign new policy and arm handlers.
      currentPolicy = policy;
      arm();
    }
  }

  // Arm initial policy timers and event listeners.
  arm();

  // Subscribe to document session changes to react to editing events under idle policy.
  let unsubscribeSession: (() => void) | null = options.session.subscribe((change): void => {
    // Check if controller has already been destroyed.
    if (destroyed) {
      // Destroyed controller: ignore session change notifications.
      return;
    } else {
      // Active controller: inspect policy and change reason.
    }

    // Check if the active policy is 'idle'.
    if (currentPolicy.kind === 'idle') {
      // Check if the change reason represents a text-modifying edit.
      if (isTextChangingReason(change.reason)) {
        // Clear existing idle timer before re-arming.
        // An unreplaced handle is how you end up with two timers racing to save the same document.
        clearTimer();

        // Restarting rather than letting it run is the whole point of idle:
        // a user typing continuously should not be interrupted mid-sentence.
        const delayMs = currentPolicy.seconds * MILLISECONDS_PER_SECOND;
        timerHandle = options.win.setTimeout((): void => {
          timerHandle = null;
          isIntervalTimer = false;
          // Check if all save conditions are satisfied upon idle timer expiration.
          if (shouldSave()) {
            // Save conditions met: invoke save callback.
            options.save();
          } else {
            // Conditions not met (e.g. document untitled or clean): do not save.
          }
        }, delayMs);
      } else {
        // Non-text-changing reason (e.g. focus or reset): do not restart idle timer.
      }
    } else {
      // Active policy is not 'idle': ignore session changes for timer scheduling.
    }
  });

  /**
   * Cleans up all resources held by the autosave controller, aborting event listeners,
   * clearing active timers, and unsubscribing from session changes.
   *
   * @purpose Idempotently tears down all timers, event listeners, and session subscriptions.
   * @inputs void.
   * @outputs void.
   * @dataflow clearTimer -> policyAbortController.abort() -> unsubscribeSession().
   * @controlflow Check destroyed guard (return early if true) -> mark destroyed = true -> clear timer -> abort policy AbortController -> unsubscribe session listener.
   */
  function destroy(): void {
    // Check if the controller has already been destroyed.
    if (destroyed) {
      // Already destroyed: return immediately for idempotent teardown.
      return;
    } else {
      // Active controller: mark destroyed and proceed with resource cleanup.
      destroyed = true;
    }

    clearTimer();

    // Check if an active policy AbortController exists.
    if (policyAbortController !== null) {
      // Abort active policy event listeners.
      policyAbortController.abort();
      policyAbortController = null;
    } else {
      // No active policy AbortController.
    }

    // Check if session change listener is subscribed.
    if (unsubscribeSession !== null) {
      // Unsubscribe from session change notifications.
      unsubscribeSession();
      unsubscribeSession = null;
    } else {
      // Session listener already unsubscribed or absent.
    }
  }

  return {
    setPolicy,
    /**
     * @purpose Returns the currently active autosave policy.
     * @inputs void.
     * @outputs AutosavePolicy - The active autosave policy configuration.
     * @dataflow currentPolicy -> return value.
     * @controlflow Return currentPolicy directly.
     */
    get policy(): AutosavePolicy {
      return currentPolicy;
    },
    flush,
    destroy,
  };
}
