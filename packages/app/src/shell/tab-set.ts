/**
 * @file tab-set.ts
 * @purpose Implements pure state multi-document tab model managing tab records, activation state, MRU order, and subscriptions (FR-6.8).
 * @inputs Document payloads of generic type T; tab identifiers, positional indices, and subscriber listener callbacks.
 * @outputs TabSet class exposing tab lifecycle methods (open, close, activate, move, replacePayload, nextInMru, get, subscribe, snapshot) and TabRecord/TabSetSnapshot interfaces.
 * @functions
 *   - TabSet.constructor: Initializes an empty TabSet state container.
 *   - TabSet.snapshot: Returns a fresh frozen-by-convention snapshot of tabs, activeId, and mruIds.
 *   - TabSet.open: Appends a new tab with an incrementing id, activates it, and returns the generated id.
 *   - TabSet.close: Removes a tab, falls back activeId to surviving MRU or positional neighbour, and notifies subscribers.
 *   - TabSet.activate: Activates an existing tab, moving its id to the front of MRU order.
 *   - TabSet.move: Reorders a tab to a clamped positional index without altering activation or MRU order.
 *   - TabSet.nextInMru: Returns the second id in MRU order (previously active tab) for Ctrl+Tab navigation, or null.
 *   - TabSet.get: Looks up a tab by id and returns its associated payload, or null if not found.
 *   - TabSet.replacePayload: Updates the payload of an existing tab in place, preserving order and activation.
 *   - TabSet.subscribe: Registers a listener callback invoked after every settled state mutation and returns an unsubscribe disposer.
 *   - TabSet.notify: Dispatches the current state snapshot to all registered subscribers.
 * @dataflow Tab mutations (open/close/activate/move/replacePayload) -> internal state updates -> snapshot generation -> subscriber notifications.
 * @controlflow Caller invokes TabSet mutation -> validate tab existence / clamp parameters -> update internal tabs, activeId, and mruIds -> compute frozen snapshot -> notify subscribers.
 * @version 1
 * @date 2026-09-06
 */

export interface TabRecord<T> {
  readonly id: string;
  readonly payload: T;
}

export interface TabSetSnapshot<T> {
  readonly tabs: readonly TabRecord<T>[];
  readonly activeId: string | null;
  /** Most-recently-used order, newest first. Drives Ctrl+Tab. */
  readonly mruIds: readonly string[];
}

export class TabSet<T> {
  private tabs: TabRecord<T>[];
  private activeId: string | null;
  private mruIds: string[];
  private nextIdCounter: number;
  private readonly listeners: Set<(snapshot: TabSetSnapshot<T>) => void>;

  /**
   * Initializes a new, empty TabSet instance.
   *
   * @purpose Constructs a TabSet instance with an empty tabs list, null activeId, empty mruIds, and reset counter.
   * @inputs void.
   * @outputs TabSet<T> - A new TabSet instance.
   * @dataflow void -> initial state assignments.
   * @controlflow Initialize internal collections, activeId reference, and monotonic counter.
   */
  constructor() {
    this.tabs = [];
    this.activeId = null;
    this.mruIds = [];
    this.nextIdCounter = 1;
    this.listeners = new Set();
  }

  /**
   * Returns a fresh, immutable snapshot of the current tab set state.
   *
   * @purpose Constructs a frozen snapshot copy of tabs, activeId, and mruIds to prevent external mutation of internal state.
   * @inputs void.
   * @outputs TabSetSnapshot<T> - Immutable snapshot containing readonly tabs array, activeId, and readonly mruIds array.
   * @dataflow internal tabs, activeId, mruIds -> copy and freeze arrays & records -> return frozen TabSetSnapshot.
   * @controlflow Map tabs array to frozen TabRecord copies -> copy mruIds array -> freeze snapshot object and return.
   */
  get snapshot(): TabSetSnapshot<T> {
    // Every snapshot is a fresh frozen-by-convention object built from copies,
    // so a listener cannot mutate internal state by holding onto one.
    // Returning the live arrays would let a caller reorder tabs by accident.
    const tabsCopy: readonly TabRecord<T>[] = Object.freeze(
      this.tabs.map((tab: TabRecord<T>): TabRecord<T> => {
        return Object.freeze({
          id: tab.id,
          payload: tab.payload,
        });
      }),
    );

    const mruCopy: readonly string[] = Object.freeze([...this.mruIds]);

    return Object.freeze({
      tabs: tabsCopy,
      activeId: this.activeId,
      mruIds: mruCopy,
    });
  }

