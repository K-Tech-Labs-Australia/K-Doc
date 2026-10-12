// @vitest-environment jsdom

/**
 * @file tabs.spec.ts
 * @purpose Vitest test suite for K-Doc's tab state model (TabSet) and document tab strip component (installTabBar) (FR-6.8).
 *   Validates pure state tab management (open, close, activate, reorder, MRU tracking, immutability)
 *   and tab strip UI rendering (visibility thresholds, selection state, close/auxclick triggers, new tab actions, dirty dots).
 * @inputs Document payloads, synthetic DOM click and auxclick MouseEvents, TabView fixtures, and TabBar configuration options.
 * @outputs Vitest assertions verifying TabSet state transitions, MRU ordering guarantees, snapshot freezing,
 *   DOM element attributes (role, aria-selected, aria-label, data-dirty), and callback sequence recordings.
 * @functions
 *   - mountBar: Mounts a TabBar controller into a DOM container with callback recording and teardown tracking.
 *   - tabElements: Queries all [role="tab"] elements within a container, returning an array of HTMLElements.
 *   - closeButtonForTab: Locates the close button within a specified tab element, throwing if missing.
 *   - newButtonForBar: Locates the new document "+" button within the tab bar container, throwing if missing.
 *   - stubRect: Pins the container's bounding rect with specified coordinates for jsdom layout testing.
 *   - fireDrag: Constructs and dispatches a synthetic drag Event with client coordinates and null dataTransfer.
 * @dataflow Synthetic user events & TabSet mutations -> TabBar DOM updates & TabSet state -> Vitest assertions.
 * @controlflow Mount DOM elements & controllers -> execute test assertions across TabSet and TabBar suites -> tear down in afterEach.
 * @version 2
 * @date 2026-09-12
 */

import { describe, expect, it, afterEach } from 'vitest';
import { TabSet } from '../src/shell/tab-set.js';
import { installTabBar, type TabBar, type TabView } from '../src/shell/tab-bar.js';

let activeMounts: HTMLElement[] = [];
let activeBars: TabBar[] = [];

afterEach((): void => {
  for (let i = 0; i < activeBars.length; i++) {
    const bar = activeBars[i];
    // Check if the tab bar controller is defined under strict array indexing.
    if (bar !== undefined) {
      // Bar controller is defined: destroy controller and clean up resources.
      bar.destroy();
    } else {
      // Controller is undefined: skip.
    }
  }
  activeBars = [];

  for (let i = 0; i < activeMounts.length; i++) {
    const mount = activeMounts[i];
    // Check if the container element is defined and still attached to the document DOM.
    if (mount !== undefined && mount.parentNode !== null) {
      // Container is attached: detach from document body.
      mount.parentNode.removeChild(mount);
    } else {
      // Container is already detached or undefined: skip.
    }
  }
  activeMounts = [];
});

/**
 * Mounts a tab bar container into document.body, installs a TabBar controller with tracking callbacks,
 * and records both for afterEach teardown.
 *
 * @purpose Sets up a TabBar test fixture with spy callbacks recording activate, close, reorder, detach, and new actions.
 * @inputs views - Array of TabView records captured by reference so tests can mutate it before calling refresh().
 * @inputs activeId - Identifier of the currently active tab, or null if no tab is active.
 * @outputs Object containing the TabBar controller, container HTMLElement, and calls recording array.
 * @dataflow views & activeId -> installTabBar -> user interaction events -> calls array.
 * @controlflow Create container div -> append to document body -> configure installTabBar with spy callbacks -> track for teardown -> return fixture.
 */
function mountBar(
  views: TabView[],
  activeId: string | null,
): { bar: TabBar; container: HTMLElement; calls: string[] } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  activeMounts.push(container);

  const calls: string[] = [];
  const bar = installTabBar({
    container,
    doc: document,
    tabs: (): { readonly views: readonly TabView[]; readonly activeId: string | null } => ({
      views,
      activeId,
    }),
    onActivate: (id: string): void => {
      calls.push(`activate:${id}`);
    },
    onClose: (id: string): void => {
      calls.push(`close:${id}`);
    },
    onReorder: (id: string, toIndex: number): void => {
      calls.push(`reorder:${id}:${toIndex}`);
    },
    onDetach: (id: string): void => {
      calls.push(`detach:${id}`);
    },
    onNew: (): void => {
      calls.push('new');
    },
  });
  activeBars.push(bar);

  return { bar, container, calls };
}

