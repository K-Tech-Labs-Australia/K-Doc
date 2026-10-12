/**
 * @file plugins-panel.ts
 * @purpose Renders K-Doc's reader sidebar panel (FR-14.18) listing what each loaded plugin added and saying why any that would not load failed to start.
 * @inputs options.doc - Owning Document used to create DOM nodes; options.plugins() - Factory returning every loaded plugin; options.problems() - Every problem recorded while loading them; options.showPanel(pluginId, id) - Runs one panel registration and answers with what it should show; options.reload() - Restarts all plugins from the folder; options.openFolder() - Opens the plugins folder.
 * @outputs PluginsPanel - Handle exposing the panel element plus refresh()/destroy() lifecycle methods.
 * @functions
 *   - clear: Removes every child node currently held by a DOM node.
 *   - installPluginsPanel: Builds, wires, and mounts the plugins panel; returns its handle.
 * @dataflow options.problems() -> <p> problem rows; options.plugins() -> per-plugin blocks with name/about/added list; 'panel' registrations get a Show button whose click runs options.showPanel into an empty <pre>.
 * @controlflow Guard refresh on destroyed flag, clear element, build actions then problems, short-circuit when no plugins loaded, walk each plugin's registrations building rows and panel buttons; call refresh() once before returning the handle.
 * @version 3
 * @date 2026-10-04
 */

import type { LoadedPlugin } from '../plugins/plugin-host.js';

/** Configuration and callbacks accepted by installPluginsPanel. */
export interface PluginsPanelOptions {
  readonly doc: Document;
  /** Every plugin that loaded. */
  readonly plugins: () => readonly LoadedPlugin[];
  /** Everything that went wrong loading them. */
  readonly problems: () => readonly string[];
  /** Runs one plugin's panel and answers with what it should show. */
  readonly showPanel: (pluginId: string, id: string) => Promise<string>;
  /** Reads the plugins folder and starts them all again. */
  readonly reload: () => void;
  /** Opens the folder plugins live in. */
  readonly openFolder: () => void;
}

/** Public handle returned by installPluginsPanel. */
export interface PluginsPanel {
  readonly element: HTMLElement;
  refresh(): void;
  destroy(): void;
}

/** Styles for the Plugins panel. Consumed by the host stylesheet loader, not injected here.
 * @purpose Centralizes the panel's visual rules under a single exported constant using only design tokens. */
export const PLUGINS_PANEL_STYLES: string = `
.kdoc-plugins-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 8px;
  overflow-y: auto;
  height: 100%;
  box-sizing: border-box;
  background: var(--kdoc-chrome-base);
  color: var(--kdoc-chrome-text);
  border-radius: var(--kdoc-radius-lg);
  box-shadow: none;
  scrollbar-width: thin;
  scrollbar-color: var(--kdoc-chrome-raised) var(--kdoc-chrome-base);
}

.kdoc-plugins-panel::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.kdoc-plugins-panel::-webkit-scrollbar-track {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: none;
}

.kdoc-plugins-panel::-webkit-scrollbar-thumb {
  background: var(--kdoc-chrome-raised);
  border-radius: var(--kdoc-radius-pill);
  box-shadow: var(--kdoc-elevation-raised);
}

.kdoc-plugins-panel[hidden] {
  display: none !important;
}

.kdoc-plugins-panel-empty {
  color: var(--kdoc-chrome-text-muted);
  font-size: 13px;
  font-style: italic;
  padding: 8px 12px;
  border-radius: var(--kdoc-radius-md);
}

.kdoc-plugins-panel-problem {
  color: var(--kdoc-emissive-red);
  font-size: 12px;
  margin: 0;
  padding: 4px 8px;
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-plugins-panel-plugin {
  background: var(--kdoc-chrome-base);
  border-radius: var(--kdoc-radius-lg);
  box-shadow: var(--kdoc-elevation-raised);
  padding: 12px 14px;
  margin-bottom: 8px;
  box-sizing: border-box;
}

.kdoc-plugins-panel-name {
  font-weight: 600;
  color: var(--kdoc-chrome-text);
  font-size: 13px;
  border-radius: var(--kdoc-radius-sm);
}

.kdoc-plugins-panel-about {
  color: var(--kdoc-chrome-text-muted);
  font-size: 12px;
  margin-top: 2px;
}

.kdoc-plugins-panel-added {
  margin: 6px 0 0 0;
  padding-left: 16px;
  color: var(--kdoc-chrome-text-muted);
  font-size: 12px;
}

.kdoc-plugins-panel-output {
  white-space: pre-wrap;
  margin-top: 8px;
  font-family: monospace;
  font-size: 12px;
  background: var(--kdoc-chrome-base);
  box-shadow: none;
  border-radius: var(--kdoc-radius-md);
  padding: 8px 10px;
  color: var(--kdoc-chrome-text);
  border: 1px solid var(--kdoc-chrome-shadow-dark);
}

.kdoc-plugins-panel-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
}

.kdoc-plugins-panel button,
.kdoc-plugins-panel .kdoc-dialog-button {
  border-radius: var(--kdoc-radius-pill);
  background: transparent;
  box-shadow: none;
  border: 1px solid var(--kdoc-chrome-edge);
  color: var(--kdoc-chrome-text);
  font: inherit;
  font-size: 12px;
  padding: 4px 10px;
  cursor: pointer;
  transition: background 0.15s ease, box-shadow 0.15s ease, color 0.15s ease, text-shadow 0.15s ease;
}

.kdoc-plugins-panel button:hover,
.kdoc-plugins-panel .kdoc-dialog-button:hover {
  background: color-mix(in srgb, var(--kdoc-chrome-text) 8%, transparent);
}

.kdoc-plugins-panel button:active,
.kdoc-plugins-panel .kdoc-dialog-button:active {
  box-shadow: none;
  background: color-mix(in srgb, var(--kdoc-chrome-text) 12%, transparent);
}

.kdoc-plugins-panel button:focus-visible,
.kdoc-plugins-panel .kdoc-dialog-button:focus-visible {
  outline: 3px solid var(--kdoc-chrome-accent);
  outline-offset: 2px;
  border-radius: var(--kdoc-radius-md);
}

@media (prefers-reduced-motion: reduce) {
  .kdoc-plugins-panel * {
    transition: none !important;
  }
}
`;


