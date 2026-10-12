// @vitest-environment jsdom
/**
 * @file presentation-mode.spec.ts
 * @purpose Exercises the presentation mode shell implementation in a simulated DOM to verify slide navigation, focus management, fullscreen transitions, image loading, link handling, and teardown behavior.
 * @inputs A deck of HTML slide fragments; keyboard and mouse events dispatched onto document.body or specific elements; an injectable image resolver, fullscreen gate, and link follower.
 * @outputs Assertions over presentation state (active flag, index, rendered text, counter), DOM mutations, and recorded fullscreen/error/resolved/followed side effects.
 * @functions
 *   - install: Wires a Presentation to the harness with spy callbacks and returns the captured side-effect arrays.
 *   - root: Locates the presentation container element or throws when absent.
 *   - slideText: Reads the current slide text content.
 *   - counter: Reads the rendered slide-counter text.
 *   - press: Dispatches a keydown event and returns it for defaultPrevented inspection.
 *   - flush: Resolves after the next macrotask so pending promises settle.
 * @dataflow install() builds a Presentation with harness spies → open()/next()/previous() drive DOM and recorded arrays → each it() asserts on those side effects.
 * @controlflow afterEach tears down installed presentations → describe groups scenarios → each it() installs, drives state, and asserts; async cases await flush().
 * @version 2
 * @date 2026-10-07
 */
import { afterEach, describe, expect, it } from 'vitest';
import { installPresentation } from '../src/shell/presentation-mode.js';
import type { Presentation } from '../src/shell/presentation-mode.js';

// Holds every installed Presentation so afterEach can destroy them without leaking listeners across tests.
const installed: Presentation[] = [];

afterEach(() => {
  for (const presentation of installed.splice(0)) {
    presentation.destroy();
  }
  document.body.replaceChildren();
});

interface Harness {
  presentation: Presentation;
  fullscreen: boolean[];
  errors: string[];
  resolved: string[];
  followed: string[];
}

// install builds a Presentation wired to the harness with spy callbacks and returns the captured side-effect arrays.
function install(resolve: (src: string) => Promise<string | null> = () => Promise.resolve(null), failFullscreen = false): Harness {
  const harness = { fullscreen: [] as boolean[], errors: [] as string[], resolved: [] as string[], followed: [] as string[] } as Harness;
  harness.presentation = installPresentation({
    doc: document,
    setFullscreen: (on) => {
      harness.fullscreen.push(on);
      return failFullscreen ? Promise.reject(new Error('denied')) : Promise.resolve();
    },
    resolveImage: (src) => {
      harness.resolved.push(src);
      return resolve(src);
    },
    onError: (message) => {
      harness.errors.push(message);
    },
    followLink: (href) => {
      harness.followed.push(href);
    },
  });
  installed.push(harness.presentation);
  return harness;
}

// root locates the presentation container element or throws when it is absent from the DOM.
function root(): HTMLElement {
  const found = document.querySelector<HTMLElement>('.kdoc-presentation');
  if (found === null) {
    throw new Error('no presentation');
  } else {
    return found;
  }
}

// slideText reads the current slide's text content, defaulting to an empty string when no slide exists.
function slideText(): string {
  return root().querySelector('.kdoc-slide')?.textContent ?? '';
}

// counter reads the rendered slide-counter text, defaulting to an empty string when absent.
function counter(): string {
  return root().querySelector('.kdoc-slide-counter')?.textContent ?? '';
}

// press dispatches a keydown event onto the given target and returns it for defaultPrevented inspection.
function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

// flush resolves after the next macrotask so pending promise chains settle before assertions.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const DECK = ['<h1>One</h1>', '<p>Two</p>', '<p>Three</p>'];

