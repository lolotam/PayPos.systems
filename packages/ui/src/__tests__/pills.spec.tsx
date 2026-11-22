import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DirectionProvider } from '../direction-provider.js';
import { Pills } from '../pills.js';
import type { ShellNavItem } from '../shell-nav-item.js';

const items: readonly ShellNavItem[] = [
  { id: 'list', label: 'Employees', href: '#list', current: true, count: '12' },
  { id: 'numbers', label: 'Numbers', href: '#numbers' },
  { id: 'import', label: 'Import', href: '#import', status: 'Soon' },
];

it('renders a named pill strip whose current pill is highlighted and single', () => {
  render(
    <DirectionProvider dir="rtl">
      <Pills items={items} labels={{ label: 'Employees sub pages' }} />
    </DirectionProvider>,
  );
  const landmark = screen.getByRole('navigation', { name: 'Employees sub pages' });
  const links = Array.from(landmark.querySelectorAll('a'));
  expect(links).toHaveLength(3);
  const current = links.filter((link) => link.getAttribute('aria-current') === 'page');
  expect(current).toHaveLength(1);
  expect(current[0]?.className).toContain('bg-primary');
  expect(current[0]?.textContent).toContain('Employees');
  // الحبوب تلتف على سطور وكل هدف 44px على الأقل
  expect(landmark.firstElementChild?.className).toContain('flex-wrap');
  expect(links.every((link) => link.className.includes('min-h-11'))).toBe(true);
});

it('shows a count beside its item and omits the chip when it is missing', () => {
  render(
    <DirectionProvider dir="ltr">
      <Pills items={items} labels={{ label: 'Strip' }} />
    </DirectionProvider>,
  );
  expect(screen.getByText('12')).toBeTruthy();
  const numbers = screen.getByRole('link', { name: 'Numbers' });
  expect(numbers.querySelector('[class*="bg-cta"]')).toBeNull();
});

it('carries the text mark of a Soon pill', () => {
  render(
    <DirectionProvider dir="ltr">
      <Pills items={items} labels={{ label: 'Strip' }} />
    </DirectionProvider>,
  );
  expect(screen.getByText('Soon')).toBeTruthy();
});

it('reports the pressed pill to the caller without changing its destination', () => {
  const onNavigate = vi.fn();
  render(
    <DirectionProvider dir="ltr">
      <Pills items={items} labels={{ label: 'Strip' }} onNavigate={onNavigate} />
    </DirectionProvider>,
  );
  fireEvent.click(screen.getByRole('link', { name: /Import/ }));
  expect(onNavigate).toHaveBeenCalledWith(items[2]);
  expect(screen.getByRole('link', { name: /Import/ }).getAttribute('href')).toBe('#import');
});
