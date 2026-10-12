/**
 * @file close-guard.ts
 * @purpose Intercepts desktop window-close requests and asks the shell whether closing is permitted, keeping the window open when the answer is no or the check fails.
 * @inputs A Tauri `Window` (to obtain a close-request source) plus an async confirm callback and an error reporter used while installing the guard.
 * @outputs Nothing; installs a Tauri onCloseRequested handler that may prevent default closing via CloseRequestEvent.preventDefault().
 * @functions
 *   - tauriCloseRequests: Returns a CloseRequestSource bound to the current window, or null when no desktop host is present.
 *   - installCloseGuard: Wires the confirm callback into a close-request source and guards against re-entrant asks.
 * @dataflow Tauri close event → onCloseRequested handler → confirm() → preventDefault decision → (on error) onError reporter.
 * @controlflow Obtain source → return early when null → subscribe to close requests → on each request refuse if already asking, otherwise run confirm and branch on its result; errors funnel to onError without closing.
 * @version 1
 * @date 2026-10-07
 */

import { getCurrentWindow } from '@tauri-apps/api/window';

/** A close-request event whose default action (window closure) can be cancelled via preventDefault(). */
export interface CloseRequestEvent { preventDefault(): void; }

/** Supplies a single onCloseRequested subscription used by the guard to observe window-close requests. */
export interface CloseRequestSource { onCloseRequested(handler: (event: CloseRequestEvent) => Promise<void>): Promise<() => void>; }

// Outside the desktop host there is no window whose closure can be guarded, so no source exists and callers skip installation.
export function tauriCloseRequests(win: Window): CloseRequestSource | null {
  // The Tauri runtime injects this internal marker only inside a live desktop window; its absence means we are not hosted.
  if (!('__TAURI_INTERNALS__' in win)) {
    return null;
  } else {
    const current = getCurrentWindow();
    // Bind the guard to this process's own window and expose a subscription handle for installCloseGuard.
    return { onCloseRequested: (handler) => current.onCloseRequested(handler) };
  }
}

/**
 * @purpose Install a close-request handler that asks confirm() before allowing the window to close, keeping it open on no or failure.
 * @inputs source - The CloseRequestSource from tauriCloseRequests; null means there is nothing to guard. confirm - async predicate returning whether closing is allowed. onError - reporter invoked when a check throws so work is never silently lost.
 * @outputs Resolves once the onCloseRequested handler has been successfully subscribed (never rejects).
 * @dataflow installCloseGuard → source.onCloseRequested(handler) → confirm() on each request → preventDefault or onError decision per event.
 * @controlflow Return early when source is null; otherwise subscribe, then for each event refuse re-entrant asks and run confirm while guarding its result and errors inside a finally that clears the asking flag.
 */
export async function installCloseGuard(
  source: CloseRequestSource | null,
  confirm: () => Promise<boolean>,
  onError: (error: unknown) => void,
): Promise<void> {
  // With no desktop close-request source there is nothing to observe, so resolve immediately without subscribing.
  if (source === null) {
    return;
  } else {
    let asking = false;

    try {
      await source.onCloseRequested(async (event: CloseRequestEvent): Promise<void> => {
        // A second close while the first request is still being answered must not open a second question, so it is refused immediately.
        if (asking) {
          event.preventDefault();
          return;
        } else {
          asking = true;
          try {
            const mayClose = await confirm();
            // Anything but an affirmative yes keeps the window — and its unsaved work — open by cancelling closure.
            if (!mayClose) {
              event.preventDefault();
            } else {
              // The user permitted closing: leave Tauri's default action in place so the window actually closes.
            }
          } catch (error: unknown) {
            // A check that failed must never lose work, so keep the window open and report why through onError.
            event.preventDefault();
            onError(error);
          } finally {
            asking = false;
          }
        }
      });
    } catch (error: unknown) {
      // If subscribing to close requests itself fails, report it without attempting any default action on the window.
      onError(error);
    }
  }
}
