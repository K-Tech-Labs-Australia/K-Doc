// @vitest-environment jsdom
/**
 * @file zen-mode.spec.ts
 * @purpose Tests installZenMode: chrome hiding, full-screen entry/exit, the transient hint, Escape handling, error reporting, and teardown.
 * @inputs The ZenMode implementation under test (../src/shell/zen-mode.js); a jsdom document with dialogs, key events, and fake timers.
 * @outputs Test assertions that pass or fail; no runtime values are produced beyond verification of side effects on the DOM and recorded calls.
 * @functions
 *   - install: Builds a Zen mode whose full-screen calls are recorded and can be made to fail.
 *   - hint: Finds the hint element, throwing if it is absent.
 *   - escape: Dispatches an Escape keydown and returns it.
 * @dataflow Test body → install()/enter()/toggle()/exit() → DOM mutations and async full-screen callbacks → expect() assertions.
 * @controlflow afterEach tears down prior modes; each it() drives the controller through a scenario and asserts state, branching on failure paths.
 * @version 1
 * @date 2026-09-16
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installZenMode, ZEN_CLASS, ZEN_MODE_STYLES } from '../src/shell/zen-mode.js';
import type { ZenMode } from '../src/shell/zen-mode.js';

const modes: ZenMode[] = [];

afterEach(() => {
  for (const mode of modes.splice(0)) {
    mode.destroy();
  }
  vi.useRealTimers();
  document.querySelectorAll('dialog').forEach((dialog) => dialog.remove());
});

// install builds a Zen mode whose full-screen calls are recorded and can be made to fail.
function install(fail = false): { zen: ZenMode; calls: boolean[]; errors: string[] } {
  const calls: boolean[] = [];
  const errors: string[] = [];
  const zen = installZenMode({
    doc: document,
    hintMs: 1000,
    setFullscreen: (fullscreen) => {
      calls.push(fullscreen);
      return fail ? Promise.reject(new Error('denied')) : Promise.resolve();
    },
    onError: (message) => {
      errors.push(message);
    },
  });
  modes.push(zen);
  return { zen, calls, errors };
}

// hint finds the hint element.
function hint(): HTMLElement {
  const found = document.querySelector<HTMLElement>('.kdoc-zen-hint');
  if (found === null) {
    throw new Error('no hint');
  } else {
    return found;
  }
}

// escape dispatches an Escape keydown and returns it.
function escape(): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  return event;
}

describe('zen mode', () => {
  // entering hides chrome, requests full screen, shows the hint for its time, and entering again does nothing.
  it('hides the chrome, goes full screen and shows the hint briefly', () => {
    vi.useFakeTimers();
    const { zen, calls } = install();
    zen.toggle();
    expect(zen.active).toBe(true);
    expect(document.body.classList.contains(ZEN_CLASS)).toBe(true);
    expect(calls).toEqual([true]);
    expect(hint().hidden).toBe(false);
    expect(hint().textContent).toBe('Zen mode. Press Esc to leave.');
    vi.advanceTimersByTime(999);
    expect(hint().hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(hint().hidden).toBe(true);
    zen.enter();
    expect(calls).toEqual([true]);
  });

  // toggling out restores and exiting twice does nothing.
  it('leaves on the command again, restoring the window', () => {
    const { zen, calls } = install();
    zen.enter();
    zen.toggle();
    expect(zen.active).toBe(false);
    expect(document.body.classList.contains(ZEN_CLASS)).toBe(false);
    expect(hint().hidden).toBe(true);
    expect(calls).toEqual([true, false]);
    zen.exit();
    expect(calls).toEqual([true, false]);
  });

  // exiting and re-entering restarts the hint timer.
  it('keeps a re-entered hint up for its full time', () => {
    vi.useFakeTimers();
    const { zen } = install();
    zen.enter();
    vi.advanceTimersByTime(800);
    zen.exit();
    zen.enter();
    vi.advanceTimersByTime(800);
    expect(hint().hidden).toBe(false);
  });

  // Escape outside Zen is ignored, a dialog or an already-handled Escape keeps Zen, other keys do nothing, a plain Escape leaves.
  it('leaves on Escape unless a dialog is open or the key was already handled', () => {
    const { zen } = install();
    expect(escape().defaultPrevented).toBe(false);
    zen.enter();
    const dialog = document.body.appendChild(document.createElement('dialog'));
    dialog.setAttribute('open', '');
    expect(escape().defaultPrevented).toBe(false);
    expect(zen.active).toBe(true);
    dialog.remove();
    const handled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    expect(zen.active).toBe(true);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(zen.active).toBe(true);
    expect(escape().defaultPrevented).toBe(true);
    expect(zen.active).toBe(false);
  });

  it('takes Escape before an editor that handles it, but leaves it to an open find bar', () => {
    // An editor that marks Escape handled while bubbling does not keep it from Zen; a visible find bar closes first.
    const { zen } = install();
    const editor = document.body.appendChild(document.createElement('div'));
    editor.addEventListener('keydown', (event) => {
      event.preventDefault();
    });
    zen.enter();
    const findBar = document.body.appendChild(document.createElement('div'));
    findBar.className = 'kdoc-find-bar';
    const first = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    editor.dispatchEvent(first);
    expect(zen.active).toBe(true);
    findBar.hidden = true;
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(zen.active).toBe(false);
    editor.remove();
    findBar.remove();
  });

  // a refused full screen is reported both ways.
  it('reports a window that refuses full screen but still hides the chrome', async () => {
    const { zen, errors } = install(true);
    zen.enter();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.body.classList.contains(ZEN_CLASS)).toBe(true);
    expect(errors).toEqual(['Could not enter full screen: denied']);
    zen.exit();
    await Promise.resolve();
    await Promise.resolve();
    expect(errors[1]).toBe('Could not leave full screen: denied');
  });

  // destroy leaves and removes the listener and hint (in the last lines the controller is destroyed, so entering only sets the class and Escape is no longer handled).
  it('leaves Zen and stops listening when destroyed', () => {
    const { zen, calls } = install();
    zen.enter();
    zen.destroy();
    expect(document.body.classList.contains(ZEN_CLASS)).toBe(false);
    expect(calls).toEqual([true, false]);
    expect(document.querySelector('.kdoc-zen-hint')).toBeNull();
    zen.enter();
    document.body.classList.remove(ZEN_CLASS);
    expect(escape().defaultPrevented).toBe(false);
  });

  // the stylesheet names each chrome part and never the panes.
  it('hides every piece of chrome and keeps the panes', () => {
    for (const selector of ['.kdoc-toolbar', '.kdoc-tab-bar', '.kdoc-ribbon', '.kdoc-format-toolbar', '.kdoc-table-toolbar', '.kdoc-breadcrumbs', '.kdoc-sidebar', '.kdoc-status', '.kdoc-key-hint']) {
      expect(ZEN_MODE_STYLES).toContain(`.${ZEN_CLASS} ${selector}`);
    }
    expect(ZEN_MODE_STYLES).not.toContain('.kdoc-panes');
    expect(ZEN_MODE_STYLES).not.toContain('.kdoc-pane ');
  });
});
