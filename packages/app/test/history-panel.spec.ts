// @vitest-environment jsdom

/**
 * @file history-panel.spec.ts
 * @purpose Vitest test suite for HistoryPanel document edit-timeline sidebar (FR-14.7).
 *   Validates empty states, newest-first ordering, timeline-index labeling, pane and word-delta readouts,
 *   single-clock-per-refresh sampling, click-to-restore behaviour, idempotent destroy, clock-tracking refreshes,
 *   element stability, and stylesheet exports; plus exhaustive boundary coverage for the formatRelativeTime and
 *   formatWordDelta pure helpers under jsdom.
 * @inputs HistoryRow fixture arrays, a fixed epoch constant for deterministic relative times, synthetic DOM click events, and mock host callbacks recording restores.
 * @outputs Vitest assertions verifying DOM hierarchy, text content, data-index attributes, restore recordings, clock-sample counts, and stylesheet exports.
 * @functions
 *   - mount: Instantiates and mounts a HistoryPanel controller on the real Document with mutable rows, word count, and injectable clock.
 *   - texts: Collects trimmed text content of every element matching a selector under a root node.
 *   - requireElement: Locates a single element by selector, failing the test if absent.
 *   - row: Builds a HistoryRow fixture for timeline tests.
 * @dataflow Mutable harness state -> installHistoryPanel accessor closures -> refresh DOM rebuilds -> synthetic click events invoke restore -> Vitest assertions.
 * @controlflow Mount history panel harness -> execute boundary and behaviour tests across three describe blocks -> destroy active panels, remove host elements, and restore real timers in afterEach.
 * @version 1
 * @date 2026-09-12
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  installHistoryPanel,
  HISTORY_PANEL_STYLES,
  formatRelativeTime,
  formatWordDelta,
} from '../src/shell/history-panel.js';
import type { HistoryPanel, HistoryRow } from '../src/shell/history-panel.js';

// Fixed epoch milliseconds (2023-11-14T22:13:20Z) so every relative time is deterministic.
const NOW = 1_700_000_000_000;

const activePanels: HistoryPanel[] = [];
const activeHosts: HTMLElement[] = [];

afterEach((): void => {
  for (let i = 0; i < activeHosts.length; i++) {
    const host = activeHosts[i];
    // Check if the host element is defined under strict indexing.
    if (host !== undefined) {
      // Defined: remove host element from document body.
      host.remove();
    } else {
      // Undefined: skip iteration.
    }
  }
  activeHosts.length = 0;

  for (let i = 0; i < activePanels.length; i++) {
    const panel = activePanels[i];
    // Check if the panel instance is defined to satisfy strict noUncheckedIndexedAccess.
    if (panel !== undefined) {
      // Defined panel instance: execute lifecycle teardown.
      panel.destroy();
    } else {
      // Undefined panel instance at index: skip iteration.
    }
  }
  activePanels.length = 0;

  // Restore real timers in afterEach when fake timers were used.
  vi.useRealTimers();
});

interface Harness {
  readonly panel: HistoryPanel;
  readonly restored: number[];
  rows: HistoryRow[];
  currentWords: number;
  now: number;
  // Number of times the panel's clock accessor has been read, incremented by the harness closure.
  readonly nowCalls: number;
}

interface MutableHarness {
  panel?: HistoryPanel;
  readonly restored: number[];
  rows: HistoryRow[];
  currentWords: number;
  now: number;
  nowCalls: number;
}

/**
 * Instantiates and mounts a HistoryPanel controller with configurable reactive accessors and an invocation recorder.
 *
 * @purpose Allocates a test harness for HistoryPanel, tracking restored timeline indices while exposing mutable rows, word count, and an injectable clock sampled once per refresh.
 * @inputs initial - Optional initial state overrides for history rows, current word count, and the fixed epoch now.
 * @outputs Harness - Test harness containing the mounted HistoryPanel, restore recordings, and mutable accessors.
 * @dataflow initial parameters -> mutable harness state -> installHistoryPanel -> registered in activePanels & activeHosts -> Harness returned.
 * @controlflow Initialize mutable state -> instantiate HistoryPanel with closures over harness properties -> register panel in activePanels -> attach host to document -> return harness.
 */