  /**
   * Opens a new tab with the specified payload, appends it to the tab list, and activates it.
   *
   * @purpose Appends a new tab record with a unique monotonically increasing id, activates it, and notifies subscribers.
   * @inputs payload - The data payload of type T to associate with the newly created tab.
   * @outputs string - The unique generated tab identifier (e.g., 'tab-1').
   * @dataflow payload -> create TabRecord with generated id -> append to tabs -> activate id -> notify subscribers -> return id.
   * @controlflow Generate unique id -> increment counter -> append tab record -> update activeId and prepend to mruIds -> dispatch snapshot to subscribers -> return id.
   */
  open(payload: T): string {
    // Ids are generated internally as tab-1, tab-2, … from a monotonically increasing counter.
    // Ids are never reused even after a close, because a reused id would let a stale reference
    // to a closed tab silently address a new document.
    const id = `tab-${this.nextIdCounter}`;
    this.nextIdCounter += 1;

    const record: TabRecord<T> = { id, payload };
    this.tabs.push(record);

    // open appends and activates the new tab.
    this.activeId = id;
    this.mruIds = [id, ...this.mruIds.filter((existingId: string): boolean => existingId !== id)];

    // Notify listeners after state has fully settled.
    this.notify();

    return id;
  }

  /**
   * Closes the tab with the specified id, removing it from open tabs and MRU order.
   *
   * @purpose Removes a tab by id, re-evaluates active tab selection if the closed tab was active, and notifies subscribers.
   * @inputs id - The string identifier of the tab to close.
   * @outputs void.
   * @dataflow id -> locate index in tabs -> remove from tabs and mruIds -> compute next active tab if active -> notify subscribers.
   * @controlflow Check if tab exists (return early if absent) -> record if closed tab was active -> splice from tabs -> filter out of mruIds -> if closed tab was active, resolve next active tab via MRU fallback, then positional neighbour fallback, then null -> update activeId and MRU order -> notify subscribers.
   */
  close(id: string): void {
    const tabIndex = this.tabs.findIndex((tab: TabRecord<T>): boolean => tab.id === id);

    // Check if the tab with the specified id exists.
    if (tabIndex === -1) {
      // Tab not found: closing an unknown or already closed tab is a no-op.
      return;
    } else {
      // Tab found: proceed with closing the tab.
    }

    // Check whether the tab being closed is the currently active tab.
    const wasActive: boolean = this.activeId === id;

    // Remove the tab from the tabs list.
    this.tabs.splice(tabIndex, 1);

    // Remove the closed tab id from the MRU tracking list.
    this.mruIds = this.mruIds.filter((mruId: string): boolean => mruId !== id);

    // When the closed tab was active, activate the most recent surviving tab from the MRU order,
    // falling back to the neighbouring tab, falling back to null when none remain.
    // MRU is the right fallback rather than "the tab to the left": closing a tab should
    // return you to what you were last looking at, which is almost never the positional neighbour.
    if (wasActive) {
      const firstSurvivingMruId = this.mruIds[0];
      // Check if a surviving tab exists in the MRU order.
      if (firstSurvivingMruId !== undefined) {
        // Most recent surviving tab in MRU order found: activate it.
        this.activeId = firstSurvivingMruId;
      } else {
        // No surviving tab in MRU: fall back to the neighbouring tab in the positional tabs array.
        const sameIndexNeighbor = this.tabs[tabIndex];
        // Check if a tab exists at the same index (the right neighbour that slid into tabIndex).
        if (sameIndexNeighbor !== undefined) {
          // Right neighbouring tab exists: activate it and place at front of MRU.
          this.activeId = sameIndexNeighbor.id;
          this.mruIds = [sameIndexNeighbor.id];
        } else {
          // Check if a left neighbouring tab exists (when closing the rightmost tab).
          const leftNeighborIndex = tabIndex - 1;
          const leftNeighbor = this.tabs[leftNeighborIndex];
          if (leftNeighbor !== undefined) {
            // Left neighbouring tab exists: activate it and place at front of MRU.
            this.activeId = leftNeighbor.id;
            this.mruIds = [leftNeighbor.id];
          } else {
            // No tabs remain: fall back to null.
            this.activeId = null;
            this.mruIds = [];
          }
        }
      }
    } else {
      // Closed tab was not active: activeId and surviving MRU order remain unchanged.
    }

    // Notify listeners after state has fully settled.
    this.notify();
  }

