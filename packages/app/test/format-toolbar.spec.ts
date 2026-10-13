// @vitest-environment jsdom

/**
 * @file format-toolbar.spec.ts
 * @purpose Vitest test suite for the K-Doc view's format toolbar and modal link dialog (@k-doc/app).
 *   Validates complete toolbar rendering, caret state reflection across inline marks, block formats,
 *   lists, and links, edit lock focus contract maintenance, modal link dialog input synchronization,
 *   validation, and lifecycle teardown under a jsdom environment.
 * @inputs Markdown test fixtures, ProseMirror EditorView instances, DocumentSession state mutations, synthetic DOM click/change/submit/focus events, and LinkAttrs objects.
 * @outputs Vitest assertions verifying DOM element attributes (aria-pressed, disabled, hidden, title, aria-label, select value/selectedIndex), document text mutations, focus restoration, requestLink callbacks, and idempotent lifecycle cleanup.
 * @functions
 *   - mountElement: Creates a container div element, appends it to document.body, tracks it for lifecycle cleanup, and returns it.
 *   - mountToolbar: Instantiates a DocumentSession, ProseMirrorBinding, and FormatToolbar mounted on dedicated DOM elements.
 *   - mountDialog: Instantiates and mounts a LinkDialog instance to document.body, returning element references and submission recorder.
 *   - button: Queries a button element inside a container by its accessible aria-label, throwing a descriptive error if missing.
 *   - select: Queries a select dropdown element inside a container by its accessible aria-label, throwing a descriptive error if missing.
 *   - selectWord: Finds a target word in the editor document and sets a TextSelection spanning across that word.
 *   - setCaret: Finds a target word in the editor document and positions a collapsed caret at the midpoint of the word.
 * @dataflow Markdown fixtures -> DocumentSession & ProseMirrorBinding -> installFormatToolbar / installLinkDialog -> DOM & editor transactions -> attribute & snapshot assertions.
 * @controlflow Mount DOM elements & controllers -> execute test operations across rendering, caret reflection, focus contract, link delegation, and dialog lifecycle -> assert DOM & session state -> tear down bindings and mounts in afterEach.
 * @version 1
 * @date 2026-09-05
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { DocumentSession } from '@k-doc/core';
import { ProseMirrorBinding, type LinkAttrs } from '@k-doc/editor';
import { createFormatPainterPlugin, formatPainterState } from '@k-doc/editor';
import { installFormatToolbar, FORMAT_TOOLBAR_STYLES, type FormatToolbar } from '../src/shell/format-toolbar.js';
import { installLinkDialog, type LinkDialog } from '../src/shell/link-dialog.js';

let activeMounts: HTMLElement[] = [];
let activeBindings: ProseMirrorBinding[] = [];
let activeToolbars: FormatToolbar[] = [];
let activeDialogs: LinkDialog[] = [];

/**
 * Creates a container div element, appends it to document.body, tracks it for lifecycle cleanup, and returns it.
 *
 * @purpose Allocates and attaches a mount DOM container to document.body for component hosting.
 * @inputs void.
 * @outputs HTMLElement - The newly created and attached DOM element.
 * @dataflow document.createElement -> document.body.appendChild -> tracked in activeMounts -> return element.
 * @controlflow Create div element -> append to document.body -> record in activeMounts array -> return element.
 */
function mountElement(): HTMLElement {
  const element = document.createElement('div');
  document.body.appendChild(element);
  activeMounts.push(element);
  return element;
}

/**
 * Instantiates a DocumentSession, ProseMirrorBinding, and FormatToolbar mounted on dedicated DOM elements.
 *
 * @purpose Sets up an integrated test harness with session, editor binding, and toolbar controller for testing formatting interactions.
 * @inputs markdown - Raw Markdown source string used to initialize the document session.
 * @outputs Object containing container, session, binding, toolbar controller, and link request call recorder.
 * @dataflow markdown -> DocumentSession -> ProseMirrorBinding -> installFormatToolbar -> return test harness controller record.
 * @controlflow Create container and PM mount elements -> initialize session and binding -> install format toolbar with requestLink recorder -> register instances for afterEach teardown -> return record.
 */
