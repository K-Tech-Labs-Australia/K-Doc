/**
 * @file annotation-store.ts
 * @purpose Webview-side client adapter for the K-Doc annotation store (FR-6.16, FR-6.17, FR-6.18, FR-6.19, FR-6.20, FR-6.23).
 *   Coordinates document identity management via YAML front matter kdoc_id, interacts with native Tauri store IPC commands
 *   for line-oriented JSON (JSONL) comments and changes persistence, and ensures benign degradation when running outside desktop runtime.
 * @inputs AnnotationStoreOptions containing Window context, documentPath probe, readText getter, applyText callback, and optional onError callback;
 *   serialized JSONL annotation file payloads returned from Tauri IPC invoke commands.
 * @outputs AnnotationKind and StoreInfo types, AnnotationStoreOptions and AnnotationStore interfaces, and createAnnotationStore factory function.
 * @functions
 *   - isTauri: Probes whether the runtime is a Tauri desktop host via __TAURI_INTERNALS__ without throwing exceptions.
 *   - createAnnotationStore: Factory constructing the AnnotationStore client adapter bound to the provided window and document session context.
 * @dataflow Document source text -> readKdocId / withKdocId / withoutKdocId -> applyText;
 *   in-memory records -> mergeRecords -> encodeJsonl -> Tauri store_write IPC;
 *   Tauri store_read IPC -> decodeJsonl -> surviving records and problems.
 * @controlflow Capability probe via isTauri(win) -> construct AnnotationStore interface ->
 *   resolve invokes store_resolve -> peekId inspects text without writing ->
 *   load inspects kdoc_id, invokes store_read, and decodes JSONL ->
 *   save manages identity lazily (acquires on first record, strips on last deletion) and writes JSONL ->
 *   createVault invokes store_create_vault -> migrateToVault invokes store_migrate ->
 *   destroy marks store inert and stops in-flight callbacks.
 * @version 1
 * @date 2026-09-06
 */

import { invoke } from '@tauri-apps/api/core';
import {
  generateUlid,
  readKdocId,
  withKdocId,
  withoutKdocId,
  encodeJsonl,
  decodeJsonl,
  mergeRecords,
  type JsonlRecord,
  type JsonlProblem,
} from '@k-doc/core';

export type AnnotationKind = 'comments' | 'changes';

export interface StoreInfo {
  readonly root: string;
  readonly isVault: boolean;
}

export interface AnnotationStoreOptions {
  readonly win: Window;
  /** The document's path on disk, or null for an unsaved buffer. */
  readonly documentPath: () => string | null;
  /** The document's current source text. */
  readonly readText: () => string;
  /**
   * Applies text that gained or lost its `kdoc_id`. The host owns the edit lock, so the store
   * never writes to the session itself.
   */
  readonly applyText: (text: string) => void;
  readonly onError?: (error: Error) => void;
}

export interface AnnotationStore {
  readonly available: boolean;
  resolve(): Promise<StoreInfo | null>;
  /** The document's id, or null when it has never been annotated. Never writes. */
  peekId(): string | null;
  load<T extends JsonlRecord>(kind: AnnotationKind): Promise<{ records: readonly T[]; problems: readonly JsonlProblem[] }>;
  save<T extends JsonlRecord>(kind: AnnotationKind, records: readonly T[]): Promise<void>;
  createVault(folder: string): Promise<string | null>;
  migrateToVault(folder: string): Promise<number>;
  destroy(): void;
}

/**
 * Narrow local interface extending the browser Window to declare Tauri runtime internals.
 */
interface TauriWindow extends Window {
  readonly __TAURI_INTERNALS__?: unknown;
}

/**
 * Checks whether the application is running inside a Tauri desktop host environment.
 *
 * @purpose Determines desktop runtime availability by detecting the Tauri global without throwing exceptions.
 * @inputs win - The browser Window object to inspect.
 * @outputs boolean - True if running inside Tauri host, false otherwise.
 * @dataflow Window object -> '__TAURI_INTERNALS__' property presence check -> boolean capability status.
 * @controlflow Inspect '__TAURI_INTERNALS__' in window -> return true if present, false if absent.
 */
