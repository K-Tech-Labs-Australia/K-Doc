/**
 * @file open-tab.ts
 * @purpose Finds the tab already showing a file, so opening a note that is open switches to it instead of loading a second copy.
 * @inputs tab records and a path.
 * @outputs a tab id or null.
 * @functions
 *   - openTabFor: Returns the id of an existing tab whose path matches, or null when no open tab shows that path.
 * @dataflow tabs → path comparison → id.
 * @controlflow first match wins.
 * @version 1
 * @date 2026-09-15
 */
import { samePath } from './navigation-controller.js';

/** The part of a tab record this lookup reads. */
export interface PathTab {
  readonly id: string;
  readonly payload: { readonly path: string | null };
}

/**
 * @purpose Finds the tab already showing the given path.
 * @inputs tabs - the records to search; path - the file path to match against.
 * @outputs The matching tab's id, or null when no open tab shows that path.
 * @dataflow Each tab's path is compared with `path` via samePath; the first winner yields its id.
 * @controlflow Iterate tabs in order; return on the first match; otherwise fall through to null.
 */
export function openTabFor(tabs: readonly PathTab[], path: string): string | null {
  for (const tab of tabs) {
    // An unsaved tab has no path and can never be the file asked for.
    if (tab.payload.path !== null && samePath(tab.payload.path, path)) {
      return tab.id;
    } else {
      // Another file, or no file: keep looking.
    }
  }
  return null;
}