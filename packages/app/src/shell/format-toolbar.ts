/**
 * @file format-toolbar.ts
 * @purpose Implements the formatting toolbar for K-Doc's WYSIWYG editor pane, providing controls for inline marks, block formatting, lists, links, and thematic breaks that execute ProseMirror commands and dynamically reflect active caret state.
 * @inputs FormatToolbarOptions containing container element, ProseMirror EditorView instance, Document context, and requestLink modal callback.
 * @outputs FormatToolbar interface with refresh() and destroy() lifecycle methods, alongside FORMAT_TOOLBAR_STYLES CSS stylesheet definition.
 * @functions
 *   - installFormatToolbar: Instantiates and mounts formatting toolbar controls, registers event listeners, and returns the FormatToolbar controller.
 * @dataflow User interaction -> ProseMirror Command execution -> EditorView state transaction -> caret/selection updates -> toolbar refresh() reflection.
 * @controlflow Mount toolbar button groups and separators -> attach click and change event listeners with AbortController -> execute initial refresh to reflect caret state -> return FormatToolbar interface with refresh and idempotent destroy.
 * @version 4
 * @date 2026-10-04
 */

import type { EditorView } from 'prosemirror-view';
import type { Command } from 'prosemirror-state';
import type { LinkAttrs } from '@k-doc/editor';
import { formatPainterState, pickUpFormat, stopFormatPainter } from '@k-doc/editor';
import {
  isMarkActive,
  indentList,
  outdentList,
  isBlockActive,
  toggleKdocMark,
  clearFormatting,
  setParagraph,
  setHeading,
  setCodeBlock,
  toggleBlockquote,
  toggleList,
  toggleTask,
  insertThematicBreak,
  activeLink,
  canLink,
  removeLink,
} from '@k-doc/editor';

export interface FormatToolbarOptions {
  readonly container: HTMLElement;
  readonly view: EditorView;
  readonly doc: Document;
  readonly requestLink: (current: LinkAttrs | null) => void;
  /** Opens the multi-level list gallery (FR-8.6). The toolbar owns the button, not the picker. */
  readonly requestListPicker: () => void;
  /** Opens the Styles gallery (FR-8.5). The toolbar owns the button, not the gallery. */
  readonly requestStylesGallery: () => void;
}

export interface FormatToolbar {
  refresh(): void;
  destroy(): void;
}

/**
 * Static stylesheet for the formatting toolbar, defining raised plateau control groups,
 * physical buttons (extruded at rest, depressed with a tonal selection when active),
 * and rounded corners using exclusively authoritative K-Doc chrome design tokens.
 */
export const FORMAT_TOOLBAR_STYLES: string = `
.kdoc-format-toolbar {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--kdoc-chrome-shadow-dark);
  background: var(--kdoc-chrome-base);
  color: var(--kdoc-chrome-text);
  flex-wrap: wrap;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-format-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-lg);
  padding: 12px;
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-format-separator {
  display: none;
}

.kdoc-format-button {
  min-width: 28px;
  min-height: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-pill);
  background: transparent;
  box-shadow: none;
  color: var(--kdoc-chrome-text);
  padding: 2px 6px;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  box-sizing: border-box;
  transition: box-shadow 0.15s ease, text-shadow 0.15s ease, color 0.15s ease, background 0.15s ease;
}

/* The UA stylesheet's [hidden] { display: none } loses to the class rule above, which sets
   display: inline-flex. Without this the Remove link button stays visible with no link to remove.
   jsdom does not apply the cascade, so no unit test can catch this — only a real browser can. */

.kdoc-format-button[hidden] {
  display: none !important;
}

.kdoc-format-button-small {
  font-size: 11px;
  padding: 2px 4px;
}

.kdoc-format-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-format-button:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-format-button:active:not(:disabled),
.kdoc-format-button[aria-pressed="true"] {
  background: var(--kdoc-chrome-accent);
  box-shadow: none;
  color: var(--kdoc-chrome-on-accent);
  border-color: var(--kdoc-chrome-accent);
  font-weight: 700;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-format-button:disabled {
  box-shadow: none;
  background: transparent;
  border-color: transparent;
  color: var(--kdoc-chrome-text-muted);
  opacity: 0.4;
  cursor: default;
}

.kdoc-format-bold {
  font-weight: bold;
}

.kdoc-format-italic {
  font-style: italic;
}

.kdoc-format-strike {
  text-decoration: line-through;
}

.kdoc-format-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 12px;
}

.kdoc-format-select {
  min-height: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: var(--kdoc-radius-md);
  background: var(--kdoc-chrome-base);
  box-shadow: var(--kdoc-elevation-raised);
  color: var(--kdoc-chrome-text);
  padding: 2px 6px;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  box-sizing: border-box;
  transition: box-shadow 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.kdoc-format-select:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-format-select:disabled {
  box-shadow: none;
  background: transparent;
  border-color: transparent;
  color: var(--kdoc-chrome-text-muted);
  opacity: 0.4;
  cursor: default;
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-format-toolbar * {
    transition: none !important;
  }
}
`;

