/**
 * @file external-watch.ts
 * @purpose Webview-side client adapter for K-Doc external filesystem change detection (FR-6.4).
 *   Monitors the active document file on disk for out-of-band modifications made by other tools,
 *   debouncing bursts of filesystem events, silently applying updates to clean buffers, and prompting
 *   with a conflict resolution workflow when unsaved buffer edits are present.
 * @inputs ExternalWatchOptions containing DocumentSession, Window context, readDiskText, resolveConflict, onReloaded, and onError callbacks; Tauri IPC change events ('kdoc://external-change').
 * @outputs ExternalWatch controller interface exposing available status, setPath, and destroy lifecycle methods, alongside EXTERNAL_CHANGE_DEBOUNCE_MS.
 * @functions
 *   - isTauri: Determines desktop runtime availability by detecting the Tauri global without throwing exceptions.
 *   - isExternalChangeEvent: Validates that an untrusted value received across the IPC boundary conforms to the ExternalChangeEvent schema.
 *   - isOwnWrite: Whether disk text is what the session holds or last saved, i.e. not someone else's change.
 *   - applyConflictResolution: Applies a user's conflict resolution choice to the session and reports whether the buffer was replaced.
 *   - installExternalWatch: Instantiates and activates the external-watch controller, binds IPC listeners, and returns the ExternalWatch controller.
 * @dataflow OS filesystem event -> watcher.rs -> Tauri IPC event ('kdoc://external-change') -> debounce timer -> readDiskText -> session comparison / resolveConflict -> applyExternalText -> onReloaded.
 * @controlflow Runtime capability probe via isTauri(win) -> if available listen for 'kdoc://external-change' -> setPath invokes watch_file/unwatch_file -> on event restart debounce timer -> on timer expiration reconcile against session state -> clean buffer reloads silently -> dirty buffer invokes resolveConflict -> destroy cleans up timer, watcher, and listener.
 * @version 2
 * @date 2026-09-12
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { DocumentSession } from '@k-doc/core';

/**
 * What the user settled on when the file changed under a dirty buffer.
 *
 * 'merged' carries its text because a merge is not a choice between two versions that already exist --
 * it produces a third, and there is nowhere else for it to come from. The other three name a side, or
 * name no side at all.
 */
export type ConflictResolution =
  | { readonly kind: 'keepMine' }
  | { readonly kind: 'takeTheirs' }
  | { readonly kind: 'ignore' }
  | { readonly kind: 'merged'; readonly text: string };

export interface ExternalChangeEvent {
  readonly path: string;
  readonly kind: string;
}

export interface ExternalWatchOptions {
  readonly session: DocumentSession;
  readonly win: Window;
  /** Reads the file's current text from disk. Rejects when it cannot be read. */
  readonly readDiskText: (path: string) => Promise<string>;
  /** Asked only when the buffer is dirty. Resolves with what to do. */
  readonly resolveConflict: (path: string, diskText: string) => Promise<ConflictResolution>;
  /** Called after a silent reload, so the shell can tell the user what happened. */
  readonly onReloaded: (path: string) => void;
  readonly onError: (message: string) => void;
}

export interface ExternalWatch {
  readonly available: boolean;
  /** Begin watching a path, replacing any previous watch. Pass null to stop. */
  setPath(path: string | null): void;
  destroy(): void;
}

/**
 * Debounce duration in milliseconds before acting on filesystem change events (150ms).
 *
 * A single save from another editor produces a burst of filesystem events —
 * a temp file created, renamed, then metadata touched — so acting on the first
 * one would re-read a file mid-write. The debounce coalesces the burst into one reload.
 */
export const EXTERNAL_CHANGE_DEBOUNCE_MS: number = 150;

/**
 * Narrow local interface extending the browser Window to declare Tauri runtime internals.
 */
interface TauriWindow extends Window {
  readonly __TAURI_INTERNALS__?: unknown;
}

/**
 * Checks whether the application is running inside a Tauri desktop host environment.
 *
 * @purpose Determines desktop runtime availability by detecting the Tauri global without throwing exceptions.
 * @inputs win - The browser Window object to inspect.
 * @outputs boolean - True if running inside Tauri host, false otherwise.
 * @dataflow Window object -> '__TAURI_INTERNALS__' property presence check -> boolean capability status.
 * @controlflow Inspect '__TAURI_INTERNALS__' in window -> return true if present, false if absent.
 */
