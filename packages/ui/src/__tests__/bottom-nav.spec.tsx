import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';
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

// المستدعي هو صاحب الورقة: الشريط يبلّغ بالضغطة فقط، والمستخدم يشوف ما يفتحه المستدعي
function BarWithCallerSheet() {
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <>
      {bar({ id: 'more', label: 'More', onPress: () => setSheetOpen(true) })}
      {sheetOpen ? <p>All pages</p> : null}
    </>
  );
}

it('reports the extra entry press to its caller, which opens its own sheet', () => {
  render(<BarWithCallerSheet />);
  expect(screen.queryByText('All pages')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.getByText('All pages')).toBeTruthy();
});

it('renders no extra control when the caller supplies none', () => {
  render(bar());
  expect(screen.queryByRole('button')).toBeNull();
});

it('carries the supplied Soon mark on its entry', () => {
  render(
    <DirectionProvider dir="rtl">
      <BottomNav
        items={[...items, { id: 'reports', label: 'Reports', href: '#reports', status: 'Soon' }]}
        labels={{ label: 'Workspace pages' }}
      />
    </DirectionProvider>,
  );
  expect(screen.getByText('Soon')).toBeTruthy();
});

it('places the status mark in flow below the truncated label without overlapping icon space', () => {
  // العلامة في التدفق أسفل الاسم بحجز مساحة محكمة تحافظ على ارتفاع الشريط 64px وقص الاسم الطويل
  render(
    <DirectionProvider dir="rtl">
      <BottomNav
        items={[
          {
            id: 'reports',
            label: 'Reports',
            href: '#reports',
            icon: <span data-testid="nav-icon" aria-hidden="true" />,
            status: 'Soon — under development for now',
          },
        ]}
        labels={{ label: 'Workspace pages' }}
      />
    </DirectionProvider>,
  );
  const link = screen.getByRole('link', { name: /Reports/ });
  const label = screen.getByText('Reports');
  const badge = screen.getByText('Soon — under development for now');
  const iconSlot = screen.getByTestId('nav-icon').parentElement as HTMLElement;

  expect(link.className).toContain('gap-0.5');
  expect(link.className).toContain('py-0.5');
  expect(iconSlot.className).toContain('h-5');
  expect(iconSlot.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(label.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(label.className).toContain('truncate');
  expect(label.className).toContain('max-w-full');
  expect(badge.className).not.toContain('absolute');
  expect(badge.className).toContain('truncate');
  expect(badge.className).toContain('max-w-full');
});

it('shows both count and status when a caller supplies both', () => {
  // إذا زوّد المستدعي العدّاد والعلامة معًا يُعرض الاثنان ويظهران في الاسم المتاح للرابط
  render(
    <DirectionProvider dir="rtl">
      <BottomNav
        items={[
          {
            id: 'reports',
            label: 'Reports',
            href: '#reports',
            status: 'Soon',
            count: '3',
          },
        ]}
        labels={{ label: 'Workspace pages' }}
      />
    </DirectionProvider>,
  );
  expect(screen.getByText('Soon')).toBeTruthy();
  expect(screen.getByText('3')).toBeTruthy();
  const link = screen.getByRole('link', { name: 'Reports Soon 3' });
  expect(link.getAttribute('href')).toBe('#reports');
});
