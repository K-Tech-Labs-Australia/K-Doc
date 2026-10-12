// @vitest-environment jsdom

/**
 * @file window-handoff.spec.ts
 * @purpose Vitest test suite for K-Doc document window handoff across browser contexts (FR-6.8).
 *   Validates capability detection outside Tauri, document parking in localStorage, window opening
 *   with query parameters, popup blocking rollback, destructive single-consumption claims, fallback
 *   on ordinary or absent launches, rejection of malformed or invalid JSON payloads, and preservation
 *   of null document paths.
 * @inputs HandoffDocument payloads, fake Window contexts with jsdom localStorage, and URL search parameters.
 * @outputs Vitest assertions verifying window handoff availability, detachment, parking, claiming, and cleanup.
 * @functions
 *   - fakeWindow: Constructs a fake Window context with localStorage, location, and open call recording.
 *   - parkedKeys: Retrieves all localStorage keys currently parked with the handoff prefix in insertion order.
 * @dataflow HandoffDocument -> detach() -> localStorage setItem -> fake window open -> claim() -> localStorage getItem/removeItem -> validated HandoffDocument -> Vitest assertions.
 * @controlflow Initialize fake windows -> test capability detection -> test detach and popup blocked rollback -> test destructive claim and invalid payload handling -> reset localStorage in beforeEach.
 * @version 1
 * @date 2026-09-12
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createWindowHandoff,
  HANDOFF_PARAM,
  HANDOFF_KEY_PREFIX,
} from '../src/files/window-handoff.js';
import type { HandoffDocument } from '../src/files/window-handoff.js';

/** The calls a fake window recorded, and the window itself. */
interface FakeWindow {
  readonly win: Window;
  readonly opened: Array<{ readonly url: string; readonly target: string }>;
}

/**
 * Constructs a test fake Window object recording opened windows and providing access to jsdom localStorage.
 *
 * @purpose Creates a controlled Window fixture for testing browser window handoff detachment and claim behavior.
 * @inputs search - URL search query string to simulate on win.location.search.
 * @inputs popupBlocked - Optional flag indicating whether win.open should return null to simulate browser popup blocking.
 * @outputs FakeWindow - Object containing the fake Window instance and an array of recorded open calls.
 * @dataflow search string and popupBlocked flag -> constructed Window fake -> recorded open calls.
 * @controlflow Initialize opened calls array -> construct Window object with jsdom localStorage, location, and open method -> return FakeWindow.
 */
function fakeWindow(search: string, popupBlocked?: boolean): FakeWindow {
  const opened: Array<{ readonly url: string; readonly target: string }> = [];

  // Use the real jsdom window.localStorage so the tests exercise a real Storage rather than a mock of one.
  const win = {
    localStorage: window.localStorage,
    location: { search },
    /**
     * Records opened window URL and target, returning null if popupBlocked is true.
     *
     * @purpose Simulates window.open behavior for detachment testing.
     * @inputs url - Target URL to open.
     * @inputs target - Window target name or mode (e.g. '_blank').
     * @outputs Window | null - Fake Window instance if allowed, or null if blocked.
     * @dataflow (url, target) -> push to opened array -> return Window or null.
     * @controlflow Record call in opened -> check popupBlocked -> return null if blocked, else dummy Window.
     */
    open: (url: string, target: string): Window | null => {
      opened.push({ url, target });
      // A blocked popup is what a browser reports as null, which is the case the module has to undo its own parking for.
      // Check if popup blocking was requested for this fake window.
      if (popupBlocked === true) {
        // Branch: Popup is blocked; return null as browser window.open does when blocked.
        return null;
      } else {
        // Branch: Popup is permitted; return a dummy Window object.
        return {} as unknown as Window;
      }
    },
  } as unknown as Window;

  return { win, opened };
}