function isTauri(win: Window): boolean {
  // Checking for the __TAURI_INTERNALS__ global is how the Tauri runtime announces itself.
  // Checking this property is preferable to a try/catch around a failing invoke,
  // because a capability check should not be implemented as an exception.
  const candidate = win as unknown as TauriWindow;

  // Check if '__TAURI_INTERNALS__' exists on the window object.
  if ('__TAURI_INTERNALS__' in candidate) {
    // Branch: Running inside Tauri desktop runtime host.
    return true;
  } else {
    // Branch: Running inside standard browser environment.
    return false;
  }
}

/**
 * Validates that an untrusted value received across the IPC boundary conforms to the ExternalChangeEvent schema.
 *
 * @purpose Verifies runtime payload shape (path and kind strings) for IPC boundary safety without using any.
 * @inputs value - The unknown payload received from the Tauri event.
 * @outputs boolean - True if value is a valid ExternalChangeEvent, false otherwise.
 * @dataflow value -> runtime type inspection -> boolean validation status.
 * @controlflow Check object non-null -> verify path and kind are strings -> return true if valid, false otherwise.
 */
function isExternalChangeEvent(value: unknown): value is ExternalChangeEvent {
  // Check if value is a non-null object.
  if (typeof value !== 'object' || value === null) {
    // Branch: Value is null or not an object; invalid event payload.
    return false;
  } else {
    // Branch: Value is a non-null object; verify fields.
  }

  const candidate = value as Record<string, unknown>;

  // Check if path and kind properties exist and are strings.
  if (
    'path' in candidate &&
    typeof candidate.path === 'string' &&
    'kind' in candidate &&
    typeof candidate.kind === 'string'
  ) {
    // Branch: Valid ExternalChangeEvent payload shape.
    return true;
  } else {
    // Branch: Missing or invalid property types.
    return false;
  }
}

/**
 * Acts on a user's conflict resolution choice for a dirty buffer whose file changed under it (FR-6.4).
 *
 * Applies the chosen side to the session and reports whether the buffer was actually replaced, so the
 * caller can decide whether to announce a reload. A 'takeTheirs' or 'merged' resolution replaces the
 * buffer's text; 'keepMine' and 'ignore' leave it untouched -- the user kept their version, or has not
 * decided yet. The returned boolean is "the buffer was replaced", which is exactly when the caller should
 * call onReloaded: there is no other signal for it, so a caller that guessed would either announce a reload
 * that did not happen or stay silent about one that did. This function exists precisely so the caller does
 * not have to guess.
 *
 * @purpose Applies takeTheirs/merged text to the session and returns whether the buffer was replaced.
 * @inputs session - The document session whose buffer receives the external change via applyExternalText.
 * @inputs resolution - What the user settled on: keepMine, takeTheirs, ignore, or merged with its text.
 * @inputs diskText - The current on-disk text, applied to the buffer when the choice is 'takeTheirs'.
 * @outputs boolean - True if the buffer was replaced (the caller should call onReloaded), false otherwise.
 * @dataflow resolution.kind -> session.applyExternalText(diskText | resolution.text) -> replacement boolean.
 * @controlflow Match resolution.kind: takeTheirs applies diskText and returns true; merged applies its text and returns true; keepMine changes nothing and returns false; the ignore default changes nothing and returns false.
 */
export function applyConflictResolution(
  session: DocumentSession,
  resolution: ConflictResolution,
  diskText: string,
): boolean {
  if (resolution.kind === 'takeTheirs') {
    // Branch: User chose 'takeTheirs'; apply external disk contents and notify onReloaded.
    session.applyExternalText(diskText);
    return true;
  } else if (resolution.kind === 'merged') {
    // Branch: User merged the two versions; apply the text the merge produced.
    // It goes in as an external change rather than a pane edit because neither pane made it, and it
    // leaves the buffer dirty on purpose: the merged text is on disk nowhere yet, so it is unsaved work.
    session.applyExternalText(resolution.text);
    return true;
  } else if (resolution.kind === 'keepMine') {
    // Branch: User chose 'keepMine'; do nothing to the buffer.
    // The user keeps editing and their next save overwrites the external change, which is what they asked for.
    return false;
  } else {
    // Branch: User chose 'ignore'; do nothing to the buffer.
    // It differs from keepMine only in intent -- the user has not decided, so the next external change asks again.
    return false;
  }
}

