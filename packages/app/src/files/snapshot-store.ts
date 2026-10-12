/**
 * @file snapshot-store.ts
 * @purpose The webview side of local version snapshots (FR-11.8): writes a snapshot through the host, then deletes what the retention policy lets go, and lists and reads a document's snapshots.
 * @inputs A document path and text, a reason, the retention policy, and the clock.
 * @outputs SnapshotInfo records; host commands snapshot_write/list/read/delete.
 * @functions
 *   - createSnapshotStore: Builds the store exposing take, list, and read against the host.
 *   - target: Maps a path and text to the host's document-identifier payload.
 *   - list: Returns a document's snapshots, or an empty array without a host.
 *   - take: Writes a new snapshot then prunes per policy; null when nothing was written.
 *   - read: Fetches one snapshot's contents by id.
 * @dataflow text -> readKdocId -> snapshot_write -> snapshot_list -> snapshotsToPrune -> snapshot_delete.
 * @controlflow Every method does nothing (null or empty) without a desktop host; take prunes only after a new snapshot was written.
 * @version 1
 * @date 2026-09-16
 */

import { invoke } from '@tauri-apps/api/core';
import { readKdocId, snapshotsToPrune, type RetentionPolicy } from '@k-doc/core';

/**
 * Why a snapshot was taken; matches the values understood by the host's list.
 * @purpose Classifies the cause of a snapshot so it can be displayed and reasoned about.
 * @inputs None — supplied by the caller to take() and echoed into SnapshotInfo.reason.
 * @outputs Echoed verbatim onto every SnapshotInfo produced for that snapshot.
 * @dataflow Caller-supplied reason -> stored via snapshot_write -> surfaced in list results.
 * @controlflow None — a static string union with no behavior of its own.
 */
export type SnapshotReason = 'save' | 'manual' | 'timer' | 'restore';

/**
 * A single stored version of a document.
 * @purpose Represents one snapshot the host has persisted for a document.
 * @inputs None — produced by the host and returned to callers; not constructed here.
 * @outputs Returned from list() and take() as the record of a stored snapshot.
 * @dataflow Host writes file -> snapshot_list/snapshot_write parses it -> SnapshotInfo handed back.
 * @controlflow None — a plain data record with no behavior.
 */
export interface SnapshotInfo {
  /** The host's file name for this snapshot. */
  readonly id: string;
  /** Time the snapshot was taken, in milliseconds since the epoch. */
  readonly at: number;
  /** Why the snapshot was taken. */
  readonly reason: SnapshotReason;
  /** The stored size of the snapshot, in bytes. */
  readonly bytes: number;
}

/**
 * A host command invocation, generic over its return type and injectable for tests.
 * @purpose Calls a named host command with arguments and resolves to a typed result.
 * @inputs command — the host command name (e.g. snapshot_write); args — the command payload.
 * @outputs Promise<T> — the awaited typed result of the host command.
 * @dataflow (command, args) -> Tauri invoke or injected stub -> resolved T value.
 * @controlflow None — a thin pass-through to the underlying transport.
 */
export type SnapshotInvoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

/**
 * Options controlling how the store talks to the host.
 * @purpose Supplies availability, retention policy, clock, and an optional invoke override.
 * @inputs available — false in the browser build; policy/now — accessors for policy and time; invoke — optional host-call override.
 * @outputs None consumed directly; read by createSnapshotStore to bind the store methods.
 * @dataflow Options object -> createSnapshotStore -> call + method behavior.
 * @controlflow None — a configuration record read once at construction.
 */
export interface SnapshotStoreOptions {
  /** False in the browser build where no desktop host is present. */
  readonly available: boolean;
  /** Returns the current retention policy used to decide which snapshots to prune. */
  readonly policy: () => RetentionPolicy;
  /** Returns the current time, in milliseconds since the epoch. */
  readonly now: () => number;
  /** The host call; defaults to Tauri's invoke when omitted so tests need no Tauri. */
  readonly invoke?: SnapshotInvoke;
}

/**
 * The webview-facing handle for managing a document's snapshots.
 * @purpose Exposes take, list, and read over the host for a single document.
 * @inputs None — methods receive path/text/id per call rather than from this object.
 * @outputs Returned by createSnapshotStore; its methods yield SnapshotInfo records and snapshot text.
 * @dataflow Caller -> store method -> host command -> result back to caller.
 * @controlflow None — a stateless handle whose behavior is delegated to the host.
 */
export interface SnapshotStore {
  /** Whether snapshots are available, i.e. whether a desktop host is present. */
  readonly available: boolean;
  /** Writes a new snapshot through the host and prunes per policy; null when nothing was written. */
  take(path: string, text: string, reason: SnapshotReason): Promise<SnapshotInfo | null>;
  /** Lists the document's snapshots, or an empty array without a host. */
  list(path: string, text: string): Promise<readonly SnapshotInfo[]>;
  /** Reads and returns a single snapshot's contents by id. */
  read(path: string, text: string, id: string): Promise<string>;
}

