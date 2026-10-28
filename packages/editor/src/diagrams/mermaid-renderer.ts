/**
 * @file mermaid-renderer.ts
 * @purpose Provides a lazy-loaded, sequentially queued Mermaid diagram renderer with strict security and DOM cleanup.
 * @inputs Mermaid diagram text source strings, DiagramTheme mode selection ('light' | 'dark'), and DOM Document reference.
 * @outputs DiagramResult objects containing rendered SVG strings or user-facing error messages, and SVG data URIs.
 * @functions
 *   - isMermaidLanguage: Checks whether a code block language tag indicates a Mermaid diagram.
 *   - svgToDataUri: Encodes an SVG XML string into a data URI for image rendering.
 *   - createMermaidRenderer: Creates an isolated, sequentially queued Mermaid diagram renderer.
 *   - renderMermaid: Shared diagram renderer instance that lazily loads Mermaid on first use.
 * @dataflow Diagram source text & theme → sequential execution queue → MermaidApi.render → scratch DOM cleanup → DiagramResult.
 * @controlflow Queue promises sequentially → validate input → lazily import MermaidApi → initialize config per render → render SVG → clean up scratch DOM elements in finally block.
 * @version 1
 * @date 2026-10-28
 */

export type DiagramTheme = 'light' | 'dark';

export type DiagramResult =
  | { readonly ok: true; readonly svg: string }
  | { readonly ok: false; readonly message: string };

export type DiagramRenderer = (source: string, theme: DiagramTheme) => Promise<DiagramResult>;

export interface MermaidConfigSubset {
  readonly startOnLoad: boolean;
  readonly securityLevel: 'strict';
  readonly theme: 'default' | 'dark';
  readonly htmlLabels: boolean;
  readonly flowchart: { readonly htmlLabels: boolean };
  readonly suppressErrorRendering: boolean;
}

export interface MermaidApi {
  initialize(config: MermaidConfigSubset): void;
  render(id: string, text: string): Promise<{ readonly svg: string }>;
}

export type MermaidLoader = () => Promise<MermaidApi>;

export const MAX_ERROR_LENGTH = 500; // characters of a Mermaid error message shown inline

/**
 * Checks whether a given language identifier string matches 'mermaid'.
 *
 * @purpose Determines if a code block language specifier represents a Mermaid diagram.
 * @inputs language - Unknown input value representing the code block language identifier.
 * @outputs boolean - True if language is a string equal to 'mermaid' (case-insensitive, trimmed), false otherwise.
 * @dataflow language input → type check & trim & lowercase → boolean result.
 * @controlflow Check if language is a string → trim whitespace and convert to lowercase → compare with 'mermaid'.
 */
export function isMermaidLanguage(language: unknown): boolean {
  // Check if the language argument is of string type.
  if (typeof language === 'string') {
    // Check if the trimmed and lowercased string matches the identifier 'mermaid'.
    return language.trim().toLowerCase() === 'mermaid';
  } else {
    // Non-string values cannot be a valid mermaid language identifier.
    return false;
  }
}

/**
 * Converts an SVG XML string into a UTF-8 encoded data URI.
 *
 * @purpose Encodes an SVG string into a data URI suitable for use as an image source.
 * @inputs svg - Raw SVG XML string to encode.
 * @outputs string - Encoded data:image/svg+xml data URI.
 * @dataflow svg string → encodeURIComponent → data URI string.
 * @controlflow URL-encode SVG string and prepend the UTF-8 data URI header prefix.
 */
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Formats an unknown error value into a user-facing error message with length limits.
 *
 * @purpose Extracts and sanitizes error text from caught exceptions, truncating long messages.
 * @inputs error - Unknown error caught during diagram loading or rendering.
 * @outputs string - Human-readable error message.
 * @dataflow error input → string extraction → trimming → length clamping → formatted message.
 * @controlflow Extract message from Error or String representation → trim whitespace → if empty return fallback → if exceeds MAX_ERROR_LENGTH truncate and append ellipsis → return trimmed message.
 */
function errorText(error: unknown): string {
  // Check if error is an instance of Error to extract its message, otherwise convert error to string.
  const raw: string = error instanceof Error ? error.message : String(error);
  const t: string = raw.trim();

  // Check if the trimmed error message is empty.
  if (t === '') {
    // Fall back to a generic error message when error text is blank.
    return 'The diagram could not be drawn.';
  } else {
    // Check if the trimmed error message exceeds the maximum allowed inline error length.
    if (t.length > MAX_ERROR_LENGTH) {
      // Truncate message to maximum allowed length and append horizontal ellipsis.
      return `${t.slice(0, MAX_ERROR_LENGTH)}…`;
    } else {
      // Message length is within limits; return trimmed error text directly.
      return t;
    }
  }
}

/**
 * Creates an isolated, sequentially queued Mermaid diagram renderer.
 *
 * @purpose Factory function creating a diagram renderer that executes renders serially to avoid Mermaid state collisions.
 * @inputs load - MermaidLoader function that lazily imports and returns the MermaidApi.
 * @inputs doc - DOM Document instance used for scratch element cleanup.
 * @outputs DiagramRenderer - An async rendering function accepting diagram source and theme.
 * @dataflow source & theme → serialized queue → run execution → MermaidApi render → scratch DOM cleanup → DiagramResult.
 * @controlflow Initialize queue promise and API cache → return DiagramRenderer chaining calls onto queue → run handles empty source guard, lazy module loading, Mermaid initialization, rendering, and scratch element cleanup in finally block.
 */
