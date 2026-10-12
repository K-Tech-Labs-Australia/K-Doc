/**
 * @file plugin-protocol.ts
 * @purpose Declares everything a plugin is allowed to say across the worker boundary and reads it back strictly (FR-14.18).
 * @inputs Raw values handed from a plugin worker that has no DOM, filesystem or network; the isPluginId guard from plugin-manifest.js.
 * @outputs Validated PluginMessage and PluginRegistration unions plus their readers, which answer null on anything unrecognised.
 * @functions
 *   - MAX_LABEL: longest allowed label, title or format name, read in menus.
 *   - MAX_PATTERN: longest allowed syntax pattern, run over every paragraph of a document.
 *   - SAFE_TAGS: elements a plugin's own syntax may render as; nothing that can run or load is among them.
 *   - CLASS_PATTERN: characters a class name may be made of so a plugin cannot escape the class attribute.
 *   - EXTENSION_PATTERN: characters a file extension may be made of, plus MAX_EXTENSION for its length.
 *   - PluginPoint: where a plugin may add something of its own.
 *   - PluginRegistration: one thing a plugin added, shaped per point.
 *   - PluginCall: what K-Doc asks a plugin to do; only the document text crosses with it.
 *   - PluginMessage: what a plugin says back across the boundary.
 *   - isObject: type guard for plain objects that are neither null nor arrays.
 *   - readLabel: reads one short menu text, trimmed and within length.
 *   - readPluginMessage: reads a full reply from a plugin, answering null on anything K-Doc does not understand.
 *   - readRegistration: reads one thing a plugin added before K-Doc will draw or run it.
 * @dataflow Raw worker output -> object/point/id guards -> per-point field validation -> validated union member or null -> host menu/render/status bar.
 * @controlflow Refuse non-objects and bad ids first, then branch on point; each reader never throws and answers null rather than raising so a single bad value cannot crash the host.
 * @version 1
 * @date 2026-09-18
 */

import { isPluginId } from './plugin-manifest.js';

/** The longest a label, a title or a format name may be: these are read in menus. */
const MAX_LABEL = 80;

/** The longest pattern a plugin may register. A pattern is run over every paragraph of a document. */
const MAX_PATTERN = 200;