function mountToolbar(markdown: string): {
  container: HTMLElement;
  session: DocumentSession;
  binding: ProseMirrorBinding;
  toolbar: FormatToolbar;
  requested: { calls: Array<LinkAttrs | null> };
} {
  const container = mountElement();
  const pmMount = mountElement();
  const session = new DocumentSession(markdown);
  const binding = new ProseMirrorBinding({ session, mount: pmMount });
  activeBindings.push(binding);

  const requested: { calls: Array<LinkAttrs | null> } = { calls: [] };
  const toolbar = installFormatToolbar({
    container,
    view: binding.view,
    doc: document,
    requestStylesGallery: (): void => {
      // The gallery is a shell concern; the toolbar only has to ask for it.
    },
    requestListPicker: (): void => {
      // The gallery is a shell concern; the toolbar only has to ask for it.
    },
    requestLink: (current: LinkAttrs | null): void => {
      requested.calls.push(current);
    },
  });
  activeToolbars.push(toolbar);

  return {
    container,
    session,
    binding,
    toolbar,
    requested,
  };
}

/**
 * Instantiates and mounts a LinkDialog instance to document.body, returning element references and submission recorder.
 *
 * @purpose Sets up a LinkDialog test harness providing access to internal dialog inputs, forms, and submission history.
 * @inputs onSubmit - Optional submission callback to invoke alongside internal call recording.
 * @outputs Object containing dialog controller, dialog element, form element, URL input, title input, error alert container, and submission call recorder.
 * @dataflow onSubmit -> installLinkDialog -> locate DOM elements in document.body -> register dialog for afterEach teardown -> return harness record.
 * @controlflow Initialize submission recorder -> install link dialog -> query dialog and child input elements -> register dialog in activeDialogs -> return record.
 */
function mountDialog(onSubmit?: (attrs: { href: string; title: string | null }) => void): {
  dialog: LinkDialog;
  dialogElement: HTMLDialogElement;
  formElement: HTMLFormElement;
  urlInput: HTMLInputElement;
  titleInput: HTMLInputElement;
  errorAlert: HTMLElement;
  submitted: { calls: Array<{ href: string; title: string | null }> };
} {
  const submitted: { calls: Array<{ href: string; title: string | null }> } = { calls: [] };
  const dialogInstance = installLinkDialog({
    doc: document,
    // The two sources FR-8.12 added are not what these tests are about, so they answer with
    // nothing: no headings and no vault. A dialog with an empty Heading and Note tab still has
    // the URL field these tests drive.
    headings: (): readonly { readonly depth: number; readonly text: string }[] => [],
    searchNotes: (): readonly { readonly title: string; readonly relative: string }[] => [],
    onSubmit: (attrs: { href: string; title: string | null }): void => {
      submitted.calls.push(attrs);
      // Check if an external submission handler was provided.
      if (onSubmit !== undefined) {
        // Forward attributes to external handler.
        onSubmit(attrs);
      } else {
        // No external handler provided.
      }
    },
  });
  activeDialogs.push(dialogInstance);

  const dialogElements = document.body.querySelectorAll<HTMLDialogElement>('dialog.kdoc-link-dialog');
  const dialogElement = dialogElements[dialogElements.length - 1];
  // Check if dialog element was successfully attached to document body.
  if (dialogElement === undefined) {
    // Dialog element missing from DOM: fail fast.
    throw new Error('Link dialog element was not attached to document.body');
  } else {
    // Dialog element found.
  }

  const formElement = dialogElement.querySelector<HTMLFormElement>('form');
  // Check if form element exists inside dialog.
  if (formElement === null) {
    // Form element missing: fail fast.
    throw new Error('Form element not found inside link dialog');
  } else {
    // Form element found.
  }

  const urlInput = dialogElement.querySelector<HTMLInputElement>('input[type="url"]');
  // Check if URL input element exists inside dialog form.
  if (urlInput === null) {
    // URL input missing: fail fast.
    throw new Error('URL input element not found inside link dialog');
  } else {
    // URL input found.
  }

  const titleInput = dialogElement.querySelector<HTMLInputElement>('input[type="text"]');
  // Check if title input element exists inside dialog form.
  if (titleInput === null) {
    // Title input missing: fail fast.
    throw new Error('Title input element not found inside link dialog');
  } else {
    // Title input found.
  }

  const errorAlert = dialogElement.querySelector<HTMLElement>('[role="alert"]');
  // Check if role="alert" validation error container exists inside dialog form.
  if (errorAlert === null) {
    // Error alert missing: fail fast.
    throw new Error('Role alert container not found inside link dialog');
  } else {
    // Error alert found.
  }

  return {
    dialog: dialogInstance,
    dialogElement,
    formElement,
    urlInput,
    titleInput,
    errorAlert,
    submitted,
  };
}