/**
 * Queries all [role="tab"] elements within the specified container, returning them as an array of HTMLElements.
 *
 * @purpose Locates tab elements within the tab strip container.
 * @inputs container - The parent DOM container hosting the tab strip.
 * @outputs HTMLElement[] - Array of matching tab DOM elements.
 * @dataflow container.querySelectorAll('[role="tab"]') -> Array.from -> return HTMLElement array.
 * @controlflow Query all elements matching [role="tab"] -> convert NodeList to array -> return elements.
 */
function tabElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]'));
}

/**
 * Queries the close button element inside a tab element, throwing a descriptive error if missing.
 *
 * @purpose Locates the close button within a tab element, failing fast if absent.
 * @inputs tab - The parent tab DOM element hosting the close button.
 * @outputs HTMLButtonElement - The close button element.
 * @dataflow tab.querySelector('button.kdoc-tab-close') -> validate found -> return HTMLButtonElement.
 * @controlflow Query button matching button.kdoc-tab-close -> check if null -> if null throw Error -> return button element.
 */
function closeButtonForTab(tab: HTMLElement): HTMLButtonElement {
  const btn = tab.querySelector<HTMLButtonElement>('button.kdoc-tab-close');
  // Check if the close button element was found within the tab.
  if (btn === null) {
    // Button not found: throw descriptive error.
    throw new Error('Close button not found within tab element');
  } else {
    // Button found: return element.
  }
  return btn;
}

/**
 * Queries the new document button element inside the tab bar container, throwing a descriptive error if missing.
 *
 * @purpose Locates the "+" button within the tab bar container, failing fast if absent.
 * @inputs container - The parent DOM container hosting the tab strip.
 * @outputs HTMLButtonElement - The new document button element.
 * @dataflow container.querySelector('button.kdoc-tab-new-button') -> validate found -> return HTMLButtonElement.
 * @controlflow Query button matching button.kdoc-tab-new-button -> check if null -> if null throw Error -> return button element.
 */
function newButtonForBar(container: HTMLElement): HTMLButtonElement {
  const btn = container.querySelector<HTMLButtonElement>('button.kdoc-tab-new-button');
  // Check if the new document button was found within the tab bar container.
  if (btn === null) {
    // Button not found: throw descriptive error.
    throw new Error('New document button not found within tab bar container');
  } else {
    // Button found: return element.
  }
  return btn;
}

