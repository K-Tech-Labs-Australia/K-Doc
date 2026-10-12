/**
 * @file window-handoff.ts
 * @purpose Implementation of document window handoff for K-Doc (FR-6.8), enabling detaching a document into a new window and claiming it upon launch.
 *
 *   HEADER NOTE: A handoff document is claimed destructively: the window is being given the
 *   document, not shown a copy of it, and a reload that claimed again would duplicate the user's
 *   work into two windows. In the desktop application, Tauri IPC commands (open_document_window,
 *   take_handoff_document) manage window lifecycle and document ownership transfer. In the browser
 *   environment outside Tauri, localStorage key parking paired with a query parameter provides
 *   inter-window transfer for Vite dev parity. If neither host environment is available, the store
 *   reports available: false and gracefully no-ops without throwing exceptions.
 *
 * @inputs Browser Window context for capability detection, navigation, and localStorage; HandoffDocument payloads holding text and optional file path; Tauri IPC commands and queries.
 * @outputs HandoffDocument and WindowHandoff interfaces, HANDOFF_PARAM and HANDOFF_KEY_PREFIX constants, and createWindowHandoff factory.
 * @functions
 *   - createWindowHandoff: Factory constructing the WindowHandoff coordinator for detaching and claiming documents across windows.
 *   - toHandoffDocument: Turns a validated payload into a HandoffDocument, dropping null or absent baseline and encoding.
 * @dataflow Document state -> WindowHandoff.detach() -> Tauri IPC / localStorage -> new window launch -> WindowHandoff.claim() -> restored document.
 * @controlflow createWindowHandoff probes runtime via isTauri / getUsableLocalStorage -> returns active backend -> detach persists payload and opens new window -> claim retrieves, deletes, parses, and validates payload.
 * @version 2
 * @date 2026-09-14
 */

import { invoke } from '@tauri-apps/api/core';

/** A document being moved from one window to another. */
export interface HandoffDocument {
  readonly text: string;
  readonly path: string | null;
  /**
   * The text as of the document's last save, when it differs from `text`. Without it the new window takes
   * unsaved work as saved: no close warning, no autosave.
   */
  readonly savedText?: string;
  /** The encoding the file was found in, so the new window saves it back the same way. Absent means UTF-8. */
  readonly encoding?: string;
}

export interface WindowHandoff {
  /** False when neither a Tauri host nor a usable browser window is available. */
  readonly available: boolean;
  /**
   * Opens a new window showing this document. Resolves true when one was opened.
   */
  detach(document: HandoffDocument): Promise<boolean>;
  /**
   * Returns the document this window was opened to show, or null for an ordinary launch.
   * Claiming is destructive: a handoff is consumed once, so a reload shows the document the
   * window already has rather than a second copy of it.
   */
  claim(): Promise<HandoffDocument | null>;
}

/** The query parameter naming a pending handoff, outside Tauri. */
export const HANDOFF_PARAM: string = 'handoff';

/** The localStorage key prefix a pending handoff is parked under, outside Tauri. */
export const HANDOFF_KEY_PREFIX: string = 'kdoc.handoff.';

/**
 * Shape of the handoff document payload crossing the IPC boundary or stored in browser localStorage.
 */
interface HandoffPayload {
  readonly text: string;
  readonly path: string | null;
  // The Rust host sends null for an absent value; an older payload has neither key.
  readonly savedText?: string | null;
  readonly encoding?: string | null;
}

/**
 * Narrow local interface extending the browser Window to declare Tauri runtime internals.
 */
interface TauriWindow extends Window {
  readonly __TAURI_INTERNALS__?: unknown;
}

/**
 * Type guard validating that an unknown value conforms to the HandoffPayload interface.
 *
 * @purpose Narrow untrusted IPC payloads and deserialized JSON to HandoffPayload safely without any.
 * @inputs value - Unknown candidate value to validate.
 * @outputs boolean - True if value matches HandoffPayload structure, false otherwise.
 * @dataflow value -> property inspection and type validation -> boolean assertion result.
 * @controlflow Verify value is non-null object -> check text is string -> check path is string or null -> return boolean.
 */
