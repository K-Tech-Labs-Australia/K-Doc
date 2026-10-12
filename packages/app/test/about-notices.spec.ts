// @vitest-environment jsdom
/**
 * @file about-notices.spec.ts
 * @purpose Verifies the third-party notices viewer wired into the About dialog by installAboutDialog().
 * @inputs DOM clicks on button.kdoc-about-notices-button; promises returned by injected notices().
 * @outputs Assertions over pre.kdoc-about-notices visibility/text and the toggle's aria-expanded.
 * @functions mount: installs+opens a dialog with a given loader; button: returns the toggle button; view: returns the <pre>.
 * @dataflow Test → installAboutDialog() → DOM node under test → assertions after flush().
 * @controlflow mount each case, assert initial state, click to toggle, await macrotask, assert result.
 * @version 1
 * @date 2026-10-07
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { installAboutDialog, type AboutDialog } from '../src/shell/about-dialog.js';

const installed: AboutDialog[] = [];

afterEach(() => {
  for (const d of installed.splice(0)) {
    d.destroy();
  }
  document.body.replaceChildren();
});

// Resolve pending macrotasks so notices() promises settle before assertions.
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** button returns the footer "Third-party notices" toggle control. */
function button(): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>('button.kdoc-about-notices-button');
  if (el === null) {
    throw new Error('notices toggle button not found in document.body'); // fail fast when the node is absent.
  }
  return el;
}

/** view returns the notices <pre> panel rendered inside the dialog. */
function view(): HTMLPreElement {
  const el = document.querySelector<HTMLPreElement>('pre.kdoc-about-notices');
  if (el === null) {
    throw new Error('notices pre element not found in document.body'); // fail fast when the node is absent.
  }
  return el;
}

/** mount installs and opens an About dialog bound to the supplied notices loader. */
function mount(notices: () => Promise<string>): AboutDialog {
  const d = installAboutDialog({ doc: document, version: () => Promise.resolve('1.0.0'), notices });
  installed.push(d); // register for teardown so afterEach() destroys it later.
  d.open();
  return d;
}

describe('about dialog third-party notices', () => {
  it('keeps the notices out of the way until asked', () => {
    mount(vi.fn(() => Promise.resolve('x')));
    expect(view().hidden).toBe(true);
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(button().textContent).toBe('Third-party notices');
  });

  it('loads the notices the first time they are shown', async () => {
    const notices = vi.fn(() => Promise.resolve('MIT License text'));
    mount(notices);
    button().click();
    expect(view().hidden).toBe(false);
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(view().textContent).toBe('Loading…'); // placeholder shown while the loader runs.
    await flush();
    expect(view().textContent).toBe('MIT License text');
    expect(notices).toHaveBeenCalledTimes(1);
  });

  it('does not fetch them again', async () => {
    const notices = vi.fn(() => Promise.resolve('MIT License text'));
    mount(notices);
    button().click();
    await flush();
    // Hide the panel: pre becomes hidden and aria-expanded flips back to false.
    button().click();
    expect(view().hidden).toBe(true);
    expect(button().getAttribute('aria-expanded')).toBe('false');
    // Show again after a successful load; notices() must not run a second time.
    button().click();
    await flush();
    expect(notices).toHaveBeenCalledTimes(1);
    expect(view().textContent).toBe('MIT License text');
  });

  it('explains a missing notices file and retries', async () => {
    let calls = 0;
    const notices = vi.fn(() => {
      calls += 1;
      // First attempt fails to simulate a missing release-build artifact.
      return calls === 1 ? Promise.reject(new Error('404')) : Promise.resolve('Now here');
    });
    mount(notices);
    button().click();
    await flush();
    expect(view().textContent).toBe(
      'The third-party notices are generated for release builds (npm run notices).'
    );
    // Hide then show again: the loader is retried after a prior rejection.
    button().click();
    button().click();
    await flush();
    expect(view().textContent).toBe('Now here');
    expect(notices).toHaveBeenCalledTimes(2);
  });
});