  /**
   * Activates the tab with the specified id, moving it to the front of MRU order.
   *
   * @purpose Sets activeId and moves the specified tab id to the front of mruIds, notifying subscribers.
   * @inputs id - The string identifier of the tab to activate.
   * @outputs void.
   * @dataflow id -> locate in tabs -> update activeId -> shift to front of mruIds -> notify subscribers.
   * @controlflow Check if tab exists in tabs array (return early if absent) -> update activeId -> reorder mruIds with id at index 0 -> notify subscribers.
   */
  activate(id: string): void {
    const tabExists = this.tabs.some((tab: TabRecord<T>): boolean => tab.id === id);

    // Check if the tab id exists in the tab set.
    if (!tabExists) {
      // Activating an unknown id is a no-op — comment that throwing would turn a stale click into a crash.
      return;
    } else {
      // Tab exists: proceed with activation.
    }

    // Set activeId to the activated tab.
    this.activeId = id;

    // Move the id to the front of mruIds.
    this.mruIds = [id, ...this.mruIds.filter((mruId: string): boolean => mruId !== id)];

    // Notify listeners after state has fully settled.
    this.notify();
  }

  /**
   * Reorders a tab to a new positional index within tabs, clamping toIndex into range without modifying activeId or MRU order.
   *
   * @purpose Repositions a tab within the positional tabs array while keeping activation and MRU order unchanged.
   * @inputs id - The string identifier of the tab to move.
   * @inputs toIndex - The target zero-based positional index, clamped to [0, tabs.length - 1].
   * @outputs void.
   * @dataflow id + toIndex -> locate fromIndex -> clamp toIndex -> splice remove -> splice insert -> notify subscribers.
   * @controlflow Check if tab exists (return early if absent) -> clamp toIndex to valid range -> check if tab is already at clamped index (return early if so) -> move tab element within tabs array -> notify subscribers.
   */
  move(id: string, toIndex: number): void {
    const fromIndex = this.tabs.findIndex((tab: TabRecord<T>): boolean => tab.id === id);

    // Check if the tab with the specified id exists.
    if (fromIndex === -1) {
      // Tab not found: moving an unknown tab is a no-op.
      return;
    } else {
      // Tab found: proceed with move operation.
    }

    // Clamp toIndex into the valid bounds [0, tabs.length - 1].
    const maxIndex = this.tabs.length - 1;
    let clampedIndex: number;
    // Check if target index is less than minimum index 0.
    if (toIndex < 0) {
      clampedIndex = 0;
    } else if (toIndex > maxIndex) {
      // Target index exceeds maximum available index: clamp to maxIndex.
      clampedIndex = maxIndex;
    } else {
      // Target index is within valid bounds.
      clampedIndex = toIndex;
    }

    // Check if tab is already at the clamped target index.
    if (fromIndex === clampedIndex) {
      // Tab is already at target position: no reordering required.
      return;
    } else {
      // Tab requires repositioning.
    }

    const tabRecord = this.tabs[fromIndex];
    // Check if tab record is defined under strict noUncheckedIndexedAccess.
    if (tabRecord === undefined) {
      // Safety guard: tab record unexpectedly undefined.
      return;
    } else {
      // Tab record is valid: proceed with reordering.
    }

    // Reorder within tabs.
    // It does not change activation or MRU order — dragging a tab to a new position
    // is not a statement about which one you want to look at.
    this.tabs.splice(fromIndex, 1);
    this.tabs.splice(clampedIndex, 0, tabRecord);

    // Notify listeners after state has fully settled.
    this.notify();
  }

  /**
   * Returns the tab id that Ctrl+Tab should navigate to (the previously active tab), or null if fewer than two tabs exist.
   *
   * @purpose Returns the second entry in mruIds representing the previously active tab.
   * @inputs void.
   * @outputs string | null - The identifier of the second tab in MRU order, or null if fewer than two tabs exist.
   * @dataflow mruIds -> inspect index 1 -> return string or null.
   * @controlflow Check if mruIds length is less than 2 (return null) -> inspect second entry mruIds[1] -> return id if defined, else null.
   */
  nextInMru(): string | null {
    // nextInMru() returns the second entry in mruIds (the previously active tab), or null when there are fewer than two.
    // Returning the second is what makes repeated Ctrl+Tab toggle between two documents, which is what the shortcut is actually used for.
    // Check if there are fewer than two tabs tracked in MRU order.
    if (this.mruIds.length < 2) {
      // Fewer than two tabs: no previous tab exists to toggle to.
      return null;
    } else {
      // At least two tabs exist in MRU order: read the second entry.
      const secondId = this.mruIds[1];
      // Check if secondId is defined under strict noUncheckedIndexedAccess.
      if (secondId !== undefined) {
        return secondId;
      } else {
        return null;
      }
    }
  }

