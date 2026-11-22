import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DirectionProvider } from '../direction-provider.js';
import { TopNav } from '../top-nav.js';
import { chromeLabels, modules } from './navigation-fixtures.js';

afterEach(() => vi.unstubAllGlobals());

function stubWidth(isPhone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: isPhone && query.includes('700'),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

const tree = (resetKey: string | undefined) => (
  <DirectionProvider dir="ltr">
    <TopNav modules={modules} labels={chromeLabels} currentModuleId="sell" resetKey={resetKey} />
  </DirectionProvider>
);

it('closes an open mega menu when the host changes the reset key, keeping the same bar element', () => {
  stubWidth(false);
  const { rerender } = render(tree('/orders'));
  const bar = screen.getByRole('navigation', { name: chromeLabels.navigation });
  fireEvent.click(screen.getByRole('button', { name: /Sell/ }));
  expect(screen.getByRole('dialog', { name: 'Sell' })).toBeTruthy();
  rerender(tree('/orders/new'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('navigation', { name: chromeLabels.navigation })).toBe(bar);
});

it('closes the phone drawer when the host changes the reset key', () => {
  stubWidth(true);
  const { rerender } = render(tree('/orders'));
  fireEvent.click(screen.getByRole('button', { name: chromeLabels.drawerOpen }));
  expect(screen.getByRole('dialog', { name: chromeLabels.drawerTitle })).toBeTruthy();
  rerender(tree('/stock'));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('leaves an open menu alone while the reset key stays the same', () => {
  stubWidth(false);
  const { rerender } = render(tree('/orders'));
  fireEvent.click(screen.getByRole('button', { name: /Sell/ }));
  rerender(tree('/orders'));
  expect(screen.getByRole('dialog', { name: 'Sell' })).toBeTruthy();
});
