/**
 * @file link-follow-plugin.ts
 * @purpose ProseMirror plugin enabling Ctrl+Click / Cmd+Click link following in the K-Doc pane (FR-8.13).
 *   Intercepts modified clicks on rendered anchor elements and dispatches follow callbacks.
 *   Ordering contract: This plugin must be installed BEFORE the multi-caret plugin, because ProseMirror
 *   asks plugins in order and the first handleClick to return true wins; installed after, every Ctrl+Click
 *   on a link would add a caret instead.
 * @inputs MouseEvent clicks, DOM events, and EditorView instances.
 * @outputs ProseMirror Plugin instance and link resolution utilities.
 * @functions
 *   - linkHrefAt: Finds the href of the closest anchor ancestor for an event target inside the root element.
 *   - createLinkFollowPlugin: Creates the ProseMirror plugin that handles link follow clicks and prevents browser defaults.
 * @dataflow Mouse click event -> linkHrefAt -> options.onFollow(href) callback.
 * @controlflow On click: handleDOMEvents suppresses default browser window open -> handleClick checks modifier keys -> resolves href -> dispatches onFollow and consumes event.
 * @version 1
 * @date 2026-09-13
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

/**
 * Configuration options for the link follow plugin (FR-8.13).
 */
export interface LinkFollowOptions {
  /** Called with the link's href exactly as written in the document. */
  readonly onFollow: (href: string) => void;
}

/**
 * Plugin key uniquely identifying the link follow plugin.
 */
export const linkFollowPluginKey: PluginKey = new PluginKey('kdocLinkFollow');

/**
 * Finds the link a mouse event landed on, if any. Exported for its tests.
 * Returns the href of the closest `a[href]` ancestor of `event.target` that lies inside `root`, or null.
 *
 * @purpose Resolves the link href attribute from an event target within the specified root element.
 * @inputs
 *   - root: HTMLElement - The root DOM element of the editor view.
 *   - target: EventTarget | null - The event target originating the mouse event.
 * @outputs string | null - The raw href attribute value if found within root, or null otherwise.
 * @dataflow target -> Node/Element resolution -> anchor element resolution -> root containment check -> href attribute extraction.
 * @controlflow Verify target is Node -> resolve Element or parentElement -> find closest a[href] -> verify root containment -> extract non-empty href.
 */
export function linkHrefAt(root: HTMLElement, target: EventTarget | null): string | null {
  // Check whether the target is a valid DOM Node instance.
  if (!(target instanceof Node)) {
    // Target is null or not a DOM Node: cannot be inside an anchor element.
    return null;
  } else {
    // Target is a DOM Node: resolve it to an Element.
  }

  let element: Element | null = null;
  // Check whether target is already an Element instance.
  if (target instanceof Element) {
    // Target is directly an Element: use it directly for selector querying.
    element = target;
  } else {
    // Target is a non-Element Node (such as a Text node): resolve its parent Element.
    element = target.parentElement;
  }

  // Check whether a valid Element was resolved from the target.
  if (element === null) {
    // No parent element exists: target is detached or has no element hierarchy.
    return null;
  } else {
    // Valid element resolved: locate the closest enclosing anchor element.
  }

  const anchor: Element | null = element.closest('a[href]');
  // Check whether the element is inside an anchor tag with an href attribute.
  if (anchor === null) {
    // No enclosing anchor element with an href attribute was found.
    return null;
  } else {
    // Enclosing anchor tag found: verify whether it lies within the editor root.
  }

  // Check whether the anchor element is contained within the specified root element.
  if (!root.contains(anchor)) {
    // Anchor belongs to another container outside this editor root: do not follow.
    return null;
  } else {
    // Anchor is contained within root: extract the href attribute value.
  }

  const href: string | null = anchor.getAttribute('href');
  // Check whether href attribute is missing or contains only whitespace.
  if (href === null || href.trim().length === 0) {
    // Empty or missing href attribute: return null.
    return null;
  } else {
    // Valid href attribute found: return the raw untrimmed attribute string as written.
    return href;
  }
}

/**
 * Creates the ProseMirror plugin that enables following links via Ctrl+Click or Cmd+Click (FR-8.13).
 *
 * Ordering contract:
 * This plugin must be installed BEFORE the multi-caret plugin. ProseMirror queries plugins in order
 * and the first handleClick handler to return true wins. If installed after the multi-caret plugin,
 * every Ctrl+Click on a link would be intercepted by multi-caret and add a caret instead of following the link.
 *
 * @purpose Instantiates a ProseMirror plugin handling link follow clicks and suppressing browser default navigation.
 * @inputs
 *   - options: LinkFollowOptions - Configuration options containing the onFollow callback.
 * @outputs Plugin - Configured ProseMirror Plugin instance.
 * @dataflow Click events -> handleClick / handleDOMEvents -> linkHrefAt -> options.onFollow(href).
 * @controlflow handleDOMEvents click intercepts modified link clicks to prevent browser navigation -> handleClick detects modifier keys and link target -> executes onFollow callback and consumes event.
 */
export function createLinkFollowPlugin(options: LinkFollowOptions): Plugin {
  return new Plugin({
    key: linkFollowPluginKey,
    props: {
      handleClick(view: EditorView, _pos: number, event: MouseEvent): boolean {
        // Check whether neither Ctrl nor Meta modifier key is active.
        if (!event.ctrlKey && !event.metaKey) {
          // Ordinary click without modifier: allow ProseMirror to place caret normally without hijacking.
          return false;
        } else {
          // Modifier key active: check if click landed on an anchor element inside the editor.
        }

        const href: string | null = linkHrefAt(view.dom, event.target);
        // Check whether a valid link was resolved at the clicked position.
        if (href === null) {
          // Plain text click with modifier: return false so subsequent plugins (such as multi-caret) can add a caret.
          return false;
        } else {
          // Valid link clicked with modifier: suppress default, follow the link, and consume the event.
          event.preventDefault();
          options.onFollow(href);
          return true;
        }
      },
      handleDOMEvents: {
        click(view: EditorView, event: MouseEvent): boolean {
          // Check whether a modifier key is held and the click target is a valid link within the editor.
          if ((event.ctrlKey || event.metaKey) && linkHrefAt(view.dom, event.target) !== null) {
            // Modified click on a link: suppress browser default to prevent opening a new window alongside our follow handler.
            event.preventDefault();
          } else {
            // Unmodified click or plain text: let the native event proceed uninhibited.
          }
          // Return false in all cases: handleDOMEvents only suppresses browser defaults, it never follows links directly.
          return false;
        },
      },
    },
  });
}