/**
 * Installs the formatting toolbar controls into the specified container, wiring command execution and caret state reflection.
 *
 * @purpose Constructs and mounts inline, block, list, and insert formatting controls, wiring event listeners and caret synchronization.
 * @inputs options - FormatToolbarOptions containing the container DOM element, EditorView, Document context, and requestLink callback.
 * @outputs FormatToolbar - Controller exposing refresh and destroy lifecycle methods.
 * @dataflow Options -> toolbar DOM elements -> click/change event listeners -> ProseMirror commands & EditorView state -> refresh UI updates.
 * @controlflow Construct DOM elements across inline, block, list, and insert groups -> attach event listeners with AbortController -> perform initial refresh -> return FormatToolbar instance.
 */
export function installFormatToolbar(options: FormatToolbarOptions): FormatToolbar {
  const doc = options.doc;
  const abortController = new AbortController();
  const signal = abortController.signal;

  let destroyed = false;

  /**
   * Executes a ProseMirror command against the editor view, restoring focus and updating toolbar state.
   *
   * @purpose Runs a ProseMirror editing command, ensures editor view retains DOM focus for edit-lock invariant, and triggers toolbar refresh.
   * @inputs command - The ProseMirror Command function to execute.
   * @outputs void.
   * @dataflow command -> options.view.dispatch(tr) -> options.view.focus() -> refresh().
   * @controlflow Execute command with current editor state and dispatch -> focus editor view -> invoke refresh to update toolbar button states.
   */
  function runCommand(command: Command): void {
    command(options.view.state, options.view.dispatch);
    options.view.focus();
    refresh();
  }

  /**
   * Constructs an accessible toolbar button element configured with standard attributes and styling.
   *
   * @purpose Creates and configures a button element with type, text, title, aria-label, and CSS classes.
   * @inputs
   *   - text: string - The visible button text content.
   *   - title: string - Tooltip title text including label and keyboard shortcut.
   *   - ariaLabel: string - Accessible label for screen readers.
   *   - extraClass: string | undefined - Optional extra CSS class name for specific button styling.
   * @outputs HTMLButtonElement - The configured button element ready for DOM attachment.
   * @dataflow Button specifications -> DOM HTMLButtonElement creation and attribute population.
   * @controlflow Create button element -> set type to 'button' -> assign textContent, title, and aria-label -> apply CSS class names -> return element.
   */
  function createButton(
    text: string,
    title: string,
    ariaLabel: string,
    extraClass?: string,
  ): HTMLButtonElement {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.title = title;
    button.setAttribute('aria-label', ariaLabel);

    // Check if an additional CSS class is specified.
    if (extraClass !== undefined) {
      // Append extra class name to default format button class.
      button.className = `kdoc-format-button ${extraClass}`;
    } else {
      // Use baseline format button class name.
      button.className = 'kdoc-format-button';
    }


    // Keep the caret where the user left it. Without this, mousedown moves DOM focus out of the
    // ProseMirror contentDOM, the browser collapses the selection, and the command then runs against
    // a caret sitting at position 0 — bold silently did nothing and an inserted table landed at the
    // top of the document. preventDefault on mousedown suppresses the focus change while still
    // firing click, so the button acts on the selection the user can actually see.
    button.addEventListener(
      'mousedown',
      (event: MouseEvent): void => {
        event.preventDefault();
      },
      { signal },
    );

    return button;
  }

  /**
   * Creates a semantic grouping container for toolbar controls with accessibility attributes.
   *
   * @purpose Creates a div element configured as an accessible role="group" container with an aria-label.
   * @inputs ariaLabel - The descriptive label for the control group.
   * @outputs HTMLElement - The configured container element.
   * @dataflow ariaLabel string -> DOM HTMLElement with group role and aria-label.
   * @controlflow Create div element -> assign CSS class -> set role="group" and aria-label -> return element.
   */
  function createGroup(ariaLabel: string): HTMLElement {
    const group = doc.createElement('div');
    group.className = 'kdoc-format-group';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', ariaLabel);
    return group;
  }

  /**
   * Creates a visual and accessible separator element between toolbar control groups.
   *
   * @purpose Constructs a separator element with role="separator" and vertical orientation.
   * @inputs void.
   * @outputs HTMLElement - The configured separator element.
   * @dataflow DOM HTMLElement creation with separator role and vertical orientation.
   * @controlflow Create span element -> set CSS class -> assign role="separator" and aria-orientation="vertical" -> return element.
   */
  function createSeparator(): HTMLElement {
    const separator = doc.createElement('span');
    separator.className = 'kdoc-format-separator';
    separator.setAttribute('role', 'separator');
    separator.setAttribute('aria-orientation', 'vertical');
    return separator;
  }

  // Ensure container carries base formatting toolbar layout styling.
  options.container.classList.add('kdoc-format-toolbar');

  // ---------------------------------------------------------------------------
  // Group 1: Inline formatting controls (Bold, Italic, Strike, Code, Clear)
  // ---------------------------------------------------------------------------
  const inlineGroup = createGroup('Inline formatting');

  const boldButton = createButton('B', 'Bold (Ctrl+B)', 'Bold', 'kdoc-format-bold');
  boldButton.addEventListener(
    'click',
    (): void => {
      runCommand(toggleKdocMark('strong'));
    },
    { signal },
  );
  inlineGroup.appendChild(boldButton);

  const italicButton = createButton('I', 'Italic (Ctrl+I)', 'Italic', 'kdoc-format-italic');
  italicButton.addEventListener(
    'click',
    (): void => {
      runCommand(toggleKdocMark('emphasis'));
    },
    { signal },
  );
  inlineGroup.appendChild(italicButton);

  const strikeButton = createButton('S', 'Strikethrough (Ctrl+Shift+X)', 'Strikethrough', 'kdoc-format-strike');
  strikeButton.addEventListener(
    'click',
    (): void => {
      runCommand(toggleKdocMark('strikethrough'));
    },
    { signal },
  );
  inlineGroup.appendChild(strikeButton);

  const highlightButton = createButton('H', 'Highlight (Ctrl+Alt+H)', 'Highlight', 'kdoc-format-highlight');
  highlightButton.addEventListener(
    'click',
    (): void => {
      runCommand(toggleKdocMark('highlight'));
    },
    { signal },
  );
  inlineGroup.appendChild(highlightButton);

  const subscriptButton = createButton('X₂', 'Subscript (Ctrl+=)', 'Subscript', 'kdoc-format-subscript');
  subscriptButton.addEventListener(
    'click',
    (): void => {
      runCommand(toggleKdocMark('subscript'));
    },
    { signal },
  );
  inlineGroup.appendChild(subscriptButton);

  const superscriptButton = createButton('X²', 'Superscript (Ctrl+Shift+=)', 'Superscript', 'kdoc-format-superscript');
  superscriptButton.addEventListener(
    'click',
    (): void => {
      runCommand(toggleKdocMark('superscript'));
    },
    { signal },
  );
  inlineGroup.appendChild(superscriptButton);

  const codeButton = createButton('</>', 'Inline code (Ctrl+E)', 'Inline code', 'kdoc-format-code');
  codeButton.addEventListener(
    'click',
    (): void => {
      runCommand(toggleKdocMark('inlineCode'));
    },
    { signal },
  );
  inlineGroup.appendChild(codeButton);

  const clearButton = createButton('Tx', 'Clear formatting (Ctrl+Space)', 'Clear formatting');
  clearButton.addEventListener(
    'click',
    (): void => {
      runCommand(clearFormatting());
    },
    { signal },
  );
  inlineGroup.appendChild(clearButton);

  // Format Painter (FR-8.3): a click picks up the formatting for one use, a double-click keeps it on until Esc,
  // and a click while it is on turns it off. A double-click arrives as two clicks and then the dblclick, so the
  // clicks turn it on and off again before the dblclick turns it on locked.
  const painterButton = createButton('\u{1F58C}', 'Format Painter (Ctrl+Shift+C); double-click to keep it on until Esc', 'Format Painter');
  painterButton.addEventListener(
    'click',
    (): void => {
      // A painter that is already on is turned off by the brush, as in Word.
      if (formatPainterState(options.view.state).marks === null) {
        runCommand(pickUpFormat(false));
      } else {
        runCommand(stopFormatPainter());
      }
    },
    { signal },
  );
  painterButton.addEventListener(
    'dblclick',
    (): void => {
      runCommand(pickUpFormat(true));
    },
    { signal },
  );
  inlineGroup.appendChild(painterButton);

  options.container.appendChild(inlineGroup);
  options.container.appendChild(createSeparator());

  // ---------------------------------------------------------------------------
  // Group 2: Block formatting controls (Block type select, Code block, Quote)
  // ---------------------------------------------------------------------------
  const blockGroup = createGroup('Block formatting');

  const blockSelect = doc.createElement('select');
  blockSelect.className = 'kdoc-format-select';
  blockSelect.title = 'Block type (Body: Ctrl+Alt+0, Headings: Ctrl+Alt+1-6)';
  blockSelect.setAttribute('aria-label', 'Block type');

  const blockOptions: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
    { value: '0', label: 'Body' },
    { value: '1', label: 'Heading 1' },
    { value: '2', label: 'Heading 2' },
    { value: '3', label: 'Heading 3' },
    { value: '4', label: 'Heading 4' },
    { value: '5', label: 'Heading 5' },
    { value: '6', label: 'Heading 6' },
  ];

  for (const blockOption of blockOptions) {
    const opt = doc.createElement('option');
    opt.value = blockOption.value;
    opt.textContent = blockOption.label;
    blockSelect.appendChild(opt);
  }

  blockSelect.addEventListener(
    'change',
    (): void => {
      const selectedValue = blockSelect.value;
      // Check the selected option value to determine the appropriate block formatting command.
      if (selectedValue === '0') {
        // Option '0' corresponds to Body paragraph formatting.
        runCommand(setParagraph());
      } else if (
        selectedValue === '1' ||
        selectedValue === '2' ||
        selectedValue === '3' ||
        selectedValue === '4' ||
        selectedValue === '5' ||
        selectedValue === '6'
      ) {
        // Option '1'..'6' corresponds to Heading level 1..6.
        const headingLevel = parseInt(selectedValue, 10);
        runCommand(setHeading(headingLevel));
      } else {
        // Unrecognized selection value: restore editor focus and do not dispatch commands.
        options.view.focus();
      }
    },
    { signal },
  );
  blockGroup.appendChild(blockSelect);

  // The select stays alongside the gallery rather than being replaced by it. It is the fast path
  // for the seven styles a writer reaches for constantly and it carries the Ctrl+Alt+0..6 keys;
  // the gallery is the full set, quote and code and the five callouts, shown as what they look like.
  const stylesGalleryButton = createButton('Styles \u25be', 'Styles gallery', 'Styles gallery');
  stylesGalleryButton.addEventListener(
    'click',
    (): void => {
      options.requestStylesGallery();
    },
    { signal },
  );
  blockGroup.appendChild(stylesGalleryButton);

  const codeBlockButton = createButton('Code', 'Code block (Ctrl+Alt+C)', 'Code block');
  codeBlockButton.addEventListener(
    'click',
    (): void => {
      runCommand(setCodeBlock());
    },
    { signal },
  );
  blockGroup.appendChild(codeBlockButton);

  const blockquoteButton = createButton('Quote', 'Blockquote (Ctrl+Shift+Q)', 'Blockquote');
  blockquoteButton.addEventListener(
    'click',
    (): void => {
      runCommand(toggleBlockquote());
    },
    { signal },
  );
  blockGroup.appendChild(blockquoteButton);

  options.container.appendChild(blockGroup);
  options.container.appendChild(createSeparator());

  // ---------------------------------------------------------------------------
  // Group 3: List controls (Bullet list, Ordered list, Task item)
  // ---------------------------------------------------------------------------
  const listGroup = createGroup('Lists');

  const bulletListButton = createButton('Bullet', 'Bullet list (Ctrl+Shift+8)', 'Bullet list');
  bulletListButton.addEventListener(
    'click',
    (): void => {
      runCommand(toggleList('bullet'));
    },
    { signal },
  );
  listGroup.appendChild(bulletListButton);

  const orderedListButton = createButton('Numbered', 'Ordered list (Ctrl+Shift+7)', 'Ordered list');
  orderedListButton.addEventListener(
    'click',
    (): void => {
      runCommand(toggleList('ordered'));
    },
    { signal },
  );
  listGroup.appendChild(orderedListButton);

  const taskButton = createButton('Task', 'Task item (Ctrl+Shift+9)', 'Task item');
  taskButton.addEventListener(
    'click',
    (): void => {
      runCommand(toggleTask());
    },
    { signal },
  );
  listGroup.appendChild(taskButton);

  // The gallery is a separate control from the three toggles, because picking a scheme and a level
  // at once is a different act from turning the list under the caret on and off.
  const listGalleryButton = createButton('Lists \u25be', 'Multi-level list gallery', 'Multi-level list gallery');
  listGalleryButton.addEventListener(
    'click',
    (): void => {
      options.requestListPicker();
    },
    { signal },
  );
  listGroup.appendChild(listGalleryButton);

  // Indent and outdent existed only as Tab and Shift-Tab. A list operation that only a key can reach
  // is one a user who does not know the key cannot reach at all.
  const outdentButton = createButton('\u2190\u2261', 'Decrease list level (Shift+Tab)', 'Decrease list level');
  outdentButton.addEventListener(
    'click',
    (): void => {
      runCommand(outdentList());
    },
    { signal },
  );
  listGroup.appendChild(outdentButton);

  const indentButton = createButton('\u2261\u2192', 'Increase list level (Tab)', 'Increase list level');
  indentButton.addEventListener(
    'click',
    (): void => {
      runCommand(indentList());
    },
    { signal },
  );
  listGroup.appendChild(indentButton);

  options.container.appendChild(listGroup);
  options.container.appendChild(createSeparator());

  // ---------------------------------------------------------------------------
  // Group 4: Insert controls (Link, Remove link, Horizontal rule)
  // ---------------------------------------------------------------------------
  const insertGroup = createGroup('Insert');

  const linkButton = createButton('Link', 'Link (Ctrl+K)', 'Link');
  linkButton.addEventListener(
    'click',
    (): void => {
      const active = activeLink(options.view.state);
      // Check if an existing link mark is active under the caret.
      if (active !== null) {
        // Active link present: request dialog pre-filled with existing link attributes.
        options.requestLink(active.attrs);
      } else {
        // No active link: request dialog cleared for new link creation.
        options.requestLink(null);
      }
    },
    { signal },
  );
  insertGroup.appendChild(linkButton);

  const removeLinkButton = createButton('Unlink', 'Remove link', 'Remove link', 'kdoc-format-button-small');
  removeLinkButton.hidden = true;
  removeLinkButton.addEventListener(
    'click',
    (): void => {
      runCommand(removeLink());
    },
    { signal },
  );
  insertGroup.appendChild(removeLinkButton);

  const hrButton = createButton('Rule', 'Horizontal rule (Ctrl+Shift+-)', 'Horizontal rule');
  hrButton.addEventListener(
    'click',
    (): void => {
      runCommand(insertThematicBreak());
    },
    { signal },
  );
  insertGroup.appendChild(hrButton);

  options.container.appendChild(insertGroup);

  /**
   * Recomputes toolbar control states from the current ProseMirror editor state, updating aria-pressed, disabled, and selection values.
   *
   * @purpose Synchronizes all toolbar buttons and select controls with the active caret position and selection state.
   * @inputs void.
   * @outputs void.
   * @dataflow options.view.state -> mark/block/link queries -> button aria-pressed, disabled, hidden attributes, and select value.
   * @controlflow Check destroyed guard -> read editor state -> query marks for aria-pressed and dry-run disabled -> sync block select value without firing change events -> update blockquote and code block states -> query list states -> evaluate link and remove-link states -> update hr button state.
   */
  function refresh(): void {
    // Check if the component has already been destroyed.
    if (destroyed) {
      // Component is destroyed: abort refresh.
      return;
    } else {
      // Component is active: proceed with refreshing control states.
    }

    const state = options.view.state;

    // The brush shows as pressed while the painter is on, and says when it is locked.
    const painter = formatPainterState(state);
    painterButton.setAttribute('aria-pressed', painter.marks === null ? 'false' : 'true');
    // data-locked lets the style tell a locked painter from a single-use one.
    if (painter.locked && painter.marks !== null) {
      painterButton.dataset['locked'] = 'true';
    } else {
      delete painterButton.dataset['locked'];
    }

    // 1. Synchronize inline mark buttons
    // Check if strong mark is active at the current selection.
    if (isMarkActive(state, 'strong')) {
      boldButton.setAttribute('aria-pressed', 'true');
    } else {
      boldButton.setAttribute('aria-pressed', 'false');
    }
    // Check if strong mark toggle command can apply.
    if (toggleKdocMark('strong')(state)) {
      boldButton.disabled = false;
    } else {
      boldButton.disabled = true;
    }

    // Check if emphasis mark is active at the current selection.
    if (isMarkActive(state, 'emphasis')) {
      italicButton.setAttribute('aria-pressed', 'true');
    } else {
      italicButton.setAttribute('aria-pressed', 'false');
    }
    // Check if emphasis mark toggle command can apply.
    if (toggleKdocMark('emphasis')(state)) {
      italicButton.disabled = false;
    } else {
      italicButton.disabled = true;
    }

    // Check if strikethrough mark is active at the current selection.
    if (isMarkActive(state, 'strikethrough')) {
      strikeButton.setAttribute('aria-pressed', 'true');
    } else {
      strikeButton.setAttribute('aria-pressed', 'false');
    }
    // Check if strikethrough mark toggle command can apply.
    if (toggleKdocMark('strikethrough')(state)) {
      strikeButton.disabled = false;
    } else {
      strikeButton.disabled = true;
    }

    // Check if highlight mark is active at the current selection.
    if (isMarkActive(state, 'highlight')) {
      highlightButton.setAttribute('aria-pressed', 'true');
    } else {
      highlightButton.setAttribute('aria-pressed', 'false');
    }
    // Check if highlight mark toggle command can apply.
    if (toggleKdocMark('highlight')(state)) {
      highlightButton.disabled = false;
    } else {
      highlightButton.disabled = true;
    }

    // Check if subscript mark is active at the current selection.
    if (isMarkActive(state, 'subscript')) {
      subscriptButton.setAttribute('aria-pressed', 'true');
    } else {
      subscriptButton.setAttribute('aria-pressed', 'false');
    }
    // Check if subscript mark toggle command can apply.
    if (toggleKdocMark('subscript')(state)) {
      subscriptButton.disabled = false;
    } else {
      subscriptButton.disabled = true;
    }

    // Check if superscript mark is active at the current selection.
    if (isMarkActive(state, 'superscript')) {
      superscriptButton.setAttribute('aria-pressed', 'true');
    } else {
      superscriptButton.setAttribute('aria-pressed', 'false');
    }
    // Check if superscript mark toggle command can apply.
    if (toggleKdocMark('superscript')(state)) {
      superscriptButton.disabled = false;
    } else {
      superscriptButton.disabled = true;
    }

    // Check if inlineCode mark is active at the current selection.
    if (isMarkActive(state, 'inlineCode')) {
      codeButton.setAttribute('aria-pressed', 'true');
    } else {
      codeButton.setAttribute('aria-pressed', 'false');
    }
    // Check if inlineCode mark toggle command can apply.
    if (toggleKdocMark('inlineCode')(state)) {
      codeButton.disabled = false;
    } else {
      codeButton.disabled = true;
    }

    // Check if clearFormatting command can apply across current selection.
    if (clearFormatting()(state)) {
      clearButton.disabled = false;
    } else {
      clearButton.disabled = true;
    }

    // 2. Synchronize block-type select and block controls
    // Check which heading level or paragraph is active to update select value without firing change events.
    if (isBlockActive(state, 'heading', { level: 1 })) {
      blockSelect.value = '1';
    } else if (isBlockActive(state, 'heading', { level: 2 })) {
      blockSelect.value = '2';
    } else if (isBlockActive(state, 'heading', { level: 3 })) {
      blockSelect.value = '3';
    } else if (isBlockActive(state, 'heading', { level: 4 })) {
      blockSelect.value = '4';
    } else if (isBlockActive(state, 'heading', { level: 5 })) {
      blockSelect.value = '5';
    } else if (isBlockActive(state, 'heading', { level: 6 })) {
      blockSelect.value = '6';
    } else if (isBlockActive(state, 'paragraph')) {
      blockSelect.value = '0';
    } else {
      // Caret is inside a block that is neither paragraph nor heading: show blank without lying.
      blockSelect.selectedIndex = -1;
    }

    // Check whether paragraph or heading commands can apply to disable the select when inapplicable.
    if (setParagraph()(state) || setHeading(1)(state)) {
      blockSelect.disabled = false;
    } else {
      blockSelect.disabled = true;
    }

    // Check if codeBlock is active in selection ancestors.
    if (isBlockActive(state, 'codeBlock')) {
      codeBlockButton.setAttribute('aria-pressed', 'true');
    } else {
      codeBlockButton.setAttribute('aria-pressed', 'false');
    }
    // Check if setCodeBlock command can apply.
    if (setCodeBlock()(state)) {
      codeBlockButton.disabled = false;
    } else {
      codeBlockButton.disabled = true;
    }

    // Check if blockquote is active in selection ancestors.
    if (isBlockActive(state, 'blockquote')) {
      blockquoteButton.setAttribute('aria-pressed', 'true');
    } else {
      blockquoteButton.setAttribute('aria-pressed', 'false');
    }
    // Check if toggleBlockquote command can apply.
    if (toggleBlockquote()(state)) {
      blockquoteButton.disabled = false;
    } else {
      blockquoteButton.disabled = true;
    }

    // 3. Synchronize list controls
    // Check if bulletList is active in selection ancestors.
    if (isBlockActive(state, 'bulletList')) {
      bulletListButton.setAttribute('aria-pressed', 'true');
    } else {
      bulletListButton.setAttribute('aria-pressed', 'false');
    }
    // Check if toggleList('bullet') command can apply.
    if (toggleList('bullet')(state)) {
      bulletListButton.disabled = false;
    } else {
      bulletListButton.disabled = true;
    }

    // Check if orderedList is active in selection ancestors.
    if (isBlockActive(state, 'orderedList')) {
      orderedListButton.setAttribute('aria-pressed', 'true');
    } else {
      orderedListButton.setAttribute('aria-pressed', 'false');
    }
    // Check if toggleList('ordered') command can apply.
    if (toggleList('ordered')(state)) {
      orderedListButton.disabled = false;
    } else {
      orderedListButton.disabled = true;
    }

    // Check if outdentList command can apply.
    if (outdentList()(state)) {
      // Command can apply: enable button.
      outdentButton.disabled = false;
    } else {
      // Command cannot apply: disable button.
      outdentButton.disabled = true;
    }

    // Check if indentList command can apply. It refuses on the first item of a list, which has
    // nothing above it to nest under -- so the button correctly greys out there.
    if (indentList()(state)) {
      // Command can apply: enable button.
      indentButton.disabled = false;
    } else {
      // Command cannot apply: disable button.
      indentButton.disabled = true;
    }

    // Check if toggleTask command can apply on enclosing list item.
    if (toggleTask()(state)) {
      taskButton.disabled = false;
    } else {
      taskButton.disabled = true;
    }

    // 4. Synchronize link controls and horizontal rule
    const active = activeLink(state);
    // Check whether an active link covers the current selection.
    if (active !== null) {
      // Caret is inside an active link: indicate pressed state and reveal remove-link button.
      linkButton.setAttribute('aria-pressed', 'true');
      removeLinkButton.hidden = false;
    } else {
      // Caret is not in a link: unpressed state and hide remove-link button.
      linkButton.setAttribute('aria-pressed', 'false');
      removeLinkButton.hidden = true;
    }

    // Check whether a link could currently be applied or edited.
    if (canLink(state)) {
      linkButton.disabled = false;
    } else {
      linkButton.disabled = true;
    }

    // Check whether removeLink command can apply at current selection.
    if (removeLink()(state)) {
      removeLinkButton.disabled = false;
    } else {
      removeLinkButton.disabled = true;
    }

    // Check whether insertThematicBreak command can apply.
    if (insertThematicBreak()(state)) {
      hrButton.disabled = false;
    } else {
      hrButton.disabled = true;
    }
  }

  /**
   * Cleans up toolbar resources, aborting event listeners and emptying the container element.
   *
   * @purpose Idempotently tears down toolbar event listeners and removes child elements from the container.
   * @inputs void.
   * @outputs void.
   * @dataflow Aborts AbortController listeners -> empties options.container children -> marks destroyed true.
   * @controlflow Check destroyed flag (return if true) -> set destroyed to true -> abort listener controller -> replace container children.
   */
  function destroy(): void {
    // Check if the component has already been destroyed.
    if (destroyed) {
      // Already destroyed: return immediately for idempotent teardown.
      return;
    } else {
      // Active component: proceed with destruction.
      destroyed = true;
    }

    abortController.abort();
    options.container.replaceChildren();
  }

  // Execute initial refresh to synchronize toolbar state with the editor view's current selection.
  refresh();

  return {
    refresh,
    destroy,
  };
}
