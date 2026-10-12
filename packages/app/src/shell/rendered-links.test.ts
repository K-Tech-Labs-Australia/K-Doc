// @vitest-environment jsdom
/**
 * @file rendered-links.test.ts
 * @purpose Unit tests for routeRenderedLinks: every link click inside rendered HTML must be
 *          intercepted and handed to the app's own link handler, never followed by the webview.
 * @inputs Synthetic MouseEvent clicks dispatched on jsdom elements.
 * @outputs Vitest assertions on follow() calls and event.defaultPrevented.
 * @functions
 *   - (suite) routeRenderedLinks: happy path, nested targets, empty hrefs, non-links, stop, outside links.
 * @dataflow built DOM + vi.fn follow -> routeRenderedLinks -> dispatched click -> assertions.
 * @controlflow beforeEach builds container; each test dispatches clicks and asserts; afterEach clears body.
 * @version 1
 * @date 2026-10-07
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeRenderedLinks } from './rendered-links.js';

/** Dispatches a bubbling, cancelable click on the target and returns the event. */
function click(target: Element): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('routeRenderedLinks', () => {
  let container: HTMLElement;
  let follow: ReturnType<typeof vi.fn<(href: string) => void>>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    follow = vi.fn<(href: string) => void>();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('follows the href of a clicked link and prevents the default action', () => {
    container.innerHTML = '<a href="https://example.com">site</a>';
    routeRenderedLinks(container, follow);

    const anchor = container.querySelector('a') as HTMLAnchorElement;
    const event = click(anchor);

    expect(follow).toHaveBeenCalledTimes(1);
    expect(follow).toHaveBeenCalledWith('https://example.com');
    expect(event.defaultPrevented).toBe(true);
  });

  it('follows the enclosing link when a nested element is clicked', () => {
    container.innerHTML = '<a href="notes/a.md"><span>label</span></a>';
    routeRenderedLinks(container, follow);

    const span = container.querySelector('span') as HTMLSpanElement;
    const event = click(span);

    expect(follow).toHaveBeenCalledTimes(1);
    expect(follow).toHaveBeenCalledWith('notes/a.md');
    expect(event.defaultPrevented).toBe(true);
  });

  it('prevents default but never follows a link with no href', () => {
    container.innerHTML = '<a>nowhere</a>';
    routeRenderedLinks(container, follow);

    const event = click(container.querySelector('a') as HTMLAnchorElement);

    expect(event.defaultPrevented).toBe(true);
    expect(follow).not.toHaveBeenCalled();
  });

  it('prevents default but never follows a link with an empty href', () => {
    container.innerHTML = '<a href="">empty</a>';
    routeRenderedLinks(container, follow);

    const event = click(container.querySelector('a') as HTMLAnchorElement);

    expect(event.defaultPrevented).toBe(true);
    expect(follow).not.toHaveBeenCalled();
  });

  it('ignores clicks on non-link content and leaves them unprevented', () => {
    container.innerHTML = '<p>plain text</p>';
    routeRenderedLinks(container, follow);

    const event = click(container.querySelector('p') as HTMLParagraphElement);

    expect(follow).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores clicks dispatched directly on the container itself', () => {
    container.innerHTML = '<a href="x.md">x</a>';
    routeRenderedLinks(container, follow);

    const event = click(container);

    expect(follow).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('stops routing after the returned stop function is called', () => {
    container.innerHTML = '<a href="https://example.com">site</a>';
    const stop = routeRenderedLinks(container, follow);
    const anchor = container.querySelector('a') as HTMLAnchorElement;

    stop();
    const event = click(anchor);

    expect(follow).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('allows the stop function to be called twice without throwing', () => {
    const stop = routeRenderedLinks(container, follow);

    stop();
    expect(() => stop()).not.toThrow();
  });

  it('ignores links outside the routed element', () => {
    container.innerHTML = '<p>inside</p>';
    const outside = document.createElement('a');
    outside.setAttribute('href', 'https://outside.example');
    document.body.appendChild(outside);
    routeRenderedLinks(container, follow);

    const event = click(outside);

    expect(follow).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('routes multiple clicks independently', () => {
    container.innerHTML = '<a href="a.md">a</a><a href="b.md">b</a>';
    routeRenderedLinks(container, follow);

    const anchors = container.querySelectorAll('a');
    click(anchors[0] as HTMLAnchorElement);
    click(anchors[1] as HTMLAnchorElement);

    expect(follow).toHaveBeenNthCalledWith(1, 'a.md');
    expect(follow).toHaveBeenNthCalledWith(2, 'b.md');
  });
});