function mount(initial?: { rows?: HistoryRow[]; currentWords?: number; now?: number }): Harness {
  let initialRows: HistoryRow[] = [];
  // Check if initial rows array was provided.
  if (initial?.rows !== undefined) {
    // Rows provided: clone the array so later mutations do not touch the caller's fixture.
    initialRows = [...initial.rows];
  } else {
    // No rows provided: default to empty timeline.
    initialRows = [];
  }

  let initialCurrentWords: number = 100;
  // Check if an explicit current word count was provided.
  if (initial?.currentWords !== undefined) {
    // Word count provided: use the supplied value as the present-document length.
    initialCurrentWords = initial.currentWords;
  } else {
    // No word count provided: default to a hundred-word document.
    initialCurrentWords = 100;
  }

  let initialNow: number = NOW;
  // Check if an explicit clock origin was provided.
  if (initial?.now !== undefined) {
    // Clock provided: use the supplied epoch as "now".
    initialNow = initial.now;
  } else {
    // No clock provided: default to the module-level fixed epoch.
    initialNow = NOW;
  }

  // Build the mutable object first and assign panel onto it once instantiated, allowing the
  // installHistoryPanel accessor closures (entries, currentWords, now) to close over harness properties directly.
  // This ensures subsequent test mutations to harness.rows, harness.currentWords, or harness.now are immediately visible
  // to the panel upon refresh, so a single mount drives every behaviour under test.
  const harness: MutableHarness = {
    restored: [],
    rows: initialRows,
    currentWords: initialCurrentWords,
    now: initialNow,
    nowCalls: 0,
  };

  const panel = installHistoryPanel({
    doc: document,
    entries: (): readonly HistoryRow[] => harness.rows,
    currentWords: (): number => harness.currentWords,
    // Sample the clock once per refresh; each read is counted so a test can prove there is exactly one.
    now: (): number => {
      harness.nowCalls += 1;
      return harness.now;
    },
    restore: (index: number): void => {
      harness.restored.push(index);
    },
  });

  harness.panel = panel;
  activePanels.push(panel);

  // Put it in the document. A detached element cannot be interacted with, and a panel the sidebar never
  // mounted is not the panel under test.
  const host = document.createElement('div');
  host.appendChild(panel.element);
  document.body.appendChild(host);
  activeHosts.push(host);

  return harness as Harness;
}

/**
 * Collects the trimmed text content of every element matching a selector under a root node, in document order.
 *
 * @purpose Reads rendered readouts (relative times, detail lines) as an ordered list for bulk assertions.
 * @inputs root - The container to search within.
 * @inputs selector - The CSS selector matching the elements whose text should be collected.
 * @outputs string[] - One trimmed text content per matched element, in document order.
 * @dataflow root.querySelectorAll -> iterate matches -> trim each textContent -> ordered list returned.
 * @controlflow Query all matches -> guard each index read under strict indexing -> accumulate trimmed text -> return list.
 */
function texts(root: ParentNode, selector: string): string[] {
  const elements = root.querySelectorAll(selector);
  const result: string[] = [];
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    // Check if the matched element is defined under strict indexing.
    if (element !== undefined) {
      // Defined element: capture its trimmed text content.
      result.push(element.textContent?.trim() ?? '');
    } else {
      // Undefined: skip iteration.
    }
  }
  return result;
}

/**
 * Locates a single element by selector within a root, failing the test if it is absent.
 *
 * @purpose Provides typed, guaranteed-present elements for inspection and interaction without non-null assertions.
 * @inputs root - The container to search within.
 * @inputs selector - The CSS selector of the required element.
 * @outputs T - The located element, already narrowed to a defined value.
 * @dataflow root.querySelector -> null check -> element returned or test fails naming what was missing.
 * @controlflow Query element -> if null fail with a descriptive message; otherwise return the element.
 */
function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  // Check whether the required element exists in the panel DOM.
  if (element === null) {
    // Element missing: fail the test immediately, naming what was expected.
    expect.fail(`Expected ${selector} element to exist in the panel`);
  } else {
    // Element present: return it narrowed to a defined value.
    return element;
  }
}

/**
 * Builds a HistoryRow fixture for timeline tests.
 *
 * @purpose Constructs row objects without repeating object literals across cases.
 * @inputs index - Timeline position, oldest first.
 * @inputs at - Recorded epoch milliseconds.
 * @inputs pane - Editing pane identifier.
 * @inputs words - Word count at that point.
 * @outputs HistoryRow - A complete history-row fixture.
 * @dataflow Parameters -> plain row object returned directly.
 * @controlflow Assemble the four fields into a HistoryRow and return it.
 */
function row(index: number, at: number, pane: 'kdoc' | 'source', words: number): HistoryRow {
  return { index, at, pane, words };
}

