import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { BottomNav } from '../bottom-nav.js';
import { DirectionProvider } from '../direction-provider.js';
import type { ShellNavItem } from '../shell-nav-item.js';

const items: readonly ShellNavItem[] = [
  { id: 'now', label: 'Now', href: '#now', current: true },
  { id: 'sell', label: 'Sell', href: '#sell' },
  { id: 'people', label: 'People', href: '#people', count: '4' },
  { id: 'catalog', label: 'Catalog', href: '#catalog' },
];

function bar(extra?: { id: string; label: string; onPress: () => void }) {
  return (
    <DirectionProvider dir="rtl">
      <BottomNav
        items={items}
        labels={{ label: 'Workspace pages' }}
        {...(extra === undefined ? {} : { extra })}
      />
    </DirectionProvider>
  );
}

it('renders a named 64px landmark with exactly one current entry', () => {
  render(bar());
  const landmark = screen.getByRole('navigation', { name: 'Workspace pages' });
  expect(landmark.className).toContain('h-16');
  const links = Array.from(landmark.querySelectorAll('a'));
  expect(links).toHaveLength(4);
  const current = links.filter((link) => link.getAttribute('aria-current') === 'page');
  expect(current).toHaveLength(1);
  expect(current[0]?.textContent).toContain('Now');
});

it('shows a count only on the entry that carries one', () => {
  render(bar());
  expect(screen.getByText('4')).toBeTruthy();
  const now = screen.getByRole('link', { name: 'Now' });
  expect(now.querySelector('[class*="bg-cta"]')).toBeNull();
});

it('reports the extra entry press to its caller without building any sheet', () => {
  const onPress = vi.fn();
  render(bar({ id: 'more', label: 'More', onPress }));
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('renders no extra control when the caller supplies none', () => {
  render(bar());
  expect(screen.queryByRole('button')).toBeNull();
});