/**
 * Installs and activates the external-change watch controller for an open document session (FR-6.4).
 *
 * @purpose Monitors the open document on disk, debouncing burst notifications and coordinating reloads or conflict resolution.
 * @inputs options - ExternalWatchOptions specifying document session, window context, disk reader, conflict resolver, and callbacks.
 * @outputs ExternalWatch - Controller interface exposing available status, setPath, and destroy lifecycle methods.
 * @dataflow External filesystem event -> Tauri IPC event -> debounce timer -> readDiskText -> session comparison / resolveConflict -> applyExternalText -> onReloaded.
 * @controlflow Probe Tauri runtime availability -> if available register event listener -> return controller interface with setPath and destroy.
 */
export function installExternalWatch(options: ExternalWatchOptions): ExternalWatch {
  const available = isTauri(options.win);
  let destroyed: boolean = false;
  let currentPath: string | null = null;
  let timerHandle: number | null = null;
  let unlistenFn: UnlistenFn | null = null;
  let unlistenPromise: Promise<UnlistenFn> | null = null;

  /**
   * Cancels any currently pending external change debounce timer and resets the handle.
   *
   * @purpose Clears scheduled debounce timeout on options.win to prevent orphaned reconcile callbacks.
   * @inputs void.
   * @outputs void.
   * @dataflow timerHandle -> options.win.clearTimeout -> null.
   * @controlflow Check if timerHandle is non-null -> call options.win.clearTimeout -> reset timerHandle to null.
   */
  function clearTimer(): void {
    // Check if an active debounce timer handle exists.
    if (timerHandle !== null) {
      // Active timer exists: cancel it using window.clearTimeout.
      options.win.clearTimeout(timerHandle);
      timerHandle = null;
    } else {
      // No active timer handle to cancel.
    }
  }

  /**
   * Reconciles current on-disk file contents against the in-memory document session.
   *
   * @purpose Reads disk contents, detects self-saves, reloads clean sessions silently, or invokes conflict resolution for dirty sessions.
   * @inputs void.
   * @outputs Promise<void> - Resolves when reconciliation completes or is aborted.
   * @dataflow options.readDiskText(path) -> comparison with session.snapshot.text -> applyExternalText / resolveConflict -> onReloaded.
   * @controlflow Check destroyed guard -> check currentPath non-null -> readDiskText -> compare text (noop if identical) -> check dirty -> clean reloads silently -> dirty prompts resolveConflict -> apply resolution.
   */
  async function reconcile(): Promise<void> {
    // Guard the whole reconcile against destroyed.
    if (destroyed) {
      // Branch: Controller has been destroyed; abort reconcile.
      return;
    } else {
      // Branch: Controller is active; proceed with reconcile.
    }

    // Step 1: Ignore the event when the current watched path is null.
    const path = currentPath;
    if (path === null) {
      // Branch: Current watched path is null; ignore event.
      return;
    } else {
      // Branch: Active file path is set; proceed with disk read.
    }

    // Step 2: Read current disk text.
    // A file which has just been deleted or replaced can be briefly unreadable,
    // and a failed read is not worth a dialog.
    let diskText: string;
    try {
      diskText = await options.readDiskText(path);
    } catch (err: unknown) {
      // Check if the caught error is an instance of Error.
      if (err instanceof Error) {
        // Branch: Forward Error message to caller onError handler.
        options.onError(err.message);
      } else {
        // Branch: Convert non-Error value to string and forward to error handler.
        options.onError(String(err));
      }
      return;
    }

    // Guard against controller destruction or watched path change during async disk read.
    if (destroyed || currentPath !== path) {
      // Branch: Destroyed or watched path changed during read; abort reconcile.
      return;
    } else {
      // Branch: Controller active and path unchanged; proceed to content comparison.
    }

    // Step 3: If the disk text equals options.session.snapshot.text, do nothing.
    // This is what stops K-Doc reacting to its own saves: the app writes the file,
    // the watcher fires, and comparing content rather than trying to time-window our
    // own writes is the only version of this that cannot race.
    // Matching the saved text is the same signal for a save the user kept typing through: the disk holds
    // exactly what K-Doc last wrote, so it is not someone else's change and must not raise a conflict.
    if (isOwnWrite(diskText, options.session.snapshot)) {
      // Branch: Disk contents match the session or its last save; do nothing.
      return;
    } else {
      // Branch: Disk contents differ from in-memory session; resolve changes.
    }

    // Step 4: If the session is not dirty: call options.session.applyExternalText(diskText) and then options.onReloaded(path).
    // A clean buffer has nothing to lose, so reloading silently is right, and that the
    // bindings preserve the caret because applyExternalText reports a change the panes
    // reconcile rather than rebuilding from scratch.
    if (!options.session.snapshot.dirty) {
      // Branch: Session buffer is clean; silently reload external disk contents.
      options.session.applyExternalText(diskText);
      options.onReloaded(path);
      return;
    } else {
      // Branch: Session buffer is dirty; prompt user to resolve conflict.
    }

    // Step 5: If the session is dirty: await options.resolveConflict(path, diskText) and act on the answer.
    let resolution: ConflictResolution;
    try {
      resolution = await options.resolveConflict(path, diskText);
    } catch (err: unknown) {
      // Check if the caught error is an instance of Error.
      if (err instanceof Error) {
        // Branch: Forward Error message to caller onError handler.
        options.onError(err.message);
      } else {
        // Branch: Convert non-Error value to string and forward to error handler.
        options.onError(String(err));
      }
      return;
    }

    // Guard against controller destruction or watched path change during async conflict resolution.
    if (destroyed || currentPath !== path) {
      // Branch: Destroyed or watched path changed during conflict prompt; abort.
      return;
    } else {
      // Branch: Controller active and path unchanged; proceed to apply resolution.
    }

    // Act on the user's conflict resolution choice.
    const replaced = applyConflictResolution(options.session, resolution, diskText);

    // Check whether the buffer was replaced, which is what there is to tell the user about.
    if (replaced) {
      // The buffer now holds something other than what the user was typing into: say so.
      options.onReloaded(path);
    } else {
      // Nothing changed -- the user kept their version, or has not decided yet.
    }
  }

  /**
   * Begins watching a path on disk, replacing any previous watch, or stops watching when null.
   *
   * @purpose Configures native filesystem monitoring for the specified file path or stops monitoring.
   * @inputs path - The target file path string to monitor, or null to unwatch.
   * @outputs void.
   * @dataflow path -> invoke('watch_file' | 'unwatch_file') -> error catch -> options.onError.
   * @controlflow Check available guard -> check destroyed guard -> update currentPath -> clear timer -> invoke native command -> catch errors to onError.
   */
  function setPath(path: string | null): void {
    // Guard against running outside desktop environment.
    // The browser dev build has no filesystem to watch, and this is absence, not failure.
    if (!available) {
      // Branch: Desktop capabilities absent; setPath is a no-op.
      return;
    } else {
      // Branch: Desktop host present; proceed with watch configuration.
    }

    // Guard against invocations after controller destruction.
    if (destroyed) {
      // Branch: Controller has been destroyed; ignore setPath invocation.
      return;
    } else {
      // Branch: Controller is active; proceed with updating path.
    }

    currentPath = path;
    clearTimer();

    // Check whether a target path is specified or watch should be cleared.
    if (path !== null) {
      // Branch: Target file path provided; invoke native watch_file command.
      invoke('watch_file', { path }).catch((err: unknown): void => {
        // Check if the caught error is an instance of Error.
        if (err instanceof Error) {
          // Branch: Forward Error message to caller onError handler.
          options.onError(err.message);
        } else {
          // Branch: Convert non-Error value to string and forward to error handler.
          options.onError(String(err));
        }
      });
    } else {
      // Branch: Path is null; invoke native unwatch_file command to stop monitoring.
      invoke('unwatch_file').catch((err: unknown): void => {
        // Check if the caught error is an instance of Error.
        if (err instanceof Error) {
          // Branch: Forward Error message to caller onError handler.
          options.onError(err.message);
        } else {
          // Branch: Convert non-Error value to string and forward to error handler.
          options.onError(String(err));
        }
      });
    }
  }

  /**
   * Cleans up all resources held by the external watch controller, cancelling timers and unlistening IPC events.
   *
   * @purpose Idempotently tears down the external watch controller lifecycle.
   * @inputs void.
   * @outputs void.
   * @dataflow clearTimer() -> unwatch native backend -> unlisten IPC event.
   * @controlflow Check destroyed guard -> mark destroyed = true -> clear timer -> unwatch backend -> invoke unlisten.
   */
  function destroy(): void {
    // Check if the controller has already been destroyed.
    if (destroyed) {
      // Branch: Already destroyed; return immediately for idempotent teardown.
      return;
    } else {
      // Branch: Active controller; mark destroyed and proceed with resource cleanup.
      destroyed = true;
    }

    clearTimer();

    // Check whether an active watch should be stopped on the native desktop host.
    if (available && currentPath !== null) {
      currentPath = null;
      invoke('unwatch_file').catch((err: unknown): void => {
        // Check if the caught error is an instance of Error.
        if (err instanceof Error) {
          // Branch: Forward Error message to caller onError handler.
          options.onError(err.message);
        } else {
          // Branch: Convert non-Error value to string and forward to error handler.
          options.onError(String(err));
        }
      });
    } else {
      currentPath = null;
    }

    // Check whether the Tauri unlisten function is already resolved or pending.
    // A listener leaked past destroy would keep re-reading a file the editor no longer has open.
    if (unlistenFn !== null) {
      // Branch: Unlisten function is already resolved; call it immediately.
      unlistenFn();
      unlistenFn = null;
    } else if (unlistenPromise !== null) {
      // Branch: Listen promise is still in-flight; attach unlisten call on resolution.
      unlistenPromise
        .then((unlisten: UnlistenFn): void => {
          unlisten();
        })
        .catch((err: unknown): void => {
          // Check if the caught error is an instance of Error.
          if (err instanceof Error) {
            options.onError(err.message);
          } else {
            options.onError(String(err));
          }
        });
    } else {
      // Branch: No event listener registered (e.g. unavailable in browser mode).
    }
  }

  /**
   * Handles incoming Tauri external change events from the native filesystem watcher.
   *
   * @purpose Validates incoming event payload shape, verifies path correlation, and restarts the debounce timer.
   * @inputs event - The Tauri event wrapper containing untrusted payload data from IPC.
   * @outputs void.
   * @dataflow event.payload -> isExternalChangeEvent -> restart debounce timer -> reconcile().
   * @controlflow Check destroyed guard -> validate payload shape -> check active watched path match -> clear timer -> setTimeout(reconcile).
   */
  function handleEvent(event: { readonly payload: unknown }): void {
    // Check if the controller has been destroyed.
    if (destroyed) {
      // Branch: Controller is destroyed; ignore incoming event.
      return;
    } else {
      // Branch: Controller is active; inspect payload.
    }

    // Validate the event payload shape before trusting it across the IPC boundary.
    if (!isExternalChangeEvent(event.payload)) {
      // Branch: Invalid payload structure; ignore event.
      return;
    } else {
      // Branch: Valid ExternalChangeEvent payload.
    }

    // Check if the event matches the currently monitored path.
    if (currentPath === null || event.payload.path !== currentPath) {
      // Branch: No active watch or event path does not match currently watched file; ignore.
      return;
    } else {
      // Branch: Event corresponds to active watched file; restart debounce timer.
    }

    clearTimer();

    // Restart the debounce timer with EXTERNAL_CHANGE_DEBOUNCE_MS.
    // A single save from another editor produces a burst of filesystem events —
    // a temp file created, renamed, then metadata touched — so acting on the first
    // one would re-read a file mid-write. The debounce coalesces the burst into one reload.
    timerHandle = options.win.setTimeout((): void => {
      timerHandle = null;
      void reconcile();
    }, EXTERNAL_CHANGE_DEBOUNCE_MS);
  }

  // Check whether running inside Tauri desktop host.
  if (available) {
    // Register the event listener once via listen<ExternalChangeEvent>.
    unlistenPromise = listen<ExternalChangeEvent>('kdoc://external-change', handleEvent);

    unlistenPromise.then(
      (unlisten: UnlistenFn): void => {
        // Check if the controller was destroyed while the listen promise was resolving.
        if (destroyed) {
          // Branch: Controller destroyed during resolution; unlisten immediately.
          // A listener leaked past destroy would keep re-reading a file the editor no longer has open.
          unlisten();
        } else {
          // Branch: Controller active; store resolved unlisten function.
          unlistenFn = unlisten;
        }
      },
      (err: unknown): void => {
        // Check if the caught error is an instance of Error.
        if (err instanceof Error) {
          // Branch: Forward Error message to caller onError handler.
          options.onError(err.message);
        } else {
          // Branch: Convert non-Error value to string and forward to error handler.
          options.onError(String(err));
        }
      },
    );
  } else {
    // Branch: Running outside Tauri; setPath is a no-op and no listener is registered.
    // The browser dev build has no filesystem to watch, and this is absence, not failure.
  }

  return {
    available,
    setPath,
    destroy,
  };
}

/**
 * @purpose Decides whether a file change is K-Doc's own write rather than someone else's edit.
 * @inputs diskText - The file's text now; snapshot - the session's current and last-saved text.
 * @outputs boolean - True when the disk holds what the session holds or what it last saved.
 * @dataflow diskText compared with snapshot.text and snapshot.savedText.
 * @controlflow No branching: the saved-text match covers a save the user kept typing through.
 */
export function isOwnWrite(diskText: string, snapshot: { readonly text: string; readonly savedText: string }): boolean {
  return diskText === snapshot.text || diskText === snapshot.savedText;
}
