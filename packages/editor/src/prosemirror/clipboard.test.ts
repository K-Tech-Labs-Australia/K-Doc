// @vitest-environment jsdom

/**
 * @file clipboard.test.ts
 * @purpose Vitest test suite for K-Doc's ProseMirror clipboard integration (packages/editor/src/prosemirror/clipboard.ts).
 *   Verifies rich HTML pasting, Markdown parsing, verbatim plain-text insertion, empty payload guards, selection serializers,
 *   event handlers, HTML preference resolution, paste mode overrides, and rich paste notifications.
 * @inputs ProseMirror EditorView instances initialized with kdocSchema, raw HTML strings, plain text strings, and mock ClipboardEvents.
 * @outputs Vitest assertions verifying ProseMirror document node structures, mark presences, return flags, and callback invocations.
 * @functions
 *   - createTestDoc: Helper creating a standard ProseMirror document with a paragraph.
 *   - createTestEditor: Helper mounting an EditorView inside a tracked DOM element in document.body.
 *   - createClipboardEventStub: Helper constructing a ClipboardEvent stub with getData lookup for jsdom.
 * @dataflow HTML/text fixtures -> pasteContent / handlePaste -> ProseMirror transactions -> EditorView state -> Vitest assertions.
 * @controlflow Mount EditorView -> execute paste operations or query selections -> assert document structure / callback data -> teardown views and DOM mounts.
 * @version 1
 * @date 2026-09-06
 */

import { describe, expect, it, afterEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { kdocSchema } from './schema.js';
import {
  createClipboardHandlers,
  pasteContent,
  selectionAsMarkdown,
  type RichPasteInfo,
} from './clipboard.js';

let activeMounts: HTMLElement[] = [];
let activeViews: EditorView[] = [];

afterEach((): void => {
  for (let i = 0; i < activeViews.length; i++) {
    const v = activeViews[i];
    if (v !== undefined) {
      v.destroy();
    }
  }
  activeViews = [];

  for (let i = 0; i < activeMounts.length; i++) {
    const m = activeMounts[i];
    if (m !== undefined) {
      m.remove();
    }
  }
  activeMounts = [];
});

/**
 * Creates a standard ProseMirror test document node containing an initial paragraph.
 *
 * @purpose Constructs a valid ProseMirror document tree using kdocSchema for editor testing.
 * @inputs text - Optional text string to populate inside the initial paragraph.
 * @outputs ProseMirrorNode - The root doc node.
 * @dataflow text -> kdocSchema.text -> kdocSchema.node('paragraph') -> kdocSchema.node('doc').
 * @controlflow If text is non-empty wrap text leaf in paragraph; otherwise create empty paragraph -> wrap in doc.
 */
function createTestDoc(text: string = ''): ProseMirrorNode {
  if (text.length === 0) {
    return kdocSchema.node('doc', null, [
      kdocSchema.node('paragraph', null, []),
    ]);
  } else {
    return kdocSchema.node('doc', null, [
      kdocSchema.node('paragraph', null, [kdocSchema.text(text)]),
    ]);
  }
}

/**
 * Instantiates and mounts a real ProseMirror EditorView into document.body.
 *
 * @purpose Sets up a functional EditorView with kdocSchema mounted to document.body for clipboard interactions.
 * @inputs initialDoc - Optional ProseMirror document node to initialize editor state.
 * @outputs Object containing the mounted EditorView and mount container HTMLElement.
 * @dataflow initialDoc -> EditorState.create -> new EditorView -> active registries.
 * @controlflow Allocate div -> append to DOM -> create state with kdocSchema -> instantiate EditorView -> record in active arrays.
 */
function createTestEditor(initialDoc?: ProseMirrorNode): {
  view: EditorView;
  mount: HTMLElement;
} {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  activeMounts.push(mount);

  const doc = initialDoc ?? createTestDoc();
  const state = EditorState.create({
    schema: kdocSchema,
    doc,
  });

  const view = new EditorView(mount, { state });
  activeViews.push(view);
  return { view, mount };
}

/**
 * Creates a minimal ClipboardEvent stub with a getData method for jsdom environments.
 *
 * @purpose Constructs a test ClipboardEvent stub because jsdom does not implement native DataTransfer or ClipboardEvent constructors.
 * @inputs data - Map of MIME types to string payloads (e.g. 'text/html', 'text/plain').
 * @outputs ClipboardEvent - A stub conforming to ClipboardEvent with getData capability.
 * @dataflow data map -> stub clipboardData object -> stub ClipboardEvent -> cast through unknown to ClipboardEvent.
 * @controlflow Create stub clipboardData object with getData lookup -> wrap in stub event with clipboardData property -> cast through unknown to ClipboardEvent and return.
 */
function createClipboardEventStub(data: Record<string, string>): ClipboardEvent {
  // jsdom does not implement native DataTransfer or ClipboardEvent constructors in its environment.
  // We build a minimal stub object with a getData method matching the ClipboardEvent interface,
  // and cast through unknown rather than any to satisfy strict typing rules.
  const clipboardData = {
    getData(format: string): string {
      return data[format] ?? '';
    },
  };
  return { clipboardData } as unknown as ClipboardEvent;
}

describe('pasteContent', () => {
  // Pins markdown mode converting markdown headings and lists into corresponding ProseMirror node types.
  it('produces a real heading and list in the document when pasting markdown', () => {
    const { view } = createTestEditor();
    const success = pasteContent(view, '', '## Heading\n\n- one', 'markdown');
    expect(success).toBe(true);

    const nodeTypes: string[] = [];
    view.state.doc.descendants((node: ProseMirrorNode): void => {
      nodeTypes.push(node.type.name);
    });

    expect(nodeTypes).toContain('heading');
    expect(nodeTypes).toContain('bulletList');
    expect(nodeTypes).toContain('listItem');
  });

  // Pins html mode converting strong tags into ProseMirror strong marks.
  it('produces a paragraph containing a strong mark when pasting html', () => {
    const { view } = createTestEditor();
    const success = pasteContent(view, '<p>Hi <strong>there</strong></p>', '', 'html');
    expect(success).toBe(true);

    let foundStrongMark = false;
    view.state.doc.descendants((node: ProseMirrorNode): void => {
      if (node.marks.some((mark) => mark.type.name === 'strong')) {
        foundStrongMark = true;
      }
    });

    expect(foundStrongMark).toBe(true);
  });

  // Pins plain mode inserting literal markdown syntax characters without constructing heading nodes.
  it('inserts literal characters without creating heading nodes when pasting plain text', () => {
    const { view } = createTestEditor();
    const success = pasteContent(view, '', '## Heading', 'plain');
    expect(success).toBe(true);

    const nodeTypes: string[] = [];
    view.state.doc.descendants((node: ProseMirrorNode): void => {
      nodeTypes.push(node.type.name);
    });

    expect(nodeTypes).not.toContain('heading');
    expect(view.state.doc.textContent).toContain('## Heading');
  });

  // Pins empty payload validation returning false for each respective paste mode.
  it('returns false for an empty payload in each paste mode', () => {
    const { view } = createTestEditor();

    expect(pasteContent(view, '', '', 'plain')).toBe(false);
    expect(pasteContent(view, '', '', 'markdown')).toBe(false);
    expect(pasteContent(view, '', '', 'html')).toBe(false);
    expect(pasteContent(view, '   ', '', 'html')).toBe(false);
  });
});

describe('selectionAsMarkdown', () => {
  // Pins selection serialization returning empty string for empty selections and markdown for selected paragraphs.
  it('returns empty string for an empty selection and markdown for a selected paragraph', () => {
    const { view } = createTestEditor(createTestDoc('Selected paragraph content'));

    // Caret selection (empty selection).
    expect(selectionAsMarkdown(view.state)).toBe('');

    // Range selection covering the text inside the paragraph.
    // Document layout: pos 0 = start of doc, pos 1 = start of paragraph text.
    const textLength = 'Selected paragraph content'.length;
    const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 1 + textLength));
    view.dispatch(tr);

    const markdown = selectionAsMarkdown(view.state);
    expect(markdown.trim()).toBe('Selected paragraph content');
  });
});