/**
 * Builds the snapshot store bound to the given options.
 * @purpose Creates the store object exposing take, list, and read against the host.
 * @inputs options — availability flag, retention policy accessor, clock, and optional invoke override.
 * @outputs SnapshotStore — a handle with available, take, list, and read methods.
 * @dataflow options -> call (defaults to Tauri invoke) -> store methods.
 * @controlflow Resolve the invoke function, then return an object binding the internal helpers.
 */
export function createSnapshotStore(options: SnapshotStoreOptions): SnapshotStore {
  // Use the injected invoke when provided; otherwise fall back to Tauri's invoke so tests need no host.
  const call: SnapshotInvoke = options.invoke ?? (<T>(command: string, args: Record<string, unknown>): Promise<T> => invoke<T>(command, args));

  /**
   * Maps a document path and its text into the payload the host expects.
   * @purpose Builds the host command arguments identifying the target document.
   * @inputs path — the document's path; text — the current document contents.
   * @outputs Record<string, unknown> — an object with documentPath and kdocId (plus at/reason/contents added by callers).
   * @dataflow path + text -> readKdocId(text) -> { documentPath, kdocId }.
   * @controlflow Always returns the same shape; no branching.
   */
  function target(path: string, text: string): Record<string, unknown> {
    return { documentPath: path, kdocId: readKdocId(text) };
  }

  /**
   * Lists a document's snapshots through the host.
   * @purpose Returns the stored snapshots for a document, or nothing without a host.
   * @inputs path — the document's path; text — the current document contents (for its kdoc_id).
   * @outputs Promise<readonly SnapshotInfo[]> — the snapshot list, or an empty array when unavailable.
   * @dataflow target(path, text) -> snapshot_list -> parsed SnapshotInfo[] array.
   * @controlflow Returns early with [] when no host is available; otherwise awaits the list command.
   */
  async function list(path: string, text: string): Promise<readonly SnapshotInfo[]> {
    // No desktop host means snapshots cannot be listed, so return an empty result.
    if (!options.available) {
      return [];
    } else {
      // A host is present; query its snapshot_list command for this document.
      return call<SnapshotInfo[]>('snapshot_list', target(path, text));
    }
  }

  /**
   * Writes a new snapshot and prunes older ones per the retention policy.
   * @purpose Persists the current document as a snapshot, then deletes what the policy lets go.
   * @inputs path — the document's path; text — the current contents to store; reason — why it was taken.
   * @outputs Promise<SnapshotInfo | null> — the written snapshot, or null when nothing new was stored.
   * @dataflow target(path, text) + now() + reason + text -> snapshot_write -> snapshot_list -> snapshotsToPrune -> snapshot_delete.
   * @controlflow Returns early with null without a host; prunes only after a new snapshot was written.
   */
  async function take(path: string, text: string, reason: SnapshotReason): Promise<SnapshotInfo | null> {
    // No desktop host means nothing can be written, so return null immediately.
    if (!options.available) {
      return null;
    } else {
      // A host is present; fall through to write the snapshot below.
    }
    const written = await call<SnapshotInfo | null>('snapshot_write', { ...target(path, text), at: options.now(), reason, contents: text });
    // The host skips writing when the text matches the newest snapshot, so nothing new needs pruning.
    if (written === null) {
      return null;
    } else {
      // A new snapshot was stored; proceed to prune per policy below.
    }
    const prune = snapshotsToPrune(await list(path, text), options.now(), options.policy());
    // Retention runs after each new snapshot so the folder never grows past the policy.
    if (prune.length > 0) {
      await call<number>('snapshot_delete', { ...target(path, text), ids: prune });
    } else {
      // Nothing exceeded the policy; leave all snapshots in place.
    }
    return written;
  }

  /**
   * Reads a single snapshot's contents by id through the host.
   * @purpose Fetches and returns the stored text of one snapshot.
   * @inputs path — the document's path; text — the current contents (for its kdoc_id); id — the snapshot to read.
   * @outputs Promise<string> — the snapshot's stored text.
   * @dataflow target(path, text) + id -> snapshot_read -> returned string.
   * @controlflow Fails fast without a host; otherwise awaits the read command.
   */
  async function read(path: string, text: string, id: string): Promise<string> {
    // There is nothing to read without a desktop host, so fail fast rather than call into the void.
    if (!options.available) {
      throw new Error('Snapshots are only available in the K-Doc desktop app.');
    } else {
      // A host is present; fetch this snapshot's contents by id.
      return call<string>('snapshot_read', { ...target(path, text), id });
    }
  }

  return { available: options.available, take, list, read };
}