function isHandoffPayload(value: unknown): value is HandoffPayload {
  // Check if value is a non-null object.
  if (typeof value !== 'object' || value === null) {
    // Branch: Value is null or a primitive; not a handoff payload.
    return false;
  } else {
    // Branch: Value is an object; proceed to validate property types.
  }

  const candidate = value as Record<string, unknown>;

  // Check if 'text' exists and is a string.
  const text = candidate['text'];
  if (typeof text !== 'string') {
    // Branch: Missing or non-string text property.
    return false;
  } else {
    // Branch: Valid string text property present.
  }

  // Check if 'path' exists and is either a string or null.
  const path = candidate['path'];
  if (typeof path !== 'string' && path !== null) {
    // Branch: Path property is neither a string nor null.
    return false;
  } else {
    // Branch: Valid path property (string or null) present.
  }


  // Check that 'savedText', when present, is a string or null.
  const savedText = candidate['savedText'];
  if (savedText !== undefined && savedText !== null && typeof savedText !== 'string') {
    // Branch: savedText has the wrong type.
    return false;
  } else {
    // Branch: absent, null, or a string - all valid.
  }

  // Check that 'encoding', when present, is a string or null.
  const encoding = candidate['encoding'];
  if (encoding !== undefined && encoding !== null && typeof encoding !== 'string') {
    // Branch: encoding has the wrong type.
    return false;
  } else {
    // Branch: absent, null, or a string - all valid.
  }

  return true;
}

/**
 * Turns a validated handoff payload into a HandoffDocument, dropping null or absent baseline and encoding.
 *
 * @purpose Converts a validated HandoffPayload into a HandoffDocument, omitting optional fields that are not real strings.
 * @inputs payload - The validated HandoffPayload crossing the IPC boundary or read from localStorage.
 * @outputs HandoffDocument - A document carrying text and path, plus savedText and encoding only when present as strings.
 * @dataflow payload -> conditional field extraction -> HandoffDocument returned to caller.
 * @controlflow Return required fields always; spread savedText only if a string; spread encoding only if a string.
 */