describe('createClipboardHandlers', () => {
  // Pins handlePaste returning false when clipboardData is missing from the clipboard event.
  it('returns false when the event has no clipboardData', () => {
    const { view } = createTestEditor();
    const handlers = createClipboardHandlers({ schema: kdocSchema });
    const event = { clipboardData: null } as unknown as ClipboardEvent;

    const handled = handlers.handlePaste(view, event);
    expect(handled).toBe(false);
  });

  // Pins handlePaste favoring HTML over plain text when both formats are present.
  it('prefers HTML when both HTML and plain text are present', () => {
    const { view } = createTestEditor();
    const handlers = createClipboardHandlers({ schema: kdocSchema });
    const event = createClipboardEventStub({
      'text/html': '<p>Formatted <strong>bold</strong> text</p>',
      'text/plain': 'Plain text without formatting',
    });

    const handled = handlers.handlePaste(view, event);
    expect(handled).toBe(true);

    let foundStrongMark = false;
    view.state.doc.descendants((node: ProseMirrorNode): void => {
      if (node.marks.some((mark) => mark.type.name === 'strong')) {
        foundStrongMark = true;
      }
    });

    // The strong mark appears because the HTML interpretation was selected over plain text.
    expect(foundStrongMark).toBe(true);
  });

  // Pins takePasteMode plain override taking precedence over the presence of HTML.
  it('overrides the HTML preference when takePasteMode returns plain', () => {
    const { view } = createTestEditor();
    // The override is what Ctrl+Shift+V uses, and it beats the presence of HTML because the user said explicitly what they wanted.
    const handlers = createClipboardHandlers({
      schema: kdocSchema,
      takePasteMode: () => 'plain',
    });
    const rawText = '<p>Raw <strong>tags</strong></p>';
    const event = createClipboardEventStub({
      'text/html': '<p>Formatted <strong>tags</strong></p>',
      'text/plain': rawText,
    });

    const handled = handlers.handlePaste(view, event);
    expect(handled).toBe(true);

    let foundStrongMark = false;
    view.state.doc.descendants((node: ProseMirrorNode): void => {
      if (node.marks.some((mark) => mark.type.name === 'strong')) {
        foundStrongMark = true;
      }
    });

    // Verify document received literal text rather than rich HTML formatting.
    expect(foundStrongMark).toBe(false);
    expect(view.state.doc.textContent).toContain(rawText);
  });

  // Pins onRichPaste notification callback firing once with html and text after an HTML paste.
  it('calls onRichPaste once after an HTML paste with the provided html and text', () => {
    const { view } = createTestEditor();
    const calls: RichPasteInfo[] = [];
    const handlers = createClipboardHandlers({
      schema: kdocSchema,
      onRichPaste: (info: RichPasteInfo): void => {
        calls.push(info);
      },
    });

    const html = '<p>Pasted <strong>rich</strong> text</p>';
    const text = 'Pasted rich text';
    const event = createClipboardEventStub({
      'text/html': html,
      'text/plain': text,
    });

    const handled = handlers.handlePaste(view, event);
    expect(handled).toBe(true);
    expect(calls.length).toBe(1);

    const record = calls[0];
    expect(record).toBeDefined();
    expect(record?.html).toBe(html);
    expect(record?.text).toBe(text);
  });
});
