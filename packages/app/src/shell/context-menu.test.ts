// @vitest-environment jsdom

/**
 * @file context-menu.test.ts
 * @purpose Vitest test suite for the K-Doc view's editor context menu controller (packages/app/src/shell/context-menu.ts, FR-14.2).
 *   Verifies asynchronous spelling suggestion integration, synchronous event default prevention, fallback menu assembly,
 *   lifecycle teardown, and race condition suppression across async tick gaps.
 * @inputs EditorView instances configured with kdocSchema, fake PopupMenu objects recording openAt calls,
 *   synthetic contextmenu MouseEvents, and mock spellEntries provider promises.
 * @outputs Vitest assertions verifying menu entry ordering, separator insertion, synchronous preventDefault behavior,
 *   error fallback recovery, and idempotent destruction.
 * @functions
 *   - createTestDoc: Helper constructing a ProseMirror document node containing a single paragraph.
 *   - createTestEditor: Helper mounting an EditorView with kdocSchema into the DOM and tracking it for cleanup.
 *   - createFakePopupMenu: Helper creating an object satisfying PopupMenu that records openAt invocations.
 *   - entryIds: Helper mapping PopupMenuEntry arrays to string identifiers with '---' for visual separators.
 *   - flush: Helper flushing pending macrotasks via zero-delay setTimeout.
 *   - dispatchContextMenu: Helper creating and dispatching a synthetic contextmenu MouseEvent on a pane element.
 * @dataflow Synthetic contextmenu event -> installContextMenu listener -> describeTarget & spellEntries -> fake PopupMenu.openAt -> entryIds -> Vitest assertions.
 * @controlflow Mount EditorView and fake menu -> attach ContextMenu controller -> fire contextmenu event -> await flush -> assert recorded entries and lifecycle guards -> clean up in afterEach.
 * @version 1
 * @date 2026-09-06
 */

import { describe, expect, it, afterEach } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { EditorState } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { kdocSchema } from '@k-doc/editor';
import type { PopupMenu, PopupMenuEntry, PopupMenuItem } from './popup-menu.js';
import {
  describeTarget,
  buildEntries,
  installContextMenu,
  type ContextMenu,
  type ContextMenuOptions,
} from './context-menu.js';

let activeMounts: HTMLElement[] = [];
let activeViews: EditorView[] = [];
let activeContextMenus: ContextMenu[] = [];

afterEach((): void => {
  for (let i = 0; i < activeContextMenus.length; i++) {
    const contextMenu = activeContextMenus[i];
    // Check if context menu controller is defined under strict indexing.
    if (contextMenu !== undefined) {
      // Branch: Controller is defined; tear down event listeners.
      contextMenu.destroy();
    } else {
      // Branch: Controller is undefined.
    }
  }
  activeContextMenus = [];

  for (let i = 0; i < activeViews.length; i++) {
    const view = activeViews[i];
    // Check if editor view is defined under strict indexing.
    if (view !== undefined) {
      // Branch: View is defined; destroy ProseMirror editor instance.
      view.destroy();
    } else {
      // Branch: View is undefined.
    }
  }
  activeViews = [];

  for (let i = 0; i < activeMounts.length; i++) {
    const mount = activeMounts[i];
    // Check if mount element is defined under strict indexing.
    if (mount !== undefined) {
      // Branch: Mount element is defined; remove container from DOM.
      mount.remove();
    } else {
      // Branch: Mount element is undefined.
    }
  }
  activeMounts = [];
});

/**
 * Creates a standard ProseMirror test document node containing a single paragraph.
 *
 * @purpose Constructs a valid ProseMirror document tree for testing editor interactions.
 * @inputs text: string - Text content to populate inside the paragraph.
 * @outputs ProseMirrorNode - The root doc node.
 * @dataflow text -> kdocSchema.text -> kdocSchema.node('paragraph') -> kdocSchema.node('doc').
 * @controlflow Wrap text in paragraph if non-empty; otherwise create empty paragraph -> return doc.
 */
function createTestDoc(text: string): ProseMirrorNode {
  // Check if the provided text string is non-empty.
  if (text.length === 0) {
    // Branch: Empty text string; construct paragraph with no child nodes.
    return kdocSchema.node('doc', null, [
      kdocSchema.node('paragraph', null, []),
    ]);
  } else {
    // Branch: Non-empty text string; construct paragraph containing text leaf.
    return kdocSchema.node('doc', null, [
      kdocSchema.node('paragraph', null, [kdocSchema.text(text)]),
    ]);
  }
}