/** A group containing a quantifier, itself followed by a quantifier: the shape behind catastrophic backtracking. */
const NESTED_QUANTIFIER = /\([^()]*[+*}][^()]*\)\s*[+*{?]/;

/** The elements a plugin's own syntax may render as. Anything that can run or load is not among them. */
const SAFE_TAGS: readonly string[] = ['span', 'mark', 'code', 'kbd', 'abbr', 'strong', 'em', 'del'];

/** What a class name may be made of, so a plugin cannot write its way out of the class attribute. */
const CLASS_PATTERN = /^[a-z][a-z0-9-]*$/;

/** A file extension is letters and digits only, no dots or slashes that could escape a filename. */
const EXTENSION_PATTERN = /^[a-z0-9]+$/;

/** The longest a file extension may be: it becomes part of a generated file name. */
const MAX_EXTENSION = 12;

/** Where a plugin may add something of its own (FR-14.18). */
export type PluginPoint = 'command' | 'syntax' | 'panel' | 'export';

/** One thing a plugin added, shaped per point so the host knows how to draw or run it (FR-14.18). */
export type PluginRegistration =
  | { readonly point: 'command'; readonly id: string; readonly label: string }
  | { readonly point: 'syntax'; readonly id: string; readonly pattern: string; readonly tag: string; readonly className: string }
  | { readonly point: 'panel'; readonly id: string; readonly title: string }
  | { readonly point: 'export'; readonly id: string; readonly name: string; readonly extension: string };

/** What K-Doc asks a plugin to do. The document's text goes with every call, and nothing else (FR-14.18). */
export interface PluginCall {
  readonly call: number;
  readonly point: 'command' | 'panel' | 'export';
  readonly id: string;
  readonly text: string;
}

/** What a plugin says back across the worker boundary (FR-14.18). */
export type PluginMessage =
  | { readonly kind: 'ready'; readonly registrations: readonly PluginRegistration[] }
  | { readonly kind: 'answer'; readonly call: number; readonly text: string | null; readonly message: string | null }
  | { readonly kind: 'failed'; readonly call: number | null; readonly reason: string };

/** Says whether a value is a plain object K-Doc may read by name, refusing null and arrays (FR-14.18).
 * @purpose Guards every reader against non-object input so later field access cannot surprise it across the boundary.
 * @inputs value - The unknown value handed to a reader from a plugin worker with no DOM, filesystem or network.
 * @outputs boolean type guard - True when `value` is an object that is neither null nor an array, false otherwise.
 * @dataflow Unknown value -> Array.isArray and null checks -> narrowed Record<string, unknown>.
 * @controlflow Reject arrays first (they are objects too), then reject literal null, leaving plain objects only; every branch has its own comment so the narrowing stays auditable. */
function isObject(value: unknown): value is Record<string, unknown> {
  // Anything that is not an object at all has no fields to read. Without this, undefined reached the
  // reads below and threw, which is the one thing these readers must never do.
  if (typeof value !== 'object') {
    return false;
  } else {
    // Some kind of object: it still must not be an array or null.
  }

  // A JSON array parses to an Array and has no named fields, so refuse it before any generic object check.
  // A mutant that let arrays through survived: an array carries none of the named fields either, so every
  // one of them is refused a line later for want of a point or a kind. It stays because refusing a thing
  // for what it is reads better than refusing it for what it happens to lack.
  if (Array.isArray(value)) {
    return false;
  } else {
    // Not an array: still must not be the literal null that JSON allows through.
  }

  // Literal null parses to `null`, which has no fields, so refuse it too rather than reading a missing key off nothing.
  if (value === null) {
    return false;
  } else {
    // Some non-null, non-array value remains: only then is it an object K-Doc can read by name.
  }

  return true;
}

/** Reads one short text field that K-Doc shows in menus: trimmed, present and within length (FR-14.18).
 * @purpose Gives labels, titles and format names the same strict treatment so none is ever blank or too long to read.
 * @inputs value - The raw field handed to a reader from a plugin worker.
 * @inputs limit - The longest this text may be once trimmed; longer input is refused rather than cut by the host.
 * @outputs string | null - The trimmed text when usable, otherwise null so the caller can refuse its whole message.
 * @dataflow value -> type and presence checks -> trim -> length check -> trimmed text or null.
 * @controlflow Refuse non-strings first, then blank-after-trim input (the fallback is always the caller's job), then over-long input; usable text passes through unchanged so menus never show stray whitespace. */
function readLabel(value: unknown, limit: number): string | null {
  // Only real text can be a label; anything else has no words to keep and must not reach a menu.
  if (typeof value !== 'string') {
    return null;
  } else {
    // Text was stated: trim it before judging whether anything is left or usable after all.
  }

  const trimmed = value.trim();

  // Check whether only whitespace survived the trim, which counts as never having been stated at all.
  if (trimmed.length === 0) {
    return null;
  } else {
    // Something real remains: now check it is short enough to read in a menu without wrapping badly.
  }

  if (trimmed.length > limit) {
    return null;
  } else {
    // Within the length, so keep the trimmed text as-is for the caller to place in a menu or title.
  }

  return trimmed;
}

/** Reads a full reply from a plugin, answering null when it said anything K-Doc does not understand (FR-14.18).
 * @purpose Turns raw worker output into exactly one of three message shapes, refusing the whole thing on any unverified part so no half-loaded state can hide a plugin bug.
 * @inputs value - The unknown object handed to the reader from a plugin worker with no DOM, filesystem or network.
 * @outputs PluginMessage | null - One validated reply shape, or null when kind is missing or any field fails its check.
 * @dataflow value -> object and kind guards -> per-kind field validation -> one tagged union member or null -> host menu/render/status bar.
 * @controlflow Refuse non-objects first, then branch on kind; each of ready/answer/failed validates its own fields before returning, with every if/else carrying an explicit comment so the narrowing stays auditable. */
export function readPluginMessage(value: unknown): PluginMessage | null {
  // A plugin may reply only through plain objects; refuse anything else outright so no field can be trusted later.
  if (!isObject(value)) {
    return null;
  } else {
    // It is a plain object with named fields to read, starting with which kind of message it is.
  }

  const kind = value['kind'];

  // `kind` must name one of the three reply kinds, nothing else K-Doc understands about plugin output.
  // A mutant that removed this survived, for the same reason as the point check above: an unrecognised kind
  // falls through to the branch for a failure and is refused there for saying no reason.
  if (kind !== 'ready' && kind !== 'answer' && kind !== 'failed') {
    return null;
  } else {
    // A recognised kind: validate its own fields below and build exactly one message shape for it.
  }

  if (kind === 'ready') {
    const registrations = value['registrations'];

    // `registrations` must be an array, because a ready reply is the whole set of things added at once.
    if (!Array.isArray(registrations)) {
      return null;
    } else {
      // An array: every entry has to read as a registration or the plugin registered one thing wrongly and half-loading it would hide that bug.
    }

    const parsed = registrations.map((entry: unknown) => readRegistration(entry));
    const read = parsed.filter((entry): entry is PluginRegistration => entry !== null);

    // One registration that did not read means the plugin has a bug, and half-loading it would hide that.
    if (read.length !== parsed.length) {
      return null;
    } else {
      // Every entry read: the plugin is ready with all of them.
    }

    return { kind, registrations: read };
  } else if (kind === 'answer') {
    const call = value['call'];
    const text = value['text'];
    const message = value['message'];

    // `call` must be a whole number that is not negative so the reply can be matched back to its request.
    if (typeof call !== 'number' || !Number.isInteger(call) || call < 0) {
      return null;
    } else {
      // A valid non-negative integer: now check the two optional text fields independently.
    }

    // `text` may be a string or literal null, but never another type such as a number or object that could not be shown verbatim.
    if (typeof text !== 'string' && text !== null) {
      return null;
    } else {
      // Text is usable as-is: check the status message next before returning this answer shape.
    }

    if (message !== null && typeof message !== 'string') {
      return null;
    } else if (typeof message === 'string' && message.length > MAX_LABEL) {
      return null;
    } else {
      // Message is absent, or present and short enough to fit a status bar without overflowing it.
    }

    return { kind, call, text, message };
  } else {
    // The remaining recognised kind is 'failed': validate its own fields before returning this shape.
  }

  const failedCall = value['call'];
  const reason = value['reason'];

  // `call` may be a non-negative whole number or literal null, since a failure can happen before any request was made.
  if (failedCall !== null && (typeof failedCall !== 'number' || !Number.isInteger(failedCall) || failedCall < 0)) {
    return null;
  } else {
    // Call is valid or absent: check the reason next so a plugin cannot fill the status bar with an unbounded string.
  }

  const trimmedReason = readLabel(reason, MAX_PATTERN);

  if (trimmedReason === null) {
    return null;
  } else {
    // A non-empty reason within length: keep it as-is since 'failed' carries no optional fields to assemble.
  }

  return { kind, call: failedCall, reason: trimmedReason };
}

/** Reads one thing a plugin added, checking every part before K-Doc will draw or run it (FR-14.18).
 * @purpose Turns raw worker output into exactly one registration shape, refusing anything unverified so nothing unsafe is ever drawn in a document or executed as a command.
 * @inputs value - The unknown object handed to the reader from a plugin worker with no DOM, filesystem or network.
 * @outputs PluginRegistration | null - One validated registration shaped per point, or null when any part fails its check.
 * @dataflow value -> object and point/id guards -> per-point field validation -> one tagged union member or null -> host menu/render/export.
 * @controlflow Refuse non-objects and bad ids first, then branch on point; each point validates its own fields before returning a shaped registration, with every if/else carrying an explicit comment so the narrowing stays auditable. */
export function readRegistration(value: unknown): PluginRegistration | null {
  // A plugin may add only through plain objects; refuse anything else outright so no field can be trusted later.
  if (!isObject(value)) {
    return null;
  } else {
    // It is a plain object with named fields to read, starting with which point it adds through and its id.
  }

  const point = value['point'];
  const id = value['id'];

  // `point` must name one of the four plugin points, nothing else K-Doc understands about where plugins add.
  // A mutant that removed this survived: an unrecognised point falls past every branch below into the one
  // for a syntax, which then refuses it for having no pattern. It stays because a registration should be
  // refused for naming a point K-Doc has not got, not for failing the checks of a point it never claimed.
  if (point !== 'command' && point !== 'syntax' && point !== 'panel' && point !== 'export') {
    return null;
  } else {
    // A recognised point: its identity still has to be a valid plugin id before anything is built from it.
  }

  // `id` must satisfy the same shape as a folder name, because K-Doc builds command ids and file names out of it.
  if (typeof id !== 'string' || !isPluginId(id)) {
    return null;
  } else {
    // A valid id: read this point's own fields below before returning exactly one shaped registration.
  }

  if (point === 'command') {
    const label = value['label'];

    // `label` is the menu text for a command, so it must be trimmed, present and short enough to read in a menu.
    const labelOut = readLabel(label, MAX_LABEL);

    if (labelOut === null) {
      return null;
    } else {
      // A usable label: assemble this point's registration shape with the already-validated id.
    }

    return { point, id, label: labelOut };
  } else if (point === 'panel') {
    const title = value['title'];

    // `title` is shown above a panel, so it gets the same menu treatment as a command label here.
    const titleOut = readLabel(title, MAX_LABEL);

    if (titleOut === null) {
      return null;
    } else {
      // A usable title: assemble this point's registration shape with the already-validated id.
    }

    return { point, id, title: titleOut };
  } else if (point === 'export') {
    const name = value['name'];
    const extension = value['extension'];

    // `name` is the format shown to a reader choosing an export target, so it must be trimmed, present and short.
    const nameOut = readLabel(name, MAX_LABEL);

    if (nameOut === null) {
      return null;
    } else {
      // A usable format name: check the extension next before returning this point's registration shape.
    }

    // `extension` must be letters and digits only so it can never contain a dot or slash that escapes a filename, then its length is bounded by MAX_EXTENSION.
    if (typeof extension !== 'string' || !EXTENSION_PATTERN.test(extension) || extension.length > MAX_EXTENSION) {
      return null;
    } else {
      // A safe, short extension: assemble this point's registration shape with the already-validated id and name.
    }

    return { point, id, name: nameOut, extension };
  } else {
    // The remaining recognised point is 'syntax': validate its pattern, tag and class before returning this shape.
  }

  const pattern = value['pattern'];
  const tag = value['tag'];
  const className = value['className'];

  // `pattern` must be trimmed, present and short enough to read in a menu; the compile check below is what keeps it safe to run over every paragraph.
  const patternOut = readLabel(pattern, MAX_PATTERN);

  if (patternOut === null) {
    return null;
  } else {
    // A usable pattern string: now confirm it actually compiles before K-Doc ever runs it against a document.
  }

  // A pattern that cannot compile would throw later, in the middle of rendering a document, so it is
  // compiled here where the failure costs the plugin its registration and nothing else.
  try {
    new RegExp(patternOut, 'g');
  } catch {
    return null;
  }

  // A quantified group that itself contains a quantifier ((a+)+, (a*)*, (x|y+){2,}) can take exponential time on a
  // long paragraph and freeze K-Doc while it renders, so such patterns are refused at registration.
  if (NESTED_QUANTIFIER.test(patternOut)) {
    return null;
  } else {
    // No nested quantifier: safe to run over every paragraph.
  }

  // `tag` must be one of the safe elements, so a plugin cannot inject an element that runs scripts or loads resources into a document.
  if (typeof tag !== 'string' || !SAFE_TAGS.includes(tag)) {
    return null;
  } else {
    // A safe tag: check the class name last before assembling this point's registration shape.
  }

  const classNameOut = readLabel(className, MAX_LABEL);

  if (classNameOut === null || !CLASS_PATTERN.test(classNameOut)) {
    return null;
  } else {
    // The class is present and made only of allowed characters: assemble this point's registration with the already-validated id.
  }

  return { point, id, pattern: patternOut, tag, className: classNameOut };
}
