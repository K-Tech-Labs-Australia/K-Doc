/**
 * @file file-drop.ts
 * @purpose Webview-side file drop integration for K-Doc (FR-7.5). Handles dropping files from the OS
 *   into the editor via Tauri's native drag-drop events, classifying dropped paths into Markdown image
 *   embeds or document links with preserved drop ordering and graceful degradation in browser mode.
 * @inputs FileDropOptions containing the browser Window context, onInsert callback, and optional onError handler;
 *   native Tauri drag-drop events via getCurrentWebview().onDragDropEvent.
 * @outputs DroppedInsert descriptors, FileDrop lifecycle controller (available status and destroy method),
 *   IMAGE_EXTENSIONS and MARKDOWN_EXTENSIONS sets, classifyDroppedPath classifier, and installFileDrop installer.
 * @functions
 *   - isTauri: Determines desktop runtime availability by detecting the Tauri global without throwing exceptions.
 *   - classifyDroppedPath: Pure classifier parsing a file path to derive base name label and kind ('image' vs 'link').
 *   - installFileDrop: Subscribes to native Tauri drag-drop events, dispatching dropped file inserts in drop order.
 * @dataflow OS drag-drop event -> Tauri Webview IPC ('drop' event with absolute paths) -> filter for 'drop' type ->
 *   iterate paths in order -> classifyDroppedPath (determine kind and label) -> options.onInsert callback.
 * @controlflow Runtime capability probe via isTauri(win) -> if unavailable return inert controller -> if available
 *   subscribe to getCurrentWebview().onDragDropEvent -> on 'drop' payload iterate paths -> call onInsert -> on destroy
 *   unlisten immediately or when in-flight subscription promise resolves.
 * @version 1
 * @date 2026-09-06
 */

import { getCurrentWebview, type DragDropEvent } from '@tauri-apps/api/webview';
import type { UnlistenFn } from '@tauri-apps/api/event';

export interface DroppedInsert {
  readonly kind: 'image' | 'link';
  readonly path: string;
  readonly label: string;
}

export interface FileDropOptions {
  readonly win: Window;
  /** Called for each dropped path, in drop order. */
  readonly onInsert: (insert: DroppedInsert) => void;
  readonly onError?: (error: Error) => void;
}

export interface FileDrop {
  readonly available: boolean;
  destroy(): void;
}

/**
 * Recognized image file extensions that should be inserted as image embeds.
 */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'avif',
  'bmp',
]);

/**
 * Recognized Markdown file extensions. Dropped Markdown files are inserted as links
 * by default per FR-7.5.
 */
export const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set([
  'md',
  'markdown',
  'mdx',
]);

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
 * Classifies a dropped file path into a DroppedInsert descriptor.
 *
 * NOTE ON LINK FALLBACK:
 * Everything unrecognised becomes a link rather than being refused: a dropped .pdf or .csv
 * is something the author plainly wants to reference, and a link is always expressible in Markdown
 * while an embed is not. Markdown documents (.md, .markdown, .mdx) also become links by default.
 *
 * @purpose Pure classifier deriving insert kind ('image' vs 'link') and base name label without extension.
 * @inputs path - The absolute or relative file path string dropped into the editor.
 * @outputs DroppedInsert - Object containing kind ('image' | 'link'), path, and derived label.
 * @dataflow path -> extract base name with separators / and \ -> strip extension -> lookup in IMAGE_EXTENSIONS -> DroppedInsert.
 * @controlflow Find last / or \ -> extract filename -> find last . -> derive label and lowercased extension -> check IMAGE_EXTENSIONS -> return DroppedInsert.
 */