describe('formatRelativeTime', (): void => {
  it('reads a timestamp from this instant as just now', (): void => {
    // A version recorded at the current moment has no meaningful age to report.
    expect(formatRelativeTime(NOW, NOW)).toBe('just now');
  });

  it('still reads just now under one minute of elapsed time', (): void => {
    // The first minute is too fresh to name a partial unit; anything under the threshold reads as immediate.
    expect(formatRelativeTime(NOW - 44999, NOW)).toBe('just now');
  });

  it('reads a single minute once forty-five seconds have passed', (): void => {
    // Forty-five thousand milliseconds is the boundary where "just now" gives way to "1 minute ago".
    expect(formatRelativeTime(NOW - 45000, NOW)).toBe('1 minute ago');
  });

  it('keeps reading one minute through the rest of that window', (): void => {
    // Just under ninety seconds is still rounded down to a single minute.
    expect(formatRelativeTime(NOW - 89999, NOW)).toBe('1 minute ago');
  });

  it('reads two minutes at the half-minute rounding boundary', (): void => {
    // Ninety thousand milliseconds divided by sixty thousand is exactly 1.5, which rounds up to two.
    expect(formatRelativeTime(NOW - 90000, NOW)).toBe('2 minutes ago');
  });

  it('reads whole minutes rounded under an hour', (): void => {
    // Just under an hour rounds up to sixty minutes rather than spilling into hours.
    expect(formatRelativeTime(NOW - 3599999, NOW)).toBe('60 minutes ago');
  });

  it('switches to hours at the one-hour boundary', (): void => {
    // Exactly an hour is reported as a single hour ago, not sixty minutes.
    expect(formatRelativeTime(NOW - 3600000, NOW)).toBe('1 hour ago');
  });

  it('keeps reading a single hour through the ninety-minute window', (): void => {
    // Just under ninety minutes is still rounded to one hour.
    expect(formatRelativeTime(NOW - 5399999, NOW)).toBe('1 hour ago');
  });

  it('reads two hours at the half-hour rounding boundary', (): void => {
    // Five million four hundred thousand milliseconds divided by three six hundred thousand is exactly 1.5, which rounds up to two.
    expect(formatRelativeTime(NOW - 5400000, NOW)).toBe('2 hours ago');
  });

  it('reads whole hours rounded under a day', (): void => {
    // Just under a day rounds up to twenty-four hours rather than spilling into days.
    expect(formatRelativeTime(NOW - 86399999, NOW)).toBe('24 hours ago');
  });

  it('switches to days at the one-day boundary', (): void => {
    // Exactly a day is reported as a single day ago, not twenty-four hours.
    expect(formatRelativeTime(NOW - 86400000, NOW)).toBe('1 day ago');
  });

  it('keeps reading a single day through the thirty-six-hour window', (): void => {
    // Just under thirty-six hours is still rounded to one day.
    expect(formatRelativeTime(NOW - 129599999, NOW)).toBe('1 day ago');
  });

  it('reads two days at the half-day rounding boundary', (): void => {
    // One million two hundred ninety-six thousand milliseconds divided by eighty six four hundred thousand is exactly 1.5, which rounds up to two.
    expect(formatRelativeTime(NOW - 129600000, NOW)).toBe('2 days ago');
  });

  it('reads a future timestamp as just now', (): void => {
    // A clock set backwards puts a recorded time in the future; "in a minute" is not something a history panel can truthfully say, so skew clamps to just now.
    expect(formatRelativeTime(NOW + 60000, NOW)).toBe('just now');
  });
});

describe('formatWordDelta', (): void => {
  it('says same length when the counts match', (): void => {
    // Nothing to compare means the readout should stay neutral rather than invent a direction.
    expect(formatWordDelta(100, 100)).toBe('same length');
  });

  it('singularizes a single-word reduction', (): void => {
    // One fewer word is grammatically singular; "1 words fewer" would read as unfinished.
    expect(formatWordDelta(99, 100)).toBe('1 word fewer');
  });

  it('pluralizes a multi-word reduction', (): void => {
    // Two words takes the plural form rather than the singular.
    expect(formatWordDelta(98, 100)).toBe('2 words fewer');
  });

  it('singularizes a single-word growth', (): void => {
    // One more word is grammatically singular; "1 word more" rather than "1 words more".
    expect(formatWordDelta(101, 100)).toBe('1 word more');
  });

  it('pluralizes a multi-word growth', (): void => {
    // Five extra words take the plural form.
    expect(formatWordDelta(105, 100)).toBe('5 words more');
  });

  it('treats two empty documents as the same length', (): void => {
    // Zero versus zero is still a match; an empty document has not grown or shrunk.
    expect(formatWordDelta(0, 0)).toBe('same length');
  });
});

