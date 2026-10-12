/**
 * @file plugin-sandbox.spec.ts
 * @purpose Exercises the sandbox prelude a plugin worker runs inside (FR-14.18) by evaluating the built worker source against a stand-in for `self` and reading out what it posted back.
 * @inputs The string form of a plugin's own file, fed to runPlugin so the real bootstrap/plugin/epilogue script is evaluated; point/id/text triples handed to call.
 * @outputs Nothing observable beyond thrown assertions: each test asserts on fake.posted after running or calling a plugin.
 * @functions
 *   - FakeSelf: stand-in for the worker's own self, holding posted messages and its onmessage listener plus network globals that may be stripped.
 *   - runPlugin: builds the stand-in, evaluates the whole worker source against it, returns the stand-in so tests can inspect what ran.
 *   - call: hands one message to the plugin through fake.onmessage, failing if the plugin never listened.
 *   - lastPosted: reads and type-narrows the most recent posted value into a record for assertions.
 * @dataflow Test-provided plugin text -> runPlugin evaluates bootstrap+plugin+epilogue on FakeSelf -> kdoc registrations / answers land in fake.posted -> call triggers onmessage -> tests read fake.posted via lastPosted or index reads.
 * @controlflow Build stand-in and evaluate script (posts ready) -> optionally dispatch a call through onmessage -> assert against posted entries; every branch ends by comparing posted values to expected shapes.
 * @version 1
 * @date 2026-09-18
 */

import { describe, expect, it } from 'vitest';
import { pluginWorkerSource, PLUGIN_BOOTSTRAP } from '../src/plugins/plugin-sandbox.js';

/** A stand-in for the worker's own `self`, holding what the plugin posted and what it was given. */
interface FakeSelf {
  readonly posted: unknown[];
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  [key: string]: unknown;
}

/** runPlugin builds a stand-in for self, evaluates the whole plugin worker source against it, and returns that stand-in.
 * @purpose Runs the real bootstrap + plugin code + epilogue as one script so tests observe registrations and answers exactly as a worker would produce them.
 * @inputs code - The raw text of a plugin's own file to run inside the sandboxed worker.
 * @outputs FakeSelf - The stand-in self, now carrying posted messages, an onmessage listener, and any globals the prelude stripped.
 * @dataflow Empty stand-in -> pluginWorkerSource(code) evaluated with it as self -> bootstrap strips network, builds kdoc, wires onmessage, epilogue posts ready -> populated stand-in returned.
 * @controlflow Construct fake -> compile script via new Function('self', ...) -> invoke once so the IIFE runs to completion and announces ready; no branching before return.
 */
function runPlugin(code: string): FakeSelf {
  const posted: unknown[] = [];
  const fake: FakeSelf = {
    posted,
    onmessage: null,
    postMessage: (value: unknown): void => {
      posted.push(value);
    },
    // Something for the prelude to take away, so a test can see that it did.
    fetch: (): void => {},
    XMLHttpRequest: (): void => {},
    importScripts: (): void => {},
  };
  // The prelude and the plugin are evaluated the way a worker evaluates them: as one script, with `self` being the only thing they are given.
  const run = new Function('self', pluginWorkerSource(code));
  run(fake);
  return fake;
}

/** call hands one message to the plugin through its onmessage listener.
 * @purpose Drives a registered handler exactly as the worker would, by delivering a { data: {...} } event after the prelude has installed onmessage.
 * @inputs fake - A stand-in already run through runPlugin so that fake.onmessage points at the prelude's responder.
 * @inputs point - The registration kind being invoked ('command', 'panel', or 'export').
 * @inputs id - The identifier of the handler to dispatch to.
 * @inputs text - The payload handed to the handler as call.text.
 * @outputs void - No return; the effect is a new entry appended to fake.posted by postMessage.
 * @dataflow { point, id, text } -> wrapped in { data: {...} } -> delivered to onmessage -> prelude resolves handler and posts an answer or failure.
 * @controlflow When onmessage is null return early with an Error (the plugin never listened); otherwise invoke it once with the shaped event.
 */