describe('presentation mode', () => {
  // Enters presentation on the first deck, asserting fullscreen, focus, and initial slide/counter state; reopening with a different deck must not disturb the current slide.
  it('opens full screen on the first slide and takes focus', () => {
    const h = install();
    const editor = document.body.appendChild(document.createElement('textarea'));
    editor.focus();
    h.presentation.open(DECK);
    expect(h.presentation.active).toBe(true);
    expect(root().hidden).toBe(false);
    expect(slideText()).toBe('One');
    expect(counter()).toBe('1 / 3');
    expect(document.activeElement).toBe(root());
    expect(h.fullscreen).toEqual([true]);
    h.presentation.open(['<p>Other</p>']);
    expect(slideText()).toBe('One');
    h.presentation.close();
    expect(document.activeElement).toBe(editor);
  });

  // Drives previous()/next() through every navigation key and confirms each is prevented while stopped at index 1, then checks End/Home/boundary behavior.
  it('moves with the navigation keys and stops at either end', () => {
    const h = install();
    h.presentation.open(DECK);
    for (const key of ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter']) {
      h.presentation.previous();
      h.presentation.previous();
      expect(press(key).defaultPrevented).toBe(true);
      expect(h.presentation.index).toBe(1);
    }
    for (const key of ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace']) {
      h.presentation.next();
      press(key);
      expect(h.presentation.index).toBe(1);
    }
    press('End');
    expect(counter()).toBe('3 / 3');
    press('ArrowRight');
    expect(h.presentation.index).toBe(2);
    press('Home');
    expect(slideText()).toBe('One');
    press('ArrowLeft');
    expect(h.presentation.index).toBe(0);
  });

  // Confirms an unopened presentation ignores editor keys, that an opened presentation swallows arrow keys in the editor, and that plain/modified modifier keys pass through.
  it('keeps presentation keys from the editor but leaves other and modified keys alone', () => {
    const h = install();
    const editor = document.body.appendChild(document.createElement('div'));
    let reached = 0;
    editor.addEventListener('keydown', () => {
      reached += 1;
    });
    press('ArrowRight', {}, editor);
    expect(reached).toBe(1);
    h.presentation.open(DECK);
    press('ArrowRight', {}, editor);
    expect(reached).toBe(1);
    expect(press('x', {}, editor).defaultPrevented).toBe(false);
    expect(press('ArrowRight', { ctrlKey: true }, editor).defaultPrevented).toBe(false);
    expect(press('ArrowRight', { metaKey: true }, editor).defaultPrevented).toBe(false);
    expect(press('ArrowRight', { altKey: true }, editor).defaultPrevented).toBe(false);
    expect(reached).toBe(5);
    expect(h.presentation.index).toBe(1);
  });

  // Exits via Escape, verifying hidden state, cleared slide, fullscreen restore, and that navigation resumes after leaving.
  it('leaves on Escape, restoring the window', () => {
    const h = install();
    h.presentation.open(DECK);
    press('Escape');
    expect(h.presentation.active).toBe(false);
    expect(root().hidden).toBe(true);
    expect(slideText()).toBe('');
    expect(h.fullscreen).toEqual([true, false]);
    expect(press('ArrowRight').defaultPrevented).toBe(false);
    h.presentation.close();
    expect(h.fullscreen).toEqual([true, false]);
  });

  // Verifies a link click is intercepted and handed to followLink (only when it has an href) without advancing, while a blank click advances the deck.
  it('advances on a click, and opens a link through the app instead of navigating', () => {
    const h = install();
    h.presentation.open(['<p><a href="https://example.com">link</a> <a>bare</a></p>', '<p>Two</p>']);
    const anchors = root().querySelectorAll('a');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchors[0]?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(h.followed).toEqual(['https://example.com']);
    expect(h.presentation.index).toBe(0);
    anchors[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(h.followed).toHaveLength(1);
    expect(h.presentation.index).toBe(0);
    root().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(h.presentation.index).toBe(1);
  });

  // Confirms an empty deck stays closed, hidden, records the expected error, and never requests fullscreen.
  it('reports an empty deck instead of opening', () => {
    const h = install();
    h.presentation.open([]);
    expect(h.presentation.active).toBe(false);
    expect(root().hidden).toBe(true);
    expect(h.errors).toEqual(['There is nothing to present: the document has no content.']);
    expect(h.fullscreen).toEqual([]);
  });

  // Loads only on-screen image sources through the resolver, leaves remote/alt-only images untouched, and resolves a deferred slow image when its slide appears.
  it('loads local images for the slide on screen only', async () => {
    let finish: ((url: string | null) => void) | null = null;
    const h = install((src) => (src === 'slow.png' ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(src === 'local.png' ? 'blob:local' : null)));
    h.presentation.open(['<p><img src="local.png"><img src="https://x/y.png"><img alt="none"></p>', '<p><img src="slow.png"></p>', '<p>Three</p>']);
    await flush();
    const images = [...root().querySelectorAll('img')];
    expect(images.map((image) => image.getAttribute('src'))).toEqual(['blob:local', 'https://x/y.png', null]);
    expect(h.resolved).toEqual(['local.png', 'https://x/y.png']);
    press('ArrowLeft');
    press('Home');
    expect(h.resolved).toEqual(['local.png', 'https://x/y.png']);
    h.presentation.next();
    const slow = root().querySelector('img');
    h.presentation.next();
    (finish as ((url: string | null) => void) | null)?.('blob:slow');
    await flush();
    expect(slow?.getAttribute('src')).toBe('slow.png');
  });

  // Leaves an unresolved image at its original src and records both the denied enter and denied leave fullscreen errors.
  it('keeps a failed image as written and reports a refused full screen', async () => {
    const h = install(() => Promise.reject(new Error('unreadable')), true);
    h.presentation.open(['<p><img src="missing.png"></p>']);
    await flush();
    expect(root().querySelector('img')?.getAttribute('src')).toBe('missing.png');
    expect(h.errors).toEqual(['Could not enter full screen: denied']);
    h.presentation.close();
    await flush();
    expect(h.errors[1]).toBe('Could not leave full screen: denied');
  });

  // After destroy, removes the container, restores fullscreen state, and stops intercepting navigation keys.
  it('stops listening and removes itself when destroyed', () => {
    const h = install();
    h.presentation.open(DECK);
    h.presentation.destroy();
    expect(document.querySelector('.kdoc-presentation')).toBeNull();
    expect(h.fullscreen).toEqual([true, false]);
    expect(press('ArrowRight').defaultPrevented).toBe(false);
    h.presentation.open(DECK);
    press('ArrowRight');
    expect(h.presentation.index).toBe(0);
  });
});