describe('TabSet', (): void => {
  it('open returns an id, appends to tabs, and activates the newly opened tab', (): void => {
    const set = new TabSet<{ title: string }>();
    const id1 = set.open({ title: 'First Document' });
    const id2 = set.open({ title: 'Second Document' });

    const snapshot = set.snapshot;
    expect(snapshot.tabs.length).toBe(2);

    const firstTab = snapshot.tabs[0];
    const secondTab = snapshot.tabs[1];

    // Check if both tab records are defined under strict noUncheckedIndexedAccess.
    if (firstTab !== undefined && secondTab !== undefined) {
      // Both tab records are defined: verify their identifiers and payloads.
      expect(firstTab.id).toBe(id1);
      expect(firstTab.payload.title).toBe('First Document');
      expect(secondTab.id).toBe(id2);
      expect(secondTab.payload.title).toBe('Second Document');
    } else {
      // Guard failure: one or both tab records are undefined.
      throw new Error('Expected first and second tabs to be defined in snapshot');
    }

    expect(snapshot.activeId).toBe(id2);
  });

  it('never reuses ids after a close', (): void => {
    const set = new TabSet<{ title: string }>();
    const closedId = set.open({ title: 'Temporary Document' });
    set.close(closedId);

    const newId = set.open({ title: 'Subsequent Document' });

    // A reused id would let a stale reference to a closed tab silently address a new document.
    expect(newId).not.toBe(closedId);
  });

  it('activate moves the id to the front of mruIds, and activating an unknown id is a safe no-op', (): void => {
    const set = new TabSet<{ title: string }>();
    const id1 = set.open({ title: 'Doc 1' });
    set.open({ title: 'Doc 2' });
    const id3 = set.open({ title: 'Doc 3' });

    // Initially active tab is id3, MRU is [id3, id2, id1].
    expect(set.snapshot.activeId).toBe(id3);

    // Activate id1: should move id1 to the front of mruIds.
    set.activate(id1);
    expect(set.snapshot.activeId).toBe(id1);

    const mruFirst = set.snapshot.mruIds[0];
    // Check if the first MRU entry is defined under strict indexing.
    if (mruFirst !== undefined) {
      // First MRU entry is defined: assert it matches the newly activated id.
      expect(mruFirst).toBe(id1);
    } else {
      // Guard failure: mruIds is unexpectedly empty.
      throw new Error('Expected mruIds to contain at least one element');
    }

    // Activating an unknown id is a no-op and does not throw; throwing would turn a stale click into a crash.
    expect((): void => {
      set.activate('non-existent-tab-id');
    }).not.toThrow();

    // Active id remains id1 after invalid activation attempt.
    expect(set.snapshot.activeId).toBe(id1);
  });

  it('closing the active tab activates the most recent survivor, not the neighbour', (): void => {
    const set = new TabSet<{ title: string }>();
    const idA = set.open({ title: 'Doc A' });
    const idB = set.open({ title: 'Doc B' });
    const idC = set.open({ title: 'Doc C' });

    // Explicitly activate A, then activate C.
    set.activate(idA);
    set.activate(idC);

    // Close the active tab C.
    set.close(idC);

    // This is the whole reason MRU exists here — closing should return you to what
    // you were last looking at, which is almost never the positional neighbour.
    expect(set.snapshot.activeId).toBe(idA);
    expect(set.snapshot.activeId).not.toBe(idB);
  });

  it('closing a background tab leaves activeId alone', (): void => {
    const set = new TabSet<{ title: string }>();
    const idA = set.open({ title: 'Doc A' });
    set.open({ title: 'Doc B' });
    const idC = set.open({ title: 'Doc C' });

    // Active tab is idC. Close idA which is in the background.
    expect(set.snapshot.activeId).toBe(idC);
    set.close(idA);

    expect(set.snapshot.activeId).toBe(idC);
    expect(set.snapshot.tabs.length).toBe(2);
  });

  it('closing the last tab leaves activeId null', (): void => {
    const set = new TabSet<{ title: string }>();
    const id = set.open({ title: 'Only Document' });
    expect(set.snapshot.activeId).toBe(id);

    set.close(id);

    expect(set.snapshot.activeId).toBeNull();
    expect(set.snapshot.tabs.length).toBe(0);
    expect(set.snapshot.mruIds.length).toBe(0);
  });

  it('move reorders tabs without changing activation or MRU order', (): void => {
    const set = new TabSet<{ title: string }>();
    const idA = set.open({ title: 'Doc A' });
    const idB = set.open({ title: 'Doc B' });
    const idC = set.open({ title: 'Doc C' });

    // Activate the first tab (A).
    set.activate(idA);
    expect(set.snapshot.activeId).toBe(idA);
    const mruBefore = [...set.snapshot.mruIds];

    // Move tab A to index 2 (end of the list).
    // Dragging a tab is not a statement about which one you want to look at.
    set.move(idA, 2);

    const snapshot = set.snapshot;
    // Order should now be [B, C, A].
    const tab0 = snapshot.tabs[0];
    const tab1 = snapshot.tabs[1];
    const tab2 = snapshot.tabs[2];

    // Check if all three tab records are defined under strict indexing.
    if (tab0 !== undefined && tab1 !== undefined && tab2 !== undefined) {
      // Tabs defined: verify reordered sequence.
      expect(tab0.id).toBe(idB);
      expect(tab1.id).toBe(idC);
      expect(tab2.id).toBe(idA);
    } else {
      // Guard failure: one or more tabs undefined.
      throw new Error('Expected three tabs in snapshot after move');
    }

    // Active tab and MRU sequence must remain unchanged.
    expect(snapshot.activeId).toBe(idA);
    expect(snapshot.mruIds).toEqual(mruBefore);
  });

  it('move clamps an out-of-range index at both ends', (): void => {
    const set = new TabSet<{ title: string }>();
    set.open({ title: 'Doc A' });
    set.open({ title: 'Doc B' });
    const idC = set.open({ title: 'Doc C' });

    // Move tab C (currently at index 2) to negative index -10: clamped to 0.
    set.move(idC, -10);
    const snap1 = set.snapshot;
    const firstTab = snap1.tabs[0];
    // Check if first tab is defined.
    if (firstTab !== undefined) {
      // First tab defined: assert it is tab C clamped to index 0.
      expect(firstTab.id).toBe(idC);
    } else {
      // Guard failure: first tab is undefined.
      throw new Error('Expected first tab to be defined after negative clamp move');
    }

    // Move tab C from index 0 to excessive index 100: clamped to index 2 (tabs.length - 1).
    set.move(idC, 100);
    const snap2 = set.snapshot;
    const lastTab = snap2.tabs[2];
    // Check if last tab is defined.
    if (lastTab !== undefined) {
      // Last tab defined: assert it is tab C clamped to index 2.
      expect(lastTab.id).toBe(idC);
    } else {
      // Guard failure: last tab is undefined.
      throw new Error('Expected last tab to be defined after high clamp move');
    }
  });

  it('nextInMru returns the previously active tab and toggles between two', (): void => {
    const set = new TabSet<{ title: string }>();
    const idA = set.open({ title: 'Doc A' });
    const idB = set.open({ title: 'Doc B' });

    // Currently active tab is B; previous tab in MRU is A.
    // Returning the second entry is what makes repeated Ctrl+Tab toggle, which is what the shortcut is for.
    expect(set.nextInMru()).toBe(idA);

    // Activate A: now active is A, previous tab is B.
    set.activate(idA);
    expect(set.nextInMru()).toBe(idB);

    // Activate B again: now active is B, previous tab is A.
    set.activate(idB);
    expect(set.nextInMru()).toBe(idA);
  });

  it('nextInMru is null with fewer than two tabs', (): void => {
    const set = new TabSet<{ title: string }>();
    // Zero tabs:
    expect(set.nextInMru()).toBeNull();

    // One tab:
    set.open({ title: 'Sole Document' });
    expect(set.nextInMru()).toBeNull();
  });

  it('replacePayload swaps the payload keeping order and activation', (): void => {
    const set = new TabSet<{ title: string; content: string }>();
    const idA = set.open({ title: 'Doc A', content: 'Original A' });
    const idB = set.open({ title: 'Doc B', content: 'Original B' });

    expect(set.snapshot.activeId).toBe(idB);

    // Replace payload of tab A.
    set.replacePayload(idA, { title: 'Doc A', content: 'Reloaded A' });

    const payloadA = set.get(idA);
    // Check if payload for idA was found.
    if (payloadA !== null) {
      // Payload found: assert updated content.
      expect(payloadA.content).toBe('Reloaded A');
    } else {
      // Guard failure: payload is null.
      throw new Error('Expected payload for idA to be found');
    }

    const snapshot = set.snapshot;
    const tab0 = snapshot.tabs[0];
    const tab1 = snapshot.tabs[1];

    // Check if both tabs are defined under strict indexing.
    if (tab0 !== undefined && tab1 !== undefined) {
      // Both tabs defined: verify order and payload contents.
      expect(tab0.id).toBe(idA);
      expect(tab0.payload.content).toBe('Reloaded A');
      expect(tab1.id).toBe(idB);
      expect(tab1.payload.content).toBe('Original B');
    } else {
      // Guard failure: one or both tabs undefined.
      throw new Error('Expected tab0 and tab1 to be defined');
    }

    // Active tab is still idB.
    expect(snapshot.activeId).toBe(idB);
  });

  it('subscribe fires on every mutation and the returned function stops it', (): void => {
    const set = new TabSet<{ title: string }>();
    const recordedSnapshots: number[] = [];

    const unsubscribe = set.subscribe((snapshot): void => {
      recordedSnapshots.push(snapshot.tabs.length);
    });

    set.open({ title: 'Doc 1' });
    set.open({ title: 'Doc 2' });
    expect(recordedSnapshots).toEqual([1, 2]);

    // Unsubscribe listener.
    unsubscribe();

    set.open({ title: 'Doc 3' });
    // Callback should not have received further notifications after unsubscribing.
    expect(recordedSnapshots).toEqual([1, 2]);
  });

  it('a snapshot cannot be used to mutate the tab set', (): void => {
    const set = new TabSet<{ title: string }>();
    set.open({ title: 'Doc 1' });
    set.open({ title: 'Doc 2' });

    const snapshot = set.snapshot;
    expect(snapshot.tabs.length).toBe(2);

    try {
      // Returning the live arrays would let a caller reorder tabs by accident.
      // The test asserts the outcome rather than that a throw happened, because
      // frozen-array writes throw only in strict mode.
      (snapshot.tabs as unknown as Array<{ id: string; payload: { title: string } }>).push({
        id: 'fake-id',
        payload: { title: 'Fake Document' },
      });
    } catch {
      // Mutation attempt throws in strict mode when modifying a frozen array.
    }

    // Assert the set's own tab count remains completely unaffected.
    expect(set.snapshot.tabs.length).toBe(2);
  });
});

