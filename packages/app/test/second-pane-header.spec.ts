// @vitest-environment jsdom
/**
 * @file second-pane-header.spec.ts
 * @purpose Tests the strip above the second pane (FR-6.9): that it sits above the editor, states its name and edited/read-only note, toggles Save, fires callbacks on press, and removes itself on destroy.
 * @inputs The installed header handle from installSecondPaneHeader; a stand-in editor element mounted in each test's pane.
 * @outputs Assertions over the strip's rendered text and button flags via parts(); callback invocations recorded by tests.
 * @functions
 *   - strip: Build a fresh pane with a stand-in editor, install the header over it, record and return it.
 *   - parts: Read the strip's name, note and buttons out of the DOM, throwing when one is missing.
 * @dataflow strip() installs into jsdom -> setState(state) rewrites nodes -> parts() reads them back for expect().
 * @controlflow afterEach tears down every built header; each test builds a pane, sets state, then asserts on rendered pieces or button clicks before teardown runs again.
 * @version 1
 * @date 2026-09-18
 */

import { afterEach, describe, expect, it } from 'vitest';
import { installSecondPaneHeader, SECOND_PANE_HEADER_CLASS, type SecondPaneHeader } from '../src/shell/second-pane-header.js';

const built: SecondPaneHeader[] = [];
let mount: HTMLElement | null = null;

afterEach((): void => {
  for (const header of built.splice(0)) {
    header.destroy();
  }
  mount?.remove();
  mount = null;
});

/**
 * Build a fresh pane, install the header over it, return it for cleanup.
 * @purpose Builds a test pane containing a stand-in editor so the suite can prove the strip goes above that editor, installs the real header over it, records it for teardown and returns it.
 * @inputs onSave - Optional callback asked for when Save is pressed; defaults to a no-op.
 * @inputs onClose - Optional callback asked for when Close is pressed; defaults to a no-op.
 * @outputs SecondPaneHeader - The installed strip handle, recorded so afterEach can destroy it.
 * @dataflow Options with default callbacks -> installSecondPaneHeader builds the strip in the pane -> header pushed onto built and returned.
 * @controlflow Create the pane and stand-in editor, mount them, call installSecondPaneHeader, record the result, return it; no branching.
 */
function strip(onSave?: () => void, onClose?: () => void): SecondPaneHeader {
  const pane = document.body.appendChild(document.createElement('div'));
  const editor = document.createElement('div');
  editor.className = 'stand-in-editor';
  pane.appendChild(editor);
  mount = pane;
  const header = installSecondPaneHeader({
    doc: document,
    mount: pane,
    onSave: onSave ?? ((): void => { }),
    onClose: onClose ?? ((): void => { }),
  });
  built.push(header);
  return header;
}

/**
 * Read the strip's pieces out of the DOM, throwing when one is missing.
 * @purpose Extracts name text, note text and the Save/Close buttons from the installed strip so tests assert on real nodes rather than undefined.
 * @inputs - Nothing; reads whatever strip installSecondPaneHeader left in the document.
 * @outputs { name: string; note: string; save: HTMLButtonElement; close: HTMLButtonElement } - The two text pieces and the two buttons, or an error if any is absent.
 * @dataflow querySelector for the strip -> querySelector/queryAll for its children -> returned object carries their values.
 * @controlflow Find the strip (throw 'no strip' when missing) then read each piece; throw 'incomplete strip' unless name and note are present and both buttons are HTMLButtonElement instances, else return them.
 */
function parts(): { name: string; note: string; save: HTMLButtonElement; close: HTMLButtonElement } {
  const element = document.querySelector(`.${SECOND_PANE_HEADER_CLASS}`);
  // Check that the strip is in the document at all.
  if (element === null) {
    throw new Error('no strip');
  } else {
    // It is: read its pieces.
  }
  const name = element.querySelector('.kdoc-second-pane-header-name');
  const note = element.querySelector('.kdoc-second-pane-header-note');
  const buttons = element.querySelectorAll('button');
  const save = buttons[0];
  const close = buttons[1];
  // Check that every piece is there. A strip missing one of them is a bug, not a state to assert about.
  if (name === null || note === null || !(save instanceof HTMLButtonElement) || !(close instanceof HTMLButtonElement)) {
    throw new Error('incomplete strip');
  } else {
    // All there.
  }
  return { name: name.textContent ?? '', note: note.textContent ?? '', save, close };
}

describe('the strip above the second pane', (): void => {

  it('goes above the editor in the pane', (): void => {
    strip();
    const pane = document.querySelector('.stand-in-editor')?.parentElement;
    expect(pane?.firstElementChild?.className).toBe(SECOND_PANE_HEADER_CLASS);
    // The editor keeps the rest of the box, so the strip has to be first rather than last.
  });

  it('says it is the same document when the pane holds no file of its own', (): void => {
    const header = strip();
    header.setState({ name: null, dirty: false, readOnly: false });
    expect(parts().name).toBe('The same document');
    // There is nothing of its own to save, and Ctrl+S already saves the open document.
    expect(parts().save.hidden).toBe(true);
  });

  it('names the file the pane holds', (): void => {
    const header = strip();
    header.setState({ name: 'other.md', dirty: false, readOnly: false });
    expect(parts().name).toBe('other.md');
    expect(parts().save.hidden).toBe(false);
    // Nothing has been changed, so there is nothing to save yet.
    expect(parts().save.disabled).toBe(true);
    expect(parts().note).toBe('');
  });

  it('says when it holds edits that are not on disk', (): void => {
    const header = strip();
    header.setState({ name: 'other.md', dirty: true, readOnly: false });
    expect(parts().note).toBe('Edited');
    expect(parts().save.disabled).toBe(false);
  });

  it('says when the file will not take a write', (): void => {
    // A file that cannot be written says so rather than offering a Save that would fail.
    const header = strip();
    header.setState({ name: 'other.md', dirty: true, readOnly: true });
    expect(parts().note).toBe('Read-only');
    expect(parts().save.disabled).toBe(true);
  });

  it('goes back to saying nothing once it is saved', (): void => {
    const header = strip();
    header.setState({ name: 'other.md', dirty: true, readOnly: false });
    header.setState({ name: 'other.md', dirty: false, readOnly: false });
    expect(parts().note).toBe('');
    expect(parts().save.disabled).toBe(true);
  });

  it('asks to save and to close when its buttons are pressed', (): void => {
    const calls: string[] = [];
    const header = strip((): void => { calls.push('save'); }, (): void => { calls.push('close'); });
    header.setState({ name: 'other.md', dirty: true, readOnly: false });
    parts().save.click();
    parts().close.click();
    expect(calls).toEqual(['save', 'close']);
  });

  it('leaves nothing behind when it is destroyed', (): void => {
    const header = strip();
    header.destroy();
    expect(document.querySelector(`.${SECOND_PANE_HEADER_CLASS}`)).toBeNull();
    // Destroying twice is what a rebuild does, and must not throw.
    header.destroy();
  });

});