/**
 * Instantiates and mounts a real ProseMirror EditorView over kdocSchema into document.body.
 *
 * @purpose Sets up a functional EditorView with a single paragraph, registered for cleanup in afterEach.
 * @inputs text: string - Initial text content for the test document paragraph.
 * @outputs Object containing the mounted EditorView and mount container HTMLElement.
 * @dataflow text -> createTestDoc -> EditorState.create -> new EditorView -> active cleanup registries.
 * @controlflow Allocate div -> append to DOM -> create state -> instantiate view -> register for cleanup -> return record.
 */
function createTestEditor(text: string): {
  view: EditorView;
  mount: HTMLElement;
} {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  activeMounts.push(mount);

  const doc = createTestDoc(text);
  const state = EditorState.create({
    schema: kdocSchema,
    doc,
  });

  const view = new EditorView(mount, { state });
  activeViews.push(view);
  return { view, mount };
}

interface FakeOpenCall {
  readonly x: number;
  readonly y: number;
  readonly entries: readonly PopupMenuEntry[];
}

interface FakePopupMenu extends PopupMenu {
  readonly recorded: FakeOpenCall[];
}

/**
 * Constructs a fake PopupMenu satisfying the PopupMenu interface for unit testing without mocking libraries.
 *
 * @purpose Creates a PopupMenu whose openAt method records invocations into an accessible array and whose other methods are inert.
 * @inputs void.
 * @outputs FakePopupMenu - Object satisfying PopupMenu exposing recorded openAt call descriptors.
 * @dataflow openAt(x, y, entries) -> recorded array.
 * @controlflow Allocate recorded array -> construct object literal satisfying PopupMenu -> return fake.
 */
function createFakePopupMenu(): FakePopupMenu {
  const recorded: FakeOpenCall[] = [];
  let open = false;

  return {
    get recorded(): FakeOpenCall[] {
      return recorded;
    },
    openAt(x: number, y: number, entries: readonly PopupMenuEntry[]): void {
      open = true;
      recorded.push({ x, y, entries });
    },
    setFilter(_query: string): void {
      // Inert no-op in fake popup menu.
    },
    close(): void {
      open = false;
    },
    get isOpen(): boolean {
      return open;
    },
    destroy(): void {
      open = false;
    },
  };
}

/**
 * Converts an array of PopupMenuEntry items into a flat list of string IDs, mapping separators to '---'.
 *
 * @purpose Transforms PopupMenuEntry objects into readable string ID arrays for concise equality assertions.
 * @inputs entries: readonly PopupMenuEntry[] - Array of menu items and visual separators.
 * @outputs string[] - Flat array of string IDs and separator '---' literals.
 * @dataflow entries -> discriminate separator vs item -> collect string representations -> return string array.
 * @controlflow Iterate entries -> check if undefined -> if separator append '---'; else append item.id -> return result.
 */
function entryIds(entries: readonly PopupMenuEntry[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    // Check if entry is defined under strict noUncheckedIndexedAccess.
    if (entry === undefined) {
      // Branch: Undefined entry index; skip iteration.
      continue;
    } else {
      // Branch: Valid entry; inspect discriminant property.
    }

    // Check whether the entry represents a visual separator.
    if ('separator' in entry) {
      // Branch: Separator entry; record the separator token literal '---'.
      result.push('---');
    } else {
      // Branch: Menu item entry; record its unique identifier string.
      result.push(entry.id);
    }
  }
  return result;
}

/**
 * Flushes pending asynchronous tasks in the macrotask queue.
 *
 * @purpose Awaits a zero-delay setTimeout promise so that the asynchronous contextmenu
 *   event listener finishes awaiting its spellEntries provider before assertions run.
 * @inputs void.
 * @outputs Promise<void> - Resolves on the subsequent macrotask turn.
 * @dataflow setTimeout -> next macrotask queue turn -> Promise resolve.
 * @controlflow Allocate Promise with setTimeout(0) -> await callback -> return resolved promise.
 */