describe('the tab strip', (): void => {
  it('hides itself with one tab and shows with two', (): void => {
    const views: TabView[] = [{ id: 'tab-1', title: 'Doc 1', dirty: false }];
    const { bar, container } = mountBar(views, 'tab-1');

    // A strip showing a single tab is pure chrome.
    expect(container.hidden).toBe(true);

    // Mutate views array by reference and trigger refresh.
    views.push({ id: 'tab-2', title: 'Doc 2', dirty: false });
    bar.refresh();

    expect(container.hidden).toBe(false);
  });

  it('renders two tab elements with two tabs, marking the active one aria-selected="true"', (): void => {
    const views: TabView[] = [
      { id: 'tab-1', title: 'Doc 1', dirty: false },
      { id: 'tab-2', title: 'Doc 2', dirty: false },
    ];
    const { container } = mountBar(views, 'tab-2');

    const tabs = tabElements(container);
    expect(tabs.length).toBe(2);

    const firstTab = tabs[0];
    const secondTab = tabs[1];

    // Check if both tab elements are defined under strict array indexing.
    if (firstTab !== undefined && secondTab !== undefined) {
      // Inactive tab carries aria-selected="false".
      expect(firstTab.getAttribute('aria-selected')).toBe('false');
      // Active tab carries aria-selected="true".
      expect(secondTab.getAttribute('aria-selected')).toBe('true');
    } else {
      // Guard failure: expected two tab elements.
      throw new Error('Expected first and second tab elements to be defined');
    }
  });

  it('clicking a tab records activate:<id>', (): void => {
    const views: TabView[] = [
      { id: 'tab-1', title: 'Doc 1', dirty: false },
      { id: 'tab-2', title: 'Doc 2', dirty: false },
    ];
    const { container, calls } = mountBar(views, 'tab-2');

    const tabs = tabElements(container);
    const firstTab = tabs[0];

    // Check if the first tab element is defined.
    if (firstTab !== undefined) {
      // Tab defined: simulate user click and assert activation callback recording.
      firstTab.click();
      expect(calls).toEqual(['activate:tab-1']);
    } else {
      // Guard failure: first tab element is undefined.
      throw new Error('Expected first tab element to be defined');
    }
  });

  it('clicking a close button records close:<id> and does not record an activate', (): void => {
    const views: TabView[] = [
      { id: 'tab-1', title: 'Doc 1', dirty: false },
      { id: 'tab-2', title: 'Doc 2', dirty: false },
    ];
    const { container, calls } = mountBar(views, 'tab-2');

    const tabs = tabElements(container);
    const firstTab = tabs[0];

    // Check if first tab element is defined.
    if (firstTab !== undefined) {
      // Tab defined: query close button and simulate click.
      const closeBtn = closeButtonForTab(firstTab);
      closeBtn.click();

      // Without stopPropagation the close would activate a document that is in the process of closing.
      expect(calls).toEqual(['close:tab-1']);
      expect(calls).not.toContain('activate:tab-1');
    } else {
      // Guard failure: first tab element is undefined.
      throw new Error('Expected first tab element to be defined');
    }
  });

  it('middle-click closes the tab, and non-middle auxclick does not close', (): void => {
    const views: TabView[] = [
      { id: 'tab-1', title: 'Doc 1', dirty: false },
      { id: 'tab-2', title: 'Doc 2', dirty: false },
    ];
    const { container, calls } = mountBar(views, 'tab-2');

    const tabs = tabElements(container);
    const firstTab = tabs[0];

    // Check if first tab element is defined.
    if (firstTab !== undefined) {
      // Dispatch middle-click auxclick (button === 1).
      // auxclick rather than mousedown avoids closing a tab the user was only middle-dragging past.
      const middleClickEvent = new MouseEvent('auxclick', { button: 1, bubbles: true });
      firstTab.dispatchEvent(middleClickEvent);

      expect(calls).toEqual(['close:tab-1']);

      // Dispatch non-middle auxclick (button === 0).
      const primaryAuxClickEvent = new MouseEvent('auxclick', { button: 0, bubbles: true });
      firstTab.dispatchEvent(primaryAuxClickEvent);

      // Verify that no second close call was emitted.
      expect(calls).toEqual(['close:tab-1']);
    } else {
      // Guard failure: first tab element is undefined.
      throw new Error('Expected first tab element to be defined');
    }
  });

  it('the + button records new', (): void => {
    const views: TabView[] = [
      { id: 'tab-1', title: 'Doc 1', dirty: false },
      { id: 'tab-2', title: 'Doc 2', dirty: false },
    ];
    const { container, calls } = mountBar(views, 'tab-2');

    const newBtn = newButtonForBar(container);
    newBtn.click();

    expect(calls).toEqual(['new']);
  });

  it('a close button aria-label names its document rather than just Close', (): void => {
    const views: TabView[] = [
      { id: 'tab-1', title: 'README.md', dirty: false },
      { id: 'tab-2', title: 'STANDARDS.md', dirty: false },
    ];
    const { container } = mountBar(views, 'tab-1');

    const tabs = tabElements(container);
    const firstTab = tabs[0];
    const secondTab = tabs[1];

    // Check if both tabs are defined under strict indexing.
    if (firstTab !== undefined && secondTab !== undefined) {
      const closeBtn1 = closeButtonForTab(firstTab);
      const closeBtn2 = closeButtonForTab(secondTab);

      // A bare × is unusable with a screen reader when there are eight of them.
      expect(closeBtn1.getAttribute('aria-label')).toBe('Close README.md');
      expect(closeBtn2.getAttribute('aria-label')).toBe('Close STANDARDS.md');
    } else {
      // Guard failure: expected two tab elements.
      throw new Error('Expected first and second tabs to be defined');
    }
  });

  it('a dirty tab carries data-dirty="true" and a clean one "false"', (): void => {
    const views: TabView[] = [
      { id: 'tab-1', title: 'Unsaved Draft', dirty: true },
      { id: 'tab-2', title: 'Clean File', dirty: false },
    ];
    const { container } = mountBar(views, 'tab-1');

    const tabs = tabElements(container);
    const dirtyTab = tabs[0];
    const cleanTab = tabs[1];

    // Check if both tabs are defined under strict indexing.
    if (dirtyTab !== undefined && cleanTab !== undefined) {
      // Dirty tab carries data-dirty="true", clean tab carries data-dirty="false".
      expect(dirtyTab.getAttribute('data-dirty')).toBe('true');
      expect(cleanTab.getAttribute('data-dirty')).toBe('false');
    } else {
      // Guard failure: expected two tab elements.
      throw new Error('Expected dirty and clean tabs to be defined');
    }
  });

  it('destroy() twice does not throw and empties the container', (): void => {
    const views: TabView[] = [
      { id: 'tab-1', title: 'Doc 1', dirty: false },
      { id: 'tab-2', title: 'Doc 2', dirty: false },
    ];
    const { bar, container } = mountBar(views, 'tab-1');

    // Container has children prior to destruction.
    expect(container.children.length).toBeGreaterThan(0);

    // Calling destroy twice should be idempotent and not throw.
    expect((): void => {
      bar.destroy();
      bar.destroy();
    }).not.toThrow();

    // Container should be emptied.
    expect(container.children.length).toBe(0);
    expect(container.textContent).toBe('');
    expect(container.classList.contains('kdoc-tab-bar')).toBe(false);
  });
});