  /**
   * Retrieves the payload associated with the specified tab id, or null if not found.
   *
   * @purpose Looks up a tab record by id and returns its associated payload.
   * @inputs id - The string identifier of the tab to query.
   * @outputs T | null - The payload associated with the tab, or null if the tab does not exist.
   * @dataflow id -> search tabs array -> extract payload or return null.
   * @controlflow Search tabs for matching id -> if found, return tab.payload; else return null.
   */
  get(id: string): T | null {
    const tabRecord = this.tabs.find((tab: TabRecord<T>): boolean => tab.id === id);

    // Check if a tab with the specified id was found.
    if (tabRecord !== undefined) {
      // Matching tab found: return its payload.
      return tabRecord.payload;
    } else {
      // No tab matches the specified id: return null.
      return null;
    }
  }

  /**
   * Replaces the payload of an existing tab in place, preserving positional order and activation state.
   *
   * @purpose Updates a tab's payload while keeping its id, positional index, active status, and MRU position unchanged.
   * @inputs id - The string identifier of the tab whose payload should be updated.
   * @inputs payload - The new payload of type T to assign to the tab.
   * @outputs void.
   * @dataflow id + payload -> locate index in tabs -> replace TabRecord in place -> notify subscribers.
   * @controlflow Check if tab exists (return early if absent) -> update tab record in tabs array -> notify subscribers.
   */
  replacePayload(id: string, payload: T): void {
    const tabIndex = this.tabs.findIndex((tab: TabRecord<T>): boolean => tab.id === id);

    // Check if the tab with the specified id exists.
    if (tabIndex === -1) {
      // Tab not found: replacing payload for an unknown tab is a no-op.
      return;
    } else {
      // Tab found: proceed with payload replacement.
    }

    // replacePayload swaps a tab's payload in place, keeping order and activation.
    // This exists because a tab's payload can be rebuilt (a document reloaded from disk)
    // without the tab itself changing identity.
    this.tabs[tabIndex] = { id, payload };

    // Notify listeners after state has fully settled.
    this.notify();
  }

  /**
   * Subscribes a listener to snapshot notifications dispatched on every state mutation.
   *
   * @purpose Registers a subscriber callback invoked after any mutation has settled, returning an unsubscription function.
   * @inputs listener - Callback function receiving a fresh TabSetSnapshot<T> whenever state mutates.
   * @outputs () => void - Disposer function that unsubscribes the listener when invoked.
   * @dataflow listener -> add to internal listeners set -> return unsubscribe closure deleting listener from set.
   * @controlflow Register listener in listeners set -> return teardown function that deletes listener from listeners set.
   */
  subscribe(listener: (snapshot: TabSetSnapshot<T>) => void): () => void {
    // subscribe notifies on every mutation and returns an unsubscribe.
    // Notify after the state has settled, never during, so a listener always reads a consistent snapshot.
    this.listeners.add(listener);

    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Dispatches the current state snapshot to all registered subscriber callbacks.
   *
   * @purpose Notifies all subscribers of a settled state mutation with a fresh snapshot.
   * @inputs void.
   * @outputs void.
   * @dataflow get snapshot -> currentSnapshot -> iterate listeners set -> invoke callbacks.
   * @controlflow Read fresh snapshot -> iterate copy of listeners set -> check if listener is still registered -> invoke listener with snapshot.
   */
  private notify(): void {
    // Compute the settled snapshot once for this notification cycle.
    const currentSnapshot = this.snapshot;

    // Iterate over a shallow copy of the listener set to safely allow unsubscriptions during notification.
    const registeredListeners = Array.from(this.listeners);
    for (let i = 0; i < registeredListeners.length; i++) {
      const listener = registeredListeners[i];
      // Check if listener is defined under strict noUncheckedIndexedAccess and still registered in listeners set.
      if (listener !== undefined && this.listeners.has(listener)) {
        // Listener is active: invoke with current snapshot.
        listener(currentSnapshot);
      } else {
        // Listener is undefined or was unsubscribed during this notification pass: skip.
      }
    }
  }
}
