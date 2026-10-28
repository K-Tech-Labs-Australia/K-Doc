// @vitest-environment jsdom
/**
 * @file mermaid-renderer.test.ts
 * @purpose Comprehensive unit test suite for the Mermaid diagram renderer module (mermaid-renderer.ts).
 * @inputs Diagram source strings, themes ('light' | 'dark'), and mock MermaidApi instances.
 * @outputs Vitest test assertions verifying language checking, data URI encoding, serial rendering queue, error truncations, loader caching, and DOM cleanup.
 * @functions
 *   - createDeferred: Test helper creating a controllable deferred promise handle.
 *   - createMockMermaidApi: Test helper creating a spy-backed MermaidApi mock.
 * @dataflow Test inputs -> createMermaidRenderer / helper functions -> DiagramResult -> Vitest assertions.
 * @controlflow Isolated Vitest describe/it suites executing distinct test scenarios.
 * @version 1
 * @date 2026-10-28
 */

import { describe, expect, it, vi } from 'vitest';
import type {
  MermaidApi,
  MermaidConfigSubset,
  MermaidLoader,
} from './mermaid-renderer.js';
import {
  createMermaidRenderer,
  isMermaidLanguage,
  MAX_ERROR_LENGTH,
  renderMermaid,
  svgToDataUri,
} from './mermaid-renderer.js';

interface MockMermaidApi extends MermaidApi {
  initialize: ReturnType<typeof vi.fn<(config: MermaidConfigSubset) => void>>;
  render: ReturnType<typeof vi.fn<(id: string, text: string) => Promise<{ readonly svg: string }>>>;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

/**
 * Creates a controllable deferred promise handle.
 * @purpose Decouples promise creation from resolution for precise concurrency and queuing verification.
 * @inputs None.
 * @outputs Deferred<T> - An object wrapping the promise along with its resolve and reject callbacks.
 * @dataflow Instantiates Promise -> extracts executor handles -> packages into Deferred container.
 * @controlflow Captures resolve and reject references synchronously within the Promise executor.
 */
function createDeferred<T>(): Deferred<T> {
  let resolveHandle!: (value: T) => void;
  let rejectHandle!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    // Store executor handles for external invocation.
    resolveHandle = resolve;
    rejectHandle = reject;
  });

  return {
    promise,
    resolve: resolveHandle,
    reject: rejectHandle,
  };
}

/**
 * Creates a mock MermaidApi implementation with Vitest mock spies.
 * @purpose Provides a controllable MermaidApi instance without importing the actual mermaid library.
 * @inputs defaultSvg?: string - Optional default SVG markup resolved by render.
 * @outputs MockMermaidApi - Mocked API object with spyable initialize and render methods.
 * @dataflow Pre-configures mock methods -> returns typed MockMermaidApi object.
 * @controlflow Builds spy methods; configures render mock to resolve with default or provided SVG.
 */
function createMockMermaidApi(defaultSvg = '<svg>diagram</svg>'): MockMermaidApi {
  return {
    initialize: vi.fn<(config: MermaidConfigSubset) => void>(),
    render: vi.fn<(id: string, text: string) => Promise<{ readonly svg: string }>>().mockResolvedValue({
      svg: defaultSvg,
    }),
  };
}

describe('isMermaidLanguage', () => {
  it('returns true for exact and whitespace-padded "mermaid" variations regardless of case', () => {
    // Check exact lowercase match.
    expect(isMermaidLanguage('mermaid')).toBe(true);

    // Check trimmed match with surrounding whitespace.
    expect(isMermaidLanguage(' Mermaid ')).toBe(true);

    // Check uppercase variation.
    expect(isMermaidLanguage('MERMAID')).toBe(true);

    // Check mixed case with newline and tabs.
    expect(isMermaidLanguage(' \tMerMaid\n ')).toBe(true);
  });

  it('returns false for non-mermaid strings and non-string types', () => {
    // Check non-mermaid identifier strings.
    expect(isMermaidLanguage('js')).toBe(false);
    expect(isMermaidLanguage('typescript')).toBe(false);
    expect(isMermaidLanguage('mermaid-js')).toBe(false);

    // Check empty or pure whitespace strings.
    expect(isMermaidLanguage('')).toBe(false);
    expect(isMermaidLanguage('   ')).toBe(false);

    // Check null and undefined values.
    expect(isMermaidLanguage(null)).toBe(false);
    expect(isMermaidLanguage(undefined)).toBe(false);

    // Check numbers, booleans, and objects.
    expect(isMermaidLanguage(3)).toBe(false);
    expect(isMermaidLanguage(true)).toBe(false);
    expect(isMermaidLanguage(false)).toBe(false);
    expect(isMermaidLanguage({})).toBe(false);
    expect(isMermaidLanguage([])).toBe(false);
  });
});