/**
 * Every handoff key currently parked, in insertion order.
 *
 * @purpose Queries window.localStorage for all stored keys prefixed with HANDOFF_KEY_PREFIX.
 * @inputs None.
 * @outputs readonly string[] - Array of matching parked handoff keys in insertion order.
 * @dataflow window.localStorage keys -> prefix filter -> array of parked key strings.
 * @controlflow Iterate localStorage keys from index 0 to length -> filter by HANDOFF_KEY_PREFIX -> return accumulated keys.
 */
function parkedKeys(): readonly string[] {
  const result: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    // Check if key exists and begins with HANDOFF_KEY_PREFIX.
    if (key !== null && key.startsWith(HANDOFF_KEY_PREFIX)) {
      // Branch: Key matches handoff prefix; record in results.
      result.push(key);
    } else {
      // Branch: Key is null or does not match prefix; ignore.
    }
  }
  return result;
}

// Note on test strategy: The Tauri path of window handoff is not testable in this environment
// because there is no Tauri desktop runtime (__TAURI_INTERNALS__ is absent). Structure the suite around
// what is testable without it: the browser localStorage parking and claim mechanism (paired with URL
// search parameters) is the behavior worth pinning, not fake IPC plumbing. Faking a Tauri runtime by
// assigning __TAURI_INTERNALS__ onto window would cause invoke calls to fail for a different reason
// and would measure the mock rather than real behavior.
describe('the browser handoff', (): void => {
  beforeEach((): void => {
    // Clear localStorage so one test's parked document cannot be found by the next.
    window.localStorage.clear();
  });

  it('is available when localStorage can be read', (): void => {
    const fake = fakeWindow('');
    const handoff = createWindowHandoff(fake.win);
    expect(handoff.available).toBe(true);
  });

  it('parks the document and opens a window naming it', async (): Promise<void> => {
    const fake = fakeWindow('');
    const doc: HandoffDocument = { text: '# Doc\n', path: 'C:/x/doc.md' };
    const ok = await createWindowHandoff(fake.win).detach(doc);

    expect(ok).toBe(true);
    expect(fake.opened.length).toBe(1);
    const firstOpened = fake.opened[0]!;
    expect(firstOpened.target).toBe('_blank');
    expect(firstOpened.url.startsWith(`?${HANDOFF_PARAM}=`)).toBe(true);

    const keys = parkedKeys();
    expect(keys.length).toBe(1);
    const firstKey = keys[0]!;
    const raw = window.localStorage.getItem(firstKey);
    expect(raw).not.toBeNull();
    // A clean document parks no baseline and no encoding; both travel as null so the shape is always the same.
    expect(JSON.parse(raw!)).toEqual({ text: '# Doc\n', path: 'C:/x/doc.md', savedText: null, encoding: null });
  });

  it('unparks the document when the popup is blocked', async (): Promise<void> => {
    const fake = fakeWindow('', true);
    const ok = await createWindowHandoff(fake.win).detach({ text: '# Doc\n', path: 'C:/x/doc.md' });

    // A parked document nobody will ever claim is a leak, and reporting success for a window that
    // did not open would take the tab away from the user in exchange for nothing.
    expect(ok).toBe(false);
    expect(parkedKeys().length).toBe(0);
  });

  it('claims the document the URL names', async (): Promise<void> => {
    const firstFake = fakeWindow('');
    const doc: HandoffDocument = { text: '# Doc\n', path: 'C:/x/doc.md' };
    const ok = await createWindowHandoff(firstFake.win).detach(doc);
    expect(ok).toBe(true);

    const keys = parkedKeys();
    expect(keys.length).toBe(1);
    const key = keys[0]!;

    const secondFake = fakeWindow(`?${HANDOFF_PARAM}=${encodeURIComponent(key)}`);
    const claimed = await createWindowHandoff(secondFake.win).claim();

    expect(claimed).toEqual(doc);
  });

  it('claims once and only once', async (): Promise<void> => {
    const firstFake = fakeWindow('');
    const doc: HandoffDocument = { text: '# Doc\n', path: 'C:/x/doc.md' };
    const ok = await createWindowHandoff(firstFake.win).detach(doc);
    expect(ok).toBe(true);

    const keys = parkedKeys();
    expect(keys.length).toBe(1);
    const key = keys[0]!;

    const secondFake = fakeWindow(`?${HANDOFF_PARAM}=${encodeURIComponent(key)}`);
    const receiver = createWindowHandoff(secondFake.win);

    const firstClaim = await receiver.claim();
    const secondClaim = await receiver.claim();

    // The window is being given the document, not shown a copy of it — a reload that claimed
    // again would put the user's unsaved work in two windows at once.
    expect(firstClaim).toEqual(doc);
    expect(secondClaim).toBeNull();
    expect(parkedKeys().length).toBe(0);
  });

  it('returns null for an ordinary launch', async (): Promise<void> => {
    const emptyClaim = await createWindowHandoff(fakeWindow('').win).claim();
    expect(emptyClaim).toBeNull();

    const otherClaim = await createWindowHandoff(fakeWindow('?other=1').win).claim();
    expect(otherClaim).toBeNull();
  });

  it('returns null when the URL names a key that is not there', async (): Promise<void> => {
    const fake = fakeWindow(`?${HANDOFF_PARAM}=kdoc.handoff.nope`);
    const claimResult = await createWindowHandoff(fake.win).claim();
    expect(claimResult).toBeNull();
  });

  it('does not hand back a malformed entry, and does not keep it', async (): Promise<void> => {
    const badKey = `${HANDOFF_KEY_PREFIX}bad`;
    window.localStorage.setItem(badKey, 'not json at all');

    const fake = fakeWindow(`?${HANDOFF_PARAM}=${encodeURIComponent(badKey)}`);
    const claimResult = await createWindowHandoff(fake.win).claim();

    // Removing before parsing is what stops a malformed entry being retried on every reload.
    expect(claimResult).toBeNull();
    expect(parkedKeys().length).toBe(0);
  });

  it('rejects an entry of the wrong shape', async (): Promise<void> => {
    const nonStringTextKey = `${HANDOFF_KEY_PREFIX}wrong_text`;
    window.localStorage.setItem(
      nonStringTextKey,
      JSON.stringify({ text: 42, path: null }),
    );

    const fake1 = fakeWindow(`?${HANDOFF_PARAM}=${encodeURIComponent(nonStringTextKey)}`);
    const claimResult1 = await createWindowHandoff(fake1.win).claim();

    // This value crossed a boundary the module does not control, so its shape is checked rather than assumed.
    expect(claimResult1).toBeNull();

    const missingTextKey = `${HANDOFF_KEY_PREFIX}missing_text`;
    window.localStorage.setItem(
      missingTextKey,
      JSON.stringify({ path: 'x' }),
    );

    const fake2 = fakeWindow(`?${HANDOFF_PARAM}=${encodeURIComponent(missingTextKey)}`);
    const claimResult2 = await createWindowHandoff(fake2.win).claim();

    expect(claimResult2).toBeNull();
  });

  it('keeps a null path a null path', async (): Promise<void> => {
    const senderFake = fakeWindow('');
    const doc: HandoffDocument = { text: 'x', path: null };
    const ok = await createWindowHandoff(senderFake.win).detach(doc);
    expect(ok).toBe(true);

    const keys = parkedKeys();
    expect(keys.length).toBe(1);
    const key = keys[0]!;

    const receiverFake = fakeWindow(`?${HANDOFF_PARAM}=${encodeURIComponent(key)}`);
    const claimed = await createWindowHandoff(receiverFake.win).claim();

    expect(claimed).not.toBeNull();
    // An unsaved document has no path, and a path invented on the way through would send
    // the next save to a file that does not exist.
    expect(claimed!.path).toBeNull();
    expect(claimed!.path).not.toBeUndefined();
    expect(claimed!.path).not.toBe('null');
    expect(claimed!.text).toBe('x');
  });
});
