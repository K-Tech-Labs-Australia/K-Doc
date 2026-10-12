/**
 * @file menu-bar.ts
 * @purpose Webview-side native menu bar adapter and command specification builder for K-Doc (FR-14.8).
 *   Transforms registered editor and shell commands into serialized native menu specifications,
 *   coordinates native application menu updates via Tauri IPC, and routes incoming native menu events
 *   to active commands.
 * @inputs MenuBarOptions containing Window context, commands getter function, and onError callback; Tauri IPC menu click events ('kdoc://menu').
 * @outputs MenuBar controller interface exposing available status, refresh, and destroy lifecycle methods; MenuItemSpec and MenuSubmenuSpec schemas; toAccelerator translator; buildMenuSpec builder.
 * @functions
 *   - toAccelerator: Translates human-readable command shortcut strings into platform-agnostic Tauri accelerator strings.
 *   - buildMenuSpec: Transforms a list of registered commands into an ordered hierarchy of native submenu and item specifications.
 *   - installMenuBar: Instantiates and activates the native menu bar controller, wires IPC listeners, and returns the MenuBar controller.
 * @dataflow Command definitions -> buildMenuSpec -> Tauri IPC invoke ('set_app_menu') -> native menu click -> Tauri IPC event ('kdoc://menu') -> options.commands() lookup -> command.run().
 * @controlflow Runtime capability probe via isTauri(win) -> if available listen for 'kdoc://menu' -> refresh() builds spec and invokes set_app_menu -> on menu event lookup command in freshly read command list -> run command -> destroy unlistens IPC event.
 * @version 1
 * @date 2026-09-05
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { KdocCommand, CommandCategory } from './command-registry.js';

export interface MenuItemSpec {
  readonly id: string;
  readonly label: string;
  readonly accelerator: string;
  readonly separator: boolean;
  readonly enabled: boolean;
}

export interface MenuSubmenuSpec {
  readonly label: string;
  readonly items: readonly MenuItemSpec[];
}

export interface MenuBarOptions {
  readonly win: Window;
  readonly commands: () => readonly KdocCommand[];
  readonly onError: (message: string) => void;
}

export interface MenuBar {
  readonly available: boolean;
  /** Rebuild and install the menu from the current commands. */
  refresh(): void;
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
 * Translates the registry's human shortcut strings into Tauri accelerators.
 *
 * @purpose Converts human-readable shortcut combinations into platform-agnostic Tauri accelerator specifications.
 * @inputs shortcut - Human-readable shortcut string from the command registry (e.g. 'Ctrl+O', 'Alt+Up').
 * @outputs string - Tauri-compatible accelerator string (e.g. 'CmdOrCtrl+O', 'Alt+Up').
 * @dataflow shortcut string -> split on '+' -> map tokens (Ctrl -> CmdOrCtrl, single chars uppercased) -> join with '+'.
 * @controlflow Return empty string if shortcut is empty -> split on '+' -> iterate tokens -> map modifiers and uppercase single characters -> join with '+' -> return accelerator.
 */
export function toAccelerator(shortcut: string): string {
  // Check whether the input shortcut string is empty.
  if (shortcut === '') {
    // Branch: Empty shortcut string; returns empty string unchanged.
    return '';
  } else {
    // Branch: Non-empty shortcut string; proceed to split and map tokens.
  }

  // Split on '+' to parse individual modifier keys and primary key tokens.
  const parts = shortcut.split('+');
  const mappedParts: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    // Check if part is defined to satisfy strict noUncheckedIndexedAccess.
    if (part === undefined) {
      // Branch: Part is undefined; skip iteration.
      continue;
    } else {
      // Branch: Part is defined; map token.
    }

    // Check if token matches standard modifier keys or requires custom mapping.
    if (part === 'Ctrl') {
      // CmdOrCtrl rather than Ctrl is what makes the same accelerator correct on macOS.
      // K-Doc ships Windows-only today but the translation costs nothing and removes a future trap.
      mappedParts.push('CmdOrCtrl');
    } else if (part === 'Alt') {
      // Pass Alt modifier through unchanged.
      mappedParts.push('Alt');
    } else if (part === 'Shift') {
      // Pass Shift modifier through unchanged.
      mappedParts.push('Shift');
    } else if (part.length === 1) {
      // Single character keys are uppercased (e.g. 's' -> 'S').
      mappedParts.push(part.toUpperCase());
    } else {
      // Named keys the registry uses — Up, Down, Left, Right, Space, Enter — pass through as-is.
      // A shortcut Tauri cannot parse causes the whole menu build to fail in Rust,
      // which is why this function is total rather than throwing: an unrecognised part is passed through
      // and the Rust error names the item.
      mappedParts.push(part);
    }
  }

  return mappedParts.join('+');
}