function toHandoffDocument(payload: HandoffPayload): HandoffDocument {
  // Assemble the document from the payload's required fields, then layer on optional baseline and encoding only when present.
  return {
    text: payload.text,
    path: payload.path,
    // Include savedText only when it is a real string; null or absent baseline must not be carried forward.
    ...(typeof payload.savedText === 'string' ? { savedText: payload.savedText } : {}),
    // Include encoding only when the file was found in a specific encoding so the new window saves it back the same way.
    ...(typeof payload.encoding === 'string' ? { encoding: payload.encoding } : {}),
  };
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
 * Safely probes and retrieves the window localStorage instance, catching any permission or security errors.
 *
 * @purpose Validates whether localStorage is accessible without crashing the application in private browsing or restricted environments.
 * @inputs win - The browser Window object to inspect.
 * @outputs Storage | null - The Storage object if usable, or null if inaccessible or throwing.
 * @dataflow win.localStorage -> probe read/write -> Storage reference or null.
 * @controlflow Access win.localStorage -> test probe setItem and removeItem -> return Storage if successful -> return null on throw or missing.
 */
function getUsableLocalStorage(win: Window): Storage | null {
  // Wrap every localStorage access in try/catch and treat a throw as "unavailable".
  // Private-browsing modes and storage-blocking settings make localStorage throw on access
  // rather than merely returning null, so an unguarded read takes the whole editor down.
  try {
    const storage = win.localStorage;

    // Check if the localStorage property is defined and non-null.
    if (!storage) {
      // Branch: localStorage is absent on the window context.
      return null;
    } else {
      // Branch: localStorage exists; verify read and write access.
    }

    // Probe storage with a write and remove to ensure access is not blocked by privacy settings.
    const probeKey = '__kdoc_handoff_probe__';
    storage.setItem(probeKey, probeKey);
    storage.removeItem(probeKey);

    return storage;
  } catch {
    // Branch: Accessing or probing localStorage threw an exception; treat as unavailable.
    return null;
  }
}

/**
 * Builds a unique localStorage key for parking a detached document outside Tauri.
 *
 * @purpose Generates a collision-resistant handoff storage key with prefix, timestamp, and random suffix.
 * @inputs None.
 * @outputs string - The formatted handoff storage key.
 * @dataflow HANDOFF_KEY_PREFIX + Date.now() + random suffix -> formatted key string.
 * @controlflow Read current timestamp -> generate random alphanumeric suffix -> concatenate with prefix and return.
 */
function handoffKey(): string {
  // Two windows detached in the same millisecond must not collide.
  const suffix = Math.random().toString(36).slice(2, 10);
  return `${HANDOFF_KEY_PREFIX}${Date.now()}-${suffix}`;
}

/**
 * Constructs a WindowHandoff implementation backed by native Tauri IPC commands.
 *
 * @purpose Coordinates window handoff using Tauri commands open_document_window and take_handoff_document.
 * @inputs None.
 * @outputs WindowHandoff - Active Tauri window handoff coordinator with available: true.
 * @dataflow Document -> Tauri open_document_window IPC -> new window -> Tauri take_handoff_document IPC -> claimed document.
 * @controlflow Wrap invoke calls in try/catch -> detach returns false on error -> claim returns null on error or malformed payload.
 */
function createTauriWindowHandoff(): WindowHandoff {
  return {
    available: true,

    /**
     * Detaches a document to a new Tauri window via open_document_window.
     *
     * @purpose Invokes Tauri open_document_window command to open a separate application window.
     * @inputs document - The HandoffDocument holding text content and optional disk path.
     * @outputs Promise<boolean> - Resolves true on successful window creation, false on rejection.
     * @dataflow document -> invoke('open_document_window') -> boolean success status.
     * @controlflow Invoke open_document_window -> return true on success -> catch error, narrow with instanceof Error, and return false.
     */
    async detach(document: HandoffDocument): Promise<boolean> {
      try {
        // Absent values cross as null, which the host's Option parameters accept.
        await invoke('open_document_window', {
          text: document.text,
          path: document.path,
          savedText: document.savedText ?? null,
          encoding: document.encoding ?? null,
        });

        return true;
      } catch {
        // A window that would not open is a thing to report, not a crash. The reason does not change
        // the answer, so the error is not narrowed: either way no window appeared.
        return false;
      }
    },

    /**
     * Claims a pending handoff document from the Tauri host via take_handoff_document.
     *
     * @purpose Retrieves and destructively consumes the handoff document prepared for this window.
     * @inputs None.
     * @outputs Promise<HandoffDocument | null> - Resolves with validated document or null if absent / malformed.
     * @dataflow invoke('take_handoff_document') -> runtime validation -> HandoffDocument or null.
     * @controlflow Invoke take_handoff_document -> check non-null -> validate schema with isHandoffPayload -> return document or null.
     */
    async claim(): Promise<HandoffDocument | null> {
      try {
        const result = await invoke<HandoffPayload | null>('take_handoff_document');

        // Check if result is absent (null or undefined).
        if (result === null || result === undefined) {
          // Branch: No handoff document was pending in the host.
          return null;
        } else {
          // Branch: Candidate payload present; validate shape across IPC boundary.
        }

        // Validate the shape at runtime before trusting it — crosses the IPC boundary.
        if (isHandoffPayload(result)) {
          // Branch: Payload conforms to HandoffPayload structure; return document.
          return toHandoffDocument(result);
        } else {
          // Branch: Malformed payload received; return null.
          return null;
        }
      } catch {
        // No handoff could be read, for whatever reason: this window opens on its own document rather
        // than failing to open at all.
        return null;
      }
    },
  };
}

/**
 * Constructs a fallback WindowHandoff persisting handoff records in browser localStorage for development parity.
 *
 * @purpose Implements window handoff outside Tauri by parking document text in localStorage under a keyed query parameter.
 * @inputs win - The browser Window context for opening windows and reading URL search parameters.
 * @inputs storage - The verified usable browser Storage instance.
 * @outputs WindowHandoff - Active localStorage window handoff coordinator with available: true.
 * @dataflow Document -> localStorage setItem -> win.open with query param -> target window claim -> localStorage removeItem -> parsed document.
 * @controlflow Wrap storage operations in try/catch -> detach saves key and opens window, removing key on popup block -> claim reads param, reads item, removes item before parse, and validates payload.
 */
function createLocalStorageWindowHandoff(win: Window, storage: Storage): WindowHandoff {
  return {
    available: true,

    /**
     * Detaches a document to a new browser window by parking it in localStorage and opening a URL with a query parameter.
     *
     * @purpose Parks document in localStorage under a unique key and opens a new window referencing that key.
     * @inputs document - The HandoffDocument holding text content and optional disk path.
     * @outputs Promise<boolean> - Resolves true if window opened successfully, false if blocked or on error.
     * @dataflow document -> JSON serialization -> localStorage.setItem -> win.open -> popup verification.
     * @controlflow Generate key -> setItem -> win.open -> if opened is null remove key and return false -> return true.
     */
    async detach(document: HandoffDocument): Promise<boolean> {
      try {
        const key = handoffKey();
        storage.setItem(
          key,
          JSON.stringify({ text: document.text, path: document.path, savedText: document.savedText ?? null, encoding: document.encoding ?? null }),
        );

        const opened = win.open(`?${HANDOFF_PARAM}=${encodeURIComponent(key)}`, '_blank');

        // Check if the new window popup was blocked by the browser.
        if (opened === null) {
          // Branch: Popup was blocked; remove the parked key again to prevent storage leak and return false.
          // A parked document nobody will ever claim is a leak.
          try {
            storage.removeItem(key);
          } catch {
            // Branch: Removing key threw an exception; swallow and proceed to return false.
          }
          return false;
        } else {
          // Branch: New window opened successfully; return true.
          return true;
        }
      } catch {
        // Branch: Storage access or window.open threw an exception; return false without throwing.
        return false;
      }
    },

    /**
     * Claims a pending handoff document from localStorage using the URL query parameter.
     *
     * @purpose Destructively retrieves and parses the parked handoff document matching the URL query parameter.
     * @inputs None.
     * @outputs Promise<HandoffDocument | null> - Resolves with claimed document or null if absent / invalid.
     * @dataflow URL query parameter -> localStorage.getItem -> localStorage.removeItem -> JSON.parse -> isHandoffPayload validation.
     * @controlflow Read HANDOFF_PARAM from location.search -> getItem -> removeItem -> JSON.parse -> validate -> return document or null.
     */
    async claim(): Promise<HandoffDocument | null> {
      let key: string | null = null;
      try {
        const searchParams = new URLSearchParams(win.location.search);
        key = searchParams.get(HANDOFF_PARAM);
      } catch {
        // Branch: Reading URL parameters threw an exception; return null.
        return null;
      }

      // Check if the handoff query parameter is present and non-empty in the URL.
      if (key === null || key.length === 0) {
        // Branch: Ordinary launch or empty parameter without handoff key; return null.
        return null;
      } else {
        // Branch: Valid handoff parameter present; proceed to read from storage.
      }

      let raw: string | null = null;
      try {
        raw = storage.getItem(key);
      } catch {
        // Branch: localStorage.getItem threw an exception; return null.
        return null;
      }

      // Check if the item was found in storage.
      if (raw === null) {
        // Branch: No parked document found for key; return null.
        return null;
      } else {
        // Branch: Parked document found; proceed to remove and parse.
      }

      // Remove the item before parsing it, so a malformed entry cannot be claimed over and over.
      try {
        storage.removeItem(key);
      } catch {
        // Branch: localStorage.removeItem threw an exception; return null.
        return null;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Branch: JSON.parse threw a syntax error on malformed string; return null.
        return null;
      }

      // Check if parsed payload conforms to HandoffPayload interface.
      if (isHandoffPayload(parsed)) {
        // Branch: Valid handoff document payload; return claimed document.
        return toHandoffDocument(parsed);
      } else {
        // Branch: Parsed JSON does not conform to HandoffPayload; return null on anything unexpected.
        return null;
      }
    },
  };
}

/**
 * Constructs a fallback WindowHandoff for environments where neither Tauri nor localStorage is usable.
 *
 * @purpose Provides a non-throwing no-op window handoff coordinator when storage capabilities are completely absent.
 * @inputs None.
 * @outputs WindowHandoff - An unavailable coordinator whose methods resolve safely without throwing.
 * @dataflow Safe fallback defaults (false and null) returned for all operations.
 * @controlflow Return WindowHandoff object with available: false and non-throwing async methods.
 */
function createUnavailableWindowHandoff(): WindowHandoff {
  return {
    available: false,

    /**
     * No-op detach method when window handoff is unavailable.
     *
     * @purpose Safely rejects window detachment without throwing errors when backend is unavailable.
     * @inputs _document - Ignored HandoffDocument parameter.
     * @outputs Promise<boolean> - Always resolves to false.
     * @dataflow Ignored input -> false.
     * @controlflow Return Promise resolving to false.
     */
    async detach(_document: HandoffDocument): Promise<boolean> {
      // Branch: Window handoff is unavailable; detach resolves safely to false.
      return false;
    },

    /**
     * No-op claim method when window handoff is unavailable.
     *
     * @purpose Safely returns null without throwing errors when backend is unavailable.
     * @inputs None.
     * @outputs Promise<HandoffDocument | null> - Always resolves to null.
     * @dataflow No operation -> null.
     * @controlflow Return Promise resolving to null.
     */
    async claim(): Promise<HandoffDocument | null> {
      // Branch: Window handoff is unavailable; claim resolves safely to null.
      return null;
    },
  };
}

/**
 * Creates a window handoff coordinator instance bound to the provided window context.
 *
 * @purpose Selects the appropriate handoff backend (Tauri, browser localStorage fallback, or unavailable no-op) based on runtime capabilities.
 * @inputs win - The host browser Window object to inspect for Tauri desktop host capabilities or localStorage access.
 * @outputs WindowHandoff - An object implementing available, detach, and claim operations.
 * @dataflow Window capability checks -> selected WindowHandoff backend implementation.
 * @controlflow Probe Tauri runtime availability via isTauri(win) -> if present return Tauri coordinator -> else probe getUsableLocalStorage(win) -> if present return localStorage coordinator -> else return unavailable no-op coordinator.
 */
export function createWindowHandoff(win: Window): WindowHandoff {
  // Check whether running inside the Tauri desktop runtime host.
  if (isTauri(win)) {
    // Branch: Running inside Tauri desktop runtime host.
    return createTauriWindowHandoff();
  } else {
    // Branch: Running outside Tauri desktop host; probe for browser localStorage fallback.
  }

  const storage = getUsableLocalStorage(win);

  // Check whether browser localStorage is usable without throwing.
  if (storage !== null) {
    // Branch: Browser localStorage is usable; return fallback coordinator.
    return createLocalStorageWindowHandoff(win, storage);
  } else {
    // Branch: Neither Tauri nor localStorage is usable; return disabled coordinator.
    return createUnavailableWindowHandoff();
  }
}