export function classifyDroppedPath(path: string): DroppedInsert {
  // Both / and \ are treated as separators so a Windows path works across platforms.
  const lastSlash = path.lastIndexOf('/');
  const lastBackslash = path.lastIndexOf('\\');
  const separatorIndex = Math.max(lastSlash, lastBackslash);

  // Extract file name with extension from the path.
  let fileName: string;
  if (separatorIndex >= 0) {
    // Branch: Path contains directory separator; slice following characters.
    fileName = path.slice(separatorIndex + 1);
  } else {
    // Branch: No directory separator present; whole path is the file name.
    fileName = path;
  }

  // Find the final '.' separating base name from file extension.
  const dotIndex = fileName.lastIndexOf('.');
  let label: string;
  let extension: string;

  if (dotIndex > 0) {
    // Branch: Dot occurs after at least one character of base name (e.g. 'photo.png', 'archive.tar.gz').
    label = fileName.slice(0, dotIndex);
    extension = fileName.slice(dotIndex + 1).toLowerCase();
  } else if (dotIndex === 0) {
    // Branch: Leading dot with no preceding base name (e.g. '.gitignore', '.env').
    // Treat the entire file name as the label and empty extension.
    label = fileName;
    extension = '';
  } else {
    // Branch: No dot present in file name (e.g. 'LICENSE', 'Makefile').
    label = fileName;
    extension = '';
  }

  // Check if extension matches a recognized image file type.
  // Everything unrecognised becomes a link rather than being refused: a dropped .pdf or .csv is
  // something the author plainly wants to reference, and a link is always expressible in Markdown
  // while an embed is not.
  if (IMAGE_EXTENSIONS.has(extension)) {
    // Branch: File has recognized image extension; classify as image embed.
    return {
      kind: 'image',
      path,
      label,
    };
  } else {
    // Branch: Extension is not an image (including markdown documents, pdfs, data files); classify as link.
    return {
      kind: 'link',
      path,
      label,
    };
  }
}

/**
 * Installs the webview OS file drop listener into the current window context (FR-7.5).
 *
 * NOTE ON TAURI VS DOM EVENTS:
 * We use the Tauri event rather than the DOM drop event because a File from a DOM drop
 * has a name but no path, so a Markdown link or image reference built from it would point
 * at nothing. Tauri's event carries absolute paths, which is the only form that can be
 * written into a document.
 *
 * @purpose Subscribes to native Tauri drag-drop events, dispatching dropped file inserts in drop order.
 * @inputs options - FileDropOptions containing win, onInsert callback, and optional onError handler.
 * @outputs FileDrop - Controller interface exposing available status and destroy method.
 * @dataflow Tauri onDragDropEvent -> filter for 'drop' -> extract paths in order -> classifyDroppedPath -> options.onInsert.
 * @controlflow Runtime capability probe via isTauri(win) -> if unavailable return inert controller -> if available subscribe -> on drop dispatch inserts -> destroy unlistens.
 */
