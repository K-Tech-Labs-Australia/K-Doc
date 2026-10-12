/**
 * @file keymap-service.ts
 * @purpose Installs a single capture-phase document keydown listener that dispatches K-Doc's remappable shortcuts from the resolved keymap (FR-14.16) and, for Word-only shortcuts K-Doc leaves unbound, emits an explanation instead of doing nothing (FR-20.1).
 * @inputs A KeyboardEvent on every keypress; a () => ResolvedKeymap read per key so changed bindings apply immediately; a () => KeymapCommand[] read only when a key matched; scopeOf and contextOf for scoping decisions; explanations keyed by canonical chord; an explain sink for user-facing messages.
 * @outputs void side effects: preventDefault/stopPropagation to claim keys, command.run() to execute bound commands, or explain() to describe unbound Word shortcuts.
 * @functions
 *   - installKeymapService: Wires the capture-phase keydown listener and returns a service handle.
 *   - onKeyDown: Dispatches a single keydown event to a shortcut command or an explanation.
 *   - setSuspended: Toggles suspension so a dialog can record a shortcut without handling keys.
 *   - destroy: Removes the keydown listener; safe to call more than once.
 * @dataflow KeyboardEvent → chordFromEvent → keymap.commandForChord lookup → scopeAllows gate → command.run() or explanation via explain().
 * @controlflow Capture-phase listener runs before any editor sees the key; early-returns on suspend/destroy/prevented/unparsed chords; claims a matched, scoped, runnable binding by preventing default and stopping propagation.
 * @version 1
 * @date 2026-09-15
 */

import { chordFromEvent, type KeymapScope, type ResolvedKeymap } from '@k-doc/config';
import { scopeAllows, type FocusContext } from './keymap-scope.js';

export interface KeymapCommand { readonly id: string; run(): boolean; }

export interface KeymapServiceOptions {
  readonly doc: Document;
  /** The keymap in effect, read on every key so a changed binding applies at once. */
  readonly keymap: () => ResolvedKeymap;
  /** The commands that can run, read only when a key matched. */
  readonly commands: () => readonly KeymapCommand[];
  readonly scopeOf: (commandId: string) => KeymapScope | null;
  readonly contextOf: (target: EventTarget | null) => FocusContext;
  /** Explanations for Word shortcuts K-Doc leaves unbound, by canonical chord (FR-20.1). */
  readonly explanations: Readonly<Record<string, string>>;
  readonly explain: (message: string) => void;
}

export interface KeymapService {
  /** While suspended no key is handled, so a dialog can record a shortcut. */
  setSuspended(suspended: boolean): void;
  destroy(): void;
}

/**
 * @purpose Installs the one keydown listener that dispatches remappable shortcuts (FR-14.16) and explains unbound Word ones (FR-20.1).
 * @inputs options - The document, keymap and command providers, scope and focus lookups, and the explanation sink.
 * @outputs KeymapService - A handle to suspend key handling while a shortcut is recorded, and to remove the listener.
 * @dataflow keydown -> chord -> keymap -> scope check -> command.run(), or an explanation.
 * @controlflow Register a capture-phase listener -> return the handle.
 */
export function installKeymapService(options: KeymapServiceOptions): KeymapService {
  let suspended = false;
  let destroyed = false;

  // onKeyDown dispatches one keydown event to a remappable shortcut command or, for an unbound Word shortcut, to an explanation.
  // @purpose Runs K-Doc's remappable shortcuts from the current keymap (FR-14.16) and explains Word-only shortcuts that do nothing (FR-20.1).
  // @inputs event - The KeyboardEvent dispatched by the browser on a capture-phase document keydown.
  // @outputs void - No return value; produces side effects only: claiming the key via preventDefault/stopPropagation, running a command, or emitting an explanation.
  // @dataflow event → chordFromEvent → keymap.commandForChord lookup → scopeAllows gate → command.run() or explain().
  // @controlflow Early-returns on suspend/destroy/prevented/unparsed chords; claims a matched, scoped, runnable binding by preventing default and stopping propagation in the capture phase.
  function onKeyDown(event: KeyboardEvent): void {
    // A key another handler already claimed, or any key while a shortcut is being recorded, is left alone.
    if (suspended || destroyed || event.defaultPrevented) { return; } else { /* ours to consider */ }
    const chord = chordFromEvent(event);
    // Typing and bare modifiers are not chords.
    if (chord === null) { return; } else { /* a chord */ }
    const context = options.contextOf(event.target);
    const commandId = options.keymap().commandForChord.get(chord);
    if (commandId === undefined) {
      const explanation = options.explanations[chord];
      // A Word shortcut with no K-Doc meaning says why rather than doing nothing, except in a text field, where the key may mean something to the field.
      if (explanation !== undefined && context !== 'field') { event.preventDefault(); options.explain(explanation); } else { /* not a shortcut K-Doc knows */ }
      return;
    } else { /* bound to a command */ }
    const scope = options.scopeOf(commandId);
    // A command may only run where its scope allows; otherwise the key goes on to whatever has focus.
    if (scope === null || !scopeAllows(scope, context, chord)) { return; } else { /* allowed here */ }
    const command = options.commands().find((candidate) => candidate.id === commandId);
    // A binding for a command the app does not offer right now does nothing.
    if (command === undefined) { return; } else { /* runnable */ }
    // Claimed before running and stopped in the capture phase, so neither the browser nor an editor's own keymap acts on it too.
    event.preventDefault();
    event.stopPropagation();
    command.run();
  }

  // Capture phase on the document, so the keymap decides before either editor sees the key.
  options.doc.addEventListener('keydown', onKeyDown, true);

  return {
    // setSuspended toggles suspension so a dialog can record a shortcut without any key being handled.
    // @purpose Enables or disables all key handling by the service.
    // @inputs next - True to stop handling keys (recording), false to resume.
    // @outputs void - No return value; mutates the suspended flag read by onKeyDown.
    // @dataflow next → suspended flag → onKeyDown early-return gate.
    // @controlflow Assigns next directly; no branching required.
    setSuspended(next: boolean): void { suspended = next; },
    destroy(): void {
      // Destroying twice is harmless.
      if (destroyed) { return; } else { destroyed = true; }
      options.doc.removeEventListener('keydown', onKeyDown, true);
    },
  };
}