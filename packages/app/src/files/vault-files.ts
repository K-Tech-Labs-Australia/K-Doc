/**
 * @file vault-files.ts
 * @purpose Webview-side facade over the desktop host's vault filesystem commands (FR-6.11), exposing a folder tree of notes and folders through Tauri IPC with runtime payload validation. Outside the desktop host every method rejects, so callers can probe `available` before touching disk.
 * @inputs Folder paths, note/folder relative paths, UTF-8 note contents, and a Window for capability detection; Tauri IPC command responses.
 * @outputs Resolved new paths (notes, folders, moves), folder lists, template listings, or rejections carrying the host's path-naming message.
 * @functions
 *   - isTauri: Detects the desktop Tauri runtime via its window global.
 *   - isStringArray: Type guard for a readonly array of strings returned by listing commands.
 *   - isTemplate: Per-item type guard for a VaultTemplate entry, using property presence without casts.
 *   - isTemplateList: Type guard for an array of VaultTemplate entries.
 *   - expectString: Coerces an IPC result to string or throws, naming the command that produced it.
 *   - call: invoke wrapper that normalises Tauri's string rejections into Error values.
 *   - createVaultFiles: Factory constructing the VaultFiles facade bound to a window.
 * @dataflow Window -> isTauri capability flag -> per-method requireHost gate -> call() IPC -> runtime type guard -> resolved value or thrown error.
 * @controlflow Detect host -> return facade whose methods each gate on availability, invoke a command, validate the payload shape, and propagate rejections unchanged.
 * @version 1
 * @date 2026-09-14
 */

import { invoke } from '@tauri-apps/api/core';

/** A single vault template exposed by `<root>/.k-doc/templates/`. */
export interface VaultTemplate {
  /** The template's file name without its extension, as the picker lists it. */
  readonly name: string;
  /** Absolute path of the template file. */
  readonly path: string;
}

/**
 * Webview-side view of the host's vault filesystem commands (FR-6.11).
 * Every method rejects when `available` is false, i.e. outside the desktop Tauri host.
 */
export interface VaultFiles {
  /** False outside the desktop host, where every method rejects. */
  readonly available: boolean;
  /** Every folder in the vault as a forward-slash path relative to root, sorted, hidden folders left out. */
  listFolders(root: string): Promise<readonly string[]>;
  /** Creates a note that must not exist yet, with the given UTF-8 contents. Resolves its path. */
  createNote(root: string, path: string, contents: string): Promise<string>;
  /** Creates an empty folder whose parent must exist. Resolves its path. */
  createFolder(root: string, path: string): Promise<string>;
  /** Moves or renames a note or folder, refusing to overwrite. Resolves the new path. */
  move(root: string, from: string, to: string): Promise<string>;
  /** Moves notes and folders to the Recycle Bin. */
  trash(root: string, paths: readonly string[]): Promise<void>;
  /** The templates in `<root>/.k-doc/templates/`, sorted by name. */
  listTemplates(root: string): Promise<readonly VaultTemplate[]>;
}

/**
 * Checks whether the application is running inside a Tauri desktop host environment.
 *
 * @purpose Detects the desktop runtime by inspecting for the Tauri window global without throwing.
 * @inputs win - The browser Window object to inspect.
 * @outputs boolean - True if the Tauri runtime global is present, false otherwise.
 * @dataflow Window -> '__TAURI_INTERNALS__' presence check -> boolean capability flag.
 * @controlflow Evaluate membership of '__TAURI_INTERNALS__' on win and return the result directly.
 */
function isTauri(win: Window): boolean {
  // The Tauri runtime announces itself by installing __TAURI_INTERNALS__ on window; its presence is the
  // capability signal, so a direct membership test replaces any try/catch around a failing invoke.
  return '__TAURI_INTERNALS__' in win;
}

/**
 * Type guard validating that an unknown value is a readonly array of strings.
 *
 * @purpose Validates the payload shape returned by folder-listing IPC commands.
 * @inputs value - Unknown candidate value from IPC.
 * @outputs boolean - True if value is an array whose every element is a string.
 * @dataflow value -> Array.isArray check -> every-element typeof string check -> boolean result.
 * @controlflow Reject non-arrays -> reject any non-string element -> return true only when all elements are strings.
 */
function isStringArray(value: unknown): value is readonly string[] {
  // An array of folder paths must be a real array with no primitive or mixed-type members.
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Per-item type guard validating that an unknown value is a VaultTemplate entry.
 *
 * @purpose Narrows a single IPC object to VaultTemplate using property presence, avoiding casts.
 * @inputs value - Unknown candidate object from IPC.
 * @outputs boolean - True if value is a non-null object whose name and path are both strings.
 * @dataflow value -> null/object check -> 'name' and 'path' membership checks -> boolean result.
 * @controlflow Reject primitives and null -> require both 'name' and 'path' keys present -> return boolean.
 */
function isTemplate(value: unknown): value is VaultTemplate {
  // The `in` operator requires an object operand, so the non-null object guard precedes the membership checks.
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'path' in value &&
    typeof value.name === 'string' &&
    typeof value.path === 'string'
  );
}

