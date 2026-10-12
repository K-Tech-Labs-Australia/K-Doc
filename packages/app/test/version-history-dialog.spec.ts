// @vitest-environment jsdom
/**
 * @file version-history-dialog.spec.ts
 * @purpose Exercises the Version History dialog UI end-to-end against a mocked harness, covering listing, diffing, restore, copy, empty/error states, and lifecycle teardown.
 * @inputs SnapshotInfo list; per-snapshot text map; current document text; DOM selection state.
 * @outputs Harness with captured reads/restored/copied arrays and assertions on rendered dialog elements.
 * @functions
 *   - snapshot: Builds a SnapshotInfo fixture at a relative past time.
 *   - mount: Installs the dialog via installVersionHistoryDialog and returns a test harness.
 *   - find: Locates a single descendant element or throws.
 *   - buttonNamed: Finds a button by exact text content or throws.
 *   - flush: Resolves after a macrotask so async dialog updates settle.
 * @dataflow Test snapshots → mount() harness callbacks → dialog renders rows/diff/status → assertions read DOM and captured arrays.
 * @controlflow afterEach resets dialogs/selection; each test mounts, opens, interacts, awaits flush, then asserts; afterEach destroys again.
 * @version 1
 * @date 2026-09-16
 */
import { afterEach, describe, expect, it } from 'vitest';
import { installVersionHistoryDialog } from '../src/shell/version-history-dialog.js';
import type { VersionEntry, VersionHistoryDialog } from '../src/shell/version-history-dialog.js';
import type { SnapshotInfo } from '../src/files/snapshot-store.js';

const MINUTE = 60_000;
const NOW = 1_800_000_000_000;
const dialogs: VersionHistoryDialog[] = [];

afterEach(() => {
  for (const dialog of dialogs.splice(0)) {
    dialog.destroy();
  }
  document.getSelection()?.removeAllRanges();
});

interface Harness {
  dialog: VersionHistoryDialog;
  root: HTMLDialogElement;
  reads: string[];
  restored: { text: string; id: string }[];
  copied: string[];
  current: string;
}

// Build a SnapshotInfo fixture dated `minutesAgo` minutes before the fixed NOW clock.
function snapshot(id: string, minutesAgo: number, reason: SnapshotInfo['reason'] = 'save'): SnapshotInfo {
  return { id, at: NOW - minutesAgo * MINUTE, reason, bytes: 1 };
}

// Install the dialog with harness-backed callbacks and return a handle to its root element and captured side effects.
function mount(snapshots: readonly VersionEntry[], texts: Record<string, string>, current: string): Harness {
  const harness = { reads: [] as string[], restored: [] as { text: string; id: string }[], copied: [] as string[], current } as Harness;
  harness.dialog = installVersionHistoryDialog({
    doc: document,
    list: () => Promise.resolve(snapshots),
    read: (id: string) => {
      harness.reads.push(id);
      const text = texts[id];
      return text === undefined ? Promise.reject(new Error('gone')) : Promise.resolve(text);
    },
    current: () => harness.current,
    now: () => NOW,
    restore: (text, info) => {
      harness.restored.push({ text, id: info.id });
    },
    copy: (text) => {
      harness.copied.push(text);
      return Promise.resolve();
    },
  });
  dialogs.push(harness.dialog);
  const root = document.querySelector<HTMLDialogElement>('dialog.kdoc-version-history:last-of-type');
  if (root === null) {
    throw new Error('dialog not mounted');
  } else {
    harness.root = root;
  }
  return harness;
}

// Locate a single descendant matching `selector`, throwing with context when absent.
function find(root: HTMLElement, selector: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) {
    throw new Error(`missing ${selector}`);
  } else {
    return found;
  }
}

// Find a button whose exact text content equals `name`, throwing when no such button exists.
function buttonNamed(root: HTMLElement, name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === name);
  if (found === undefined) {
    throw new Error(`missing button ${name}`);
  } else {
    return found;
  }
}