function isTauri(win: Window): boolean {
  // Checking for the __TAURI_INTERNALS__ global is how the Tauri runtime announces itself.
  // Checking this property is preferable to a try/catch around a failing invoke,
  // because a capability check should not be implemented as an exception.
  const candidate = win as unknown as TauriWindow;

  // Check if '__TAURI_INTERNALS__' exists on the window object.
  if ('__TAURI_INTERNALS__' in candidate) {
    // Branch: Running inside Tauri desktop runtime host.
    return true;
  } else {
    // Branch: Running inside standard browser environment.
    return false;
  }
}

/**
 * Instantiates and activates the annotation store client adapter for K-Doc (FR-6.16, FR-6.17, FR-6.18, FR-6.19, FR-6.20, FR-6.23).
 *
 * @purpose Constructs an AnnotationStore controller managing store resolution, identity lifecycle, and JSONL persistence.
 * @inputs options - AnnotationStoreOptions specifying window context, document path, text read/apply callbacks, and error callback.
 * @outputs AnnotationStore - Controller interface exposing availability, store info, peekId, load, save, vault creation, migration, and destroy.
 * @dataflow AnnotationStoreOptions -> capability probe -> AnnotationStore controller interface.
 * @controlflow Probe Tauri runtime availability -> return AnnotationStore controller with methods wrapped in availability and destroyed guards.
 */
