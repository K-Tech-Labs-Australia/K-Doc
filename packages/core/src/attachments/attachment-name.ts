/**
 * @file attachment-name.ts
 * @purpose Resolves the on-disk file name an attachment is written under, by expanding a naming template against contextual tokens and sanitising the result.
 * @inputs A naming template string; an AttachmentNameContext carrying the source file name, document title, extension, and timestamp.
 * @outputs The final file stem or full file name (stem plus extension) for the attachment.
 * @functions
 *   - sanitizeNamePart: Reduces a single fragment to characters safe for a file name.
 *   - applyTemplate: Expands {name}/{doc}/{date}/{time} tokens in a template against the context.
 *   - attachmentFileName: Chooses a template, expands and sanitises it, then appends the extension.
 * @dataflow Template + AttachmentNameContext → token expansion (applyTemplate) → sanitisation (sanitizeNamePart) → optional extension append (attachmentFileName).
 * @controlflow Choose template if blank → expand tokens → sanitize stem → fall back to a default name when empty → append extension only from the context.
 * @version 1
 * @date 2026-09-18
 */

/** The template used when the reader has not set one: the source name and the date. */
export const DEFAULT_ATTACHMENT_TEMPLATE: string = '{name}-{date}';

/** The name standing in for a pasted image, which arrives with no name of its own. */
export const PASTED_ATTACHMENT_NAME: string = 'pasted';

/** The name used when a template and its tokens leave nothing usable behind. */
export const FALLBACK_ATTACHMENT_NAME: string = 'attachment';

/** Every token a template may contain. */
export const ATTACHMENT_TOKENS: readonly string[] = ['name', 'doc', 'date', 'time'];

