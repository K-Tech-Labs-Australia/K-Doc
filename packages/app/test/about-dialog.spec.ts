// @vitest-environment jsdom
/**
 * @file about-dialog.spec.ts
 * @purpose Verifies installAboutDialog() behavior for the K-Doc About dialog.
 * @inputs DOM click events, a deferred host version promise, and resolved versions.
 * @outputs Assertions on visibility, version text, focus state, and element attributes.
 * @functions
 *   - deferred: Builds a controllable Promise<string> for simulating async host answers.
 *   - flush: Resolves after the current macrotask so pending microtasks settle.
 *   - versionText: Returns the rendered version paragraph text, or null when absent.
 * @dataflow Host promise → dialog render cycle → DOM node → test assertions.
 * @controlflow Install → open/close/destroy each scenario in isolation via afterEach cleanup.
 * @version 2
 * @date 2026-10-07
 */

import { afterEach, describe, expect, it } from 'vitest';
import { installAboutDialog, type AboutDialog } from '../src/shell/about-dialog.js';

const installed: AboutDialog[] = [];

afterEach(() => {
  for (const dialog of installed.splice(0)) {
    dialog.destroy();
  }
  document.body.replaceChildren();
});

function deferred(): { promise: Promise<string>; resolve: (value: string) => void; reject: (error: Error) => void } {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function versionText(): string | null {
  // Read the live paragraph text so assertions reflect post-render state.
  return document.querySelector('.kdoc-about-version')?.textContent ?? null;
}

describe('about-dialog', () => {
  it('starts closed and named after the product', async () => {
    const dialog = installAboutDialog({ doc: document, notices: () => Promise.resolve(''), version: () => Promise.resolve('1.2.3') });
    installed.push(dialog);

    expect(dialog.isOpen).toBe(false); // Not yet opened, so it must be hidden.

    const root = document.querySelector('.kdoc-about-dialog');
    expect(root?.getAttribute('aria-labelledby')).toBe('kdoc-about-heading');
    expect(
      document.getElementById('kdoc-about-heading')?.querySelector('[role="img"]')?.getAttribute('aria-label'),
    ).toBe('K-Doc');
  });

  it('shows the version once the host answers', async () => {
    const answer = deferred();
    const dialog = installAboutDialog({ doc: document, notices: () => Promise.resolve(''), version: () => answer.promise });
    installed.push(dialog);

    dialog.open(); // Render immediately with a pending placeholder.
    expect(dialog.isOpen).toBe(true);
    expect(versionText()).toBe('Version …'); // Placeholder shown while the host is queried.

    answer.resolve('0.4.0'); // Host resolves successfully after open().
    await flush();
    expect(versionText()).toBe('Version 0.4.0');
  });

  it('says unknown when the version cannot be read', async () => {
    const dialog = installAboutDialog({ doc: document, notices: () => Promise.resolve(''), version: () => Promise.reject(new Error('no host')) });
    installed.push(dialog);

    dialog.open(); // Rejection is caught and surfaced as a fallback label.
    await flush();
    expect(versionText()).toBe('Version unknown');
  });

  it('carries the K-Tech mark, slogan and credit', async () => {
    const dialog = installAboutDialog({ doc: document, notices: () => Promise.resolve(''), version: () => Promise.resolve('1.0.0') });
    installed.push(dialog);

    dialog.open(); // Branding is static markup present regardless of the host answer.
    expect(document.querySelector('.kdoc-about-maker svg.kdoc-brand-mark')?.getAttribute('aria-label')).toBe('K-Tech');
    expect(document.querySelector('.kdoc-brand-slogan')?.textContent).toBe('Real Innovation. Fast.');
    expect(document.querySelector('.kdoc-about-credit')?.textContent).toContain('K-Tech Labs');
  });

  it('focuses Close and closes with it', async () => {
    const dialog = installAboutDialog({ doc: document, notices: () => Promise.resolve(''), version: () => Promise.resolve('1.0.0') });
    installed.push(dialog);

    dialog.open(); // open() moves focus to the close control for keyboard users.
    expect(document.activeElement).toBe(document.querySelector('.kdoc-about-close'));

    document.querySelector<HTMLElement>('.kdoc-about-close')?.click(); // Activating Close dismisses it.
    expect(dialog.isOpen).toBe(false);
  });

  it('closes on a backdrop click but not a click inside', async () => {
    const dialog = installAboutDialog({ doc: document, notices: () => Promise.resolve(''), version: () => Promise.resolve('1.0.0') });
    installed.push(dialog);

    dialog.open(); // A click on inner content must be ignored to avoid accidental dismissal.
    document.querySelector('.kdoc-about-version')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dialog.isOpen).toBe(true);

    const root = document.querySelector<HTMLElement>('.kdoc-about-dialog');
    root?.dispatchEvent(new MouseEvent('click', { bubbles: true })); // Clicking the backdrop itself closes it.
    expect(dialog.isOpen).toBe(false);
  });

  it('ignores a late answer from an earlier opening', async () => {
    const first = deferred();
    let calls = 0;
    const dialog = installAboutDialog({ doc: document, notices: () => Promise.resolve(''), version: () => {
      calls += 1; // Count each open() to branch on the current activation.
      return calls === 1 ? first.promise : Promise.resolve('2.0.0'); // First opening awaits the deferred answer; later ones resolve immediately.
    }});
    installed.push(dialog);

    dialog.open(); // Opening #1 starts a query that never resolves in time.
    dialog.close(); // Closing cancels it before an answer arrives.
    dialog.open(); // Opening #2 queries again and settles with the fresh value.
    await flush();
    expect(versionText()).toBe('Version 2.0.0');

    first.resolve('1.0.0'); // The stale promise from opening #1 resolves late...
    await flush();
    expect(versionText()).toBe('Version 2.0.0'); // ...and must not overwrite the current value.
  });

  it('removes itself on destroy', async () => {
    const dialog = installAboutDialog({ doc: document, notices: () => Promise.resolve(''), version: () => Promise.resolve('1.0.0') });
    installed.splice(installed.indexOf(dialog), 1); // Detach before destroying so afterEach does not double-destroy.

    dialog.destroy(); // destroy() unmounts the dialog element from the DOM.
    expect(document.querySelector('.kdoc-about-dialog')).toBeNull();
  });
});