function call(fake: FakeSelf, point: string, id: string, text: string): void {
  if (fake.onmessage === null) {
    // The prelude always installs onmessage; reaching here means a broken script failed to wire up its responder.
    throw new Error('the plugin never listened for messages');
  }
  fake.onmessage({ data: { call: 1, point, id, text } });
}

/** lastPosted returns the most recently posted value as a record after narrowing it out of unknown.
 * @purpose Gives tests a typed handle on the newest post without exposing an untyped index read to expect assertions.
 * @inputs fake - A stand-in whose posted array holds everything the plugin has sent back so far.
 * @outputs Record<string, unknown> - The last posted value, guaranteed present and object-shaped or an Error is thrown.
 * @dataflow fake.posted[length-1] -> narrowed to a non-null object -> reinterpreted as a record for property assertions.
 * @controlflow Read the trailing index; if it is missing, not an object, or null throw (nothing was posted); otherwise return it cast to Record<string, unknown>.
 */
function postedAt(fake: FakeSelf, index: number): Record<string, unknown> {
  const entry = fake.posted[index];

  // Check whether anything was posted at that point at all.
  if (typeof entry !== 'object' || entry === null) {
    throw new Error(`nothing was posted at ${index}`);
  } else {
    // Something was: read it as the record every message is.
  }

  return entry as Record<string, unknown>;
}

function lastPosted(fake: FakeSelf): Record<string, unknown> {
  const last = fake.posted[fake.posted.length - 1]; // Trailing post; index access yields a possibly-absent entry under noUncheckedIndexedAccess.
  if (typeof last !== 'object' || last === null) {
    // Nothing was posted yet, so there is nothing to assert against as a record.
    throw new Error('nothing was posted');
  }
  return last as Record<string, unknown>;
}