// Resolve after a macrotask so pending dialog state updates and microtask chains settle.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('version history dialog', () => {
  // Asserts newest-first ordering, selection highlight, reason label, diff rendering, and summary counts.
  it('lists snapshots newest first and shows the newest as changes', async () => {
    const h = mount([snapshot('a', 90), snapshot('b', 5, 'manual')], { a: 'Old start', b: 'The quick fox' }, 'The slow fox');
    await h.dialog.open();
    expect(h.dialog.isOpen).toBe(true);
    const rows = [...h.root.querySelectorAll<HTMLElement>('.kdoc-version-row')];
    expect(rows.map((row) => row.dataset['id'])).toEqual(['b', 'a']);
    expect(rows.map((row) => row.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(rows[0]?.querySelector('.kdoc-version-reason')?.textContent).toBe('Snapshot');
    expect(h.reads).toEqual(['b']);
    const content = find(h.root, '.kdoc-version-content');
    expect(find(content, 'del').textContent).toBe('quick');
    expect(find(content, 'ins').textContent).toBe('slow');
    expect(content.textContent).toBe('The quickslow fox');
    expect(find(h.root, '.kdoc-version-summary').textContent).toBe('Since then: 1 words added, 1 removed');
  });

  // Asserts old-text display, single-read caching per version, and the unchanged-document summary.
  it('shows the old text, loads each version once, and says when nothing changed', async () => {
    const h = mount([snapshot('a', 90), snapshot('b', 5)], { a: 'Same', b: 'The quick fox' }, 'Same');
    await h.dialog.open();
    buttonNamed(h.root, 'Old Version').click();
    expect(find(h.root, '.kdoc-version-content').textContent).toBe('The quick fox');
    expect(buttonNamed(h.root, 'Old Version').getAttribute('aria-pressed')).toBe('true');
    find(h.root, '.kdoc-version-row[data-id="a"]').click();
    await flush();
    expect(find(h.root, '.kdoc-version-summary').textContent).toBe('Same as the current document');
    find(h.root, '.kdoc-version-row[data-id="b"]').click();
    await flush();
    expect(h.reads).toEqual(['b', 'a']);
  });

  // Asserts that restoring loads the selected version text and closes the dialog.
  it('opens the selected version as tracked changes only when the host can', async () => {
    // With a compare callback the button hands over the loaded version and closes; without one it is absent.
    const compared: string[] = [];
    const withCompare = installVersionHistoryDialog({
      doc: document,
      list: () => Promise.resolve([snapshot('a', 3)]),
      read: () => Promise.resolve('Back then'),
      current: () => 'Now',
      now: () => NOW,
      restore: () => {},
      compare: (text, info) => {
        compared.push(`${info.id}:${text}`);
      },
      copy: () => Promise.resolve(),
    });
    dialogs.push(withCompare);
    await withCompare.open();
    const root = document.querySelector<HTMLDialogElement>('dialog.kdoc-version-history:last-of-type');
    if (root === null) {
      throw new Error('dialog not mounted');
    } else {
      buttonNamed(root, 'Open as Tracked Changes').click();
    }
    expect(compared).toEqual(['a:Back then']);
    expect(withCompare.isOpen).toBe(false);
    const h = mount([snapshot('a', 3)], { a: 'Old' }, 'New');
    await h.dialog.open();
    expect([...h.root.querySelectorAll('button')].some((b) => b.textContent === 'Open as Tracked Changes')).toBe(false);
  });

  it('labels a git commit and shows its detail line', async () => {
    // A commit entry reads "Git commit" with its short hash and subject; a snapshot has no detail line.
    const commit = { id: 'git:abc1234', at: NOW - 60 * MINUTE, reason: 'commit' as const, detail: 'abc1234 Add plan' };
    const h = mount([commit, snapshot('a', 3)], { 'git:abc1234': 'Committed text', a: 'Snapshot text' }, 'Now');
    await h.dialog.open();
    const rows = [...h.root.querySelectorAll<HTMLElement>('.kdoc-version-row')];
    expect(rows.map((row) => [...row.querySelectorAll('.kdoc-version-reason')].map((span) => span.textContent))).toEqual([['Saved'], ['Git commit', 'abc1234 Add plan']]);
    find(h.root, '.kdoc-version-row[data-id="git:abc1234"]').click();
    await flush();
    expect(h.reads).toEqual(['a', 'git:abc1234']);
  });

  it('restores the selected version and closes', async () => {
    const h = mount([snapshot('a', 3)], { a: 'Back then' }, 'Now');
    await h.dialog.open();
    buttonNamed(h.root, 'Restore This Version').click();
    expect(h.restored).toEqual([{ text: 'Back then', id: 'a' }]);
    expect(h.dialog.isOpen).toBe(false);
  });

  // Asserts whole-version and selected-passage copy paths report the correct status without added text.
  it('copies the whole version or a selected passage without added text', async () => {
    const h = mount([snapshot('a', 3)], { a: 'The quick fox' }, 'The slow fox');
    await h.dialog.open();
    buttonNamed(h.root, 'Copy Selection').click();
    await flush();
    expect(h.copied).toEqual(['The quick fox']);
    expect(find(h.root, '.kdoc-version-status').textContent).toBe('Copied the whole version.');
    const content = find(h.root, '.kdoc-version-content');
    const range = document.createRange();
    range.selectNodeContents(content);
    document.getSelection()?.addRange(range);
    buttonNamed(h.root, 'Copy Selection').click();
    await flush();
    expect(h.copied[1]).toBe('The quick fox');
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    buttonNamed(h.root, 'Copy Selection').dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    expect(find(h.root, '.kdoc-version-status').textContent).toBe('Copied the selected passage.');
  });

  // Asserts that a selection outside the version pane falls back to copying the whole version.
  it('ignores a selection outside the version pane', async () => {
    const h = mount([snapshot('a', 3)], { a: 'Old' }, 'New');
    await h.dialog.open();
    const outside = document.body.appendChild(document.createElement('p'));
    outside.textContent = 'elsewhere';
    const range = document.createRange();
    range.selectNodeContents(outside);
    document.getSelection()?.addRange(range);
    buttonNamed(h.root, 'Copy Selection').click();
    await flush();
    expect(h.copied).toEqual(['Old']);
    outside.remove();
    document.getSelection()?.removeAllRanges();
    const caret = document.createRange();
    caret.setStart(find(h.root, '.kdoc-version-content'), 0);
    caret.collapse(true);
    document.getSelection()?.addRange(caret);
    buttonNamed(h.root, 'Copy Selection').click();
    await flush();
    expect(h.copied[1]).toBe('Old');
    expect(find(h.root, '.kdoc-version-status').textContent).toBe('Copied the whole version.');
  });

  // Asserts the empty-state message and disabled action buttons when no snapshots exist.
  it('says when there are no snapshots and disables the actions', async () => {
    const h = mount([], {}, 'Text');
    await h.dialog.open();
    expect(find(h.root, '.kdoc-version-empty').textContent).toBe('No snapshots yet. One is kept each time you save.');
    expect(buttonNamed(h.root, 'Restore This Version').disabled).toBe(true);
    expect(buttonNamed(h.root, 'Copy Selection').disabled).toBe(true);
  });

  // Asserts a readable-error message and disabled restore when the version text cannot be fetched.
  it('reports a version that cannot be read', async () => {
    const h = mount([snapshot('missing', 3)], {}, 'Text');
    await h.dialog.open();
    expect(find(h.root, '.kdoc-version-content').textContent).toBe('Could not read this version: gone');
    expect(buttonNamed(h.root, 'Restore This Version').disabled).toBe(true);
  });

  // Asserts close hides the dialog and that a destroyed dialog cannot be reopened or reattached.
  it('closes, and does not reopen after destroy', async () => {
    const h = mount([snapshot('a', 3)], { a: 'Old' }, 'New');
    await h.dialog.open();
    buttonNamed(h.root, 'Close').click();
    expect(h.dialog.isOpen).toBe(false);
    h.dialog.destroy();
    await h.dialog.open();
    expect(h.dialog.isOpen).toBe(false);
    expect(document.body.contains(h.root)).toBe(false);
  });
});
