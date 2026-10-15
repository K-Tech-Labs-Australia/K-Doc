# Customising K-Doc

You can change how K-Doc looks, which keys run which commands, what the ribbon holds, and what plugins add to it. This page covers each of those in turn.

## Change the theme

K-Doc has six built-in colour themes, and each comes in a light and a dark version:

| Theme | Look |
| :--- | :--- |
| **K-Doc** | Vibrant blue with an orange accent. This is the default. |
| **Nord** | Cool arctic blues and frosty greys. |
| **Solarized** | Ethan Schoonover's low-glare palette. |
| **Paper** | Warm cream and ink. |
| **Graphite** | Neutral greys with a quiet slate accent. |
| **High Contrast** | Black, white, and bold accents for maximum legibility. |

To pick one:

1. Click the theme button in the title bar. It shows the current mode, for example **System**.
2. Under **Mode**, choose **System**, **Light**, or **Dark**.
3. Under **Theme**, choose one of the six themes.

**System** follows the light or dark setting in Windows. The same two choices are in **Settings → Appearance** as **Theme** and **Colour theme**. **View → Theme → Toggle Theme** steps the mode from System to Light to Dark and back to System.

Your choice is saved with your settings, so K-Doc starts in the same theme next time.

## Use a CSS theme of your own

You can restyle K-Doc with your own CSS file. A theme of your own is applied on top of the built-in theme you have chosen.

1. Choose **View → Theme → Open App Themes Folder**. K-Doc opens the folder in File Explorer. If the folder holds no theme yet, K-Doc writes a starter file called `custom.css` that lists every colour K-Doc paints with.
2. Edit `custom.css`, or add your own `.css` files beside it. The file name, without `.css`, is the theme's name. A name can be up to 64 characters of letters, digits, spaces, hyphens, and underscores; files with other names are ignored.
3. Choose **View → Theme → App Theme** and pick your theme from the list.

While your theme is in use, K-Doc watches the folder. Save the CSS file and the change shows straight away, with no restart. To go back to the built-in colours, choose **View → Theme → App Theme** and pick **K-Doc's own colours**.

The folder is `themes` inside K-Doc's application data folder, `%APPDATA%\au.ktechlabs.kdoc\themes`.

A theme can change how anything in K-Doc looks, including its dialogs. Only use theme files from people you trust.

Themes for HTML exports and printouts are separate. See [Export and print](export-and-print.md).

## Change the fonts and spacing

In **Settings → Appearance** you can set:

- **Editor font family**, the font for the document.
- **Monospace font family**, the font for code and the Source view.
- **Editor font size (px)**, from 8 to 72.
- **Line height**, from 1.0 to 3.0.

Type the font name exactly as Windows lists it, for example `Segoe UI`. See [Settings reference](settings-reference.md) for the defaults.

## Set the display density and reading width

**Display density** sets how much space sits between blocks such as paragraphs and headings. Choose **Compact**, **Comfortable**, or **Spacious**.

**Reading width** sets how wide the text column is. Choose **Narrow**, **Medium**, **Wide**, or **Full**.

Both are in **Settings → Appearance** and apply to every document.

### Give one document its own width or density

A document can override the settings. Use the commands under **View → Reading Width**:

| Command | What it does |
| :--- | :--- |
| **Reading Width for This Document** | Steps this document's width to the next one: Narrow, Medium, Wide, Full, then back to Narrow. |
| **Display Density for This Document** | Steps this document's density to the next one: Compact, Comfortable, Spacious, then back to Compact. |
| **Use the Settings Width and Density** | Removes this document's own width and density, so it follows the settings again. |

Each step starts from what you see now. The status bar names the new value.

K-Doc remembers a document's own width and density against its file path, so save the document first. For an unsaved document, K-Doc says **Save the document before giving it its own width or density.** K-Doc remembers these choices for up to 500 documents and forgets the oldest after that.

## Zoom

Zoom makes the document text larger or smaller without changing your font size setting.

| Action | Shortcut | Menu |
| :--- | :--- | :--- |
| Zoom in | `Ctrl+Shift+>` | **View → Zoom → Zoom In** |
| Zoom out | `Ctrl+Shift+<` or `Ctrl+-` | **View → Zoom → Zoom Out** |
| Reset to 100% | `Ctrl+0` | **View → Zoom → Reset Zoom** |

You can also hold `Ctrl` and turn the mouse wheel. Zoom moves in steps: 75%, 90%, 100%, 110%, 125%, 150%, 175%, and 200%. The status bar shows the new level after each step.

## Choose a keyboard preset

A preset is a set of shortcuts modelled on another program. K-Doc has four:

| Preset | Based on |
| :--- | :--- |
| **Word** | Microsoft Word. This is the default. |
| **VS Code** | Visual Studio Code. |
| **Typora** | Typora. |
| **Obsidian** | Obsidian. |

Every preset starts from the Word shortcuts and changes only some of them. [Keyboard shortcuts](keyboard-shortcuts.md) lists the differences.

To switch:

1. Choose **Help → Keyboard Shortcuts**.
2. Pick a preset from the **Preset** list at the top of the dialog.

The new shortcuts work straight away, and the menus and command palette show them. Shortcuts you set yourself are kept when you switch presets.

## Change a shortcut

You change shortcuts in **Help → Keyboard Shortcuts**. The dialog lists every command that can have a shortcut, with its current keys. Type in the search box to filter by command name or by key, for example `Ctrl+K`.

To add a shortcut to a command:

1. Click **Add** on the command's row. The button changes to **Press keys…**.
2. Press the keys you want. A shortcut needs `Ctrl` or `Alt` with a key, or a function key on its own, such as `F6`.
3. If another command already uses those keys, K-Doc says which one. Press `Enter` to move the keys to this command, or `Escape` to leave them where they are.

Press `Escape` while recording to cancel.

A command can have more than one shortcut. To remove one, click the **×** beside it. To return one command to its preset shortcuts, click **Reset** on its row. To return every command to the preset, click **Reset All**.

If two commands claim the same keys, the dialog warns you, and the shortcut you set yourself wins.

Each shortcut is a single key combination. K-Doc does not support sequences of two key presses.

Some keys are fixed and do not appear in the dialog. These include `Tab` and `Shift+Tab` in lists and tables, `Ctrl+Shift+V` for **Paste as Plain Text**, and `Alt+Shift+Right` and `Alt+Shift+Left` for resizing a picture. Commands that plugins add cannot have shortcuts; run them from the command palette.

## Show, hide, or collapse the ribbon

The ribbon is the row of tabs and buttons under the title bar. It has the tabs **Home**, **Insert**, **Review**, and **View**. A **Table** tab appears while the caret is in a table.

The ribbon has three states:

| State | What you see |
| :--- | :--- |
| Expanded | The tabs and their buttons. |
| Collapsed | The tabs only. |
| Hidden | No ribbon at all. |

- Press `Ctrl+F1`, or choose **Tools → Ribbon → Cycle Ribbon**, to step from expanded to collapsed to hidden and back to expanded.
- Click the arrow button in the title bar to hide an expanded ribbon, or to bring back a hidden or collapsed one in full.

K-Doc remembers the state you leave the ribbon in.

The menu bar (**File**, **Edit**, **Insert**, **Format**, **Table**, **View**, **Review**, **Tools**, and **Help**) is always shown, whatever the ribbon's state. Every command is in the menu bar, so you can hide the ribbon and still reach everything. Press `Alt` with a menu's underlined letter to open it from the keyboard, for example `Alt+F` for **File**.

## Rearrange the ribbon

You can choose which buttons appear on each ribbon tab, and in what order.

1. Choose **Tools → Ribbon → Customise Ribbon…**.
2. Click a tab name to show its groups.
3. Arrange the tab:
   - Click **Up** or **Down** beside a group to move the group.
   - Click **Up** or **Down** beside a command to move it within its group.
   - Click **Remove** to take a command off the ribbon.
   - Choose a command from **Add a command…** under a group, then click **Add**.
4. Click **Apply** to use the new arrangement, or **Cancel** to discard it.

To go back to the standard ribbon, open the dialog and click **Use K-Doc's ribbon**.

Your arrangement is saved with your settings. A command that this version of K-Doc does not have stays in the list, marked as missing, so an arrangement made in a newer version is not lost.

## Add plugins

A plugin is a small program that adds to K-Doc. A plugin can add:

- **Commands**, which appear in the command palette (`Ctrl+Shift+P`). A command gets the document's text and can either replace it or show a message in the status bar. A replacement is a single edit, so `Ctrl+Z` undoes it.
- **Panels**, which appear in the **Plugins** panel with a **Show** button that displays what the plugin returns.
- **Export formats**, which you use from **File → Export → Export with a Plugin…**. K-Doc asks where to save the result.
- **Syntax**, which styles text that matches a pattern the plugin names.

### Install a plugin

Plugins live in the `plugins` folder inside K-Doc's application data folder, `%APPDATA%\au.ktechlabs.kdoc\plugins`.

1. Open the **Plugins** panel in the right sidebar. Use **View → Panels → Toggle Right Panel** (`Ctrl+Shift+R`) if the sidebar is closed, then click the **Plugins** icon.
2. Click **Open Folder** to open the `plugins` folder.
3. Copy the plugin's folder into it. The folder must hold a `main.js` file and a `plugin.json` file. Its name must start with a letter and use only lower-case letters, digits, and hyphens, up to 64 characters.
4. Click **Reload** in the **Plugins** panel, or choose **Tools → Reload Plugins**.

K-Doc loads every plugin in the folder. There is no separate switch to turn a plugin on or off: to stop using a plugin, move its folder out of the `plugins` folder and reload.

### The Plugins panel

The **Plugins** panel lists each plugin that loaded, with its name, version, and description, and what it added. If a plugin could not load, the panel says why at the top. When no plugin is loaded, the panel says so.

### What a plugin can and cannot do

Plugins are trusted code. Only install plugins from authors you trust, as you would any other software.

K-Doc limits what a plugin can reach:

- A plugin runs on its own, apart from the K-Doc window, with network, storage, and peer-connection features removed.
- A plugin receives the document's text when you run one of its commands, panels, or exports, and nothing else.
- A plugin can only add the four kinds of thing listed above.
- A call that takes longer than 4 seconds is stopped.
- A plugin's `main.js` and `plugin.json` can each be at most 1 MB.

These limits reduce the harm a faulty plugin can do. They do not make a malicious plugin safe. For more detail, see the project's [security policy](https://github.com/K-Tech-Labs-Australia/K-Doc/security/policy).

## Turn on developer mode

**Settings → General → Developer mode (Fidelity Check on save)** is meant for people working on K-Doc itself. When it is on, K-Doc checks each save for changes to parts of the file you did not edit. If it finds any, the status bar says how many and the **Problems** panel lists them. It is off by default.

## See also

- [Settings reference](settings-reference.md)
- [Keyboard shortcuts](keyboard-shortcuts.md)
- [Export and print](export-and-print.md)
- [Getting started](getting-started.md)
- [Troubleshooting](troubleshooting.md)