describe('the plugin sandbox', () => {
  // An empty plugin still announces readiness with an empty registration set rather than failing to load.
  it('an unregistered plugin posts a ready carrying no registrations', () => {
    const fake = runPlugin('');
    expect(fake.posted.length).toBe(1);
    expect(postedAt(fake, 0).kind).toBe('ready');
    expect(postedAt(fake, 0).registrations).toEqual([]);
  });

  // A single command registration surfaces in the ready message with its point, id and label intact.
  it('a registered command appears in the ready set', () => {
    const fake = runPlugin("kdoc.command('go', 'Go', function () { return 'x'; });");
    expect(postedAt(fake, 0).kind).toBe('ready');
    expect(postedAt(fake, 0).registrations).toEqual([
      { point: 'command', id: 'go', label: 'Go' },
    ]);
  });

  // All four registration kinds survive one plugin and report their canonical points in order.
  it('all four points register with their expected point names', () => {
    const fake = runPlugin(
      "kdoc.command('c', 'C', function () {});" +
        "kdoc.panel('p', 'P', function () {});" +
        "kdoc.exportAs('e', 'E', 'ext', function (t) { return t; });" +
        "kdoc.syntax('s', /x/, 'tag', 'cls');",
    );
    const registrations = postedAt(fake, 0).registrations as Array<Record<string, unknown>>;
    expect(registrations).toHaveLength(4);
    expect(registrations.map((entry) => entry.point)).toEqual(['command', 'panel', 'export', 'syntax']);
  });

  // A command returning a bare string sends that string back as text with no status message.
  it('a command answering with a string posts answer text and null message', () => {
    const fake = runPlugin("kdoc.command('go', 'Go', function () { return 'NEW'; });");
    call(fake, 'command', 'go', '');
    expect(lastPosted(fake).kind).toBe('answer');
    expect(lastPosted(fake).text).toBe('NEW');
    expect(lastPosted(fake).message).toBeNull();
  });

  // A command returning an object carries both its text and a status message when each is real text.
  it('a command answering with an object posts text and message', () => {
    const fake = runPlugin("kdoc.command('go', 'Go', function () { return { text: 'T', message: 'M' }; });");
    call(fake, 'command', 'go', '');
    expect(lastPosted(fake).kind).toBe('answer');
    expect(lastPosted(fake).text).toBe('T');
    expect(lastPosted(fake).message).toBe('M');
  });

  // A command returning nothing sends back null text and null message rather than failing.
  it('a command answering with undefined posts null text and null message', () => {
    const fake = runPlugin("kdoc.command('go', 'Go', function () { return undefined; });");
    call(fake, 'command', 'go', '');
    expect(lastPosted(fake).kind).toBe('answer');
    expect(lastPosted(fake).text).toBeNull();
    expect(lastPosted(fake).message).toBeNull();
  });

  // A command answering with a non-string scalar sends back null text and null message.
  it('a command answering with an odd value posts null text and null message', () => {
    const fake = runPlugin("kdoc.command('go', 'Go', function () { return 7; });");
    call(fake, 'command', 'go', '');
    expect(lastPosted(fake).kind).toBe('answer');
    expect(lastPosted(fake).text).toBeNull();
    expect(lastPosted(fake).message).toBeNull();
  });

  // A command is handed the document text and may transform it before answering.
  it('a command receives its input text and can answer with a transformed value', () => {
    const fake = runPlugin("kdoc.command('go', 'Go', function (t) { return t.toUpperCase(); });");
    call(fake, 'command', 'go', 'hello');
    expect(lastPosted(fake).kind).toBe('answer');
    expect(lastPosted(fake).text).toBe('HELLO');
  });

  // A handler that throws is reported as a failure carrying the thrown message rather than dying silently.
  it('a command that throws posts a failure naming why', () => {
    const fake = runPlugin("kdoc.command('go', 'Go', function () { throw new Error('no'); });");
    call(fake, 'command', 'go', '');
    expect(lastPosted(fake).kind).toBe('failed');
    expect(String(lastPosted(fake).reason)).toContain('no');
  });

  // Calling a point/id that was never registered fails instead of answering with nothing.
  it('a call to an unregistered handler posts a failure', () => {
    const fake = runPlugin('');
    call(fake, 'command', 'nothing', '');
    expect(lastPosted(fake).kind).toBe('failed');
  });

  // Proves a call to something never registered is reported as such, not as a handler that broke: without
  // the second assertion a handler that was called and threw would look exactly the same.
  it('a call to nothing says it is nothing, not that it broke', () => {
    const fake = runPlugin('');
    call(fake, 'command', 'nothing', '');

    expect(lastPosted(fake).kind).toBe('failed');
    expect(String(lastPosted(fake).reason)).toContain('nothing registered');
  });

  // A panel is invoked exactly like a command and its rendered value comes back as answer text.
  it('a panel called like a command returns its rendered text', () => {
    const fake = runPlugin("kdoc.panel('p', 'P', function () { return 'shown'; });");
    call(fake, 'panel', 'p', '');
    expect(lastPosted(fake).kind).toBe('answer');
    expect(lastPosted(fake).text).toBe('shown');
  });

  // An export converter is invoked like a command and returns its converted text.
  it('an export called like a command returns its converted value', () => {
    const fake = runPlugin("kdoc.exportAs('csv', 'CSV', 'csv', function (t) { return t + '!'; });");
    call(fake, 'export', 'csv', 'a');
    expect(lastPosted(fake).kind).toBe('answer');
    expect(lastPosted(fake).text).toBe('a!');
  });

  // The prelude strips the plugin's way out to the network by nulling those globals on self.
  it('the prelude takes away fetch, XMLHttpRequest and importScripts', () => {
    const fake = runPlugin('');
    expect(fake.fetch).toBeUndefined();
    expect(fake.XMLHttpRequest).toBeUndefined();
    expect(fake.importScripts).toBeUndefined();
  });

  // The prelude keeps its own bookkeeping inside the IIFE so it never leaks onto self.
  it('the prelude keeps registrations and handlers off of self', () => {
    const fake = runPlugin("kdoc.command('go', 'Go', function () {});");
    expect(fake.registrations).toBeUndefined();
    expect(fake.handlers).toBeUndefined();
  });

  // The bootstrap source names the network globals it removes, documenting what was taken away.
  it('the bootstrap lists the network globals it strips', () => {
    expect(PLUGIN_BOOTSTRAP).toContain('fetch');
    expect(PLUGIN_BOOTSTRAP).toContain('XMLHttpRequest');
    expect(PLUGIN_BOOTSTRAP).toContain('importScripts');
  });
});
