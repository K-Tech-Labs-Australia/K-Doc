/**
 * @file sanitize.test.ts
 * @purpose Unit tests for the K-Doc HTML sanitizer allow-list (sanitize.ts): embed-frame source
 *          checks, inline-style filtering, the rehype-sanitize schema, the iframe/style hardening
 *          plugin and style-content escaping.
 * @inputs Raw HTML fragments parsed by rehype-parse; string inputs for the pure helper functions.
 * @outputs Vitest assertions over sanitized HTML strings and helper return values.
 * @functions
 *   - render: Test helper that runs an HTML fragment through parse, sanitize, harden and stringify.
 *   - (test suites): isEmbedFrameSource, filterStyle, escapeStyleContent, constants, pipeline behaviour.
 * @dataflow HTML fragment -> rehype-parse -> rehype-sanitize(KDOC_SANITIZE_SCHEMA) -> rehypeKdocHardening
 *           -> rehype-stringify -> HTML string -> assertions.
 * @controlflow Declarative vitest describe/it blocks executed independently; no shared mutable state.
 * @version 1
 * @date 2026-10-07
 */

import { describe, expect, it } from 'vitest';
import rehypeParse from 'rehype-parse';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';
import {
  ALLOWED_STYLE_PROPERTIES,
  EMBED_FRAME_PATTERNS,
  KDOC_SANITIZE_SCHEMA,
  escapeStyleContent,
  filterStyle,
  isEmbedFrameSource,
  rehypeKdocHardening,
} from './sanitize.js';

/**
 * @purpose Run an HTML fragment through the same sanitize + hardening stages html.ts uses.
 * @inputs html - raw HTML fragment string.
 * @outputs string - sanitized, serialized HTML.
 * @dataflow html -> parse (fragment) -> sanitize -> harden -> stringify -> string.
 * @controlflow Linear; no branching.
 */
function render(html: string): string {
  return unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypeSanitize, KDOC_SANITIZE_SCHEMA)
    .use(rehypeKdocHardening)
    .use(rehypeStringify)
    .processSync(html)
    .toString();
}

describe('EMBED_FRAME_PATTERNS / ALLOWED_STYLE_PROPERTIES constants', () => {
  it('exposes exactly two frozen embed patterns', () => {
    expect(EMBED_FRAME_PATTERNS).toHaveLength(2);
    expect(Object.isFrozen(EMBED_FRAME_PATTERNS)).toBe(true);
  });

  it('contains the expected style properties and excludes dangerous ones', () => {
    expect(ALLOWED_STYLE_PROPERTIES.has('text-align')).toBe(true);
    expect(ALLOWED_STYLE_PROPERTIES.has('letter-spacing')).toBe(true);
    expect(ALLOWED_STYLE_PROPERTIES.has('position')).toBe(false);
    expect(ALLOWED_STYLE_PROPERTIES.has('background')).toBe(false);
  });
});

