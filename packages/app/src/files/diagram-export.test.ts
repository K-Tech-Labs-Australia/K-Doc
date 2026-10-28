/**
 * @file diagram-export.test.ts
 * @purpose Unit test suite for Mermaid diagram export drawing and document AST transformation in @k-doc/app.
 * @inputs Markdown documents parsed via @k-doc/core parseMarkdown and mock DiagramRenderer instances.
 * @outputs Vitest test assertions verifying diagram rendering, light theme enforcement, AST image replacement, failure retention, deduplication, and document immutability.
 * @functions None (test suite file executing describe and it blocks).
 * @dataflow Markdown source strings → parseMarkdown → KdocDocument → drawDiagrams with DiagramRenderer mock → DrawnDiagrams result → Vitest assertions.
 * @controlflow Test suite executes describe blocks for drawDiagrams, evaluating happy paths, error paths, mixed batches, deduplicated diagrams, front matter preservation, and passthrough behavior.
 * @version 1
 * @date 2026-10-28
 */

import { describe, expect, it, vi } from 'vitest';
import { parseMarkdown, type KdocDocument } from '@k-doc/core';
import { svgToDataUri, type DiagramRenderer } from '@k-doc/editor';
import { drawDiagrams, type DrawnDiagrams } from './diagram-export.js';