/**
 * Ordered list of command categories dictating native menu bar submenu arrangement.
 *
 * Using the registry's own categories rather than a second hand-written grouping is the whole point —
 * the menu mirrors every command by construction, so FR-14.8 cannot rot.
 */
const CATEGORY_ORDER: readonly CommandCategory[] = [
  'File',
  'Edit',
  'Format',
  'Insert',
  'Table',
  'View',
  'Find',
];

/**
 * Transforms a list of registered commands into an ordered hierarchy of native submenu and item specifications.
 *
 * @purpose Groups commands by category into native submenu specifications, inserting separators between differing ID prefixes.
 * @inputs commands - The array of registered application and editor commands.
 * @outputs readonly MenuSubmenuSpec[] - The structured submenu specifications ready for native rendering.
 * @dataflow commands array -> group by CATEGORY_ORDER -> filter empty categories -> prefix-based separator insertion -> MenuSubmenuSpec array.
 * @controlflow Iterate CATEGORY_ORDER -> collect matching commands -> if empty skip category -> map submenu label ('Find' -> 'Search') -> iterate category commands inserting separators on ID prefix changes -> assemble MenuSubmenuSpec -> return array.
 */
export function buildMenuSpec(commands: readonly KdocCommand[]): readonly MenuSubmenuSpec[] {
  const submenus: MenuSubmenuSpec[] = [];

  for (let c = 0; c < CATEGORY_ORDER.length; c++) {
    const category = CATEGORY_ORDER[c];
    // Check if category is defined to satisfy strict noUncheckedIndexedAccess.
    if (category === undefined) {
      // Branch: Category is undefined; skip iteration.
      continue;
    } else {
      // Branch: Category is defined; collect matching commands.
    }

    const categoryCommands: KdocCommand[] = [];
    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      // Check if command is defined to satisfy strict noUncheckedIndexedAccess.
      if (command === undefined) {
        // Branch: Command is undefined; skip iteration.
        continue;
      } else {
        // Branch: Command is defined; check category membership.
      }

      // Check whether the command belongs to the current category.
      if (command.category === category) {
        // Branch: Command belongs to category; preserve registry order.
        categoryCommands.push(command);
      } else {
        // Branch: Command belongs to different category; ignore.
      }
    }

    // A category with no commands produces no submenu.
    // This follows the same rule the ribbon and settings dialog already use.
    if (categoryCommands.length === 0) {
      // Branch: No commands in this category; omit submenu.
      continue;
    } else {
      // Branch: Category has commands; construct submenu items.
    }

    // Each submenu's label is the category name, except Find which is labelled Search.
    // "Find" names one command and reads oddly as a menu title.
    let label: string;
    if (category === 'Find') {
      // Branch: Use 'Search' as the display label for the Find category.
      label = 'Search';
    } else {
      // Branch: Use category name directly as the display label.
      label = category;
    }

    const items: MenuItemSpec[] = [];
    let previousPrefix: string | null = null;

    for (let k = 0; k < categoryCommands.length; k++) {
      const command = categoryCommands[k];
      // Check if command is defined to satisfy strict noUncheckedIndexedAccess.
      if (command === undefined) {
        // Branch: Command is undefined; skip iteration.
        continue;
      } else {
        // Branch: Command is defined; process item.
      }

      // Extract the portion of the id before ':' to detect logical group boundaries.
      const colonIndex = command.id.indexOf(':');
      let prefix: string;
      if (colonIndex !== -1) {
        // Branch: Colon delimiter present; extract preceding namespace.
        prefix = command.id.slice(0, colonIndex);
      } else {
        // Branch: No colon delimiter; use full command id as namespace.
        prefix = command.id;
      }

      // Insert a separator between runs of commands whose id prefix differs within a submenu —
      // e.g. in View, between view:* and find:*.
      // Keep it simple: walk the items, and when the portion of the id before : changes from
      // the previous item, push a separator first.
      // This groups related entries without needing a second layout table to maintain.
      if (previousPrefix !== null && prefix !== previousPrefix) {
        // Branch: ID prefix changed from previous item; insert a visual separator.
        items.push({
          id: `separator-${items.length}`,
          label: '',
          accelerator: '',
          separator: true,
          enabled: false,
        });
      } else {
        // Branch: First item or ID prefix unchanged; no separator needed.
      }

      previousPrefix = prefix;

      // Within a submenu, items keep registry order.
      // Each item: id is the command id, label the command label, accelerator is toAccelerator(command.shortcut),
      // separator false, enabled from command.isEnabled().
      items.push({
        id: command.id,
        label: command.label,
        accelerator: toAccelerator(command.shortcut),
        separator: false,
        enabled: command.isEnabled(),
      });
    }

    submenus.push({
      label,
      items,
    });
  }

  return submenus;
}

