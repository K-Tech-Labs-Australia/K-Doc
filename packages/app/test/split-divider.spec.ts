// @vitest-environment jsdom

/**
 * @file split-divider.spec.ts
 * @purpose Vitest suite exercising installSplitDivider's keyboard-driven ratio control, ARIA separator semantics, and lifecycle methods in a jsdom environment.
 * @inputs SplitDivider controller returned by installSplitDivider; synthetic KeyboardEvents dispatched on the divider element.
 * @outputs Boolean pass/fail assertions over ratio, pane flex styles, ARIA attributes, and event default behavior.
 * @functions
 *   - mount: Builds an isolated container with two panes and a divider, installs a SplitDivider, and returns references for assertions.
 *   - key: Dispatches a synthetic keydown KeyboardEvent on an element and returns the event for defaultPrevented inspection.
 * @dataflow mount() builds DOM → installSplitDivider wires listeners → key() fires keyboard events → handler updates ratio/aria → expect() asserts state.
 * @controlflow beforeEach resets shared arrays → each test mounts a fresh divider → exercises API or keys → afterEach tears down all dividers and containers.
 * @version 1
 * @date 2026-09-05
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { installSplitDivider, type SplitDivider, type DividerOrientation } from '../src/shell/split-divider.js';

// jsdom reports zero for every layout measurement, so getBoundingClientRect returns all zeros and the
// pointer-drag arithmetic cannot be exercised meaningfully. Faking a rect would only prove the
// arithmetic matches itself, so the pointer path is left to the browser and the keyboard path -- which
// is the one a WCAG claim rests on -- is tested here instead.

/** Containers appended to document.body during a test, tracked for teardown in afterEach. */
let mounts: HTMLElement[] = [];

/** Controllers installed during a test, destroyed in afterEach before their containers are removed. */
let dividers: SplitDivider[] = [];

beforeEach((): void => {
  // Reset both tracking arrays so each test starts from an empty fixture set.
  mounts = [];
  dividers = [];
});

afterEach((): void => {
  // Destroy every controller first so inline styles and listeners are cleared before DOM removal.
  for (const divider of dividers) {
    divider.destroy();
  }
  // Detach each container from the document when it still has a parent, guarding against double-removal.
  for (const mount of mounts) {
    if (mount.parentNode !== null) {
      mount.parentNode.removeChild(mount);
    }
  }
  // Clear tracking arrays so no state leaks into the next test.
  mounts = [];
  dividers = [];
});

/**
 * @purpose Constructs an isolated split-view fixture with two panes and a divider, installs a SplitDivider on it, and tracks both for teardown.
 * @inputs void.
 * @outputs container, first, second, element, divider — references to the DOM nodes and the controller under test.
 * @dataflow createElement calls → appendChild into body → installSplitDivider(options) → push controllers and containers onto shared arrays.
 * @controlflow Build container → build first/element/second panes in order → install divider with those panes → record everything for afterEach cleanup.
 */
function mount(orientation?: DividerOrientation): {
  container: HTMLElement;
  first: HTMLElement;
  second: HTMLElement;
  element: HTMLElement;
  divider: SplitDivider;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  mounts.push(container);

  const first = document.createElement('div');
  container.appendChild(first);

  const element = document.createElement('div');
  container.appendChild(element);

  const second = document.createElement('div');
  container.appendChild(second);

  const divider = installSplitDivider({ element, doc: document, first, second, container, ...(orientation === undefined ? {} : { orientation }) });
  dividers.push(divider);

  return { container, first, second, element, divider };
}

/**
 * @purpose Fires a synthetic keydown event on an element to drive the divider's keyboard handler and returns the event for assertion.
 * @inputs element — target HTMLElement receiving the keydown; name — the KeyboardEvent.key value (e.g. 'ArrowRight').
 * @outputs KeyboardEvent — the dispatched event, whose defaultPrevented reflects whether the handler consumed it.
 * @dataflow new KeyboardEvent(...) → dispatchEvent on element → return event.
 * @controlflow Construct cancelable, bubbling keydown with the given key → dispatch synchronously → hand back the same event instance.
 */
function key(element: HTMLElement, name: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
}