/**
 * Queries a button element inside a container by its accessible aria-label, throwing a descriptive error if missing.
 *
 * @purpose Locates a button by its accessible name rather than DOM index, failing fast with a descriptive error when not found.
 * @inputs
 *   - container: HTMLElement - The parent DOM container hosting the toolbar buttons.
 *   - label: string - The exact aria-label string to locate.
 * @outputs HTMLButtonElement - The matching button DOM element.
 * @dataflow container.querySelector with aria-label selector -> validate found -> return HTMLButtonElement.
 * @controlflow Query button with aria-label selector -> check if null -> if null throw descriptive Error -> return button element.
 */
function button(container: HTMLElement, label: string): HTMLButtonElement {
  const btn = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  // Check if the button element with the specified aria-label was found in the container.
  if (btn === null) {
    // Button not found: throw descriptive named error to identify missing control.
    throw new Error(`No button labelled "${label}" found in toolbar container`);
  } else {
    // Button found: return element.
  }
  return btn;
}

/**
 * Queries a select dropdown element inside a container by its accessible aria-label, throwing a descriptive error if missing.
 *
 * @purpose Locates a select control by its accessible name, failing fast with a descriptive error when not found.
 * @inputs
 *   - container: HTMLElement - The parent DOM container hosting the toolbar controls.
 *   - label: string - The exact aria-label string to locate.
 * @outputs HTMLSelectElement - The matching select DOM element.
 * @dataflow container.querySelector with aria-label selector -> validate found -> return HTMLSelectElement.
 * @controlflow Query select with aria-label selector -> check if null -> if null throw descriptive Error -> return select element.
 */
function select(container: HTMLElement, label: string): HTMLSelectElement {
  const el = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  // Check if the select element with the specified aria-label was found in the container.
  if (el === null) {
    // Select not found: throw descriptive named error.
    throw new Error(`No select labelled "${label}" found in toolbar container`);
  } else {
    // Select found: return element.
  }
  return el;
}

/**
 * Finds a target word in the editor document and sets a TextSelection spanning across that word.
 *
 * @purpose Locates a target substring in textContent, maps character offsets to document positions by traversing text nodes, and dispatches a ProseMirror selection transaction.
 * @inputs
 *   - binding: ProseMirrorBinding - The editor binding hosting the target ProseMirror view.
 *   - word: string - The exact substring to locate and select.
 * @outputs void.
 * @dataflow word -> search doc.textContent -> walk doc.descendants -> compute from/to positions -> create TextSelection -> dispatch transaction to view.
 * @controlflow Locate word in textContent (throw if missing) -> traverse doc.descendants to map character offset to document positions -> verify positions found (throw if unmapped) -> construct TextSelection -> dispatch selection transaction.
 */
