// @vitest-environment jsdom
/**
 * @file mermaid-view.test.ts
 * @purpose Comprehensive unit test suite for the Mermaid diagram ProseMirror node view and caret focus plugin.
 * @inputs ProseMirror EditorState instances, Transactions, EditorView instances, DOM events, and mock DiagramRenderer implementations.
 * @outputs Vitest test assertions verifying mermaid block caret detection, focus plugin decorations, node view rendering, debounced updates, theme reactivity, error states, and DOM lifecycle cleanup.
 * @functions
 *   - createDeferred: Test helper creating a controllable deferred promise handle.
 *   - createTestDoc: Test helper constructing a ProseMirror test document with codeBlock and paragraph nodes.
 * @dataflow EditorState & EditorView -> MermaidView / PlainCodeBlockView / focus plugin -> DOM mutations & renderer calls -> Vitest assertions.
 * @controlflow Vitest describe/it suites executing across fake timers and isolated DOM mounts.
 * @version 1
 * @date 2026-10-28
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { DecorationSet, EditorView } from 'prosemirror-view';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import type { ViewMutationRecord } from 'prosemirror-view';
import {
  MERMAID_DEBOUNCE_MS,
  MERMAID_EDITING_CLASS,
  MERMAID_INVALID_CLASS,
  MERMAID_ROOT_MARGIN,
  MERMAID_VIEW_STYLES,
  createCodeBlockNodeView,
  createMermaidFocusPlugin,
  mermaidBlockAt,
  mermaidFocusPluginKey,
  type CodeBlockViewOptions,
} from './mermaid-view.js';
import { kdocSchema } from './schema.js';
import { svgToDataUri, type DiagramRenderer, type DiagramResult } from '../diagrams/mermaid-renderer.js';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

/**
 * Creates a controllable deferred promise handle.
 *
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
 * Constructs a standard ProseMirror test document containing a code block and a following paragraph.
 *
 * @purpose Generates a consistent test document structure matching blueprint specifications.
 * @inputs
 *   - codeText: string - Optional custom text for the code block (defaults to 'graph TD; A-->B').
 *   - paragraphText: string - Optional custom text for the paragraph (defaults to 'after').
 *   - language: string | null - Optional code block language identifier (defaults to 'mermaid').
 * @outputs ProseMirrorNode - The constructed ProseMirror root doc node.
 * @dataflow codeText & paragraphText -> kdocSchema node constructors -> doc node.
 * @controlflow Check text lengths to avoid empty text nodes -> assemble doc with codeBlock and paragraph.
 */
function createTestDoc(
  codeText = 'graph TD; A-->B',
  paragraphText = 'after',
  language: string | null = 'mermaid',
): ProseMirrorNode {
  let codeChildren: ProseMirrorNode[];
  // Check if code text is non-empty, as ProseMirror prohibits empty text nodes.
  if (codeText.length > 0) {
    // Non-empty: create text node child.
    codeChildren = [kdocSchema.text(codeText)];
  } else {
    // Empty: no text node children.
    codeChildren = [];
  }

  let paragraphChildren: ProseMirrorNode[];
  // Check if paragraph text is non-empty.
  if (paragraphText.length > 0) {
    // Non-empty: create text node child.
    paragraphChildren = [kdocSchema.text(paragraphText)];
  } else {
    // Empty: no text node children.
    paragraphChildren = [];
  }

  return kdocSchema.node('doc', null, [
    kdocSchema.node('codeBlock', { language }, codeChildren),
    kdocSchema.node('paragraph', null, paragraphChildren),
  ]);
}