describe('drawDiagrams', () => {
  it('returns the identical document object and 0 failed when the document has no diagrams', async () => {
    const input: KdocDocument = parseMarkdown('# Title\n\nText\n');
    const render = vi.fn<DiagramRenderer>();

    const result: DrawnDiagrams = await drawDiagrams(input, render);

    // Check that the returned document is the exact same object reference as the input.
    expect(result.document).toBe(input);
    // Check that failed count is 0.
    expect(result.failed).toBe(0);
    // Ensure the renderer mock was never invoked.
    expect(render).not.toHaveBeenCalled();
  });

  it('draws a single diagram with light theme, replaces code with image paragraph, and preserves original input and text', async () => {
    const markdown = '```mermaid\ngraph TD; A-->B\n```\n';
    const input: KdocDocument = parseMarkdown(markdown);
    const render = vi.fn<DiagramRenderer>().mockResolvedValue({
      ok: true,
      svg: '<svg/>',
    });

    const result: DrawnDiagrams = await drawDiagrams(input, render);

    // Verify render was called exactly once with diagram source and light theme.
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith('graph TD; A-->B', 'light');

    // Verify returned document is a new object reference, not the input document.
    expect(result.document).not.toBe(input);

    // Verify returned root first child is a paragraph whose first child is an image with data URI.
    const returnedFirstChild = result.document.root.children[0];
    expect(returnedFirstChild?.type).toBe('paragraph');

    // Check if the first child is a paragraph node.
    if (returnedFirstChild && returnedFirstChild.type === 'paragraph') {
      const imageChild = returnedFirstChild.children[0];
      expect(imageChild?.type).toBe('image');
      // Check if image child is an image node.
      if (imageChild && imageChild.type === 'image') {
        expect(imageChild.url).toBe(svgToDataUri('<svg/>'));
        expect(imageChild.alt).toBe('Mermaid diagram');
      } else {
        expect.unreachable('Expected child node to be of type image');
      }
    } else {
      expect.unreachable('Expected first child node to be of type paragraph');
    }

    // Verify failure count is 0.
    expect(result.failed).toBe(0);

    // Verify document text is preserved untouched.
    expect(result.document.text).toBe(input.text);

    // Verify input root was not mutated: its first child is still a code node.
    expect(input.root.children[0]?.type).toBe('code');
  });

  it('retains source code block and increments failed counter when rendering fails', async () => {
    const markdown = '```mermaid\ngraph TD; A-->B\n```\n';
    const input: KdocDocument = parseMarkdown(markdown);
    const render = vi.fn<DiagramRenderer>().mockResolvedValue({
      ok: false,
      message: 'bad',
    });

    const result: DrawnDiagrams = await drawDiagrams(input, render);

    // Verify render was invoked with light theme.
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith('graph TD; A-->B', 'light');

    // Verify failed count is 1.
    expect(result.failed).toBe(1);

    // Verify first child remains a code block when diagram rendering fails.
    const returnedFirstChild = result.document.root.children[0];
    expect(returnedFirstChild?.type).toBe('code');

    // Check if the first child is a code node.
    if (returnedFirstChild && returnedFirstChild.type === 'code') {
      expect(returnedFirstChild.lang).toBe('mermaid');
      expect(returnedFirstChild.value).toBe('graph TD; A-->B');
    } else {
      expect.unreachable('Expected child node to be of type code');
    }

    // Verify document text is preserved.
    expect(result.document.text).toBe(input.text);
  });

  it('handles multiple diagrams with mixed outcomes: replacing successful ones and retaining failed ones', async () => {
    const markdown = '```mermaid\ngraph TD; A-->B\n```\n\n```mermaid\ngraph LR; C-->D\n```\n';
    const input: KdocDocument = parseMarkdown(markdown);
    const render = vi
      .fn<DiagramRenderer>()
      .mockResolvedValueOnce({ ok: true, svg: '<svg id="ok"/>' })
      .mockResolvedValueOnce({ ok: false, message: 'bad' });

    const result: DrawnDiagrams = await drawDiagrams(input, render);

    // Verify render was called twice in sequence with light theme.
    expect(render).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenNthCalledWith(1, 'graph TD; A-->B', 'light');
    expect(render).toHaveBeenNthCalledWith(2, 'graph LR; C-->D', 'light');

    // Verify failure count is 1.
    expect(result.failed).toBe(1);

    const children = result.document.root.children;
    // Verify first child is replaced with an image paragraph.
    const firstChild = children[0];
    expect(firstChild?.type).toBe('paragraph');

    // Check if first child is a paragraph node.
    if (firstChild && firstChild.type === 'paragraph') {
      const imageChild = firstChild.children[0];
      expect(imageChild?.type).toBe('image');
      // Check if image child is an image node.
      if (imageChild && imageChild.type === 'image') {
        expect(imageChild.url).toBe(svgToDataUri('<svg id="ok"/>'));
      } else {
        expect.unreachable('Expected child of first paragraph to be an image');
      }
    } else {
      expect.unreachable('Expected first child of document root to be a paragraph');
    }

    // Verify last block remains a code block.
    const lastChild = children[children.length - 1];
    expect(lastChild?.type).toBe('code');

    // Check if last child is a code node.
    if (lastChild && lastChild.type === 'code') {
      expect(lastChild.lang).toBe('mermaid');
      expect(lastChild.value).toBe('graph LR; C-->D');
    } else {
      expect.unreachable('Expected last child of document root to be a code block');
    }

    // Verify original input was not mutated.
    expect(input.root.children[0]?.type).toBe('code');
    expect(input.root.children[input.root.children.length - 1]?.type).toBe('code');
  });

  it('draws duplicate diagram source once and replaces both AST occurrences', async () => {
    const markdown = '```mermaid\ngraph TD; A-->B\n```\n\n```mermaid\ngraph TD; A-->B\n```\n';
    const input: KdocDocument = parseMarkdown(markdown);
    const render = vi.fn<DiagramRenderer>().mockResolvedValue({
      ok: true,
      svg: '<svg id="shared"/>',
    });

    const result: DrawnDiagrams = await drawDiagrams(input, render);

    // Verify render was invoked only once for deduplicated diagram source.
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith('graph TD; A-->B', 'light');

    // Verify failure count is 0.
    expect(result.failed).toBe(0);

    const children = result.document.root.children;
    const firstChild = children[0];
    const secondChild = children[1];

    // Verify first occurrence was replaced with image paragraph.
    expect(firstChild?.type).toBe('paragraph');
    // Check if first child is a paragraph node.
    if (firstChild && firstChild.type === 'paragraph') {
      const image = firstChild.children[0];
      expect(image?.type).toBe('image');
      // Check if image child is an image node.
      if (image && image.type === 'image') {
        expect(image.url).toBe(svgToDataUri('<svg id="shared"/>'));
      } else {
        expect.unreachable('Expected first child image to exist');
      }
    } else {
      expect.unreachable('Expected first child to be a paragraph');
    }

    // Verify second occurrence was also replaced with image paragraph.
    expect(secondChild?.type).toBe('paragraph');
    // Check if second child is a paragraph node.
    if (secondChild && secondChild.type === 'paragraph') {
      const image = secondChild.children[0];
      expect(image?.type).toBe('image');
      // Check if image child is an image node.
      if (image && image.type === 'image') {
        expect(image.url).toBe(svgToDataUri('<svg id="shared"/>'));
      } else {
        expect.unreachable('Expected second child image to exist');
      }
    } else {
      expect.unreachable('Expected second child to be a paragraph');
    }

    // Verify original input children remain code blocks.
    expect(input.root.children[0]?.type).toBe('code');
    expect(input.root.children[1]?.type).toBe('code');
  });

  it('preserves YAML front matter and text untouched when diagrams are present', async () => {
    const markdown = '---\ntitle: Document Title\nauthor: Test Author\n---\n\n```mermaid\ngraph TD; X-->Y\n```\n';
    const input: KdocDocument = parseMarkdown(markdown);
    const render = vi.fn<DiagramRenderer>().mockResolvedValue({
      ok: true,
      svg: '<svg id="fm-test"/>',
    });

    const result: DrawnDiagrams = await drawDiagrams(input, render);

    // Verify front matter is carried over untouched by identity.
    expect(result.document.frontMatter).toBe(input.frontMatter);
    // Check if front matter exists before inspecting properties.
    if (result.document.frontMatter !== null) {
      expect(result.document.frontMatter.data['title']).toBe('Document Title');
    } else {
      expect.unreachable('Expected front matter to be present');
    }

    // Verify text is carried over untouched.
    expect(result.document.text).toBe(input.text);

    // Verify diagram was rendered.
    expect(render).toHaveBeenCalledTimes(1);
    expect(result.failed).toBe(0);
  });

  it('leaves non-mermaid code blocks untouched and does not call renderer', async () => {
    const markdown = '```typescript\nconst message: string = "hello";\n```\n\n```python\nprint("world")\n```\n';
    const input: KdocDocument = parseMarkdown(markdown);
    const render = vi.fn<DiagramRenderer>();

    const result: DrawnDiagrams = await drawDiagrams(input, render);

    // Returns exact same document object when no mermaid blocks exist.
    expect(result.document).toBe(input);
    expect(result.failed).toBe(0);
    expect(render).not.toHaveBeenCalled();
  });

  it('renders diagrams nested inside blockquotes', async () => {
    const markdown = '> ```mermaid\n> graph LR; Alpha-->Beta\n> ```\n';
    const input: KdocDocument = parseMarkdown(markdown);
    const render = vi.fn<DiagramRenderer>().mockResolvedValue({
      ok: true,
      svg: '<svg id="nested"/>',
    });

    const result: DrawnDiagrams = await drawDiagrams(input, render);

    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith('graph LR; Alpha-->Beta', 'light');
    expect(result.failed).toBe(0);

    const blockquote = result.document.root.children[0];
    expect(blockquote?.type).toBe('blockquote');

    // Check if node is a blockquote.
    if (blockquote && blockquote.type === 'blockquote') {
      const paragraph = blockquote.children[0];
      expect(paragraph?.type).toBe('paragraph');
      // Check if nested child is a paragraph node.
      if (paragraph && paragraph.type === 'paragraph') {
        const image = paragraph.children[0];
        expect(image?.type).toBe('image');
        // Check if image child is an image node.
        if (image && image.type === 'image') {
          expect(image.url).toBe(svgToDataUri('<svg id="nested"/>'));
        } else {
          expect.unreachable('Expected nested paragraph child to be an image');
        }
      } else {
        expect.unreachable('Expected blockquote child to be a paragraph');
      }
    } else {
      expect.unreachable('Expected first child to be a blockquote');
    }
  });

  it('increments failed counter for each failing diagram when all renders fail', async () => {
    const markdown = '```mermaid\ngraph TD; 1-->2\n```\n\n```mermaid\ngraph LR; 3-->4\n```\n';
    const input: KdocDocument = parseMarkdown(markdown);
    const render = vi.fn<DiagramRenderer>().mockResolvedValue({
      ok: false,
      message: 'syntax error',
    });

    const result: DrawnDiagrams = await drawDiagrams(input, render);

    expect(render).toHaveBeenCalledTimes(2);
    expect(result.failed).toBe(2);

    const children = result.document.root.children;
    expect(children[0]?.type).toBe('code');
    expect(children[1]?.type).toBe('code');
    expect(result.document.text).toBe(input.text);
  });

  it('returns identical document and 0 failed for an empty markdown document', async () => {
    const input: KdocDocument = parseMarkdown('');
    const render = vi.fn<DiagramRenderer>();

    const result: DrawnDiagrams = await drawDiagrams(input, render);

    expect(result.document).toBe(input);
    expect(result.failed).toBe(0);
    expect(render).not.toHaveBeenCalled();
  });
});