/**
 * Type guard validating that an unknown value is a readonly array of VaultTemplate entries.
 *
 * @purpose Validates the full template-list payload returned by `vault_list_templates`.
 * @inputs value - Unknown candidate value from IPC.
 * @outputs boolean - True if value is an array whose every element passes isTemplate.
 * @dataflow value -> Array.isArray check -> every-element isTemplate check -> boolean result.
 * @controlflow Reject non-arrays -> validate each element with isTemplate -> return true only when all pass.
 */
function isTemplateList(value: unknown): value is readonly VaultTemplate[] {
  // A template list must be a real array of well-formed entries; any malformed item invalidates the whole payload.
  return Array.isArray(value) && value.every((item) => isTemplate(item));
}

/**
 * Coerces an IPC result to a string or throws, naming the command that produced it.
 *
 * @purpose Normalises path-returning commands to their expected string shape before they reach callers.
 * @inputs value - Unknown candidate value from IPC.
 * @inputs command - The IPC command name, used to make a malformed-result error actionable.
 * @outputs string - The validated string value.
 * @dataflow value -> typeof string check -> return value or throw with command context.
 * @controlflow Accept strings unchanged -> reject every other shape by throwing an Error naming the command.
 */
function expectString(value: unknown, command: string): string {
  // Path-returning commands resolve to a plain string; pass it through when that is what arrived.
  if (typeof value === 'string') {
    // Branch: Value already has the expected string shape; return it unchanged.
    return value;
  } else {
    // Branch: Value has an unexpected shape; throw naming the command so callers can diagnose the host contract.
    throw new Error(`${command} returned an unexpected result`);
  }
}

/**
 * invoke wrapper that normalises Tauri's string rejections into Error values.
 *
 * @purpose Mediates every IPC call so a rejection always surfaces as a throwable Error carrying the host message.
 * @inputs command - The Tauri command name to invoke.
 * @inputs args - Arguments passed across the IPC boundary.
 * @outputs Promise<T> - Resolved IPC result, or a rejected promise wrapping an Error.
 * @dataflow invoke<T> -> resolved value returned; rejection caught -> Error (or original) rethrown.
 * @controlflow Attempt invoke inside try -> on rejection convert non-Error values to Error via String() -> always throw an Error.
 */
async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    // Perform the IPC call; a resolved value passes through unchanged.
    return await invoke<T>(command, args);
  } catch (caught: unknown) {
    // Tauri rejects with a plain string that names the offending path; keep genuine Errors intact and wrap
    // anything else so callers always receive an Error instance to inspect or rethrow. The message is preserved.
    throw caught instanceof Error ? caught : new Error(String(caught));
  }
}

/**
 * Factory constructing a VaultFiles facade bound to a window.
 *
 * @purpose Creates the app-side vault filesystem API, gated on Tauri host availability.
 * @inputs win - The host Window used for capability detection.
 * @outputs VaultFiles - The active facade whose methods reject outside the desktop host.
 * @dataflow win -> isTauri flag -> per-method requireHost gate -> call() IPC -> type guards -> resolved values.
 * @controlflow Detect Tauri runtime -> return facade exposing available plus six command methods that each gate, invoke, and validate.
 */