export function createAnnotationStore(options: AnnotationStoreOptions): AnnotationStore {
  const available = isTauri(options.win);
  let destroyed: boolean = false;

  /**
   * Helper to report errors to the optional onError callback without throwing.
   *
   * @purpose Dispatches caught errors to options.onError, wrapping non-Error values as Error instances.
   * @inputs err - The unknown error value caught during an operation.
   * @outputs void.
   * @dataflow err -> type check / wrapping -> options.onError(Error).
   * @controlflow Check if options.onError exists -> check err instanceof Error -> call onError.
   */
  function reportError(err: unknown): void {
    // Check if an error callback was provided in options.
    if (options.onError !== undefined) {
      // Check if the caught error is an instance of Error.
      if (err instanceof Error) {
        // Branch: Forward Error instance directly to onError.
        options.onError(err);
      } else {
        // Branch: Wrap non-Error value in an Error instance.
        options.onError(new Error(String(err)));
      }
    } else {
      // Branch: No error callback registered; silently ignore error.
    }
  }

  /**
   * Resolves the store root directory and vault status for the current document.
   *
   * @purpose Discovers whether a document uses a local vault store or the global fallback store (FR-6.18).
   * @inputs None.
   * @outputs Promise<StoreInfo | null> - The resolved store info, or null if unavailable/destroyed or on error.
   * @dataflow documentPath() -> invoke store_resolve -> parse StoreInfo -> return StoreInfo or null.
   * @controlflow Guard available -> guard destroyed -> invoke store_resolve -> guard destroyed -> return StoreInfo or null on catch.
   */
  async function resolve(): Promise<StoreInfo | null> {
    // Guard against running outside desktop environment.
    // Every method is a benign no-op returning an empty/neutral value when available is false,
    // so the browser dev harness runs unchanged.
    if (!available) {
      // Branch: Running outside Tauri desktop environment; return neutral null.
      return null;
    } else {
      // Branch: Desktop environment available; check destroyed state.
    }

    // Guard against invocations after store destruction.
    if (destroyed) {
      // Branch: Store has been destroyed; return null.
      return null;
    } else {
      // Branch: Store is active; proceed with store location resolution.
    }

    const docPath = options.documentPath();

    try {
      // Tauri v2 converts camelCase JS argument names to snake_case Rust parameters,
      // so pass `documentPath` from JavaScript.
      const res = await invoke<{ root: string; isVault: boolean }>('store_resolve', {
        documentPath: docPath,
      });

      // Guard against store destruction while invoke was in-flight.
      // An in-flight promise resolving afterwards must not touch state.
      if (destroyed) {
        // Branch: Store was destroyed during in-flight invoke; return null.
        return null;
      } else {
        // Branch: Store active; construct StoreInfo result.
      }

      return {
        root: res.root,
        isVault: res.isVault,
      };
    } catch (err: unknown) {
      // Branch: store_resolve invocation rejected.
      // Every invoke is wrapped so a rejection becomes an Error passed to onError and a neutral return.
      reportError(err);
      return null;
    }
  }

  /**
   * Reads the document's kdoc_id without writing one or querying the filesystem.
   *
   * @purpose Returns the document's identity ULID, or null if never annotated. Never writes.
   * @inputs None.
   * @outputs string | null - The document's kdoc_id ULID string, or null if no identity exists.
   * @dataflow readText() -> readKdocId() -> string | null.
   * @controlflow Guard available -> guard destroyed -> read text -> readKdocId -> return id or null.
   */
  function peekId(): string | null {
    // Guard against running outside desktop environment.
    // Every method is a benign no-op returning an empty/neutral value when available is false,
    // so the browser dev harness runs unchanged.
    if (!available) {
      // Branch: Running outside Tauri desktop environment; return neutral null.
      return null;
    } else {
      // Branch: Desktop environment available; check destroyed state.
    }

    // Guard against invocations after store destruction.
    if (destroyed) {
      // Branch: Store has been destroyed; return null.
      return null;
    } else {
      // Branch: Store active; inspect document text.
    }

    // peekId reads the id out of the current text and never writes one.
    // This is the read path, and a read that quietly created an identity would violate
    // FR-6.17's "never volunteered" the first time anything merely looked at a document.
    const text = options.readText();
    return readKdocId(text);
  }

  /**
   * Loads persisted annotation records and diagnostics for the specified kind.
   *
   * @purpose Deserializes annotation records from the store for the active document without throwing (FR-6.23).
   * @inputs kind: AnnotationKind - Partition kind ('comments' or 'changes').
   * @outputs Promise<{ records: readonly T[]; problems: readonly JsonlProblem[] }> - Loaded records and problems.
   * @dataflow readText() -> readKdocId() -> invoke store_read -> decodeJsonl() -> { records, problems }.
   * @controlflow Guard available -> guard destroyed -> check kdoc_id:
   *   - If null: return { records: [], problems: [] } immediately without filesystem round-trip.
   *   - If present: invoke store_read -> guard destroyed -> decodeJsonl -> return records & problems.
   */
  async function load<T extends JsonlRecord>(
    kind: AnnotationKind,
  ): Promise<{ records: readonly T[]; problems: readonly JsonlProblem[] }> {
    // Guard against running outside desktop environment.
    // Every method is a benign no-op returning an empty/neutral value when available is false,
    // so the browser dev harness runs unchanged.
    if (!available) {
      // Branch: Running outside Tauri desktop environment; return neutral empty result.
      return { records: [], problems: [] };
    } else {
      // Branch: Desktop environment available; check destroyed state.
    }

    // Guard against invocations after store destruction.
    if (destroyed) {
      // Branch: Store has been destroyed; return empty result.
      return { records: [], problems: [] };
    } else {
      // Branch: Store active; inspect document identity.
    }

    const currentText = options.readText();
    const id = readKdocId(currentText);

    // load returns { records: [], problems: [] } when there is no id —
    // a document with no identity has no annotations by definition,
    // and asking the filesystem would be a round trip whose answer is already known.
    if (id === null) {
      // Branch: Document has no kdoc_id; return empty records and problems without querying filesystem.
      return { records: [], problems: [] };
    } else {
      // Branch: Document has an identity; proceed to query the store.
    }

    const docPath = options.documentPath();

    let rawContent: string;
    try {
      // Tauri v2 converts camelCase JS argument names to snake_case Rust parameters,
      // so pass `documentPath` and `kdocId` from JavaScript.
      rawContent = await invoke<string>('store_read', {
        documentPath: docPath,
        kind,
        kdocId: id,
      });
    } catch (err: unknown) {
      // Branch: Failed store_read invocation (e.g. unreadable file or permission error).
      // FR-6.23: annotations are an overlay, and losing them must never stop a document from opening.
      // A failed store_read reports through onError and returns empty.
      reportError(err);
      return { records: [], problems: [] };
    }

    // Guard against store destruction while invoke was in flight.
    if (destroyed) {
      // Branch: Store was destroyed during in-flight read; return neutral empty result.
      return { records: [], problems: [] };
    } else {
      // Branch: Store active; decode content.
    }

    // Check if rawContent is empty.
    if (rawContent.trim() === '') {
      // Branch: Missing store file degrades to empty string in Rust (FR-6.23); return empty.
      return { records: [], problems: [] };
    } else {
      // Branch: Content present; deserialize JSONL records.
    }

    // load surfaces problems from decodeJsonl to the caller rather than throwing.
    // FR-6.23: annotations are an overlay, and losing them must never stop a document from opening.
    const result = decodeJsonl<T>(rawContent);
    return {
      records: result.records,
      problems: result.problems,
    };
  }

  /**
   * Saves annotation records for the specified kind, managing lazy identity acquisition and deletion.
   *
   * @purpose Persists annotation records with read-merge-encode semantics and manages kdoc_id in front matter (FR-6.16, FR-6.17).
   * @inputs kind: AnnotationKind - Partition kind ('comments' or 'changes').
   * @inputs records: readonly T[] - Array of annotation records to persist.
   * @outputs Promise<void>.
   * @dataflow records & readText() -> check empty / id presence ->
   *   - If records empty & has id: store_delete -> withoutKdocId -> applyText.
   *   - If records non-empty: withKdocId (if needed) -> store_read -> mergeRecords -> encodeJsonl -> store_write -> applyText.
   * @controlflow Guard available -> guard destroyed -> inspect records and id:
   *   - Empty records & has id: invoke store_delete -> guard destroyed -> strip id via withoutKdocId -> applyText.
   *   - Empty records & no id: return immediately.
   *   - Non-empty records & no id: generateUlid -> withKdocId -> store_write -> applyText.
   *   - Non-empty records & has id: store_read -> mergeRecords -> encodeJsonl -> store_write.
   */
  async function save<T extends JsonlRecord>(
    kind: AnnotationKind,
    records: readonly T[],
  ): Promise<void> {
    // Guard against running outside desktop environment.
    // Every method is a benign no-op returning an empty/neutral value when available is false,
    // so the browser dev harness runs unchanged.
    if (!available) {
      // Branch: Running outside Tauri desktop environment; benign no-op.
      return;
    } else {
      // Branch: Desktop environment available; check destroyed state.
    }

    // Guard against invocations after store destruction.
    if (destroyed) {
      // Branch: Store has been destroyed; abort benignly.
      return;
    } else {
      // Branch: Store active; proceed with save operation.
    }

    const currentText = options.readText();
    const id = readKdocId(currentText);
    const docPath = options.documentPath();

    // Check if records array is empty.
    if (records.length === 0) {
      // Check if the document has an existing id.
      if (id !== null) {
        // When records is empty and the document has an id, delete the store file and strip the id with withoutKdocId.
        // Comment that this is FR-6.17's other half — removing the field when the last annotation goes leaves no trace
        // that K-Doc was ever involved.
        try {
          // Tauri v2 converts camelCase JS argument names to snake_case Rust parameters,
          // so pass `documentPath` and `kdocId` from JavaScript.
          await invoke<void>('store_delete', {
            documentPath: docPath,
            kind,
            kdocId: id,
          });
        } catch (err: unknown) {
          // Branch: store_delete invocation failed.
          // Every invoke is wrapped so a rejection becomes an Error passed to onError and a neutral return.
          reportError(err);
        }

        // Guard against store destruction during in-flight delete promise.
        // destroy() makes every method inert; an in-flight promise resolving afterwards must not call applyText.
        if (destroyed) {
          // Branch: Store was destroyed while delete was in-flight; abort without calling applyText.
          return;
        } else {
          // Branch: Store still active; proceed to strip kdoc_id from document text.
        }

        const strippedText = withoutKdocId(options.readText());
        options.applyText(strippedText);
        return;
      } else {
        // Branch: records is empty and document has no id; nothing to delete or strip.
        return;
      }
    } else {
      // Branch: records is non-empty; proceed to acquire identity if needed and write.
    }

    let targetId: string;
    let acquiredKdocId: string | null = null;

    // When records is non-empty and the document has no id, generate one, write it into the text with withKdocId,
    // and hand that text to applyText.
    // Comment that this is the *only* moment a document acquires an identity, and that it is driven by an annotation
    // actually existing rather than by the store being consulted.
    if (id === null) {
      // Branch: Document currently has no identity; generate a new ULID and stage text update.
      targetId = generateUlid();
      // Only the decision is staged here; the text is read again after the store write, so anything typed
      // while it was in flight is kept rather than overwritten.
      acquiredKdocId = targetId;
    } else {
      // Branch: Document already possesses an identity; use existing kdoc_id.
      targetId = id;
    }

    // Read-merge-encode rather than appending: read the file first and mergeRecords the incoming set over it.
    // Comment that an append cannot express a deletion or an edit, and that another process may have written since the last read.
    let existingRecords: readonly T[] = [];
    if (id !== null) {
      // Branch: Existing document identity; read current stored records to merge over.
      try {
        // Tauri v2 converts camelCase JS argument names to snake_case Rust parameters,
        // so pass `documentPath` and `kdocId` from JavaScript.
        const rawContent = await invoke<string>('store_read', {
          documentPath: docPath,
          kind,
          kdocId: targetId,
        });

        // Check if existing content is non-empty.
        if (rawContent.trim() !== '') {
          // Branch: Existing records present on disk; decode surviving records.
          existingRecords = decodeJsonl<T>(rawContent).records;
        } else {
          // Branch: File absent or empty; start with empty existing records.
        }
      } catch (err: unknown) {
        // Branch: Failed to read existing store file; report error and fallback to empty existing records.
        reportError(err);
      }
    } else {
      // Branch: Newly generated id; no existing store file on disk.
    }

    // Guard against destruction during in-flight read promise.
    // destroy() makes every method inert; an in-flight promise resolving afterwards must not call applyText.
    if (destroyed) {
      // Branch: Store was destroyed while reading; abort before writing or calling applyText.
      return;
    } else {
      // Branch: Store active; merge incoming records over existing records and encode.
    }

    const merged = mergeRecords(existingRecords, records);
    const encoded = encodeJsonl(merged);

    try {
      // Tauri v2 converts camelCase JS argument names to snake_case Rust parameters,
      // so pass `documentPath` and `kdocId` from JavaScript.
      await invoke<void>('store_write', {
        documentPath: docPath,
        kind,
        kdocId: targetId,
        contents: encoded,
      });
    } catch (err: unknown) {
      // Branch: store_write invocation failed; report error and abort without applying text.
      reportError(err);
      return;
    }

    // Guard against store destruction during in-flight write promise.
    // destroy() makes every method inert; an in-flight promise resolving afterwards must not call applyText.
    if (destroyed) {
      // Branch: Store was destroyed while writing; abort without calling applyText.
      return;
    } else {
      // Branch: Store active; proceed to apply newly acquired identity if applicable.
    }

    // Check if new text with kdoc_id was staged for application.
    if (acquiredKdocId !== null) {
      // Branch: Document text acquired a kdoc_id; stamp it into the text as it is now and hand that to applyText.
      options.applyText(withKdocId(options.readText(), acquiredKdocId));
    } else {
      // Branch: Document already had kdoc_id; no text update required.
    }
  }

  /**
   * Initializes a vault store inside the specified folder.
   *
   * @purpose Creates `<folder>/.k-doc/` idempotently with standard layout and .gitignore (FR-6.19, FR-6.20).
   * @inputs folder: string - Absolute path of the folder to initialize as a vault.
   * @outputs Promise<string | null> - The store root path string on success, or null on error / unavailable / destroyed.
   * @dataflow folder -> invoke store_create_vault -> return store root string.
   * @controlflow Guard available -> guard destroyed -> invoke store_create_vault -> guard destroyed -> return vault root or null.
   */
  async function createVault(folder: string): Promise<string | null> {
    // Guard against running outside desktop environment.
    // Every method is a benign no-op returning an empty/neutral value when available is false,
    // so the browser dev harness runs unchanged.
    if (!available) {
      // Branch: Running outside Tauri desktop environment; return neutral null.
      return null;
    } else {
      // Branch: Desktop environment available; check destroyed state.
    }

    // Guard against invocations after store destruction.
    if (destroyed) {
      // Branch: Store has been destroyed; return null.
      return null;
    } else {
      // Branch: Store active; proceed with vault creation.
    }

    try {
      // Tauri v2 converts camelCase JS argument names to snake_case Rust parameters.
      const vaultRoot = await invoke<string>('store_create_vault', {
        folder,
      });

      // Guard against destruction during in-flight invoke.
      if (destroyed) {
        // Branch: Store was destroyed while creating vault; return null.
        return null;
      } else {
        // Branch: Store active; return created vault root path.
      }

      return vaultRoot;
    } catch (err: unknown) {
      // Branch: store_create_vault failed; report error and return neutral null.
      reportError(err);
      return null;
    }
  }

  /**
   * Migrates existing global store annotations for the current document into a target vault store.
   *
   * @purpose Losslessly moves annotation files from global fallback into `<folder>/.k-doc/` (FR-6.19).
   * @inputs folder: string - Destination vault folder path.
   * @outputs Promise<number> - Count of annotation files successfully migrated (0 to 2).
   * @dataflow readText() -> readKdocId() -> invoke store_migrate -> return moved count.
   * @controlflow Guard available -> guard destroyed -> read kdoc_id:
   *   - If null: return 0 (no annotations exist to migrate).
   *   - If present: invoke store_migrate -> guard destroyed -> return count or 0 on error.
   */
  async function migrateToVault(folder: string): Promise<number> {
    // Guard against running outside desktop environment.
    // Every method is a benign no-op returning an empty/neutral value when available is false,
    // so the browser dev harness runs unchanged.
    if (!available) {
      // Branch: Running outside Tauri desktop environment; return neutral 0.
      return 0;
    } else {
      // Branch: Desktop environment available; check destroyed state.
    }

    // Guard against invocations after store destruction.
    if (destroyed) {
      // Branch: Store has been destroyed; return 0.
      return 0;
    } else {
      // Branch: Store active; read document identity.
    }

    const currentText = options.readText();
    const id = readKdocId(currentText);

    // Check if the document has a kdoc_id.
    if (id === null) {
      // Branch: Document has no kdoc_id; no annotations exist to migrate, return 0 without invoking Rust.
      return 0;
    } else {
      // Branch: Document has an identity; proceed to invoke store_migrate.
    }

    try {
      // Tauri v2 converts camelCase JS argument names to snake_case Rust parameters,
      // so pass `kdocId` and `targetFolder` from JavaScript.
      const count = await invoke<number>('store_migrate', {
        kdocId: id,
        targetFolder: folder,
      });

      // Guard against destruction during in-flight invoke.
      if (destroyed) {
        // Branch: Store was destroyed while migrating; return 0.
        return 0;
      } else {
        // Branch: Store active; return migrated files count.
      }

      return count;
    } catch (err: unknown) {
      // Branch: store_migrate failed; report error and return neutral 0.
      reportError(err);
      return 0;
    }
  }

  /**
   * Destroys the annotation store instance and marks all methods inert.
   *
   * @purpose Makes the store instance inert and ensures in-flight operations cannot modify document state.
   * @inputs None.
   * @outputs void.
   * @dataflow None.
   * @controlflow Check destroyed flag -> if active set destroyed = true.
   */
  function destroy(): void {
    // Check if store is already destroyed.
    if (destroyed) {
      // Branch: Already destroyed; idempotent no-op.
      return;
    } else {
      // Branch: Mark store as destroyed to make all methods inert.
      destroyed = true;
    }
  }

  return {
    get available(): boolean {
      return available;
    },
    resolve,
    peekId,
    load,
    save,
    createVault,
    migrateToVault,
    destroy,
  };
}
