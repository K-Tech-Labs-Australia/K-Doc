/**
 * @file session-state.ts
 * @purpose Remembers the window's arrangement between launches (FR-6.10): which files were open, which was in front, the view mode, the split, the sidebars and where the document was scrolled to. Unsaved text is not its business — the crash journal owns that; only saved files are persisted here so there is never a second answer to restore.
 * @inputs a storage, a session to store
 * @outputs the stored session, or null when there is none to trust
 * @functions loadSession - reads and validates a persisted session, returning null on any mismatch; saveSession - writes a session back out with its file list capped; clearSession - removes any stored entry so restoring can be turned off.
 * @dataflow live shell state -> PersistedSession -> JSON -> local storage, and back
 * @controlflow anything stored that is not a session of the version this code knows is read as "no session", so a hand-edited or older entry starts clean rather than half-restoring
 * @version 1
 * @date 2026-09-16
 */

/**
 * @purpose The editor's rendering modes, stored so a restored launch matches how it was left. Repeated here rather than imported from the shell so the stored shape does not silently change when the editor's own union changes; a mode this code does not know is a session it cannot restore.
 * @inputs (none — a closed literal union used as PersistedSession.viewMode)
 * @outputs (none — consumed by loadSession/saveSession round-trips)
 * @dataflow Stored string -> validated against VIEW_MODES -> SessionViewMode in the restored session.
 * @controlflow Closed literal union; no branching within this declaration.
 */
export type SessionViewMode = 'wysiwyg' | 'split' | 'source';

/**
 * @purpose One sidebar's persisted state: either collapsed or showing a single panel by id.
 * @inputs (none — a record shape produced by asPanel)
 * @outputs (none — consumed by PersistedSession.sidebar and .rightSidebar)
 * @dataflow Stored object -> asPanel validation -> PersistedPanel instance.
 * @controlflow Closed record; no branching within this declaration.
 */
export interface PersistedPanel {
  readonly collapsed: boolean;
  readonly panelId: string | null;
}

/**
 * @purpose The full window arrangement persisted between launches (FR-6.10): open files, the active file, view mode, split ratio, both sidebars, and scroll offsets. Only saved files are listed — unsaved text belongs to the crash journal, and writing it twice would mean two answers to restore and no way to tell which is newer.
 * @inputs (none — assembled by loadSession, consumed by saveSession)
 * @outputs (none — the persisted contract for a single session)
 * @dataflow Shell state -> this record -> JSON string -> storage, and back again on load.
 * @controlflow Closed record; version 1 is the only accepted shape, enforced at read time.
 */
export interface PersistedSession {
  readonly version: 1;
  readonly paths: readonly string[];
  readonly activePath: string | null;
  readonly viewMode: SessionViewMode;
  readonly splitRatio: number;
  readonly sidebar: PersistedPanel;
  readonly rightSidebar: PersistedPanel;
  readonly scrollWysiwyg: number;
  readonly scrollSource: number;
}

/**
 * @purpose The minimal storage contract this module depends on, so it can run against localStorage or a mock without importing the DOM.
 * @inputs (none — an interface describing the three operations used)
 * @outputs (none — implemented by the host environment)
 * @dataflow N/A — transport boundary only.
 * @controlflow N/A — no logic lives here.
 */
export interface SessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The storage key under which the current session is persisted across launches. */
export const SESSION_STORAGE_KEY: string = 'kdoc.session.v1';

/** A bound on how many files a launch will open, so a runaway session cannot make the app unusable at startup. */
export const MAX_RESTORED_TABS: number = 30;

/** The complete set of view modes this code understands; a mode outside it is un-restorable by design. */
const VIEW_MODES: readonly SessionViewMode[] = Object.freeze<readonly SessionViewMode[]>([
  'wysiwyg',
  'split',
  'source',
]);

/**
 * @purpose Coerces an unknown stored value into a PersistedPanel, returning null when it is not a well-formed panel. The stored text can be anything (a hand edit, a half-written entry); each field is checked rather than trusted.
 * @inputs value - the raw parsed value to attempt to interpret as a panel.
 * @outputs A valid PersistedPanel, or null if value is not an object, lacks a boolean collapsed flag, or carries a non-string/non-null panelId.
 * @dataflow Unknown -> type guard -> record field extraction -> PersistedPanel | null.
 * @controlflow Reject non-objects first; then require a boolean collapsed; then allow null or string panelId; return the built panel last.
 */
function asPanel(value: unknown): PersistedPanel | null {
  // Reject anything that is not a plain object; a panel must serialize as one.
  if (typeof value !== 'object' || value === null) {
    return null;
  } else {
    // It is an object; fall through to validate its fields.
  }
  const record = value as Record<string, unknown>;
  const panelId = record['panelId'];
  // A panel must carry a boolean collapsed flag or it cannot be trusted.
  if (typeof record['collapsed'] !== 'boolean') {
    return null;
  } else {
    // The collapsed flag is present and boolean; keep validating the rest.
  }
  // panelId may legitimately be null, but anything that is neither null nor a string is rejected.
  if (panelId !== null && typeof panelId !== 'string') {
    return null;
  } else {
    // panelId is either null or a valid string; the panel is well-formed.
  }
  return { collapsed: record['collapsed'], panelId };
}

/**
 * @purpose Accepts only real, finite numbers and rejects everything else (NaN, Infinity, non-numbers).
 * @inputs value - the raw parsed value to attempt to interpret as a number.
 * @outputs The finite number, or null when value is not a finite number.
 * @dataflow Unknown -> typeof + Number.isFinite check -> number | null.
 * @controlflow Reject on wrong type or non-finite; return the value only in the passing branch.
 */