async function flush(): Promise<void> {
  // A macrotask flush is required because installContextMenu's contextmenu event listener is async.
  // The handler yields execution at `await options.spellEntries()`, so assertions reading what openAt
  // recorded must await a macrotask tick rather than inspecting state immediately after dispatch.
  await new Promise<void>((resolve): void => {
    setTimeout(resolve, 0);
  });
}

/**
 * Dispatches a synthetic contextmenu MouseEvent on the specified pane element.
 *
 * @purpose Constructs and fires a cancelable, bubbling contextmenu MouseEvent at the specified viewport coordinates.
 * @inputs
 *   - pane: HTMLElement - The editor pane container element receiving the event.
 *   - clientX?: number - Viewport horizontal coordinate in pixels (default: 100).
 *   - clientY?: number - Viewport vertical coordinate in pixels (default: 200).
 * @outputs MouseEvent - The dispatched MouseEvent instance for inspecting defaultPrevented.
 * @dataflow Coordinates -> MouseEvent -> pane.dispatchEvent -> MouseEvent.
 * @controlflow Instantiate MouseEvent with bubbles and cancelable flags -> dispatch on pane -> return event.
 */
function dispatchContextMenu(
  pane: HTMLElement,
  clientX: number = 100,
  clientY: number = 200,
): MouseEvent {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
  });
  pane.dispatchEvent(event);
  return event;
}