export function createMermaidRenderer(load: MermaidLoader, doc: Document): DiagramRenderer {
  let api: Promise<MermaidApi> | null = null;
  let queue: Promise<DiagramResult> = Promise.resolve({ ok: true, svg: '' });
  let counter = 0;

  /**
   * Executes a single diagram render operation under sequential queuing.
   *
   * @purpose Renders a diagram with Mermaid, handling lazy loading, theme configuration, and DOM cleanup.
   * @inputs source - Mermaid diagram source syntax string.
   * @inputs theme - Color theme ('light' or 'dark').
   * @outputs Promise<DiagramResult> - DiagramResult containing either the rendered SVG or an error message.
   * @dataflow source & theme → Mermaid API initialization → render call → DOM element cleanup → DiagramResult.
   * @controlflow Check empty source guard → load MermaidApi (clearing cache on failure) → increment counter and generate unique id → initialize Mermaid config → render SVG → catch render errors → clean up scratch DOM elements in finally.
   */
  async function run(source: string, theme: DiagramTheme): Promise<DiagramResult> {
    // Check if diagram source is empty or contains only whitespace.
    if (source.trim() === '') {
      // Return early with an error result without invoking the Mermaid loader.
      return { ok: false, message: 'The diagram is empty.' };
    } else {
      // Diagram source is non-empty; proceed with loading and rendering.
    }

    let mermaid: MermaidApi;
    try {
      // Check if Mermaid API loader promise is cached; initialize if not present.
      api ??= load();
      mermaid = await api;
    } catch (error: unknown) {
      // Reset cached loader promise so subsequent calls can retry loading.
      api = null;
      return { ok: false, message: `Diagrams could not be loaded: ${errorText(error)}` };
    }

    counter += 1;
    const id = `kdoc-mermaid-${counter}`;

    try {
      // Configure Mermaid with strict security and resolved theme.
      // Mermaid keeps global configuration, so initialize must be called on every render.
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        // Select Mermaid theme: use 'dark' for dark mode, or 'default' for light mode.
        theme: theme === 'dark' ? 'dark' : 'default',
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        suppressErrorRendering: true,
      });

      const result = await mermaid.render(id, source);
      return { ok: true, svg: result.svg };
    } catch (error: unknown) {
      // Return formatted error message if Mermaid rendering fails.
      return { ok: false, message: errorText(error) };
    } finally {
      // Clean up temporary scratch elements that Mermaid may leave in the DOM after rendering.
      doc.getElementById(id)?.remove();
      doc.getElementById(`d${id}`)?.remove();
    }
  }

  // Mermaid keeps global configuration and a scratch element per render, so renders must not overlap:
  // each waits for the one before. run never rejects, so the chain never breaks. initialize is called
  // on every render because the theme is global. The leftover-element removal is because Mermaid can
  // leave its temporary `d<id>` container in the body after a failed render.
  return (source: string, theme: DiagramTheme): Promise<DiagramResult> => {
    const next: Promise<DiagramResult> = queue.then(() => run(source, theme));
    queue = next;
    return next;
  };
}

/**
 * Dynamically loads the mermaid library.
 * The dynamic import keeps the ~2 MB library out of the start-up bundle;
 * Vite splits it into its own chunk loaded on the first diagram.
 *
 * @purpose Dynamically imports the mermaid module and returns its default export.
 * @inputs None.
 * @outputs Promise<MermaidApi> - Resolves to the default Mermaid API instance.
 * @dataflow dynamic import('mermaid') → module.default → MermaidApi.
 * @controlflow Await dynamic import of mermaid module → extract and return default export.
 */
const loadMermaid: MermaidLoader = async (): Promise<MermaidApi> => {
  const module = await import('mermaid');
  return module.default;
};

/** Lazily created shared DiagramRenderer instance. */
let shared: DiagramRenderer | null = null;

/**
 * Shared diagram renderer instance that lazily creates the Mermaid renderer on first call.
 *
 * @purpose Renders a Mermaid diagram source string to SVG using the shared lazy-loaded renderer.
 * @inputs source - Mermaid diagram syntax string.
 * @inputs theme - Diagram theme ('light' or 'dark').
 * @outputs Promise<DiagramResult> - Render result with SVG string on success, or error message on failure.
 * @dataflow source & theme → shared DiagramRenderer → DiagramResult.
 * @controlflow Lazily initialize shared renderer with loadMermaid and document → delegate render call to shared renderer.
 */
export const renderMermaid: DiagramRenderer = (
  source: string,
  theme: DiagramTheme,
): Promise<DiagramResult> => {
  // Check if the shared diagram renderer has been initialized.
  if (shared === null) {
    // Create the shared diagram renderer bound to the default Mermaid loader and document.
    shared = createMermaidRenderer(loadMermaid, document);
  } else {
    // Shared renderer already initialized; reuse existing instance.
  }
  return shared(source, theme);
};