describe('the History panel', (): void => {
  it('shows an empty readout when there are no versions', (): void => {
    // An empty timeline should say so plainly rather than render a broken or blank panel.
    const { panel } = mount();
    expect(texts(panel.element, '.kdoc-history-empty')).toEqual(['No earlier versions yet.']);
    expect(panel.element.querySelectorAll('button.kdoc-history-entry')).toHaveLength(0);
  });

  it('draws versions newest-first so a recent restore is one click away', (): void => {
    // The version a user wants back is nearly always a recent one, and the timeline should put it on top.
    const rows: HistoryRow[] = [
      row(0, NOW - 3 * 60 * 60 * 1000, 'kdoc', 200),
      row(1, NOW - 10 * 60 * 1000, 'source', 210),
      row(2, NOW - 30 * 1000, 'kdoc', 205),
    ];
    const { panel } = mount({ rows });
    // Newest-first rendering must read "just now" (30s), then "10 minutes ago", then "3 hours ago"; a forward loop would reverse this.
    expect(texts(panel.element, '.kdoc-history-when')).toEqual([
      'just now',
      '10 minutes ago',
      '3 hours ago',
    ]);
  });

  it('labels each button with its timeline index rather than its on-screen slot', (): void => {
    // A click must restore the version the row names (its place in the session), not whatever happens to sit at that visual position.
    const rows: HistoryRow[] = [
      row(0, NOW - 3 * 60 * 60 * 1000, 'kdoc', 200),
      row(1, NOW - 10 * 60 * 1000, 'source', 210),
      row(2, NOW - 30 * 1000, 'kdoc', 205),
    ];
    const { panel } = mount({ rows });
    const buttons = panel.element.querySelectorAll<HTMLButtonElement>('button.kdoc-history-entry');
    expect(buttons).toHaveLength(3);
    // Rendered newest-first, the buttons carry timeline indices 2, 1, 0 in that order.
    const indices: string[] = [];
    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i];
      if (button !== undefined) {
        // Defined button: read its data-index attribute as a string.
        indices.push(button.getAttribute('data-index') ?? '');
      } else {
        // Undefined: skip iteration.
      }
    }
    expect(indices).toEqual(['2', '1', '0']);
  });

  it('names the editing pane and the word delta on each detail line', (): void => {
    // The user knows those two panes by the names on their tabs, not by the identifiers in the code.
    const rows: HistoryRow[] = [
      row(0, NOW - 3 * 60 * 60 * 1000, 'source', 102),
      row(1, NOW - 30 * 1000, 'kdoc', 97),
    ];
    const { panel } = mount({ rows });
    // Newest-first: the K-Doc entry (Editor) then the source entry (Source), each with its delta.
    expect(texts(panel.element, '.kdoc-history-detail')).toEqual([
      'Editor \u00B7 3 words fewer',
      'Source \u00B7 2 words more',
    ]);
  });

  it('samples the clock exactly once per refresh', (): void => {
    // One shared reading keeps every row in agreement; sampling once rather than once per row is how two entries recorded in the same second can never disagree about "now".
    const rows: HistoryRow[] = [
      row(0, NOW - 3 * 60 * 60 * 1000, 'kdoc', 200),
      row(1, NOW - 10 * 60 * 1000, 'source', 210),
      row(2, NOW - 30 * 1000, 'kdoc', 205),
    ];
    const harness = mount({ rows });
    // The install's own initial refresh is the only read; no per-row reads occur.
    expect(harness.nowCalls).toBe(1);
  });

  it('restores the timeline index of the entry that was clicked', (): void => {
    // A click on a row must put back exactly the version that row names, no more and no less.
    const rows: HistoryRow[] = [
      row(0, NOW - 3 * 60 * 60 * 1000, 'kdoc', 200),
      row(1, NOW - 10 * 60 * 1000, 'source', 210),
      row(2, NOW - 30 * 1000, 'kdoc', 205),
    ];
    const harness = mount({ rows });
    // The second rendered button carries timeline index 1.
    const buttons = harness.panel.element.querySelectorAll<HTMLButtonElement>('button.kdoc-history-entry');
    expect(buttons).toHaveLength(3);
    const second = buttons[1];
    if (second === undefined) {
      // Missing second entry: fail the test naming what was expected.
      expect.fail('Expected a second history entry button to exist');
    } else {
      // Present: click it and let the delegated listener restore its index.
      second.click();
    }
    expect(harness.restored).toEqual([1]);
  });

  it('restores exactly once per click', (): void => {
    // A delegated listener and a per-button listener on the same row would restore twice; one click must restore once.
    const rows: HistoryRow[] = [
      row(0, NOW - 3 * 60 * 60 * 1000, 'kdoc', 200),
      row(1, NOW - 30 * 1000, 'source', 210),
    ];
    const harness = mount({ rows });
    const buttons = harness.panel.element.querySelectorAll<HTMLButtonElement>('button.kdoc-history-entry');
    expect(buttons).toHaveLength(2);
    const first = buttons[0];
    if (first === undefined) {
      // Missing first entry: fail the test naming what was expected.
      expect.fail('Expected a first history entry button to exist');
    } else {
      // Present: click it once.
      first.click();
    }
    expect(harness.restored.length).toBe(1);
  });

  it('ignores clicks that land outside any history entry', (): void => {
    // Clicking the panel's own container, not an entry, must not restore anything.
    const rows: HistoryRow[] = [row(0, NOW - 30 * 1000, 'kdoc', 200)];
    const harness = mount({ rows });
    const body = requireElement<HTMLDivElement>(harness.panel.element, '.kdoc-history-body');
    body.dispatchEvent(new MouseEvent('click'));
    expect(harness.restored).toEqual([]);
  });

  it('keeps the same element across a refresh', (): void => {
    // A refresh rebuilds the body's children, not the panel itself; swapping elements under the sidebar would lose focus and state.
    const harness = mount({ rows: [row(0, NOW - 30 * 1000, 'kdoc', 200)] });
    const stable = harness.panel.element;
    harness.rows = [row(1, NOW - 60 * 1000, 'source', 210)];
    harness.panel.refresh();
    expect(harness.panel.element).toBe(stable);
  });

  it('recomputes relative times when the clock moves', (): void => {
    // A history panel that froze its "now" at mount would keep saying "just now" forever; the readout must track the live clock.
    const harness = mount({ rows: [row(0, NOW - 30 * 1000, 'kdoc', 200)] });
    expect(texts(harness.panel.element, '.kdoc-history-when')).toEqual(['just now']);

    // Advance the clock by two hours and re-render; never hold a child element across the refresh.
    harness.now += 2 * 60 * 60 * 1000;
    harness.panel.refresh();

    const when = texts(harness.panel.element, '.kdoc-history-when');
    expect(when).toEqual(['2 hours ago']);
  });

  it('stops restoring after destroy', (): void => {
    // A destroyed panel must not react to clicks: tearing down its listener twice must be safe and leave it inert.
    const harness = mount({ rows: [row(7, NOW - 30 * 1000, 'kdoc', 200)] });
    const body = requireElement<HTMLDivElement>(harness.panel.element, '.kdoc-history-body');

    harness.panel.destroy();
    // A second destroy is a no-op and must not throw.
    harness.panel.destroy();

    // An entry that destroy already cleared away could not reach the body's listener even if the
    // listener were still attached, so clicking one proves nothing. Put a live entry in the body:
    // only a genuinely removed listener leaves this click unanswered.
    const revived = document.createElement('button');
    revived.className = 'kdoc-history-entry';
    revived.setAttribute('data-index', '7');
    body.appendChild(revived);
    revived.click();

    expect(harness.restored).toEqual([]);
  });

  it('offers Version History only when the host can open it', (): void => {
    // The button appears with an opener, calls it, and goes away with destroy; without an opener there is no button.
    let opened = 0;
    const withOpener = installHistoryPanel({
      doc: document,
      entries: () => [],
      currentWords: () => 0,
      now: () => 0,
      restore: (): void => {},
      browseVersions: (): void => {
        opened += 1;
      },
    });
    const browse = withOpener.element.querySelector<HTMLButtonElement>('button.kdoc-history-browse');
    expect(browse?.textContent).toBe('Version History…');
    browse?.click();
    expect(opened).toBe(1);
    withOpener.destroy();
    browse?.click();
    expect(opened).toBe(1);
    const without = installHistoryPanel({ doc: document, entries: () => [], currentWords: () => 0, now: () => 0, restore: (): void => {} });
    expect(without.element.querySelector('button.kdoc-history-browse')).toBeNull();
    without.destroy();
  });

  it('exports its own stylesheet', (): void => {
    // The panel must ship the styles that name its own classes so the sidebar can load them without re-deriving selectors.
    expect(HISTORY_PANEL_STYLES.length).toBeGreaterThan(0);
    expect(HISTORY_PANEL_STYLES).toContain('.kdoc-history-panel');
    expect(HISTORY_PANEL_STYLES).toContain('.kdoc-history-entry');
  });
});
