/**
 * @file plugin-host.ts
 * @purpose Registers every reader plugin: one worker per plugin started by plugin-worker.ts, this file holds what loaded and calls a plugin on request (FR-14.18).
 * @inputs options.win - The window used to detect whether the Tauri runtime is present; invoke from '@tauri-apps/api/core' for folder access; startPluginWorker/stopPluginWorker from './plugin-worker.js'.
 * @outputs A PluginHost exposing what loaded, its syntaxes, problems and a run() that asks one plugin to do work.
 * @functions
 *   - CALL_MS: how long one call to a plugin has before K-Doc gives up on it and stops it.
 *   - createPluginHost: builds the host object with everything it needs closed over inside.
 * @dataflow options.win -> availability check; invoke('plugin_names') -> folder names -> begin() per name -> startPluginWorker -> LoadedPlugin list; run() -> worker.postMessage -> answered() settles a waiting call.
 * @controlflow createPluginHost sets up state and helpers, then returns an object whose methods drive load/run/destroy through the started workers and waiting calls.
 * @version 1
 * @date 2026-09-18
 */

import { invoke } from '@tauri-apps/api/core';
import { parsePluginManifest, pluginProblem, readPluginMessage, type PluginManifest, type PluginRegistration, type PluginSyntax } from '@k-doc/core';
import { startPluginWorker, stopPluginWorker, type PluginWorker } from './plugin-worker.js';

/** How long one call to a plugin has before K-Doc gives up on it and stops it. */
const CALL_MS = 4000;

/** The most problems kept for the Plugins panel. */
const MAX_PROBLEMS = 50;

/** What one plugin answered with: text to use, and something to say in the status bar. */
export interface PluginAnswer {
  readonly text: string | null;
  readonly message: string | null;
}

/** One plugin that loaded, and everything it added. */
export interface LoadedPlugin {
  readonly manifest: PluginManifest;
  readonly registrations: readonly PluginRegistration[];
}

export interface PluginHostOptions { readonly win: Window; }

export interface PluginHost {
  readonly available: boolean;
  load(): Promise<void>;
  readonly plugins: readonly LoadedPlugin[];
  readonly problems: readonly string[];
  readonly syntaxes: readonly PluginSyntax[];
  run(pluginId: string, point: 'command' | 'panel' | 'export', id: string, text: string): Promise<PluginAnswer>;
  folder(): Promise<string>;
  destroy(): void;
}

/** Builds the plugin host with all its state closed over inside (FR-14.18).
 * @purpose Creates one object that tracks which plugins loaded, what they registered and how to call them back through their workers.
 * @inputs options - The window used to detect whether the Tauri runtime is present for folder access.
 * @outputs PluginHost - An object exposing availability, load(), the loaded plugins, problems, syntaxes, run() and destroy().
 * @dataflow options.win -> availability flag; invoke('plugin_names') -> begin() per name -> startPluginWorker -> LoadedPlugin[]; run() -> worker.postMessage -> answered() settles a waiting call.
 * @controlflow Set up state maps and helper functions first, then return the host object whose methods drive loading and calling plugins. */