function asFiniteNumber(value: unknown): number | null {
  // Only real, finite numbers survive; NaN/Infinity and non-numbers are dropped.
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  } else {
    // The value is a finite number; hand it back unchanged.
    return value;
  }
}

/**
 * @purpose Reads and validates the stored session, returning it only when every field is present and of the expected shape. Anything that does not match — wrong version, malformed JSON, a bad entry in paths, an unknown view mode, missing panels — yields null so the launch starts clean instead of half-restoring. Strictness is deliberate: a partly-valid session restoring half the window is worse than starting clean.
 * @inputs storage - the SessionStorage to read SESSION_STORAGE_KEY from; access may throw (disabled storage, quota).
 * @outputs The restored PersistedSession, or null when there is no session to trust — first launch, unreadable storage, unparseable data, or a version this code does not know.
 * @dataflow Storage string -> JSON.parse -> field-by-field validation -> trimmed and scrolled-clamped PersistedSession.
 * @controlflow Read raw value -> early return on read failure -> parse -> early returns at each failed check -> assemble and return the session last.
 */
export function loadSession(storage: SessionStorage): PersistedSession | null {
  let raw: string | null;
  try {
    raw = storage.getItem(SESSION_STORAGE_KEY);
  } catch {
    // Storage access can throw (e.g. disabled storage, quota); treat that as no session to restore.
    return null;
  }
  // Nothing stored means a first launch rather than an error condition.
  if (raw === null) {
    return null;
  } else {
    // A raw string exists; attempt to parse it below.
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Malformed JSON cannot be restored; this is the same as a first launch.
    return null;
  }
  // The top level must be a JSON object, not an array or primitive value.
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  } else {
    // It is an object; inspect its fields below.
  }

  const record = parsed as Record<string, unknown>;
  // Only version 1 sessions are understood; anything else starts clean rather than being guessed at.
  if (record['version'] !== 1) {
    return null;
  } else {
    // Version matches; continue validating each field in turn.
  }

  const rawPaths = record['paths'];
  // paths must be an array, and every entry a non-empty string — one bad entry invalidates the whole list.
  if (!Array.isArray(rawPaths)) {
    return null;
  } else {
    // It is an array; verify each entry is a usable string below.
  }
  const paths = rawPaths.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  // If filtering dropped anything, the list cannot be trusted and is discarded wholesale rather than quietly shortened.
  if (paths.length !== rawPaths.length) {
    return null;
  } else {
    // Every entry survived; the path list is clean and complete.
  }

  const activePath = record['activePath'];
  // activePath may legitimately be null, but a non-null value must be a string.
  if (activePath !== null && typeof activePath !== 'string') {
    return null;
  } else {
    // activePath is either null or a valid string; accept it as-is.
  }

  const viewMode = record['viewMode'];
  // The mode must be one this code knows, or the session cannot be restored at all.
  if (!VIEW_MODES.includes(viewMode as SessionViewMode)) {
    return null;
  } else {
    // The mode is recognised; keep validating the remaining fields.
  }

  const splitRatio = asFiniteNumber(record['splitRatio']);
  const scrollWysiwyg = asFiniteNumber(record['scrollWysiwyg']);
  const scrollSource = asFiniteNumber(record['scrollSource']);
  // All three numeric fields must be finite or the whole session is rejected.
  if (splitRatio === null || scrollWysiwyg === null || scrollSource === null) {
    return null;
  } else {
    // Every numeric field parsed; continue to the sidebar panels.
  }

  const sidebar = asPanel(record['sidebar']);
  const rightSidebar = asPanel(record['rightSidebar']);
  // Both sidebars must be valid panels or nothing is restored — a missing panel means an incomplete window.
  if (sidebar === null || rightSidebar === null) {
    return null;
  } else {
    // Both panels are valid; assemble the full session below.
  }

  return {
    version: 1,
    paths: paths.slice(0, MAX_RESTORED_TABS),
    activePath,
    viewMode: viewMode as SessionViewMode,
    splitRatio,
    sidebar,
    rightSidebar,
    scrollWysiwyg: Math.max(0, scrollWysiwyg),
    scrollSource: Math.max(0, scrollSource),
  };
}

/**
 * @purpose Writes a session back to storage, capping the open-file list so a long-running window cannot write an entry it would then refuse to read on reload. A storage that refuses the write loses the arrangement and nothing else.
 * @inputs storage - the SessionStorage to write SESSION_STORAGE_KEY to; setItem may throw on refusal or quota.
 * @inputs session - the PersistedSession to persist verbatim (its paths are re-capped defensively here).
 * @outputs void — nothing is returned; a failed write must never break the app that called it.
 * @dataflow PersistedSession -> JSON.stringify with paths capped -> storage string under SESSION_STORAGE_KEY.
 * @controlflow Attempt the single setItem call inside one try; swallow any throw so saving is best-effort.
 */
export function saveSession(storage: SessionStorage, session: PersistedSession): void {
  try {
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ ...session, paths: session.paths.slice(0, MAX_RESTORED_TABS) }));
  } catch {
    // A storage that refuses the write loses the arrangement and nothing else; do not propagate.
  }
}

/**
 * @purpose Removes any stored session, used when a reader turns restoring off so the old arrangement is not kept against their wishes.
 * @inputs storage - the SessionStorage to remove SESSION_STORAGE_KEY from; removeItem may throw on refusal or quota.
 * @outputs void — best-effort cleanup with no return value; a failed clear keeps the old entry but never breaks the app.
 * @dataflow Storage key -> removeItem -> stored entry gone.
 * @controlflow Attempt the single removeItem call inside one try; swallow any throw so clearing is best-effort.
 */
export function clearSession(storage: SessionStorage): void {
  try {
    storage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Failing to clear is best-effort; there is no session value to return and the app must keep running.
  }
}