function selectWord(binding: ProseMirrorBinding, word: string): void {
  const doc = binding.view.state.doc;
  const text = doc.textContent;
  const targetIndex = text.indexOf(word);

  // Check if the requested word exists in the document text content.
  if (targetIndex === -1) {
    // Word not found: throw named error to fail fast on invalid test input.
    throw new Error(`Word "${word}" not found in document text content: "${text}"`);
  } else {
    // Word found: proceed to compute position offsets across text nodes.
  }

  const targetEnd = targetIndex + word.length;
  let currentOffset = 0;
  let fromPos: number | undefined;
  let toPos: number | undefined;

  doc.descendants((node, pos) => {
    // Check if the current node is a text node.
    if (node.isText && node.text !== undefined) {
      const nodeLen = node.text.length;
      const nextOffset = currentOffset + nodeLen;

      // Check if the word start offset is within this text node and not yet recorded.
      if (fromPos === undefined && targetIndex >= currentOffset && targetIndex <= nextOffset) {
        fromPos = pos + (targetIndex - currentOffset);
      } else {
        // Start offset not in this node or already found.
      }

      // Check if the word end offset is within this text node and not yet recorded.
      if (toPos === undefined && targetEnd >= currentOffset && targetEnd <= nextOffset) {
        toPos = pos + (targetEnd - currentOffset);
      } else {
        // End offset not in this node or already found.
      }

      currentOffset = nextOffset;
    } else {
      // Non-text node: continue traversal.
    }
  });

  // Check if both start and end document positions were resolved.
  if (fromPos === undefined || toPos === undefined) {
    // Positions unmapped: throw error.
    throw new Error(`Could not map word "${word}" to document positions in view`);
  } else {
    // Positions resolved: dispatch selection transaction.
  }

  const selection = TextSelection.create(doc, fromPos, toPos);
  binding.view.dispatch(binding.view.state.tr.setSelection(selection));
}

/**
 * Finds a target word in the editor document and positions a collapsed caret at the midpoint of the word.
 *
 * @purpose Locates a target substring in textContent, maps midpoint offset to a document position by traversing text nodes, and dispatches a ProseMirror collapsed selection transaction.
 * @inputs
 *   - binding: ProseMirrorBinding - The editor binding hosting the target ProseMirror view.
 *   - word: string - The exact substring whose midpoint receives the caret.
 * @outputs void.
 * @dataflow word -> search doc.textContent -> compute midpoint -> walk doc.descendants -> compute position -> create collapsed TextSelection -> dispatch transaction to view.
 * @controlflow Locate word in textContent (throw if missing) -> compute midpoint offset -> traverse doc.descendants to map midpoint to document position -> verify position found (throw if unmapped) -> construct collapsed TextSelection -> dispatch selection transaction.
 */
function setCaret(binding: ProseMirrorBinding, word: string): void {
  const doc = binding.view.state.doc;
  const text = doc.textContent;
  const targetIndex = text.indexOf(word);

  // Check if the requested word exists in the document text content.
  if (targetIndex === -1) {
    // Word not found: throw named error to fail fast on invalid test input.
    throw new Error(`Word "${word}" not found in document text content: "${text}"`);
  } else {
    // Word found: proceed to compute midpoint position offset across text nodes.
  }

  const midOffset = targetIndex + Math.floor(word.length / 2);
  let currentOffset = 0;
  let caretPos: number | undefined;

  doc.descendants((node, pos) => {
    // Check if the current node is a text node.
    if (node.isText && node.text !== undefined) {
      const nodeLen = node.text.length;
      const nextOffset = currentOffset + nodeLen;

      // Check if the midpoint offset is within this text node and not yet recorded.
      if (caretPos === undefined && midOffset >= currentOffset && midOffset <= nextOffset) {
        caretPos = pos + (midOffset - currentOffset);
      } else {
        // Midpoint offset not in this node or already found.
      }

      currentOffset = nextOffset;
    } else {
      // Non-text node: continue traversal.
    }
  });

  // Check if document position was resolved.
  if (caretPos === undefined) {
    // Position unmapped: throw error.
    throw new Error(`Could not map midpoint of word "${word}" to document position in view`);
  } else {
    // Position resolved: dispatch collapsed selection transaction.
  }

  const selection = TextSelection.create(doc, caretPos, caretPos);
  binding.view.dispatch(binding.view.state.tr.setSelection(selection));
}

