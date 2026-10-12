/**
 * @file plugin-worker.ts
 * @purpose Starts one plugin in its own worker and waits for it to say what it adds, then stops it and gives back the resources it was using (FR-14.18).
 * @inputs Raw plugin code as a string; the message handler that receives everything a started plugin says after ready; the core protocol helpers imported from '@k-doc/core'.
 * @outputs A PluginWorker holding the running worker, its blob url to give back, and what it registered; or an error when the plugin never becomes ready.
 * @functions
 *   - READY_MS: how long a plugin has to say what it adds before K-Doc gives up on it.
 *   - PluginWorker: one plugin that started, with its worker, blob url and registrations.
 *   - stopPluginWorker: stops one plugin and gives back the resources it was using.
 *   - startPluginWorker: starts one plugin in a worker of its own and waits for it to say what it adds.
 * @dataflow Raw code -> Blob URL -> Worker -> 'ready' message with registrations -> PluginWorker; every later worker message -> onMessage; stopPluginWorker terminates the worker and revokes the blob url.
 * @controlflow Create the blob then the worker first, await a single 'ready' reply inside a try so any failure stops that same worker before rejecting rather than leaving it running or answering half-started; stopPluginWorker runs two independent statements in order to end one plugin.
 * @version 1
 * @date 2026-09-18
 */

import { pluginWorkerSource, readPluginMessage, type PluginRegistration } from '@k-doc/core';

/** How long a plugin has to say what it adds before K-Doc gives up on it (FR-14.18). */
const READY_MS = 4000;

/** A plugin that started, and what it said it adds (FR-14.18). */
export interface PluginWorker {
  readonly worker: Worker;
  /** The blob address its code was loaded from, which has to be given back. */
  readonly url: string;
  readonly registrations: readonly PluginRegistration[];
}

/** Stops one plugin and gives back what it was using (FR-14.18).
 * @purpose Ends the worker's life and frees its blob URL so nothing a started plugin holds is left behind.
 * @inputs started - The PluginWorker to end, whose worker must be terminated and whose url must be revoked.
 * @outputs void - Nothing is returned; the side effect is that the worker stops and the blob address is released.
 * @dataflow started.worker -> terminate() ends execution at once; started.url -> revokeObjectURL() releases the blob memory.
 * @controlflow Two independent statements run in order: first stop the worker, then free its URL, with no branching between them. */
export function stopPluginWorker(started: PluginWorker): void {
  // The worker is running this plugin's code, so terminate it to stop execution at once.
  started.worker.terminate();

  // The blob url was created for that worker only, so revoke it now that the worker no longer exists.
  URL.revokeObjectURL(started.url);
}

/** Starts one plugin in a worker of its own and waits for it to say what it adds (FR-14.18).
 * @purpose Loads raw code into an isolated Worker, collects the single 'ready' reply that lists everything added, then forwards every later message to the caller.
 * @inputs code - The plugin's source text to run inside its own worker; onMessage - Called with each value a started plugin says after it is ready.
 * @outputs Promise<PluginWorker> - Resolves once the plugin has said what it adds, carrying the running worker, blob url and registrations.
 * @dataflow code -> Blob URL -> Worker -> 'ready' message with registrations -> PluginWorker; every later worker message -> onMessage.
 * @controlflow Create the blob then the worker first, await a single 'ready' reply inside a try so any failure stops that same worker before rejecting rather than leaving it running or answering half-started. */
export async function startPluginWorker(code: string, onMessage: (data: unknown) => void): Promise<PluginWorker> {
  const blob = new Blob([pluginWorkerSource(code)], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);

  try {
    const registrations = await new Promise<readonly PluginRegistration[]>((resolve, reject): void => {
      // A plugin that never says what it adds must not hold the app up for ever.
      const timer = setTimeout((): void => {
        reject(new Error('it did not say what it adds.'));
      }, READY_MS);

      worker.onmessage = (event: MessageEvent<unknown>): void => {
        const message = readPluginMessage(event.data);

        // Check whether this is the message that says what the plugin adds.
        if (message !== null && message.kind === 'ready') {
          // It is: stop waiting and answer with what it registered.
          clearTimeout(timer);
          resolve(message.registrations);
        } else {
          // Anything else before ready is not what this listener is for; the timer still runs.
        }
      };

      worker.onerror = (event: ErrorEvent): void => {
        // The plugin threw while it was starting, which is the plainest kind of not starting.
        clearTimeout(timer);
        reject(new Error(event.message));
      };
    });

    // From here the plugin is running and everything it says goes to whoever started it.
    worker.onmessage = (event: MessageEvent<unknown>): void => {
      onMessage(event.data);
    };

    return { worker, url, registrations };
  } catch (error) {
    // It did not start. Stop it here rather than leaving a worker running for a plugin that never was.
    worker.terminate();
    URL.revokeObjectURL(url);
    throw error;
  }
}