describe('SplitDivider', () => {
  it('starts at an even split', (): void => {
    const { divider, first, second } = mount();

    // Reading flexGrow rather than flex: assigning style.flex = '0.5' makes the CSSOM expand it to the
    // shorthand '0.5 1 0%', so an assertion on `flex` measures the serializer, not the ratio.
    expect(divider.ratio).toBe(0.5);
    expect(first.style.flexGrow).toBe('0.5');
    expect(second.style.flexGrow).toBe('0.5');
  });

  it('applies a requested ratio to both panes', (): void => {
    const { divider, first, second } = mount();

    divider.setRatio(0.7);

    expect(first.style.flexGrow).toBe('0.7');
    expect(second.style.flexGrow).toBe('0.3');
  });

  it('clamps a zero ratio to the minimum', (): void => {
    const { divider } = mount();

    divider.setRatio(0);

    // A pane dragged to zero width cannot be dragged back, because there is nothing left to grab.
    expect(divider.ratio).toBe(0.15);
  });

  it('clamps an oversized ratio to the maximum', (): void => {
    const { divider } = mount();

    divider.setRatio(1);

    expect(divider.ratio).toBe(0.85);
  });

  it('keeps the two flex values summing to one', (): void => {
    const { divider, first, second } = mount();

    divider.setRatio(0.7);

    // A floating-point trap: 1 - 0.85 is 0.15000000000000002 in IEEE 754, which is why the source rounds.
    expect(Number(first.style.flexGrow) + Number(second.style.flexGrow)).toBe(1);
  });

  it('never sets a pixel width', (): void => {
    const { divider, first, second } = mount();

    divider.setRatio(0.7);

    // A pixel width would freeze the layout at whatever the window happened to be.
    expect(first.style.width).toBe('');
    expect(second.style.width).toBe('');
  });

  it('resets to an even split', (): void => {
    const { divider } = mount();

    divider.setRatio(0.8);
    divider.reset();

    expect(divider.ratio).toBe(0.5);
  });

  it('exposes separator semantics', (): void => {
    const { element } = mount();

    expect(element.getAttribute('role')).toBe('separator');
    expect(element.getAttribute('aria-orientation')).toBe('vertical');
    expect(element.getAttribute('tabindex')).toBe('0');
    expect(element.getAttribute('aria-label')).not.toBeNull();
  });

  it('keeps aria-valuenow in step as a percentage', (): void => {
    const { element, divider } = mount();

    expect(element.getAttribute('aria-valuenow')).toBe('50');

    divider.setRatio(0.7);
    expect(element.getAttribute('aria-valuenow')).toBe('70');

    expect(element.getAttribute('aria-valuemin')).toBe('15');
    expect(element.getAttribute('aria-valuemax')).toBe('85');
  });

  it('moves the ratio with the arrow keys', (): void => {
    const { divider, element } = mount();

    const before = divider.ratio;

    key(element, 'ArrowRight');
    // ArrowRight nudges the first pane wider, so the ratio must increase above the starting value.
    expect(divider.ratio).toBeGreaterThan(before);

    key(element, 'ArrowLeft');
    key(element, 'ArrowLeft');
    // Two left steps (2% each) overtake the single right step, dropping below the starting value.
    expect(divider.ratio).toBeLessThan(before);
  });

  it('jumps to the bounds with Home and End', (): void => {
    const { divider, element } = mount();

    key(element, 'Home');
    // Home jumps directly to the minimum ratio boundary.
    expect(divider.ratio).toBe(0.15);

    key(element, 'End');
    // End jumps directly to the maximum ratio boundary.
    expect(divider.ratio).toBe(0.85);
  });

  it('resets with Enter', (): void => {
    const { divider, element } = mount();

    divider.setRatio(0.8);
    key(element, 'Enter');

    // Enter restores the even 50/50 split regardless of the current ratio.
    expect(divider.ratio).toBe(0.5);
  });

  it('prevents default on the keys it handles', (): void => {
    const { element } = mount();

    // Home and End would otherwise scroll the pane while the user is trying to resize it.
    for (const keyName of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter']) {
      const event = key(element, keyName);
      expect(event.defaultPrevented).toBe(true);
    }
  });

  it('ignores an unrelated key', (): void => {
    const { divider, element } = mount();

    const before = divider.ratio;
    const event = key(element, 'a');

    // An unhandled key must leave the ratio untouched and fall through to default processing.
    expect(divider.ratio).toBe(before);
    expect(event.defaultPrevented).toBe(false);
  });

  it('clears the inline flex on destroy', (): void => {
    const { divider, first, second } = mount();

    divider.setRatio(0.7);
    divider.destroy();

    // Destroying removes the inline flex so stylesheet defaults take over again.
    expect(first.style.flex).toBe('');
    expect(second.style.flex).toBe('');
  });

  it('destroys idempotently', (): void => {
    const { divider } = mount();

    expect(() => {
      divider.destroy();
      divider.destroy();
    }).not.toThrow();
  });

  it('ignores setRatio after destroy', (): void => {
    const { divider } = mount();

    divider.destroy();

    // A destroyed controller must swallow further ratio updates without throwing.
    expect(() => {
      divider.setRatio(0.7);
    }).not.toThrow();
  });

  describe('orientation (editor.splitOrientation)', () => {
    it('runs vertically between side-by-side panes by default', (): void => {
      const { divider, element } = mount();
      expect(divider.orientation).toBe('vertical');
      expect(element.classList.contains('kdoc-split-divider-horizontal')).toBe(false);
    });

    it('runs horizontally between stacked panes when asked', (): void => {
      const { divider, element } = mount('horizontal');
      expect(divider.orientation).toBe('horizontal');
      expect(element.getAttribute('aria-orientation')).toBe('horizontal');
      expect(element.classList.contains('kdoc-split-divider-horizontal')).toBe(true);
    });

    it('switches orientation in place and keeps the ratio', (): void => {
      const { divider, element, first } = mount();
      divider.setRatio(0.7);
      divider.setOrientation('horizontal');
      expect(element.getAttribute('aria-orientation')).toBe('horizontal');
      expect(divider.ratio).toBe(0.7);
      expect(first.style.flexGrow).toBe('0.7');
      divider.setOrientation('vertical');
      expect(element.getAttribute('aria-orientation')).toBe('vertical');
      expect(element.classList.contains('kdoc-split-divider-horizontal')).toBe(false);
    });

    it('moves with ArrowUp and ArrowDown, in either orientation', (): void => {
      const { divider, element } = mount('horizontal');
      expect(key(element, 'ArrowDown').defaultPrevented).toBe(true);
      expect(divider.ratio).toBe(0.52);
      expect(key(element, 'ArrowUp').defaultPrevented).toBe(true);
      expect(divider.ratio).toBe(0.5);
    });

    it('drops its orientation class on destroy and ignores setOrientation afterwards', (): void => {
      const { divider, element } = mount('horizontal');
      divider.destroy();
      expect(element.classList.contains('kdoc-split-divider-horizontal')).toBe(false);
      divider.setOrientation('vertical');
      expect(element.classList.contains('kdoc-split-divider-horizontal')).toBe(false);
      expect(element.hasAttribute('aria-orientation')).toBe(false);
    });
  });
});