/**
 * Pins the container's bounding rect, which jsdom reports as all zeroes by default.
 *
 * @purpose Stubs getBoundingClientRect on a container element with fixed coordinates.
 * @inputs container - The HTMLElement whose bounding client rectangle is being stubbed.
 * @inputs rect - Object containing left, top, right, and bottom boundary coordinates.
 * @outputs void.
 * @dataflow rect values -> calculated DOMRect object -> assigned to container.getBoundingClientRect.
 * @controlflow Compute width, height, x, y from rect -> construct DOMRect-compatible object -> override getBoundingClientRect method.
 */
function stubRect(
  container: HTMLElement,
  rect: { left: number; top: number; right: number; bottom: number },
): void {
  // jsdom lays nothing out, so every rect is zero-sized at the origin and a test that did not pin one would be measuring against a point rather than a bar.
  container.getBoundingClientRect = (): DOMRect =>
    ({
      ...rect,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
      x: rect.left,
      y: rect.top,
      toJSON: (): object => ({}),
    }) as DOMRect;
}

/**
 * Dispatches a synthetic drag event on a DOM element with specified client coordinates.
 *
 * @purpose Simulates drag gestures in jsdom by defining read-only coordinates and dataTransfer properties.
 * @inputs el - Target DOM Element receiving the drag event.
 * @inputs type - Drag event type name (e.g., 'dragstart', 'dragover', 'drop', 'dragend').
 * @inputs clientX - Horizontal viewport coordinate of the pointer.
 * @inputs clientY - Vertical viewport coordinate of the pointer.
 * @outputs void.
 * @dataflow Parameters -> synthetic Event creation with defined properties -> el.dispatchEvent.
 * @controlflow Create bubbling cancelable Event -> define clientX, clientY, dataTransfer -> dispatch event on el.
 */