describe('mermaid-view', () => {
  let mount: HTMLDivElement | null = null;
  let view: EditorView | null = null;

  beforeEach(() => {
    // Configure fake timers for deterministic debounce and async testing.
    vi.useFakeTimers();
    // Create mount element and attach to DOM.
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  afterEach(() => {
    // Check if view is currently active.
    if (view !== null) {
      // Destroy active view instance to clean up observers and listeners.
      view.destroy();
      view = null;
    } else {
      // No active view instance to destroy.
    }

    // Check if mount element remains in the DOM.
    if (mount !== null) {
      // Detach mount element from document body.
      mount.remove();
      mount = null;
    } else {
      // Mount container is already null.
    }

    // Clean up documentElement theme dataset if modified during test.
    delete document.documentElement.dataset.kdocTheme;
    // Restore real timers after each test.
    vi.useRealTimers();
  });

  /**
   * Helper function creating and mounting an EditorView configured with mermaid view and plugin.
   *
   * @purpose Mounts an EditorView with codeBlock nodeView and focus plugin for testing.
   * @inputs
   *   - doc: ProseMirrorNode - Document to initialize state with.
   *   - options: CodeBlockViewOptions - Options for code block node view.
   *   - initialSelectionPos?: number - Optional starting caret position.
   * @outputs EditorView - Mounted EditorView instance.
   * @dataflow doc & options -> EditorState -> EditorView mounted into DOM container.
   * @controlflow Create EditorState -> set optional selection -> instantiate EditorView -> assign to outer view.
   */
  function createTestView(
    doc: ProseMirrorNode,
    options: CodeBlockViewOptions,
    initialSelectionPos?: number,
  ): EditorView {
    let state = EditorState.create({
      doc,
      schema: kdocSchema,
      plugins: [createMermaidFocusPlugin()],
    });

    // Check if an initial caret position was specified.
    if (typeof initialSelectionPos === 'number') {
      // Apply transaction updating selection to the requested position.
      state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, initialSelectionPos)));
    } else {
      // Maintain default selection at the beginning of document.
    }

    // Check whether mount element is present.
    if (mount === null) {
      // Throw error if mount container is absent.
      throw new Error('Test mount container is not initialized.');
    } else {
      // Mount container exists; instantiate EditorView.
      view = new EditorView(mount, {
        state,
        nodeViews: {
          codeBlock: createCodeBlockNodeView(options),
        },
      });
      return view;
    }
  }

  describe('exported constants', () => {
    it('exports MERMAID_EDITING_CLASS with value "kdoc-mermaid-editing"', () => {
      expect(MERMAID_EDITING_CLASS).toBe('kdoc-mermaid-editing');
    });

    it('exports MERMAID_INVALID_CLASS with value "kdoc-mermaid-invalid"', () => {
      expect(MERMAID_INVALID_CLASS).toBe('kdoc-mermaid-invalid');
    });

    it('exports MERMAID_DEBOUNCE_MS with value 300', () => {
      expect(MERMAID_DEBOUNCE_MS).toBe(300);
    });

    it('exports MERMAID_ROOT_MARGIN with value "400px 0px"', () => {
      expect(MERMAID_ROOT_MARGIN).toBe('400px 0px');
    });

    it('exports MERMAID_VIEW_STYLES with stylesheet definitions', () => {
      expect(MERMAID_VIEW_STYLES).toContain('.kdoc-mermaid');
      expect(MERMAID_VIEW_STYLES).toContain('.kdoc-mermaid-preview');
      expect(MERMAID_VIEW_STYLES).toContain('.kdoc-mermaid-image');
      expect(MERMAID_VIEW_STYLES).toContain('.kdoc-mermaid-status');
      expect(MERMAID_VIEW_STYLES).toContain('.kdoc-mermaid-error');
    });

    it('exports mermaidFocusPluginKey identifying the focus plugin', () => {
      expect(mermaidFocusPluginKey).toBeDefined();
    });
  });

  describe('mermaidBlockAt', () => {
    it('returns {from, to} when caret is inside a mermaid code block', () => {
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      const codeNode = doc.child(0);
      const state = EditorState.create({
        doc,
        schema: kdocSchema,
        selection: TextSelection.create(doc, 2),
      });

      const block = mermaidBlockAt(state);
      expect(block).toEqual({ from: 0, to: codeNode.nodeSize });
    });

    it('returns null when caret is inside a paragraph', () => {
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      const state = EditorState.create({
        doc,
        schema: kdocSchema,
        selection: TextSelection.create(doc, 21),
      });

      expect(mermaidBlockAt(state)).toBeNull();
    });

    it('returns null when caret is inside a code block with language "js"', () => {
      const doc = createTestDoc('const a = 1;', 'after', 'js');
      const state = EditorState.create({
        doc,
        schema: kdocSchema,
        selection: TextSelection.create(doc, 2),
      });

      expect(mermaidBlockAt(state)).toBeNull();
    });

    it('returns null when caret is inside a code block with null language', () => {
      const doc = createTestDoc('plain text', 'after', null);
      const state = EditorState.create({
        doc,
        schema: kdocSchema,
        selection: TextSelection.create(doc, 2),
      });

      expect(mermaidBlockAt(state)).toBeNull();
    });

    it('returns {from, to} when a NodeSelection selects the mermaid block', () => {
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      const codeNode = doc.child(0);
      const state = EditorState.create({
        doc,
        schema: kdocSchema,
        selection: NodeSelection.create(doc, 0),
      });

      const block = mermaidBlockAt(state);
      expect(block).toEqual({ from: 0, to: codeNode.nodeSize });
    });

    it('returns null when a NodeSelection selects a non-mermaid code block', () => {
      const doc = createTestDoc('const a = 1;', 'after', 'js');
      const state = EditorState.create({
        doc,
        schema: kdocSchema,
        selection: NodeSelection.create(doc, 0),
      });

      expect(mermaidBlockAt(state)).toBeNull();
    });

    it('returns null when a TextSelection spans out of the block into the paragraph', () => {
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      // Position 2 is inside the code block, position 22 extends into the paragraph.
      const state = EditorState.create({
        doc,
        schema: kdocSchema,
        selection: TextSelection.create(doc, 2, 22),
      });

      expect(mermaidBlockAt(state)).toBeNull();
    });

    it('returns {from, to} when a TextSelection ends at the exact inner boundary to - 1', () => {
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      const codeNode = doc.child(0);
      // to - 1 is position 16, the end of the 15-character text inside the code block.
      const state = EditorState.create({
        doc,
        schema: kdocSchema,
        selection: TextSelection.create(doc, 2, 16),
      });

      expect(mermaidBlockAt(state)).toEqual({ from: 0, to: codeNode.nodeSize });
    });

    it('returns null when a TextSelection extends to the outer block boundary to', () => {
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      // to is position 20, exceeding the to - 1 threshold.
      const state = EditorState.create({
        doc,
        schema: kdocSchema,
        selection: TextSelection.create(doc, 2, 20),
      });

      expect(mermaidBlockAt(state)).toBeNull();
    });
  });

  describe('createMermaidFocusPlugin', () => {
    it('decorates the block with MERMAID_EDITING_CLASS when caret is inside', () => {
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      const codeNode = doc.child(0);
      const state = EditorState.create({
        doc,
        schema: kdocSchema,
        plugins: [createMermaidFocusPlugin()],
        selection: TextSelection.create(doc, 2),
      });

      const decos = mermaidFocusPluginKey.getState(state);
      expect(decos).toBeDefined();

      const found = decos!.find();
      expect(found.length).toBe(1);
      expect(found[0]?.from).toBe(0);
      expect(found[0]?.to).toBe(codeNode.nodeSize);
      // A node decoration keeps its attributes on its type, not its spec.
      expect((found[0] as unknown as { type: { attrs: { class: string } } }).type.attrs.class).toBe(MERMAID_EDITING_CLASS);
    });

    it('removes decorations when caret moves to the paragraph', () => {
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      const state = EditorState.create({
        doc,
        schema: kdocSchema,
        plugins: [createMermaidFocusPlugin()],
        selection: TextSelection.create(doc, 2),
      });

      // Move caret to paragraph at position 21.
      const tr = state.tr.setSelection(TextSelection.create(state.doc, 21));
      const nextState = state.apply(tr);
      const decos = mermaidFocusPluginKey.getState(nextState);

      expect(decos).toBeDefined();
      expect(decos!.find().length).toBe(0);
    });

    it('preserves existing decorations on transactions without docChanged or selectionSet', () => {
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      const state = EditorState.create({
        doc,
        schema: kdocSchema,
        plugins: [createMermaidFocusPlugin()],
        selection: TextSelection.create(doc, 2),
      });

      const initialDecos = mermaidFocusPluginKey.getState(state);

      // Apply transaction that modifies metadata but not doc or selection.
      const tr = state.tr.setMeta('customMeta', 'value');
      const nextState = state.apply(tr);

      expect(mermaidFocusPluginKey.getState(nextState)).toBe(initialDecos);
    });

    it('returns decorations through the plugin props.decorations accessor', () => {
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      const plugin = createMermaidFocusPlugin();
      const state = EditorState.create({
        doc,
        schema: kdocSchema,
        plugins: [plugin],
        selection: TextSelection.create(doc, 2),
      });

      // props.decorations is typed with the plugin as `this`, so it is called with the plugin bound.
      const decos = plugin.props.decorations?.call(plugin, state);
      expect(decos).toBeInstanceOf(DecorationSet);
      expect((decos as DecorationSet).find().length).toBe(1);
    });
  });

  describe('createCodeBlockNodeView - DOM rendering and initial state', () => {
    it('renders a mermaid block with .kdoc-mermaid, pre>code, preview, and hidden error', () => {
      const render = vi.fn<DiagramRenderer>().mockResolvedValue({ ok: true, svg: '<svg/>' });
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      createTestView(doc, { render, debounceMs: 10 });

      // Verify outer container element.
      const mermaidDom = mount!.querySelector('.kdoc-mermaid');
      expect(mermaidDom).not.toBeNull();
      expect(mermaidDom!.getAttribute('data-language')).toBe('mermaid');

      // Verify pre and code structure.
      const pre = mermaidDom!.querySelector('pre');
      expect(pre).not.toBeNull();
      expect(pre!.getAttribute('data-language')).toBe('mermaid');

      const code = pre!.querySelector('code');
      expect(code).not.toBeNull();
      expect(code!.textContent).toBe('graph TD; A-->B');

      // Verify preview container and its children.
      const preview = mermaidDom!.querySelector('.kdoc-mermaid-preview');
      expect(preview).not.toBeNull();
      expect(preview!.getAttribute('contenteditable')).toBe('false');

      const img = preview!.querySelector('img.kdoc-mermaid-image') as HTMLImageElement | null;
      expect(img).not.toBeNull();
      expect(img!.getAttribute('alt')).toBe('Mermaid diagram');
      expect(img!.draggable).toBe(false);
      expect(img!.hasAttribute('src')).toBe(false);

      const status = preview!.querySelector('span.kdoc-mermaid-status');
      expect(status).not.toBeNull();
      expect(status!.textContent).toBe('Drawing diagram…');

      // Verify error element.
      const error = mermaidDom!.querySelector('.kdoc-mermaid-error') as HTMLDivElement | null;
      expect(error).not.toBeNull();
      expect(error!.getAttribute('contenteditable')).toBe('false');
      expect(error!.hidden).toBe(true);
    });

    it('renders a "js" block as plain pre[data-language="js"] with code and no .kdoc-mermaid', () => {
      const render = vi.fn<DiagramRenderer>().mockResolvedValue({ ok: true, svg: '<svg/>' });
      const doc = createTestDoc('console.log("hello");', 'after', 'js');
      createTestView(doc, { render, debounceMs: 10 });

      // Verify absence of mermaid-specific container.
      expect(mount!.querySelector('.kdoc-mermaid')).toBeNull();

      // Verify standard pre/code DOM.
      const pre = mount!.querySelector('pre[data-language="js"]');
      expect(pre).not.toBeNull();

      const code = pre!.querySelector('code');
      expect(code).not.toBeNull();
      expect(code!.textContent).toBe('console.log("hello");');
    });

    it('calls render once after advancing timers 0, updates img.src, and hides status', async () => {
      const render = vi.fn<DiagramRenderer>().mockResolvedValue({ ok: true, svg: '<svg id="diagram-1"/>' });
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      createTestView(doc, { render, debounceMs: 10 });

      // Render should not be invoked before timer tick.
      expect(render).not.toHaveBeenCalled();

      // Advance timers by 0ms for scheduled initial render.
      await vi.advanceTimersByTimeAsync(0);

      expect(render).toHaveBeenCalledTimes(1);
      expect(render).toHaveBeenCalledWith('graph TD; A-->B', 'light');

      const img = mount!.querySelector('img.kdoc-mermaid-image') as HTMLImageElement;
      expect(img.src).toBe(svgToDataUri('<svg id="diagram-1"/>'));

      const status = mount!.querySelector('span.kdoc-mermaid-status') as HTMLSpanElement;
      expect(status.hidden).toBe(true);

      const error = mount!.querySelector('.kdoc-mermaid-error') as HTMLDivElement;
      expect(error.hidden).toBe(true);
      expect(error.textContent).toBe('');

      const dom = mount!.querySelector('.kdoc-mermaid') as HTMLDivElement;
      expect(dom.classList.contains(MERMAID_INVALID_CLASS)).toBe(false);
    });

    it('calls render with theme "dark" when documentElement dataset kdocTheme is "dark"', async () => {
      document.documentElement.dataset.kdocTheme = 'dark';
      const render = vi.fn<DiagramRenderer>().mockResolvedValue({ ok: true, svg: '<svg id="dark-svg"/>' });
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      createTestView(doc, { render, debounceMs: 10 });

      await vi.advanceTimersByTimeAsync(0);

      expect(render).toHaveBeenCalledTimes(1);
      expect(render).toHaveBeenCalledWith('graph TD; A-->B', 'dark');
    });
  });

  describe('createCodeBlockNodeView - error handling and recovery', () => {
    it('displays error message, unhides error element, and marks container invalid when render fails', async () => {
      const render = vi.fn<DiagramRenderer>().mockResolvedValue({ ok: false, message: 'Parse error' });
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      const v = createTestView(doc, { render, debounceMs: 10 });

      await vi.advanceTimersByTimeAsync(0);

      const error = mount!.querySelector('.kdoc-mermaid-error') as HTMLDivElement;
      const dom = mount!.querySelector('.kdoc-mermaid') as HTMLDivElement;
      expect(error.hidden).toBe(false);
      expect(error.textContent).toBe('Parse error');
      expect(dom.classList.contains(MERMAID_INVALID_CLASS)).toBe(true);

      // Perform an edit with successful recovery.
      render.mockResolvedValueOnce({ ok: true, svg: '<svg id="cleared"/>' });
      v.dispatch(v.state.tr.insertText('A', 3));

      await vi.advanceTimersByTimeAsync(10);

      expect(error.hidden).toBe(true);
      expect(error.textContent).toBe('');
      expect(dom.classList.contains(MERMAID_INVALID_CLASS)).toBe(false);

      const img = mount!.querySelector('img.kdoc-mermaid-image') as HTMLImageElement;
      expect(img.src).toBe(svgToDataUri('<svg id="cleared"/>'));
    });
  });

  describe('createCodeBlockNodeView - debouncing and transaction handling', () => {
    it('debounces edits by specified debounceMs and does not render prematurely', async () => {
      const render = vi.fn<DiagramRenderer>().mockResolvedValue({ ok: true, svg: '<svg/>' });
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      const v = createTestView(doc, { render, debounceMs: 10 });

      await vi.advanceTimersByTimeAsync(0);
      expect(render).toHaveBeenCalledTimes(1);

      // Dispatch edit.
      v.dispatch(v.state.tr.insertText('X', 3));

      // Advance 9ms: debounce has not elapsed.
      await vi.advanceTimersByTimeAsync(9);
      expect(render).toHaveBeenCalledTimes(1);

      // Advance 1ms: debounce completes.
      await vi.advanceTimersByTimeAsync(1);
      expect(render).toHaveBeenCalledTimes(2);
      expect(render).toHaveBeenLastCalledWith('grXaph TD; A-->B', 'light');
    });

    it('uses default MERMAID_DEBOUNCE_MS when options.debounceMs is not provided', async () => {
      const render = vi.fn<DiagramRenderer>().mockResolvedValue({ ok: true, svg: '<svg/>' });
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      const v = createTestView(doc, { render });

      await vi.advanceTimersByTimeAsync(0);
      expect(render).toHaveBeenCalledTimes(1);

      v.dispatch(v.state.tr.insertText('X', 3));

      // Advance 299ms: default 300ms debounce has not elapsed.
      await vi.advanceTimersByTimeAsync(MERMAID_DEBOUNCE_MS - 1);
      expect(render).toHaveBeenCalledTimes(1);

      // Advance 1ms: reaches 300ms.
      await vi.advanceTimersByTimeAsync(1);
      expect(render).toHaveBeenCalledTimes(2);
    });

    it('batches two quick edits within debounce window into only one extra render', async () => {
      const render = vi.fn<DiagramRenderer>().mockResolvedValue({ ok: true, svg: '<svg/>' });
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      const v = createTestView(doc, { render, debounceMs: 10 });

      await vi.advanceTimersByTimeAsync(0);
      expect(render).toHaveBeenCalledTimes(1);

      // First keystroke.
      v.dispatch(v.state.tr.insertText('X', 3));
      await vi.advanceTimersByTimeAsync(5);
      expect(render).toHaveBeenCalledTimes(1);

      // Second keystroke resets debounce timer.
      v.dispatch(v.state.tr.insertText('Y', 4));
      await vi.advanceTimersByTimeAsync(5);
      expect(render).toHaveBeenCalledTimes(1);

      // Finish second debounce period.
      await vi.advanceTimersByTimeAsync(5);
      expect(render).toHaveBeenCalledTimes(2);
      expect(render).toHaveBeenLastCalledWith('grXYaph TD; A-->B', 'light');
    });

    it('does not re-render when a transaction only alters selection', async () => {
      const render = vi.fn<DiagramRenderer>().mockResolvedValue({ ok: true, svg: '<svg/>' });
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      const v = createTestView(doc, { render, debounceMs: 10 });

      await vi.advanceTimersByTimeAsync(0);
      expect(render).toHaveBeenCalledTimes(1);

      // Move selection only.
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 5)));
      await vi.advanceTimersByTimeAsync(50);

      expect(render).toHaveBeenCalledTimes(1);
    });

    it('drops stale render results when a newer generation resolves earlier', async () => {
      const deferred1 = createDeferred<DiagramResult>();
      const deferred2 = createDeferred<DiagramResult>();
      const render = vi.fn<DiagramRenderer>()
        .mockImplementationOnce(() => deferred1.promise)
        .mockImplementationOnce(() => deferred2.promise);

      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      const v = createTestView(doc, { render, debounceMs: 10 });

      // Start initial render.
      await vi.advanceTimersByTimeAsync(0);
      expect(render).toHaveBeenCalledTimes(1);

      // Trigger second render.
      v.dispatch(v.state.tr.insertText('!', 2));
      await vi.advanceTimersByTimeAsync(10);
      expect(render).toHaveBeenCalledTimes(2);

      // Resolve second render first.
      deferred2.resolve({ ok: true, svg: '<svg id="b"/>' });
      await vi.advanceTimersByTimeAsync(0);

      const img = mount!.querySelector('img.kdoc-mermaid-image') as HTMLImageElement;
      expect(img.src).toBe(svgToDataUri('<svg id="b"/>'));

      // Resolve first render later.
      deferred1.resolve({ ok: true, svg: '<svg id="a"/>' });
      await vi.advanceTimersByTimeAsync(0);

      // Output should remain from the newer generation.
      expect(img.src).toBe(svgToDataUri('<svg id="b"/>'));
    });
  });

  describe('createCodeBlockNodeView - language updates and destruction', () => {
    it('reconstructs node view when language attribute changes to "js"', async () => {
      const render = vi.fn<DiagramRenderer>().mockResolvedValue({ ok: true, svg: '<svg/>' });
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      const v = createTestView(doc, { render, debounceMs: 10 });

      await vi.advanceTimersByTimeAsync(0);
      expect(mount!.querySelector('.kdoc-mermaid')).not.toBeNull();

      // Change language attribute to js.
      v.dispatch(v.state.tr.setNodeMarkup(0, undefined, { language: 'js', meta: null }));

      // Mermaid view should be replaced by plain pre.
      expect(mount!.querySelector('.kdoc-mermaid')).toBeNull();
      const pre = mount!.querySelector('pre[data-language="js"]');
      expect(pre).not.toBeNull();
    });

    it('updates PlainCodeBlockView in place when language changes to another non-mermaid language', () => {
      const render = vi.fn<DiagramRenderer>().mockResolvedValue({ ok: true, svg: '<svg/>' });
      const doc = createTestDoc('const x = 1;', 'after', 'js');
      const v = createTestView(doc, { render, debounceMs: 10 });

      const pre = mount!.querySelector('pre');
      // Check if pre element was rendered.
      if (pre === null) {
        throw new Error('Pre element not found');
      } else {
        // Pre element exists.
      }
      expect(pre.getAttribute('data-language')).toBe('js');

      // Update node markup to python language.
      v.dispatch(v.state.tr.setNodeMarkup(0, undefined, { language: 'python', meta: null }));
      expect(pre.getAttribute('data-language')).toBe('python');
    });

    it('returns false from PlainCodeBlockView update when language changes to mermaid', () => {
      const render = vi.fn<DiagramRenderer>().mockResolvedValue({ ok: true, svg: '<svg/>' });
      const doc = createTestDoc('const x = 1;', 'after', 'js');
      const v = createTestView(doc, { render, debounceMs: 10 });

      const constructor = createCodeBlockNodeView({ render });
      const nodeView = constructor(doc.child(0), v, () => 0, [], DecorationSet.empty);

      const nextNode = kdocSchema.node('codeBlock', { language: 'mermaid' }, [kdocSchema.text('graph TD; A-->B')]);
      const updateResult = nodeView.update!(nextNode, [], DecorationSet.empty);
      expect(updateResult).toBe(false);

      nodeView.destroy?.();
    });

    it('returns false from PlainCodeBlockView update when node type differs', () => {
      const render = vi.fn<DiagramRenderer>().mockResolvedValue({ ok: true, svg: '<svg/>' });
      const doc = createTestDoc('const x = 1;', 'after', 'js');
      const v = createTestView(doc, { render, debounceMs: 10 });

      const constructor = createCodeBlockNodeView({ render });
      const nodeView = constructor(doc.child(0), v, () => 0, [], DecorationSet.empty);

      const paragraphNode = kdocSchema.node('paragraph', null, [kdocSchema.text('sample text')]);
      const updateResult = nodeView.update!(paragraphNode, [], DecorationSet.empty);
      expect(updateResult).toBe(false);

      nodeView.destroy?.();
    });

    it('returns false from MermaidView update when next node type differs or language is non-mermaid', () => {
      const render = vi.fn<DiagramRenderer>().mockResolvedValue({ ok: true, svg: '<svg/>' });
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      const v = createTestView(doc, { render, debounceMs: 10 });

      const constructor = createCodeBlockNodeView({ render });
      const nodeView = constructor(doc.child(0), v, () => 0, [], DecorationSet.empty);

      const jsNode = kdocSchema.node('codeBlock', { language: 'js' }, [kdocSchema.text('const a = 1;')]);
      expect(nodeView.update!(jsNode, [], DecorationSet.empty)).toBe(false);

      const paragraphNode = kdocSchema.node('paragraph', null, [kdocSchema.text('not a code block')]);
      expect(nodeView.update!(paragraphNode, [], DecorationSet.empty)).toBe(false);

      nodeView.destroy?.();
    });

    it('cancels pending debounce timer and prevents rendering after view is destroyed', async () => {
      const render = vi.fn<DiagramRenderer>().mockResolvedValue({ ok: true, svg: '<svg/>' });
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      const v = createTestView(doc, { render, debounceMs: 10 });

      await vi.advanceTimersByTimeAsync(0);
      expect(render).toHaveBeenCalledTimes(1);

      v.dispatch(v.state.tr.insertText('X', 3));

      // Destroy view before debounce expires.
      v.destroy();
      view = null;

      await vi.advanceTimersByTimeAsync(50);
      expect(render).toHaveBeenCalledTimes(1);
    });
  });

  describe('createCodeBlockNodeView - user interactions and NodeView methods', () => {
    it('moves selection to caret position 1 and decorates the block on preview mousedown button 0', async () => {
      const render = vi.fn<DiagramRenderer>().mockResolvedValue({ ok: true, svg: '<svg/>' });
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      const v = createTestView(doc, { render, debounceMs: 10 }, 21);

      await vi.advanceTimersByTimeAsync(0);
      expect(v.state.selection.from).toBe(21);

      const preview = mount!.querySelector('.kdoc-mermaid-preview') as HTMLDivElement;
      preview.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));

      expect(v.state.selection.from).toBe(1);

      const dom = mount!.querySelector('.kdoc-mermaid') as HTMLDivElement;
      expect(dom.classList.contains(MERMAID_EDITING_CLASS)).toBe(true);
    });

    it('moves selection to caret position 1 on error mousedown button 0', async () => {
      const render = vi.fn<DiagramRenderer>().mockResolvedValue({ ok: false, message: 'Syntax error' });
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      const v = createTestView(doc, { render, debounceMs: 10 }, 21);

      await vi.advanceTimersByTimeAsync(0);
      expect(v.state.selection.from).toBe(21);

      const error = mount!.querySelector('.kdoc-mermaid-error') as HTMLDivElement;
      error.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));

      expect(v.state.selection.from).toBe(1);
    });

    it('does not change selection on preview mousedown with non-primary button', async () => {
      const render = vi.fn<DiagramRenderer>().mockResolvedValue({ ok: true, svg: '<svg/>' });
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      const v = createTestView(doc, { render, debounceMs: 10 }, 21);

      await vi.advanceTimersByTimeAsync(0);
      expect(v.state.selection.from).toBe(21);

      const preview = mount!.querySelector('.kdoc-mermaid-preview') as HTMLDivElement;
      preview.dispatchEvent(new MouseEvent('mousedown', { button: 1, bubbles: true }));

      expect(v.state.selection.from).toBe(21);
    });

    it('stops events originating from preview and error elements', () => {
      const render = vi.fn<DiagramRenderer>().mockResolvedValue({ ok: true, svg: '<svg/>' });
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      const v = createTestView(doc, { render, debounceMs: 10 });

      const constructor = createCodeBlockNodeView({ render });
      const nodeView = constructor(doc.child(0), v, () => 0, [], DecorationSet.empty);

      const preview = nodeView.dom.querySelector('.kdoc-mermaid-preview');
      // Check if preview element was found.
      if (preview === null) {
        throw new Error('Preview element not found');
      } else {
        // Preview element exists.
      }

      const img = preview.querySelector('.kdoc-mermaid-image');
      // Check if image element was found.
      if (img === null) {
        throw new Error('Image element not found');
      } else {
        // Image element exists.
      }

      const error = nodeView.dom.querySelector('.kdoc-mermaid-error');
      // Check if error element was found.
      if (error === null) {
        throw new Error('Error element not found');
      } else {
        // Error element exists.
      }

      const pre = nodeView.dom.querySelector('pre');
      // Check if pre element was found.
      if (pre === null) {
        throw new Error('Pre element not found');
      } else {
        // Pre element exists.
      }

      const previewEvent = new MouseEvent('click');
      Object.defineProperty(previewEvent, 'target', { value: img });
      expect(nodeView.stopEvent!(previewEvent)).toBe(true);

      const errorEvent = new MouseEvent('click');
      Object.defineProperty(errorEvent, 'target', { value: error });
      expect(nodeView.stopEvent!(errorEvent)).toBe(true);

      const preEvent = new MouseEvent('click');
      Object.defineProperty(preEvent, 'target', { value: pre });
      expect(nodeView.stopEvent!(preEvent)).toBe(false);

      nodeView.destroy?.();
    });

    it('ignores DOM mutations outside contentDOM and observes selection and content mutations', () => {
      const render = vi.fn<DiagramRenderer>().mockResolvedValue({ ok: true, svg: '<svg/>' });
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      const v = createTestView(doc, { render, debounceMs: 10 });

      const constructor = createCodeBlockNodeView({ render });
      const nodeView = constructor(doc.child(0), v, () => 0, [], DecorationSet.empty);

      const contentDOM = nodeView.contentDOM;
      // Check if contentDOM is present.
      if (contentDOM === undefined) {
        throw new Error('ContentDOM is undefined');
      } else {
        // ContentDOM exists.
      }

      const outerDOM = nodeView.dom;

      // Selection mutation should not be ignored.
      expect(nodeView.ignoreMutation!({ type: 'selection', target: outerDOM } as unknown as ViewMutationRecord)).toBe(false);

      // Mutation outside contentDOM should be ignored.
      expect(nodeView.ignoreMutation!({ type: 'attributes', target: outerDOM } as unknown as ViewMutationRecord)).toBe(true);

      // Mutation inside contentDOM should not be ignored.
      expect(nodeView.ignoreMutation!({ type: 'childList', target: contentDOM } as unknown as ViewMutationRecord)).toBe(false);

      nodeView.destroy?.();
    });
  });

  describe('createCodeBlockNodeView - observers', () => {
    it('observes intersection and defers rendering until intersecting when IntersectionObserver exists', async () => {
      const originalIntersectionObserver = window.IntersectionObserver;
      let observerCallback: ((entries: Array<{ readonly isIntersecting: boolean }>) => void) | null = null;
      const mockObserve = vi.fn();
      const mockDisconnect = vi.fn();

      class MockIntersectionObserver {
        constructor(callback: (entries: Array<{ readonly isIntersecting: boolean }>) => void) {
          observerCallback = callback;
        }
        observe = mockObserve;
        disconnect = mockDisconnect;
      }

      // Assign mock IntersectionObserver onto window object.
      Object.defineProperty(window, 'IntersectionObserver', {
        value: MockIntersectionObserver,
        writable: true,
        configurable: true,
      });

      try {
        const render = vi.fn<DiagramRenderer>().mockResolvedValue({ ok: true, svg: '<svg id="lazy"/>' });
        const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
        const v = createTestView(doc, { render, debounceMs: 10 });

        // Verify observer was attached to the DOM element.
        expect(mockObserve).toHaveBeenCalledTimes(1);

        // Advance timers 0ms: render should NOT be called yet because element is not intersecting.
        await vi.advanceTimersByTimeAsync(0);
        expect(render).not.toHaveBeenCalled();

        // Check if observer callback was captured.
        // The callback is assigned inside the mock's constructor, which control-flow narrowing cannot see.
        const captured = observerCallback as ((entries: Array<{ readonly isIntersecting: boolean }>) => void) | null;
        if (captured !== null) {
          // Simulate element entering viewport.
          captured([{ isIntersecting: true }]);
        } else {
          // Callback not registered.
        }

        // Advance timers 0ms: render should now execute.
        await vi.advanceTimersByTimeAsync(0);
        expect(render).toHaveBeenCalledTimes(1);
        expect(render).toHaveBeenCalledWith('graph TD; A-->B', 'light');

        // Destroy view and verify observer disconnection.
        v.destroy();
        view = null;
        expect(mockDisconnect).toHaveBeenCalledTimes(1);
      } finally {
        // Check if original IntersectionObserver existed on window.
        if (originalIntersectionObserver !== undefined) {
          // Restore original IntersectionObserver.
          Object.defineProperty(window, 'IntersectionObserver', {
            value: originalIntersectionObserver,
            writable: true,
            configurable: true,
          });
        } else {
          // Delete mocked IntersectionObserver property.
          delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
        }
      }
    });

    it('re-renders diagram when data-kdoc-theme attribute changes via MutationObserver', async () => {
      const render = vi.fn<DiagramRenderer>().mockResolvedValue({ ok: true, svg: '<svg id="theme-test"/>' });
      const doc = createTestDoc('graph TD; A-->B', 'after', 'mermaid');
      createTestView(doc, { render, debounceMs: 10 });

      // Initial render in light theme.
      await vi.advanceTimersByTimeAsync(0);
      expect(render).toHaveBeenCalledTimes(1);
      expect(render).toHaveBeenLastCalledWith('graph TD; A-->B', 'light');

      // Update theme to dark mode.
      document.documentElement.dataset.kdocTheme = 'dark';

      // Advance timers 0ms to let MutationObserver and schedule(0) trigger re-render.
      await vi.advanceTimersByTimeAsync(0);
      expect(render).toHaveBeenCalledTimes(2);
      expect(render).toHaveBeenLastCalledWith('graph TD; A-->B', 'dark');
    });
  });
});