export function createVaultFiles(win: Window): VaultFiles {
  // Capability flag set once; every method consults it rather than re-probing the window on each call.
  const available = isTauri(win);

  /**
   * Rejects file operations when running outside the desktop host.
   *
   * @purpose Enforces that filesystem commands only run inside the Tauri host.
   * @inputs None.
   * @outputs void - Throws when unavailable; otherwise falls through silently.
   * @dataflow available flag -> boolean check -> throw or continue.
   * @controlflow Reject on !available -> permit execution when available.
   */
  function requireHost(): void {
    // Filesystem commands have no meaning outside the desktop host, so gate every one here before any IPC.
    if (!available) {
      // Branch: Not running inside the Tauri host; reject with an actionable message rather than a silent failure.
      throw new Error('File operations need the desktop app.');
    } else {
      // Branch: Running inside the Tauri host; filesystem commands are permitted, so fall through to the call.
    }
  }

  return {
    available,

    /**
     * Lists every folder in the vault as a forward-slash path relative to root.
     *
     * @purpose Invokes vault_list_folders and validates the returned string array.
     * @inputs root - Vault root folder path.
     * @outputs Promise<readonly string[]> - Sorted, hidden-excluded folder paths relative to root.
     * @dataflow root -> call('vault_list_folders') -> isStringArray validation -> resolved path list.
     * @controlflow Gate on host -> invoke command -> accept a valid string array or throw on unexpected shape.
     */
    async listFolders(root: string): Promise<readonly string[]> {
      requireHost();
      const value = await call<unknown>('vault_list_folders', { root });
      // Check the payload is the list of relative folder paths the host promises.
      if (isStringArray(value)) {
        // Branch: Payload is a valid array of folder paths; return it to the caller.
        return value;
      } else {
        // Branch: Payload has an unexpected shape; throw so the host contract mismatch is visible rather than swallowed.
        throw new Error('vault_list_folders returned an unexpected result');
      }
    },

    /**
     * Creates a note that must not exist yet, writing the given UTF-8 contents.
     *
     * @purpose Invokes vault_create_note and resolves its created path.
     * @inputs root - Vault root folder path.
     * @inputs path - Absolute path of the note inside the vault; must not already exist.
     * @inputs contents - UTF-8 text to write into the new note.
     * @outputs Promise<string> - The resolved path of the created note.
     * @dataflow (root, path, contents) -> call('vault_create_note') -> expectString validation -> created path.
     * @controlflow Gate on host -> invoke command -> coerce result to string or throw on unexpected shape.
     */
    async createNote(root: string, path: string, contents: string): Promise<string> {
      requireHost();
      return expectString(await call<unknown>('vault_create_note', { root, path, contents }), 'vault_create_note');
    },

    /**
     * Creates an empty folder whose parent must already exist.
     *
     * @purpose Invokes vault_create_folder and resolves its created path.
     * @inputs root - Vault root folder path.
     * @inputs path - Absolute path of the folder inside the vault; its parent must exist.
     * @outputs Promise<string> - The resolved path of the created folder.
     * @dataflow (root, path) -> call('vault_create_folder') -> expectString validation -> created path.
     * @controlflow Gate on host -> invoke command -> coerce result to string or throw on unexpected shape.
     */
    async createFolder(root: string, path: string): Promise<string> {
      requireHost();
      return expectString(await call<unknown>('vault_create_folder', { root, path }), 'vault_create_folder');
    },

    /**
     * Moves or renames a note or folder, refusing to overwrite an existing target.
     *
     * @purpose Invokes vault_move and resolves the new path after a non-overwriting move.
     * @inputs root - Vault root folder path.
     * @inputs from - Current path of the note or folder to move.
     * @inputs to - Destination path; must not already exist.
     * @outputs Promise<string> - The resolved new path of the moved item.
     * @dataflow (root, from, to) -> call('vault_move') -> expectString validation -> new path.
     * @controlflow Gate on host -> invoke command -> coerce result to string or throw on unexpected shape.
     */
    async move(root: string, from: string, to: string): Promise<string> {
      requireHost();
      return expectString(await call<unknown>('vault_move', { root, from, to }), 'vault_move');
    },

    /**
     * Moves notes and folders to the Recycle Bin.
     *
     * @purpose Invokes vault_trash for each supplied path and resolves once all are trashed.
     * @inputs root - Vault root folder path.
     * @inputs paths - Paths of notes or folders to move to the Recycle Bin.
     * @outputs Promise<void> - Resolves after the host has trashed every path.
     * @dataflow (root, paths) -> call('vault_trash') with a copied array -> host recycle-bin handling.
     * @controlflow Gate on host -> invoke command with a defensive copy of paths -> resolve on success.
     */
    async trash(root: string, paths: readonly string[]): Promise<void> {
      requireHost();
      // Copy the readonly input into a mutable array so the IPC payload never aliases caller state.
      await call<unknown>('vault_trash', { root, paths: [...paths] });
    },

    /**
     * Lists the templates stored in `<root>/.k-doc/templates/`, sorted by name.
     *
     * @purpose Invokes vault_list_templates and validates the returned template array.
     * @inputs root - Vault root folder path.
     * @outputs Promise<readonly VaultTemplate[]> - Template entries sorted by name.
     * @dataflow root -> call('vault_list_templates') -> isTemplateList validation -> resolved templates.
     * @controlflow Gate on host -> invoke command -> accept a valid template array or throw on unexpected shape.
     */
    async listTemplates(root: string): Promise<readonly VaultTemplate[]> {
      requireHost();
      const value = await call<unknown>('vault_list_templates', { root });
      // Check the payload is a list of templates, each with a string name and path.
      if (isTemplateList(value)) {
        // Branch: Payload is a valid array of template entries; return it to the caller.
        return value;
      } else {
        // Branch: Payload has an unexpected shape; throw so the host contract mismatch is visible rather than swallowed.
        throw new Error('vault_list_templates returned an unexpected result');
      }
    },
  };
}
