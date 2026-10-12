// @vitest-environment jsdom
/**
 * @file key-hint.spec.ts
 * @purpose Verifies the dismissible, auto-expiring key hint (installKeyHint) and its exported constants KEY_HINT_STYLES and KEY_HINT_TIMEOUT_MS against FR-20.1 behavior.
 * @inputs DOM created via a mount() helper; vitest fake timers for timeout assertions; the installKeyHint handle and exported constants under test.
 * @outputs void — no runtime output, only pass/fail assertions over hint state, rendered text, and style contents.
 * @functions
 *   - mount: Creates a container in document.body and returns it alongside a freshly installed KeyHint handle.
 *   - describe('the key hint'): Six scenarios covering hidden start, message rendering, dismiss, auto-timeout, destroy teardown, and theme-token styles.
 * @dataflow installKeyHint options → created div/span/button subtree appended to container; returned KeyHint handle exposes methods over that subtree; messages flow into show() → text node while timers drive auto-hide via clearTimer/hide.
 * @controlflow afterEach clears body and restores real timers; each test mounts, exercises the hint, asserts state, and relies on afterEach for cleanup.
 * @version 1
 * @date 2026-09-15
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { installKeyHint, KEY_HINT_STYLES, KEY_HINT_TIMEOUT_MS, type KeyHint } from '../src/shell/key-hint.js';

afterEach((): void => { document.body.replaceChildren(); vi.useRealTimers(); });

/**
 * Creates a fresh container and installs a key hint inside it for each test.
 * @purpose Provides an isolated DOM mount point so tests do not share state across cases.
 * @inputs None.
 * @outputs An object with the created container element and its installed KeyHint handle.
 * @dataflow document.createElement → appended to body → installKeyHint mounts subtree into it.
 * @controlflow Unconditional single path: create, append, install, return.
 */
function mount(): { container: HTMLDivElement; hint: KeyHint } {
  const container = document.createElement('div');
  document.body.append(container);
  return { container, hint: installKeyHint({ doc: document, container }) };
}

describe('the key hint', (): void => {
  it('starts hidden inside its container as a status line', (): void => {
    const { container, hint } = mount();
    expect(hint.element.parentElement).toBe(container);
    expect(hint.isShown).toBe(false);
    expect(hint.element.hidden).toBe(true);
    expect(hint.element.getAttribute('role')).toBe('status');
  });

  it('shows a message as text', (): void => {
    const { hint } = mount();
    hint.show('<b>No underline</b>');
    expect(hint.isShown).toBe(true);
    expect(hint.element.querySelector('.kdoc-key-hint-text')?.textContent).toBe('<b>No underline</b>');
    expect(hint.element.querySelector('b')).toBeNull();
  });

  it('goes when dismissed', (): void => {
    const { hint } = mount();
    hint.show('x');
    hint.element.querySelector<HTMLButtonElement>('.kdoc-key-hint-dismiss')?.click();
    expect(hint.isShown).toBe(false);
    expect(hint.element.querySelector('.kdoc-key-hint-text')?.textContent).toBe('');
  });

  it('goes by itself after its timeout, counted from the latest message', (): void => {
    vi.useFakeTimers();
    const { hint } = mount();
    hint.show('first');
    vi.advanceTimersByTime(KEY_HINT_TIMEOUT_MS - 1000);
    hint.show('second');
    vi.advanceTimersByTime(KEY_HINT_TIMEOUT_MS - 1);
    expect(hint.isShown).toBe(true);
    expect(hint.element.querySelector('.kdoc-key-hint-text')?.textContent).toBe('second');
    vi.advanceTimersByTime(1);
    expect(hint.isShown).toBe(false);
  });

  it('is removed on destroy and shows nothing afterwards', (): void => {
    const { container, hint } = mount();
    hint.destroy();
    hint.destroy();
    expect(container.children.length).toBe(0);
    hint.show('late');
    expect(hint.isShown).toBe(false);
  });

  it('styles in theme tokens', (): void => {
    expect(KEY_HINT_STYLES).toContain('.kdoc-key-hint-dismiss');
    expect(KEY_HINT_STYLES).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
