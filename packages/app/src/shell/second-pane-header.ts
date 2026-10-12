/**
 * @file second-pane-header.ts
 * @purpose The strip above the second pane saying what it holds (FR-6.9): its name, a read-only or edited note, and Save and Close buttons, so the reader can tell which document is shown and an unsaved edit has somewhere to declare itself.
 * @inputs A Document used to build DOM; the mount element that receives the strip; callbacks for Save and Close pressed by the reader.
 * @outputs A SecondPaneHeader whose setState updates the strip's name and note and toggles Save, and whose destroy removes it from the pane.
 * @functions
 *   - installSecondPaneHeader: Build the strip in its mount and return an object that keeps it saying what the pane holds (FR-6.9).
 * @dataflow Options with a Document, mount, onSave, onClose -> createElement calls build name, note, Save and Close nodes inserted first into the mount -> setState(state) rewrites textContent and the buttons' flags from a SecondPaneState.
 * @controlflow Create the strip elements, insert them before any existing child so the editor keeps the rest of the box, then return an object whose setState branches on name/readOnly/dirty to set what is shown; destroy removes the strip.
 * @version 3
 * @date 2026-10-03
 */

/** The class name applied to the second pane's header strip (FR-6.9). */
export const SECOND_PANE_HEADER_CLASS = 'kdoc-second-pane-header';

/**
 * Styles for the second pane's header strip (FR-6.9).
 * Restyled as a dark aero-glass overlay surface with physical buttons, emissive amber status note,
 * and rounded corners using exclusively authoritative K-Doc chrome design tokens.
 */
export const SECOND_PANE_HEADER_STYLES: string = `
.kdoc-second-pane-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--kdoc-chrome-container-low);
  border: 0;
  border-bottom: 1px solid var(--kdoc-chrome-glass-edge);
  border-radius: var(--kdoc-radius-xl);
  font-size: 0.85em;
  flex: 0 0 auto;
  color: var(--kdoc-chrome-text);
  box-sizing: border-box;
}

.kdoc-second-pane-header-name {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 650;
  color: var(--kdoc-chrome-text);
}

.kdoc-second-pane-header-note {
  color: var(--kdoc-chrome-text-muted);
  font-size: 11px;
  padding: 2px 6px;
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-second-pane-header button {
  flex: 0 0 auto;
  min-width: 28px;
  min-height: 26px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--kdoc-chrome-edge);
  border-radius: var(--kdoc-radius-pill);
  background: transparent;
  box-shadow: none;
  color: var(--kdoc-chrome-text);
  padding: 0 12px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  box-sizing: border-box;
  transition: color 0.15s ease, background 0.15s ease;
}

.kdoc-second-pane-header button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
  color: var(--kdoc-chrome-text);
}

.kdoc-second-pane-header button:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border-radius: var(--kdoc-radius-pill);
}

.kdoc-second-pane-header button:active:not(:disabled) {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
  color: var(--kdoc-chrome-accent);
}

.kdoc-second-pane-header button:disabled {
  box-shadow: none;
  background: transparent;
  border-color: transparent;
  border-style: dashed;
  color: var(--kdoc-chrome-text-muted);
  opacity: 1;
  cursor: default;
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-second-pane-header * {
    transition: none !important;
  }
}
`;

export interface SecondPaneHeaderOptions {
  readonly doc: Document;
  /** Where the strip is put: the second pane's own box, above the editor in it. */
  readonly mount: HTMLElement;
  /** Asked for when the reader presses Save. */
  readonly onSave: () => void;
  /** Asked for when the reader closes the pane. */
  readonly onClose: () => void;
}

export interface SecondPaneState {
  /** The file's name, or null when the pane is another view of the open document. */
  readonly name: string | null;
  readonly dirty: boolean;
  readonly readOnly: boolean;
}

export interface SecondPaneHeader {
  /** Says what the pane now holds, which decides the name and whether Save can be pressed. */
  setState(state: SecondPaneState): void;
  destroy(): void;
}

/**
 * Build the strip above the second pane and keep it saying what the pane holds (FR-6.9).
 * @purpose Builds the strip above the second pane and keeps it saying what the pane holds (FR-6.9).
 * @inputs options - The Document to build from, the mount element that receives the strip, and the onSave and onClose callbacks asked for when the reader presses either button.
 * @outputs SecondPaneHeader - An object whose setState updates the strip's name, note and Save button, and whose destroy removes the strip from the pane.
 * @dataflow options.doc builds each node; options.mount receives them first so the editor keeps the rest of the box; options.onSave/onClose are wired to the buttons' click events; setState rewrites those nodes from a SecondPaneState.
 * @controlflow Create name, note, Save and Close elements; insert the strip FIRST in the mount, before the editor's own element, so the editor built into the same box keeps the rest of it; wire the clicks; return an object whose setState branches on whether the pane holds its own file, disabling rather than hiding Save when there is nothing to save, because a button that comes and goes is harder to aim at than one that greys out.
 */
export function installSecondPaneHeader(options: SecondPaneHeaderOptions): SecondPaneHeader {
  const element = options.doc.createElement('div');
  element.className = SECOND_PANE_HEADER_CLASS;

  const name = options.doc.createElement('span');
  name.className = 'kdoc-second-pane-header-name';
  element.appendChild(name);

  const note = options.doc.createElement('span');
  note.className = 'kdoc-second-pane-header-note';
  element.appendChild(note);

  const save = options.doc.createElement('button');
  save.type = 'button';
  save.textContent = 'Save';
  save.addEventListener('click', (): void => { options.onSave(); });
  element.appendChild(save);

  const close = options.doc.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.setAttribute('aria-label', 'Close the second pane');
  close.addEventListener('click', (): void => { options.onClose(); });
  element.appendChild(close);

  // The strip goes first in the pane, so the editor built into the same box keeps the rest of it.
  options.mount.insertBefore(element, options.mount.firstChild);

  return {
    setState(state: SecondPaneState): void {
      // Check whether the pane holds a file of its own or is another view of the open document.
      if (state.name === null) {
        name.textContent = 'The same document';
      } else {
        // It holds its own file: show that file's name rather than a phrase standing in for it.
        name.textContent = state.name;
      }

      // Check what there is to say about it beyond its name. A file that cannot be written says so,
      // and one with edits not yet on disk says that instead; a clean writable file needs no note.
      if (state.readOnly) {
        note.textContent = 'Read-only';
      } else if (state.dirty) {
        // Writable, and holding edits that are not on disk: say so where the reader will see it.
        note.textContent = 'Edited';
      } else {
        // Clean and writable: there is nothing worth saying, so say nothing.
        note.textContent = '';
      }

      // Save is disabled rather than hidden when there is nothing to save: a button that comes and goes
      // is harder to aim at than one that greys out.
      save.disabled = state.name === null || state.readOnly || !state.dirty;
      // A pane holding the open document has no Save of its own, because Ctrl+S already saves it.
      save.hidden = state.name === null;
    },
    destroy(): void {
      element.remove();
    },
  };
}