export function createPluginHost(options: PluginHostOptions): PluginHost {
  const available = '__TAURI_INTERNALS__' in (options.win as unknown as Record<string, unknown>);

  /** One call that has been sent and not yet answered. */
  interface Waiting {
    readonly settle: (answer: PluginAnswer) => void;
    readonly fail: (reason: Error) => void;
    readonly timer: ReturnType<typeof setTimeout>;
    /** The plugin the call was sent to; only that plugin may answer it. */
    readonly plugin: string;
  }

  const started = new Map<string, PluginWorker>();
  const waiting = new Map<number, Waiting>();
  let loaded: LoadedPlugin[] = [];
  let problems: string[] = [];
  let nextCall = 0;

  /** Records a problem, keeping at most MAX_PROBLEMS so a misbehaving plugin cannot grow the list without bound. */
  function report(problem: string): void {
    // Over the cap: the reader already has plenty to act on, so later problems are dropped.
    if (problems.length < MAX_PROBLEMS) {
      problems.push(problem);
    } else {
      // At the cap: drop it.
    }
  }

  /** Turns an unknown error into a single readable sentence of why it failed (FR-14.18).
   * @purpose Gives every problem message words even when the thrown value is not an Error instance.
   * @inputs error - The caught value, which may be an Error or anything else that was thrown.
   * @outputs string - `error.message` when it is an Error, otherwise its text form.
   * @dataflow Unknown error -> instanceof check -> message or String() coercion.
   * @controlflow One ternary: a real Error yields its message, any other value falls back to String(). */
  function reason(error: unknown): string {
    // A real Error carries a message worth showing; anything else is turned into text so the problem still has words.
    return error instanceof Error ? error.message : String(error);
  }

  /** Stops every started plugin and abandons every call still waiting on one (FR-14.18).
   * @purpose Ends all workers and fails any in-flight call so nothing a plugin holds is left running after the host goes away.
   * @inputs void - Nothing; it acts on the closed-over `started` and `waiting` state directly.
   * @outputs void - The side effect is that every worker stops and every waiting call is failed with an error.
   * @dataflow started map -> stopPluginWorker ends each worker; waiting map -> clearTimeout + fail() drops each pending call.
   * @controlflow Two independent passes: first stop all workers, then clear all timers and fail their calls, in that order. */
  function stopAll(): void {
    // Each running plugin must be stopped so its code stops executing at once.
    for (const plugin of started.values()) {
      stopPluginWorker(plugin);
    }

    // The map is now empty because no worker should stay registered after this runs.
    started.clear();

    // Every call still waiting on a plugin must be failed rather than left hanging forever.
    for (const pending of waiting.values()) {
      clearTimeout(pending.timer);
      pending.fail(new Error('The plugin was stopped.'));
    }

    // The map is now empty because every pending call has been answered with an error here.
    waiting.clear();
  }

  /** Handles one message from a started plugin before K-Doc asks for another (FR-14.18).
   * @purpose Turns whatever a worker sends into either settling or failing the matching call, refusing anything unrecognised.
   * @inputs data - The raw value sent by a plugin worker across the boundary.
   * @outputs void - Nothing returned; the side effect is that one waiting call settles or fails, or a problem is recorded.
   * @dataflow Raw worker message -> readPluginMessage -> answer/failed branch -> matching Waiting entry settled or failed.
   * @controlflow Refuse unreadable messages first, then branch on kind: only 'answer' and 'failed-with-call' act; 'ready' is ignored here. */
  function answered(from: string, data: unknown): void {
    const message = readPluginMessage(data);

    // A value K-Doc cannot parse means the plugin sent something unexpected, so record it rather than acting on nothing.
    if (message === null) {
      report(pluginProblem('', 'a plugin said something K-Doc did not understand.'));
      return;
    } else {
      // The message is one of the three recognised kinds: decide which below by its kind tag.
    }

    if (message.kind === 'answer') {
      const pending = waiting.get(message.call);

      // A matching call must exist to answer; without it this reply has nowhere to go and is dropped silently.
      if (pending === undefined) {
        return;
      } else {
        // The call was found: stop its timer, remove it and hand back the text and status message it asked for.
      }

      // Only the plugin that was asked may answer: another plugin guessing the call number must not supply the result.
      if (pending.plugin !== from) {
        report(pluginProblem(from, 'answered a request it was not sent.'));
        return;
      } else {
        // The right plugin answered.
      }

      clearTimeout(pending.timer);
      waiting.delete(message.call);
      pending.settle({ text: message.text, message: message.message });
    } else if (message.kind === 'failed') {
      // A failure only matters when it names the call it failed; a failure before any request has no matching entry.
      if (message.call !== null) {
        const pending = waiting.get(message.call);

        // The failing call must be one still waiting on; without it there is nothing to fail and it is dropped silently.
        if (pending === undefined) {
          return;
        } else {
          // The call was found: stop its timer, remove it and report the plugin's own reason for failing.
        }

        // Only the plugin that was asked may fail the call.
        if (pending.plugin !== from) {
          report(pluginProblem(from, 'answered a request it was not sent.'));
          return;
        } else {
          // The right plugin reported the failure.
        }

        clearTimeout(pending.timer);
        waiting.delete(message.call);
        pending.fail(new Error(message.reason));
      } else {
        // No matching call to fail: this failure happened before any request was made, so nothing here can act on it.
      }
    } else {
      // The remaining recognised kind is 'ready', which only ever arrives during startPluginWorker and has been taken there already.
    }
  }

  /** Loads one plugin folder into its own worker (FR-14.18).
   * @purpose Reads the folder's manifest and code, starts a worker for it and records what it registered once ready.
   * @inputs name - The plugin folder's own name, used as both the read key and the id in any problem message.
   * @outputs Promise<void> - Resolves whether or not the plugin started; failures are recorded on `problems` rather than thrown.
   * @dataflow invoke('plugin_read') -> manifest text + code -> parsePluginManifest -> startPluginWorker -> LoadedPlugin pushed onto loaded.
   * @controlflow Read then split, guard both parts exist, parse the manifest, then start the worker in a try so any failure records one problem and returns. */
  async function begin(name: string): Promise<void> {
    let parts: readonly string[];

    // The folder's contents come from Tauri only when available; a read failure is recorded rather than stopping the whole load.
    try {
      parts = await invoke<string[]>('plugin_read', { name });
    } catch (error) {
      report(pluginProblem(name, 'could not be read. ' + reason(error)));
      return;
    }

    // The read returned: the manifest text comes first and the code after it.
    const manifestText = parts[0];
    const code = parts[1];

    // Both values must be present, because a plugin needs its self-description and its code to start at all.
    if (manifestText === undefined || code === undefined) {
      report(pluginProblem(name, 'is missing its manifest or its code.'));
      return;
    } else {
      // Both parts are here: parse the manifest before starting any worker for this plugin.
    }

    const read = parsePluginManifest(name, manifestText);

    // A null manifest means the folder's self-description was unusable, so record its own problem and stop rather than start broken code.
    if (read.manifest === null) {
      report(read.problem ?? pluginProblem(name, 'could not be read.'));
      return;
    } else {
      // The manifest parsed: the local copy lets later code treat it as present without re-checking.
    }

    const manifest = read.manifest;

    try {
      const plugin = await startPluginWorker(code, (data: unknown): void => answered(name, data));
      started.set(name, plugin);
      loaded.push({ manifest, registrations: plugin.registrations });
    } catch (error) {
      report(pluginProblem(name, 'did not start. ' + reason(error)));
    }
  }

  return {
    available,
    async load(): Promise<void> {
      // Start from a clean slate every time so reloading never keeps stale workers or records around.
      stopAll();
      loaded = [];
      problems = [];

      // Without the Tauri runtime there is no plugins folder to read, so an unavailable host simply stays empty.
      if (!available) {
        return;
      } else {
        // The runtime is present: gather the list of plugin folders below before starting any of them.
      }

      let names: readonly string[];

      // The folder listing comes from Tauri only when available; a failure here means no plugins can load at all.
      try {
        names = await invoke<string[]>('plugin_names');
      } catch (error) {
        report(pluginProblem('', 'the plugins folder could not be read. ' + reason(error)));
        return;
      }

      // They are started one at a time on purpose, so a slow plugin delays only the ones after it.
      for (const name of names) {
        await begin(name);
      }
    },
    get plugins(): readonly LoadedPlugin[] {
      return loaded;
    },
    get problems(): readonly string[] {
      return problems;
    },
    get syntaxes(): readonly PluginSyntax[] {
      const syntaxes: PluginSyntax[] = [];

      // Walk every loaded plugin and take only the registrations that add a syntax, so non-syntax points never reach the highlighter.
      for (const plugin of loaded) {
        for (const registration of plugin.registrations) {
          if (registration.point === 'syntax') {
            // A syntax registration carries exactly the fields needed to compile and name it; assemble them into a PluginSyntax here.
            syntaxes.push({ id: `${plugin.manifest.id}:${registration.id}`, pattern: registration.pattern, tag: registration.tag, className: registration.className });
          } else {
            // Not a syntax point (command/panel/export): skip it so only highlighter registrations are collected.
          }
        }
      }

      return syntaxes;
    },
    run(pluginId: string, point: 'command' | 'panel' | 'export', id: string, text: string): Promise<PluginAnswer> {
      const plugin = started.get(pluginId);

      // A call to a worker that never started cannot be answered, so reject immediately rather than inventing an entry.
      if (plugin === undefined) {
        return Promise.reject(new Error(`No plugin named "${pluginId}" is running.`));
      } else {
        // The worker exists: open the waiting slot below and send it this call's work.
      }

      const call = nextCall;
      nextCall += 1;

      return new Promise<PluginAnswer>((settle, fail): void => {
        const timer = setTimeout((): void => {
          // A plugin that will not answer is stopped: it is running code of its own, and waiting for ever is not something a reader can undo.
          waiting.delete(call);
          stopPluginWorker(plugin);
          started.delete(pluginId);
          // It is also taken off the list of what loaded. A plugin that is no longer running must stop
          // being offered: a command that can only fail is worse than one that is not there.
          loaded = loaded.filter((entry) => entry.manifest.id !== pluginId);
          report(pluginProblem(pluginId, 'took too long to answer and was stopped.'));
          fail(new Error('The plugin took too long to answer.'));
        }, CALL_MS);

        // The call is now tracked with its settle/fail callbacks and timer before the message goes out.
        waiting.set(call, { settle, fail, timer, plugin: pluginId });

        // Send this one call's work to the worker; answered() will clear the timer and resolve or reject it when a reply arrives.
        plugin.worker.postMessage({ call, point, id, text });
      });
    },
    async folder(): Promise<string> {
      // Without the Tauri runtime there is no plugins folder path to return, so an unavailable host reports empty rather than throwing.
      if (!available) {
        return '';
      } else {
        // The runtime is present: ask it for the plugins folder path below.
      }

      try {
        return await invoke<string>('plugin_folder');
      } catch {
        // A folder that cannot be named reads as no folder, rather than as an error a reader can do nothing about.
        return '';
      }
    },
    destroy(): void {
      // Destroying the host ends every worker and fails any pending call, leaving nothing running behind.
      stopAll();
    },
  };
}