describe('svgToDataUri', () => {
  it('converts SVG markup into a UTF-8 data URI string', () => {
    const input = '<svg a="1"/>';
    const expected = 'data:image/svg+xml;charset=utf-8,%3Csvg%20a%3D%221%22%2F%3E';
    expect(svgToDataUri(input)).toBe(expected);
  });

  it('properly URI-encodes special characters, attributes, and tags in SVG content', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg"><text># & < > "</text></svg>';
    const expected = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(input)}`;
    expect(svgToDataUri(input)).toBe(expected);
  });
});

describe('MAX_ERROR_LENGTH', () => {
  it('exports the constant MAX_ERROR_LENGTH with value 500', () => {
    expect(MAX_ERROR_LENGTH).toBe(500);
  });
});

describe('createMermaidRenderer', () => {
  it('returns an error result for empty or whitespace-only source without invoking the loader', async () => {
    const mockLoader = vi.fn<MermaidLoader>();
    const renderer = createMermaidRenderer(mockLoader, document);

    // Check completely empty string.
    const emptyResult = await renderer('', 'light');
    expect(emptyResult).toEqual({ ok: false, message: 'The diagram is empty.' });

    // Check string containing only spaces, tabs, and newlines.
    const whitespaceResult = await renderer('   \t\n  ', 'dark');
    expect(whitespaceResult).toEqual({ ok: false, message: 'The diagram is empty.' });

    // Ensure the loader was never triggered for empty inputs.
    expect(mockLoader).not.toHaveBeenCalled();
  });

  it('renders a diagram successfully with light theme mapped to default', async () => {
    const mockApi = createMockMermaidApi('<svg>light-diagram</svg>');
    const mockLoader = vi.fn<MermaidLoader>().mockResolvedValue(mockApi);
    const renderer = createMermaidRenderer(mockLoader, document);

    const result = await renderer('graph TD; A-->B;', 'light');

    // Verify successful diagram payload.
    expect(result).toEqual({ ok: true, svg: '<svg>light-diagram</svg>' });

    // Verify Mermaid initialization config with 'default' theme for light mode.
    expect(mockApi.initialize).toHaveBeenCalledTimes(1);
    expect(mockApi.initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      suppressErrorRendering: true,
    });

    // Verify render was called with first id and source.
    expect(mockApi.render).toHaveBeenCalledWith('kdoc-mermaid-1', 'graph TD; A-->B;');
  });

  it('renders a diagram successfully with dark theme mapped to dark', async () => {
    const mockApi = createMockMermaidApi('<svg>dark-diagram</svg>');
    const mockLoader = vi.fn<MermaidLoader>().mockResolvedValue(mockApi);
    const renderer = createMermaidRenderer(mockLoader, document);

    const result = await renderer('graph TD; C-->D;', 'dark');

    // Verify successful diagram payload.
    expect(result).toEqual({ ok: true, svg: '<svg>dark-diagram</svg>' });

    // Verify Mermaid initialization config with 'dark' theme for dark mode.
    expect(mockApi.initialize).toHaveBeenCalledTimes(1);
    expect(mockApi.initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      suppressErrorRendering: true,
    });

    expect(mockApi.render).toHaveBeenCalledWith('kdoc-mermaid-1', 'graph TD; C-->D;');
  });

  it('calls the loader only once across multiple render calls', async () => {
    const mockApi = createMockMermaidApi();
    const mockLoader = vi.fn<MermaidLoader>().mockResolvedValue(mockApi);
    const renderer = createMermaidRenderer(mockLoader, document);

    const firstResult = await renderer('graph TD; A-->B;', 'light');
    const secondResult = await renderer('graph TD; B-->C;', 'dark');

    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);

    // Loader should be cached and called only on the first diagram render.
    expect(mockLoader).toHaveBeenCalledTimes(1);
  });

  it('returns parse error message when render rejects with an Error instance', async () => {
    const mockApi = createMockMermaidApi();
    mockApi.render.mockRejectedValueOnce(new Error('Parse error on line 2'));
    const mockLoader = vi.fn<MermaidLoader>().mockResolvedValue(mockApi);
    const renderer = createMermaidRenderer(mockLoader, document);

    const result = await renderer('invalid syntax', 'light');

    expect(result).toEqual({ ok: false, message: 'Parse error on line 2' });
  });

  it('returns stringified message when render rejects with a non-Error object', async () => {
    const mockApi = createMockMermaidApi();
    mockApi.render.mockRejectedValueOnce('x');
    const mockLoader = vi.fn<MermaidLoader>().mockResolvedValue(mockApi);
    const renderer = createMermaidRenderer(mockLoader, document);

    const result = await renderer('invalid syntax', 'light');

    expect(result).toEqual({ ok: false, message: 'x' });
  });

  it('returns fallback message when render rejects with empty or whitespace-only error message', async () => {
    const mockApi = createMockMermaidApi();
    mockApi.render.mockRejectedValueOnce(new Error('   '));
    mockApi.render.mockRejectedValueOnce(new Error(''));
    const mockLoader = vi.fn<MermaidLoader>().mockResolvedValue(mockApi);
    const renderer = createMermaidRenderer(mockLoader, document);

    const result1 = await renderer('syntax error 1', 'light');
    expect(result1).toEqual({ ok: false, message: 'The diagram could not be drawn.' });

    const result2 = await renderer('syntax error 2', 'light');
    expect(result2).toEqual({ ok: false, message: 'The diagram could not be drawn.' });
  });

  it('truncates long error messages exceeding MAX_ERROR_LENGTH with an ellipsis', async () => {
    const mockApi = createMockMermaidApi();
    const rawError = 'E'.repeat(600);
    mockApi.render.mockRejectedValueOnce(new Error(rawError));
    const mockLoader = vi.fn<MermaidLoader>().mockResolvedValue(mockApi);
    const renderer = createMermaidRenderer(mockLoader, document);

    const result = await renderer('invalid syntax', 'light');

    // Check that result is an error.
    if (result.ok) {
      // Unexpected success: fail test immediately.
      expect.unreachable('Expected rendering to fail on rejected promise');
    } else {
      // Expected failure: check that message was truncated to 500 characters plus ellipsis.
      expect(result.message).toBe(`${'E'.repeat(MAX_ERROR_LENGTH)}…`);
      expect(result.message.length).toBe(MAX_ERROR_LENGTH + 1);
    }
  });

  it('retries loader on subsequent call when initial loader call rejects', async () => {
    const mockApi = createMockMermaidApi('<svg>recovered</svg>');
    const mockLoader = vi
      .fn<MermaidLoader>()
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValueOnce(mockApi);
    const renderer = createMermaidRenderer(mockLoader, document);

    // First attempt fails during loader execution.
    const result1 = await renderer('graph TD; A-->B;', 'light');
    expect(result1.ok).toBe(false);

    // Verify error prefix when diagram library fails to load.
    if (result1.ok) {
      // Unexpected success.
      expect.unreachable('Expected first render to fail when loader rejects');
    } else {
      // Expected loader failure message structure.
      expect(result1.message.startsWith('Diagrams could not be loaded: ')).toBe(true);
      expect(result1.message).toBe('Diagrams could not be loaded: Network failure');
    }

    // Second attempt should re-invoke loader and succeed.
    const result2 = await renderer('graph TD; A-->B;', 'light');
    expect(result2).toEqual({ ok: true, svg: '<svg>recovered</svg>' });

    // Loader was called twice: once for failure, once for recovery.
    expect(mockLoader).toHaveBeenCalledTimes(2);
  });

  it('executes renders serially, waiting for the active render to complete before starting the next', async () => {
    const deferred = createDeferred<{ readonly svg: string }>();
    const mockApi = createMockMermaidApi();
    mockApi.render
      .mockImplementationOnce(() => deferred.promise)
      .mockResolvedValueOnce({ svg: '<svg>second</svg>' });

    const mockLoader = vi.fn<MermaidLoader>().mockResolvedValue(mockApi);
    const renderer = createMermaidRenderer(mockLoader, document);

    // Launch both render promises concurrently without awaiting.
    const firstCall = renderer('graph 1', 'light');
    const secondCall = renderer('graph 2', 'dark');

    // Yield control to allow microtasks and the first render invocation to proceed.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    // The first render is awaiting resolution; the second must still be waiting in the serial queue.
    expect(mockApi.render.mock.calls.length).toBe(1);

    // Resolve the first render's deferred promise.
    deferred.resolve({ svg: '<svg>first</svg>' });

    // Await both calls now that the queue has unblocked.
    const [result1, result2] = await Promise.all([firstCall, secondCall]);

    // Both renders should have executed sequentially.
    expect(mockApi.render.mock.calls.length).toBe(2);
    expect(result1).toEqual({ ok: true, svg: '<svg>first</svg>' });
    expect(result2).toEqual({ ok: true, svg: '<svg>second</svg>' });
  });

  it('removes leftover scratch and container elements from document body even on render failure', async () => {
    const mockApi = createMockMermaidApi();
    mockApi.render.mockImplementationOnce(async (id: string) => {
      // Mermaid render artifact simulation: scratch element and temporary d<id> container.
      const scratch = document.createElement('div');
      scratch.id = id;
      document.body.appendChild(scratch);

      const leftover = document.createElement('div');
      leftover.id = `d${id}`;
      document.body.appendChild(leftover);

      throw new Error('Diagram render parse failure');
    });

    const mockLoader = vi.fn<MermaidLoader>().mockResolvedValue(mockApi);
    const renderer = createMermaidRenderer(mockLoader, document);

    const result = await renderer('graph TD; X-->Y;', 'light');
    expect(result.ok).toBe(false);

    // Both temporary elements must be cleaned up in the finally block.
    expect(document.getElementById('kdoc-mermaid-1')).toBeNull();
    expect(document.getElementById('dkdoc-mermaid-1')).toBeNull();
  });

  it('removes leftover scratch and container elements from document body on successful render', async () => {
    const mockApi = createMockMermaidApi();
    mockApi.render.mockImplementationOnce(async (id: string) => {
      const scratch = document.createElement('div');
      scratch.id = id;
      document.body.appendChild(scratch);

      const leftover = document.createElement('div');
      leftover.id = `d${id}`;
      document.body.appendChild(leftover);

      return { svg: '<svg>success</svg>' };
    });

    const mockLoader = vi.fn<MermaidLoader>().mockResolvedValue(mockApi);
    const renderer = createMermaidRenderer(mockLoader, document);

    const result = await renderer('graph TD; A-->B;', 'light');
    expect(result.ok).toBe(true);

    // Elements should be removed after successful render as well.
    expect(document.getElementById('kdoc-mermaid-1')).toBeNull();
    expect(document.getElementById('dkdoc-mermaid-1')).toBeNull();
  });

  it('increments render id counter sequentially across successive calls', async () => {
    const mockApi = createMockMermaidApi();
    const mockLoader = vi.fn<MermaidLoader>().mockResolvedValue(mockApi);
    const renderer = createMermaidRenderer(mockLoader, document);

    await renderer('graph 1', 'light');
    await renderer('graph 2', 'light');
    await renderer('graph 3', 'dark');

    expect(mockApi.render.mock.calls[0]?.[0]).toBe('kdoc-mermaid-1');
    expect(mockApi.render.mock.calls[1]?.[0]).toBe('kdoc-mermaid-2');
    expect(mockApi.render.mock.calls[2]?.[0]).toBe('kdoc-mermaid-3');
  });
});

describe('renderMermaid', () => {
  it('is exported as a DiagramRenderer function', () => {
    expect(typeof renderMermaid).toBe('function');
  });

  it('safely handles empty source diagram without loading mermaid', async () => {
    const result = await renderMermaid('   ', 'light');
    expect(result).toEqual({ ok: false, message: 'The diagram is empty.' });
  });
});