// Characters a file name may not carry — the path separators, the characters Windows forbids, and the control
// characters — each rewritten to '-'. Whitespace is left to the rule below, which collapses a run of it to one '-'.
const FORBIDDEN_FILENAME_CHARS: RegExp = /[\\/:*?"<>|\u0000-\u001f]/g;

// Any run of whitespace, collapsed to a single '-' so spacing never survives into a name.
const WHITESPACE_RUN: RegExp = /\s+/g;

// A run of two or more hyphens (which the previous steps can create), collapsed to one.
const DASH_RUN: RegExp = /-{2,}/g;

// Leading separators stripped from the final stem.
const LEADING_SEPARATORS: RegExp = /^[-.]+/;

// Trailing separators stripped from the final stem.
const TRAILING_SEPARATORS: RegExp = /[-.]+$/;

export interface AttachmentNameContext {
  /** Base name of the dropped file, without its extension; empty for a pasted image. */
  readonly name: string;
  /** Base name of the document being edited, without its extension; empty for an unsaved document. */
  readonly document: string;
  /** Extension to append, lower-case and without the dot; empty appends nothing. */
  readonly extension: string;
  /** When the attachment is being added; the {date} and {time} tokens read local time from it. */
  readonly at: Date;
}

/**
 * @purpose Reduces a single name fragment to characters safe for a file name by rewriting anything a file system rejects.
 * @inputs part - A raw fragment taken from a source file name, a document title, or a template.
 * @outputs The fragment with forbidden and whitespace characters replaced by hyphens and surrounding separators trimmed.
 * @dataflow Raw fragment → character rewrite → whitespace collapse → dash collapse → separator trim → cleaned fragment.
 * @controlflow Apply each transformation in sequence; no branching, so every stage runs on the previous result.
 */
export function sanitizeNamePart(part: string): string {
  // A name part comes from a file name, a document title or a template, and any of them can carry a separator or a character Windows refuses.
  let cleaned = part.replace(FORBIDDEN_FILENAME_CHARS, '-');
  // Collapse every run of whitespace into a single hyphen so spacing never survives into the name.
  cleaned = cleaned.replace(WHITESPACE_RUN, '-');
  // Collapse runs of two or more hyphens (which the previous steps can create) down to one.
  cleaned = cleaned.replace(DASH_RUN, '-');
  // Strip leading and trailing separators so a fragment cannot start or end with a hyphen or dot.
  cleaned = cleaned.replace(LEADING_SEPARATORS, '');
  cleaned = cleaned.replace(TRAILING_SEPARATORS, '');
  return cleaned;
}

/**
 * @purpose Pads a numeric date/time component to the two digits a stamp requires.
 * @inputs value - A month, day, hour, minute or second whose textual form may be one digit.
 * @outputs The value as a zero-padded two-character string (e.g., 7 becomes "07").
 * @dataflow Numeric component → String() conversion → left-pad with zeros to width 2.
 * @controlflow No branching; padStart returns the original string when it is already two digits wide.
 */
function twoDigits(value: number): string {
  // Pad a month, day, hour, minute or second to the two digits a stamp needs.
  return String(value).padStart(2, '0');
}

/**
 * @purpose Expands the {name}, {doc}, {date} and {time} tokens in a template against an AttachmentNameContext.
 * @inputs template - The naming template, which may contain any combination of the four tokens.
 *               context - The surrounding data (source name, document title, extension, timestamp) the tokens resolve against.
 * @outputs The template with every recognised token replaced by its resolved text; unknown braces are left untouched.
 * @dataflow Template + context → per-token resolution → single regex pass substitutes each token → expanded string returned.
 * @controlflow Resolve all four texts once, then walk the template replacing each matched token via a branch on the token name.
 */
export function applyTemplate(template: string, context: AttachmentNameContext): string {
  // The source file has no base name when it is a pasted image; sanitising first reveals that emptiness.
  const rawName = sanitizeNamePart(context.name);
  // When nothing usable remains after sanitising, stand in with the fixed pasted-image name.
  const nameText = rawName === '' ? PASTED_ATTACHMENT_NAME : rawName;
  // The document title may be empty for an unsaved document; sanitising still yields a usable (possibly empty) fragment.
  const docText = sanitizeNamePart(context.document);
  // Local calendar date as YYYY-MM-DD; getMonth() is zero-based so add one before padding.
  const dateText = `${context.at.getFullYear()}-${twoDigits(context.at.getMonth() + 1)}-${twoDigits(context.at.getDate())}`;
  // Local wall-clock time as a compact HHMMSS stamp built from individually padded components.
  const timeText = `${twoDigits(context.at.getHours())}${twoDigits(context.at.getMinutes())}${twoDigits(context.at.getSeconds())}`;

  // One pass replaces every recognised token; the trailing else returns any unmatched brace verbatim.
  return template.replace(/\{(name|doc|date|time)\}/g, (match: string, token: string): string => {
    // {name} maps to the resolved source-file base name.
    if (token === 'name') {
      return nameText;
    } else if (token === 'doc') {
      // {doc} maps to the resolved document title.
      return docText;
    } else if (token === 'date') {
      // {date} maps to the resolved local date stamp.
      return dateText;
    } else if (token === 'time') {
      // {time} maps to the resolved local time stamp.
      return timeText;
    } else {
      // Unreachable for this pattern: a brace the regex does not list is returned exactly as written.
      return match;
    }
  });
}

/**
 * @purpose Computes the full on-disk file name for an attachment by expanding a template, sanitising it, and appending the extension.
 * @inputs template - The reader's naming template, or an empty string to select the default template.
 *               context - The surrounding data (source name, document title, extension, timestamp) driving token resolution.
 * @outputs The file stem when no extension applies, otherwise "stem.extension"; a template can never supply the extension.
 * @dataflow Template → applyTemplate expansion → sanitizeNamePart cleaning → fallback-or-stem → optional extension append.
 * @controlflow Select template if blank → expand and clean the stem → substitute a default name when empty → append the context extension only.
 */
export function attachmentFileName(template: string, context: AttachmentNameContext): string {
  // A blank or whitespace-only template defers to the built-in default so readers always get a sensible name.
  const chosenTemplate = template.trim() === '' ? DEFAULT_ATTACHMENT_TEMPLATE : template;

  // Expand then sanitise in one stem; sanitising after expansion removes separators the tokens themselves may introduce.
  let stem = sanitizeNamePart(applyTemplate(chosenTemplate, context));

  // A template made only of tokens that all resolve to nothing would otherwise name a file after its extension alone.
  if (stem === '') {
    // No usable characters survived: use the generic attachment name so the file is never empty-named.
    stem = FALLBACK_ATTACHMENT_NAME;
  } else {
    // A usable stem exists: keep it and proceed to optional extension appending.
  }

  // The extension comes solely from the context, never from the template, so a template cannot relabel a PNG as another type.
  if (context.extension === '') {
    // No extension requested: return the bare stem with no trailing dot.
    return stem;
  } else {
    // An extension is present: append it to the stem with a single separating dot.
    return `${stem}.${context.extension}`;
  }
}