function fireDrag(el: Element, type: string, clientX: number, clientY: number): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clientX', { value: clientX });
  Object.defineProperty(event, 'clientY', { value: clientY });
  // Define dataTransfer as null: the handlers check it for null before touching it,
  // and an undefined property would slip past a !== null test that a real browser's null would not.
  Object.defineProperty(event, 'dataTransfer', { value: null });
  el.dispatchEvent(event);
}

describe('dragging a tab out', (): void => {
  it('reports a detach when the drag ends clear of the bar', (): void => {
    const views: TabView[] = [
      { id: 'a', title: 'Alpha', dirty: false },
      { id: 'b', title: 'Beta', dirty: false },
    ];
    const { container, calls } = mountBar(views, 'a');

    const tabB = container.querySelector<HTMLElement>('[data-tab-id="b"]');
    // Check if tab b is found in the container.
    if (tabB === null) {
      // Tab b element is missing: fail test immediately.
      expect.fail('Tab b element was not found in container');
    } else {
      // Tab b element found: proceed with test assertions.
    }

    stubRect(container, { left: 0, top: 0, right: 400, bottom: 30 });
    fireDrag(tabB, 'dragstart', 100, 10);
    fireDrag(tabB, 'dragend', 200, 400);

    expect(calls).toContain('detach:b');
  });

  it('does not detach a reorder', (): void => {
    const views: TabView[] = [
      { id: 'a', title: 'Alpha', dirty: false },
      { id: 'b', title: 'Beta', dirty: false },
    ];
    const { container, calls } = mountBar(views, 'a');

    const tabA = container.querySelector<HTMLElement>('[data-tab-id="a"]');
    const tabB = container.querySelector<HTMLElement>('[data-tab-id="b"]');
    // Check if tab b is found in the container.
    if (tabB === null) {
      // Tab b element is missing: fail test immediately.
      expect.fail('Tab b element was not found in container');
    } else {
      // Tab b element found: proceed with test assertions.
    }
    // Check if tab a is found in the container.
    if (tabA === null) {
      // Tab a element is missing: fail test immediately.
      expect.fail('Tab a element was not found in container');
    } else {
      // Tab a element found: proceed with test assertions.
    }

    stubRect(container, { left: 0, top: 0, right: 400, bottom: 30 });
    fireDrag(tabB, 'dragstart', 100, 10);
    fireDrag(tabA, 'drop', 50, 10);
    fireDrag(tabB, 'dragend', 50, 10);

    // The two gestures start identically; only how the drag ended tells them apart,
    // and a reorder that also detached would leave the document in two places.
    expect(calls.some((call: string): boolean => call.startsWith('reorder:'))).toBe(true);
    expect(calls.some((call: string): boolean => call.startsWith('detach:'))).toBe(false);
  });

  it('does not detach a cancelled drag', (): void => {
    const views: TabView[] = [
      { id: 'a', title: 'Alpha', dirty: false },
      { id: 'b', title: 'Beta', dirty: false },
    ];
    const { container, calls } = mountBar(views, 'a');

    const tabB = container.querySelector<HTMLElement>('[data-tab-id="b"]');
    // Check if tab b is found in the container.
    if (tabB === null) {
      // Tab b element is missing: fail test immediately.
      expect.fail('Tab b element was not found in container');
    } else {
      // Tab b element found: proceed with test assertions.
    }

    // The bar is deliberately away from the origin. With it at (0, 0) the cancelled drag's own
    // coordinates fall inside it, and the test passes whether the guard is there or not.
    stubRect(container, { left: 100, top: 100, right: 500, bottom: 130 });
    fireDrag(tabB, 'dragstart', 200, 110);
    fireDrag(tabB, 'dragend', 0, 0);

    // A drag cancelled with Escape reports the origin, and detaching there would open a window every time the user changed their mind.
    expect(calls.some((call: string): boolean => call.startsWith('detach:'))).toBe(false);
  });

  it('does not detach a drag let go just past the edge', (): void => {
    const views: TabView[] = [
      { id: 'a', title: 'Alpha', dirty: false },
      { id: 'b', title: 'Beta', dirty: false },
    ];
    const { container, calls } = mountBar(views, 'a');

    const tabB = container.querySelector<HTMLElement>('[data-tab-id="b"]');
    // Check if tab b is found in the container.
    if (tabB === null) {
      // Tab b element is missing: fail test immediately.
      expect.fail('Tab b element was not found in container');
    } else {
      // Tab b element found: proceed with test assertions.
    }

    stubRect(container, { left: 0, top: 0, right: 400, bottom: 30 });
    fireDrag(tabB, 'dragstart', 100, 10);
    fireDrag(tabB, 'dragend', 410, 40);

    // A reorder that overshot the last tab must not be read as a request for a new window.
    expect(calls.some((call: string): boolean => call.startsWith('detach:'))).toBe(false);
  });

  it('detaches above the bar as well as below it', (): void => {
    const views: TabView[] = [
      { id: 'a', title: 'Alpha', dirty: false },
      { id: 'b', title: 'Beta', dirty: false },
    ];
    const { container, calls } = mountBar(views, 'a');

    const tabB = container.querySelector<HTMLElement>('[data-tab-id="b"]');
    // Check if tab b is found in the container.
    if (tabB === null) {
      // Tab b element is missing: fail test immediately.
      expect.fail('Tab b element was not found in container');
    } else {
      // Tab b element found: proceed with test assertions.
    }

    stubRect(container, { left: 0, top: 100, right: 400, bottom: 130 });
    fireDrag(tabB, 'dragstart', 100, 110);
    fireDrag(tabB, 'dragend', 100, 10);

    // The bar is not always at the top of the window, so the test is a rectangle rather than a single edge.
    expect(calls).toContain('detach:b');
  });

  it('reports the tab that was dragged, not the one under the pointer', (): void => {
    const views: TabView[] = [
      { id: 'a', title: 'Alpha', dirty: false },
      { id: 'b', title: 'Beta', dirty: false },
    ];
    const { container, calls } = mountBar(views, 'a');

    const tabB = container.querySelector<HTMLElement>('[data-tab-id="b"]');
    // Check if tab b is found in the container.
    if (tabB === null) {
      // Tab b element is missing: fail test immediately.
      expect.fail('Tab b element was not found in container');
    } else {
      // Tab b element found: proceed with test assertions.
    }

    const tabA = container.querySelector<HTMLElement>('[data-tab-id="a"]');
    // Check if tab a is found in the container.
    if (tabA === null) {
      // Tab a element is missing: fail test immediately.
      expect.fail('Tab a element was not found in container');
    } else {
      // Tab a element found: proceed with test assertions.
    }

    stubRect(container, { left: 0, top: 0, right: 400, bottom: 30 });
    fireDrag(tabA, 'dragstart', 100, 10);
    fireDrag(tabA, 'dragend', 200, 400);

    expect(calls).toContain('detach:a');
    expect(calls).not.toContain('detach:b');
  });

  it('ignores a drag it never started', (): void => {
    const views: TabView[] = [
      { id: 'a', title: 'Alpha', dirty: false },
      { id: 'b', title: 'Beta', dirty: false },
    ];
    const { container, calls } = mountBar(views, 'a');

    const tabB = container.querySelector<HTMLElement>('[data-tab-id="b"]');
    // Check whether tab b was rendered.
    if (tabB === null) {
      // Absent: the fixture is wrong, so say so rather than asserting against nothing.
      expect.fail('Tab b element was not found in container');
    } else {
      // Present: end a drag that was never begun here.
    }

    stubRect(container, { left: 0, top: 0, right: 400, bottom: 30 });
    // No dragstart. A dragend can arrive from a drag that began somewhere else entirely, and the
    // strip has no id for it -- detaching on one would close a tab the user never touched.
    fireDrag(tabB, 'dragend', 200, 400);

    expect(calls.some((call: string): boolean => call.startsWith('detach:'))).toBe(false);
  });
});