export function installFileDrop(options: FileDropOptions): FileDrop {
  const available = isTauri(options.win);
  let destroyed: boolean = false;
  let unlistenFn: UnlistenFn | null = null;
  let unlistenPromise: Promise<UnlistenFn> | null = null;

  /**
   * Forwards an unexpected error to the optional onError callback.
   *
   * @purpose Dispatches caught errors or rejection reasons to options.onError without throwing.
   * @inputs err - The caught error value of unknown type.
   * @outputs void.
   * @dataflow err -> normalize to Error instance -> options.onError(error).
   * @controlflow Check if options.onError is defined -> check if err instanceof Error -> call options.onError.
   */
  function reportError(err: unknown): void {
    // Check if caller supplied an onError callback.
    if (options.onError !== undefined) {
      // Check if the caught error is an instance of Error.
      if (err instanceof Error) {
        // Branch: Caught error is already an Error instance; forward directly.
        options.onError(err);
      } else {
        // Branch: Caught error is a string or unknown value; wrap in Error instance.
        options.onError(new Error(String(err)));
      }
    } else {
      // Branch: No onError callback provided; suppress error to prevent crash.
    }
  }

  /**
   * Handles incoming Tauri drag-drop events.
   *
   * NOTE ON TAURI VS DOM EVENTS:
   * We use the Tauri event rather than the DOM drop event because a File from a DOM drop
   * has a name but no path, so a Markdown link or image reference built from it would point
   * at nothing. Tauri's event carries absolute paths, which is the only form that can be
   * written into a document.
   *
   * @purpose Filters for 'drop' events, classifies dropped file paths, and calls onInsert in order.
   * @inputs event - The Tauri event containing the DragDropEvent payload.
   * @outputs void.
   * @dataflow event.payload -> filter for type === 'drop' -> iterate paths -> classifyDroppedPath -> options.onInsert.
   * @controlflow Guard destroyed -> verify payload is 'drop' -> iterate paths in order -> call onInsert for each path.
   */
  function handleDragDropEvent(event: { readonly payload: DragDropEvent } | DragDropEvent): void {
    // Guard against invocations after controller destruction.
    if (destroyed) {
      // Branch: Controller has been destroyed; ignore incoming event.
      return;
    } else {
      // Branch: Controller is active; process drag-drop event.
    }

    // Extract DragDropEvent payload whether wrapped in Event object or passed directly.
    let payload: DragDropEvent;
    if ('payload' in event) {
      // Branch: Event follows Tauri Event<DragDropEvent> structure.
      payload = event.payload;
    } else {
      // Branch: Event passed as raw DragDropEvent directly.
      payload = event;
    }

    // Ignore every case ('enter', 'over', 'leave') except 'drop'.
    if (payload.type !== 'drop') {
      // Branch: Drag-drop event is not a file drop (e.g. enter, over, or leave); ignore.
      return;
    } else {
      // Branch: Event is a 'drop'; process dropped paths.
    }

    // Iterate over each dropped path in order and call onInsert.
    // The order is the user's: dropping three images and getting them back shuffled
    // would be its own bug.
    for (let i = 0; i < payload.paths.length; i++) {
      const path = payload.paths[i];
      // Check if path is defined under strict index access (noUncheckedIndexedAccess).
      if (path !== undefined) {
        // Branch: Valid path string at current index; classify and dispatch insert.
        const insert = classifyDroppedPath(path);
        options.onInsert(insert);
      } else {
        // Branch: Undefined path entry under strict indexing; skip.
      }
    }
  }

  /**
   * Tears down the file-drop controller and cleans up native event listeners.
   *
   * @purpose Cleans up Tauri drag-drop subscriptions and ensures idempotence.
   * @inputs void.
   * @outputs void.
   * @dataflow Mark destroyed -> unlisten active or pending subscription.
   * @controlflow Check destroyed guard -> set destroyed = true -> if unlistenFn resolved call it -> if unlistenPromise pending unlisten upon resolution.
   */
  function destroy(): void {
    // Guard against multiple destroy calls for idempotence.
    if (destroyed) {
      // Branch: Controller is already destroyed; return immediately.
      return;
    } else {
      // Branch: Controller is active; mark destroyed and proceed with teardown.
      destroyed = true;
    }

    // Clean up the Tauri drag-drop event subscription.
    if (unlistenFn !== null) {
      // Branch: Unlisten function has already resolved; call it immediately.
      unlistenFn();
      unlistenFn = null;
    } else {
      // Branch: Unlisten function has not resolved yet or running outside Tauri.
      // If unlistenPromise is in flight, its resolution handler checks the destroyed
      // flag and immediately invokes the unlisten function upon resolution.
    }
  }

  // Check if running inside Tauri desktop environment.
  if (available) {
    // Subscribe to Tauri native drag-drop events.
    // Any rejection from the subscription goes to onError and leaves the controller
    // inert rather than throwing — a drop handler that fails to attach must not stop
    // the editor from opening.
    try {
      const webview = getCurrentWebview();
      unlistenPromise = webview.onDragDropEvent(handleDragDropEvent);

      unlistenPromise.then(
        (unlisten: UnlistenFn): void => {
          // If destroy() ran while that promise was still in flight, call the unlisten
          // immediately rather than storing it. A listener registered after teardown
          // would outlive the shell that owns it.
          if (destroyed) {
            // Branch: Controller was destroyed while subscription was in flight; unlisten immediately.
            unlisten();
          } else {
            // Branch: Controller remains active; store unlisten function.
            unlistenFn = unlisten;
          }
        },
        (err: unknown): void => {
          // Any rejection from the subscription goes to onError and leaves the controller
          // inert rather than throwing — a drop handler that fails to attach must not stop
          // the editor from opening.
          reportError(err);
        },
      );
    } catch (err: unknown) {
      // Handle any synchronous error during webview acquisition or event binding.
      reportError(err);
    }
  } else {
    // The browser dev harness has no OS drop to receive, and this keeps the shell
    // from having to know which host it is running in.
  }

  return {
    available,
    destroy,
  };
}