describe('ContextMenu Controller (context-menu.ts)', (): void => {
  it('opens ordinary menu matching buildEntries when no spellEntries provider is configured', async (): Promise<void> => {
    const { view, mount } = createTestEditor('Plain paragraph text content.');
    const fakeMenu = createFakePopupMenu();
    const options: ContextMenuOptions = {
      menu: fakeMenu,
      view,
      pane: mount,
      doc: document,
      openLink: (): void => {},
      followLink: (_href: string): void => {},
      editImage: (): void => {},
    };

    const contextMenu = installContextMenu(options);
    activeContextMenus.push(contextMenu);

    dispatchContextMenu(mount, 40, 50);
    await flush();

    expect(fakeMenu.recorded.length).toBe(1);
    const call = fakeMenu.recorded[0];
    expect(call).toBeDefined();

    // Check if recorded call is defined under strict noUncheckedIndexedAccess.
    if (call !== undefined) {
      // Branch: Call is defined; verify viewport coordinates and compare entries against buildEntries.
      expect(call.x).toBe(40);
      expect(call.y).toBe(50);

      const target = describeTarget(view);
      const expectedEntries = buildEntries(view, target, options);
      const recordedIds = entryIds(call.entries);
      const expectedIds = entryIds(expectedEntries);

      // Assert recorded entries match buildEntries exactly.
      expect(recordedIds).toEqual(expectedIds);

      // Assert the first three items are clipboard actions: cut, copy, paste.
      expect(recordedIds.slice(0, 3)).toEqual([
        'context:cut',
        'context:copy',
        'context:paste',
      ]);
    } else {
      // Branch: Undefined call.
    }
  });

  it('prepends spelling entry IDs and a separator before ordinary entries when provider returns items', async (): Promise<void> => {
    const { view, mount } = createTestEditor('Plain paragraph text content.');
    const fakeMenu = createFakePopupMenu();

    const spellItem1: PopupMenuItem = {
      id: 'spell:suggestion-1',
      label: 'Suggestion 1',
      hint: '',
      enabled: true,
      run: (): void => {},
    };
    const spellItem2: PopupMenuItem = {
      id: 'spell:suggestion-2',
      label: 'Suggestion 2',
      hint: '',
      enabled: true,
      run: (): void => {},
    };

    const options: ContextMenuOptions = {
      menu: fakeMenu,
      view,
      pane: mount,
      doc: document,
      openLink: (): void => {},
      followLink: (_href: string): void => {},
      editImage: (): void => {},
      spellEntries: async (): Promise<readonly PopupMenuEntry[]> => {
        return [spellItem1, spellItem2];
      },
    };

    const contextMenu = installContextMenu(options);
    activeContextMenus.push(contextMenu);

    dispatchContextMenu(mount, 60, 70);
    await flush();

    expect(fakeMenu.recorded.length).toBe(1);
    const call = fakeMenu.recorded[0];
    expect(call).toBeDefined();

    // Check if recorded call is defined under strict noUncheckedIndexedAccess.
    if (call !== undefined) {
      // Branch: Call is defined; verify spelling entries lead, followed by separator, followed by ordinary IDs.
      const target = describeTarget(view);
      const ordinaryIds = entryIds(buildEntries(view, target, options));
      const expectedIds = [
        'spell:suggestion-1',
        'spell:suggestion-2',
        '---',
        ...ordinaryIds,
      ];

      expect(entryIds(call.entries)).toEqual(expectedIds);
    } else {
      // Branch: Undefined call.
    }
  });

  it('omits leading separator and equals ordinary entries when provider returns an empty array', async (): Promise<void> => {
    const { view, mount } = createTestEditor('Plain paragraph text content.');
    const fakeMenu = createFakePopupMenu();

    const options: ContextMenuOptions = {
      menu: fakeMenu,
      view,
      pane: mount,
      doc: document,
      openLink: (): void => {},
      followLink: (_href: string): void => {},
      editImage: (): void => {},
      spellEntries: async (): Promise<readonly PopupMenuEntry[]> => {
        return [];
      },
    };

    const contextMenu = installContextMenu(options);
    activeContextMenus.push(contextMenu);

    dispatchContextMenu(mount, 30, 40);
    await flush();

    expect(fakeMenu.recorded.length).toBe(1);
    const call = fakeMenu.recorded[0];
    expect(call).toBeDefined();

    // Check if recorded call is defined under strict noUncheckedIndexedAccess.
    if (call !== undefined) {
      // Branch: Call is defined; verify no leading separator and identity with ordinary entries.
      const target = describeTarget(view);
      const ordinaryIds = entryIds(buildEntries(view, target, options));
      const recordedIds = entryIds(call.entries);

      // Verify exact equality with case 1's ordinary entries.
      expect(recordedIds).toEqual(ordinaryIds);
      // Verify no leading separator divider is present.
      const firstEntryId = recordedIds[0];
      expect(firstEntryId).toBeDefined();
      // Check if first entry ID is defined.
      if (firstEntryId !== undefined) {
        // Branch: First entry ID defined; verify it is not a separator token.
        expect(firstEntryId).not.toBe('---');
      } else {
        // Branch: Empty entries list.
      }
    } else {
      // Branch: Undefined call.
    }
  });

  it('falls back to ordinary menu entries when spellEntries provider rejects', async (): Promise<void> => {
    const { view, mount } = createTestEditor('Plain paragraph text content.');
    const fakeMenu = createFakePopupMenu();

    const options: ContextMenuOptions = {
      menu: fakeMenu,
      view,
      pane: mount,
      doc: document,
      openLink: (): void => {},
      followLink: (_href: string): void => {},
      editImage: (): void => {},
      spellEntries: async (): Promise<readonly PopupMenuEntry[]> => {
        throw new Error('Simulated spell engine IPC failure');
      },
    };

    const contextMenu = installContextMenu(options);
    activeContextMenus.push(contextMenu);

    dispatchContextMenu(mount, 25, 35);
    await flush();

    // A spell engine error must not prevent clipboard/formatting menu access.
    expect(fakeMenu.recorded.length).toBe(1);
    const call = fakeMenu.recorded[0];
    expect(call).toBeDefined();

    // Check if recorded call is defined under strict noUncheckedIndexedAccess.
    if (call !== undefined) {
      // Branch: Call is defined; verify ordinary entries opened despite rejection.
      const target = describeTarget(view);
      const ordinaryIds = entryIds(buildEntries(view, target, options));

      expect(entryIds(call.entries)).toEqual(ordinaryIds);
    } else {
      // Branch: Undefined call.
    }
  });

  it('calls preventDefault synchronously on event dispatch before async provider settles', async (): Promise<void> => {
    const { view, mount } = createTestEditor('Plain paragraph text content.');
    const fakeMenu = createFakePopupMenu();

    type SpellResolver = (entries: readonly PopupMenuEntry[]) => void;
    let settleSpellPromise: SpellResolver | null = null;

    const pendingPromise = new Promise<readonly PopupMenuEntry[]>((resolve: SpellResolver): void => {
      settleSpellPromise = resolve;
    });

    const options: ContextMenuOptions = {
      menu: fakeMenu,
      view,
      pane: mount,
      doc: document,
      openLink: (): void => {},
      followLink: (_href: string): void => {},
      editImage: (): void => {},
      spellEntries: (): Promise<readonly PopupMenuEntry[]> => pendingPromise,
    };

    const contextMenu = installContextMenu(options);
    activeContextMenus.push(contextMenu);

    // Dispatch contextmenu event.
    const event = dispatchContextMenu(mount, 50, 50);

    // Assert that preventDefault was invoked synchronously before the promise settles.
    // This is the whole point: the browser checks defaultPrevented synchronously at the end
    // of the event dispatch tick. If preventDefault were deferred until after awaiting spellEntries,
    // the browser's own native context menu (Back, Reload, View Source) would already appear on screen.
    expect(event.defaultPrevented).toBe(true);

    // Assert that the menu has not yet opened while the promise is still pending.
    expect(fakeMenu.recorded.length).toBe(0);

    // Settle the provider promise now.
    expect(settleSpellPromise).not.toBeNull();
    // Check if resolver was captured.
    if (settleSpellPromise !== null) {
      // Branch: Resolver defined; resolve promise with empty list.
      (settleSpellPromise as SpellResolver)([]);
    } else {
      // Branch: Resolver null.
    }

    await flush();

    // After resolving and flushing macrotasks, the menu has opened.
    expect(fakeMenu.recorded.length).toBe(1);
  });

  it('records nothing when contextmenu event is dispatched after destroy()', async (): Promise<void> => {
    const { view, mount } = createTestEditor('Plain paragraph text content.');
    const fakeMenu = createFakePopupMenu();

    const options: ContextMenuOptions = {
      menu: fakeMenu,
      view,
      pane: mount,
      doc: document,
      openLink: (): void => {},
      followLink: (_href: string): void => {},
      editImage: (): void => {},
    };

    const contextMenu = installContextMenu(options);
    // Destroy controller immediately before dispatching event.
    contextMenu.destroy();

    dispatchContextMenu(mount, 75, 85);
    await flush();

    // After destroy, event listeners are aborted via AbortController; nothing is recorded.
    expect(fakeMenu.recorded.length).toBe(0);
  });

  it('opens nothing when destroy() is called during the await gap of a pending provider', async (): Promise<void> => {
    const { view, mount } = createTestEditor('Plain paragraph text content.');
    const fakeMenu = createFakePopupMenu();

    type SpellResolver = (entries: readonly PopupMenuEntry[]) => void;
    let settleSpellPromise: SpellResolver | null = null;

    const pendingPromise = new Promise<readonly PopupMenuEntry[]>((resolve: SpellResolver): void => {
      settleSpellPromise = resolve;
    });

    const options: ContextMenuOptions = {
      menu: fakeMenu,
      view,
      pane: mount,
      doc: document,
      openLink: (): void => {},
      followLink: (_href: string): void => {},
      editImage: (): void => {},
      spellEntries: (): Promise<readonly PopupMenuEntry[]> => pendingPromise,
    };

    const contextMenu = installContextMenu(options);

    // Dispatch contextmenu event, entering the async listener up to `await options.spellEntries()`.
    dispatchContextMenu(mount, 50, 50);

    // Destroy the controller while the spellEntries promise is pending in flight.
    // This is the gap the async listener introduced: between the synchronous event dispatch and the
    // asynchronous resolution of spelling suggestions, the editor pane or controller may be destroyed.
    // installContextMenu checks `if (destroyed) return;` immediately after the await to prevent opening
    // a popup menu on a dead controller.
    contextMenu.destroy();

    // Settle the pending promise after destroying the controller.
    expect(settleSpellPromise).not.toBeNull();
    // Check if resolver was captured.
    if (settleSpellPromise !== null) {
      // Branch: Resolver defined; resolve spelling suggestions.
      (settleSpellPromise as SpellResolver)([
        {
          id: 'spell:late-suggestion',
          label: 'Late Suggestion',
          hint: '',
          enabled: true,
          run: (): void => {},
        },
      ]);
    } else {
      // Branch: Resolver null.
    }

    await flush();

    // Because the controller was destroyed during the await gap, openAt must never be called.
    expect(fakeMenu.recorded.length).toBe(0);
  });
});