/**
 * Instantiates and activates the native menu bar controller for desktop environments (FR-14.8).
 *
 * @purpose Manages native menu bar lifecycle, builds menu specifications, coordinates Tauri IPC updates, and routes menu events.
 * @inputs options - Configuration containing Window context, commands supplier, and error handler callback.
 * @outputs MenuBar - Controller interface exposing available status, refresh, and destroy lifecycle methods.
 * @dataflow options -> isTauri probe -> listen for 'kdoc://menu' -> refresh invokes 'set_app_menu' -> menu event invokes command.run().
 * @controlflow Probe Tauri runtime availability -> if available register 'kdoc://menu' IPC listener -> define refresh and destroy -> return MenuBar controller.
 */
export function installMenuBar(options: MenuBarOptions): MenuBar {
  const available = isTauri(options.win);
  let destroyed: boolean = false;
  let unlistenFn: UnlistenFn | null = null;
  let unlistenPromise: Promise<UnlistenFn> | null = null;

  /**
   * Rebuilds and installs the native menu bar from the current commands collection.
   *
   * @purpose Constructs a fresh menu specification snapshot and updates the native desktop menu bar via Tauri IPC.
   * @inputs void.
   * @outputs void.
   * @dataflow options.commands() -> buildMenuSpec -> invoke('set_app_menu', { spec }) -> error catch -> options.onError.
   * @controlflow Check available guard -> check destroyed guard -> generate menu spec -> invoke set_app_menu -> catch errors to onError.
   */
  function refresh(): void {
    // Guard against running outside desktop environment.
    // A browser build has no native menu bar to install, which is absence rather than failure.
    if (!available) {
      // Branch: Desktop capabilities absent; refresh is a no-op.
      return;
    } else {
      // Branch: Desktop host present; proceed with menu bar refresh.
    }

    // Guard against invocations after controller destruction.
    if (destroyed) {
      // Branch: Controller has been destroyed; ignore refresh invocation.
      return;
    } else {
      // Branch: Controller is active; proceed with building menu spec.
    }

    // Build the spec from options.commands() and invoke set_app_menu with { spec },
    // routing rejections to onError.
    const spec = buildMenuSpec(options.commands());

    invoke('set_app_menu', { spec }).catch((err: unknown): void => {
      // Check if the caught error is an instance of Error.
      if (err instanceof Error) {
        // Branch: Forward Error message to caller onError handler.
        options.onError(err.message);
      } else {
        // Branch: Convert non-Error value to string and forward to error handler.
        options.onError(String(err));
      }
    });
  }

  /**
   * Cleans up all resources held by the menu bar controller, unlistening native menu click events.
   *
   * @purpose Idempotently tears down the native menu bar controller lifecycle.
   * @inputs void.
   * @outputs void.
   * @dataflow unlistenFn() / unlistenPromise teardown.
   * @controlflow Check destroyed guard -> mark destroyed = true -> if unlistenFn resolved call it -> else if unlistenPromise pending attach teardown.
   */
  function destroy(): void {
    // Check if the controller has already been destroyed.
    if (destroyed) {
      // Branch: Already destroyed; return immediately for idempotent teardown.
      return;
    } else {
      // Branch: Active controller; mark destroyed and proceed with resource cleanup.
      destroyed = true;
    }

    // Check whether the Tauri unlisten function is already resolved or pending.
    // A leaked listener would keep running commands after the shell is gone.
    if (unlistenFn !== null) {
      // Branch: Unlisten function is already resolved; call it immediately.
      unlistenFn();
      unlistenFn = null;
    } else if (unlistenPromise !== null) {
      // Branch: Listen promise is still in-flight; attach unlisten call on resolution.
      unlistenPromise
        .then((unlisten: UnlistenFn): void => {
          unlisten();
        })
        .catch((err: unknown): void => {
          // Check if the caught error is an instance of Error.
          if (err instanceof Error) {
            // Branch: Forward Error message to caller onError handler.
            options.onError(err.message);
          } else {
            // Branch: Convert non-Error value to string and forward to error handler.
            options.onError(String(err));
          }
        });
    } else {
      // Branch: No event listener registered (e.g. unavailable in browser mode).
    }
  }

  /**
   * Handles incoming Tauri menu click events emitted by the native menu bar.
   *
   * @purpose Validates incoming event payload shape, resolves the clicked command ID against current commands, and runs the command.
   * @inputs event - The Tauri event wrapper containing untrusted payload data from IPC.
   * @outputs void.
   * @dataflow event.payload -> string validation -> options.commands() lookup -> command.run().
   * @controlflow Check destroyed guard -> validate payload is string -> query fresh commands -> find command by ID -> if found run command.
   */
  function handleMenuEvent(event: { readonly payload: unknown }): void {
    // Check if the controller has been destroyed.
    if (destroyed) {
      // Branch: Controller is destroyed; ignore incoming event.
      return;
    } else {
      // Branch: Controller is active; inspect payload.
    }

    // Validate the event payload is a string before using it, since it crosses the IPC boundary.
    if (typeof event.payload !== 'string') {
      // Branch: Invalid payload structure; payload is not a string.
      return;
    } else {
      // Branch: Valid string payload containing the clicked command id.
    }

    const commandId: string = event.payload;

    // Register the kdoc://menu listener once in installMenuBar, and on an event find the command
    // with that id in a freshly read options.commands() and run() it.
    // Re-reading matters because the menu item was built from a snapshot and the command
    // must act on the state as it is now.
    const currentCommands = options.commands();
    let targetCommand: KdocCommand | undefined;

    for (let i = 0; i < currentCommands.length; i++) {
      const command = currentCommands[i];
      // Check if command is defined to satisfy strict noUncheckedIndexedAccess.
      if (command === undefined) {
        // Branch: Command element is undefined; skip iteration.
        continue;
      } else {
        // Branch: Command element is defined; compare id.
      }

      // Check whether current command matches target command id.
      if (command.id === commandId) {
        // Branch: Command found; assign and exit search loop.
        targetCommand = command;
        break;
      } else {
        // Branch: Command id does not match; continue search.
      }
    }

    // Check whether the command id resolved to a registered command.
    // Ignore an id that no longer resolves rather than throwing.
    if (targetCommand !== undefined) {
      // Branch: Command found; execute it.
      targetCommand.run();
    } else {
      // Branch: Command id no longer resolves in current command list; ignore.
    }
  }

  // Check whether running inside Tauri desktop host.
  if (available) {
    // Register the kdoc://menu listener once in installMenuBar.
    unlistenPromise = listen<unknown>('kdoc://menu', handleMenuEvent);

    unlistenPromise.then(
      (unlisten: UnlistenFn): void => {
        // Check if the controller was destroyed while the listen promise was resolving.
        if (destroyed) {
          // Branch: Controller destroyed during resolution; unlisten immediately.
          // A leaked listener would keep running commands after the shell is gone.
          unlisten();
        } else {
          // Branch: Controller active; store resolved unlisten function.
          unlistenFn = unlisten;
        }
      },
      (err: unknown): void => {
        // Check if the caught error is an instance of Error.
        if (err instanceof Error) {
          // Branch: Forward Error message to caller onError handler.
          options.onError(err.message);
        } else {
          // Branch: Convert non-Error value to string and forward to error handler.
          options.onError(String(err));
        }
      },
    );
  } else {
    // Branch: Running outside Tauri; every method then no-ops and no listener is registered.
    // A browser build has no native menu bar to install, which is absence rather than failure.
  }

  return {
    available,
    refresh,
    destroy,
  };
}
