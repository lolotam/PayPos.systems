import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DirectionProvider } from '../direction-provider.js';
import { NavTabs } from '../nav-tabs.js';
import type { ShellNavItem } from '../shell-nav-item.js';

const items: readonly ShellNavItem[] = [
  { id: 'list', label: 'Services', href: '#services', current: true },
  {
    id: 'cats',
    label: 'Categories with a very long Arabic label that must never widen the row',
    href: '#categories',
    count: '3',
  },
  { id: 'types', label: 'Package types', href: '#types', status: 'Soon' },
];

function tabs(dir: 'rtl' | 'ltr', props: { onNavigate?: (item: ShellNavItem) => void } = {}) {
  return (
    <DirectionProvider dir={dir}>
      <NavTabs items={items} labels={{ label: 'Catalog pages' }} {...props} />
    </DirectionProvider>
  );
}

it('renders a named navigation landmark with exactly one current page', () => {
  render(tabs('rtl'));
  const landmark = screen.getByRole('navigation', { name: 'Catalog pages' });
  const links = withinLinks(landmark);
  expect(links).toHaveLength(3);
  expect(
    links
      .filter((link) => link.getAttribute('aria-current') === 'page')
      .map((link) => link.textContent),
  ).toEqual([expect.stringContaining('Services')]);
});

it('shows the count beside its item and nothing when it is missing', () => {
  render(tabs('ltr'));
  expect(screen.getByText('3')).toBeTruthy();
  const services = screen.getByRole('link', { name: /Services/ });
  expect(services.querySelector('[class*="bg-cta"]')).toBeNull();
});

it('carries the supplied text mark on a Soon item', () => {
  render(tabs('ltr'));
  expect(screen.getByText('Soon')).toBeTruthy();
});

it('cuts a long label with an ellipsis and keeps the row scrolling inside itself', () => {
  render(tabs('ltr'));
  const landmark = screen.getByRole('navigation', { name: 'Catalog pages' });
  const row = landmark.firstElementChild as HTMLElement;
  expect(row.className).toContain('overflow-x-auto');
  const longLabel = screen.getByText(/very long Arabic label/);
  expect(longLabel.className).toContain('truncate');
});

it('gives every link target the 44px minimum in both directions while its label stays shrinkable', () => {
  // min-w-11 مع min-h-11: هدف لمس كامل ولو كان النص قصيرًا، والقصّ على الشارة الداخلية
  render(tabs('ltr'));
  const landmark = screen.getByRole('navigation', { name: 'Catalog pages' });
  const links = Array.from(landmark.querySelectorAll('a'));
  expect(links.length).toBeGreaterThan(0);
  links.forEach((link) => {
    expect(link.className).toContain('min-h-11');
    expect(link.className).toContain('min-w-11');
    expect(link.className).toContain('max-w-full');
    const label = link.querySelector('span');
    expect(label?.className).toContain('min-w-0');
    expect(label?.className).toContain('truncate');
  });
});

it.each(['rtl', 'ltr'] as const)('marks the current page in %s', (dir) => {
  render(tabs(dir));
  const landmark = screen.getByRole('navigation', { name: 'Catalog pages' });
  const current = withinLinks(landmark).find(
    (link) => link.getAttribute('aria-current') === 'page',
  );
  expect(current?.getAttribute('href')).toBe('#services');
});

it('reports the choice to the caller while the link keeps its own destination', () => {
  const onNavigate = vi.fn();
  render(tabs('ltr', { onNavigate }));
  fireEvent.click(screen.getByRole('link', { name: /Package types/ }));
  expect(onNavigate).toHaveBeenCalledWith(items[2]);
  expect(screen.getByRole('link', { name: /Package types/ }).getAttribute('href')).toBe('#types');
});

function withinLinks(region: HTMLElement) {
  return Array.from(region.querySelectorAll('a'));
}
