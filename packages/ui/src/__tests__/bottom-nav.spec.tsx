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

it('pins the status mark to the top end corner in place of the count, off the label line', () => {
  // العلامة خارج تدفق الخانة: لا سطر ثالث يتجاوز 64px والاسم يحتفظ بسطره كاملًا؛
  // والمدخل تحت التطوير لا يعرض عدّادًا فوق علامته
  render(
    <DirectionProvider dir="rtl">
      <BottomNav
        items={[
          {
            id: 'reports',
            label: 'Reports',
            href: '#reports',
            status: 'Soon — under development for now',
            count: '3',
          },
        ]}
        labels={{ label: 'Workspace pages' }}
      />
    </DirectionProvider>,
  );
  const badge = screen.getByText('Soon — under development for now');
  expect(badge.className).toContain('absolute');
  expect(badge.className).toContain('end-0.5');
  expect(badge.className).toContain('truncate');
  expect(badge.className).toContain('max-w-[calc(100%-0.25rem)]');
  expect(screen.queryByText('3')).toBeNull();
  expect(screen.getByText('Reports').className).toContain('max-w-full');
});
