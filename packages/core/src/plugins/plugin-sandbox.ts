/**
 * @file plugin-sandbox.ts
 * @purpose Builds the source of a plugin worker: the sandbox prelude, the untouched plugin code, and the ready epilogue (FR-14.18).
 * @inputs The raw text of a plugin's own file to run inside the worker.
 * @outputs A single string that is everything a plugin worker evaluates, plus the two fixed pieces it wraps around that code.
 * @functions
 *   - PLUGIN_BOOTSTRAP: template literal holding the prelude that strips network access and builds the kdoc API on self.
 *   - PLUGIN_EPILOGUE: one line calling the ready function the prelude left behind so the worker announces its registrations.
 *   - pluginWorkerSource: joins bootstrap, plugin code, and epilogue into the whole of what a plugin worker runs.
 * @dataflow Plugin source string -> wrapped between bootstrap and epilogue by pluginWorkerSource -> single worker-evaluated script.
 * @controlflow Assemble prelude first (network taken away, API built), then insert plugin code untouched, then append ready call; no rewriting of the middle occurs.
 * @version 1
 * @date 2026-09-18
 */

/** The prelude a plugin worker runs before its own file: it takes network access away and builds the kdoc API on self (FR-14.18).
 * @purpose Gives every plugin one identical sandbox so none can reach DOM, filesystem or network, leaving only what reading the document and answering requires.
 * @inputs nothing - this is static source text evaluated inside a worker with no DOM, filesystem or network of its own.
 * @outputs A template-literal string of ES5-style JavaScript that becomes the head of every plugin worker script.
 * @dataflow Written JS source -> held verbatim in PLUGIN_BOOTSTRAP -> placed before the plugin code by pluginWorkerSource.
 * @controlflow IIFE opens, network globals are set to undefined, kdoc API is built on self, onmessage answers calls, __kdocReady is left for the epilogue, then the IIFE closes so registrations and handlers stay private.
 */
export const PLUGIN_BOOTSTRAP: string = `
(function () {
  // A worker has no DOM and no filesystem already; this is what takes its way out to the network away as well, so a plugin can read the document it is given and answer, and do nothing else.
  var taken = ['fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'indexedDB', 'caches',
               'Worker', 'SharedWorker', 'EventSource', 'BroadcastChannel', 'Notification',
               'WebTransport', 'WebSocketStream', 'RTCPeerConnection', 'RTCDataChannel', 'FileSystemHandle',
               'navigator'];
  for (var i = 0; i < taken.length; i++) {
    try { self[taken[i]] = undefined; } catch (error) { /* a read-only global cannot be set to undefined, so it is left as the worker had it */ }
  }

  var registrations = [];
  var handlers = { command: {}, panel: {}, export: {} };
  function add(point, id, entry, run) { registrations.push(entry); if (run) { handlers[point][id] = run; } }
  self.kdoc = {
    command: function (id, label, run) { add('command', id, { point: 'command', id: id, label: label }, run); },
    panel: function (id, title, render) { add('panel', id, { point: 'panel', id: id, title: title }, render); },
    exportAs: function (id, name, extension, convert) { add('export', id, { point: 'export', id: id, name: name, extension: extension }, convert); },
    syntax: function (id, pattern, tag, className) { add('syntax', id, { point: 'syntax', id: id, pattern: pattern, tag: tag, className: className }, null); }
  };

  self.onmessage = function (event) {
    var call = event.data;
    var group = handlers[call.point];
    var handler = group ? group[call.id] : null;
    // When no handler is registered under this id, fail the call rather than answering with nothing.
    if (typeof handler !== 'function') {
      self.postMessage({ kind: 'failed', call: call.call, reason: 'nothing registered under that name' });
      return;
    }
    try {
      var answer = handler(call.text);
      // A string is the whole of what a plugin wants to send back as text.
      if (typeof answer === 'string') {
        self.postMessage({ kind: 'answer', call: call.call, text: answer, message: null });
      } else if (answer !== null && typeof answer === 'object') {
        // An object carries an optional text and a status message, each kept only when it is real text.
        self.postMessage({ kind: 'answer', call: call.call, text: typeof answer.text === 'string' ? answer.text : null, message: typeof answer.message === 'string' ? answer.message : null });
      } else {
        // Answered with nothing at all: a plugin that does nothing has done nothing, which is allowed.
        self.postMessage({ kind: 'answer', call: call.call, text: null, message: null });
      }
    } catch (error) {
      // A handler threw: report the failure rather than letting it die silently in the worker.
      self.postMessage({ kind: 'failed', call: call.call, reason: String(error && error.message || error) });
    }
  };

  self.__kdocReady = function () { self.postMessage({ kind: 'ready', registrations: registrations }); };
})();

// A worker's self IS its global object, so the assignment above already puts kdoc within reach of the
// plugin. Naming it here as well means the prelude does not depend on that being true, which is what
// lets the whole of it be run and tested outside a worker.
var kdoc = self.kdoc;
`;

/** The epilogue a plugin worker runs after its own file: it posts the ready message (FR-14.18).
 * @purpose Calls the __kdocReady function the prelude left behind so the whole set of registrations is announced once the plugin has finished declaring them.
 * @inputs nothing - this is static source text evaluated at the very end of a plugin worker script.
 * @outputs A single-line string that becomes the tail of every plugin worker script.
 * @dataflow Written JS source -> held verbatim in PLUGIN_EPILOGUE -> placed after the plugin code by pluginWorkerSource.
 * @controlflow Invoking __kdocReady reads registrations from the prelude closure and posts one ready message carrying them all.
 */
export const PLUGIN_EPILOGUE: string = `
// The plugin registered everything it is going to by the time its own file has finished running, so announce that set now.
self.__kdocReady();
`;

/** Builds the whole of what a plugin worker runs (FR-14.18).
 * @purpose Wraps the untouched plugin code between the sandbox prelude and the ready epilogue into one script string.
 * @inputs code - The raw text of a plugin's own file to run inside the worker, inserted verbatim in the middle.
 * @outputs string - PLUGIN_BOOTSTRAP followed by the plugin code followed by PLUGIN_EPILOGUE, joined with newlines.
 * @dataflow Bootstrap prelude -> plugin source unchanged -> ready epilogue -> one concatenated worker script.
 * @controlflow Concatenate the three pieces in order using newline separators; the middle is never rewritten so a wrong rewrite cannot replace the sandbox it already lives inside.
 */
export function pluginWorkerSource(code: string): string {
  // The prelude strips network access and builds the API, then runs before the plugin's own code.
  const head = PLUGIN_BOOTSTRAP;

  // The plugin source goes in the middle untouched: K-Doc does not rewrite it, because a rewrite it got wrong would be worse than the sandbox it is already inside.
  const body = code;

  // The epilogue runs last and posts the ready message carrying every registration the plugin made.
  const tail = PLUGIN_EPILOGUE;

  return [head, body, tail].join('\n');
}