/**
 * installPluginsPanel builds the Plugins panel (FR-14.18) and mounts it into a returned handle.
 * @purpose Constructs the sidebar surface that shows what each loaded plugin added and why any broken one failed to start, wiring reload/open-folder actions and per-panel Show buttons.
 * @inputs options.doc - The owning Document used to create all DOM nodes.
 *   options.plugins - Factory returning every currently loaded plugin for rendering.
 *   options.problems - Factory returning the list of load problems to surface above the plugins.
 *   options.showPanel - Callback that runs one panel registration and answers with what it should show.
 *   options.reload - Callback invoked by the Reload button to restart all plugins from their folder.
 *   options.openFolder - Callback invoked by the Open Folder button to open the plugins folder in the OS.
 * @outputs PluginsPanel - Object exposing the panel element plus refresh() and destroy() lifecycle methods.
 * @dataflow options.problems() -> <p> problem rows; options.plugins() -> per-plugin blocks (name, about, added list) with a Show button + empty <pre> for each 'panel' registration whose click runs options.showPanel into that <pre>.
 * @controlflow Guard refresh on the destroyed flag, clear element, build actions then problems, short-circuit when no plugins loaded, walk each plugin's registrations building rows and panel buttons; call refresh() once before returning the handle.
 */
export function installPluginsPanel(options: PluginsPanelOptions): PluginsPanel {
  const doc = options.doc;

  // Tracks whether teardown has run so later calls can become cheap no-ops.
  let destroyed = false;

  const element = doc.createElement('div');
  element.className = 'kdoc-plugins-panel';

  // clear removes every child node currently held by a DOM node, used to rebuild the panel from scratch each refresh().
  // @purpose Empties a container so its contents can be rebuilt without leaking old listeners or nodes.
  // @inputs node - The element whose children should all be removed.
  // @outputs void - Mutates the given node, leaving it childless.
  // @dataflow (none) - Pure mutation of the passed-in node's child list.
  // @controlflow Loops while a first child exists, removing that child each pass; stops once empty.
  function clear(node: Element): void {
    // Remove one child per iteration until none are left behind in this container.
    while (node.firstChild !== null) {
      node.removeChild(node.firstChild);
    }
  }

  // refresh rebuilds the panel from a fresh snapshot of options, guarded so it never mutates DOM after destroy().
  // @purpose Re-renders reload/open-folder actions, any load problems, and one block per loaded plugin.
  // @inputs (none) - Reads options.problems() and options.plugins() for the live content set.
  // @outputs void - Mutates the panel's DOM children in place.
  // @dataflow options.problems() -> <p> rows; options.plugins() -> per-plugin blocks with name/about/added list + panel Show buttons feeding an empty <pre>.
  // @controlflow Early-returns if destroyed; clears element, builds actions then problems, short-circuits when no plugins loaded, else walks each plugin's registrations building rows and panel buttons.
  function refresh(): void {
    // Guard: a destroyed panel must not mutate DOM after its listeners have been released.
    if (destroyed) {
      return;
    } else {
      // Still mounted: rebuild the contents below.
    }

    clear(element);

    const actions = doc.createElement('div');
    actions.className = 'kdoc-plugins-panel-actions';

    const reloadButton = doc.createElement('button');
    reloadButton.type = 'button';
    reloadButton.className = 'kdoc-dialog-button';
    reloadButton.textContent = 'Reload';
    // The Reload button restarts every plugin from the plugins folder.
    reloadButton.addEventListener('click', (): void => {
      options.reload();
    });

    const openFolderButton = doc.createElement('button');
    openFolderButton.type = 'button';
    openFolderButton.className = 'kdoc-dialog-button';
    openFolderButton.textContent = 'Open Folder';
    // The Open Folder button opens the folder in which plugins live, using the OS file manager.
    openFolderButton.addEventListener('click', (): void => {
      options.openFolder();
    });

    actions.append(reloadButton, openFolderButton);
    element.append(actions);

    // Each recorded load problem is surfaced as its own paragraph so a reader sees why something did not start.
    for (const problem of options.problems()) {
      const line = doc.createElement('p');
      line.className = 'kdoc-plugins-panel-problem';
      line.textContent = problem;
      element.append(line);
    }

    // A fresh snapshot of every plugin that loaded, read once so the whole render is consistent.
    const plugins = options.plugins();

    // With no loaded plugins there is nothing to list, so show guidance and stop building rows.
    if (plugins.length === 0) {
      const empty = doc.createElement('p');
      empty.className = 'kdoc-plugins-panel-empty';
      empty.textContent = 'No plugins are loaded. Put a folder with a plugin.json and a main.js in the plugins folder.';
      element.append(empty);
      return;
    } else {
      // At least one plugin loaded: build a block for each below.
    }

    // Walk every loaded plugin, building one self-contained block per registration it added.
    for (const plugin of plugins) {
      const manifest = plugin.manifest;

      const pluginDiv = doc.createElement('div');
      pluginDiv.className = 'kdoc-plugins-panel-plugin';

      const nameEl = doc.createElement('div');
      nameEl.className = 'kdoc-plugins-panel-name';
      // The human-readable display name of the plugin.
      nameEl.textContent = manifest.name;
      pluginDiv.append(nameEl);

      const about1 = doc.createElement('div');
      about1.className = 'kdoc-plugins-panel-about';
      // Identify the plugin by its id and version on one line.
      about1.textContent = `${manifest.id} ${manifest.version}`;
      pluginDiv.append(about1);

      // A non-empty description earns its own caption beneath the id/version line, so a blank or missing value is skipped rather than shown as empty text.
      if (manifest.description !== '') {
        const about2 = doc.createElement('div');
        about2.className = 'kdoc-plugins-panel-about';
        about2.textContent = manifest.description;
        pluginDiv.append(about2);
      } else {
        // No description to show: leave only the id/version caption line in place.
      }

      const addedList = doc.createElement('ul');
      addedList.className = 'kdoc-plugins-panel-added';
      pluginDiv.append(addedList);

      // Walk every registration this plugin made, building one list item and (for panels) a Show button per point type.
      for (const registration of plugin.registrations) {
        const row = doc.createElement('li');

        // Each kind of registration says what it is in its own words, so the row reads as the reader would
        // name the thing rather than as a field of a record.
        let words = '';
        switch (registration.point) {
          case 'command':
            // A command is known by the words it is run under.
            words = registration.label;
            break;
          case 'panel':
            // A panel is known by its heading.
            words = registration.title;
            break;
          case 'export':
            // An export is known by the format it writes.
            words = registration.name;
            break;
          default:
            // The remaining kind is a syntax, which is known by what it looks for.
            words = registration.pattern;
            break;
        }

        // The kind of thing comes first, then the thing's own words.
        row.textContent = `${registration.point}: ${words}`;

        addedList.append(row);

        // Only panel registrations can be shown on demand, so build a Show button for them and nothing else.
        if (registration.point === 'panel') {
          const showButton = doc.createElement('button');
          showButton.type = 'button';
          showButton.className = 'kdoc-dialog-button';
          // The button names the panel it will reveal so its purpose is obvious before clicking.
          showButton.textContent = `Show ${registration.title}`;

          const output = doc.createElement('pre');
          output.className = 'kdoc-plugins-panel-output';
          // Starts empty and only fills when a panel actually answers, or reports failure where the answer would have gone.
          showButton.addEventListener('click', (): void => {
            // Reserve the space with a working indicator so the reader sees this button was acted on before the plugin replies.
            output.textContent = 'Working...';

            options.showPanel(plugin.manifest.id, registration.id).then((text) => {
              // The panel answered: replace the working indicator with its actual content.
              output.textContent = text;
            }).catch((error: unknown) => {
              // A failed panel still says so where it would have shown its answer rather than leaving stale "Working..." text behind.
              output.textContent = error instanceof Error ? error.message : String(error);
            });
          });

          pluginDiv.append(showButton, output);
        } else {
          // Not a panel registration: there is nothing to show on demand, so no button or output block is added for it.
        }
      }

      element.append(pluginDiv);
    }
  }

  // destroy tears down the panel and detaches all listeners.
  // @purpose Marks the panel destroyed, clears its DOM, and makes later calls cheap no-ops.
  // @inputs (none)
  // @outputs void - Mutates internal state and removes children from the element.
  // @dataflow Internal destroyed flag -> refresh() early-return; clear(element) empties all rows and buttons.
  // @controlflow Early-returns if already destroyed; otherwise sets destroyed, clears children, and returns.
  function destroy(): void {
    // Guard: idempotent teardown so a second call is a no-op rather than re-clearing an empty element.
    if (destroyed) {
      return;
    } else {
      // Not yet torn down: mark it destroyed, then clear the DOM below.
    }

    destroyed = true;
    clear(element);
  }

  refresh();

  return { element, refresh, destroy };
}
