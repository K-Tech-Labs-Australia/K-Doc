// @vitest-environment jsdom
/**
 * @file link-hover-card.spec.ts
 * @purpose Tests the link hover card's delay, content, follow button and dismissal (FR-8.13).
 * @version 1
 * @date 2026-09-13
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { installLinkHoverCard, HOVER_DELAY_MS, HIDE_GRACE_MS, LINK_HOVER_CARD_STYLES } from '../src/shell/link-hover-card.js';
import type { LinkCardContent, LinkHoverCard } from '../src/shell/link-hover-card.js';

interface Harness {
  readonly card: LinkHoverCard;
  readonly pane: HTMLElement;
  readonly link: HTMLAnchorElement;
  readonly plain: HTMLSpanElement;
  readonly followed: string[];
  readonly described: string[];
}

const cards: LinkHoverCard[] = [];

beforeEach((): void => { vi.useFakeTimers(); });
afterEach((): void => {
  for (const c of cards) { c.destroy(); }
  cards.length = 0;
  document.body.replaceChildren();
  vi.useRealTimers();
});

function mount(content?: Partial<LinkCardContent>): Harness {
  const pane = document.createElement('div');
  const link = document.createElement('a');
  link.setAttribute('href', 'https://example.com/page');
  link.textContent = 'a link';
  const plain = document.createElement('span');
  plain.textContent = 'plain text';
  pane.append(link, plain);
  document.body.appendChild(pane);
  const followed: string[] = [];
  const described: string[] = [];
  const card = installLinkHoverCard({
    doc: document,
    win: window,
    pane,
    describe: (href: string): LinkCardContent => {
      described.push(href);
      return { title: 'example.com', detail: href, followable: true, ...content };
    },
    follow: (href: string): void => { followed.push(href); },
  });
  cards.push(card);
  return { card, pane, link, plain, followed, described };
}

function root(): HTMLElement {
  const el = document.querySelector('.kdoc-link-card');
  if (!(el instanceof HTMLElement)) { throw new Error('no card root'); }
  return el;
}
function hover(el: Element): void { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); }
function leave(el: Element, to: Element | null): void { el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: to })); }

describe('link-hover-card', (): void => {
  it('does not show before the delay', (): void => {
    const h = mount();
    hover(h.link);
    vi.advanceTimersByTime(HOVER_DELAY_MS - 1);
    expect(h.card.isOpen).toBe(false);
    vi.advanceTimersByTime(1);
    expect(h.card.isOpen).toBe(true);
  });

  it('shows the described content', (): void => {
    const h = mount();
    hover(h.link);
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    const card = root();
    expect(card.querySelector('.kdoc-link-card-title')?.textContent).toBe('example.com');
    expect(card.querySelector('.kdoc-link-card-detail')?.textContent).toBe('https://example.com/page');
    expect(h.described).toEqual(['https://example.com/page']);
  });

  it('never opens on non-link text', (): void => {
    const h = mount();
    hover(h.plain);
    vi.advanceTimersByTime(HOVER_DELAY_MS * 2);
    expect(h.card.isOpen).toBe(false);
    expect(h.described).toEqual([]);
  });

  it('cancels when leaving before the delay', (): void => {
    const h = mount();
    hover(h.link);
    vi.advanceTimersByTime(HOVER_DELAY_MS / 2);
    leave(h.link, h.plain);
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    expect(h.card.isOpen).toBe(false);
    expect(h.described).toEqual([]);
  });

  it('hides only after the grace period', (): void => {
    const h = mount();
    hover(h.link);
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    leave(h.link, h.plain);
    vi.advanceTimersByTime(HIDE_GRACE_MS - 1);
    expect(h.card.isOpen).toBe(true);
    vi.advanceTimersByTime(1);
    expect(h.card.isOpen).toBe(false);
  });

  it('stays open when moving onto the card', (): void => {
    const h = mount();
    hover(h.link);
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    leave(h.link, root());
    vi.advanceTimersByTime(HIDE_GRACE_MS * 2);
    expect(h.card.isOpen).toBe(true);
  });

  it('follows and closes on open click', (): void => {
    const h = mount();
    hover(h.link);
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    root().querySelector('.kdoc-link-card-open')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(h.followed).toEqual(['https://example.com/page']);
    expect(h.card.isOpen).toBe(false);
  });

  it('hides the actions row when not followable', (): void => {
    const h = mount({ followable: false });
    hover(h.link);
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    expect(root().querySelector<HTMLElement>('.kdoc-link-card-actions')?.hidden).toBe(true);
  });

  it('closes on Escape', (): void => {
    const h = mount();
    hover(h.link);
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(h.card.isOpen).toBe(false);
  });

  it('closes on scroll', (): void => {
    const h = mount();
    hover(h.link);
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    h.pane.dispatchEvent(new Event('scroll'));
    expect(h.card.isOpen).toBe(false);
  });

  it('destroy removes the card and is idempotent', (): void => {
    const h = mount();
    hover(h.link);
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    expect(root()).toBeTruthy();
    h.card.destroy();
    h.card.destroy();
    expect(document.querySelector('.kdoc-link-card')).toBeNull();
    hover(h.link);
    vi.advanceTimersByTime(HOVER_DELAY_MS);
  });

  it('includes the card selector in its styles', (): void => {
    expect(LINK_HOVER_CARD_STYLES).toContain('.kdoc-link-card');
  });
});