describe('isEmbedFrameSource', () => {
  it('accepts a youtube-nocookie embed url', () => {
    expect(isEmbedFrameSource('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toBe(true);
  });

  it('accepts a vimeo player url', () => {
    expect(isEmbedFrameSource('https://player.vimeo.com/video/123456')).toBe(true);
  });

  it('rejects a youtube url with injected markup', () => {
    expect(isEmbedFrameSource('https://www.youtube-nocookie.com/embed/x"><script>')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isEmbedFrameSource(42)).toBe(false);
    expect(isEmbedFrameSource(undefined)).toBe(false);
    expect(isEmbedFrameSource(null)).toBe(false);
  });

  it('rejects a vimeo url whose id contains letters', () => {
    expect(isEmbedFrameSource('https://player.vimeo.com/video/12ab')).toBe(false);
  });

  it('rejects an arbitrary https host and plain http', () => {
    expect(isEmbedFrameSource('https://evil.example/x')).toBe(false);
    expect(isEmbedFrameSource('http://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toBe(false);
  });
});

describe('filterStyle', () => {
  it('keeps an allowed declaration', () => {
    expect(filterStyle('text-align: center')).toBe('text-align: center');
  });

  it('drops disallowed properties and keeps allowed ones', () => {
    expect(filterStyle('position:fixed; color:red')).toBe('color: red');
  });

  it('drops declarations containing url()', () => {
    expect(filterStyle('background-color: url(x)')).toBe('');
  });

  it('normalises property case, trims and ignores empty parts', () => {
    expect(filterStyle('COLOR : Blue ;;')).toBe('color: Blue');
  });

  it('returns an empty string for empty input', () => {
    expect(filterStyle('')).toBe('');
  });

  it('drops expression(), javascript: and forbidden characters', () => {
    expect(filterStyle('width: expression(alert(1))')).toBe('');
    expect(filterStyle('color: javascript:x')).toBe('');
    expect(filterStyle('color: a\\62')).toBe('');
    expect(filterStyle('color: <red>')).toBe('');
    expect(filterStyle('color: @import')).toBe('');
  });

  it('skips parts with no colon, a leading colon, or an empty value', () => {
    expect(filterStyle('color')).toBe('');
    expect(filterStyle(': red')).toBe('');
    expect(filterStyle('color:   ')).toBe('');
  });

  it('joins multiple kept declarations with "; "', () => {
    expect(filterStyle('color: red; width: 10px')).toBe('color: red; width: 10px');
  });
});

describe('escapeStyleContent', () => {
  it('neutralises a closing style tag in any case', () => {
    const out = escapeStyleContent('a{}</STYLE><script>');
    expect(out).toBe('a{}<\\/STYLE><script>');
    expect(out).toContain('<\\/STYLE');
    expect(out).not.toContain('</STYLE');
  });

  it('leaves css without closing style tags unchanged', () => {
    expect(escapeStyleContent('a{color:red}')).toBe('a{color:red}');
  });
});

describe('KDOC_SANITIZE_SCHEMA through the pipeline', () => {
  it('removes onerror from img but keeps src', () => {
    const out = render('<img src=x onerror="alert(1)">');
    expect(out).toContain('<img src="x">');
    expect(out).not.toContain('onerror');
  });

  it('strips script elements with their content', () => {
    expect(render('<script>alert(1)</script><p>ok</p>')).toBe('<p>ok</p>');
  });

  it('removes javascript: hrefs', () => {
    const out = render('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript');
    expect(out).toContain('<a>x</a>');
  });

  it('removes vbscript: and data: hrefs', () => {
    expect(render('<a href="vbscript:x">x</a>')).not.toContain('href');
    expect(render('<a href="data:text/html,x">x</a>')).not.toContain('href');
  });

  it.each([
    '<a href="https://example.com">x</a>',
    '<a href="mailto:a@b.c">x</a>',
    '<a href="notes/a.md">x</a>',
    '<a href="#sec">x</a>',
    '<a href="C:/notes/a.md">x</a>',
  ])('keeps the href verbatim for %s', (html) => {
    expect(render(html)).toBe(html);
  });

  it('drops an iframe with a foreign source entirely', () => {
    expect(render('<iframe src="https://evil.example/x"></iframe>')).toBe('');
  });

  it('drops an iframe that only has srcdoc', () => {
    expect(render('<iframe srcdoc="<script>x</script>"></iframe>')).toBe('');
  });

  it('keeps a youtube-nocookie iframe and adds sandbox', () => {
    const out = render('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>');
    expect(out).toContain('<iframe');
    expect(out).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(out).toContain('sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"');
    expect(out).toContain('referrerpolicy="strict-origin-when-cross-origin"');
  });

  it('keeps a vimeo iframe', () => {
    const out = render('<iframe src="https://player.vimeo.com/video/123456"></iframe>');
    expect(out).toContain('<iframe');
    expect(out).toContain('src="https://player.vimeo.com/video/123456"');
  });

  it('removes object, embed, form, input, base and meta elements', () => {
    const out = render(
      '<object data="x"></object><embed src="x"><form action="x"><input type="text"></form>' +
        '<base href="https://e.example"><meta http-equiv="refresh" content="0">',
    );
    expect(out).not.toContain('object');
    expect(out).not.toContain('embed');
    expect(out).not.toContain('form');
    expect(out).not.toContain('base');
    expect(out).not.toContain('meta');
    expect(out).not.toContain('type="text"');
  });

  it('strips style elements with their contents', () => {
    expect(render('<style>body{display:none}</style><p>a</p>')).toBe('<p>a</p>');
  });

  it('keeps align and class, filters the style attribute', () => {
    const out = render(
      '<div align="center" class="note" style="text-align: center; position: fixed">x</div>',
    );
    expect(out).toContain('align="center"');
    expect(out).toContain('class="note"');
    expect(out).toContain('style="text-align: center"');
    expect(out).not.toContain('position');
  });

  it('removes a style attribute whose declarations are all disallowed', () => {
    expect(render('<p style="background:url(https://e.example/t.png)">x</p>')).toBe('<p>x</p>');
  });

  it('keeps data: image src and width', () => {
    const out = render('<img src="data:image/png;base64,AAAA" width="300">');
    expect(out).toContain('src="data:image/png;base64,AAAA"');
    expect(out).toContain('width="300"');
  });

  it('keeps a local drive-letter img src', () => {
    expect(render('<img src="C:/pics/a.png">')).toContain('src="C:/pics/a.png"');
  });

  it('keeps both classes on a math code element', () => {
    const out = render('<code class="language-math math-inline">x</code>');
    expect(out).toContain('language-math');
    expect(out).toContain('math-inline');
  });

  it('keeps footnote ids unprefixed and data-footnote-ref', () => {
    const out = render(
      '<sup><a href="#user-content-fn-1" id="user-content-fnref-1" data-footnote-ref>1</a></sup>',
    );
    expect(out).toContain('id="user-content-fnref-1"');
    expect(out).not.toContain('user-content-user-content');
    expect(out).toContain('data-footnote-ref');
  });

  it('keeps heading ids unchanged', () => {
    expect(render('<h2 id="intro">Intro</h2>')).toContain('id="intro"');
  });

  it('keeps video with src and controls', () => {
    const out = render('<video src="clip.mp4" controls></video>');
    expect(out).toContain('<video');
    expect(out).toContain('src="clip.mp4"');
    expect(out).toContain('controls');
  });

  it('keeps audio with src and controls', () => {
    const out = render('<audio src="a.mp3" controls></audio>');
    expect(out).toContain('<audio');
    expect(out).toContain('src="a.mp3"');
    expect(out).toContain('controls');
  });

  it('removes svg and the script inside it', () => {
    const out = render('<svg><script>alert(1)</script></svg>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('svg');
  });

  it('keeps mark, class-bearing span, u and details/summary', () => {
    const out = render(
      '<mark class="kdoc-x">m</mark> <span class="kdoc-margin-note">n</span> <u>u</u> ' +
        '<details><summary>s</summary>d</details>',
    );
    expect(out).toContain('<mark class="kdoc-x">m</mark>');
    expect(out).toContain('<span class="kdoc-margin-note">n</span>');
    expect(out).toContain('<u>u</u>');
    expect(out).toContain('<details><summary>s</summary>d</details>');
  });
});

describe('rehypeKdocHardening nested handling', () => {
  it('drops a disallowed iframe nested inside other elements', () => {
    const out = render('<div><p>a<iframe src="https://evil.example/x"></iframe></p></div>');
    expect(out).toBe('<div><p>a</p></div>');
  });
});