describe('FormatToolbar', () => {
  beforeEach(() => {
    activeMounts = [];
    activeBindings = [];
    activeToolbars = [];
  });

  afterEach(() => {
    for (const toolbar of activeToolbars) {
      toolbar.destroy();
    }
    activeToolbars = [];

    for (const binding of activeBindings) {
      binding.destroy();
    }
    activeBindings = [];

    for (const mount of activeMounts) {
      // Check if mount element is currently attached to the DOM.
      if (mount.parentNode !== null) {
        mount.parentNode.removeChild(mount);
      } else {
        // Mount element already detached.
      }
    }
    activeMounts = [];
  });

  describe('rendering', () => {
    it('renders a button for every documented control and a block-type select', () => {
      const { container } = mountToolbar('Initial text.\n');
      const expectedLabels: readonly string[] = [
        'Bold',
        'Italic',
        'Strikethrough',
        'Inline code',
        'Clear formatting',
        'Code block',
        'Blockquote',
        'Bullet list',
        'Ordered list',
        'Task item',
        'Link',
        'Remove link',
        'Horizontal rule',
      ];

      for (const label of expectedLabels) {
        const btn = button(container, label);
        expect(btn).not.toBeNull();
      }

      const selectEl = select(container, 'Block type');
      expect(selectEl).not.toBeNull();
    });

    it('ensures every button has type="button" to prevent accidental form submission', () => {
      const { container } = mountToolbar('Initial text.\n');
      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBeGreaterThan(0);
      for (const btn of buttons) {
        expect(btn.type).toBe('button');
      }
    });

    it('ensures every button carries a non-empty title and aria-label', () => {
      const { container } = mountToolbar('Initial text.\n');
      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBeGreaterThan(0);
      for (const btn of buttons) {
        expect(btn.title.trim().length).toBeGreaterThan(0);
        const ariaLabel = btn.getAttribute('aria-label');
        expect(ariaLabel).not.toBeNull();
        expect(ariaLabel?.trim().length).toBeGreaterThan(0);
      }
    });
  });

  describe('the stylesheet', () => {
    it('overrides the class display rule for hidden buttons', () => {
      // Asserting on the stylesheet TEXT rather than a computed style is deliberate: jsdom does not
      // apply the cascade, so `expect(button.hidden).toBe(true)` passes while the button is plainly
      // visible in a real browser. That is exactly what happened here — the class rule's
      // display: inline-flex beat the UA's [hidden] { display: none } and the Unlink button never
      // went away. This is the only form of the check a headless test can actually make.
      expect(FORMAT_TOOLBAR_STYLES).toContain('.kdoc-format-button[hidden]');
      expect(FORMAT_TOOLBAR_STYLES).toMatch(/\.kdoc-format-button\[hidden\]\s*\{\s*display:\s*none/);
    });
  });

  describe('caret state reflection', () => {
    it('reports aria-pressed="false" on Bold button when caret is inside plain text', () => {
      const { container, binding } = mountToolbar('Plain text.\n');
      setCaret(binding, 'Plain');
      expect(button(container, 'Bold').getAttribute('aria-pressed')).toBe('false');
    });

    it('reflects bold mark on selected word after button click and updates session Markdown', () => {
      const { container, session, binding, toolbar } = mountToolbar('Hello world.\n');
      selectWord(binding, 'world');
      button(container, 'Bold').click();
      toolbar.refresh();

      expect(button(container, 'Bold').getAttribute('aria-pressed')).toBe('true');
      expect(session.snapshot.text).toContain('**world**');
    });

    it('updates block-type select value between heading and paragraph when moving caret', () => {
      const { container, binding, toolbar } = mountToolbar('# Heading one\n\nBody text.\n');
      const blockSelect = select(container, 'Block type');

      setCaret(binding, 'Heading');
      toolbar.refresh();
      expect(blockSelect.value).toBe('1');

      setCaret(binding, 'Body');
      toolbar.refresh();
      expect(blockSelect.value).toBe('0');
    });

    it('leaves block-type select index at -1 when caret is inside a code block', () => {
      const { container, binding, toolbar } = mountToolbar('```\ncode\n```\n');
      const blockSelect = select(container, 'Block type');

      setCaret(binding, 'code');
      toolbar.refresh();

      // A code block is neither a paragraph nor a heading: selectedIndex === -1 avoids showing a misleading block type.
      expect(blockSelect.selectedIndex).toBe(-1);
    });

    it('reports aria-pressed="true" on Blockquote button when caret is inside a blockquote', () => {
      const { container, binding, toolbar } = mountToolbar('> Quoted.\n');
      setCaret(binding, 'Quoted');
      toolbar.refresh();

      expect(button(container, 'Blockquote').getAttribute('aria-pressed')).toBe('true');
    });

    it('disables Link button and hides Remove link button when caret is in plain unselected text', () => {
      const { container, binding, toolbar } = mountToolbar('Plain unlinked text.\n');
      setCaret(binding, 'Plain');
      toolbar.refresh();

      const linkBtn = button(container, 'Link');
      const removeBtn = button(container, 'Remove link');

      expect(linkBtn.disabled).toBe(true);
      expect(removeBtn.hidden).toBe(true);
    });

    it('enables Link button with aria-pressed="true" and shows Remove link button inside existing link', () => {
      const { container, binding, toolbar } = mountToolbar('A [site](https://example.com) here.\n');
      setCaret(binding, 'site');
      toolbar.refresh();

      const linkBtn = button(container, 'Link');
      const removeBtn = button(container, 'Remove link');

      expect(linkBtn.disabled).toBe(false);
      expect(linkBtn.getAttribute('aria-pressed')).toBe('true');
      expect(removeBtn.hidden).toBe(false);
    });
  });

  describe('the focus contract', () => {
    it('restores DOM focus to editor view after clicking a toolbar button', () => {
      const { container, binding } = mountToolbar('Sample text.\n');
      selectWord(binding, 'Sample');

      const boldBtn = button(container, 'Bold');
      boldBtn.click();

      // K-Doc keys its single-pane edit lock on which pane holds focus, so a button that does not restore focus silently breaks the next keystroke.
      const hasFocus = binding.view.hasFocus() || binding.view.dom.contains(document.activeElement);
      expect(hasFocus).toBe(true);
    });
  });

  describe('requestLink delegation', () => {
    it('calls requestLink with existing link attributes when clicking Link button inside a link', () => {
      const { container, binding, requested, toolbar } = mountToolbar('A [site](https://example.com) here.\n');
      setCaret(binding, 'site');
      toolbar.refresh();

      const linkBtn = button(container, 'Link');
      linkBtn.click();

      expect(requested.calls.length).toBe(1);
      const firstCall = requested.calls[0];
      expect(firstCall).toEqual({
        href: 'https://example.com',
        title: null,
      });
    });

    it('calls requestLink with null when clicking Link button with plain text selected', () => {
      const { container, binding, requested, toolbar } = mountToolbar('Hello world.\n');
      selectWord(binding, 'world');
      toolbar.refresh();

      const linkBtn = button(container, 'Link');
      linkBtn.click();

      expect(requested.calls.length).toBe(1);
      expect(requested.calls[0]).toBeNull();
    });
  });

  describe('lifecycle', () => {
    it('empties the container on destroy()', () => {
      const { container, toolbar } = mountToolbar('Sample text.\n');
      expect(container.children.length).toBeGreaterThan(0);

      toolbar.destroy();
      expect(container.children.length).toBe(0);
    });

    it('handles multiple destroy() calls idempotently without throwing', () => {
      const { toolbar } = mountToolbar('Sample text.\n');
      expect(() => {
        toolbar.destroy();
        toolbar.destroy();
      }).not.toThrow();
    });

    it('handles refresh() after destroy() without throwing', () => {
      const { toolbar } = mountToolbar('Sample text.\n');
      toolbar.destroy();
      expect(() => {
        toolbar.refresh();
      }).not.toThrow();
    });
  });
});

describe('LinkDialog', () => {
  beforeEach(() => {
    activeDialogs = [];
  });

  afterEach(() => {
    for (const dialog of activeDialogs) {
      dialog.destroy();
    }
    activeDialogs = [];

    // Detach any lingering dialog elements attached to document.body.
    const lingeringDialogs = document.body.querySelectorAll('dialog.kdoc-link-dialog');
    for (const d of lingeringDialogs) {
      // Check if dialog node is currently attached.
      if (d.parentNode !== null) {
        d.parentNode.removeChild(d);
      } else {
        // Dialog already detached.
      }
    }
  });

  it('clears input fields and sets open to true on open(null)', () => {
    const { dialog, dialogElement, urlInput, titleInput } = mountDialog();

    // jsdom does not implement HTMLDialogElement.prototype.showModal, which is why the source falls back to setting open = true.
    dialog.open(null);

    expect(dialogElement.open).toBe(true);
    expect(urlInput.value).toBe('');
    expect(titleInput.value).toBe('');
  });

  it('pre-fills URL and title inputs when opened with existing link attributes', () => {
    const { dialog, dialogElement, urlInput, titleInput } = mountDialog();

    dialog.open({ href: 'https://example.com', title: 'Tip' });

    expect(dialogElement.open).toBe(true);
    expect(urlInput.value).toBe('https://example.com');
    expect(titleInput.value).toBe('Tip');
  });

  it('rejects form submission with empty URL, shows role="alert" message, and keeps dialog open', () => {
    const { dialog, dialogElement, formElement, errorAlert, submitted } = mountDialog();

    dialog.open(null);
    formElement.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(submitted.calls.length).toBe(0);
    expect(dialogElement.open).toBe(true);
    expect(errorAlert.hidden).toBe(false);
    expect(errorAlert.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('submits URL with null title when title input is blank and closes dialog', () => {
    const { dialog, dialogElement, formElement, urlInput, titleInput, submitted } = mountDialog();

    dialog.open(null);
    urlInput.value = 'https://example.com';
    titleInput.value = '';
    formElement.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(submitted.calls.length).toBe(1);
    expect(submitted.calls[0]).toEqual({
      href: 'https://example.com',
      title: null,
    });
    expect(dialogElement.open).toBe(false);
  });

  // Pins the close-then-notify ordering. A native <dialog> hands focus back to whatever held it before
  // showModal() when it closes, so closing after onSubmit undoes any focus the host set inside it. jsdom
  // has no such focus restoration, so observing the dialog already closed from inside onSubmit is the
  // only way a headless test can hold this ordering in place.
  it('closes before notifying the host so the host keeps the last word on focus', () => {
    const openWhenNotified: { value: boolean | null } = { value: null };
    // The element is reached through a holder because the callback is written before the element
    // exists; reading a const from inside a closure declared above it is a temporal-dead-zone error.
    const ref: { element: HTMLDialogElement | null } = { element: null };

    const probe = installLinkDialog({
      doc: document,
      // The two sources FR-8.12 added are not what these tests are about, so they answer with
      // nothing: no headings and no vault. A dialog with an empty Heading and Note tab still has
      // the URL field these tests drive.
      headings: (): readonly { readonly depth: number; readonly text: string }[] => [],
      searchNotes: (): readonly { readonly title: string; readonly relative: string }[] => [],
      onSubmit: (): void => {
        openWhenNotified.value = ref.element === null ? null : ref.element.open;
      },
    });
    activeDialogs.push(probe);

    const dialogs = document.body.querySelectorAll<HTMLDialogElement>('dialog.kdoc-link-dialog');
    const probeElement = dialogs[dialogs.length - 1];
    if (probeElement === undefined) {
      throw new Error('Probe dialog element was not attached to document.body');
    } else {
      // Probe dialog element found.
      ref.element = probeElement;
    }

    const probeForm = probeElement.querySelector<HTMLFormElement>('form');
    const probeUrl = probeElement.querySelector<HTMLInputElement>('input[type="url"]');
    if (probeForm === null || probeUrl === null) {
      throw new Error('Probe dialog is missing its form or url input');
    } else {
      // Probe dialog form and url input found.
    }

    probe.open(null);
    probeUrl.value = 'https://example.com';
    probeForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(openWhenNotified.value).toBe(false);
  });

  it('submits URL and title string when both fields are populated', () => {
    const { dialog, dialogElement, formElement, urlInput, titleInput, submitted } = mountDialog();

    dialog.open(null);
    urlInput.value = 'https://example.com';
    titleInput.value = 'Site Title';
    formElement.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(submitted.calls.length).toBe(1);
    expect(submitted.calls[0]).toEqual({
      href: 'https://example.com',
      title: 'Site Title',
    });
    expect(dialogElement.open).toBe(false);
  });

  it('handles close() and destroy() idempotently and removes dialog from document.body', () => {
    const { dialog, dialogElement } = mountDialog();

    dialog.open({ href: 'https://example.com', title: null });
    expect(dialogElement.open).toBe(true);

    expect(() => {
      dialog.close();
      dialog.close();
    }).not.toThrow();
    expect(dialogElement.open).toBe(false);

    expect(() => {
      dialog.destroy();
      dialog.destroy();
    }).not.toThrow();
    expect(document.body.contains(dialogElement)).toBe(false);
  });
});

describe('format painter button', () => {
  // Pins the brush's three states: a click turns the painter on for one use, a click while on turns it off, and a double-click turns it on locked (FR-8.3).
  it('turns the painter on, off again, and on locked on double-click', () => {
    const container = document.body.appendChild(document.createElement('div'));
    const pmMount = document.body.appendChild(document.createElement('div'));
    const binding = new ProseMirrorBinding({ session: new DocumentSession('Some **bold** text.\n'), mount: pmMount, plugins: [createFormatPainterPlugin()] });
    const toolbar = installFormatToolbar({
      container,
      view: binding.view,
      doc: document,
      requestLink: (): void => {
        // Not exercised here.
      },
      requestListPicker: (): void => {
        // Not exercised here.
      },
      requestStylesGallery: (): void => {
        // Not exercised here.
      },
    });
    const brush = button(container, 'Format Painter');

    brush.click();
    expect(formatPainterState(binding.view.state).marks).not.toBeNull();
    expect(brush.getAttribute('aria-pressed')).toBe('true');
    expect(brush.dataset['locked']).toBeUndefined();

    brush.click();
    expect(formatPainterState(binding.view.state).marks).toBeNull();
    expect(brush.getAttribute('aria-pressed')).toBe('false');

    brush.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(formatPainterState(binding.view.state).locked).toBe(true);
    expect(brush.dataset['locked']).toBe('true');

    toolbar.destroy();
    binding.destroy();
    container.remove();
    pmMount.remove();
  });
});

describe('keeping the caret while clicking a button', () => {
  it('prevents default on mousedown for every button', () => {
    const { container } = mountToolbar('Hello world.\n');
    const buttons = container.querySelectorAll('.kdoc-format-button');

    // Every button, not just the ones a test happens to name: the bug was that none of them did this,
    // and one button left unguarded is one command that silently acts on the wrong place.
    expect(buttons.length).toBeGreaterThan(0);

    for (const button of Array.from(buttons)) {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      button.dispatchEvent(event);

      // Without preventDefault the browser moves DOM focus to the button, the selection collapses, and
      // the command then runs against a caret at position 0 — bold did nothing and an inserted table
      // landed at the top of the document. jsdom does not move focus on mousedown, so this asserts the
      // guard is present rather than reproducing the browser behaviour it prevents.
      expect(event.defaultPrevented).toBe(true);
    }
  });
});

